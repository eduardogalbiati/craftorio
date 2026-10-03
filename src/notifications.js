// Desktop notifications: what deserves one and whether to show it. No Electron here: the service
// emits `notify` events ({ kind, event, title, body, target }) and the desktop layer shows them.
//
// Two kinds, each with its own setting:
//   run      a workflow run changed status (started, waiting on a human gate, succeeded, failed,
//            cancelled, interrupted); target = { runId, workflow }; or a push met a merge conflict
//            (event `conflict`); target = { view: 'backlog', projectId }; or a live roadmap refilled
//            itself or stopped refilling (#164, events refilled | empty | budget | failed)
//   session  an AI CLI in a Sessions terminal stopped and waits for the user; target = { terminalId }
//   po       the Backlog's Product Owner answered a question (#149); target = { view: 'backlog', projectId, openPO: true }
//   oracle   the Oracle acted on its own under the owner's Night watch (#123); target = { openOracle: true };
//            or a Night watch ended (its morning summary, #172); target = { view: 'nightwatch' }
//
// Nothing is shown while the window is focused on the notice's run, session or Product Owner drawer.

const SETTING = { oracle: 'notifyOracle', po: 'notifyPO', run: 'notifyRuns', session: 'notifySessions' };
const STATUS_LABEL = { success: 'succeeded', failed: 'failed', cancelled: 'cancelled', interrupted: 'interrupted' };

const clip = (s, n = 180) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// The notice for a run event, or null. `run`: { workflow, project (name or null), mock, title? }:
// the run's display title (#84) is shown with its workflow, "Title (workflow)".
function runNotice(ev, run = {}) {
  const workflow = run.workflow || ev.workflow || 'Workflow';
  const name = () => (run.title ? `${run.title} (${workflow})` : workflow);
  const lines = (detail) => [`Project: ${run.project || 'none'}${run.mock ? ' (simulation)' : ''}`, detail && clip(detail)].filter(Boolean).join('\n');
  const notice = (event, title, detail) => ({
    kind: 'run', event, title, body: lines(detail), target: { runId: ev.run_id, workflow },
  });
  switch (ev.type) {
    case 'workflow.started':
      return notice('started', `Run started: ${name()}`, ev.resumed_from ? `Resumed from ${ev.resumed_from.run_id} at ${ev.resumed_from.step}` : '');
    case 'approval.requested':
      // the gate's "What happened" line (#213), else its message
      return notice('waiting', `Waiting for you: ${name()}`, ev.brief?.headline || ev.message || `Approval needed at ${ev.step_id}`);
    case 'workflow.finished': {
      const label = STATUS_LABEL[ev.status] || ev.status;
      const ok = ev.status === 'success' ? (ev.summary?.local_merge ? `Merged locally into ${ev.summary.local_merge.base}, not pushed yet.` : '') : ev.error;
      return notice(ev.status === 'success' ? 'succeeded' : label, `Run ${label}: ${name()}`, ok);
    }
    default:
      return null;
  }
}

// The notice for a run that died with the app (found at the next start).
function interruptedNotice({ runId, workflow, project, mock, title }) {
  return runNotice({ type: 'workflow.finished', run_id: runId, status: 'interrupted', error: 'The app closed while the run was in progress. Resume it from the run screen.' }, { workflow, project, mock, title });
}

// The notice for a CLI waiting in a Sessions terminal.
function sessionNotice(terminalId, { title } = {}, message = '') {
  return {
    kind: 'session', event: 'waiting',
    title: `Waiting for you: ${clip(title || 'CLI session', 80)}`,
    body: clip(message) || 'The CLI stopped and is waiting for your answer.',
    target: { terminalId },
  };
}

// The notice for a merge conflict met by Push / Update and push (#69): a `run` notice (same setting)
// whose target opens the project's Backlog, where "Resolve in a run" hands it to a workflow.
function pushConflictNotice({ project = {}, base, files = [], error } = {}) {
  const list = (files || []).map(String);
  return {
    kind: 'run', event: 'conflict',
    title: `Merge conflict: ${clip(project.name || project.id || 'project', 80)}`,
    body: clip([list.length ? `Local ${base || 'base'} conflicts with origin in ${list.join(', ')}.` : '', error].filter(Boolean).join(' ')) || 'The local base conflicts with origin.',
    target: { view: 'backlog', projectId: project.id || null },
  };
}

