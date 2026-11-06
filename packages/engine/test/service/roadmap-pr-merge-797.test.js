// #797 "A run that ended with a PR a person merges": acceptance tests written before the code, through the
// service. A run that succeeded with an open PR waits for its merge instead of failing and pausing the roadmap.
//
// Contract (the seam these tests assume):
// - A new item status id, `waiting_merge`. The view of an item (roadmap:get, backlog:get's roadmap, the light
//   backlog:state) says `status: 'waiting_merge'`, `error: null`, `pr: { number, url, state, detail, checkedAt }`
//   (state null before the first read; `state: 'unknown'` with a detail matching /could not read the PR/ after a
//   failed read). Before any read the item is waiting_merge, never failed.
// - Merged: `status: 'done'`, `error: null`, the view's `run.mergedCommit` is the merge commit, and the done status
//   and the sha are stored (asserted on JSON.stringify of the stored item: the field's name stays free). gh's read
//   asks for `mergeCommit` in --json. gh: { state: 'MERGED', mergeCommit: { oid } }. glab: { state: 'merged',
//   merge_commit_sha }; a squashed MR: { state: 'merged', merge_commit_sha: null, squash_commit_sha } gives the squash sha.
// - Closed: `status: 'failed'`, `error` matches /closed without merging/i and contains `#<number>`; after a dispatch
//   the roadmap is `paused` with `pausedBy` = the item's id, as any failure; roadmap:item skip then goes on.
// - The boundary: host.readPrJson (makeService(t, { readPrJson }), `(cmd, args) => parsed JSON`, a throw = a failed read).
// - The triggers: dispatch = await roadmap:start({ projectId, simulated: true }); sync = await backlog:sync({ projectId }),
//   which reads FRESH (the 5-minute cache must not hide a merge a person just did) and then dispatches the roadmap;
//   open = backlog:get({ projectId }), which may read in the background (so `until`, no fixed sleep). Two opens in a
//   row read the PR at most once; roadmap:get and backlog:state never read (they are polled).
//
// The seeded run is real (`mock: false`: a mock run counts as merged today and stays so), the roadmap's items are
// mock so roadmap:start with simulated: true is allowed in simulation-only mode. backlog:sync reads the issues with
// the real gh/glab (no host stand-in): the file puts fake ones first on the PATH, answering an empty list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject, until } = require('./helpers');

const RUN = '20261106-120000-pr797run';
const SHA = '797aaa0000000000000000000000000000000001';
const SQUASH = '797bbb0000000000000000000000000000000002';
const PR_URL = 'https://github.com/o/r/pull/7';
const MR_URL = 'https://gitlab.com/o/r/-/merge_requests/7';
const UPSTREAM = 'https://github.com/up/r';
const FORK = { url: 'https://github.com/me/r', upstream: UPSTREAM };
// gh takes `up/r` or `github.com/up/r`: either reads the upstream
const UPSTREAM_REPO = /^(github\.com\/)?up\/r$/;
const OPEN = { state: 'OPEN', isDraft: false, mergeable: 'UNKNOWN', statusCheckRollup: [] };
const MERGED = { state: 'MERGED', mergeCommit: { oid: SHA } };
const CLOSED = { state: 'CLOSED', mergeCommit: null };
const OFFLINE = 'gh is not installed';
const NEVER_MERGES = 'fixture-never-merges.yaml';

