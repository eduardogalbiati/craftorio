// Supervisor on call (#41): before a run stops to ask the person about a problem, the AI supervisor
// tries to solve it first. Covers:
// - packages/engine/engine/workflow.js: `kind: escalation` and `orchestrator.supervisor.on_call`/`max_cost_usd`/
//   `stall` validation (loadWorkflow); escalation gates and exhausted loops calling the supervisor
//   before the gate opens (superviseEscalation, noteExhausted/superviseExhausted); the same answer
//   or refused tools in a row waking it (checkStalls/superviseStall); a step running far longer than
//   usual waking it while it runs (watchSlowStep/superviseSlow); its limits (max_interventions,
//   max_cost_usd) and that it never answers a decision gate.
// - packages/engine/domains/supervisor/supervisor.js: onCallPrompt, onCallSchema.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, repeatKey } = require('../../engine/workflow');
const supervisor = require('../../domains/supervisor/supervisor');
const root = path.join(__dirname, '..', '..', '..', '..');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = process.env.MULTIAGENT_MOCK_DELAY_SCALE || '0.05';
process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models

function writeTmp(yaml) {
  const file = path.join(os.tmpdir(), `wf-oncall-${process.pid}-${Math.random().toString(36).slice(2)}.yaml`);
  fs.writeFileSync(file, yaml);
  return file;
}

// ---- loadWorkflow: kind, on_call, max_cost_usd, stall --------------------------------------------

test('loadWorkflow validates kind: a decision or escalation gate, only on human_approval, never with check', () => {
  const base = (extra) => `agents: { a: { provider: claude, model: m } }\nsteps:\n${extra}`;
  assert.throws(
    () => loadWorkflow(writeTmp(base('  - id: s1\n    agent: a\n    prompt: x\n    kind: escalation\n'))),
    /Step "s1": kind must be one of decision, escalation, on a human_approval step\./,
  );
  assert.throws(
    () => loadWorkflow(writeTmp(base('  - id: s1\n    type: human_approval\n    message: x\n    kind: urgent\n    transitions: [{ when: approved, goto: end }]\n'))),
    /kind must be one of decision, escalation/,
  );
  assert.throws(
    () => loadWorkflow(writeTmp(base(
      '  - id: s1\n    type: human_approval\n    message: x\n    kind: escalation\n    check: { probe: pr_mergeable, target: "x" }\n    transitions: [{ when: approved, goto: end }]\n',
    ))),
    /a gate with check \(a merge\) is a decision, not an escalation/,
  );
  assert.doesNotThrow(() => loadWorkflow(writeTmp(base(
    '  - id: s1\n    type: human_approval\n    message: x\n    kind: escalation\n    transitions: [{ when: approved, goto: end }]\n',
  ))));
});

test('loadWorkflow validates orchestrator.supervisor.on_call, max_cost_usd and stall thresholds', () => {
  const wf = (sup) => `agents: { a: { provider: claude, model: m } }\norchestrator:\n  supervisor: { enabled: true${sup} }\nsteps:\n  - id: s1\n    agent: a\n    prompt: x\n`;
  assert.throws(() => loadWorkflow(writeTmp(wf(', on_call: "yes"'))), /orchestrator\.supervisor\.on_call must be true or false\./);
  assert.throws(() => loadWorkflow(writeTmp(wf(', max_cost_usd: -1'))), /orchestrator\.supervisor\.max_cost_usd must be a number of US\$ \(0 or more\)\./);
  assert.throws(() => loadWorkflow(writeTmp(wf(', stall: { same_output: "lots" }'))), /orchestrator\.supervisor\.stall\.same_output must be a number \(0 = off\)\./);
  assert.throws(() => loadWorkflow(writeTmp(wf(', stall: { slow_factor: -1 }'))), /orchestrator\.supervisor\.stall\.slow_factor must be a number \(0 = off\)\./);
  assert.doesNotThrow(() => loadWorkflow(writeTmp(wf(', on_call: false, max_cost_usd: 5, stall: { same_output: 2, slow_factor: 2 }'))));
});

// ---- packages/engine/domains/supervisor/supervisor.js: onCallPrompt, onCallSchema ------------------------------------------------

test('onCallSchema: steps is free text with none visited yet, route only for a gate that offers one', () => {
  const free = supervisor.onCallSchema({ actions: ['continue', 'retry'], steps: [], routes: [] });
  assert.deepEqual(free.properties.step, { type: 'string' });
  assert.ok(!('route' in free.properties));
  assert.deepEqual(free.required, ['explanation', 'action']);

  const withSteps = supervisor.onCallSchema({ actions: supervisor.ESCALATION_ACTIONS, steps: ['check', 'after'], routes: ['approved', 'rejected'] });
  assert.deepEqual(withSteps.properties.step.enum, ['check', 'after']);
  assert.deepEqual(withSteps.properties.route.enum, ['approved', 'rejected']);
  assert.deepEqual(withSteps.properties.action.enum, supervisor.ESCALATION_ACTIONS);
});

test('onCallPrompt: an escalation gate asks the supervisor to try first and offers retry/resume/route, not interrupt', () => {
  const wf = { metadata: { name: 'wf', description: 'Ships things.' } };
  const step = { id: 'build_failed' };
  const gate = { message: 'The build failed.', routes: ['approved', 'rejected'], transitions: '- approved -> build', decision: false };
  const prompt = supervisor.onCallPrompt({
    wf, step, gate, signals: [{ kind: 'build_failed', detail: 'x' }], retryStep: 'build', steps: ['build'], events: [],
  });
  assert.match(prompt, /reached the escalation gate "build_failed": it would stop and ask the person about a problem/);
  assert.match(prompt, /- escalate: you cannot solve it/);
  assert.match(prompt, /- retry: run "build" again/);
  assert.match(prompt, /- resume: continue at one of these steps: build/);
  assert.match(prompt, /- route: answer the gate yourself with `route`/);
  assert.doesNotMatch(prompt, /- interrupt:/);
  assert.match(prompt, /never prescribe a code fix/);
});

