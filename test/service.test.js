const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../src/workspace');
const { createService } = require('../src/service');

// A mock run with one agent turn and a human gate, written into the workspace's workflows.
const WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-service
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
  - id: review
    type: human_approval
    message: "Accept the work?"
`;

// The engine service with a temporary workspace and a host that records what it was asked to do.
function makeService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-ws-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const trashed = [];
  const service = createService({ host: { trashItem: async (p) => { trashed.push(p); }, appVersion: '9.9.9', isPackaged: false } });
  t.after(() => service.shutdown());
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-service.yaml'), WORKFLOW);
  return { service, api: service.api, trashed };
}

test('the service needs no Electron and refuses calls before a workspace is open', async () => {
  const service = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false } });
  assert.throws(() => service.api['projects:list'](), /No workspace is open/);
  assert.ok(!Object.keys(require.cache).some((k) => /[\\/]node_modules[\\/]electron[\\/]/.test(k)));
});

test('seeds the bundled workflows and answers the UI channels', async (t) => {
  const { api } = makeService(t);
  const files = api['workflows:list']().map((w) => w.file);
  assert.ok(files.includes('software-development.yaml'));
  assert.ok(files.includes('fixture-service.yaml'));
  assert.equal(api['app:info']().version, '9.9.9');

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-project-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  assert.deepEqual(api['projects:list']().map((x) => x.id), [p.id]);
  assert.deepEqual(api['projects:runs']({ id: p.id }).runs, []);
});

test('deleting a skill goes through the host trash', async (t) => {
  const { api, trashed, service } = makeService(t);
  await api['skills:remove']('../../somewhere/my-skill');
  assert.deepEqual(trashed, [path.join(service.workspace().skills, 'my-skill')]);
});

test('runs a mock workflow, pushes its events and resolves the human gate', async (t) => {
  const { service, api } = makeService(t);
  const events = [];
  const finished = new Promise((resolve) => {
    service.events.on('run:event', (ev) => {
      events.push(ev.type);
      // the engine registers the approval right after emitting the request
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer: true }));
      if (ev.type === 'workflow.finished') resolve(ev);
    });
  });
  const { runId, runDir } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.ok(service.isRunning());
  assert.equal(service.currentRunDir(), runDir);
  await assert.rejects(api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true }), /already running/);

  const end = await finished;
  assert.equal(end.status, 'success');
  assert.ok(events.includes('step.finished') && events.includes('approval.resolved'));
  assert.ok(fs.existsSync(path.join(runDir, 'events.jsonl')));
  assert.equal(api['runs:list']().runs[0].runId, runId);
});

test('the workspace cannot change while a run is in progress', async (t) => {
  const { service, api } = makeService(t);
  // lets the run finish before the temporary workspace is removed
  const finished = new Promise((resolve) => service.events.on('run:event', (ev) => {
    if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer: true }));
    if (ev.type === 'workflow.finished') resolve();
  }));
  await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  assert.throws(() => service.setWorkspace(service.workspace()), /while a workflow is running/);
  await finished;
});

test('a run starts only if the host allows it (account / free trial)', async (t) => {
  const { service, api } = makeService(t);
  const asked = [];
  const blocked = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false, assertCanRun: async (o) => { asked.push(o); throw new Error('Your 7-day free trial has ended.'); } } });
  blocked.setWorkspace(service.workspace());
  await assert.rejects(blocked.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: false }), /trial has ended/);
  assert.deepEqual(asked, [{ mock: false }]);
  assert.equal(blocked.isRunning(), false);
  assert.deepEqual(api['runs:list']().runs, []);
});
