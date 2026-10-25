// #489 the release train and the push's release candidate in the service: releaseTrain of
// packages/engine/service/areas/releases.js (promote with the promote-release permission, propose without it,
// hold on a red base check or when the tag fails) and a push of the local base (pushProject of
// packages/engine/service/areas/local-push.js) recording its tip as a release candidate with the backlog's issues.
// Throwaway folders in os.tmpdir(); the push goes to a local bare repository (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// No user git config (identity, hooks, aliases), as on CI.
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const rc = (tag, commit, date, runId, number) => ({ tag, commit, date, runId, issues: [{ number, title: `Issue ${number}`, labels: ['enhancement'] }] });
const HISTORY = {
  releases: [{ version: 'v1.2.0', tag: 'v1.2.0', date: '2026-10-10T10:00:00.000Z', commit: 'c0c0c0c0', rc: 'v1.2.0-rc.1', issues: [{ number: 12, title: 'Issue 12' }], runs: ['run-a'], status: 'shipped' }],
  candidates: [
    rc('v1.2.0-rc.1', 'c0c0c0c0', '2026-10-09T10:00:00.000Z', 'run-a', 12),
    rc('v1.3.0-rc.1', 'c1c1c1c1', '2026-10-12T10:00:00.000Z', 'run-b', 15),
    rc('v1.3.0-rc.2', 'c2c2c2c2', '2026-10-13T10:00:00.000Z', 'run-c', 16),
  ],
  next: { notes: '' },
};

function workspace(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'svc-train489-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const ws = { root, releases: path.join(root, 'releases'), backlog: path.join(root, 'backlog'), runs: path.join(root, 'runs'), projects: path.join(root, 'projects'), discovery: path.join(root, 'discovery') };
  for (const d of Object.values(ws)) fs.mkdirSync(d, { recursive: true });
  return ws;
}

// the releases area of a project p1 whose folder is `folder`, with HISTORY and the base check given
function trainSetup(t, { base = null, folder = null } = {}) {
  const ws = workspace(t);
  fs.writeFileSync(path.join(ws.projects, 'p1.json'), JSON.stringify({ name: 'demo', folder: folder || ws.root }));
  fs.writeFileSync(path.join(ws.releases, 'p1.json'), JSON.stringify(HISTORY));
  const notices = [];
  const svc = require('../../service/areas/releases')({ ws, active: new Map(), notify: (n) => notices.push(n), baseCheckState: () => base });
  const stable = () => svc.listReleases({ projectId: 'p1' }).releases.map((r) => r.tag || r.version);
  return { svc, notices, stable };
}

// simulation-only decides whether a promotion pushes a real tag: set or cleared for one test
function simulation(t, on) {
  const before = process.env.MULTIAGENT_SIMULATION_ONLY;
  if (on) process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  else delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { if (before === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = before; });
}

test('#489 train: with promote-release allowed and the base green on the last candidate, it is promoted to the stable version', async (t) => {
  simulation(t, true);
  const { svc, stable } = trainSetup(t, { base: { commit: 'c2c2c2c2', status: 'green' } });
  const out = await svc.releaseTrain('p1', { allowed: ['promote-release'] });
  assert.equal(out.action, 'promote');
  assert.equal(out.rc, 'v1.3.0-rc.2');
  assert.equal(out.tag, 'v1.3.0');
  assert.deepEqual(stable(), ['v1.3.0', 'v1.2.0']);
  assert.deepEqual((svc.listReleases({ projectId: 'p1' }).candidates || []).map((c) => c.tag), []);
});

test('#489 train: a promotion whose tag fails is held with the reason, and nothing is recorded as stable', async (t) => {
  simulation(t, false);
  const ws = workspace(t);
  const folder = path.join(ws.root, 'repo');
  fs.mkdirSync(folder);
  git(folder, 'init', '-q'); // a repository without the candidate's commit: the tag cannot be made
  const { svc, stable } = trainSetup(t, { base: { commit: 'c2c2c2c2', status: 'green' }, folder });
  const out = await svc.releaseTrain('p1', { allowed: ['promote-release'] });
  assert.equal(out.action, 'hold');
  assert.equal(out.rc, 'v1.3.0-rc.2');
  assert.match(out.reason, /v1\.3\.0-rc\.2/);
  assert.match(out.reason, /fail|not in/i);
  assert.deepEqual(stable(), ['v1.2.0']);
});

test('#489 train: without the permission the promotion is proposed to the owner and nothing is promoted', async (t) => {
  simulation(t, true);
  const { svc, notices, stable } = trainSetup(t, { base: { commit: 'c2c2c2c2', status: 'green' } });
  const out = await svc.releaseTrain('p1', { allowed: [] });
  assert.equal(out.action, 'propose');
  assert.equal(out.rc, 'v1.3.0-rc.2');
  assert.deepEqual(stable(), ['v1.2.0']);
  assert.deepEqual(notices.map((n) => [n.target?.view, n.target?.projectId, String(n.title).includes('v1.3.0-rc.2')]), [['releases', 'p1', true]]);
});

test('#489 train: a red base check on the last candidate holds it and says why, even with the permission', async (t) => {
  simulation(t, true);
  const { svc, stable } = trainSetup(t, { base: { commit: 'c2c2c2c2', status: 'red' } });
  const out = await svc.releaseTrain('p1', { allowed: ['promote-release'] });
  assert.equal(out.action, 'hold');
  assert.match(out.reason, /base check/i);
  assert.deepEqual(stable(), ['v1.2.0']);
});

test('#489 a push of the local base records its tip as a release candidate, with the backlog\'s issues', async (t) => {
  const ws = workspace(t);
  const origin = path.join(ws.root, 'origin.git');
  const repo = path.join(ws.root, 'repo');
  git(ws.root, 'init', '-q', '--bare', origin);
  git(ws.root, 'clone', '-q', origin, repo);
  git(repo, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'demo', version: '1.3.0' }));
  git(repo, 'add', 'package.json');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
  git(repo, 'add', 'b.txt');
  git(repo, 'commit', '-q', '-m', 'Add b\n\nCloses #7');
  fs.writeFileSync(path.join(repo, 'c.txt'), 'c\n');
  git(repo, 'add', 'c.txt');
  git(repo, 'commit', '-q', '-m', 'Add c');
  const tip = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(ws.projects, 'p1.json'), JSON.stringify({ name: 'demo', folder: repo }));
  fs.writeFileSync(path.join(ws.backlog, 'p1.json'), JSON.stringify({ projectId: 'p1', issues: [{ number: 7, title: 'Export runs as CSV', labels: ['enhancement'] }] }));

  const ctx = { ws, active: new Map(), notify() {}, withIssueRuns: (x) => x };
  const rel = require('../../service/areas/releases')(ctx);
  ctx.recordPushCandidate = rel.recordPushCandidate;
  const push = require('../../service/areas/local-push')(ctx);
  const out = await push.pushProject({ projectId: 'p1' });
  assert.equal(out.pushed, true);

  const cands = require('../../domains/releases/releases').readReleases(ws.releases, 'p1').candidates || [];
  assert.deepEqual(cands.map((c) => [c.tag, c.commit]), [['v1.3.0-rc.1', tip]]);
  assert.deepEqual(cands[0].issues.map((i) => [i.number, i.title, (i.labels || []).join(',')]), [[7, 'Export runs as CSV', 'enhancement']]);
});
