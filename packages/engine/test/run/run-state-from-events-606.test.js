// #606 acceptance: runStateFromEvents (packages/engine/engine/run/resume.js), the state a resume
// needs as a pure function of a run's event log (and its summary.json when it exists), on
// hand-written logs in the recorded shape. The seam and its result are described in
// test/run-state-606.js; the replays of whole mock runs are in test/slow/run-state-from-events-*606.
const test = require('node:test');
const assert = require('node:assert/strict');

// loaded in each test: the export does not exist before #606
const load = () => {
  const fn = require('../../engine/run/resume').runStateFromEvents;
  assert.equal(typeof fn, 'function', 'packages/engine/engine/run/resume.js exports runStateFromEvents');
  return fn;
};

// A log in the shape the recorder writes ({ seq, ts, run_id, type, ...data }).
function log(...items) {
  return items.map((data, i) => ({ seq: i + 1, ts: new Date(Date.UTC(2026, 9, 26, 12, 0, i)).toISOString(), run_id: 'r1', ...data }));
}
const started = { type: 'workflow.started', workflow: 'fixture', file: 'fixture.yaml' };
const stepStarted = (step, visit = 1) => ({ type: 'step.started', step_id: step, visit, iteration: 1, step_type: 'agent', agent: 'dev' });
const stepFinished = (step, visit = 1, output = { text: `${step} done` }) => ({ type: 'step.finished', step_id: step, visit, iteration: 1, output, duration_ms: 5 });
const transition = (from, to) => ({ type: 'step.transition', from, to, when: 'true' });
const session = (type, id, agent, providerId, status = 'active') => ({
  type, session_id: id, session: { id, agent, provider: 'claude', model: 'm', step_id: 'plan', status, provider_session_id: providerId },
});
const gateAsked = (id, step) => ({ type: 'approval.requested', approval_id: id, step_id: step, message: 'ok?', choices: null });
const gateAnswered = (id, step, extra = { approved: true, by: 'user' }) => ({ type: 'approval.resolved', approval_id: id, step_id: step, wait_ms: 10, ...extra });
const handoff = (agent, step, visit, note) => ({ type: 'handoff.saved', agent, step_id: step, visit, session_id: `${agent}-1`, path: `handoffs/${step}-v${visit}-${agent}.md`, note });

test('an empty log gives an empty state: no next step, no visits, vars, sessions, notes or gate', () => {
  const state = load()([]);
  assert.equal(state.nextStep, null);
  assert.deepEqual(state.visits, {});
  assert.deepEqual(state.vars, {});
  assert.deepEqual(state.sessions, {});
  assert.deepEqual(state.handoffs, {});
  assert.equal(state.openGate, null);
});

test('counts the finished visits of each step; a run cut during a step resumes at that step, its unfinished visit not counted', () => {
  const events = log(started,
    stepStarted('plan'), stepFinished('plan'), transition('plan', 'work'),
    stepStarted('work', 1), stepFinished('work', 1), transition('work', 'work'),
    stepStarted('work', 2), stepFinished('work', 2), transition('work', 'review'),
    stepStarted('review', 1));
  const state = load()(events);
  assert.deepEqual(state.visits, { plan: 1, work: 2 });
  assert.equal(state.nextStep, 'review');
});

test('a run cut after a transition resumes at the step it routed to', () => {
  const events = log(started, stepStarted('plan'), stepFinished('plan'), transition('plan', 'work'));
  const state = load()(events);
  assert.equal(state.nextStep, 'work');
  assert.deepEqual(state.visits, { plan: 1 });
});

test('a gate asked and never answered is the open gate, and the step to run next', () => {
  const events = log(started, stepStarted('plan'), stepFinished('plan'), transition('plan', 'review'),
    stepStarted('review'), gateAsked('a1', 'review'));
  const state = load()(events);
  assert.equal(state.openGate?.step, 'review');
  assert.equal(state.openGate?.approval_id, 'a1');
  assert.equal(state.nextStep, 'review');
});

