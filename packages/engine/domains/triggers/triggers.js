// Platform triggers (#568, 12-Factor Agents factor 11): a repository's `.multiagent/project.yaml` may
// list `triggers:`, rules of the form "this platform event starts that workflow with these inputs":
//   { on: issue_labeled, label: ready, workflow: software-development, inputs: { issues: ["{{ event.issue.number }}"] } }
//   { on: pr_comment, mention: "@orchestrator", workflow: fix }
//   { on: ci_failed, branch: main, workflow: fix }
// A rule names one of the manifest's own workflows (accepted per commit with them, #485); a rule that
// cannot be used is a problem shown on the project screen and is ignored, never started.
//
// The watcher (createTriggerWatcher) is one per project with triggers: it polls the platform through an
// injected reader (platform-events.js: `gh api` / `glab api`, no model call) on an interval (default
// 2 min, 0 = off), starts one run per new matching event through an injected `startRun` (the service's
// roadmap channel: occupancy, budgets and the merge queue apply), comments once on the issue or PR, and
// keeps the event ids it has seen in `<stateDir>/<project>.json` (the service: <workspace>/backlog/triggers),
// so a restart or a second app never starts an event twice (an exclusive claim file per event while its
// run starts, claimEvent). A start that waits (budget, a busy slot) is tried on the next poll; one that
// throws is logged, kept in the state's lastError and dropped after MAX_ATTEMPTS. A rate limit (HTTP 403/429) backs off. It
// never answers a gate and never merges: a trigger starts work, never ships it. Off until the owner turns
// it on in Settings; under MULTIAGENT_SIMULATION_ONLY=1 every run it starts is a mock run.
//
// Decision (docs/agents/decisions.md): polling first, the rules in the repository. A webhook receiver
// later would feed the same events to the same rules: `POST /hooks/triggers/<project>?key=<key>` on the
// engine server (the shape of the monitor's `/hooks/monitor/<project>`), its body normalised to the
// events below, so the rules need no change.
//
// An event (normalised by the readers): { kind, id, url, ... }
//   issue_labeled: { label, issue: { number } }   pr_comment: { body, pr: { number } }   ci_failed: { branch }

const fs = require('fs');
const path = require('path');

const TRIGGER_KINDS = ['issue_labeled', 'pr_comment', 'ci_failed'];
const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
// the longest wait after consecutive rate limits
const MAX_BACKOFF_MS = 60 * 60 * 1000;
// the seen ids kept per project (the newest), so the state file stays small
const MAX_SEEN = 2000;
// the runs a project's state remembers for its card
const MAX_RUNS = 20;
// how far back of the last poll's start the next one reads (clock skew, the platform's own delay)
const SINCE_MARGIN_MS = 5 * 60 * 1000;
// a run start that throws (a missing workflow file, a refused run) is tried this often, then the event is dropped
const MAX_ATTEMPTS = 3;
// a claim on an event older than this belongs to an app that died while starting it
const CLAIM_STALE_MS = 10 * 60 * 1000;

const str = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const isMapping = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

// the field each kind needs (null: optional) and its error
const REQUIRED = { issue_labeled: 'label', pr_comment: 'mention', ci_failed: null };

// One raw rule -> { rule } or { problem }
function validateRule(raw, i, names) {
  const at = `triggers[${i}]`;
  if (!isMapping(raw)) return { problem: `${at}: a trigger is { on, workflow, inputs?, label? / mention? / branch? }.` };
  const on = str(raw.on);
  if (!TRIGGER_KINDS.includes(on)) return { problem: `${at}: unknown event "${raw.on ?? ''}" (one of ${TRIGGER_KINDS.join(', ')}).` };
  const need = REQUIRED[on];
  if (need && !str(raw[need])) return { problem: `${at}: ${on} needs a ${need}.` };
  const workflow = str(raw.workflow);
  if (!workflow) return { problem: `${at}: a trigger needs a workflow (one of the project's workflows).` };
  if (!names.includes(workflow)) return { problem: `${at}: workflow "${workflow}" is not one of the project's workflows (${names.join(', ') || 'none'}).` };
  if (raw.inputs != null && !isMapping(raw.inputs)) return { problem: `${at}: inputs must be a mapping of input names to values.` };
  const rule = { on, workflow, inputs: raw.inputs ? { ...raw.inputs } : {} };
  for (const key of ['label', 'mention', 'branch']) if (str(raw[key])) rule[key] = str(raw[key]);
  return { rule };
}

// what the screen shows of a refused rule: its event fields and workflow as written
const refusedView = (raw) => (isMapping(raw)
  ? { on: str(raw.on), label: str(raw.label), mention: str(raw.mention), branch: str(raw.branch), workflow: str(raw.workflow) }
  : { on: null, label: null, mention: null, branch: null, workflow: null });

