// #435 acceptance: a refactor is planned in a disabled stage at the end of the roadmap, waiting for the
// owner (enabling it is his authorization). Since #730 a finding reaches it through "Create issue and
// prioritize" (architecture:createIssue with prioritize), no longer through Send to Refactor. Through makeService (simulation only, no
// network, no real CLI): the issue is filed through the host's `fileIssue(draft)` (it stands in for
// gh/glab, as host.readPrJson does for a run's PR), the project is a scratch git repository (the
// `before` score is read from its facts), the architecture reports are saved with
// packages/engine/domains/oracle/oracle-architecture.js saveReport. Observable state only: the roadmap file (packages/engine/domains/roadmap/roadmap.js
// readRoadmap), the proposals (refactor:proposals), the drafts the fake filer received.
// Tests first: the waiting stage, the host filer and `runNow` come with the change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const arch = require('@multiagent/engine/domains/oracle/oracle-architecture');
const proposals = require('@multiagent/engine/domains/refactor/refactor-proposals');
const roadmaps = require('@multiagent/engine/domains/roadmap/roadmap');
const { makeService, gitRepo, roadmapIssue } = require('@multiagent/engine/test/service/helpers');

const FIRST_ISSUE = 432;
const URL_OF = (n) => `https://github.com/o/r/issues/${n}`;

async function setup(t) {
  const drafts = [];
  let next = FIRST_ISSUE;
  const fileIssue = async (draft) => {
    drafts.push(draft);
    const number = next++;
    return { number, url: URL_OF(number) };
  };
  const { service, api } = makeService(t, { fileIssue });
  const ws = service.workspace();
  const { dir } = gitRepo(t);
  const p = await api['projects:create']({ name: 'demo', folder: dir });
  const numbers = [5, 6, 7, 8, 432, 433, 434, 435, 436];
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: numbers.map(roadmapIssue) }));
  const projectId = p.id;
  const refactorRoot = path.join(ws.root, 'refactor');
  const saveReport = (date, findings) => arch.saveReport(path.join(ws.root, 'architecture'), projectId, {
    date, head: null, branch: 'main', costUsd: 0, simulated: true, report: { summary: 'A small project.', areas: [], findings },
  }).id;
  const send = (reportId, findingIndex) => api['architecture:createIssue']({ projectId, reportId, findingIndex, prioritize: true });
  const roadmap = () => roadmaps.readRoadmap(ws.backlog, projectId);
  const listed = () => proposals.listProposals(refactorRoot, projectId);
  return { service, api, ws, projectId, refactorRoot, drafts, saveReport, send, roadmap, listed };
}

const finding = (kind, file, evidence = `Evidence of ${kind} in ${file}`) => ({
  kind, title: `${kind} in ${file}`, severity: 'high', files: [{ path: file }], evidence, refactor: `Split ${file}`,
});

// the waiting stages: disabled, named like "Refactor (waiting for your OK)"
const waitingStages = (r) => r.stages.filter((s) => s.disabled && /waiting/i.test(s.name || ''));
const numbersOf = (item) => (item.issues || []).map((i) => Number(i.number));
const stageNumbers = (s) => s.items.flatMap(numbersOf).sort((a, b) => a - b);
const indexOfIssue = (r, n) => r.stages.findIndex((s) => s.items.some((x) => numbersOf(x).includes(n)));

// a roadmap item as the roadmap file stores it
const item = (n, status) => ({
  id: `item-${n}`, workflow: 'fixture-issue.yaml', workflowName: 'Fixture', inputs: {}, mock: false, number: n, url: URL_OF(n), title: `Issue ${n}`, body: '',
  issues: [{ number: n, url: URL_OF(n), title: `Issue ${n}` }], status, runId: null, runs: [], error: null,
});

async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

