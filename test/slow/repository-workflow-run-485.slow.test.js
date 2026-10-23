// #485: one simulated run of an accepted repository workflow, loaded from the run's base checkout
// (the committed, accepted text), never from uncommitted edits in the project's folder.
// Acceptance test, written before the code. A whole simulated run: test/slow/ (docs/agents/testing.md).
//
// Spec (what this test assumes, as in test/service/workflows-repository-485.test.js):
//   api['workflows:list']({ projectId }) lists the repository workflow (origin 'repository', file, commit);
//   api['workflows:accept']({ projectId, file, commit }); api['run:start']({ file, projectId, mock: true })
//   runs it from the base checkout at the accepted commit.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService, until } =require('../service/helpers');
const { repoWithManifest, repoFlow } = require('../repo-workflow-fixtures-485');

test('#485 an accepted repository workflow runs from the base checkout, not from uncommitted edits', async (t) => {
  const { api, service } = makeService(t);
  const repo = repoWithManifest(t, { flow: repoFlow('committed') });
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  const list = await api['workflows:list']({ projectId: project.id });
  const item = list.find((w) => w.origin === 'repository' && (w.name === 'repo-flow' || /repo-flow/.test(String(w.file))));
  assert.ok(item, 'repo-flow is listed');
  assert.equal(item.commit, repo.head());
  await api['workflows:accept']({ projectId: project.id, file: item.file, commit: item.commit });
  // an edit nobody committed nor accepted
  repo.write({ '.multiagent/workflows/repo-flow.yaml': repoFlow('uncommitted') });

  const steps = [];
  const finished = new Map();
  service.events.on('run:event', (ev) => {
    if (ev.type === 'step.started') steps.push(ev.step_id);
    if (ev.type === 'workflow.finished') finished.set(ev.run_id, ev.status);
  });
  const { runId } = await api['run:start']({ file: item.file, projectId: project.id, mock: true });
  await until(() => finished.has(runId));
  assert.equal(finished.get(runId), 'success');
  assert.deepEqual(steps, ['committed'], 'the committed, accepted text ran');
});
