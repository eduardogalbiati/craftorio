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

test('agents: the supervisor comes built in; removing an agent goes through the host trash', async (t) => {
  const { api, trashed, service } = makeService(t);
  assert.deepEqual(api['agents:list']().map((a) => a.id), ['supervisor']);
  const a = api['agents:create']({ name: 'Tester', prompt: 'You write tests.', skills: ['unit-test-writer-js'] });
  assert.equal(api['agents:save']({ id: a.id, data: { ...a, description: 'Writes tests' } }).description, 'Writes tests');
  await api['agents:remove'](a.id);
  assert.deepEqual(trashed, [path.join(service.workspace().agents, 'tester.json')]);
  await assert.rejects(async () => api['agents:remove']('supervisor'), /can't be removed/);
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

// A workflow that takes an issue: one agent turn, then a human gate.
const ISSUE_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-issue
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, required: true }
  language: { type: string, enum: [js, go], default: js }
  issue: { type: string, default: "" }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "{{ inputs.task }}"
  - id: review
    type: human_approval
    message: "Accept the work?"
`;

test('backlog: assigned issues run one at a time, each run records its issue', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-backlog-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  api['projects:update']({ id: p.id, patch: { repo: 'https://github.com/o/r' } });
  const issue = (number, state = 'open') => ({ number, title: `Issue ${number}`, state, url: `https://github.com/o/r/issues/${number}`, body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 } });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [issue(1), issue(2), issue(3, 'closed')] }));

  const gates = [];
  const finished = [];
  service.events.on('run:event', (ev) => {
    if (ev.type === 'approval.requested') gates.push(ev.approval_id);
    if (ev.type === 'workflow.finished') finished.push(ev);
  });
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); assert.ok(fn()); };

  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [3], workflow: 'fixture-issue.yaml', mock: true }), /at least one open issue/);
  await assert.rejects(api['backlog:assign']({ projectId: p.id, numbers: [1], workflow: 'fixture-service.yaml', mock: true }), /no task input/);

  let data = await api['backlog:assign']({ projectId: p.id, numbers: [2, 1], workflow: 'fixture-issue.yaml', inputs: { language: 'go' }, mock: true });
  assert.ok(service.isRunning());
  assert.deepEqual(data.queue.items.map((x) => x.number), [1]); // #2, selected first, started right away
  assert.deepEqual(data.queue.inputs, { 'fixture-issue.yaml': { language: 'go' } });

  await until(() => gates.length === 1);
  data = api['backlog:get']({ projectId: p.id });
  const by = () => Object.fromEntries(data.issues.map((i) => [i.number, i]));
  assert.equal(by()[2].column, 'waiting');
  assert.equal(by()[1].column, 'in_progress');
  assert.equal(by()[1].queued.position, 1);
  assert.equal(by()[3].column, 'done');

  api['approval:resolve']({ id: gates[0], answer: true });
  await until(() => gates.length === 2); // the dispatcher started #1 after #2 finished
  api['approval:resolve']({ id: gates[1], answer: true });
  await until(() => finished.length === 2 && !service.isRunning());

  data = api['backlog:get']({ projectId: p.id });
  assert.deepEqual(data.queue.items, []);
  assert.deepEqual([by()[1].column, by()[2].column], ['done', 'done']);
  const list = api['runs:list']().runs;
  const run2 = list.find((r) => r.issue?.number === 2);
  assert.deepEqual(run2.issue, { number: 2, url: 'https://github.com/o/r/issues/2', title: 'Issue 2' });
  const started = JSON.parse(fs.readFileSync(path.join(run2.runDir, 'events.jsonl'), 'utf8').split('\n')[0]);
  assert.equal(started.inputs.issue, 'https://github.com/o/r/issues/2');
  assert.equal(started.inputs.language, 'go');
  assert.equal(started.inputs.repo_path, folder);
  assert.match(started.inputs.task, /^Issue 2\n\nIssue: https:\/\/github\.com\/o\/r\/issues\/2/);
});

test('backlog: queues are paused when the workspace opens; a start that fails pauses the queue', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const backlog = require('../src/backlog');
  backlog.enqueue(ws.backlog, 'demo', { issues: [{ number: 1, url: 'u', title: 't' }], workflow: 'missing.yaml' });
  service.setWorkspace(ws);
  assert.equal(backlog.readQueue(ws.backlog, 'demo').paused, true);

  await api['backlog:pause']({ projectId: 'demo', paused: false }).catch(() => {}); // no synced backlog: returns null
  const q = backlog.readQueue(ws.backlog, 'demo');
  assert.equal(q.paused, true); // the project does not exist: the start failed
  assert.match(q.error, /Could not start #1/);
  assert.equal(q.items.length, 1);
  assert.ok(!service.isRunning());
});
