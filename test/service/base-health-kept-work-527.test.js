// #527 no cascade (review 1): the roadmap's dispatcher skips a base-health fix item whose issue has an
// ended run's kept work (#112's "a run stopped at …" refusal, not only "already has a live run"),
// and goes on instead of pausing. Seams: runBaseCheck (src/base-health.js) inserts the item; the
// service's roadmap with mock runs (test/service/helpers.js); the ended run fabricated as in
// test/service/resume.test.js (keptWorkRepo, fabricateKeptRun).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { fixture } = require('../worktree-helpers');
const { ISSUE_WORKFLOW, makeService, roadmapProject, until } = require('./helpers');
const { SUITE_SLOT_ENV } = require('../../src/engine/machine-slot');
const { runBaseCheck } = require('../../src/base-health');

let saved;
test.beforeEach(() => { saved = { locks: process.env.MULTIAGENT_LOCKS_DIR, inherit: process.env[SUITE_SLOT_ENV] }; delete process.env[SUITE_SLOT_ENV]; });
test.afterEach(() => {
  for (const [k, v] of [['MULTIAGENT_LOCKS_DIR', saved.locks], [SUITE_SLOT_ENV, saved.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// a repository whose `feature` branch has one commit of its own on top of `main` (a kept worktree)
function keptWorkRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh527k-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\nown\n');
  git('add', '.');
  git('commit', '-q', '-m', 'own');
  return dir;
}

// an ended run of `issue` whose kept worktree still has commits of its own
function fabricateKeptRun(ws, runId, { issue, worktreeDir }) {
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    JSON.stringify({ ts: '2026-10-23T08:00:00Z', type: 'workflow.started', workflow: 'fixture-issue', file: 'fixture-issue.yaml', inputs: {}, mock: false, issues: [issue] }),
    JSON.stringify({ ts: '2026-10-23T08:00:01Z', type: 'worktree.ready', dir: worktreeDir, base: 'main' }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'fixture-issue', status: 'cancelled', started_at: '2026-10-23T08:00:00Z', finished_at: '2026-10-23T08:05:00Z',
    issues: [issue], inputs: {}, sessions: [],
  }));
}

test('#527 the dispatcher skips a base-health fix item whose issue has an ended run\'s kept work, without pausing the roadmap', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const locks = fs.mkdtempSync(path.join(os.tmpdir(), 'bh527k-locks-'));
  t.after(() => fs.rmSync(locks, { recursive: true, force: true, maxRetries: 3 }));
  process.env.MULTIAGENT_LOCKS_DIR = locks;
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'kept527');
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] }] });

  const f = fixture(t, 'canonical');
  const check = await runBaseCheck(ws.root, {
    projectId: p.id, repo: f.repo, base: 'main', platform: 'github', ghRepo: 'o/r', onRed: 'fix', workflow: 'fixture-issue.yaml',
    releaseHoldsBase: () => false, slot: { dir: locks, pollMs: 20 },
    exec: async (cli, args) => ((args || []).map(String).includes('create') ? 'https://github.com/o/r/issues/1' : ''),
    runSuite: async () => ({ failures: [{ test: 'cart totals include tax', file: 'test/cart.test.js', error: 'expected 110, got 100' }], log: 'red' }),
  });
  assert.ok(check.fixItem, 'the fix item was inserted (fixture check)');
  const fixId = check.fixItem.id;
  fabricateKeptRun(ws, '20261023-080000-kept527aa', { issue: { number: 1, url: 'https://github.com/o/r/issues/1', title: 'Issue 1' }, worktreeDir: keptWorkRepo(t) });

  await api['roadmap:start']({ projectId: p.id, simulated: true });
  const fixOf = () => api['roadmap:get']({ projectId: p.id }).stages.flatMap((s) => s.items).find((x) => x.id === fixId);
  await until(() => ['skipped', 'failed'].includes(fixOf()?.status) || api['roadmap:get']({ projectId: p.id }).state === 'paused');
  const r = api['roadmap:get']({ projectId: p.id });
  assert.equal(r.pausedBy ?? null, null, `the roadmap is not paused: ${r.error || ''}`);
  assert.notEqual(r.state, 'paused');
  assert.equal(fixOf()?.status, 'skipped', 'the fix item is skipped');
});
