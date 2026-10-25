const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { IdleWatch } = require('@multiagent/engine/engine/idle');
const { WorkflowRun } = require('@multiagent/engine/engine/workflow');
const { RunChatModel } = require('../renderer/views/runchat/run-chat-model.js');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const FIXTURE = path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'test', 'fixtures', 'handoff.yaml');
const VERDICTS = { verdict: ['approved'] };

// A clock the test moves by hand.
function clock() {
  let t = 1000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}
const POLL = { kind: 'tool_call', id: 'b1', name: 'Bash', input: { command: 'until grep -q "duration_ms" out.log; do sleep 5; done' } };

test('idle watch: warns once when a command has been waiting silently past the threshold', () => {
  const c = clock();
  const w = new IdleWatch({ idleMs: 5 * 60e3, now: c.now });
  w.item({ kind: 'text', text: 'Running the suite.' });
  w.item(POLL);
  c.advance(4 * 60e3);
  assert.equal(w.check(), null);
  c.advance(60e3);
  assert.deepEqual(w.check(), { idle_ms: 5 * 60e3, tool: 'Bash', command: 'until grep -q "duration_ms" out.log; do sleep 5; done' });
  c.advance(60e3);
  assert.equal(w.check(), null, 'one warning per silence');
});

test('idle watch: a silent model with no command waiting is not idle', () => {
  const c = clock();
  const w = new IdleWatch({ idleMs: 60e3, now: c.now });
  w.item({ kind: 'thinking', text: 'Planning.' });
  c.advance(10 * 60e3);
  assert.equal(w.check(), null);
  w.item({ kind: 'tool_call', id: 'x', name: 'Bash', input: { command: 'npm test' } });
  w.item({ kind: 'tool_result', id: 'x', output: 'ok' });
  c.advance(10 * 60e3);
  assert.equal(w.check(), null);
});

test('idle watch: new output restarts the silence, so a second stall warns again', () => {
  const c = clock();
  const w = new IdleWatch({ idleMs: 60e3, now: c.now });
  w.item(POLL);
  c.advance(60e3);
  assert.ok(w.check());
  w.item({ kind: 'stderr', text: 'still running' });
  c.advance(30e3);
  assert.equal(w.check(), null);
  c.advance(30e3);
  assert.equal(w.check()?.idle_ms, 60e3);
});

test('idle watch: a stall is no longer current once the command shows output, finishes or the turn ends', () => {
  const c = clock();
  const w = new IdleWatch({ idleMs: 60e3, now: c.now });
  w.item(POLL);
  c.advance(60e3);
  const stall = w.check();
  c.advance(5 * 60e3);
  assert.equal(w.stillStalled(stall), true, 'still silent');
  w.item({ kind: 'stderr', text: 'tests passed' });
  assert.equal(w.stillStalled(stall), false, 'output arrived');

  c.advance(60e3);
  const second = w.check();
  assert.equal(w.stillStalled(stall), false, 'an older stall stays stale');
  assert.equal(w.stillStalled(second), true);
  w.item({ kind: 'tool_result', id: 'b1', output: 'done' });
  assert.equal(w.stillStalled(second), false, 'the command finished');

  w.item(POLL);
  c.advance(60e3);
  const third = w.check();
  w.finish();
  assert.equal(w.stillStalled(third), false, 'the turn ended');
  assert.equal(w.stillStalled(null), false);
});

test('idle watch: a threshold of 0 never warns', () => {
  const c = clock();
  const w = new IdleWatch({ idleMs: 0, now: c.now });
  w.item(POLL);
  c.advance(60 * 60e3);
  assert.equal(w.check(), null);
});

test('idle watch: splits a turn into active, waiting and stalled time', () => {
  const c = clock();
  const w = new IdleWatch({ idleMs: 5 * 60e3, now: c.now });
  c.advance(20e3);                    // the model thinks for 20 s
  w.item(POLL);
  c.advance(10 * 60e3);               // the command waits 10 min with no output (5 of them past the threshold)
  w.item({ kind: 'tool_result', id: 'b1', output: 'Command timed out' });
  c.advance(40e3);                    // the model writes its answer
  assert.deepEqual(w.finish(), { duration_ms: 11 * 60e3, active_ms: 60e3, waiting_ms: 10 * 60e3, stalled_ms: 5 * 60e3 });
});

test('idle watch: a turn that ends while a command is still open counts the wait up to the end', () => {
  const c = clock();
  const w = new IdleWatch({ idleMs: 60e3, now: c.now });
  w.item({ kind: 'tool_call', id: 'a', name: 'Bash', input: { command: 'npm test' } });
  w.item({ kind: 'tool_call', id: 'b', name: 'Read', input: { file_path: 'x' } });
  c.advance(30e3);
  w.item({ kind: 'tool_result', id: 'b', output: '' });
  c.advance(90e3);
  assert.deepEqual(w.finish(), { duration_ms: 120e3, active_ms: 0, waiting_ms: 120e3, stalled_ms: 30e3 });
});