test('#435 #730 Create issue and prioritize files the issue with the refactor label and plans it on the Refactor workflow in a disabled stage at the end', async (t) => {
  const w = await setup(t);
  const reportId = w.saveReport('2026-10-20T10:00:00.000Z', [finding('god-file', 'a.txt')]);
  const { filed } = await w.send(reportId, 0);
  assert.equal(w.drafts.length, 1, 'one issue filed');
  const args = w.drafts[0].command.args;
  assert.equal(args[args.indexOf('--label') + 1], 'refactor');
  assert.equal(filed.issue, FIRST_ISSUE);
  assert.deepEqual(w.listed(), [], 'no proposal made (#730)');
  const r = w.roadmap();
  const waiting = waitingStages(r);
  assert.equal(waiting.length, 1, 'one waiting stage');
  assert.equal(r.stages.indexOf(waiting[0]), r.stages.length - 1, 'the waiting stage is the last one');
  assert.equal(waiting[0].items.length, 1);
  const [x] = waiting[0].items;
  assert.equal(x.workflow, 'refactor.yaml');
  assert.deepEqual(numbersOf(x), [FIRST_ISSUE]);
  assert.equal(x.status, 'planned', 'nothing runs until the stage is enabled');
  assert.equal(x.runId ?? null, null);
});

test('#435 a second send joins the same waiting stage while it is disabled', async (t) => {
  const w = await setup(t);
  const reportId = w.saveReport('2026-10-20T10:00:00.000Z', [finding('god-file', 'a.txt'), finding('god-file', 'b.txt')]);
  await w.send(reportId, 0);
  await w.send(reportId, 1);
  const r = w.roadmap();
  assert.equal(r.stages.length, 1, 'no second stage');
  const waiting = waitingStages(r);
  assert.equal(waiting.length, 1);
  assert.deepEqual(stageNumbers(waiting[0]), [432, 433]);
});

test('#435 once the waiting stage is enabled, the next send opens a new waiting stage at the end', async (t) => {
  const w = await setup(t);
  const reportId = w.saveReport('2026-10-20T10:00:00.000Z', [finding('god-file', 'a.txt'), finding('god-file', 'b.txt')]);
  await w.send(reportId, 0);
  const before = w.roadmap();
  const enabled = before.stages.map((s) => ({ ...s, disabled: false }));
  roadmaps.saveStages(w.ws.backlog, w.projectId, enabled, { issues: [] });
  await w.send(reportId, 1);
  const r = w.roadmap();
  assert.equal(r.stages.length, 2);
  assert.equal(!!r.stages[0].disabled, false, 'the enabled stage stays enabled');
  assert.deepEqual(stageNumbers(r.stages[0]), [432]);
  const waiting = waitingStages(r);
  assert.equal(waiting.length, 1);
  assert.equal(r.stages.indexOf(waiting[0]), 1, 'the new waiting stage is the last one');
  assert.deepEqual(stageNumbers(waiting[0]), [433]);
});

test('#435 a stage the Product Owner adds later goes before the waiting stage, which stays last', async (t) => {
  const w = await setup(t);
  const reportId = w.saveReport('2026-10-20T10:00:00.000Z', [finding('god-file', 'a.txt')]);
  await w.send(reportId, 0);
  roadmaps.propose(w.ws.backlog, w.projectId, { stages: [{ name: 'Later', items: [{ workflow: 'fixture-issue.yaml', issues: [{ number: 6 }] }] }] }, { issues: [] });
  const r = w.roadmap();
  assert.equal(r.stages.length, 2);
  assert.equal(r.stages[0].name, 'Later');
  assert.deepEqual(stageNumbers(r.stages[0]), [6]);
  assert.equal(waitingStages(r).length, 1);
  assert.equal(r.stages.indexOf(waitingStages(r)[0]), 1, 'the waiting stage stays last');
});

test('#435 a proposal whose target file is already in an item of the waiting stage joins that item', async (t) => {
  const w = await setup(t);
  const reportId = w.saveReport('2026-10-20T10:00:00.000Z', [finding('god-file', 'a.txt'), finding('duplicated-rule', 'a.txt')]);
  await w.send(reportId, 0);
  const { filed: second } = await w.send(reportId, 1);
  const [waiting] = waitingStages(w.roadmap());
  assert.equal(waiting.items.length, 1, 'one item, one run for the file');
  assert.equal(numbersOf(waiting.items[0]).includes(Number(second.issue)), true);
});

test('#435 #730 the same finding from another analysis is recognised: one issue, one roadmap item', async (t) => {
  const w = await setup(t);
  const first = w.saveReport('2026-10-20T10:00:00.000Z', [finding('god-file', 'a.txt', 'First analysis: a.txt changes in every commit.')]);
  const second = w.saveReport('2026-10-21T10:00:00.000Z', [finding('god-file', 'a.txt', 'Second analysis: a.txt doubled in size.')]);
  const a = await w.send(first, 0);
  const b = await w.send(second, 0);
  assert.equal(w.drafts.length, 1, 'one issue filed');
  assert.equal(b.filed.issue, a.filed.issue);
  const [waiting] = waitingStages(w.roadmap());
  assert.equal(waiting.items.length, 1);
});

