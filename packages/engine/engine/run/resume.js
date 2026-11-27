// @ts-check
// Resume from a step (#250, from packages/engine/engine/workflow.js): what a run restarted from a stopped one
// reuses (and, #368, what a paused run records for it: pausedError, pausedRecord; startResumed
// yields before a resumed run's first step). `seedResume` (constructor) pre-seeds the previous run's step outputs, visits and
// instruction; `replayConfirmedGate` (start, #112) records the gate the owner confirmed in the
// Resume dialog as their decision; `resumeSession` continues an agent's previous provider
// conversation (#233: the CLI's running total seeded); `previousChildren` (#175) the child runs the
// previous run finished; `resumableSteps` the steps the supervisor may resume from;
// `runStateFromEvents` (#606) the state a resume needs, a pure function of the run's log.
// Recovery (#607) is not a resume: a run the app died in continues in its own folder, with its own id,
// at its last finished turn. `recoveryStateFromEvents` adds what that needs to the resume state (each
// step's last output, each session's last snapshot, the turn the crash cut); `seedRecovery`
// (constructor) puts it back in the engine, the gate clock included (`gateClockFromEvents`, #10),
// `startRecovered` (start) records the recovery and the lost turn. The service's start-up picks the runs (packages/engine/service/areas/recover.js). The worktree
// reuse is in packages/engine/engine/run/checkout.js (setupWorktree); the dialog and its channels in packages/engine/domains/supervisor/supervisor.js.

'use strict';

const { checkAttachments, emptyUsage, seedClaudeTotal } = require('../providers');
const { attemptSummary, noteToolCall } = require('./turns');
const { unknownUsd } = require('@craftorio/shared/session-cost');
const { GATE } = require('./field-rules');
const { prMonitorSeed } = require('./transitions');

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
  // requestedAt (ms): when it was asked, for the gate clock (gateClockFromEvents, #10)
  'approval.requested': (acc, ev) => { acc.gates.set(ev.approval_id, { step: ev.step_id, approval_id: ev.approval_id, requestedAt: Date.parse(ev.ts) }); },
  'approval.resolved': (acc, ev) => { acc.gates.delete(ev.approval_id); },
  // #607: a recovery never answers the gate the crash left open, it asks it again under a new id:
  // the gates opened before it are over, and the run continues at the step it recovered at
  'run.recovered': (acc, ev) => {
    acc.gates.clear();
    if (ev.step_id) acc.cursor = ev.step_id;
  },
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
  const last = [...acc.gates.values()].pop();
  const open = last ? { step: last.step, approval_id: last.approval_id } : null;
  const sessions = Object.fromEntries(Object.entries(acc.latestSession).map(([agent, id]) => [agent, { session_id: id, provider_session_id: acc.providerIds.get(id) ?? null }]));
  return { nextStep: nextStepOf(acc, open, summary), visits: acc.visits, vars: acc.vars, sessions, handoffs: acc.handoffs, openGate: open };
}

// #10: the gate clock (#416) of a run rebuilt from its log, through the resume state's reducers (a
// gate opens and closes where it does for runStateFromEvents): the time waited with at least one gate
// open (total, closed intervals; since: the start of the interval still open, ms), the answered waits
// per step (gateWaits, as resolveApproval counts them: a withdrawn gate and the gate a resume
// confirmed are no wait) and the gate left open ({ step, requestedAt } ms, or null). A recovery closes
// the gates opened before it, and the clock with them (startRecovered does the same live); the gate
// it asks again keeps the time it was first asked (gates.js firstAskedAt), so its wait_ms counts it all.
const GATE_CLOCK_EVENTS = ['approval.requested', 'approval.resolved', 'run.recovered'];
/** @param {any[]} events @returns {{ total: number, since: number | null, gateWaits: Record<string, { waits: number, wait_ms: number }>, openGate: { step: string, requestedAt: number } | null }} */
function gateClockFromEvents(events) {
  const acc = { gates: new Map(), cursor: null };
  /** @type {Record<string, { waits: number, wait_ms: number }>} */
  const gateWaits = {};
  let total = 0;
  /** @type {number | null} */
  let since = null;
  /** @type {{ step: string, requestedAt: number } | null} */
  let carried = null; // the gate a recovery left open, until it is asked again
  for (const ev of events || []) {
    if (!GATE_CLOCK_EVENTS.includes(ev.type)) continue;
    const at = Date.parse(ev.ts);
    if (!Number.isFinite(at)) continue;
    if (ev.type === 'run.recovered') carried = ev.gate ? [...acc.gates.values()].pop() || carried : null;
    if (ev.type === 'approval.resolved' && !ev.withdrawn && !ev.confirmed_at_resume && typeof ev.wait_ms === 'number' && ev.step_id) {
      const w = (gateWaits[ev.step_id] ??= { waits: 0, wait_ms: 0 });
      w.waits++;
      w.wait_ms += ev.wait_ms;
    }
    RUN_STATE_REDUCERS[ev.type](acc, ev);
    if (ev.type === 'approval.requested') {
      const asked = acc.gates.get(ev.approval_id);
      if (carried && carried.step === asked.step) asked.requestedAt = carried.requestedAt;
      carried = null;
    }
    if (acc.gates.size) since ??= at;
    else if (since != null) {
      total += Math.max(0, at - since);
      since = null;
    }
  }
  const open = [...acc.gates.values()].pop() || carried;
  return { total, since, gateWaits, openGate: open ? { step: open.step, requestedAt: open.requestedAt } : null };
}