async function runFixture(t, { withSupervisor, ...opts }) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  let file = FIXTURE;
  if (withSupervisor) {
    // the same workflow with the run supervisor on
    file = path.join(runsDir, 'handoff-supervised.yaml');
    fs.writeFileSync(file, `${fs.readFileSync(FIXTURE, 'utf8')}\norchestrator:\n  supervisor:\n    model: mock-model\n    max_total: 4\n`);
  }
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, ...opts });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  return { events, finished };
}

test('engine: an agent stuck waiting on a command is warned about in the run and the run chat, and its step shows the wait', { timeout: 30000 }, async (t) => {
  const { events, finished } = await runFixture(t, { idleWarnMs: 150, mockSequences: { ...VERDICTS, slow_tools: { develop: 600 } } });

  const warns = events.filter((e) => e.type === 'log' && e.kind === 'agent_idle');
  assert.equal(warns.length, 1);
  assert.equal(warns[0].level, 'warn');
  assert.equal(warns[0].step_id, 'develop');
  assert.equal(warns[0].tool, 'Bash');
  assert.match(warns[0].command, /until grep -q "duration_ms"/);
  assert.match(warns[0].message, /no output for .* min in develop while waiting on Bash: until grep/);

  const { develop, review } = finished.summary.timing.steps;
  assert.ok(develop.waiting_ms >= 500, `develop waited ${develop.waiting_ms} ms`);
  assert.ok(develop.stalled_ms >= 300, `develop stalled ${develop.stalled_ms} ms`);
  assert.equal(review.stalled_ms, 0);
  assert.ok(finished.summary.timing.duration_ms >= develop.duration_ms + review.duration_ms);

  const model = new RunChatModel();
  for (const ev of events) model.apply(ev);
  assert.ok(model.items.some((it) => it.kind === 'system' && it.level === 'warn' && /no output for .* while waiting on Bash/.test(it.text)));
});

test('engine: an idle agent wakes the supervisor with the command it waits on; "wait" lets the turn finish', { timeout: 30000 }, async (t) => {
  const { events } = await runFixture(t, { withSupervisor: true, idleWarnMs: 150, mockSequences: { ...VERDICTS, slow_tools: { develop: 600 } } });

  const started = events.filter((e) => e.type === 'supervisor.started');
  assert.equal(started.length, 1);
  assert.equal(started[0].step_id, 'develop');
  assert.equal(started[0].kind, 'idle');
  const decision = events.find((e) => e.type === 'supervisor.decision');
  assert.equal(decision.action, 'wait');
  assert.match(decision.command, /until grep -q "duration_ms"/);
  // the supervisor was told which command is waiting
  const asked = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'develop:supervisor');
  assert.match(asked?.prompt, /until grep -q "duration_ms"/);
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'develop').length, 1);
});

test('engine: when the supervisor interrupts an idle agent, the turn stops and the step runs again with its instruction', { timeout: 30000 }, async (t) => {
  const { events } = await runFixture(t, {
    withSupervisor: true, idleWarnMs: 150,
    mockSequences: { ...VERDICTS, slow_tools: { develop: 5000 }, action: ['interrupt', 'wait'] },
  });

  const decisions = events.filter((e) => e.type === 'supervisor.decision');
  assert.deepEqual(decisions.map((d) => d.action), ['interrupt', 'wait']);
  assert.ok(events.some((e) => e.type === 'log' && e.kind === 'agent_interrupted' && e.step_id === 'develop'));
  const developVisits = events.filter((e) => e.type === 'step.started' && e.step_id === 'develop');
  assert.equal(developVisits.length, 2);
  const retryPrompt = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop')[1];
  assert.match(retryPrompt?.prompt, /Note from the run supervisor/);
});

test('engine: no idle warning when commands answer in time or the warning is off', { timeout: 30000 }, async (t) => {
  const quick = await runFixture(t, { idleWarnMs: 5000, mockSequences: VERDICTS });
  assert.equal(quick.events.filter((e) => e.kind === 'agent_idle').length, 0);
  const off = await runFixture(t, { idleWarnMs: 0, mockSequences: { ...VERDICTS, slow_tools: { develop: 300 } } });
  assert.equal(off.events.filter((e) => e.kind === 'agent_idle').length, 0);
  assert.equal(off.finished.summary.timing.stalled_ms, 0);
});