/**
 * Checks a manifest's `triggers:` against the project's workflow names.
 * @returns {{ triggers: object[], problems: string[], refused: object[] }} refused: { ...rule as written, problem }
 */
function validateTriggers(rules, { workflows = [] } = {}) {
  const out = { triggers: [], problems: [], refused: [] };
  if (rules == null) return out;
  if (!Array.isArray(rules)) {
    const problem = 'triggers must be a list of { on, workflow, inputs? }.';
    return { ...out, problems: [problem], refused: [{ ...refusedView(rules), problem }] };
  }
  rules.forEach((raw, i) => {
    const { rule, problem } = validateRule(raw, i, workflows);
    if (rule) out.triggers.push(rule);
    else { out.problems.push(problem); out.refused.push({ ...refusedView(raw), problem }); }
  });
  return out;
}

/** Whether a platform event is one the rule starts its workflow on. */
function matchEvent(rule, event) {
  if (!rule || !event || event.kind !== rule.on) return false;
  if (rule.on === 'issue_labeled') return event.label === rule.label;
  if (rule.on === 'pr_comment') return typeof event.body === 'string' && event.body.includes(rule.mention);
  if (rule.on === 'ci_failed') return !rule.branch || event.branch === rule.branch;
  return false;
}

const PLACEHOLDER = /\{\{\s*event\.([\w.]+)\s*\}\}/g;
const ONLY = /^\s*\{\{\s*event\.([\w.]+)\s*\}\}\s*$/;
// the event's value at a dotted path, undefined when absent
const valueAt = (event, dotted) => dotted.split('.').reduce((v, k) => (v == null ? undefined : v[k]), event);

function renderValue(value, event) {
  if (Array.isArray(value)) return value.map((v) => renderValue(v, event));
  if (isMapping(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderValue(v, event)]));
  if (typeof value !== 'string') return value;
  const only = ONLY.exec(value);
  if (only) return valueAt(event, only[1]) ?? '';
  return value.replace(PLACEHOLDER, (_, p) => { const v = valueAt(event, p); return v == null ? '' : String(v); });
}

/** A rule's inputs with their `{{ event.<path> }}` placeholders filled from the event (a new object). */
function renderTriggerInputs(inputs, event) {
  return renderValue(inputs || {}, event || {});
}

const stateFile = (stateDir, project) => path.join(stateDir, `${project}.json`);
const EMPTY_STATE = () => ({ seen: [], since: null, lastEvent: null, lastError: null, failures: {}, runs: [] });

/**
 * A project's trigger state: { seen: [id], since, lastEvent, lastError: { eventId, workflow, message, at },
 * failures: { <event id>: attempts }, runs: [{ eventId, runId, workflow, at, url }] }.
 */
function readTriggerState(stateDir, project) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(stateDir, project), 'utf8'));
    return {
      seen: Array.isArray(s.seen) ? s.seen : [], since: s.since || null, lastEvent: s.lastEvent || null,
      lastError: s.lastError || null, failures: isMapping(s.failures) ? s.failures : {}, runs: Array.isArray(s.runs) ? s.runs : [],
    };
  } catch { return EMPTY_STATE(); }
}

// writes the state over the file's current one: the seen ids and the runs another app wrote meanwhile are kept
function writeTriggerState(stateDir, project, state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const disk = readTriggerState(stateDir, project);
  const seen = [...new Set([...disk.seen, ...state.seen])];
  const ids = new Set(state.runs.map((r) => r.eventId));
  const runs = [...disk.runs.filter((r) => !ids.has(r.eventId)), ...state.runs].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const out = { seen: seen.slice(-MAX_SEEN), since: state.since || null, lastEvent: state.lastEvent, lastError: state.lastError || null, failures: state.failures || {}, runs: runs.slice(-MAX_RUNS) };
  const file = stateFile(stateDir, project);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, file);
}