// The notice for a Product Owner's answer (#149): `message` is the answer recorded by
// src/product-owner.js ask() ({ text, error, mode, issue }); `project`: { id, name }.
function productOwnerNotice({ project = {}, message = {} } = {}) {
  const name = clip(project.name || project.id || 'project', 80);
  const draft = message.mode === 'issue' && message.issue?.draft?.title;
  return {
    kind: 'po', event: message.error ? 'failed' : 'answered',
    title: message.error ? `The Product Owner could not answer: ${name}` : `The Product Owner answered: ${name}`,
    body: clip(draft ? `Draft: ${draft}` : message.text) || 'Open the Backlog to read the answer.',
    target: { view: 'backlog', projectId: project.id || null, openPO: true },
  };
}

// The notice for an action the Oracle took without asking, under the Night watch (#123):
// { title, body, ok } from src/oracle.js.
function oracleNotice({ title, body, ok = true } = {}) {
  return {
    kind: 'oracle', event: ok ? 'acted' : 'failed',
    title: clip(title || 'Oracle', 120),
    body: clip(body) || 'Open the Oracle to see what it did.',
    target: { openOracle: true },
  };
}

// The morning summary when a Night watch ends (#172): { ran, did, waits, safety, alarm } from
// src/night-watch.js morningSummary; opens the Night watch screen.
function nightWatchNotice({ ran, did, waits, safety, alarm = false } = {}) {
  return {
    kind: 'oracle', event: alarm ? 'night-alarm' : 'night-summary',
    title: alarm ? 'Night watch ended: safety alarm' : 'Night watch ended',
    body: clip([did, waits, alarm ? safety : ran].filter(Boolean).join(' '), 240) || 'Open the Night watch to see the night.',
    target: { view: 'nightwatch' },
  };
}

// The notice for a run's chain (#134, src/service/areas/chain.js): `state` started | paused | done,
// `message` what happened; opens the run (paused: to resume or drop the chain), or the next run.
const CHAIN_TITLE = { done: 'Chain done', paused: 'Chain paused', started: 'Chain: next run started' };
function chainNotice({ runId, workflow, state, message, nextRunId = null } = {}) {
  return {
    kind: 'run', event: state === 'paused' ? 'failed' : 'finished',
    title: `${CHAIN_TITLE[state] || 'Chain'}: ${clip(workflow || runId || 'run', 60)}`,
    body: clip(message) || 'Open the run to see its chain.',
    target: { runId: nextRunId || runId, workflow: workflow || null },
  };
}

// The notice for a live roadmap's refill (#164): `refill` is the roadmap's liveRefill ({ status,
// added, message }, src/live-roadmap.js); opens the project's Backlog.
const LIVE_TITLE = {
  added: (r) => `Live roadmap: +${r.added} stage${r.added === 1 ? '' : 's'}`,
  budget: () => 'Live roadmap stopped: daily budget reached',
  empty: () => 'Live roadmap: nothing left to pick',
  failed: () => 'Live roadmap paused: the refill failed',
};
function liveRoadmapNotice({ project = {}, refill = {} } = {}) {
  const title = (LIVE_TITLE[refill.status] || (() => 'Live roadmap'))(refill);
  return {
    kind: 'run', event: refill.status === 'added' ? 'refilled' : refill.status || 'refilled',
    title: `${title}: ${clip(project.name || project.id || 'project', 60)}`,
    body: clip(refill.message) || 'Open the Backlog to see the roadmap.',
    target: { view: 'backlog', projectId: project.id || null },
  };
}

// What the window shows, as reported by the UI: { focused, runId, terminalId, poProjectId } (poProjectId:
// the project whose Product Owner drawer is open on the Backlog).
function normalizeContext(ctx) {
  const id = (v) => (typeof v === 'string' && v ? v : null);
  return {
    focused: !!ctx?.focused,
    runId: id(ctx?.runId),
    terminalId: id(ctx?.terminalId),
    poProjectId: id(ctx?.poProjectId),
  };
}

function shouldNotify(notice, { settings = {}, context } = {}) {
  if (!notice) return false;
  if (settings[SETTING[notice.kind]] === false) return false;
  const ctx = normalizeContext(context);
  if (!ctx.focused) return true;
  const t = notice.target || {};
  if (t.openPO) return !(t.projectId && t.projectId === ctx.poProjectId);
  return !((t.runId && t.runId === ctx.runId) || (t.terminalId && t.terminalId === ctx.terminalId));
}