test('onCallPrompt: a decision gate reached by an exhausted loop never offers route; neither does a plain stall', () => {
  const wf = { metadata: { name: 'wf' } };
  const decisionGate = { message: 'Rounds ran out.', routes: [], transitions: '- approved -> write', decision: true };
  const decisionPrompt = supervisor.onCallPrompt({ wf, step: { id: 'out_of_rounds' }, gate: decisionGate, signals: [], retryStep: null, steps: ['write'], events: [] });
  assert.match(decisionPrompt, /reached the human gate "out_of_rounds" because a loop ran out of iterations.*decision gate: only the person answers it/s);
  assert.doesNotMatch(decisionPrompt, /- route:/);

  const stallPrompt = supervisor.onCallPrompt({
    wf, step: { id: 'review' }, signals: [{ kind: 'same_output', detail: '3 visits in a row: x' }], retryStep: 'review', steps: ['write', 'review'], events: [],
  });
  assert.match(stallPrompt, /The engine detected that the step "review".*may be stuck/);
  assert.match(stallPrompt, /## Stall signals \(deterministic, from the engine\)\n- review: same_output: 3 visits in a row: x/);
  assert.match(stallPrompt, /- retry: run "review" again/);
  assert.match(stallPrompt, /- resume: continue at one of these steps: write, review/);
  assert.doesNotMatch(stallPrompt, /- route:/);
});

test('onCallPrompt: a slow step offers wait/interrupt, never retry/resume', () => {
  const wf = { metadata: { name: 'wf' } };
  const prompt = supervisor.onCallPrompt({
    wf, step: { id: 'work' }, signals: [{ step: 'work', kind: 'slow_step', detail: 'running for 12 min, 2x its usual 5 min or more' }], running: true, events: [],
  });
  assert.match(prompt, /is still running, far longer than its usual duration/);
  assert.match(prompt, /- wait: the step can plausibly still finish/);
  assert.match(prompt, /- interrupt: the step cannot end on its own/);
  assert.doesNotMatch(prompt, /- retry:/);
  assert.doesNotMatch(prompt, /- resume:/);
  assert.match(prompt, /- user_action: only the person can unblock it/);
});

// ---- engine: escalation gates (kind: escalation) --------------------------------------------------

function makeRun(t, yaml, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oncall-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, yaml);
  return new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), ...opts });
}

// Replaces every agent's answer (a queue of plain objects, JSON-encoded) and the supervisor's
// decisions (in order); nothing else talks to a real or mock provider. This fully replaces
// sendToAgent, so no session.message_sent event fires: returns each agent's prompts instead.
function script(run, agentOutputs, decisions) {
  const calls = {};
  run.sendToAgent = async (agent, prompt) => {
    if (agent === 'supervisor') {
      (calls.supervisor ??= []).push(prompt);
      const d = decisions.shift() || { explanation: 'give up', action: 'escalate' };
      return { text: '```json\n' + JSON.stringify(d) + '\n```' };
    }
    (calls[agent] ??= []).push(prompt);
    const out = agentOutputs[agent].shift();
    return { text: '```json\n' + JSON.stringify(out) + '\n```' };
  };
  return calls;
}

// Leaves the real engine (and mock provider) running for every other agent; only the supervisor's
// answers are replaced, in order. Used where a real running turn matters (the slow-step tests).
function stubSupervisorOnly(run, decisions) {
  const original = run.sendToAgent.bind(run);
  run.sendToAgent = async (agent, prompt, opts) => {
    if (agent === 'supervisor') {
      const d = decisions.shift() || { explanation: 'give up', action: 'escalate' };
      return { text: '```json\n' + JSON.stringify(d) + '\n```' };
    }
    return original(agent, prompt, opts);
  };
}

async function run(r) {
  const events = [];
  r.on('event', (e) => events.push(e));
  await r.start();
  return { events, finished: events.find((e) => e.type === 'workflow.finished') };
}

function escalationWF({ supervisor: sup = 'enabled: true, on_call: true, max_interventions: 2, max_total: 10' } = {}) {
  return `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-oncall-escalation }
orchestrator:
  supervisor: { ${sup} }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: build
    agent: a
    prompt: "build"
    output_schema:
      type: object
      required: [status]
      properties: { status: { type: string, enum: [success, failed] } }
    transitions:
      - { when: "output.status == 'success'", goto: end }
      - { when: "output.status == 'failed'", goto: build_failed }
  - id: build_failed
    type: human_approval
    kind: escalation
    message: "Build failed."
    transitions:
      - { when: approved, goto: build }
      - { when: rejected, goto: end, status: failed }
`;
}

test('an escalation gate wakes the supervisor on call first; when it cannot solve it, the gate opens with its diagnosis', async (t) => {
  const r = makeRun(t, escalationWF());
  script(r, { a: [{ status: 'failed' }, { status: 'success' }] }, [
    { explanation: 'No obvious cause from the log.', recommendation: 'Check the CI runner.', action: 'escalate' },
  ]);
  r.on('event', (e) => { if (e.type === 'approval.requested') setImmediate(() => r.resolveApproval(e.approval_id, true)); });
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);

  const started = events.find((e) => e.type === 'supervisor.started');
  assert.equal(started.step_id, 'build_failed');
  assert.equal(started.kind, 'escalation');
  const gateIdx = events.findIndex((e) => e.type === 'approval.requested');
  assert.ok(events.indexOf(started) < gateIdx, 'the supervisor runs before the gate opens');

  const decision = events.find((e) => e.type === 'supervisor.decision');
  assert.equal(decision.action, 'escalate');
  const gate = events[gateIdx];
  assert.match(gate.message, /Build failed\.\n\n---\nSupervisor on call: No obvious cause from the log\.\nRecommendation: Check the CI runner\./);
  assert.equal(gate.supervisor.explanation, 'No obvious cause from the log.');
});

