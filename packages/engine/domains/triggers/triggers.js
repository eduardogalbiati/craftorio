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
// so a restart or a second app never starts an event twice. A rate limit (HTTP 403/429) backs off. It
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

/**
 * A project's trigger state: { seen: [id], since, lastEvent, runs: [{ eventId, runId, workflow, at, url }] }.
 */
function readTriggerState(stateDir, project) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(stateDir, project), 'utf8'));
    return { seen: Array.isArray(s.seen) ? s.seen : [], since: s.since || null, lastEvent: s.lastEvent || null, runs: Array.isArray(s.runs) ? s.runs : [] };
  } catch { return { seen: [], since: null, lastEvent: null, runs: [] }; }
}

function writeTriggerState(stateDir, project, state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const out = { seen: state.seen.slice(-MAX_SEEN), since: state.since || null, lastEvent: state.lastEvent, runs: state.runs.slice(-MAX_RUNS) };
  const file = stateFile(stateDir, project);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(out, null, 2));
  fs.renameSync(`${file}.tmp`, file);
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
    const mock = process.env.MULTIAGENT_SIMULATION_ONLY === '1';
    let dirty = false;
    let held = false;
    for (const event of events || []) {
      if (!event?.id || seen.has(event.id)) continue;
      const rule = rules.find((r) => matchEvent(r, event));
      state.lastEvent = { id: event.id, kind: event.kind, url: event.url || null, at: new Date(now()).toISOString(), matched: !!rule };
      dirty = true;
      if (!rule) { seen.add(event.id); state.seen.push(event.id); continue; }
      const trigger = { kind: event.kind, id: event.id, url: event.url || null };
      let res;
      try {
        res = await startRun({ project, workflow: rule.workflow, inputs: renderTriggerInputs(rule.inputs, event), trigger, mock });
      } catch { res = null; }
      // not started (a busy slot, the budget): seen again on the next poll, so `since` stays put
      if (!res?.runId) { held = true; continue; }
      seen.add(event.id);
      state.seen.push(event.id);
      state.runs.push({ eventId: event.id, runId: res.runId, workflow: rule.workflow, url: trigger.url, at: new Date(now()).toISOString() });
      writeTriggerState(stateDir, project, state);
      started.push({ eventId: event.id, runId: res.runId, workflow: rule.workflow });
      if (comment) { try { await comment({ event, runId: res.runId, workflow: rule.workflow }); } catch { /* the report is best effort */ } }
    }
    if (!held) {
      since = new Date(readAt - SINCE_MARGIN_MS).toISOString();
      state.since = since;
      dirty = true;
    }
    if (dirty) writeTriggerState(stateDir, project, state);
    return { polled: true, started, backoffMs: null };
  }

  return { pollOnce, nextDelayMs: () => backoffMs ?? intervalMs };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  TRIGGER_KINDS,
  createTriggerWatcher,
  matchEvent,
  readTriggerState,
  renderTriggerInputs,
  validateTriggers,
};