test('#435 #730 the report names where a filed finding went: its issue and its waiting stage', async (t) => {
  const w = await setup(t);
  const reportId = w.saveReport('2026-10-20T10:00:00.000Z', [finding('god-file', 'a.txt')]);
  await w.send(reportId, 0);
  const view = await w.api['architecture:report']({ projectId: w.projectId, reportId });
  const [f] = view.findings;
  assert.equal(f.filed?.issue, FIRST_ISSUE);
  assert.equal(f.filed?.issueUrl, URL_OF(FIRST_ISSUE));
  assert.equal(f.filed?.stage, 1, 'the 1-based number of the waiting stage');
  assert.equal(f.filed?.waiting, true);
});

test('#435 Add to roadmap now puts the item in the waiting stage by default', async (t) => {
  const w = await setup(t);
  const a = await w.api['refactor:add']({ projectId: w.projectId, target: 'src/part1.js', improvement: 'Split part 1', evidence: 'Part 1 changes with every fix' });
  proposals.updateProposal(w.refactorRoot, w.projectId, a.id, { issue: 5 });
  await w.api['refactor:addToRoadmap']({ projectId: w.projectId, id: a.id });
  const r = w.roadmap();
  const waiting = waitingStages(r);
  assert.equal(waiting.length, 1);
  assert.equal(r.stages.indexOf(waiting[0]), r.stages.length - 1);
  assert.deepEqual(stageNumbers(waiting[0]), [5]);
});

test('#435 Add to roadmap now with runNow lands after the stage in progress, never inside it, in an enabled stage', async (t) => {
  const w = await setup(t);
  const a = await w.api['refactor:add']({ projectId: w.projectId, target: 'src/part1.js', improvement: 'Split part 1', evidence: 'Part 1 changes with every fix' });
  proposals.updateProposal(w.refactorRoot, w.projectId, a.id, { issue: 7 });
  fs.writeFileSync(path.join(w.ws.backlog, `${w.projectId}.roadmap.json`), JSON.stringify({
    state: 'paused', simulated: false, error: null, pausedBy: null, scope: null, updatedAt: null,
    stages: [
      { id: 's1', name: 'One', note: '', items: [item(5, 'done')] },
      { id: 's2', name: 'Two', note: '', items: [item(6, 'done'), item(8, 'planned')] },
    ],
  }));
  await w.api['refactor:addToRoadmap']({ projectId: w.projectId, id: a.id, runNow: true });
  const r = w.roadmap();
  const progress = r.stages.findIndex((s) => s.id === 's2');
  assert.deepEqual(stageNumbers(r.stages[progress]), [6, 8], 'the stage in progress is unchanged');
  const at = indexOfIssue(r, 7);
  assert.equal(at > progress, true, `after the stage in progress (at ${at}, in progress ${progress})`);
  assert.equal(!!r.stages[at].disabled, false, 'run now: not the waiting stage');
});

// #654: adding stages keeps the roadmap's state, except a done roadmap given a stage that runs (planned again)
const doneRoadmap = (w) => fs.writeFileSync(path.join(w.ws.backlog, `${w.projectId}.roadmap.json`), JSON.stringify({
  state: 'done', simulated: false, error: null, pausedBy: null, scope: null, updatedAt: null,
  stages: [{ id: 's1', name: 'One', note: '', items: [item(5, 'done')] }],
}));

test('#654 the waiting stage added to a done roadmap leaves it done: a disabled stage runs nothing', async (t) => {
  const w = await setup(t);
  const a = await w.api['refactor:add']({ projectId: w.projectId, target: 'src/part1.js', improvement: 'Split part 1', evidence: 'Part 1 changes with every fix' });
  proposals.updateProposal(w.refactorRoot, w.projectId, a.id, { issue: 7 });
  doneRoadmap(w);
  await w.api['refactor:addToRoadmap']({ projectId: w.projectId, id: a.id });
  const r = w.roadmap();
  assert.equal(r.state, 'done');
  const waiting = waitingStages(r);
  assert.equal(waiting.length, 1);
  assert.equal(r.stages.indexOf(waiting[0]), r.stages.length - 1);
  assert.deepEqual(stageNumbers(waiting[0]), [7]);
});

