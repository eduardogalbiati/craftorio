// #606: the state a resume needs, read two ways for the same run: from the WorkflowRun that ran it,
// in memory (liveState), and from what it recorded, runs/<id>/events.jsonl and summary.json
// (replayState, through runStateFromEvents). Used by the slow files run-state-from-events-*-606; a
// helper: it registers no test at load (#305).
//
// The seam (packages/engine/engine/run/resume.js, written before the code):
//   runStateFromEvents(events, summary = null) -> {
//     nextStep,  // the step a resume runs next: the gate left open, the step a pause stopped at
//                // (summary.paused.step), the step started or routed to and not finished; null once
//                // the run finished (or for an empty log)
//     visits,    // { [stepId]: finished visits } (steps never finished are left out)
//     vars,      // the run's vars (`set:` on transitions), {} when none
//     sessions,  // { [agent]: { session_id, provider_session_id } }: each agent's latest session
//     handoffs,  // { [agent]: { text, step, visit } }: each agent's latest handoff note (path may follow)
//     openGate,  // { step, approval_id } of a gate asked and never answered, else null
//   }
// pure: it neither reads files nor changes its arguments.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');
const { Recorder } = require('../engine/recorder');

const root = path.join(__dirname, '..', '..', '..');
// loaded when called: the export does not exist before #606
const runStateFromEvents = (...args) => {
  const fn = require('../engine/run/resume').runStateFromEvents;
  if (typeof fn !== 'function') throw new Error('packages/engine/engine/run/resume.js exports no runStateFromEvents');
  return fn(...args);
};

function readLog(runDir) {
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  let summary = null;
  try { summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8')); } catch { /* no summary */ }
  return { events, summary };
}

// The state the run holds in memory once it ended (finished, or paused).
function liveState(run) {
  const visits = Object.fromEntries(Object.entries(run.ctx.steps).filter(([, s]) => s.visits > 0).map(([id, s]) => [id, s.visits]));
  const sessions = {};
  for (const [agent, id] of run.agentSessions) {
    const s = run.sessions.get(id);
    if (s && agent !== 'orchestrator') sessions[agent] = { session_id: s.id, provider_session_id: s.providerSessionId ?? null };
  }
  const handoffs = Object.fromEntries([...run.handoffNotes].map(([agent, h]) => [agent, { text: h.text, step: h.step, visit: h.visit }]));
  const pausedAt = run.paused?.step ?? null;
  const gate = pausedAt && run.wf.steps.find((s) => s.id === pausedAt)?.type === 'human_approval' ? pausedAt : null;
  return { nextStep: pausedAt, visits, vars: { ...run.ctx.vars }, sessions, handoffs, openGate: gate };
}

// The same, from the run's recorded files; sessions compared for the agents the live run keeps one for.
function replayState(run, live) {
  const { events, summary } = readLog(run.runDir);
  const state = runStateFromEvents(events, summary);
  const sessions = Object.fromEntries(Object.keys(live.sessions).map((agent) => {
    const s = state.sessions?.[agent];
    return [agent, { session_id: s?.session_id ?? null, provider_session_id: s?.provider_session_id ?? null }];
  }));
  const handoffs = Object.fromEntries(Object.entries(state.handoffs || {}).map(([agent, h]) => [agent, { text: h.text, step: h.step, visit: h.visit }]));
  return { nextStep: state.nextStep ?? null, visits: state.visits, vars: state.vars, sessions, handoffs, openGate: state.openGate?.step ?? null };
}

// A mock run of `file` to its end, recorded like the app records it. Gates get `answers[step]`
// (default: the first choice, or approve); `pauseAt` (a gate's step id): the run is paused there
// instead, the gate left unanswered.
async function recordedRun(t, { file, inputs = {}, mockSequences, answers = {}, pauseAt, options = {} }) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-606-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 }));
  const run = new WorkflowRun({ file, inputs, mock: true, runsDir, mockSequences, ...options });
  const rec = new Recorder(run.runDir, run.wf.observability?.capture?.redact);
  run.on('event', (ev) => {
    rec.write(ev);
    if (ev.type !== 'approval.requested') return;
    if (ev.step_id === pauseAt) { setImmediate(() => run.pause()); return; }
    const answer = answers[ev.step_id] ?? (ev.choices?.length ? ev.choices[0].id : true);
    setImmediate(() => run.resolveApproval(ev.approval_id, answer));
  });
  await run.start();
  return run;
}

module.exports = { root, readLog, liveState, replayState, recordedRun, runStateFromEvents };
