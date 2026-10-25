// #399: Undo of a stage's "Pause after current step" (roadmap:pause-stage → roadmap:undo) resumes the
// roadmap as Resume does (packages/engine/service/channels/roadmap.js resumePaused); refused once the roadmap no
// longer waits at that stage. Simulated roadmaps (test/service/helpers.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const svc = () => require('./service/helpers');
const hasIssue = (r, n) => (r.issues || []).some((i) => i.number === n);

// A simulated roadmap (issue numbers per stage), started, its first run waiting at its gate, then
// stage 1 paused after the current step; `pauseAfter`: #391's "Pause after this stage" asked first.
async function pausedAtGate(t, name, { stages = [[1]], pauseAfter = false } = {}) {
  const { ISSUE_WORKFLOW, makeService, roadmapProject, until, watchRuns } = svc();
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, stages.flat(), name);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 1, perProject: null, countSimulations: true } });
  const { gates, finished } = watchRuns(service);
  const it = (number) => ({ workflow: 'fixture-issue.yaml', number, mock: true });
  await api['roadmap:save']({ projectId: p.id, stages: stages.map((numbers) => ({ items: numbers.map(it) })) });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  const get = () => api['roadmap:get']({ projectId: p.id });
  const runOf = () => api['runs:active']().find((r) => hasIssue(r, 1));
  await until(() => !!runOf() && gates.has(runOf().runId));
  const run1 = runOf().runId;
  if (pauseAfter) {
    await api['roadmap:pause']({ projectId: p.id, after: 'stage' });
    assert.equal(get().scope?.pauseAfter, true, 'the after-stage pause is pending');
  }
  const out = await api['roadmap:pause-stage']({ projectId: p.id, stageId: get().stages[0].id });
  await until(() => finished.has(run1));
  return { api, p, get, runOf, until, edit: out.edit };
}

test('#399 roadmap:undo of a stage pause resumes the roadmap and its paused run', async (t) => {
  const { api, p, get, runOf, until, edit } = await pausedAtGate(t, 'pause-undo');
  assert.equal(get().state, 'paused');
  await api['roadmap:undo']({ projectId: p.id, editId: edit.id });
  assert.equal(get().state, 'running');
  await until(() => !!runOf());
  const versions = await api['roadmap:versions']({ projectId: p.id });
  assert.match(String(versions[0].label), /^Undid: Paused/);
});

test('#399 roadmap:undo of a stage pause keeps the roadmap simulated, as it ran before the pause', async (t) => {
  const { api, p, get, runOf, until, edit } = await pausedAtGate(t, 'pause-undo-sim');
  await api['roadmap:undo']({ projectId: p.id, editId: edit.id });
  assert.equal(get().simulated, true);
  await until(() => !!runOf());
  assert.equal(runOf().mock, true, 'the resumed run is a simulation');
});

test('#399 roadmap:undo of a stage pause taken while a #391 "Pause after this stage" waits resumes as the screen\'s Resume: never as "Run this stage"', async (t) => {
  const { api, p, get, edit } = await pausedAtGate(t, 'pause-undo-after', { stages: [[1], [2]], pauseAfter: true });
  assert.equal(get().state, 'paused');
  await api['roadmap:undo']({ projectId: p.id, editId: edit.id });
  const r = get();
  assert.equal(r.state, 'running');
  // the screen's Resume (RoadmapModel.scopedStage) runs the whole roadmap: no plain stage scope
  assert.equal(r.scope ?? null, null);
});

test('#399 roadmap:undo of a stage pause is refused once the roadmap no longer waits at the stage', async (t) => {
  const { api, p, get, edit } = await pausedAtGate(t, 'pause-undo-late');
  await api['roadmap:pause']({ projectId: p.id, stop: true });
  await assert.rejects(async () => api['roadmap:undo']({ projectId: p.id, editId: edit.id }), /no longer waits/);
  assert.equal(get().state, 'planned');
});
