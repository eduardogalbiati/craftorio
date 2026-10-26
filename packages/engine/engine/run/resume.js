// @ts-check
// Resume from a step (#250, from packages/engine/engine/workflow.js): what a run restarted from a stopped one
// reuses (and, #368, what a paused run records for it: pausedError, pausedRecord; startResumed
// yields before a resumed run's first step). `seedResume` (constructor) pre-seeds the previous run's step outputs, visits and
// instruction; `replayConfirmedGate` (start, #112) records the gate the owner confirmed in the
// Resume dialog as their decision; `resumeSession` continues an agent's previous provider
// conversation (#233: the CLI's running total seeded); `previousChildren` (#175) the child runs the
// previous run finished; `resumableSteps` the steps the supervisor may resume from;
// `runStateFromEvents` (#606) the state a resume needs, a pure function of the run's log. The worktree
// reuse is in packages/engine/engine/run/checkout.js (setupWorktree); the dialog and its channels in packages/engine/domains/supervisor/supervisor.js.

'use strict';

const { checkAttachments, seedClaudeTotal } = require('../providers');

// #368: what ends a run that pauses (the step loop, a gate left unanswered, children that paused):
// status `paused`, not an error (WorkflowRun#endOfError)
const pausedError = () => Object.assign(new Error('Paused after the current turn'), { paused: true });

// #606: the state a resume needs, a pure function of a run's events.jsonl (and its summary.json):
// { nextStep, visits, vars, sessions, handoffs, openGate }, the same as the WorkflowRun that recorded
// them holds in memory. Reads no file and changes nothing it is given (like upgradeRunRecord, #350).
// - visits: the highest visit started per step; the visit a run was cut or paused in, unfinished,
//   is not counted (WorkflowRun#endOfError); steps never visited are left out
// - nextStep: null once the run finished (or for an empty log); a paused run's summary.paused.step;
//   else the gate left open; else the step started or routed to last (`end`: null)
// - vars: the `set:` of each step.transition; sessions: each agent's latest persistent session
//   (never the orchestrator's), from its latest snapshot (a session event or a turn's answer); handoffs: each agent's latest note
// - openGate: { step, approval_id } of an approval.requested no approval.resolved answered (or withdrew)
const visitKey = (ev) => `${ev.step_id}\n${ev.visit || 1}`;

// a session event: its snapshot's provider conversation, and the agent's latest persistent session
// (an ephemeral or handoff one is not the one the agent continues)
function reduceSession(acc, ev) {
  const s = ev.session;
  if (!s || s.agent === 'orchestrator') return;
  acc.providerIds.set(s.id, s.provider_session_id ?? null);
  if (ev.type === 'session.opened' && (!s.mode || s.mode === 'persistent')) acc.latestSession[s.agent] = s.id;
}

// one reducer per event type the resume state reads (#606); the others leave it as it is
const RUN_STATE_REDUCERS = {
  'step.started': (acc, ev) => {
    acc.visits[ev.step_id] = Math.max(acc.visits[ev.step_id] || 0, ev.visit || 1);
    acc.lastStarted = ev;
    acc.cursor = ev.step_id;
  },
  'step.finished': (acc, ev) => { acc.finishedVisits.add(visitKey(ev)); },
  'step.transition': (acc, ev) => {
    acc.cursor = ev.to;
    Object.assign(acc.vars, structuredClone(ev.set || {}));
  },
  'session.opened': reduceSession,
  'session.updated': reduceSession,
  'session.closed': reduceSession,
  // a turn's answer records the provider conversation before session.updated (a run cut in between)
  'session.message_received': reduceSession,
  'handoff.saved': (acc, ev) => {
    if (ev.note) acc.handoffs[ev.agent] = { text: ev.note, step: ev.step_id, visit: ev.visit, path: ev.path ?? null };
  },
  'approval.requested': (acc, ev) => { acc.gates.set(ev.approval_id, { step: ev.step_id, approval_id: ev.approval_id }); },
  'approval.resolved': (acc, ev) => { acc.gates.delete(ev.approval_id); },
  'workflow.finished': (acc, ev) => { acc.finished = ev; },
};

// the step a resume runs next: none once the run finished; a paused run's summary.paused.step;
// else the gate left open, else the step started or routed to last
function nextStepOf(acc, open, summary) {
  const finished = acc.finished;
  if (finished?.status === 'paused') return summary?.paused?.step ?? finished.summary?.paused?.step ?? open?.step ?? null;
  if (finished) return null;
  return open?.step ?? (acc.cursor === 'end' ? null : acc.cursor);
}

