// #797 internals through the service: a read of a waiting PR tells the screen when it changes what the card
// says (nothing else redraws it with no run active), and the merge commit outlives an edit of the roadmap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject, until } = require('./helpers');

const RUN = '20261106-130000-pr797read';
const SHA = '797ccc0000000000000000000000000000000003';
const OPEN = { state: 'OPEN', isDraft: false, mergeable: 'UNKNOWN', statusCheckRollup: [] };
const ISSUES = [roadmapIssue(1), roadmapIssue(2)];

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
  return { api, ws, projectId: p.id, itemId, pr, reads, pushed };
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