// ---- CLIs waiting in a terminal ---------------------------------------------------------------
// Explicit signals a CLI may write to ask for attention: OSC 9 (iTerm2/Windows Terminal style;
// `9;4;…` is a progress bar, not a message), OSC 777 notify, or a bell. Other OSC sequences (window
// title, colors…) also end with a BEL character, which is not a bell.
const OSC = /\x1b\](\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
function attentionSignal(data) {
  let message = null;
  let found = false;
  const rest = String(data).replace(OSC, (_m, code, payload) => {
    if (code === '9' && !/^\d+(;|$)/.test(payload)) { found = true; message ??= payload; }
    if (code === '777' && payload.startsWith('notify;')) {
      found = true;
      const [, title, body] = payload.split(';');
      message ??= [title, body].filter(Boolean).join(': ');
    }
    return '';
  });
  if (!found && !rest.includes('\x07')) return null;
  return { message: message || '' };
}

// The text lines a terminal output leaves on screen, roughly: escape sequences removed, cursor moves
// to another line (TUIs redraw that way) and carriage returns taken as line breaks.
function screenLines(raw) {
  return String(raw)
    .replace(OSC, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*([@-~])/g, (_m, final) => ('HfBEd'.includes(final) ? '\n' : ''))
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
    .split('\n').map((l) => l.trim()).filter(Boolean);
}

// While working, Claude Code and Codex show "esc to interrupt" next to their spinner.
const WORKING = /\besc to interrupt\b|\bctrl\+c to (interrupt|cancel)\b/i;
// A line that asks the user for something: a question, a yes/no, a numbered choice, an empty input
// box (Claude's "│ >", Codex's "›"), Claude's idle footer ("? for shortcuts"), "press enter".
const PROMPTS = [
  /\?\s*[)\]│|]?\s*$/,
  /[([]\s*y(es)?\s*\/\s*n(o)?\s*[)\]]/i,
  /^[│|]?\s*(do you want|would you like|allow|approve)\b/i,
  /^[│|]?\s*[❯›>]\s*\d+[.)]\s/,
  /^[│|]?\s*[❯›>]\s*[│|]?$/,
  /^\?\s+for shortcuts/i,
  /\bpress enter\b/i,
  /^[│|]?\s*(enter|type)\b.*:\s*$/i,
];

// The prompt-like line at the end of a terminal's output (its last lines), or null: none, or the
// CLI still says it is working.
function promptLine(raw, last = 12) {
  const lines = screenLines(raw).slice(-last);
  if (lines.some((l) => WORKING.test(l))) return null;
  for (let i = lines.length - 1; i >= 0; i--) if (PROMPTS.some((re) => re.test(lines[i]))) return lines[i];
  return null;
}

// Watches terminals for a CLI that stopped and waits for the user. After the user types in a
// terminal, the CLI works (output keeps coming: text, spinners, timers). It is waiting when an
// attention signal arrives, or when the output goes quiet for `idleMs` with a prompt-like line at
// its end (a quiet tool call without one is still work). onWaiting(id, info, message) is called
// once, and again only after the user types again.
const TAIL = 8000;
class WaitDetector {
  constructor({ idleMs = 8000, onWaiting, timers = { setTimeout, clearTimeout } }) {
    this.idleMs = idleMs;
    this.onWaiting = onWaiting;
    this.timers = timers;
    this.terms = new Map();
  }

  watch(id, info = {}) { this.terms.set(id, { info, armed: false, timer: null, tail: '' }); }

  input(id) {
    const t = this.terms.get(id);
    if (!t) return;
    t.armed = true;
    t.tail = '';
    this.stopTimer(t);
  }

  output(id, data) {
    const t = this.terms.get(id);
    if (!t?.armed) return;
    const signal = attentionSignal(data);
    if (signal) return this.fire(id, t, signal.message);
    t.tail = (t.tail + data).slice(-TAIL);
    this.stopTimer(t);
    t.timer = this.timers.setTimeout(() => {
      t.timer = null;
      const line = promptLine(t.tail);
      // an empty input box says nothing: the default message is better
      if (line != null) this.fire(id, t, /^[│|]?\s*[❯›>]\s*[│|]?$|^\?\s+for shortcuts/i.test(line) ? '' : line);
    }, this.idleMs);
  }

  close(id) {
    const t = this.terms.get(id);
    if (t) this.stopTimer(t);
    this.terms.delete(id);
  }

  closeAll() { for (const id of [...this.terms.keys()]) this.close(id); }

  stopTimer(t) {
    if (t.timer) this.timers.clearTimeout(t.timer);
    t.timer = null;
  }

  fire(id, t, message) {
    this.stopTimer(t);
    t.armed = false;
    this.onWaiting(id, t.info, message);
  }
}

module.exports = {
  attentionSignal,
  chainNotice,
  interruptedNotice,
  liveRoadmapNotice,
  nightWatchNotice,
  normalizeContext,
  oracleNotice,
  productOwnerNotice,
  promptLine,
  pushConflictNotice,
  runNotice,
  sessionNotice,
  shouldNotify,
  WaitDetector,
};
