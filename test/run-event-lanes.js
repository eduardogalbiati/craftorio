// Test helper (#323): the events of a run, shaped so that a comparison does not depend on how
// concurrent sessions interleave (code_review runs reviewer and ui_reviewer at the same time, the
// mock provider waits a random time before each item). Each event is labelled `type` (plus
// `step_id` when it has one) and put in a lane: the step it happened in (`<step_id>#<visit>`, or
// `(start)` before the first step) and who emitted it (the agent of its session, or of its
// `agent` field; `run` for the engine's own events). `steps` keeps the run's step.* and
// workflow.* events in order; `lanes` keeps each lane's events in order. An event that disappears,
// appears twice or moves to another step changes a lane; two sessions that interleave differently
// do not. Used by test/slow/engine-run-split-250.slow.test.js (and its baseline recorder).
const label = (ev) => {
  if (ev.type === 'step.transition') return `${ev.type} ${ev.from}>${ev.to}`;
  return ev.step_id ? `${ev.type} ${ev.step_id}` : ev.type;
};

function eventLanes(events) {
  const agentOf = new Map(); // session_id -> agent
  const steps = [];
  const lanes = {};
  let step = '(start)';
  for (const ev of events) {
    if (ev.type === 'session.opened' && ev.session_id) agentOf.set(ev.session_id, (ev.session && ev.session.agent) || ev.session_id);
    if (ev.type === 'step.started') step = `${ev.step_id}#${ev.visit || 1}`;
    if (/^(step|workflow)\./.test(ev.type)) steps.push(label(ev));
    const who = ev.session_id ? (agentOf.get(ev.session_id) || ev.session_id) : (ev.agent || 'run');
    const lane = `${step} ${who}`;
    (lanes[lane] = lanes[lane] || []).push(label(ev));
  }
  return { count: events.length, steps, lanes };
}

module.exports = { eventLanes };