test('"retry" at an escalation gate sends the run back with an instruction, without opening the gate', async (t) => {
  const r = makeRun(t, escalationWF());
  const calls = script(r, { a: [{ status: 'failed' }, { status: 'success' }] }, [
    { explanation: 'Looks like a flaky runner.', action: 'retry', instruction: 'Re-run the build; it was probably a flaky runner.' },
  ]);
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!events.some((e) => e.type === 'approval.requested'));

  const transition = events.find((e) => e.type === 'step.transition' && e.when === 'supervisor on call: retry');
  assert.deepEqual([transition.from, transition.to], ['build_failed', 'build']);
  assert.equal(calls.a.length, 2);
  assert.match(calls.a[1], /Note from the run supervisor[^\n]*\nRe-run the build; it was probably a flaky runner\./);
  const decision = events.find((e) => e.type === 'supervisor.decision');
  assert.equal(decision.goto, 'build');

  const rows = fs.readFileSync(path.join(r.runDir, 'decisions.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
  assert.deepEqual(rows[0].slice(1, 5), ['supervisor', 'build_failed', 'on-call', 'retry → build']);
});

test('"route" answers the gate itself when the evidence calls for it', async (t) => {
  const r = makeRun(t, escalationWF());
  script(r, { a: [{ status: 'failed' }, { status: 'success' }] }, [
    { explanation: 'The last commit fixed it; CI is flaky, not the code.', action: 'route', route: 'approved' },
  ]);
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!events.some((e) => e.type === 'approval.requested'));
  const decision = events.find((e) => e.type === 'supervisor.decision');
  assert.equal(decision.action, 'route');
  assert.equal(decision.route, 'approved');
  assert.equal(finished.summary.steps.build_failed.output.approved, true);
  assert.equal(finished.summary.steps.build_failed.output.by, 'supervisor');
});

test('on_call: false never calls the supervisor; the gate opens straight away, with no diagnosis', async (t) => {
  const r = makeRun(t, escalationWF({ supervisor: 'enabled: true, on_call: false' }));
  script(r, { a: [{ status: 'failed' }, { status: 'success' }] }, []);
  r.on('event', (e) => { if (e.type === 'approval.requested') setImmediate(() => r.resolveApproval(e.approval_id, true)); });
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!events.some((e) => e.type === 'supervisor.started'));
  const gate = events.find((e) => e.type === 'approval.requested');
  assert.doesNotMatch(gate.message, /Supervisor on call/);
  assert.ok(!gate.supervisor);
});

test('max_interventions (per step) reached: the supervisor is not called again; the gate opens with its last diagnosis', async (t) => {
  const r = makeRun(t, escalationWF({ supervisor: 'enabled: true, on_call: true, max_interventions: 1, max_total: 10' }));
  script(r, { a: [{ status: 'failed' }, { status: 'failed' }, { status: 'success' }] }, [
    { explanation: 'Looked flaky, sent it back once.', action: 'retry', instruction: 'Try again.' },
  ]);
  r.on('event', (e) => { if (e.type === 'approval.requested') setImmediate(() => r.resolveApproval(e.approval_id, true)); });
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(events.filter((e) => e.type === 'supervisor.started').length, 1);
  const warn = events.find((e) => e.type === 'log' && e.level === 'warn');
  assert.match(warn.message, /Supervisor on call: not called at build_failed \(its 1 interventions on this step are used\); asking you\./);
  const gate = events.find((e) => e.type === 'approval.requested');
  assert.match(gate.message, /Supervisor on call \(not called again: its 1 interventions on this step are used\): Looked flaky, sent it back once\./);
});

test('max_cost_usd: 0 blocks the supervisor from its very first call; the gate opens with no diagnosis', async (t) => {
  const r = makeRun(t, escalationWF({ supervisor: 'enabled: true, on_call: true, max_interventions: 5, max_total: 10, max_cost_usd: 0' }));
  script(r, { a: [{ status: 'failed' }, { status: 'success' }] }, []);
  r.on('event', (e) => { if (e.type === 'approval.requested') setImmediate(() => r.resolveApproval(e.approval_id, true)); });
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!events.some((e) => e.type === 'supervisor.started'));
  const warn = events.find((e) => e.type === 'log' && e.level === 'warn');
  assert.match(warn.message, /its cost cap for this run \(US\$ 0\) is reached/);
  const gate = events.find((e) => e.type === 'approval.requested');
  assert.doesNotMatch(gate.message, /Supervisor on call/);
});

// ---- engine: exhausted loops ------------------------------------------------------------------

const EXHAUSTED_WF = `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-oncall-exhausted }
orchestrator:
  supervisor: { enabled: true, on_call: true, max_interventions: 5, max_total: 10 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: fix
    agent: a
    prompt: "fix"
    output_schema:
      type: object
      required: [ok, give_up]
      properties: { ok: { type: boolean }, give_up: { type: boolean } }
    transitions:
      - { when: "output.give_up == true", goto: stuck }
      - { when: "output.ok == true", goto: end }
      - { when: "output.ok == false", goto: fix, max_visits: 2, on_exhausted: stuck }
  - id: stuck
    type: human_approval
    message: "Still not fixed after 2 rounds."
    transitions:
      - { when: approved, goto: fix }
      - { when: rejected, goto: end, status: failed }
`;

test('max_visits exhausted into a decision gate: the supervisor decides in decision mode first (no route offered)', async (t) => {
  const r = makeRun(t, EXHAUSTED_WF);
  const calls = script(r, { a: [{ ok: false, give_up: false }, { ok: false, give_up: false }, { ok: false, give_up: false }, { ok: true, give_up: false }] }, [
    { explanation: 'Looks like a real bug; let the person decide.', action: 'escalate' },
  ]);
  r.on('event', (e) => { if (e.type === 'approval.requested') setImmediate(() => r.resolveApproval(e.approval_id, true)); });
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);

  const started = events.find((e) => e.type === 'supervisor.started');
  assert.equal(started.step_id, 'stuck');
  assert.equal(started.kind, 'escalation');
  assert.doesNotMatch(calls.supervisor[0], /- route:/);
  assert.match(calls.supervisor[0], /decision gate: only the person answers it/);

  const gate = events.find((e) => e.type === 'approval.requested');
  assert.match(gate.message, /Supervisor on call: Looks like a real bug; let the person decide\./);
});