// #607: the resume state plus what a recovery continues with, a pure function of the run's log too:
// - outputs: each step's last finished output (an errored visit's excepted). The same rule as
//   resumeSpec's steps (packages/engine/domains/supervisor/supervisor.js): resumeSpec is meant to
//   read it from here (seedResume built on the reduction, #566's follow-up), not to grow a third copy
// - snapshots: each session's last snapshot (never the orchestrator's: the recovery opens its own)
// - lostTurns: [{ session_id, step_id, turn, attempt, calls, usage, costUsd, modelCalls }], the turns
//   the crash cut (a message_sent no message_received answered, its step still running: several in
//   an `agents:` step); calls: their tool calls [{ id, name, input, result? }], usage / costUsd /
//   modelCalls: what their stream's usage items reported (#233)
// - seq, nSession, nApproval: the highest event seq, session (sN) and gate (aN) numbers, so the
//   recovered run's ids follow on; startedAt: the run's workflow.started time; lastFinished: the step
//   that finished last (the recovered run's previous step)
function recoveryStateFromEvents(events) {
  const outputs = {};
  const snapshots = {};
  const turns = new Map(); // `${session}\n${turn}` -> the open turn
  const num = (id, prefix) => +(new RegExp(`^${prefix}(\\d+)$`).exec(String(id ?? ''))?.[1] || 0);
  let seq = 0;
  let nSession = 0;
  let nApproval = 0;
  let started = null;
  let lastFinished = null;
  for (const ev of events || []) {
    seq = Math.max(seq, +ev.seq || 0);
    if (ev.type === 'workflow.started') started ??= ev;
    if (ev.session?.id && ev.session.agent !== 'orchestrator') snapshots[ev.session.id] = ev.session;
    nSession = Math.max(nSession, num(ev.session_id, 's'));
    nApproval = Math.max(nApproval, num(ev.approval_id, 'a'));
    if (ev.type === 'step.finished') {
      lastFinished = ev.step_id;
      if (!ev.error) outputs[ev.step_id] = ev.output ?? null;
    }
    noteTurnEvent(turns, ev);
  }
  const lostTurns = [...turns.values()].map((t) => ({ ...t, calls: [...t.calls.values()] }));
  return {
    ...runStateFromEvents(events), outputs, snapshots, lostTurns, seq, nSession, nApproval, lastFinished,
    startedAt: started?.ts ? Date.parse(started.ts) : null,
  };
}

// the turns still open after one event (`${session}\n${turn}` -> the turn): a message_sent opens one,
// its message_received, its session's close or its step's end closes it
function noteTurnEvent(turns, ev) {
  const key = `${ev.session_id}\n${ev.turn}`;
  if (ev.type === 'step.finished') { for (const [k, t] of turns) if (t.step_id === ev.step_id) turns.delete(k); }
  else if (ev.type === 'session.message_sent') {
    turns.set(key, { session_id: ev.session_id, step_id: ev.step_id ?? null, turn: ev.turn, attempt: 1, calls: new Map(), usage: null, costUsd: null, modelCalls: 0 });
  } else if (ev.type === 'session.message_received') turns.delete(key);
  else if (ev.type === 'session.closed') { for (const [k, t] of turns) if (t.session_id === ev.session_id) turns.delete(k); }
  else if (ev.type === 'session.attempt_stopped' && turns.has(key)) {
    // a retry of the same turn after a stopped attempt: its own calls and usage only
    Object.assign(turns.get(key), { attempt: (ev.attempt || 1) + 1, calls: new Map(), usage: null, costUsd: null, modelCalls: 0 });
  } else if (ev.type === 'session.stream' && turns.has(key)) noteStreamItem(turns.get(key), ev.item || {});
}

