// #357: the Refactor tab's cadence and roadmap items through the service (simulation only, no network,
// no real CLI). The cadence listens to run:event: after every X real finished runs of the project the
// top ranked proposal with an issue joins the roadmap on the Refactor workflow and the count restarts;
// a simulated run never counts; with nothing ready nothing is added. "Add to roadmap now" takes a
// proposal whose earlier item failed and was parked, and refuses one still planned. "File as issue"
// in simulation is a preview that carries the `refactor` label and names the Refactor workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const proposals = require('@craftorio/engine/domains/refactor/refactor-proposals');
const roadmaps = require('@craftorio/engine/domains/roadmap/roadmap');
const { makeService, roadmapProject } = require('@craftorio/engine/test/service/helpers');

const ISSUE = 5;

async function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [ISSUE, 6], 'refactor357');
  const root = path.join(ws.root, 'refactor');
  const add = (n) => api['refactor:add']({ projectId: p.id, target: `src/part${n}.js`, improvement: `Split part ${n}`, evidence: `Part ${n} changes with every fix` });
  return { service, api, ws, projectId: p.id, root, add };
}

// a finished run recorded in the workspace's runs folder, as the engine leaves it
function writeRun(ws, runId, { projectId, mock, finishedAt }) {
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'wf', status: 'success', mock, project_id: projectId,
    started_at: finishedAt, finished_at: finishedAt, sessions: [],
  }));
}

const later = (s) => new Date(Date.now() + s * 1000).toISOString();
const finished = (runId, projectId, mock, finishedAt) => ({
  type: 'workflow.finished', run_id: runId, status: 'success',
  summary: { run_id: runId, workflow: 'wf', status: 'success', mock, project_id: projectId, finished_at: finishedAt },
});

const refactorItems = (ws, projectId) => roadmaps.readRoadmap(ws.backlog, projectId).stages
  .flatMap((s) => s.items).filter((x) => x.workflow === 'refactor.yaml')
  .map((x) => (x.issues || []).map((i) => i.number)[0] ?? x.number);

async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// a ranked proposal filed as issue #ISSUE (the filing itself needs a tracker)
async function readyProposal(api, root, projectId, add) {
  const a = await add(1);
  await api['refactor:prioritize']({ projectId });
  proposals.updateProposal(root, projectId, a.id, { issue: ISSUE });
  return a;
}

test('#357 after X real finished runs of the project the top proposal with an issue joins the roadmap and the count restarts', async (t) => {
  const { service, api, ws, projectId, root, add } = await setup(t);
  await readyProposal(api, root, projectId, add);
  const on = await api['refactor:setCadence']({ projectId, on: true, every: 3 });
  writeRun(ws, 'r1', { projectId, mock: false, finishedAt: later(1) });
  writeRun(ws, 'r2', { projectId, mock: false, finishedAt: later(2) });
  writeRun(ws, 'r3', { projectId, mock: false, finishedAt: later(3) });
  service.events.emit('run:event', finished('r3', projectId, false, later(3)));
  assert.equal(await until(() => refactorItems(ws, projectId).length > 0), true, 'a refactor item joins the roadmap');
  assert.deepEqual(refactorItems(ws, projectId), [ISSUE]);
  assert.equal(await until(() => {
    const raw = JSON.parse(fs.readFileSync(path.join(root, projectId, 'cadence.json'), 'utf8'));
    return raw.since !== on.since;
  }), true, 'the cadence count restarts after the item is added');
  const after = await api['refactor:cadence']({ projectId });
  assert.equal(after.on, true);
  assert.equal(after.every, 3);
});

test('#357 simulated runs never count for the cadence', async (t) => {
  const { service, api, ws, projectId, root, add } = await setup(t);
  await readyProposal(api, root, projectId, add);
  await api['refactor:setCadence']({ projectId, on: true, every: 3 });
  for (const id of ['m1', 'm2', 'm3']) writeRun(ws, id, { projectId, mock: true, finishedAt: later(1) });
  const view = await api['refactor:cadence']({ projectId });
  assert.equal(view.nextIn, 3);
  service.events.emit('run:event', finished('m3', projectId, true, later(1)));
  await pause(2500);
  assert.deepEqual(refactorItems(ws, projectId), []);
});