test('"retry" or "resume" at an exhausted decision gate refunds one round, instead of opening the gate', async (t) => {
  const r = makeRun(t, EXHAUSTED_WF);
  const calls = script(r, { a: [{ ok: false, give_up: false }, { ok: false, give_up: false }, { ok: false, give_up: false }, { ok: true, give_up: false }] }, [
    { explanation: 'One more try with a hint.', action: 'retry', instruction: 'Check the null check on line 40.' },
  ]);
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!events.some((e) => e.type === 'approval.requested'));

  const transition = events.find((e) => e.type === 'step.transition' && e.when === 'supervisor on call: retry');
  assert.deepEqual([transition.from, transition.to], ['stuck', 'fix']);
  assert.equal(calls.a.length, 4);
  assert.match(calls.a[3], /Note from the run supervisor[^\n]*\nCheck the null check on line 40\./);
});

test('a non-exhausted arrival at a decision gate never calls the supervisor', async (t) => {
  const r = makeRun(t, EXHAUSTED_WF);
  script(r, { a: [{ ok: false, give_up: true }] }, []);
  r.on('event', (e) => { if (e.type === 'approval.requested') setImmediate(() => r.resolveApproval(e.approval_id, false)); });
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'failed');
  assert.ok(!events.some((e) => e.type === 'supervisor.started'));
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'fix').length, 1);
});

const LOOP_ITER_WF = `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-oncall-loop-iter }
orchestrator:
  supervisor: { enabled: true, on_call: true, max_interventions: 5, max_total: 10 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
  b: { provider: claude, model: m, session: ephemeral }
steps:
  - id: review
    agent: a
    prompt: "review"
    output_schema:
      type: object
      required: [score]
      properties: { score: { type: number } }
    transitions:
      - { when: "output.score >= 8", goto: end }
      - { when: "output.score < 8", goto: review, loop: { name: rounds, max_iterations: 2, on_exhausted: rescue } }
  - id: rescue
    agent: b
    prompt: "rescue"
    output_schema:
      type: object
      required: [done]
      properties: { done: { type: boolean } }
`;

test('loop.max_iterations exhausted into an agent step (not a gate): "continue" keeps the target', async (t) => {
  const r = makeRun(t, LOOP_ITER_WF);
  script(r, { a: [{ score: 4 }, { score: 4 }, { score: 4 }], b: [{ done: true }] }, [
    { explanation: 'Three rounds of notes did not help; a different reviewer should look.', action: 'continue' },
  ]);
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  const started = events.find((e) => e.type === 'supervisor.started');
  assert.equal(started.step_id, 'review');
  assert.equal(started.kind, 'stall');
  assert.match(started.error, /loop_exhausted/);
  const decision = events.find((e) => e.type === 'supervisor.decision');
  assert.equal(decision.action, 'continue');
  assert.equal(decision.goto, 'rescue');
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'rescue').length, 1);
});

test('loop.max_iterations exhausted: "retry" sends the run back to the looping step with a refund (one more round)', async (t) => {
  const r = makeRun(t, LOOP_ITER_WF);
  const calls = script(r, { a: [{ score: 4 }, { score: 4 }, { score: 4 }, { score: 9 }] }, [
    { explanation: 'The notes have not landed; try once more, more specific.', action: 'retry', instruction: 'Point to the exact line that fails the test.' },
  ]);
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!events.some((e) => e.type === 'step.started' && e.step_id === 'rescue'));
  const transition = events.find((e) => e.type === 'step.transition' && e.when === 'supervisor on call: retry');
  assert.deepEqual([transition.from, transition.to], ['review', 'review']);
  assert.equal(calls.a.length, 4);
  assert.match(calls.a[3], /Point to the exact line that fails the test\./);
});

// Extends test/fixtures/loop-blocked.yaml (an agent fighting its allowlist stops the /loop after 3
// blocked iterations) with the supervisor on call.
const LOOP_BLOCKED_ONCALL_WF = `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-oncall-loop-blocked }
orchestrator:
  supervisor: { enabled: true, on_call: true, max_interventions: 5, max_total: 10 }
agents:
  sitter: { provider: claude, model: mock-model, session: persistent }
steps:
  - id: watch
    agent: sitter
    goal: { description: "PR ready to merge", until: "output.state == 'ready'", on_exhausted: stuck }
    loop: { interval: 1s, max_duration: 12h }
    prompt: "Check the PR."
    output_schema:
      type: object
      required: [state, summary]
      properties: { state: { type: string, enum: [waiting, ready] }, summary: { type: string } }
    transitions:
      - { when: "output.state == 'waiting'", goto: watch }
      - { when: "output.state == 'ready'", goto: end }
  - id: stuck
    type: human_approval
    message: "The PR watch is blocked."
    transitions:
      - { when: approved, goto: watch }
      - { when: rejected, goto: end, status: failed }
`;

// Every blocked visit refuses 6 tool calls in a row (the mock's fixed list), which also trips the
// per-visit permission_denials stall (DENIAL_WARN = 5): with on_call, the supervisor is woken on
// each of the 2 blocked visits before the loop's 3rd exhausts it into the gate, not just once at
// the gate. 'continue' on those stall calls lets the blocked count keep climbing normally.
test('/loop blocked (refused tools) wakes the supervisor on call on each blocked visit, then before the gate; "retry" refunds the loop for another try', { timeout: 60000 }, async (t) => {
  const r = makeRun(t, LOOP_BLOCKED_ONCALL_WF, { mockSequences: { permission_denials: { watch: 99 } } });
  stubSupervisorOnly(r, [
    { explanation: 'A refused call once is not yet a pattern.', action: 'continue' },
    { explanation: 'Still just refused tools; let the loop finish its rounds.', action: 'continue' },
    { explanation: 'Fighting its allowlist; let it try bare gh once more.', action: 'retry', instruction: 'Call gh directly in the Bash tool, no PowerShell wrapper.' },
    { explanation: 'A refused call once is not yet a pattern.', action: 'continue' },
    { explanation: 'Still just refused tools; let the loop finish its rounds.', action: 'continue' },
  ]);
  const { events, finished } = await (async () => {
    const evs = [];
    r.on('event', (e) => {
      evs.push(e);
      if (e.type === 'approval.requested') setImmediate(() => r.resolveApproval(e.approval_id, false));
    });
    await r.start();
    return { events: evs, finished: evs.find((e) => e.type === 'workflow.finished') };
  })();

  assert.equal(finished.status, 'failed');
  const started = events.filter((e) => e.type === 'supervisor.started');
  // 2 stall calls per round of 3 blocked visits (the 3rd is skipped: checkStalls sees the exhausted
  // target already pending), then the escalation call at the gate: 2 rounds = 6 calls total.
  assert.equal(started.length, 6);
  assert.deepEqual(started.map((s) => [s.step_id, s.kind]), [
    ['watch', 'stall'], ['watch', 'stall'], ['stuck', 'escalation'],
    ['watch', 'stall'], ['watch', 'stall'], ['stuck', 'escalation'],
  ]);
  const decisions = events.filter((e) => e.type === 'supervisor.decision');
  assert.deepEqual(decisions.map((d) => d.action), ['continue', 'continue', 'retry', 'continue', 'continue', 'escalate']);
  const transition = events.find((e) => e.type === 'step.transition' && e.when === 'supervisor on call: retry');
  assert.deepEqual([transition.from, transition.to], ['stuck', 'watch']);
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'watch').length, 6); // 3 blocked, refunded, 3 more blocked
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'stuck').length, 2);
  assert.ok(events.indexOf(started[5]) < events.findIndex((e) => e.type === 'approval.requested'));
});

