// max_total_cost_usd sees a Claude turn that used sub-agents (#277): its stream ends with two `result`
// events carrying the same US$ 15 total; the turn costs 15 (not 0), so a limit of US$ 10 stops the
// run before its next step.
// Seam: a WorkflowRun whose claude-code provider is node + test/fixtures/fake-claude-multi-result.js
// (calls no model), with the simulation-only guard lifted for this test like capabilities.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');

test('a turn with two result events whose first carries US$ 15 counts toward max_total_cost_usd: a limit of US$ 10 stops the run', { timeout: 60000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-limit-277-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // the "CLI" is node + a fake that calls no model: lift the simulation-only guard for this test
  const guard = process.env.CRAFTORIO_SIMULATION_ONLY;
  delete process.env.CRAFTORIO_SIMULATION_ONLY;
  t.after(() => { if (guard !== undefined) process.env.CRAFTORIO_SIMULATION_ONLY = guard; });
  const fake = path.join(__dirname, 'fixtures', 'fake-claude-multi-result.js').replace(/\\/g, '/');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'orchestrator:',
    '  limits: { max_total_cost_usd: 10 }',
    'providers:',
    `  claude: { type: claude-code, command: node, args: ["${fake}", "-p"] }`,
    'agents:',
    '  dev: { provider: claude, model: fake, session: ephemeral }',
    'steps:',
    '  - { id: work, agent: dev, prompt: "Do it." }',
    '  - { id: after, agent: dev, prompt: "Then this." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, runsDir: path.join(dir, 'runs') });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();

  const received = events.find((e) => e.type === 'session.message_received' && e.step_id === 'work');
  assert.ok(received, 'the work step\'s turn was received');
  assert.equal(received.cost_usd, 15, 'the turn records the US$ 15 of its first result event');
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.notEqual(finished.status, 'success');
  assert.match(finished.error || '', /Maximum cost exceeded \(US\$ 10\)/);
  const exceeded = events.find((e) => e.type === 'limit.exceeded' && e.limit === 'max_total_cost_usd');
  assert.ok(exceeded, 'a limit.exceeded event for max_total_cost_usd');
  assert.equal(exceeded.current, 15);
  assert.equal(events.some((e) => e.type === 'step.started' && e.step_id === 'after'), false, 'the next step never starts');
});