// A claim on one event while its run starts (`<stateDir>/<project>.claims/<id>`, created exclusively): a
// second app polling at the same moment skips it. A claim older than CLAIM_STALE_MS (an app that died
// mid-start) is taken over. Returns the release function, or null when another app holds it.
function claimEvent(stateDir, project, id) {
  const dir = path.join(stateDir, `${project}.claims`);
  const file = path.join(dir, String(id).replace(/[^\w.-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.closeSync(fs.openSync(file, 'wx'));
      return () => { try { fs.unlinkSync(file); } catch { /* already gone */ } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let stale = false;
      try { stale = Date.now() - fs.statSync(file).mtimeMs > CLAIM_STALE_MS; } catch { stale = true; }
      if (!stale) return null;
      try { fs.unlinkSync(file); } catch { /* taken by another app meanwhile */ }
    }
  }
  return null;
}

/**
 * The poller of one project's triggers. pollOnce never rejects; nextDelayMs is the wait before the next poll.
 */
function createTriggerWatcher({ project, rules = [], readEvents, startRun, comment, stateDir, intervalMs = DEFAULT_INTERVAL_MS, enabled, now = Date.now }) {
  let backoffMs = null;
  // events older than this are not read: the last poll's start (minus a margin; the seen ids cover the
  // overlap), at first the state's own or the watcher's creation, so turning triggers on never replays
  // the repository's history
  let since = readTriggerState(stateDir, project).since || new Date(now()).toISOString();
  const idle = () => ({ polled: false, started: [], backoffMs: null });
  const markSeen = (state, seen, id) => { seen.add(id); state.seen.push(id); delete state.failures[id]; };

  // a real failure, not a wait: logged, shown on the card, tried MAX_ATTEMPTS times then dropped.
  // Returns true when the event is tried again on the next poll.
  function recordFailure(state, seen, event, rule, failure) {
    const attempts = (Number(state.failures[event.id]) || 0) + 1;
    console.error(`triggers ${project}: ${event.id} could not start ${rule.workflow} (attempt ${attempts}/${MAX_ATTEMPTS}): ${failure}`);
    state.lastEvent.error = failure;
    state.lastError = { eventId: event.id, workflow: rule.workflow, message: failure, at: new Date(now()).toISOString() };
    if (attempts >= MAX_ATTEMPTS) { markSeen(state, seen, event.id); return false; }
    state.failures[event.id] = attempts;
    return true;
  }

  // starts one matching event under its claim: { held } (claimed elsewhere, waiting, or to retry),
  // { runId } when started, { error } on a real failure
  async function startEvent(state, seen, event, rule, mock) {
    // another app starts this event right now: its state write will say so
    const release = claimEvent(stateDir, project, event.id);
    if (!release) return { held: true };
    const trigger = { kind: event.kind, id: event.id, url: event.url || null };
    let res = null;
    try {
      // started by another app since this poll read the state
      if (readTriggerState(stateDir, project).seen.includes(event.id)) { markSeen(state, seen, event.id); return {}; }
      res = await startRun({ project, workflow: rule.workflow, inputs: renderTriggerInputs(rule.inputs, event), trigger, mock, event });
    } catch (e) {
      const error = String(e?.message || e);
      return { error, held: recordFailure(state, seen, event, rule, error) };
    } finally {
      if (res?.runId) {
        markSeen(state, seen, event.id);
        state.runs.push({ eventId: event.id, runId: res.runId, workflow: rule.workflow, url: trigger.url, at: new Date(now()).toISOString() });
        writeTriggerState(stateDir, project, state);
      }
      release();
    }
    // not started (a busy slot, the budget): seen again on the next poll, so `since` stays put
    return res?.runId ? { runId: res.runId } : { held: true };
  }

  async function pollOnce() {
    if (!enabled || !intervalMs || !rules.length) return idle();
    const readAt = now();
    let events;
    try {
      events = await readEvents({ since });
    } catch (e) {
      if (e?.code !== 'RATE_LIMITED') return { polled: true, started: [], backoffMs: null, error: String(e?.message || e) };
      backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs ? backoffMs * 2 : intervalMs * 2);
      return { polled: true, started: [], backoffMs };
    }
    backoffMs = null;
    // the file, read again on every poll: another app on the same workspace may have started an event
    const state = readTriggerState(stateDir, project);
    const seen = new Set(state.seen);
    const started = [];
    const errors = [];
    const mock = process.env.MULTIAGENT_SIMULATION_ONLY === '1';
    let dirty = false;
    let held = false;
    for (const event of events || []) {
      if (!event?.id || seen.has(event.id)) continue;
      const rule = rules.find((r) => matchEvent(r, event));
      state.lastEvent = { id: event.id, kind: event.kind, url: event.url || null, at: new Date(now()).toISOString(), matched: !!rule };
      dirty = true;
      if (!rule) { markSeen(state, seen, event.id); continue; }
      const res = await startEvent(state, seen, event, rule, mock);
      if (res.error) errors.push({ eventId: event.id, error: res.error });
      if (res.held) held = true;
      if (!res.runId) continue;
      started.push({ eventId: event.id, runId: res.runId, workflow: rule.workflow });
      if (comment) { try { await comment({ event, runId: res.runId, workflow: rule.workflow }); } catch { /* the report is best effort */ } }
    }
    if (!held) {
      since = new Date(readAt - SINCE_MARGIN_MS).toISOString();
      state.since = since;
      dirty = true;
    }
    if (dirty) writeTriggerState(stateDir, project, state);
    return { polled: true, started, errors, backoffMs: null };
  }

  return { pollOnce, nextDelayMs: () => backoffMs ?? intervalMs };
}

module.exports = {
  createTriggerWatcher,
  DEFAULT_INTERVAL_MS,
  matchEvent,
  readTriggerState,
  renderTriggerInputs,
  TRIGGER_KINDS,
  validateTriggers,
};