// ---- engine: the same answer, or refused tools, in a row -------------------------------------------

const SAME_OUTPUT_WF = `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-oncall-same-output }
orchestrator:
  supervisor: { enabled: true, on_call: true, max_interventions: 5, max_total: 10 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: review
    agent: a
    prompt: "review"
    output_schema:
      type: object
      required: [verdict]
      properties: { verdict: { type: string, enum: [changes_requested, approved] } }
    transitions:
      - { when: "output.verdict == 'approved'", goto: end }
      - { when: "output.verdict == 'changes_requested'", goto: review }
`;

test('the same answer 3 times in a row (not a /loop step) wakes the supervisor on call; "continue" lets it carry on', async (t) => {
  const r = makeRun(t, SAME_OUTPUT_WF);
  script(r, { a: [{ verdict: 'changes_requested' }, { verdict: 'changes_requested' }, { verdict: 'changes_requested' }, { verdict: 'approved' }] }, [
    { explanation: 'The same note 3 times in a row is expected while the writer catches up.', action: 'continue' },
  ]);
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  const started = events.find((e) => e.type === 'supervisor.started');
  assert.equal(started.step_id, 'review');
  assert.equal(started.kind, 'stall');
  assert.match(started.error, /same_output/);
  const decision = events.find((e) => e.type === 'supervisor.decision');
  assert.equal(decision.action, 'continue');
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'review').length, 4);
});

const POLLING_WF = `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-oncall-polling }
orchestrator:
  supervisor: { enabled: true, on_call: true, max_interventions: 5, max_total: 10, stall: { same_output: 2 } }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: watch
    agent: a
    goal: { description: "ready", until: "output.state == 'ready'", on_exhausted: rescue }
    loop: { interval: 1s, max_duration: 1h }
    prompt: "watch"
    output_schema:
      type: object
      required: [state]
      properties: { state: { type: string, enum: [waiting, ready] } }
    transitions:
      - { when: "output.state == 'waiting'", goto: watch }
      - { when: "output.state == 'ready'", goto: end }
  - id: rescue
    agent: a
    prompt: "rescue"
`;

test('a /loop step repeating the same answer by design never counts as a stall, even below the threshold', async (t) => {
  const r = makeRun(t, POLLING_WF);
  script(r, { a: [{ state: 'waiting' }, { state: 'waiting' }, { state: 'ready' }] }, []);
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!events.some((e) => e.type === 'supervisor.started'));
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'watch').length, 3);
});

// ---- engine: a step running far longer than usual (watchSlowStep / superviseSlow) ------------------

const SLOW_WF = `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-oncall-slow }
orchestrator:
  supervisor: { enabled: true, on_call: true, max_interventions: 5, max_total: 10, stall: { slow_factor: 2 } }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "work"
    output_schema:
      type: object
      required: [status]
      properties: { status: { type: string, enum: [retry, done] } }
    transitions:
      - { when: "output.status == 'retry'", goto: work }
      - { when: "output.status == 'done'", goto: end }
`;

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Ticks the fake clock in small steps (flushing microtasks between each) so a chain of short,
// real-mock-provider delays keeps progressing; the first time `trigger()` turns true it jumps past
// the slow-step floor (10 min) in one big tick instead, to wake watchSlowStep's timer.
async function pump(t, done, trigger) {
  let jumped = false;
  for (let i = 0; i < 500 && !done(); i++) {
    if (!jumped && trigger()) { t.mock.timers.tick(11 * 60e3); jumped = true; } else t.mock.timers.tick(300);
    await flush();
  }
  if (!done()) throw new Error('pump: condition never met');
}

test('a visit running slow_factor times its usual duration wakes the supervisor on call while it still runs; "wait" lets it finish', { timeout: 30000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const r = makeRun(t, SLOW_WF, { mockSequences: { status: ['retry', 'done'] } });
  const events = [];
  r.on('event', (e) => events.push(e));
  stubSupervisorOnly(r, [{ explanation: 'A build this size can plausibly still be running.', action: 'wait' }]);

  let finished = false;
  const started = r.start().then(() => { finished = true; });
  await pump(t, () => finished, () => events.some((e) => e.type === 'step.started' && e.step_id === 'work' && e.visit === 2));
  await started;

  const done = events.find((e) => e.type === 'workflow.finished');
  assert.equal(done.status, 'success', done.error);
  const slowStarted = events.find((e) => e.type === 'supervisor.started' && e.kind === 'slow');
  assert.ok(slowStarted, 'the supervisor was asked about the slow visit');
  const finishedIdx = events.findIndex((e) => e.type === 'step.finished' && e.step_id === 'work' && e.visit === 2);
  assert.ok(events.indexOf(slowStarted) < finishedIdx, 'the supervisor runs while the step still runs');
  const decision = events.find((e) => e.type === 'supervisor.decision' && e.kind === 'stall');
  assert.equal(decision.action, 'wait');
  // checkStalls does not call the supervisor again once the slow signal is handled
  assert.equal(events.filter((e) => e.type === 'supervisor.started').length, 1);
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'work').length, 2);
});