function runStateFromEvents(events, summary = null) {
  /** @type {{ visits: Record<string, number>, vars: Record<string, any>, providerIds: Map<string, any>, latestSession: Record<string, string>, handoffs: Record<string, any>, gates: Map<string, any>, finishedVisits: Set<string>, lastStarted: any, cursor: any, finished: any }} */
  const acc = {
    visits: {}, vars: {}, providerIds: new Map(), latestSession: {}, handoffs: {}, gates: new Map(),
    finishedVisits: new Set(), lastStarted: null, cursor: null, finished: null,
  };
  for (const ev of events || []) RUN_STATE_REDUCERS[ev.type]?.(acc, ev);
  // the visit the run was cut or paused in, unfinished: not counted (a failed or stopped run keeps it)
  const cut = !acc.finished || acc.finished.status === 'paused';
  const step = acc.lastStarted?.step_id;
  if (cut && step && !acc.finishedVisits.has(visitKey(acc.lastStarted)) && --acc.visits[step] <= 0) delete acc.visits[step];
  const open = [...acc.gates.values()].pop() || null;
  const sessions = Object.fromEntries(Object.entries(acc.latestSession).map(([agent, id]) => [agent, { session_id: id, provider_session_id: acc.providerIds.get(id) ?? null }]));
  return { nextStep: nextStepOf(acc, open, summary), visits: acc.visits, vars: acc.vars, sessions, handoffs: acc.handoffs, openGate: open };
}

const methods = {
  // The start of a resumed run: it yields once first (#368: it may start at a gate, a run paused
  // there; its starter gets the new run's id before the gate opens, so it hears it asked again),
  // then records the gate the owner confirmed (replayConfirmedGate).
  async startResumed() {
    if (!this.resume) return;
    await new Promise((resolve) => setImmediate(resolve));
    this.replayConfirmedGate();
  },

  // #368: { paused: { step, next, at } } for a run that ended paused (summary.json, workflow.finished), else {}
  pausedRecord(status) {
    return status === 'paused' && this.paused ? { paused: this.paused } : {};
  },

  // The previous run's step outputs and visits (never the resumed step's own, except for a paused
  // run, #368: its steps are its finished visits, so the resumed step counts on from them), its
  // instruction as the resumed step's supervisor note, and the images pasted into it (#130: checked
  // here, copied at start, given to the first agent step).
  seedResume(resume) {
    if (!this.wf.steps.some((x) => x.id === resume.fromStep)) throw new Error(`Cannot resume: step "${resume.fromStep}" does not exist in this workflow.`);
    for (const [id, v] of Object.entries(resume.steps || {})) {
      if (this.ctx.steps[id] && (resume.paused || id !== resume.fromStep)) Object.assign(this.ctx.steps[id], { output: v.output ?? null, outputs: v.output ? [v.output] : [], visits: v.visits || 1 });
    }
    if (resume.instruction) this.ctx.steps[resume.fromStep].supervisorNote = resume.instruction;
    // images pasted into the instruction (#130): checked here, copied at start, given to the first agent step
    this.resumeImages = checkAttachments(resume.images || []);
  },

  // the owner confirmed, in the Resume from step dialog, a gate the previous run decided (#112):
  // recorded as the owner's decision; automation never sets `confirmedGate`
  replayConfirmedGate() {
    const confirmed = this.resume?.confirmedGate;
    if (confirmed) {
      const out = this.ctx.steps[confirmed.step]?.output || {};
      const data = out.choice !== undefined ? { choice: out.choice } : { approved: out.approved !== false };
      this.emitEvent('approval.resolved', {
        approval_id: `resume-${confirmed.step}`, step_id: confirmed.step, ...data, by: 'owner', confirmed_at_resume: true,
        note: 'confirmed at resume', wait_ms: 0, ...(confirmed.commit ? { commit: confirmed.commit } : {}),
      });
    }
  },

  // resumed run: continue the agent's previous conversation (its system prompt is already there),
  // only for its first session in this run, and only on the account that opened it (#312: a
  // conversation never moves to another account; the agent starts from its handoff note instead)
  resumeSession(agentName, session, persistent) {
    this.resumeSessions ??= { ...(this.resume?.sessions || {}) };
    const sameAccount = (this.resume?.sessionAccounts?.[agentName] || null) === (session.account || null);
    const previous = persistent && !this.machine.simulated && sameAccount && this.resumeSessions[agentName];
    delete this.resumeSessions[agentName];
    if (previous) {
      session.providerSessionId = previous; session.turns = 1;
      // #233: the CLI's running total of that session, so the next turn costs only its own part
      seedClaudeTotal(previous, this.resume?.cliTotals?.[previous]);
    }
  },

  // The agent steps the run went through: where the supervisor may resume it.
  resumableSteps() {
    return this.wf.steps.filter((s) => s.type !== 'human_approval' && this.ctx.steps[s.id]?.visits > 0).map((s) => s.id);
  },

  // A resumed run (#175): the children the previous run started for the step it resumes from, by item
  // index ({ <index>: { run_id, status, label } }, the latest per index), the first time it runs that step
  // only (a later visit starts its children afresh); null when there are none.
  previousChildren(step) {
    const r = this.resume;
    if (!r?.childRuns?.length || r.fromStep !== step.id || this.previousChildrenUsed) return null;
    this.previousChildrenUsed = true;
    const out = {};
    for (const c of r.childRuns) if (c.step_id === step.id && c.run_id) out[c.index ?? 0] = { run_id: c.run_id, status: c.status, label: c.label ?? null };
    return Object.keys(out).length ? out : null;
  },
};

module.exports = {
  methods,
  pausedError,
  runStateFromEvents,
};