test('#357 the runs of another project never count for the cadence', async (t) => {
  const { api, ws, projectId } = await setup(t);
  await api['refactor:setCadence']({ projectId, on: true, every: 3 });
  writeRun(ws, 'o1', { projectId: 'someone-else', mock: false, finishedAt: later(1) });
  writeRun(ws, 'o2', { projectId, mock: false, finishedAt: later(1) });
  const view = await api['refactor:cadence']({ projectId });
  assert.equal(view.nextIn, 2);
});

test('#357 a due cadence with no proposal filed as an issue adds nothing and keeps counting', async (t) => {
  const { service, api, ws, projectId, root, add } = await setup(t);
  await add(1);
  await api['refactor:prioritize']({ projectId });
  const on = await api['refactor:setCadence']({ projectId, on: true, every: 3 });
  for (const id of ['r1', 'r2', 'r3']) writeRun(ws, id, { projectId, mock: false, finishedAt: later(1) });
  const view = await api['refactor:cadence']({ projectId });
  assert.deepEqual([view.nextIn, view.ready], [0, false]);
  service.events.emit('run:event', finished('r3', projectId, false, later(1)));
  await pause(2500);
  assert.deepEqual(refactorItems(ws, projectId), []);
  const raw = JSON.parse(fs.readFileSync(path.join(root, projectId, 'cadence.json'), 'utf8'));
  assert.equal(raw.since, on.since);
});

test('#357 Add to roadmap now puts a filed proposal on the Refactor workflow and refuses it while it is planned', async (t) => {
  const { api, ws, projectId, root, add } = await setup(t);
  const a = await readyProposal(api, root, projectId, add);
  const out = await api['refactor:addToRoadmap']({ projectId, id: a.id });
  assert.equal(typeof out.stage, 'number');
  assert.deepEqual(refactorItems(ws, projectId), [ISSUE]);
  const [listed] = await api['refactor:proposals']({ projectId });
  assert.deepEqual([listed.issue, listed.issueState, listed.roadmapStatus], [ISSUE, 'open', 'planned']);
  await assert.rejects(async () => api['refactor:addToRoadmap']({ projectId, id: a.id }));
  assert.deepEqual(refactorItems(ws, projectId), [ISSUE]);
});

test('#357 Add to roadmap now takes a proposal whose earlier item failed and was parked', async (t) => {
  const { api, ws, projectId, root, add } = await setup(t);
  const a = await readyProposal(api, root, projectId, add);
  const url = `https://github.com/o/r/issues/${ISSUE}`;
  const item = {
    id: 'item-1', workflow: 'refactor.yaml', workflowName: 'Refactor', inputs: {}, mock: false, number: ISSUE, url, title: `Issue ${ISSUE}`, body: '',
    issues: [{ number: ISSUE, url, title: `Issue ${ISSUE}` }], status: 'failed', parked: { at: '2026-10-01T00:00:00.000Z', gate: 'review' }, runId: 'gone', runs: ['gone'], error: 'Rejected at the gate',
  };
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.roadmap.json`), JSON.stringify({ state: 'planned', simulated: false, error: null, pausedBy: null, scope: null, updatedAt: null, stages: [{ id: 's1', name: '', note: '', items: [item] }] }));
  await api['refactor:addToRoadmap']({ projectId, id: a.id });
  assert.equal(refactorItems(ws, projectId).length, 2);
});

test('#357 File as issue in simulation previews an issue with the refactor label that names the Refactor workflow', async (t) => {
  const { api, projectId, add } = await setup(t);
  const a = await add(1);
  const out = await api['refactor:file']({ projectId, id: a.id });
  assert.equal(out.preview, true);
  assert.match(out.command, /refactor/);
  assert.match(out.command, /label/i);
  assert.match(out.body, /workflows\/refactor\.yaml/);
  assert.match(out.body, /src\/part1\.js/);
  const [listed] = await api['refactor:proposals']({ projectId });
  assert.equal(listed.issue ?? null, null);
});
