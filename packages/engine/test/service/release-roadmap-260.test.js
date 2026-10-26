// Releases (#260): a simulated roadmap with a cut line after its first stage ("Release here",
// `release: { name: 'v1.0' }` on that stage) starts a run of the bundled release workflow
// (workflows/release.yaml, seeded into the workspace) once the stage is done, and the stage after
// the line waits for it: no run for its issues starts while the release run is going.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, roadmapProject, until, watchRuns } = require('./helpers');

const isRelease = (r) => /release/i.test(`${r.file || ''} ${r.workflow || ''}`);
const hasIssue = (r, n) => (r.issues || []).some((i) => i.number === n);

test('roadmap: a cut line starts the release run and the next stage waits for it (#260)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  // the bundled release workflow is seeded into the workspace like the other bundled workflows
  assert.ok(fs.existsSync(path.join(ws.workflows, 'release.yaml')), 'workflows/release.yaml is seeded into the workspace');
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'roadmap-release');
  const { gates, finished } = watchRuns(service);

  await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { name: 'Stage one', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }], release: { name: 'v1.0' } },
      { name: 'Stage two', items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
    ],
  });
  // #555: a stage's `release` is read as a release entry right after it
  assert.equal(api['roadmap:get']({ projectId: p.id }).stages[1]?.name, 'v1.0', 'the cut line is saved with the roadmap');
  await api['roadmap:start']({ projectId: p.id, simulated: true });

  await until(() => api['runs:active']().some((r) => hasIssue(r, 1)));
  const runId1 = api['runs:active']().find((r) => hasIssue(r, 1)).runId;
  await until(() => gates.has(runId1));
  api['approval:resolve']({ runId: runId1, id: gates.get(runId1), answer: true });
  await until(() => finished.has(runId1));

  // the release run starts once stage one is done
  await until(() => api['runs:active']().some(isRelease));
  const release = api['runs:active']().find(isRelease);
  assert.equal(release.file, 'release.yaml');

  // while it is going, nothing of stage two starts (give the roadmap a few ticks to misbehave)
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(api['runs:active']().some((r) => hasIssue(r, 2)), false);
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages[2].items[0].status, 'planned');
  assert.notEqual(roadmap.state, 'done');
});