// the gh and glab of backlog:sync's issue list, for the whole file: no test reaches the machine's CLI or the network
let cliDir;
let realPath;
test.before(() => {
  cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-cli-797-'));
  for (const cli of ['gh', 'glab']) {
    fs.writeFileSync(path.join(cliDir, cli), '#!/bin/sh\necho "[]"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(cliDir, `${cli}.cmd`), '@echo []\r\n');
  }
  realPath = process.env.PATH;
  process.env.PATH = [cliDir, realPath].join(path.delimiter);
});
test.after(() => {
  process.env.PATH = realPath;
  fs.rmSync(cliDir, { recursive: true, force: true });
});

// A background read or dispatch has had its turn (a few rounds of the event loop, no fixed sleep).
async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

// The run folder as an ended run leaves it: its PR in the output of its `pr_open` step.
function writeRun(ws, { projectId, file, mock, status, output, events, localMerge }) {
  const dir = path.join(ws.runs, RUN);
  fs.mkdirSync(dir, { recursive: true });
  const [startedAt, finishedAt] = ['2026-11-06T12:00:00.000Z', '2026-11-06T12:30:00.000Z'];
  const summary = {
    run_id: RUN, workflow: 'fixture-issue', project_id: projectId, status, mock, started_at: startedAt, finished_at: finishedAt, inputs: {}, sessions: [],
    ...(localMerge ? { local_merge: localMerge } : {}),
  };
  const lines = [
    { ts: startedAt, run_id: RUN, type: 'workflow.started', workflow: 'fixture-issue', file, project_id: projectId, inputs: {}, mock, run_dir: dir },
    { ts: finishedAt, run_id: RUN, type: 'step.finished', step_id: 'pr_open', output },
    ...events,
    { ts: finishedAt, run_id: RUN, type: 'workflow.finished', status, ...(status === 'success' ? {} : { error: 'the suite failed' }), summary },
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${lines.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary));
}

// A roadmap of two stages: stage 1's item holds the ended run, stage 2's is planned. `answer` is what the platform
// says of the PR (an Error: the read fails), `pr.answer` changes it later; `reads` keeps each read as [cmd, ...args].
// `started`: the roadmap already runs, for a test that does not start with a dispatch.
async function seeded(t, {
  answer = OPEN, output = { pr_url: PR_URL, pr_number: 7 }, events = [], localMerge = null, mock = false, file = 'fixture-issue.yaml',
  status = 'success', repo = 'https://github.com/o/r', platform = 'github', fork = null, started = false,
} = {}) {
  const reads = [];
  const pr = { answer };
  const readPrJson = async (cmd, args) => {
    reads.push([cmd, ...args]);
    if (pr.answer instanceof Error) throw pr.answer;
    return pr.answer;
  };
  const { service, api } = makeService(t, { readPrJson });
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  fs.writeFileSync(path.join(ws.workflows, NEVER_MERGES), ISSUE_WORKFLOW.replace('name: fixture-issue', 'name: fixture-never-merges\n  merges: false'));
  const p = await roadmapProject(api, ws, t, [1, 2], 'pr-merge-797');
  await api['projects:update']({ id: p.id, patch: { repo, ...(fork ? { fork } : {}) } });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform, repo, issues: [roadmapIssue(1), roadmapIssue(2)] }));
  roadmaps.saveStages(ws.backlog, p.id, [
    { items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] },
    { items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
  ], { issues: [roadmapIssue(1), roadmapIssue(2)] });
  const itemId = roadmaps.readRoadmap(ws.backlog, p.id).stages[0].items[0].id;
  roadmaps.markStarted(ws.backlog, p.id, itemId, { runId: RUN });
  writeRun(ws, { projectId: p.id, file, mock, status, output, events, localMerge });
  if (started) roadmaps.setState(ws.backlog, p.id, 'running', { simulated: true });

  const projectId = p.id;
  const view = () => api['roadmap:get']({ projectId });
  return {
    api, ws, projectId, itemId, reads, pr, view,
    first: () => view().stages[0].items[0],
    second: () => view().stages[1].items[0],
    stored: () => roadmaps.findItem(roadmaps.readRoadmap(ws.backlog, projectId), itemId),
    dispatch: () => api['roadmap:start']({ projectId, simulated: true }),
    sync: () => api['backlog:sync']({ projectId }),
    open: () => api['backlog:get']({ projectId }),
    // the roadmap as a run paused it before this change: its item is the one paying for an unmerged run
    pausedTheOldWay() {
      roadmaps.writeRoadmap(ws.backlog, projectId, {
        ...roadmaps.readRoadmap(ws.backlog, projectId), state: 'paused', simulated: true, pausedBy: itemId,
        error: `Run ${RUN} finished without merging: merge it, then skip the item`,
      });
    },
  };
}

const jsonFields = (read) => String(read[read.indexOf('--json') + 1]).split(',');
const repoOf = (read) => read[read.indexOf('--repo') + 1];
const notPaused = (r) => [r.state === 'paused', r.pausedBy ?? null];

