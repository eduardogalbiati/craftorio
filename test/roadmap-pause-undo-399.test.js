// #399: Undo of a stage's "Pause after current step" (roadmap:pause-stage → roadmap:undo) resumes the
// roadmap as Resume does (src/service/channels/roadmap.js resumePaused); refused once the roadmap no
// longer waits at that stage. Simulated roadmaps (test/service/helpers.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const svc = () => require('./service/helpers');
const hasIssue = (r, n) => (r.issues || []).some((i) => i.number === n);

async function pausedAtGate(t, name) {
  const { ISSUE_WORKFLOW, makeService, roadmapProject, until, watchRuns } = svc();
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], name);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 1, perProject: null, countSimulations: true } });
  const { gates, finished } = watchRuns(service);
  await api['roadmap:save']({ projectId: p.id, stages: [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  const get = () => api['roadmap:get']({ projectId: p.id });
  const runOf = () => api['runs:active']().find((r) => hasIssue(r, 1));
  await until(() => !!runOf() && gates.has(runOf().runId));
  const run1 = runOf().runId;
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

test('#399 roadmap:undo of a stage pause is refused once the roadmap no longer waits at the stage', async (t) => {
  const { api, p, get, edit } = await pausedAtGate(t, 'pause-undo-late');
  await api['roadmap:pause']({ projectId: p.id, stop: true });
  await assert.rejects(async () => api['roadmap:undo']({ projectId: p.id, editId: edit.id }), /no longer waits/);
  assert.equal(get().state, 'planned');
});