test('"interrupt" aborts the running turn, logs agent_interrupted, and the step reruns with the instruction', { timeout: 30000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const r = makeRun(t, SLOW_WF, { mockSequences: { status: ['retry', 'retry', 'done'] } });
  const events = [];
  r.on('event', (e) => events.push(e));
  stubSupervisorOnly(r, [
    { explanation: 'This step never ends; its agent is probably stuck.', action: 'interrupt', instruction: 'Stop the long build and summarize what you tried.' },
  ]);

  let finished = false;
  const started = r.start().then(() => { finished = true; });
  await pump(t, () => finished, () => events.some((e) => e.type === 'step.started' && e.step_id === 'work' && e.visit === 2));
  await started;

  const done = events.find((e) => e.type === 'workflow.finished');
  assert.equal(done.status, 'success', done.error);
  assert.ok(events.some((e) => e.type === 'log' && e.kind === 'agent_interrupted' && e.step_id === 'work'));
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'work').length, 3); // v1 fast, v2 interrupted, v3 reruns
  const prompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'work').map((e) => e.prompt);
  assert.equal(prompts.length, 3);
  assert.match(prompts[2], /Note from the run supervisor[^\n]*\nStop the long build and summarize what you tried\./);
});

test('"interrupt" without an instruction falls back to a generic note about the long turn', { timeout: 30000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const r = makeRun(t, SLOW_WF, { mockSequences: { status: ['retry', 'retry', 'done'] } });
  const events = [];
  r.on('event', (e) => events.push(e));
  stubSupervisorOnly(r, [{ explanation: 'Stuck.', action: 'interrupt' }]);

  let finished = false;
  const started = r.start().then(() => { finished = true; });
  await pump(t, () => finished, () => events.some((e) => e.type === 'step.started' && e.step_id === 'work' && e.visit === 2));
  await started;

  const prompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'work').map((e) => e.prompt);
  assert.match(prompts[2], /Your previous attempt was stopped because it ran far longer than this step usually takes\. Check what you were waiting on, and run long commands in the foreground with a timeout\./);
});

// The timer and signal-handling parts above are reached through a full run; a few branches of
// superviseSlow are more directly reachable by calling it on an already-built WorkflowRun (the class
// does not expose a seam to wait out the 10-minute floor otherwise): parallel steps, on_call off, and
// a per-step limit already reached.

test('superviseSlow: a parallel (fan-out) step is never interrupted, only diagnosed', async (t) => {
  const r = makeRun(t, escalationWF());
  const step = { id: 'compete', agents: ['a', 'b'] };
  const st = r.ctx.steps.build; // reuse any step's state object; only .onCall/.slow matter here
  st.slow = { kind: 'slow_step', detail: 'running for 20 min, 2x its usual 8 min or more' };
  r.sendToAgent = async (agent) => {
    assert.equal(agent, 'supervisor');
    return { text: '```json\n' + JSON.stringify({ explanation: 'Looks busy.', action: 'interrupt' }) + '\n```' };
  };
  const events = [];
  r.on('event', (e) => events.push(e));
  const keepWatching = await r.superviseSlow(step, st);
  assert.equal(keepWatching, true, 'not interrupted: it keeps being watched');
  const decision = events.find((e) => e.type === 'supervisor.decision');
  assert.equal(decision.action, 'wait');
  assert.equal(decision.note, 'not interrupted: a parallel step is not interrupted');
});

test('superviseSlow: on_call off never calls the supervisor; a per-step limit reached warns and keeps it running', async (t) => {
  const off = makeRun(t, escalationWF({ supervisor: 'enabled: true, on_call: false' }));
  const buildStep = off.wf.steps.find((s) => s.id === 'build');
  const offSt = off.ctx.steps.build;
  offSt.slow = { kind: 'slow_step', detail: 'running for 20 min' };
  const offEvents = [];
  off.on('event', (e) => offEvents.push(e));
  assert.equal(await off.superviseSlow(buildStep, offSt), false);
  assert.ok(!offEvents.some((e) => e.type === 'supervisor.started'));
  assert.ok(!offEvents.some((e) => e.type === 'log' && e.level === 'warn'));

  const limited = makeRun(t, escalationWF({ supervisor: 'enabled: true, on_call: true, max_interventions: 1, max_total: 10' }));
  const limitedSt = limited.ctx.steps.build;
  limitedSt.slow = { kind: 'slow_step', detail: 'running for 20 min' };
  limitedSt.onCall = [{ action: 'wait', explanation: 'already used' }];
  const limitedEvents = [];
  limited.on('event', (e) => limitedEvents.push(e));
  assert.equal(await limited.superviseSlow(buildStep, limitedSt), false);
  assert.ok(!limitedEvents.some((e) => e.type === 'supervisor.started'));
  const warn = limitedEvents.find((e) => e.type === 'log' && e.level === 'warn');
  assert.match(warn.message, /not called on the slow step build \(its 1 interventions on this step are used\); it keeps running\./);
});

// ---- #121: same_output compares progress, not only control fields (repeatKey) -----------------------

test('loadWorkflow validates a step\'s stall.same_output_fields', () => {
  const base = (stepExtra, schema) => `agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: s1\n    agent: a\n    prompt: x\n${stepExtra}    output_schema:\n${schema}\n`;
  const schema = '      type: object\n      properties: { commit_sha: { type: string }, summary: { type: string } }\n';
  assert.throws(
    () => loadWorkflow(writeTmp(base('    stall: {}\n', schema))),
    /Step "s1": stall\.same_output_fields must be a non-empty list of output field names\./,
  );
  assert.throws(
    () => loadWorkflow(writeTmp(base('    stall: { same_output_fields: [] }\n', schema))),
    /Step "s1": stall\.same_output_fields must be a non-empty list of output field names\./,
  );
  assert.throws(
    () => loadWorkflow(writeTmp(base('    stall: { same_output_fields: [commit_sha, 3] }\n', schema))),
    /Step "s1": stall\.same_output_fields must be a non-empty list of output field names\./,
  );
  assert.throws(
    () => loadWorkflow(writeTmp(base('    stall: { same_output_fields: [commit_sha, verdict] }\n', schema))),
    /Step "s1": stall\.same_output_fields names "verdict", which is not in its output_schema\./,
  );
  assert.doesNotThrow(() => loadWorkflow(writeTmp(base('    stall: { same_output_fields: [commit_sha, summary] }\n', schema))));
});