test('#797 a PR known by its number on a project with no repository: the item waits, says why, and nothing is read', async (t) => {
  const c = await seeded(t, { output: { pr_number: 7 }, repo: '' });
  await c.dispatch();
  const x = c.first();
  assert.deepEqual([x.status, x.error, x.pr.number, x.pr.state], ['waiting_merge', null, 7, 'unknown']);
  assert.match(x.pr.detail, /could not read the PR: the project has no repository/);
  assert.deepEqual(notPaused(c.view()), [false, null]);
  assert.equal(c.reads.length, 0);
});

// ---- an open PR: the item waits, the roadmap does not pause ----------------------------------------

test('#797 a success run with an open PR: after a dispatch the item waits for the merge with its PR, no error, the roadmap not paused and stage 2 not started', async (t) => {
  const c = await seeded(t);
  await c.dispatch();
  const x = c.first();
  assert.equal(x.status, 'waiting_merge');
  assert.equal(x.error, null);
  assert.deepEqual([x.pr?.number, x.pr?.url, x.pr?.state], [7, PR_URL, 'open']);
  assert.equal(typeof x.pr?.detail, 'string');
  assert.equal(typeof x.pr?.checkedAt, 'string');
  const r = c.view();
  assert.deepEqual([r.state, r.pausedBy ?? null], ['running', null]);
  assert.equal(c.second().runId ?? null, null, 'a later stage does not start while an earlier item waits');
});

