// #812 Merge and Close from the PRs / MRs screen (service/areas/pulls.js mergePullRequest / closePullRequest).
// Seams (as pr-merge-stacked-810.test.js): the area on a small ctx over a real workspace (one project on
// github.com/acme/app), the platform's CLI through the host's readPrJson / runPrCommand, a live run as a fake
// ctx.liveRun entry and the runs area's mergeRunPr / closeRunPr as ctx functions.
// The open PRs: a stack of two (#21 main ← s1, #22 s1 ← s2) and #5 on its own, all ready to merge.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const projects = require('../../domains/project/projects');
const { makeService } = require('./helpers');

const REPO = 'https://github.com/acme/app';
const urlOf = (n) => `${REPO}/pull/${n}`;
const check = { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' };
const ready = (number, base, head) => ({
  number, title: `PR ${number}`, url: urlOf(number), author: { login: 'owner' }, isDraft: false, state: 'OPEN',
  headRefName: head, baseRefName: base, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED',
  latestReviews: [{ author: { login: 'bob' }, state: 'APPROVED' }], statusCheckRollup: [check], comments: [], reviews: [], headRefOid: `h${number}`,
});
const PULLS = [ready(21, 'main', 's1'), ready(22, 's1', 's2'), ready(5, 'main', 'solo')];
const RUN = '20261107-120000-pulls812';

// gh: `pr list` the open PRs, `pr view <n|url>` one of them, the API (rights, login, threads) one object; every
// merge or close is recorded
function fakeHost() {
  const calls = [];
  const numberOf = (ref) => Number((/(\d+)\/?$/.exec(String(ref || '')) || [])[1]);
  return {
    calls,
    readPrJson: async (cmd, args = []) => {
      if (args[0] === 'pr' && args[1] === 'list') return PULLS;
      if (args[0] === 'pr' && args[1] === 'view') return PULLS.find((p) => p.number === numberOf(args[2])) || PULLS[0];
      if (args[0] === 'api') return { login: 'owner', permissions: { push: true, admin: false }, data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } };
      throw new Error(`unexpected read: ${cmd} ${args.join(' ')}`);
    },
    runPrCommand: async (cmd, args) => { calls.push([cmd, ...args]); return { exit_code: 0, output: '' }; },
  };
}

// a finished run that opened PR `number` (its pr_open output), so the list links the PR to it
function writeRunOf(ws, projectId, number) {
  const runDir = path.join(ws.runs, RUN);
  fs.mkdirSync(runDir, { recursive: true });
  const at = '2026-11-07T12:00:00.000Z';
  const events = [
    { ts: at, type: 'workflow.started', workflow: 'Feature', project_id: projectId, inputs: { mode: 'remote' }, mock: false, run_dir: runDir },
    { ts: at, type: 'step.started', step_id: 'pr_open', step_type: 'action' },
    { ts: at, type: 'step.finished', step_id: 'pr_open', duration_ms: 1000, output: { pr_url: urlOf(number), pr_number: number } },
  ];
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${events.map((e, i) => JSON.stringify({ seq: i + 1, run_id: RUN, ...e })).join('\n')}\n`);
}

async function setup(t, { deleteBranch = true, liveRunOf = null } = {}) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-pulls-812-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  projects.updateProject(ws.projects, p.id, { repo: REPO, deleteBranchAfterMerge: deleteBranch });
  const host = fakeHost();
  const viaRun = [];
  const ctx = {
    ws, host,
    liveRun: (runId) => (liveRunOf && runId === RUN ? { runId, prMonitorTarget: () => ({ stepId: 'pr_monitor', url: urlOf(liveRunOf), card: null }) } : null),
    mergeRunPr: async (a) => { viaRun.push(['merge', a]); return { merged: true }; },
    closeRunPr: async (a) => { viaRun.push(['close', a]); return { closed: true }; },
  };
  if (liveRunOf) writeRunOf(ws, p.id, liveRunOf);
  const area = require('../../service/areas/pulls')(ctx);
  return { area, host, viaRun, projectId: p.id };
}
const sent = (host, action) => host.calls.filter((c) => c[1] === 'pr' && c[2] === action);

test('#812 a stack\'s PR above the bottom one is not merged: the list says to merge the ones below first', async (t) => {
  const { area, host, projectId } = await setup(t);
  const r = await area.mergePullRequest({ projectId, url: urlOf(22) });
  assert.deepEqual([r.merged, /stacked/.test(String(r.error)), sent(host, 'merge').length], [false, true, 0]);
});

test('#812 a URL that is not an open PR of the project is refused as a client error', async (t) => {
  const { area, host, projectId } = await setup(t);
  const err = await area.mergePullRequest({ projectId, url: urlOf(999) }).then(() => null, (e) => e);
  assert.deepEqual([err?.status, String(err?.message).includes(urlOf(999)), sent(host, 'merge').length], [400, true, 0]);
  const closeErr = await area.closePullRequest({ projectId, url: urlOf(999) }).then(() => null, (e) => e);
  assert.deepEqual([closeErr?.status, sent(host, 'close').length], [400, 0]);
});

test('#812 the bottom PR of a stack merges, without deleting its branch (the PR above is based on it)', async (t) => {
  const { area, host, projectId } = await setup(t, { deleteBranch: true });
  const r = await area.mergePullRequest({ projectId, url: urlOf(21) });
  const m = sent(host, 'merge');
  assert.deepEqual([r.merged, m.length, m[0]?.includes('21'), m[0]?.includes('--delete-branch')], [true, 1, true, false]);
});

test('#812 a PR with nothing stacked on it merges with the project\'s delete-branch setting', async (t) => {
  const on = await setup(t, { deleteBranch: true });
  const rOn = await on.area.mergePullRequest({ projectId: on.projectId, url: urlOf(5) });
  const off = await setup(t, { deleteBranch: false });
  const rOff = await off.area.mergePullRequest({ projectId: off.projectId, url: urlOf(5) });
  assert.deepEqual(
    [rOn.merged, sent(on.host, 'merge')[0]?.includes('--delete-branch'), rOff.merged, sent(off.host, 'merge')[0]?.includes('--delete-branch')],
    [true, true, true, false],
  );
});

test('#812 a PR whose live run waits in its PR monitor merges and closes through that run', async (t) => {
  const { area, host, viaRun, projectId } = await setup(t, { liveRunOf: 5 });
  const merged = await area.mergePullRequest({ projectId, url: urlOf(5) });
  const closed = await area.closePullRequest({ projectId, url: urlOf(5) });
  assert.deepEqual(
    [merged.merged, closed.closed, viaRun, host.calls.length],
    [true, true, [['merge', { runId: RUN, admin: false }], ['close', { runId: RUN }]], 0],
  );
});

test('#812 a PR with no run closes from the list with the platform\'s close', async (t) => {
  const { area, host, viaRun, projectId } = await setup(t);
  const r = await area.closePullRequest({ projectId, url: urlOf(5) });
  const c = sent(host, 'close');
  assert.deepEqual([r.closed, c.length, c[0]?.includes('5'), viaRun.length], [true, 1, true, 0]);
});
