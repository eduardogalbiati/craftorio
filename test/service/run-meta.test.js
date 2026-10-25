const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../../src/domains/workspace/workspace');
const { createService } = require('../../src/service');
const { WORKFLOW, makeService, untilTrue } = require('./helpers');

// A mock run that opens a PR (output_schema with pr_url/pr_number), then waits at a gate so it is
// still active once the PR is known: #84.
const PR_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-pr
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: ci
    agent: a
    prompt: "report the PR"
    output_schema:
      type: object
      required: [pr_url, pr_number]
      properties:
        pr_url:    { type: string }
        pr_number: { type: integer }
  - id: review
    type: human_approval
    message: "Merge the PR?"
`;

// #84: the run lists show each run's PR (state icon, #n link) without opening GitHub for each one.
test('runs:list and runs:active expose the PR a mock run opened; a simulated run\'s state is "unknown" (never really read)', async (t) => {
  const { api, service } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-pr.yaml'), PR_WORKFLOW);
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn()); };
  const { runId } = await api['run:start']({ file: 'fixture-pr.yaml', inputs: {}, mock: true });
  await until(() => api['runs:active']().some((r) => r.runId === runId && r.waiting > 0));
  const active = api['runs:active']().find((r) => r.runId === runId);
  assert.deepEqual(active.pr, { number: 42, url: 'https://github.com/acme/app/pull/42', state: 'unknown', detail: 'simulated run: its PR is not real, so it is not read', checkedAt: null });
  const [gate] = active.gates;
  api['approval:resolve']({ runId, id: gate.approval_id, answer: true });
  await untilTrue(() => !service.isRunning());
  const run = (await api['runs:list']()).runs.find((r) => r.runId === runId);
  assert.equal(run.pr.number, 42);
  assert.equal(run.pr.url, 'https://github.com/acme/app/pull/42');
  assert.equal(run.pr.state, 'unknown');
});

test('runs:prState reads a run\'s PR with host.readPrJson (also for a mock run, when the host provides it)', async (t) => {
  const reads = [];
  const readPrJson = async (cmd, args) => { reads.push([cmd, ...args]); return { state: 'MERGED' }; };
  const { api, service } = makeService(t, { readPrJson });
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-pr.yaml'), PR_WORKFLOW);
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn()); };
  const { runId } = await api['run:start']({ file: 'fixture-pr.yaml', inputs: {}, mock: true });
  await until(() => api['runs:active']().some((r) => r.runId === runId && r.waiting > 0));
  const [gate] = api['runs:active']().find((r) => r.runId === runId).gates;
  api['approval:resolve']({ runId, id: gate.approval_id, answer: true });
  await untilTrue(() => !service.isRunning());
  const pr = await api['runs:prState']({ runId });
  assert.equal(pr.state, 'merged');
  assert.equal(reads[0][0], 'gh');
});

test('runs:setTitle persists the owner\'s title in meta.json (never touching events.jsonl), across a service restart, and emits run:meta', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-ws-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  const host = { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false };
  let service = createService({ host });
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-service.yaml'), WORKFLOW);
  service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') setImmediate(() => service.api['approval:resolve']({ id: ev.approval_id, answer: true })); });
  const metaEvents = [];
  service.events.on('run:meta', (m) => metaEvents.push(m));
  const { runId } = await service.api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  await untilTrue(() => !service.isRunning());

  const eventsPath = path.join(dir, 'runs', runId, 'events.jsonl');
  const before = fs.readFileSync(eventsPath, 'utf8');
  const out = service.api['runs:setTitle']({ runId, title: 'Notifications, 2nd try' });
  assert.equal(out.title, 'Notifications, 2nd try');
  assert.equal(fs.readFileSync(eventsPath, 'utf8'), before);
  assert.ok(metaEvents.some((m) => m.runId === runId && m.title === 'Notifications, 2nd try'));
  service.shutdown();

  service = createService({ host });
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  const run = (await service.api['runs:list']()).runs.find((r) => r.runId === runId);
  assert.equal(run.title, 'Notifications, 2nd try');
  assert.equal(run.customTitle, 'Notifications, 2nd try');
  service.shutdown();
});