for (const [what, answer, state] of [
  ['with conflicts', { ...OPEN, mergeable: 'CONFLICTING' }, 'conflict'],
  ['with a failing check', { ...OPEN, statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE' }] }, 'failing'],
]) {
  test(`#797 a PR open ${what} still waits: a person may fix it, it is not a failure of the item`, async (t) => {
    const c = await seeded(t, { answer });
    await c.dispatch();
    const x = c.first();
    assert.deepEqual([x.status, x.error, x.pr?.state], ['waiting_merge', null, state]);
    assert.deepEqual(notPaused(c.view()), [false, null]);
  });
}

test('#797 before any read the item is waiting_merge, never failed, and roadmap:get read nothing', async (t) => {
  const c = await seeded(t, { started: true });
  const x = c.first();
  assert.deepEqual([x.status, x.error], ['waiting_merge', null]);
  assert.deepEqual([x.pr?.number, x.pr?.url, x.pr?.state, x.pr?.checkedAt], [7, PR_URL, null, null]);
  assert.deepEqual(c.reads, []);
});

test('#797 backlog:get\'s roadmap carries the waiting status and the PR', async (t) => {
  const c = await seeded(t);
  await c.dispatch();
  const x = (await c.open()).roadmap.stages[0].items[0];
  assert.deepEqual([x.status, x.error, x.pr?.number, x.pr?.url, x.pr?.state], ['waiting_merge', null, 7, PR_URL, 'open']);
});

test('#797 the light backlog:state carries the waiting status and the PR', async (t) => {
  const c = await seeded(t);
  await c.dispatch();
  const x = c.api['backlog:state']({ projectId: c.projectId }).roadmap.stages[0].items[0];
  assert.deepEqual([x.status, x.error ?? null, x.pr?.number, x.pr?.url, x.pr?.state], ['waiting_merge', null, 7, PR_URL, 'open']);
  assert.equal(typeof x.pr?.checkedAt, 'string');
});

// ---- merged on the platform: the item is done, the stage ends -----------------------------------------

test('#797 GitHub: a PR merged by a person, seen by a sync: the item is done with the merge commit, stored, and stage 2 starts', async (t) => {
  const c = await seeded(t);
  await c.dispatch();
  c.pr.answer = MERGED;
  await c.sync();
  const x = c.first();
  assert.deepEqual([x.status, x.error, x.run?.mergedCommit], ['done', null, SHA]);
  assert.equal(c.stored().status, 'done');
  assert.ok(JSON.stringify(c.stored()).includes(SHA), 'the merge commit is stored with the item');
  const read = c.reads.at(-1);
  assert.equal(read[0], 'gh');
  assert.ok(jsonFields(read).includes('mergeCommit'), `gh is asked for the merge commit: ${read.join(' ')}`);
  await until(() => !!c.second().runId);
});

test('#797 GitLab: a merged MR is done with its merge commit, read with glab, and stage 2 starts', async (t) => {
  const c = await seeded(t, {
    repo: 'https://gitlab.com/o/r', platform: 'gitlab', output: { pr_url: MR_URL, pr_number: 7 }, answer: { state: 'merged', merge_commit_sha: SHA },
  });
  await c.dispatch();
  const x = c.first();
  assert.deepEqual([x.status, x.error, x.run?.mergedCommit], ['done', null, SHA]);
  assert.ok(JSON.stringify(c.stored()).includes(SHA));
  assert.equal(c.reads[0]?.[0], 'glab');
  await until(() => !!c.second().runId);
});

test('#797 GitLab: a squashed MR has no merge commit: the item is done with the squash commit', async (t) => {
  const c = await seeded(t, {
    repo: 'https://gitlab.com/o/r', platform: 'gitlab', output: { pr_url: MR_URL, pr_number: 7 }, answer: { state: 'merged', merge_commit_sha: null, squash_commit_sha: SQUASH },
  });
  await c.dispatch();
  const x = c.first();
  assert.deepEqual([x.status, x.error, x.run?.mergedCommit], ['done', null, SQUASH]);
  assert.ok(JSON.stringify(c.stored()).includes(SQUASH));
});

test('#797 Fork + PR: the PR lives on the upstream: it is read there and the merged item is done', async (t) => {
  const c = await seeded(t, { repo: FORK.url, fork: FORK, output: { pr_url: `${UPSTREAM}/pull/7`, pr_number: 7 }, answer: MERGED });
  await c.dispatch();
  assert.deepEqual([c.first().status, c.first().run?.mergedCommit], ['done', SHA]);
  assert.match(repoOf(c.reads[0]), UPSTREAM_REPO);
});

test('#797 Fork + PR with only `pr_number` in the output: the PR is still read on the upstream, not on the fork', async (t) => {
  const c = await seeded(t, { repo: FORK.url, fork: FORK, output: { pr_number: 7 }, answer: MERGED });
  await c.dispatch();
  assert.equal(c.first().status, 'done');
  assert.ok(c.reads[0]?.includes('7'), `the PR's number is read: ${c.reads[0]}`);
  assert.match(repoOf(c.reads[0]), UPSTREAM_REPO);
});

// ---- closed without merging: a failure that says so -----------------------------------------------------

test('#797 a PR closed without merging: the item failed saying so, the roadmap paused by it, and Skip goes on to stage 2', async (t) => {
  const c = await seeded(t, { answer: CLOSED });
  await c.dispatch();
  const x = c.first();
  assert.equal(x.status, 'failed');
  assert.match(x.error, /closed without merging/i);
  assert.ok(x.error.includes('#7'), x.error);
  assert.deepEqual([c.view().state, c.view().pausedBy], ['paused', c.itemId]);
  await c.api['roadmap:item']({ projectId: c.projectId, itemId: c.itemId, action: 'skip' });
  assert.equal(c.first().status, 'skipped');
  await until(() => !!c.second().runId);
});

// ---- a read that fails: the item keeps waiting ----------------------------------------------------------

test('#797 a failed read on a dispatch keeps the item waiting and says why, never a failure; back online a sync finds it merged', async (t) => {
  const c = await seeded(t, { answer: new Error(OFFLINE) });
  await c.dispatch();
  const x = c.first();
  assert.deepEqual([x.status, x.error, x.pr?.state], ['waiting_merge', null, 'unknown']);
  assert.match(x.pr?.detail || '', /could not read the PR/);
  assert.ok(x.pr.detail.includes(OFFLINE), x.pr.detail);
  assert.deepEqual(notPaused(c.view()), [false, null]);
  c.pr.answer = MERGED;
  await c.sync();
  assert.deepEqual([c.first().status, c.first().run?.mergedCommit], ['done', SHA]);
});

// ---- the owner goes on without the merge ----------------------------------------------------------------

test('#797 the owner skips a waiting item: it is skipped and stage 2 starts', async (t) => {
  const c = await seeded(t);
  await c.dispatch();
  assert.equal(c.first().status, 'waiting_merge');
  await c.api['roadmap:item']({ projectId: c.projectId, itemId: c.itemId, action: 'skip' });
  assert.equal(c.first().status, 'skipped');
  await until(() => !!c.second().runId);
});

// ---- when the PR is read ---------------------------------------------------------------------------------

test('#797 a sync reads fresh: a merge done right after a read is seen inside the cache time', async (t) => {
  const c = await seeded(t, { started: true });
  assert.equal(c.first().status, 'waiting_merge');
  await c.open();
  await until(() => c.first().pr?.state === 'open');
  c.pr.answer = MERGED;
  await c.sync();
  assert.deepEqual([c.first().status, c.first().run?.mergedCommit], ['done', SHA]);
  await until(() => !!c.second().runId);
});

test('#797 opening the Roadmap reads the PR: a merged item shows done', async (t) => {
  const c = await seeded(t, { started: true, answer: MERGED });
  await c.open();
  await until(() => c.first().status === 'done');
  assert.equal(c.first().run?.mergedCommit, SHA);
});

test('#797 two opens in a row read the PR once, and an open after that read does not read again', async (t) => {
  const c = await seeded(t, { started: true });
  await c.open();
  await c.open();
  await until(() => c.reads.length > 0);
  await until(() => !!c.first().pr?.checkedAt);
  await c.open();
  await flush();
  assert.equal(c.reads.length, 1, 'no tight polling');
});

test('#797 roadmap:get and backlog:state are polled: they never read the PR', async (t) => {
  const c = await seeded(t, { started: true });
  for (let i = 0; i < 3; i++) {
    c.view();
    c.api['backlog:state']({ projectId: c.projectId });
  }
  await flush();
  assert.deepEqual(c.reads, []);
});

// ---- a roadmap the old rule already paused ---------------------------------------------------------------

test('#797 a roadmap paused by this run with the old message, the PR merged: a sync ends the pause, the item is done and stage 2 starts', async (t) => {
  const c = await seeded(t, { answer: MERGED });
  c.pausedTheOldWay();
  await c.sync();
  assert.deepEqual([c.first().status, c.first().run?.mergedCommit], ['done', SHA]);
  assert.deepEqual(notPaused(c.view()), [false, null]);
  assert.doesNotMatch(String(c.view().error ?? ''), /without merging/);
  await until(() => !!c.second().runId);
});

test('#797 a roadmap paused by this run with the old message, the PR open: a sync ends the pause and the item waits', async (t) => {
  const c = await seeded(t);
  c.pausedTheOldWay();
  await c.sync();
  assert.deepEqual([c.first().status, c.first().error], ['waiting_merge', null]);
  assert.deepEqual(notPaused(c.view()), [false, null]);
  assert.doesNotMatch(String(c.view().error ?? ''), /without merging/);
  assert.equal(c.second().runId ?? null, null);
});

// ---- the other runs do not change: each has a PR in its output and none is read ---------------------------

async function everyTrigger(c) {
  await c.dispatch();
  await c.open();
  await c.sync();
  await flush();
}

for (const [what, options] of [
  ['a local merge', { localMerge: { branch: 'feature/1', base: 'main', commit: SHA } }],
  ['a `gh pr merge` run by the run', { events: [{ type: 'action.executed', command: 'gh pr merge 7 --squash', exit_code: 0 }] }],
  ['a workflow that never merges (metadata.merges: false)', { file: NEVER_MERGES }],
  ['a simulated run', { mock: true }],
]) {
  test(`#797 unchanged: ${what} is done without reading its PR, and stage 2 starts`, async (t) => {
    const c = await seeded(t, options);
    await everyTrigger(c);
    assert.deepEqual([c.first().status, c.first().error], ['done', null]);
    assert.deepEqual(c.reads, []);
    await until(() => !!c.second().runId);
  });
}

test('#797 unchanged: a success run with no PR stays failed with "finished without merging" and pauses the roadmap', async (t) => {
  const c = await seeded(t, { output: { summary: 'no PR here' } });
  await everyTrigger(c);
  assert.equal(c.first().status, 'failed');
  assert.match(c.first().error, /finished without merging/);
  assert.deepEqual([c.view().state, c.view().pausedBy], ['paused', c.itemId]);
  assert.deepEqual(c.reads, []);
});

test('#797 unchanged: a failed run with a PR stays failed, pauses the roadmap and its PR is not read', async (t) => {
  const c = await seeded(t, { status: 'failed' });
  await everyTrigger(c);
  assert.equal(c.first().status, 'failed');
  assert.match(c.first().error, /the suite failed/);
  assert.deepEqual([c.view().state, c.view().pausedBy], ['paused', c.itemId]);
  assert.deepEqual(c.reads, []);
});