test('a gate answered, or withdrawn by a check, is not open', () => {
  const reduce = load();
  const asked = [started, stepStarted('review'), gateAsked('a1', 'review')];
  assert.equal(reduce(log(...asked, gateAnswered('a1', 'review'))).openGate, null);
  assert.equal(reduce(log(...asked, gateAnswered('a1', 'review', { withdrawn: true, by: 'check' }))).openGate, null);
});

test('a run paused at a step resumes at the step its summary says it paused at', () => {
  const summary = { status: 'paused', paused: { step: 'work', next: 'dev', at: '2026-10-26T12:00:09.000Z' }, steps: { plan: { visits: 1, output: { text: 'plan done' } }, work: { visits: 0, output: null } } };
  const events = log(started, stepStarted('plan'), stepFinished('plan'), transition('plan', 'work'),
    { type: 'run.pausing', step_id: 'plan' }, { type: 'workflow.finished', status: 'paused', summary });
  const state = load()(events, summary);
  assert.equal(state.nextStep, 'work');
  assert.deepEqual(state.visits, { plan: 1 });
  assert.equal(state.openGate, null);
});

test('a finished run has nothing to run next', () => {
  const summary = { status: 'success', steps: { plan: { visits: 1, output: { text: 'plan done' } } } };
  const events = log(started, stepStarted('plan'), stepFinished('plan'), transition('plan', 'end'), { type: 'workflow.finished', status: 'success', summary });
  const state = load()(events, summary);
  assert.equal(state.nextStep, null);
  assert.equal(state.openGate, null);
  assert.deepEqual(state.visits, { plan: 1 });
});

test('keeps the latest handoff note of each agent', () => {
  const events = log(started,
    handoff('dev', 'plan', 1, '- planned the work'),
    handoff('rev', 'review', 1, '- asked for a test'),
    handoff('dev', 'work', 2, '- added the test'));
  const { handoffs } = load()(events);
  assert.deepEqual(Object.keys(handoffs).sort(), ['dev', 'rev']);
  assert.deepEqual({ text: handoffs.dev.text, step: handoffs.dev.step, visit: handoffs.dev.visit }, { text: '- added the test', step: 'work', visit: 2 });
  assert.deepEqual({ text: handoffs.rev.text, step: handoffs.rev.step, visit: handoffs.rev.visit }, { text: '- asked for a test', step: 'review', visit: 1 });
});

test("gives each agent's latest session with its provider conversation, never the orchestrator's", () => {
  const events = log(started,
    session('session.opened', 'orchestrator', 'orchestrator', null),
    session('session.opened', 'dev-1', 'dev', null),
    session('session.updated', 'dev-1', 'dev', 'conv-1'),
    session('session.closed', 'dev-1', 'dev', 'conv-1', 'success'),
    session('session.opened', 'dev-2', 'dev', null),
    session('session.updated', 'dev-2', 'dev', 'conv-2'),
    session('session.opened', 'rev-1', 'rev', null),
    session('session.updated', 'rev-1', 'rev', 'conv-r'));
  const { sessions } = load()(events);
  assert.deepEqual(Object.keys(sessions).sort(), ['dev', 'rev']);
  assert.deepEqual({ session_id: sessions.dev.session_id, provider_session_id: sessions.dev.provider_session_id }, { session_id: 'dev-2', provider_session_id: 'conv-2' });
  assert.deepEqual({ session_id: sessions.rev.session_id, provider_session_id: sessions.rev.provider_session_id }, { session_id: 'rev-1', provider_session_id: 'conv-r' });
});

test('is pure: the log is left unchanged and the same log always gives the same state', () => {
  const reduce = load();
  const events = log(started, session('session.opened', 'dev-1', 'dev', 'conv-1'), stepStarted('plan'), stepFinished('plan'),
    handoff('dev', 'plan', 1, '- planned'), transition('plan', 'review'), stepStarted('review'), gateAsked('a1', 'review'));
  const before = JSON.stringify(events);
  const first = reduce(events);
  assert.equal(JSON.stringify(events), before);
  assert.deepEqual(reduce(events), first);
  assert.deepEqual(reduce(JSON.parse(before)), first);
});
