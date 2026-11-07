// #810 Merge from the app with the project's "delete the branch after a merge" setting on
// (service/areas/runs.js mergeRunPr): the branch is deleted with the merge, unless another live run is stacked
// on this PR (#807, its inputs.parent_pr): that run moves its own PR onto the base after the merge, and a branch
// deleted first would close it. Seams (as pr-monitor-service-809.test.js): the runs area on a small ctx, the live
// runs as fake entries of ctx.active, the platform's CLI through the host's readPrJson / runPrCommand.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const projects = require('../../domains/project/projects');
const { makeService } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUN = '20261107-120000-merge810';
const PR_URL = 'https://github.com/acme/app/pull/42';
const check = (name, conclusion) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion });
const READY = {
  number: 42, state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED',
  latestReviews: [{ author: { login: 'bob' }, state: 'APPROVED' }], comments: [], reviews: [], headRefOid: 'h1',
  statusCheckRollup: [check('test', 'SUCCESS')],
};
const MERGED = { number: 42, state: 'MERGED', isDraft: false, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', statusCheckRollup: [], mergeCommit: { oid: 'abc1234' } };

// gh: the PR ready until a merge exits 0; the API answers (rights, login, review threads) with one object
function fakeHost() {
  const calls = [];
  let merged = false;
  return {
    calls,
    readPrJson: async (cmd, args) => {
      if (args[0] === 'pr' && args[1] === 'view') return merged ? MERGED : READY;
      if (args[0] === 'api') return { login: 'owner', permissions: { push: true, admin: false }, data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } };
      throw new Error(`unexpected read: ${cmd} ${args.join(' ')}`);
    },
    runPrCommand: async (cmd, args) => { calls.push([cmd, ...args]); merged = true; return { exit_code: 0, output: '' }; },
  };
}

async function setup(t, { stackedOn = null, deleteBranch = true } = {}) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-merge-810-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  projects.updateProject(ws.projects, p.id, { deleteBranchAfterMerge: deleteBranch });
  const host = fakeHost();
  const ctx = { ws, events: new EventEmitter(), host };
  Object.assign(ctx, require('../../service/areas/runs')(ctx));
  const acted = [];
  ctx.active.set(RUN, {
    runId: RUN, projectId: p.id, mock: false, status: 'running', approvals: new Map(), prMonitor: 'pr_monitor',
    ctx: { inputs: { mode: 'remote' } }, pendingGates: () => [], displayNames: () => ({ steps: {} }), stop: () => {},
    prMonitorTarget: () => ({ stepId: 'pr_monitor', url: PR_URL, card: null }),
    prActedFromApp: (a) => acted.push(a),
  });
  if (stackedOn) {
    ctx.active.set('20261107-120500-child810', {
      runId: '20261107-120500-child810', projectId: p.id, mock: false, status: 'running', approvals: new Map(), prMonitor: null,
      ctx: { inputs: { mode: 'remote', parent_pr: stackedOn } }, pendingGates: () => [], displayNames: () => ({ steps: {} }), stop: () => {},
    });
  }
  return { ctx, host, acted };
}
const mergeArgs = (host) => host.calls.find((c) => c[1] === 'pr' && c[2] === 'merge') || [];

test('#810 delete-branch setting on, nothing stacked: the merge from the app deletes the branch', async (t) => {
  const { ctx, host } = await setup(t);
  const r = await ctx.mergeRunPr({ runId: RUN });
  const m = mergeArgs(host);
  assert.deepEqual([r.merged, m.includes('--merge'), m.includes('--delete-branch')], [true, true, true]);
});

test('#810 delete-branch setting off: the merge from the app keeps the branch', async (t) => {
  const { ctx, host } = await setup(t, { deleteBranch: false });
  const r = await ctx.mergeRunPr({ runId: RUN });
  assert.deepEqual([r.merged, mergeArgs(host).includes('--delete-branch')], [true, false]);
});

for (const [name, parent] of [['its URL', PR_URL], ['its number', '42']]) {
  test(`#810 delete-branch setting on, a live run stacked on the PR (parent_pr: ${name}): the merge keeps the branch`, async (t) => {
    const { ctx, host, acted } = await setup(t, { stackedOn: parent });
    const r = await ctx.mergeRunPr({ runId: RUN });
    const m = mergeArgs(host);
    assert.deepEqual([r.merged, m.includes('--merge'), m.includes('--delete-branch'), acted[0]?.merged], [true, true, false, true]);
  });
}
