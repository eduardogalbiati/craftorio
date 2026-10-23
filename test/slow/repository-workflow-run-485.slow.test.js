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
const fs = require('fs');
const path = require('path');
const { makeService, until } = require('../service/helpers');
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

// The Start drawer's pick (run:start with workspace: true) runs the workspace's workflow of that name
// even when the project's repository declares its own; without the flag the repository's wins.
async function sameNameInBoth(t) {
  const { api, service } = makeService(t);
  const repo = repoWithManifest(t, { flow: repoFlow('repository') });
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  const item = (await api['workflows:list']({ projectId: project.id })).find((w) => w.origin === 'repository' && w.name === 'repo-flow');
  assert.ok(item, 'repo-flow is listed');
  await api['workflows:accept']({ projectId: project.id, file: item.file, commit: item.commit });
  fs.writeFileSync(path.join(service.workspace().workflows, item.file), repoFlow('workspace'));
  const steps = new Map();
  const finished = new Map();
  service.events.on('run:event', (ev) => {
    if (ev.type === 'step.started') steps.set(ev.run_id, [...(steps.get(ev.run_id) || []), ev.step_id]);
    if (ev.type === 'workflow.finished') finished.set(ev.run_id, ev.status);
  });
  const run = async (opts) => {
    const { runId } = await api['run:start']({ file: item.file, projectId: project.id, mock: true, ...opts });
    await until(() => finished.has(runId));
    return { status: finished.get(runId), steps: steps.get(runId) || [] };
  };
  return { run };
}

test('#485 run:start with workspace: true runs the workspace\'s workflow of the repository workflow\'s name', async (t) => {
  const { run } = await sameNameInBoth(t);
  const r = await run({ workspace: true });
  assert.equal(r.status, 'success');
  assert.deepEqual(r.steps, ['workspace']);
});

test('#485 run:start without the workspace flag runs the project\'s repository workflow of that name', async (t) => {
  const { run } = await sameNameInBoth(t);
  const r = await run({});
  assert.equal(r.status, 'success');
  assert.deepEqual(r.steps, ['repository']);
});