test('both bundled development workflows load with develop.stall set to commit_sha, summary, files_changed', () => {
  for (const file of ['software-development.yaml', 'software-development-local-hero.yaml']) {
    const wf = loadWorkflow(path.join(root, 'workflows', file));
    const develop = wf.steps.find((s) => s.id === 'develop');
    assert.deepEqual(develop.stall, { same_output_fields: ['commit_sha', 'summary', 'files_changed'] });
  }
});

const DEVELOP_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    commit_sha: { type: 'string' },
    summary: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
  },
};
const developStep = (fields = ['commit_sha', 'summary', 'files_changed']) => ({ output_schema: DEVELOP_SCHEMA, stall: { same_output_fields: fields } });

test('repeatKey: three develop-like visits with different commit_sha and summary give three different keys', () => {
  const step = developStep();
  const outputs = [
    { committed: true, commit_sha: 'a1b2c3d', summary: 'Implement the artifact export.', files_changed: ['src/export.js'] },
    { committed: true, commit_sha: 'e4f5a6b', summary: 'Fix artifact path to stay inside the workspace.', files_changed: ['src/export.js', 'src/paths.js'] },
    { committed: true, commit_sha: 'c7d8e9f', summary: 'Fix empty files_changed blocker from the review.', files_changed: ['src/paths.js'] },
  ];
  const keys = outputs.map((o) => repeatKey(step, o));
  assert.notEqual(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
  assert.notEqual(keys[0], keys[2]);
});

test('repeatKey: three develop-like visits with the same commit_sha, summary and files_changed give the same key', () => {
  const step = developStep();
  const output = { committed: true, commit_sha: 'same0001', summary: 'No changes needed.', files_changed: ['src/export.js'] };
  const keys = [repeatKey(step, { ...output }), repeatKey(step, { ...output }), repeatKey(step, { ...output })];
  assert.equal(keys[0], keys[1]);
  assert.equal(keys[1], keys[2]);
});

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approved', 'changes_requested'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          axis: { type: 'string', enum: ['correctness', 'spec', 'standards'] },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          description: { type: 'string' },
        },
      },
    },
  },
};
const reviewStep = { output_schema: REVIEW_SCHEMA };

test('repeatKey: a reviewer giving the same verdict and findings gives the same key, reworded descriptions included', () => {
  const output1 = {
    verdict: 'changes_requested',
    findings: [{ axis: 'correctness', severity: 'blocker', file: 'src/export.js', line: 10, description: 'Off-by-one error in the loop bound causes an extra iteration.' }],
  };
  const output2 = {
    verdict: 'changes_requested',
    findings: [{ axis: 'correctness', severity: 'blocker', file: 'src/export.js', line: 10, description: 'The loop runs one time too many due to a boundary mistake.' }],
  };
  assert.equal(repeatKey(reviewStep, output1), repeatKey(reviewStep, output2));
});

test('repeatKey: a reviewer giving a finding at a different file or line gives a different key', () => {
  const base = { axis: 'correctness', severity: 'blocker', file: 'src/export.js', line: 10, description: 'An off-by-one error.' };
  const output1 = { verdict: 'changes_requested', findings: [base] };
  const output2 = { verdict: 'changes_requested', findings: [{ ...base, line: 42 }] };
  const output3 = { verdict: 'changes_requested', findings: [{ ...base, file: 'src/paths.js' }] };
  assert.notEqual(repeatKey(reviewStep, output1), repeatKey(reviewStep, output2));
  assert.notEqual(repeatKey(reviewStep, output1), repeatKey(reviewStep, output3));
});

test('repeatKey: the "answered" findings (the step it came from) are part of the key, breaking a repeat', () => {
  const step = developStep();
  const output = { committed: true, commit_sha: 'same0002', summary: 'Fix review findings.', files_changed: ['src/export.js'] };
  const noAnswered = repeatKey(step, output);
  const answeredA = repeatKey(step, output, { answered: 'findings-round-A' });
  const answeredB = repeatKey(step, output, { answered: 'findings-round-B' });
  const answeredAAgain = repeatKey(step, output, { answered: 'findings-round-A' });
  assert.notEqual(noAnswered, answeredA);
  assert.notEqual(answeredA, answeredB);
  assert.equal(answeredA, answeredAAgain);
});

test('repeatKey: without a declared commit_sha field, it falls back to the worktree head, null with no worktree', () => {
  const step = { output_schema: { type: 'object', properties: { files_changed: { type: 'array', items: { type: 'string' } } } } };
  const output = { files_changed: ['src/export.js'] };
  const keyNoWorktree = repeatKey(step, output, { head: () => null });
  const keyWithWorktree = repeatKey(step, output, { head: () => 'headsha1' });
  assert.notEqual(keyNoWorktree, keyWithWorktree);
  assert.equal(JSON.parse(keyNoWorktree)[1], null);
  assert.equal(JSON.parse(keyWithWorktree)[1], 'headsha1');
});

// ---- #121: engine integration (checkStalls + repeatKey) ----------------------------------------------

const DEVELOP_PROGRESS_WF = `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-oncall-develop-progress }
orchestrator:
  supervisor: { enabled: true, on_call: true, max_interventions: 5, max_total: 10 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: develop
    agent: a
    prompt: "develop"
    stall:
      same_output_fields: [commit_sha, summary, files_changed]
    output_schema:
      type: object
      required: [committed, round]
      properties:
        committed: { type: boolean }
        commit_sha: { type: string }
        summary: { type: string }
        files_changed: { type: array, items: { type: string } }
        round: { type: integer }
    transitions:
      - { when: "output.round < 3", goto: develop }
      - { when: "output.round >= 3", goto: end }
`;