// one stream item of a turn the crash may cut: its tool calls with their results, its model calls' usage
function noteStreamItem(t, item) {
  noteToolCall(t.calls, item);
  if (item.kind !== 'usage') return;
  t.modelCalls++;
  t.usage ??= {};
  for (const [k, v] of Object.entries(item.usage || {})) if (typeof v === 'number') t.usage[k] = (t.usage[k] || 0) + v;
  if (typeof item.costUsd === 'number') t.costUsd = (t.costUsd || 0) + item.costUsd;
}

// #607: a session as the engine holds it, back from its last recorded snapshot (sessions.js openSession)
function sessionFromSnapshot(snap) {
  const at = (v) => (v ? Date.parse(v) : null);
  return {
    id: snap.id, agent: snap.agent, provider: snap.provider, model: snap.model, effort: snap.effort || null,
    parentId: snap.parent_id ?? null, stepId: snap.step_id ?? null, mode: snap.mode || null,
    simulates: snap.simulates || null, fallbackFrom: snap.fallback_from || null, account: snap.account || null, accountDir: null,
    openedAt: at(snap.opened_at) ?? Date.now(), closedAt: at(snap.closed_at),
    turns: snap.turns || 0, activeMs: snap.active_ms || 0, tokens: { ...emptyUsage(), ...(snap.tokens || {}) }, costUsd: snap.cost_usd || 0,
    status: snap.status || 'idle', providerSessionId: snap.provider_session_id ?? null, cwd: snap.cwd || null,
    ...(snap.estimated_cost_usd ? { estimatedUsd: snap.estimated_cost_usd } : {}),
    ...(snap.cost_not_recorded ? { costNotRecorded: true } : {}),
    ...(snap.cli_total_cost_usd != null ? { cliTotalUsd: snap.cli_total_cost_usd } : {}),
    ...(snap.cost_estimate ? { costEstimate: { ...snap.cost_estimate }, cliOnlyUsd: unknownUsd(snap.cost_estimate) || 0 } : {}),
    lastTurnAt: at(snap.last_turn_at), contextTokens: snap.context_tokens ?? null, startContextTokens: snap.start_context_tokens ?? null,
  };
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

  // #607: a recovered run's engine state from its log (recover: { events, worktree }), as the process
  // the app died in held it: each visited step's last output and visits, `vars`, the handoff notes,
  // every agent session (an open persistent one is the agent's again), the event, session and gate
  // counters, the progress trail and the attachments its workflow.started recorded, the gate clock and
  // gate waits (#10, gateClockFromEvents); any other run: none
  seedRecovery(recover) {
    this.recovered = null;
    if (!recover) return;
    const events = recover.events || [];
    const state = recoveryStateFromEvents(events);
    // #10: the time already waited at gates (the open one included), so checkLimits never counts it as work
    const clock = gateClockFromEvents(events);
    this.gateClock = { total: clock.total, since: clock.since };
    this.gateWaits = clock.gateWaits;
    for (const [id, visits] of Object.entries(state.visits)) {
      const output = state.outputs[id] ?? null;
      if (this.ctx.steps[id]) Object.assign(this.ctx.steps[id], { output, outputs: output ? [output] : [], visits });
    }
    Object.assign(this.ctx.vars, state.vars);
    for (const [agent, note] of Object.entries(state.handoffs)) this.handoffNotes.set(agent, note);
    for (const snap of Object.values(state.snapshots)) {
      const s = sessionFromSnapshot(snap);
      // #312: the folder of the account that opened it; an account gone since keeps the conversation
      // behind (it never moves to another account): the agent opens a new session from its handoff note
      s.accountDir = (s.account && this.enabledAccounts(s.provider).find((a) => a.name === s.account)?.dir) || null;
      this.sessions.set(s.id, s);
      if (s.closedAt || (s.mode && s.mode !== 'persistent') || (s.account && !s.accountDir)) continue;
      this.agentSessions.set(s.agent, s.id);
      // #233: the CLI's running total of that conversation, so its next turn costs only its own part
      if (!this.machine.simulated && s.providerSessionId && s.cliTotalUsd != null) seedClaudeTotal(s.providerSessionId, s.cliTotalUsd);
    }
    for (const ev of events) if (ev.type !== 'session.stream') this.trail.apply(ev);
    Object.assign(this, { seq: state.seq, nSession: state.nSession, nApproval: state.nApproval, prevStepId: state.lastFinished });
    this.attachments = events.find((e) => e.type === 'workflow.started')?.attachments || {};
    this.recovered = { nextStep: state.nextStep, lostTurns: state.lostTurns, startedAt: state.startedAt, worktree: recover.worktree || null, from: state.seq, openGate: clock.openGate };
    // #809: recovered in its PR monitor: it holds no run slot from the start (another recovered run may
    // start before its first read), with its last card and when it last changed
    if (this.wf.steps.find((s) => s.id === state.nextStep)?.type === 'pr_monitor') Object.assign(this, prMonitorSeed(events, state.nextStep));
  },

  // #607: the start of a recovered run: `run.recovered` (never a second workflow.started: the run is
  // the same one), then each turn the crash cut (recordLostTurn).
  startRecovered() {
    const r = this.recovered;
    this.emitEvent('run.recovered', {
      step_id: r.nextStep, after_seq: r.from, gate: !!r.nextStep && GATE.includes(this.wf.steps.find((s) => s.id === r.nextStep)?.type),
      lost_turns: r.lostTurns.map((t) => ({ session_id: t.session_id, step_id: t.step_id, turn: t.turn })),
    });
    // #10: the gates open before the recovery are over (gateClockFromEvents): the time waited at them
    // stays gate time, and a gate the recovered step asks again starts the clock again
    this.syncGateClock();
    for (const lost of r.lostTurns) this.recordLostTurn(lost);
    // #811: a fix round the restart cut (prMonitorSeed) ends failed, so the card offers "Ask for a fix" again
    const cut = this.prFixInterrupted;
    if (cut) {
      this.prFixInterrupted = null;
      this.emitEvent('pr.fix', { step_id: r.nextStep, ...cut, status: 'failed', reason: 'the app restarted during the fix' });
    }
  },

  // #10: a step visit starts (runStep): only the recovered step's first visit asks the open gate again
  // with its first requested_at (gates.js firstAskedAt); a later visit asks a new gate
  noteRecoveredVisit() {
    const r = this.recovered;
    if (!r) return;
    if (r.visited) r.openGate = null;
    r.visited = true;
  },

  // #607: a turn the crash cut, recorded as a stopped attempt with what its stream reported (#233,
  // countStoppedAttempt; nothing reported: its cost is not recorded) and told to the agent's next turn
  // of that step as a <previous_attempt> block (runAgentStep, st.lostTurns by agent). Its ephemeral or
  // handoff session closes; a persistent one stays the agent's.
  recordLostTurn(lost) {
    const session = this.sessions.get(lost.session_id);
    if (!session) return;
    const err = Object.assign(new Error('the app stopped during this turn; the run was recovered at the next start'), {
      partial: { usage: lost.usage, costUsd: lost.costUsd, modelCalls: lost.modelCalls },
    });
    const agent = { ...(this.wf.defaults || {}), ...(this.wf.agents[session.agent] || {}) };
    const at = { session, agent, stepId: lost.step_id, turn: lost.turn, attempt: lost.attempt };
    if (!this.countStoppedAttempt(at, err).note) {
      // nothing reported by its stream: still recorded, its cost "not recorded" rather than 0
      session.costNotRecorded = true;
      this.emitEvent('session.attempt_stopped', {
        session_id: session.id, turn: lost.turn, step_id: lost.step_id, attempt: lost.attempt, error: err.message, usage: null, model_calls: 0,
        cost_usd: null, estimated: false, cost_not_recorded: true, session: this.snapshot(session),
      });
    }
    if (session.mode && session.mode !== 'persistent') this.closeSession(session, 'failed');
    const st = lost.step_id && this.ctx.steps[lost.step_id];
    if (st) (st.lostTurns ??= {})[session.agent] = attemptSummary(new Map(lost.calls.map((c) => [c.id, c])), err, lost.attempt);
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
    return this.wf.steps.filter((s) => !GATE.includes(s.type) && this.ctx.steps[s.id]?.visits > 0).map((s) => s.id);
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
  gateClockFromEvents,
  methods,
  pausedError,
  recoveryStateFromEvents,
  runStateFromEvents,
};