test('#654 a run-now Refactor stage added at the end of a done roadmap makes it planned: it waits for Start', async (t) => {
  const w = await setup(t);
  const a = await w.api['refactor:add']({ projectId: w.projectId, target: 'src/part1.js', improvement: 'Split part 1', evidence: 'Part 1 changes with every fix' });
  proposals.updateProposal(w.refactorRoot, w.projectId, a.id, { issue: 7 });
  doneRoadmap(w);
  await w.api['refactor:addToRoadmap']({ projectId: w.projectId, id: a.id, runNow: true });
  const r = w.roadmap();
  assert.equal(r.state, 'planned');
  const at = indexOfIssue(r, 7);
  assert.equal(at, r.stages.length - 1);
  assert.equal(!!r.stages[at].disabled, false);
});

test('#435 the cadence keeps its rule: its item is not put in the waiting stage, which stays last', async (t) => {
  const w = await setup(t);
  const reportId = w.saveReport('2026-10-20T10:00:00.000Z', [finding('god-file', 'a.txt')]);
  await w.send(reportId, 0);
  const a = await w.api['refactor:add']({ projectId: w.projectId, target: 'src/part1.js', improvement: 'Split part 1', evidence: 'Part 1 changes with every fix' });
  await w.api['refactor:prioritize']({ projectId: w.projectId });
  proposals.updateProposal(w.refactorRoot, w.projectId, a.id, { issue: 5 });
  await w.api['refactor:setCadence']({ projectId: w.projectId, on: true, every: 3 });
  const finishedAt = new Date(Date.now() + 3000).toISOString();
  for (const runId of ['r1', 'r2', 'r3']) {
    const dir = path.join(w.ws.runs, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ run_id: runId, workflow: 'wf', status: 'success', mock: false, project_id: w.projectId, started_at: finishedAt, finished_at: finishedAt, sessions: [] }));
  }
  w.service.events.emit('run:event', { type: 'workflow.finished', run_id: 'r3', status: 'success', summary: { run_id: 'r3', workflow: 'wf', status: 'success', mock: false, project_id: w.projectId, finished_at: finishedAt } });
  assert.equal(await until(() => indexOfIssue(w.roadmap(), 5) >= 0), true, 'the cadence adds its item');
  const r = w.roadmap();
  const at = indexOfIssue(r, 5);
  assert.equal(!!r.stages[at].disabled, false, 'the cadence item is in an enabled stage');
  const waiting = waitingStages(r);
  assert.equal(waiting.length, 1);
  assert.equal(r.stages.indexOf(waiting[0]), r.stages.length - 1, 'the waiting stage stays last');
});

test('#435 a stage the owner saves after the waiting stage goes before it, and the next send joins the waiting stage', async (t) => {
  const w = await setup(t);
  const reportId = w.saveReport('2026-10-20T10:00:00.000Z', [finding('god-file', 'a.txt'), finding('god-file', 'b.txt')]);
  await w.send(reportId, 0);
  const stored = w.roadmap().stages;
  const added = { name: 'Owner stage', note: '', items: [{ workflow: 'fixture-issue.yaml', number: 6, title: 'Issue 6', issues: [{ number: 6, url: URL_OF(6), title: 'Issue 6' }], status: 'planned' }] };
  await w.api['roadmap:save']({ projectId: w.projectId, stages: [...stored, added] });
  await w.send(reportId, 1);
  const r = w.roadmap();
  assert.deepEqual(r.stages.map((s) => s.name), ['Owner stage', stored[0].name]);
  const waiting = waitingStages(r);
  assert.equal(waiting.length, 1, 'still one waiting stage');
  assert.equal(r.stages.indexOf(waiting[0]), 1, 'the waiting stage stays last');
  assert.deepEqual(stageNumbers(waiting[0]), [432, 433]);
});

test('#435 unchanged: Dismiss keeps its reason on a proposal', async (t) => {
  const w = await setup(t);
  const proposal = await w.api['refactor:add']({ projectId: w.projectId, target: 'src/part1.js', improvement: 'Split part 1', evidence: 'Part 1 changes with every fix' });
  const out = await w.api['refactor:dismiss']({ projectId: w.projectId, id: proposal.id, reason: 'Done by hand' });
  assert.equal(out.status, 'dismissed');
  assert.equal(out.dismissReason, 'Done by hand');
});