test('three develop visits with different commit_sha and summary raise no same_output stall', async (t) => {
  const r = makeRun(t, DEVELOP_PROGRESS_WF);
  script(r, { a: [
    { committed: true, commit_sha: 'a1b2c3d', summary: 'Implement the export.', files_changed: ['src/export.js'], round: 1 },
    { committed: true, commit_sha: 'e4f5a6b', summary: 'Fix the artifact path.', files_changed: ['src/export.js', 'src/paths.js'], round: 2 },
    { committed: true, commit_sha: 'c7d8e9f', summary: 'Fix the empty files_changed blocker.', files_changed: ['src/paths.js'], round: 3 },
  ] }, []);
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(!events.some((e) => e.type === 'log' && e.kind === 'stall' && e.stall === 'same_output'));
  assert.ok(!events.some((e) => e.type === 'supervisor.started'));
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'develop').length, 3);
});

test('three develop visits with the same commit_sha, summary and files_changed raise a same_output stall', async (t) => {
  const r = makeRun(t, DEVELOP_PROGRESS_WF);
  const output = { committed: true, commit_sha: 'same0003', summary: 'No changes needed.', files_changed: ['src/export.js'] };
  script(r, { a: [
    { ...output, round: 1 },
    { ...output, round: 2 },
    { ...output, round: 3 },
  ] }, []);
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  const stall = events.find((e) => e.type === 'log' && e.kind === 'stall' && e.stall === 'same_output' && e.step_id === 'develop');
  assert.ok(stall, 'a same_output stall is logged');
  assert.match(stall.message, /same_output/);
});

// A fix round answering new review findings is progress, even when the developer's commit_sha,
// summary and files_changed happen to repeat; the same findings answered twice in a row do count (#121).
const DEVELOP_REVIEW_CYCLE_WF = `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-oncall-develop-review-cycle }
orchestrator:
  supervisor: { enabled: true, on_call: false, max_interventions: 5, max_total: 10, stall: { same_output: 2 } }
agents:
  dev: { provider: claude, model: m, session: ephemeral }
  rev: { provider: claude, model: m, session: ephemeral }
steps:
  - id: develop
    agent: dev
    prompt: "develop"
    stall:
      same_output_fields: [commit_sha, summary, files_changed]
    output_schema:
      type: object
      required: [committed]
      properties:
        committed: { type: boolean }
        commit_sha: { type: string }
        summary: { type: string }
        files_changed: { type: array, items: { type: string } }
    transitions:
      - { when: "output.committed == true", goto: code_review }
  - id: code_review
    agent: rev
    prompt: "review"
    output_schema:
      type: object
      required: [verdict]
      properties:
        verdict: { type: string, enum: [approved, changes_requested] }
        findings:
          type: array
          items:
            type: object
            properties:
              axis: { type: string, enum: [correctness, spec, standards] }
              severity: { type: string, enum: [blocker, major, minor, nit] }
              file: { type: string }
              line: { type: integer }
              description: { type: string }
    transitions:
      - { when: "output.verdict == 'approved'", goto: end }
      - { when: "output.verdict == 'changes_requested'", goto: develop }
`;

test('a develop visit following a code_review with different findings is never a repeat; the same findings again do count', async (t) => {
  const r = makeRun(t, DEVELOP_REVIEW_CYCLE_WF);
  // the developer's commit, summary and files are the same every round, on purpose: only the
  // review findings it answers change, to isolate what repeatKey's `answered` does.
  const devOutput = { committed: true, commit_sha: 'sha1', summary: 'Fix review findings.', files_changed: ['src/a.js'] };
  const findingsA = [{ axis: 'correctness', severity: 'blocker', file: 'src/a.js', line: 10, description: 'Off-by-one error in loop bound.' }];
  const findingsB = [{ axis: 'standards', severity: 'major', file: 'src/b.js', line: 42, description: 'Missing input validation on user id.' }];
  const findingsB2 = [{ axis: 'standards', severity: 'major', file: 'src/b.js', line: 42, description: 'The user id is used without validating it first, a possible security issue.' }];
  script(r, {
    dev: [{ ...devOutput }, { ...devOutput }, { ...devOutput }, { ...devOutput }],
    rev: [
      { verdict: 'changes_requested', findings: findingsA },
      { verdict: 'changes_requested', findings: findingsB },
      { verdict: 'changes_requested', findings: findingsB2 }, // same as findingsB, reworded
      { verdict: 'approved' },
    ],
  }, []);
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  const developStalls = events.filter((e) => e.type === 'log' && e.kind === 'stall' && e.stall === 'same_output' && e.step_id === 'develop');
  // visits 1-3: no previous review, then findings A, then findings B (new each time) - no repeat
  assert.equal(developStalls.length, 1, 'only the 4th develop visit (answering the same findings as the 3rd) repeats');
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'develop').length, 4);
});

// ---- #121: the supervisor writes in English, whatever the task's or the owner's language ------------

test('the failure, action-error, idle and on-call prompts all pin English, not the task\'s language', () => {
  const wf = { metadata: { name: 'wf' } };
  const prompts = [
    supervisor.decisionPrompt({ wf, step: { id: 's1' }, error: 'boom', answer: null, allowed: ['s1'], events: [] }),
    supervisor.actionErrorPrompt({ wf, step: { id: 's1' }, error: 'boom', check: null, recover: ['s1'], gate: 'g1', events: [] }),
    supervisor.idlePrompt({ wf, step: { id: 's1' }, agent: 'a', idle: { idle_ms: 6e5, tool: 'bash', command: 'npm test' }, events: [] }),
    supervisor.onCallPrompt({ wf, step: { id: 's1' }, signals: [{ kind: 'same_output', detail: 'x' }], retryStep: 's1', steps: ['s1'], events: [] }),
  ];
  for (const prompt of prompts) {
    assert.match(prompt, /in English/);
    assert.doesNotMatch(prompt, /in the language of/);
  }
});
