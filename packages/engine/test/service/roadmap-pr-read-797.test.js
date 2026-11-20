// #797 internals through the service: a read of a waiting PR tells the screen when it changes what the card
// says (nothing else redraws it with no run active), and the merge commit outlives an edit of the roadmap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const { resolveCommand } = require('../../engine/providers');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject, until } = require('./helpers');

const RUN = '20261106-130000-pr797read';
const SHA = '797ccc0000000000000000000000000000000003';
const OPEN = { state: 'OPEN', isDraft: false, mergeable: 'UNKNOWN', statusCheckRollup: [] };
const ISSUES = [roadmapIssue(1), roadmapIssue(2)];

// The gh of backlog:sync's issue list, for the whole file: an empty list, or a failure while `offline` exists. The
// login shell's PATH goes first once per process (engine/providers.js): it merges here, before the fake folder, so
// the machine's gh never answers. The PR's own read is host.readPrJson's, in every test.
let cliDir;
let realPath;
const offline = () => path.join(cliDir, 'offline');
test.before(() => {
  resolveCommand('gh');
  cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-cli-797-read-'));
  fs.writeFileSync(path.join(cliDir, 'gh'), `#!/bin/sh\nif [ -f "${offline()}" ]; then echo "could not resolve host" >&2; exit 1; fi\necho "[]"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(cliDir, 'gh.cmd'), `@if exist "${offline()}" exit /b 1\r\n@echo []\r\n`);
  realPath = process.env.PATH;
  // Windows looks for gh.exe in every folder before any gh.cmd: the real gh.exe (unauthenticated on the
  // release runner) would win over the fake, so its folder leaves PATH for this file
  const realGh = process.platform === 'win32' ? resolveCommand('gh')?.file : null;
  const realDir = realGh && /\.exe$/i.test(realGh) ? path.dirname(realGh).toLowerCase() : null;
  const kept = realPath.split(path.delimiter).filter((d) => !realDir || d.replace(/[\\/]+$/, '').toLowerCase() !== realDir);
  process.env.PATH = [cliDir, ...kept].join(path.delimiter);
});
test.after(() => {
  process.env.PATH = realPath;
  fs.rmSync(cliDir, { recursive: true, force: true });
});
test.afterEach(() => fs.rmSync(offline(), { force: true }));

function writeRun(ws, projectId) {
  const dir = path.join(ws.runs, RUN);
  fs.mkdirSync(dir, { recursive: true });
  const [startedAt, finishedAt] = ['2026-11-06T13:00:00.000Z', '2026-11-06T13:30:00.000Z'];
  const summary = { run_id: RUN, workflow: 'fixture-issue', project_id: projectId, status: 'success', mock: false, started_at: startedAt, finished_at: finishedAt, inputs: {}, sessions: [] };
  const lines = [
    { ts: startedAt, run_id: RUN, type: 'workflow.started', workflow: 'fixture-issue', file: 'fixture-issue.yaml', project_id: projectId, inputs: {}, mock: false, run_dir: dir },
    { ts: finishedAt, run_id: RUN, type: 'step.finished', step_id: 'pr_open', output: { pr_url: 'https://github.com/o/r/pull/7', pr_number: 7 } },
    { ts: finishedAt, run_id: RUN, type: 'workflow.finished', status: 'success', summary },
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${lines.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary));
}

async function seeded(t, answer) {
  const pr = { answer };
  const reads = [];
  const readPrJson = async () => {
    reads.push(1);
    if (pr.answer instanceof Error) throw pr.answer;
    return pr.answer;
  };
  const { service, api } = makeService(t, { readPrJson });
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'pr-read-797');
  await api['projects:update']({ id: p.id, patch: { repo: 'https://github.com/o/r' } });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: ISSUES }));
  roadmaps.saveStages(ws.backlog, p.id, [
    { items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] },
    { items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
  ], { issues: ISSUES });
  const itemId = roadmaps.readRoadmap(ws.backlog, p.id).stages[0].items[0].id;
  roadmaps.markStarted(ws.backlog, p.id, itemId, { runId: RUN });
  writeRun(ws, p.id);
  const pushed = [];
  service.events.on('backlog:changed', (e) => { if (e.file === 'roadmap' && e.projectId === p.id) pushed.push(e); });
  // #818: the backlog/ watcher (areas/backlog-watch.js, started by makeService's setWorkspace) pushes its own
  // backlog:changed for the roadmap file written above, debounced: 300 ms later, after the listener. Counted as
  // a read's push, it made a count from seeding reach 2 when both landed between two checks of until, and the
  // wait for exactly 1 never ended (#810's suite). It is drained here: `pushed` holds only what a test does.
  if (api['backlog:watching']()) await until(() => pushed.length >= 1);
  pushed.length = 0;
  const projectId = p.id;
  return {
    service, api, ws, projectId, itemId, pr, reads, pushed,
    first: () => api['roadmap:get']({ projectId }).stages[0].items[0],
    sync: () => api['backlog:sync']({ projectId }),
    // the first read is behind it: what a later sync finds is compared with this. It waits for the push of
    // this open's own read, whatever came before it (a failed sync, #818)
    async opened() {
      const before = pushed.length;
      api['backlog:get']({ projectId });
      await until(() => pushed.length > before);
    },
  };
}

test('#797 a failed read on opening the Roadmap pushes backlog:changed, and the next open, with nothing new, does not', async (t) => {
  const c = await seeded(t, new Error('gh is not installed'));
  c.api['backlog:get']({ projectId: c.projectId });
  await until(() => c.pushed.length === 1);
  const x = c.api['roadmap:get']({ projectId: c.projectId }).stages[0].items[0];
  assert.deepEqual([x.status, x.pr.state], ['waiting_merge', 'unknown']);
  assert.match(x.pr.detail, /could not read the PR/);
  c.api['backlog:get']({ projectId: c.projectId });
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual([c.pushed.length, c.reads.length], [1, 1]);
});

test('#797 a dispatch that finds the same state pushes nothing', async (t) => {
  const c = await seeded(t, OPEN);
  c.api['backlog:get']({ projectId: c.projectId });
  await until(() => c.pushed.length === 1);
  await c.api['roadmap:start']({ projectId: c.projectId, simulated: true });
  assert.equal(c.pushed.length, 1);
});

test('#797 a sync whose read of the PR fails pushes backlog:changed: the item waits and says why, nothing fails', async (t) => {
  const c = await seeded(t, OPEN);
  await c.opened();
  c.pr.answer = new Error('gh: could not resolve host');
  await c.sync();
  assert.equal(c.pushed.length, 2);
  const x = c.first();
  assert.deepEqual([x.status, x.error, x.pr.state], ['waiting_merge', null, 'unknown']);
  assert.match(x.pr.detail, /could not read the PR: gh: could not resolve host/);
  assert.equal(c.api['roadmap:get']({ projectId: c.projectId }).state === 'paused', false);
});

test('#797 a sync that finds the same PR pushes nothing, though it read it again', async (t) => {
  const c = await seeded(t, OPEN);
  await c.opened();
  await c.sync();
  assert.deepEqual([c.reads.length, c.pushed.length], [2, 1]);
});

test('#797 a sync that changes only what the PR\'s state says pushes backlog:changed', async (t) => {
  const c = await seeded(t, OPEN);
  await c.opened();
  const before = c.first().pr;
  c.pr.answer = { ...OPEN, mergeStateStatus: 'BLOCKED' };
  await c.sync();
  assert.equal(c.first().pr.state, before.state);
  assert.notEqual(c.first().pr.detail, before.detail);
  assert.equal(c.pushed.length, 2);
});

test('#797 a sync that finds the merge pushes backlog:changed and the item is done', async (t) => {
  const c = await seeded(t, OPEN);
  await c.api['roadmap:start']({ projectId: c.projectId, simulated: true });
  await until(() => c.pushed.length >= 1);
  const before = c.pushed.length;
  c.pr.answer = { state: 'MERGED', mergeCommit: { oid: SHA } };
  await c.sync();
  assert.ok(c.pushed.length > before);
  assert.deepEqual([c.first().status, c.first().run.mergedCommit], ['done', SHA]);
});

test('#797 a sync whose issue list fails never reads the PRs: the read that follows it does, and the card says why', async (t) => {
  const c = await seeded(t, new Error('gh: could not resolve host'));
  fs.writeFileSync(offline(), '');
  await assert.rejects(c.sync());
  assert.equal(c.reads.length, 0);
  // what the screen does after a failed sync (fronts/build/views/backlog/backlog.js sync)
  await c.opened();
  assert.deepEqual([c.first().status, c.first().pr.state], ['waiting_merge', 'unknown']);
});

test('#797 a workspace that opens settles its roadmaps without reading a PR: its starts never wait for gh', async (t) => {
  const c = await seeded(t, OPEN);
  const paused = { state: 'paused', simulated: true, pausedBy: c.itemId, error: `Run ${RUN} finished without merging: merge it, then skip the item` };
  roadmaps.writeRoadmap(c.ws.backlog, c.projectId, { ...roadmaps.readRoadmap(c.ws.backlog, c.projectId), ...paused });
  c.service.setWorkspace(c.ws);
  await until(() => roadmaps.readRoadmap(c.ws.backlog, c.projectId).state === 'running');
  assert.equal(c.reads.length, 0);
  assert.equal(c.first().status, 'waiting_merge');
});

test('#797 the merge commit stays on a done item through an edit of the roadmap', async (t) => {
  const c = await seeded(t, { state: 'MERGED', mergeCommit: { oid: SHA } });
  await c.api['roadmap:start']({ projectId: c.projectId, simulated: true });
  const before = roadmaps.readRoadmap(c.ws.backlog, c.projectId);
  assert.deepEqual([roadmaps.findItem(before, c.itemId).status, roadmaps.findItem(before, c.itemId).mergedCommit], ['done', SHA]);
  roadmaps.saveStages(c.ws.backlog, c.projectId, [...before.stages].reverse(), { issues: ISSUES });
  assert.equal(roadmaps.findItem(roadmaps.readRoadmap(c.ws.backlog, c.projectId), c.itemId).mergedCommit, SHA);
  const shown = c.api['roadmap:get']({ projectId: c.projectId }).stages.flatMap((s) => s.items).find((x) => x.id === c.itemId);
  assert.equal(shown.run.mergedCommit, SHA);
});
