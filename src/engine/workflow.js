// Engine that runs the step graph defined in the YAML.
// Emits events ('event') that feed the UI and the observability recorder.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { exec } = require('child_process');
const yaml = require('js-yaml');
const nunjucks = require('nunjucks');
const { runTurn, refreshWindowsPath, isRetryable, isPermissionDenial, sleep, emptyUsage } = require('./providers');
const { resolveSkill, skillPrompt } = require('../skills');
const { providerId, sessionCost, totalTokens, WARN_AT } = require('../usage');
const supervisor = require('../supervisor');
const { prepareWorktree, removeWorktree, mergeLocally, currentBranch } = require('./worktree');
const capabilities = require('./capabilities');
const { stopProcessesIn } = require('./processes');
const { PROBES, runProbe } = require('./probes');
const { IdleWatch } = require('./idle');
const testPaths = require('./test-paths');
const { StepTrail } = require('../renderer/run-progress-model');

// Skills bundled with the app (skills/ folder at the root). Workspace skills take precedence.
const BUNDLED_SKILLS = path.join(__dirname, '..', '..', 'skills');

// ---------------------------------------------------------------------------
// Templates and expressions
// ---------------------------------------------------------------------------
const tpl = new nunjucks.Environment(null, { autoescape: false });
tpl.addFilter('to_yaml', (v) => yaml.dump(v ?? null, { lineWidth: 120 }).trim());
tpl.addFilter('to_json', (v) => JSON.stringify(v, null, 2));
// Deterministic shuffle: the same seed (e.g. run_id) gives the same order in every step,
// so anonymized labels ("Proposal 2") stay consistent within a run but vary across runs.
tpl.addFilter('shuffle', (arr, seed = '') => {
  const out = [...(arr || [])];
  let h = crypto.createHash('sha256').update(String(seed)).digest().readUInt32BE(0);
  const rand = () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return h / 2 ** 32; };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
});

// PR URL (agent output) → HOST/OWNER/REPO for `gh --repo`. Actions run in a shell, so anything
// that is not strictly a pull request URL throws instead of being interpolated.
tpl.addFilter('github_repo', (url) => {
  const m = /^https:\/\/([A-Za-z0-9.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/\d+(?:\/[A-Za-z0-9_-]*)?$/.exec(String(url ?? '').trim());
  if (!m) throw new Error(`not a GitHub pull request URL: ${JSON.stringify(url)}`);
  return `${m[1]}/${m[2]}/${m[3]}`;
});

// PR/MR URL (agent output) passed as is to a command in an action: a GitHub pull request or a
// GitLab merge request URL, or it throws.
tpl.addFilter('pr_url', (url) => {
  const u = String(url ?? '').trim();
  const ok = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(u)
    || /^https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9_.-]+)+\/-\/merge_requests\/\d+$/.test(u);
  if (!ok) throw new Error(`not a pull/merge request URL: ${JSON.stringify(url)}`);
  return u;
});

const render = (s, scope) => (s == null ? '' : tpl.renderString(String(s), scope));
const evalExpr = (expr, scope) => render(`{% if ${expr} %}1{% else %}0{% endif %}`, scope).trim() === '1';

function parseDuration(v, def) {
  if (v == null) return def;
  if (typeof v === 'number') return v;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/.exec(String(v).trim());
  return m ? +m[1] * { ms: 1, s: 1e3, m: 6e4, h: 36e5 }[m[2]] : def;
}

// Token counts written as 150k / 1.2m / 150000 (max_context).
function parseTokens(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  const m = /^(\d+(?:\.\d+)?)\s*([km]?)$/i.exec(String(v).trim());
  return m ? Math.round(+m[1] * { '': 1, k: 1e3, m: 1e6 }[m[2].toLowerCase()]) : null;
}

// Context an agent read in its turns: everything sent to the model, cached or not.
const contextTokens = (t) => (t ? (t.input || 0) + (t.cache_read || 0) + (t.cache_write || 0) : 0);

// Outcome of a run that reaches `end` through a transition with `status:` (default success),
// e.g. a rejected failure gate → failed, a rejected merge → cancelled.
const END_STATUSES = ['success', 'failed', 'cancelled'];

// persistent: one conversation for the whole run (max_context: a fresh one with the handoff note
// once a turn ends above it); ephemeral: a fresh session per turn with only the step prompt;
// handoff: a fresh session per turn that starts from the agent's latest handoff note.
const SESSION_MODES = ['persistent', 'ephemeral', 'handoff'];

function loadWorkflow(file) {
  const wf = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!wf || !Array.isArray(wf.steps) || !wf.steps.length) throw new Error('Workflow has no "steps".');
  if (!wf.agents) throw new Error('Workflow has no "agents".');
  const mcpServers = wf.mcp_servers || {};
  for (const [name, a] of [['defaults', wf.defaults || {}], ...Object.entries(wf.agents).map(([n, a]) => [`Agent "${n}"`, a || {}])]) {
    if (a.session !== undefined && !SESSION_MODES.includes(a.session)) throw new Error(`${name}: session must be one of ${SESSION_MODES.join(', ')}.`);
    if (a.max_context !== undefined && !String(a.max_context).includes('{{') && !parseTokens(a.max_context)) throw new Error(`${name}: max_context must be a token count such as 150k.`);
    if (a.persona !== undefined && a.persona !== 'random') throw new Error(`${name}: persona must be "random".`);
    if (a.edits_tests !== undefined && typeof a.edits_tests !== 'boolean') throw new Error(`${name}: edits_tests must be true or false.`);
    capabilities.validate(a.capabilities, name, mcpServers);
  }
  testPaths.validateTestsPaths(wf.tests_paths);
  const ids = new Set(wf.steps.map((s) => s.id));
  for (const s of wf.steps) {
    capabilities.validate(s.capabilities, `Step "${s.id}"`, mcpServers);
    if (s.edits_tests !== undefined && typeof s.edits_tests !== 'boolean') throw new Error(`Step "${s.id}": edits_tests must be true or false.`);
    if (s.type !== 'human_approval') {
      // `agents: [...]` = fan-out: the same prompt goes to several agents in parallel
      if (s.agents && (!Array.isArray(s.agents) || !s.agents.length)) throw new Error(`Step "${s.id}": agents must be a non-empty list.`);
      if (s.agents && s.goal) throw new Error(`Step "${s.id}": goal is not supported on a fan-out step (agents).`);
      for (const n of s.agents || [s.agent]) if (!wf.agents[n]) throw new Error(`Step "${s.id}" references unknown agent "${n}".`);
    }
    if (s.goal && !s.goal.until) throw new Error(`Step "${s.id}": goal requires "until".`);
    if (s.wait !== undefined) {
      const w = s.wait || {};
      if (!isLooping(s) || s.agents || s.type === 'human_approval') throw new Error(`Step "${s.id}": wait is only valid on a single-agent step with a loop.`);
      if (!PROBES.includes(w.probe)) throw new Error(`Step "${s.id}": wait.probe must be one of ${PROBES.join(', ')}.`);
      if (!w.target) throw new Error(`Step "${s.id}": wait requires "target" (the PR/MR or CI run URL).`);
      for (const key of ['output', 'infra_output']) {
        const v = w[key];
        if (v !== undefined && (w.probe === 'pr_changes' || !v || typeof v !== 'object' || Array.isArray(v))) {
          throw new Error(`Step "${s.id}": wait.${key} must be a map of output fields, and only applies to the pr_checks and workflow_run probes.`);
        }
      }
      if (w.grace !== undefined && parseDuration(w.grace, null) == null) throw new Error(`Step "${s.id}": wait.grace must be a duration such as 10m.`);
    }
    if (s.choices && s.type !== 'human_approval') throw new Error(`Step "${s.id}": choices is only valid for human_approval.`);
    for (const t of s.transitions || []) {
      for (const target of [t.goto, t.on_exhausted, t.on_error, t.loop?.on_exhausted, s.goal?.on_exhausted, s.loop?.on_exhausted, s.on_error].filter(Boolean)) {
        if (!ids.has(target) && target !== 'end' && target !== 'fail') throw new Error(`Step "${s.id}" points to unknown step "${target}".`);
      }
      if (t.status !== undefined) {
        if (!END_STATUSES.includes(t.status)) throw new Error(`Step "${s.id}": transition status must be one of ${END_STATUSES.join(', ')}.`);
        if (![t.goto, t.on_exhausted, t.loop?.on_exhausted].includes('end')) throw new Error(`Step "${s.id}": a transition status only applies when the transition ends the run (goto: end or on_exhausted: end).`);
      }
      if (t.merge !== undefined) {
        if (t.merge !== 'local') throw new Error(`Step "${s.id}": transition merge must be "local".`);
        if (!wf.orchestrator?.worktree) throw new Error(`Step "${s.id}": merge: local needs orchestrator.worktree (the run's branch lives in its worktree).`);
      }
    }
  }
  const maxCtx = wf.orchestrator?.limits?.max_total_context;
  if (maxCtx != null && !String(maxCtx).includes('{{') && !parseTokens(maxCtx)) throw new Error('orchestrator.limits.max_total_context must be a token count such as 20M.');
  validateGroups(wf.groups, ids);
  return wf;
}

// `groups:` names sets of steps for progress views (runs list, Run screen); the graph ignores it.
function validateGroups(groups, ids) {
  if (groups === undefined) return;
  if (!Array.isArray(groups)) throw new Error('groups must be a list of { name, steps }.');
  const names = new Set();
  const owner = new Map();
  for (const g of groups) {
    if (!g || typeof g.name !== 'string' || !g.name.trim()) throw new Error('Every group needs a name.');
    if (names.has(g.name)) throw new Error(`Group "${g.name}" is defined twice.`);
    names.add(g.name);
    if (!Array.isArray(g.steps) || !g.steps.length) throw new Error(`Group "${g.name}": steps must be a non-empty list of step ids.`);
    for (const s of g.steps) {
      if (!ids.has(s)) throw new Error(`Group "${g.name}" references unknown step "${s}".`);
      if (owner.has(s)) throw new Error(`Step "${s}" is in two groups: "${owner.get(s)}" and "${g.name}".`);
      owner.set(s, g.name);
    }
  }
}

// ---------------------------------------------------------------------------
// Structured output
// ---------------------------------------------------------------------------
function extractJson(text) {
  const src = String(text || '');
  const blocks = [...src.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]).reverse();
  const first = src.indexOf('{');
  const last = src.lastIndexOf('}');
  if (first >= 0 && last > first) blocks.push(src.slice(first, last + 1));
  for (const b of blocks) {
    try { return JSON.parse(b); } catch { /* try the next one */ }
  }
  throw new Error('No valid JSON block found in the response.');
}

const TYPE_CHECK = {
  object: (x) => x !== null && typeof x === 'object' && !Array.isArray(x),
  array: Array.isArray,
  string: (x) => typeof x === 'string',
  integer: Number.isInteger,
  number: (x) => typeof x === 'number',
  boolean: (x) => typeof x === 'boolean',
};

function validateSchema(v, s, p = 'output', errs = []) {
  if (!s) return errs;
  if (s.type && TYPE_CHECK[s.type] && !TYPE_CHECK[s.type](v)) { errs.push(`${p}: expected ${s.type}`); return errs; }
  if (s.enum && !s.enum.includes(v)) errs.push(`${p}: "${v}" not in ${JSON.stringify(s.enum)}`);
  if (s.type === 'object') {
    for (const r of s.required || []) if (v[r] === undefined) errs.push(`${p}.${r}: required`);
    for (const [k, ps] of Object.entries(s.properties || {})) if (v[k] !== undefined) validateSchema(v[k], ps, `${p}.${k}`, errs);
  }
  if (s.type === 'array' && s.items) v.forEach((x, i) => validateSchema(x, s.items, `${p}[${i}]`, errs));
  return errs;
}

// ---------------------------------------------------------------------------
// `loop` is the current format; `mode: polling` + `poll` are still accepted
const isLooping = (step) => !!step.loop || step.mode === 'polling';
const loopConfig = (step) => step.loop || step.poll || {};

// `wait:` on a /loop step: between the agent's turns the engine checks the PR/MR or the CI run
// itself (src/engine/probes.js) and calls the agent only on news. What each probe watches, for
// the agent's prompt:
const PROBE_WHAT = {
  pr_checks: 'the PR/MR checks and mergeability',
  pr_changes: 'the PR/MR (new commits, comments, reviews, checks, mergeability)',
  workflow_run: 'the CI run',
};
// A PR/MR with no check registered yet is polled this long after the agent's last turn (the push),
// then the agent is called to find out why (`wait.grace`).
const DEFAULT_WAIT_GRACE = '10m';
// Simulation: probe states per call, per probe (mockSequences.probes: { step: [...] } overrides them).
// The CI check fails once (the agent triages it), then passes without an agent turn.
const MOCK_PROBES = {
  pr_checks: ['pending', 'failed', 'pending', 'passed'],
  pr_changes: ['unchanged', 'changed'],
  workflow_run: ['pending', 'passed'],
};

// Instructions in the style of Claude Code's /goal and /loop. The engine is what actually
// repeats the step and enforces the limits; the agent only needs to know the contract.
function goalLoopInstructions(step, st, scope) {
  const lines = [];
  if (step.goal) {
    lines.push(`/goal: ${render(step.goal.description, scope)}`);
    lines.push('Your work on this step is only done when this goal is met. Do not declare success without checking the real state.');
  }
  if (isLooping(step)) {
    const cfg = loopConfig(step);
    if (step.wait) {
      lines.push(`/loop: iteration ${st.iteration}. Between your turns the orchestrator checks ${PROBE_WHAT[step.wait.probe]} itself every ${cfg.interval || '1m'} (limit: ${cfg.max_duration || 'none'}), without you, and calls you again only when something changed or needs a decision, until the /goal is met.`);
      if (st.probeNews) lines.push(`Since your last turn the orchestrator checked ${st.probeNews.polls} time(s) without you. It calls you now because: ${st.probeNews.detail}.`);
    } else {
      lines.push(`/loop: iteration ${st.iteration}. The orchestrator will call you again every ${cfg.interval || '1m'} (limit: ${cfg.max_duration || 'none'}) until the /goal is met.`);
    }
    lines.push('On each call: check the current state, take the necessary action and reply right away. Do not block waiting (no long watch/sleep).');
    lines.push(`If your tools are refused (not allowed), do not retry other forms of the same command and do not keep answering the same: after ${maxBlocked(step)} blocked iterations in a row the orchestrator stops this loop.`);
  }
  return lines.join('\n');
}

// A /loop iteration is "blocked" when the agent could not observe anything (every tool call was
// refused, or it made none) or when its tools were refused and it gave the same decision again.
// `loop.max_blocked` in a row (default 3, 0 = off) ends the loop like `max_duration` does, instead
// of polling for hours with an agent that cannot change anything.
const DEFAULT_MAX_BLOCKED = 3;
const maxBlocked = (step) => loopConfig(step).max_blocked ?? DEFAULT_MAX_BLOCKED;
// Consecutive refused tool calls in one turn that are worth a warning (agent fighting its allowlist).
const DENIAL_WARN = 5;
// Silence with a command waiting that is worth a warning (an agent polling for text that never shows up).
const IDLE_WARN_MS = 5 * 60e3;

// What the transitions decide on: enum, boolean and number fields of the schema (not the
// free text, which an LLM rewords on every call). Without a schema, the whole answer.
function decisionKey(output, schema) {
  const props = schema?.properties;
  if (!props || !output || typeof output !== 'object') return JSON.stringify(output ?? null);
  const keys = Object.keys(props).filter((k) => props[k].enum || ['boolean', 'integer', 'number'].includes(props[k].type));
  return JSON.stringify(keys.length ? keys.map((k) => output[k] ?? null) : output);
}

const stepAgentLabel = (s) => (s.agents ? s.agents.join(' · ') : s.agent || null);

// ---------------------------------------------------------------------------
// Handoff notes: at the end of each turn an agent that comes back (persistent or handoff session)
// leaves a short note for whoever continues in a fresh session. The engine removes it from the
// answer, saves it in runs/<id>/handoffs/ and starts the agent's next fresh session from it.
const HANDOFF_INSTRUCTIONS = [
  'Handoff note: your next turn in this run may start in a fresh session that does not have this conversation.',
  'Before the final ```json block (or at the very end if there is none), write a ```handoff block, at most 250 words of',
  'plain Markdown bullets, no code blocks inside:',
  '- Goal: what this agent is trying to achieve in the run',
  '- State: branch, commits (hashes), PR/MR, what is running',
  '- Done: what this turn did',
  '- Left: what is still open, in order',
  '- Decisions: each decision and why',
  '- Key files: path (what matters there)',
  '- Known problems: blockers, flaky things, what did not work',
  'The code is in git: point to files and commits instead of pasting code. The orchestrator removes this block from your answer.',
].join('\n');

const HANDOFF_ONLY = 'Write only your ```handoff block now, following the format asked before (Goal, State, Done, Left, Decisions, Key files, Known problems; at most 250 words). Nothing else.';

// [answer without its last ```handoff block, the note | null]
function takeHandoff(text) {
  const src = String(text || '');
  const all = [...src.matchAll(/```handoff[^\n]*\n([\s\S]*?)```/g)];
  if (!all.length) return [src, null];
  const m = all[all.length - 1];
  const note = m[1].trim();
  return [(src.slice(0, m.index) + src.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n').trim(), note || null];
}

const kTokens = (n) => (n == null ? '?' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

function newRunId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomUUID().slice(0, 8)}`;
}

function addUsage(total, u) {
  for (const k of Object.keys(total)) total[k] += (u && u[k]) || 0;
}

class WorkflowRun extends EventEmitter {
  // budget: { [provider id]: { name, limitUsd, limitTokens, blockOnLimit, usedUsd, usedTokens } }
  // (this month's usage before this run, see src/usage.js); prices: USD per 1M tokens by model.
  // projectId: the project the run belongs to (recorded in workflow.started and summary.json).
  // issues: [{ number, url, title }] the run implements (Backlog screen; several when a group of issues
  //   goes as one run), recorded the same way. `issue` (one issue, the option before groups) is still accepted.
  // resume: { runId, fromStep, steps: { id: { output, visits } }, sessions: { agent: providerSessionId }, handoffs: { agent: note },
  //   instruction, worktree: { dir, branch } }
  //   starts at fromStep with the previous run's step outputs, agent conversations and handoff notes
  //   (src/supervisor.js resumeSpec), in the previous run's worktree.
  // worktreesDir: where orchestrator.worktree creates the run's git worktree (<workspace>/worktrees);
  //   without it (e.g. simulation runs) the agents work in the repository folder itself.
  // mockSequences: { field: [value per visit] } over the mock provider's defaults (tests).
  // notices: [{ level, message }] logged right after workflow.started (e.g. the workflow file came from a fallback folder).
  // stopProcesses: (dir) => Promise<[{ pid, exe, cwd, reason, stopped }]>, stops what agents left running in the
  //   worktree (src/engine/processes.js). Default: the real one, none for simulations (mock agents start nothing).
  // probe: ({ probe, target, cwd, signal, stepId, baseline }) => Promise<{ state, detail, fingerprint? }>, the
  //   check of a `wait:` step (src/engine/probes.js). Default: the real one; simulations use MOCK_PROBES.
  // actionsQuota: (owner) => Promise<string | null>, the message when that GitHub account's Actions quota is
  //   exhausted (src/actions-usage.js), passed to the probe as `quota`: pr_checks then reports `quota_exhausted`.
  // peerSessions: () => [{ provider, model, tokens, costUsd }], the sessions of the other runs in progress (and of
  //   those that finished after `budget` was computed): the per-turn budget check counts them too (concurrent runs).
  // idleWarnMs: an agent silent this long while a tool call is open gets an `agent_idle` warning (src/engine/idle.js).
  //   Default 5 minutes; 0 disables it.
  // personas: [{ id, name, prompt, skills }] the user's agents (Agents menu), for `persona: random`.
  constructor({ file, inputs, mock, runsDir, skillsDirs, budget, prices, projectId, issues, issue, resume, worktreesDir, mockSequences, notices, stopProcesses, probe, actionsQuota, peerSessions, idleWarnMs, personas }) {
    super();
    refreshWindowsPath(); // actions (e.g. gh pr merge) need the refreshed PATH
    this.file = file;
    this.wf = loadWorkflow(file);
    this.mock = !!mock;
    this.mockSequences = mockSequences || null;
    this.notices = notices || [];
    this.runId = newRunId();
    this.runDir = path.join(runsDir, this.runId);
    this.skillsDirs = [...(skillsDirs || []), BUNDLED_SKILLS];
    this.projectId = projectId || null;
    this.issues = issues?.length ? issues : issue ? [issue] : null;
    this.worktreesDir = worktreesDir || null;
    this.worktree = null; // see setupWorktree
    this.stopProcesses = stopProcesses === undefined ? (this.mock ? null : stopProcessesIn) : stopProcesses;
    this.probe = probe || (this.mock ? (args) => this.mockProbe(args) : runProbe);
    this.actionsQuota = actionsQuota || null;
    this.probeStats = {}; // step -> { polls, agent_calls, completed, errors } (summary.probes)
    this.mockProbeCalls = {};
    this.budget = budget || {};
    this.prices = prices || {};
    this.budgetWarned = new Set();
    this.peerSessions = peerSessions || (() => []);
    this.idleWarnMs = idleWarnMs ?? IDLE_WARN_MS;
    this.stepTiming = {};           // step id -> { turns, duration_ms, active_ms, waiting_ms, stalled_ms } (summary.timing)
    this.inputs = this.resolveInputs(inputs || {});
    // An agent's provider, model and effort can be templates over the inputs
    // (provider: "{{ inputs.writer_provider }}"), so a workflow can let the user pick them.
    // Resolved once per run, before anything reads them (preflight, budgets, sessions).
    for (const a of Object.values(this.wf.agents)) {
      for (const k of ['provider', 'model', 'effort']) {
        if (typeof a[k] === 'string' && a[k].includes('{{')) a[k] = render(a[k], { inputs: this.inputs }).trim();
      }
    }
    this.dropDisabledAgents();
    this.pickPersonas(personas || [], resume?.personas);
    this.ctx = {
      inputs: this.inputs, steps: {}, loop: { iteration: 0 }, run_id: this.runId, run_dir: this.runDir, runs_dir: runsDir, workflows_dir: path.dirname(path.resolve(file)),
      agents: Object.fromEntries(Object.entries(this.wf.agents).map(([k, a]) => [k, { provider: a.provider, model: a.model }])),
      // what the user typed at the human gates, oldest first: [{ step, choice, text, ts }]
      feedback: [],
      // the step that ran before the current one (null for the first)
      previous_step: null,
      // folder of a skill (workspace first, then bundled), e.g. to run its script in an action
      skill_dir: (name) => resolveSkill(this.skillsDirs, name).path,
    };
    for (const s of this.wf.steps) this.ctx.steps[s.id] = { output: null, visits: 0 };
    this.resume = resume || null;
    if (resume) {
      if (!this.wf.steps.some((x) => x.id === resume.fromStep)) throw new Error(`Cannot resume: step "${resume.fromStep}" does not exist in this workflow.`);
      for (const [id, v] of Object.entries(resume.steps || {})) {
        if (this.ctx.steps[id] && id !== resume.fromStep) Object.assign(this.ctx.steps[id], { output: v.output ?? null, visits: v.visits || 1 });
      }
      if (resume.instruction) this.ctx.steps[resume.fromStep].supervisorNote = resume.instruction;
    }
    this.recent = []; // last events, for the supervisor's timeline
    this.trail = new StepTrail(); // step visits with their agents, for the progress views (summary.progress)
    this.setupSupervisor();

    this.sessions = new Map();      // local id -> session
    this.agentSessions = new Map(); // persistent agent -> local id
    // agent -> its latest handoff note { text, step, visit, path } (a resumed run starts from the previous run's)
    this.handoffNotes = new Map(Object.entries(resume?.handoffs || {}));
    this.rotate = new Set();        // persistent agents whose last turn ended above max_context
    this.turnLog = [];              // one record per agent turn: context at start / peak, tokens, waste
    this.capsLogged = new Set();
    this.counters = {};
    this.loops = {};
    this.approvals = new Map();
    this.abort = new AbortController();
    this.seq = 0;
    this.nSession = 0;
    this.nApproval = 0;
    this.status = 'pending';
  }

  resolveInputs(given) {
    const out = {};
    for (const [k, def] of Object.entries(this.wf.inputs || {})) {
      let v = given[k];
      if (v === undefined || v === '') v = def.default;
      if (def.required && (v === undefined || v === '')) throw new Error(`Required input not provided: ${k}`);
      if (def.enum && v !== undefined && !def.enum.includes(v)) throw new Error(`Input "${k}" must be one of ${def.enum.join(', ')}`);
      if (def.type === 'run') v = this.resolveRunInput(k, v);
      // a list typed in a form arrives as text: one item per line or comma
      if (def.type === 'array' && typeof v === 'string') v = v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
      out[k] = v;
    }
    return out;
  }

  // `agents.<name>.enabled` (a boolean or a template over the inputs) leaves an agent out of
  // the run, e.g. the contender slots of ai-arena the user did not fill. Fan-out steps run
  // without it (`min_success` is capped at the agents left); a single-agent step can't.
  dropDisabledAgents() {
    const off = (v) => ['', 'false', '0', 'no', 'off', 'none'].includes(String(v).trim().toLowerCase());
    for (const [name, a] of Object.entries(this.wf.agents)) {
      if (a.enabled === undefined) continue;
      const enabled = typeof a.enabled === 'string' ? !off(render(a.enabled, { inputs: this.inputs })) : !!a.enabled;
      if (!enabled) delete this.wf.agents[name];
    }
    for (const s of this.wf.steps) {
      if (s.type === 'human_approval') continue;
      if (!s.agents) {
        if (!this.wf.agents[s.agent]) throw new Error(`Step "${s.id}" uses agent "${s.agent}", which is disabled for this run.`);
        continue;
      }
      s.agents = s.agents.filter((n) => this.wf.agents[n]);
      if (!s.agents.length) throw new Error(`Step "${s.id}": every agent of the fan-out is disabled for this run.`);
      if (s.min_success > s.agents.length) s.min_success = s.agents.length;
    }
  }

  // `persona: random` (the builder's "random agent" desk): the agent becomes one of the user's
  // agents, picked when the run starts; its prompt goes before the agent's own system prompt and its
  // skills are added. A resumed run keeps the previous pick. Recorded as `personas` in
  // workflow.started: { <agent>: { id, name } }.
  pickPersonas(personas, previous) {
    this.personas = {};
    for (const [name, a] of Object.entries(this.wf.agents)) {
      if (a.persona !== 'random') continue;
      const pool = personas.filter((p) => p && p.prompt);
      const p = pool.find((x) => x.id === previous?.[name]?.id) || pool[Math.floor(Math.random() * pool.length)];
      if (!p) {
        this.notices.push({ level: 'warn', message: `${name}: no agent in the Agents menu to pick at random; it runs with its own prompt.` });
        continue;
      }
      a.system_prompt = [p.prompt, a.system_prompt].filter(Boolean).join('\n\n');
      // an agent may list skills that no longer exist (the Agents screen keeps them): left out here
      const found = (p.skills || []).filter((k) => { try { return !!resolveSkill(this.skillsDirs, k); } catch { return false; } });
      const missing = (p.skills || []).filter((k) => !found.includes(k));
      if (missing.length) this.notices.push({ level: 'warn', message: `${name}: skills of "${p.name}" not found, left out: ${missing.join(', ')}.` });
      a.skills = [...new Set([...(a.skills || []), ...found])];
      this.personas[name] = { id: p.id, name: p.name };
      this.notices.push({ level: 'info', message: `${name}: random agent "${p.name}".` });
    }
  }

  // `type: run` inputs name another run by its id (its folder in runs/). Empty or "latest" picks
  // the most recent run of another workflow (so a retrospective that failed is not analyzed by the
  // next one); an id with no run folder is refused before this run starts.
  resolveRunInput(key, value) {
    const runsDir = path.dirname(this.runDir);
    const hasEvents = (id) => fs.existsSync(path.join(runsDir, id, 'events.jsonl'));
    const v = String(value ?? '').trim();
    if (!v || /^(latest|last)$/i.test(v)) {
      const workflowOf = (id) => {
        try {
          const first = fs.readFileSync(path.join(runsDir, id, 'events.jsonl'), 'utf8').split('\n', 1)[0];
          return JSON.parse(first).workflow || null;
        } catch { return null; }
      };
      const ids = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((id) => id !== this.runId && hasEvents(id)).sort().reverse() : [];
      const latest = ids.find((id) => workflowOf(id) !== this.wf.metadata?.name);
      if (!latest) throw new Error(`Input "${key}": there is no run to use as "latest" in ${runsDir}.`);
      return latest;
    }
    const id = path.basename(v);
    if (id !== v || !hasEvents(id)) {
      throw new Error(`Input "${key}": "${v}" is not a run id. Use the id of a run (its folder name in ${runsDir}, shown in the run view) or "latest".`);
    }
    return id;
  }

  emitEvent(type, data = {}) {
    const ev = { seq: ++this.seq, ts: new Date().toISOString(), run_id: this.runId, type, ...data };
    if (type !== 'session.stream') { this.recent.push(ev); if (this.recent.length > 300) this.recent.shift(); this.trail.apply(ev); }
    this.emit('event', ev);
    return ev;
  }

  // ---- sessions -------------------------------------------------------------
  openSession({ agent, provider, model, parentId, stepId, mode = null }) {
    const s = {
      id: agent === 'orchestrator' ? 'orchestrator' : `s${++this.nSession}`,
      agent, provider, model, parentId, stepId, mode,
      openedAt: Date.now(), closedAt: null,
      turns: 0, activeMs: 0, tokens: emptyUsage(), costUsd: 0,
      status: 'idle', providerSessionId: null,
    };
    this.sessions.set(s.id, s);
    this.emitEvent('session.opened', { session_id: s.id, session: this.snapshot(s) });
    return s;
  }

  setStatus(s, status) {
    s.status = status;
    this.emitEvent('session.status', { session_id: s.id, status });
  }

  closeSession(s, status) {
    if (s.closedAt) return;
    s.closedAt = Date.now();
    s.status = status;
    this.emitEvent('session.closed', { session_id: s.id, status, session: this.snapshot(s) });
  }

  snapshot(s) {
    const duration = (s.closedAt || Date.now()) - s.openedAt;
    return {
      id: s.id, agent: s.agent, provider: s.provider, model: s.model,
      parent_id: s.parentId, step_id: s.stepId,
      opened_at: new Date(s.openedAt).toISOString(),
      closed_at: s.closedAt ? new Date(s.closedAt).toISOString() : null,
      duration_ms: duration, active_ms: s.activeMs, idle_ms: Math.max(0, duration - s.activeMs),
      turns: s.turns, tokens: { ...s.tokens }, cost_usd: +s.costUsd.toFixed(6),
      status: s.status, provider_session_id: s.providerSessionId, cwd: s.cwd || null, mode: s.mode || null,
    };
  }

  // ---- execution ------------------------------------------------------------
  stepById(id) {
    const s = this.wf.steps.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown step: ${id}`);
    return s;
  }

  async start() {
    this.startedAt = Date.now();
    this.status = 'running';
    this.emitEvent('workflow.started', {
      workflow: this.wf.metadata?.name, version: this.wf.metadata?.version, project_id: this.projectId,
      issues: this.issues || undefined,
      file: path.basename(this.file), inputs: this.inputs, mock: this.mock, run_dir: this.runDir,
      resumed_from: this.resume ? { run_id: this.resume.runId, step: this.resume.fromStep } : undefined,
      personas: Object.keys(this.personas).length ? this.personas : undefined,
      steps: this.wf.steps.map((s) => ({ id: s.id, type: s.type || 'agent', agent: stepAgentLabel(s) })),
      groups: this.wf.groups,
    });
    for (const n of this.notices) this.emitEvent('log', { level: n.level || 'info', message: n.message });
    this.orchestrator = this.openSession({
      agent: 'orchestrator', provider: 'engine', model: 'engine (deterministic)', parentId: null, stepId: null,
    });
    this.setStatus(this.orchestrator, 'active');

    let current = this.resume?.fromStep || this.wf.steps[0].id;
    let guard = 0;
    let status = 'success';
    let error = null;
    try {
      await this.setupWorktree();
      while (current !== 'end') {
        if (current === 'fail') throw new Error('Workflow routed to "fail" (retry limit reached).');
        if (++guard > 500) throw new Error('Limit of 500 transitions reached.');
        if (this.abort.signal.aborted) throw new Error('Cancelled');
        this.checkLimits();
        current = await this.runStep(this.stepById(current));
      }
      // `goto: end` + `status: failed|cancelled` (e.g. a rejected gate): not a success
      if (this.endStatus) {
        status = this.endStatus.status;
        error = new Error(this.endStatus.message);
      }
    } catch (e) {
      status = this.abort.signal.aborted ? 'cancelled' : 'failed';
      error = e;
    }
    await this.stopWorktreeProcesses('run end');
    await this.finishWorktree(status);
    this.finish(status, error);
  }

  // ---- git worktree per run (orchestrator.worktree: { repo, base }) ------------------------
  // The run works in its own checkout, <worktreesDir>/<run_id>, detached at the freshly fetched
  // origin/<base>; `worktree_dir` in the templates points to it. A resumed run reuses the previous
  // run's folder (recreated from its branch if it was deleted), so resumed CLI sessions keep their cwd.
  // Not a git repository, or no worktreesDir (simulation): worktree_dir = the repository folder.
  async setupWorktree() {
    const cfg = this.wf.orchestrator?.worktree;
    if (!cfg) return;
    const repo = render(cfg.repo, this.ctx).trim();
    const base = render(cfg.base, this.ctx).trim() || null;
    // remote: false = a local workflow: start from the local base (no fetch) and merge back into it
    const remote = cfg.remote !== false && String(cfg.remote).trim().toLowerCase() !== 'false';
    this.ctx.worktree_dir = repo;
    const log = (level, message) => this.emitEvent('log', { level, message });
    if (!this.worktreesDir) {
      log('info', `worktree: ${this.mock ? 'simulation, ' : ''}no worktree for this run; agents work in ${repo}`);
      return;
    }
    const prev = this.resume?.worktree;
    const dir = prev?.dir || path.join(this.worktreesDir, this.runId);
    const info = await prepareWorktree({ repo, base, dir, branch: prev?.branch || null, log, remote });
    if (!info) {
      log('info', `worktree: ${repo} is not a git repository; agents work in it directly`);
      return;
    }
    this.worktree = info;
    this.ctx.worktree_dir = info.workDir;
    const how = info.reused ? 'reusing' : info.recreated ? 'recreated' : 'created';
    this.emitEvent('worktree.ready', {
      dir: info.dir, work_dir: info.workDir, repo: info.repo, base: info.base, ref: info.ref, commit: info.commit, reused: info.reused, recreated: info.recreated,
    });
    log('info', `worktree: ${how} ${info.dir} at ${info.ref || 'its branch'} (${String(info.commit || '').slice(0, 8)})`);
  }

  // Success: remove the worktree and its local branch when merged. Otherwise keep it for a resume.
  async finishWorktree(status) {
    const wt = this.worktree;
    if (!wt) return;
    const log = (level, message) => this.emitEvent('log', { level, message });
    try {
      if (status === 'success') {
        const r = await removeWorktree({ repo: wt.repo, dir: wt.dir, base: wt.base, log, remote: wt.remote !== false });
        Object.assign(wt, { removed: r.removed, branch: r.branch, branchDeleted: r.branchDeleted });
        this.emitEvent('worktree.removed', { dir: wt.dir, removed: r.removed, branch: r.branch, branch_deleted: r.branchDeleted });
        log('info', `worktree: removed ${wt.dir}${r.branch ? `; branch ${r.branch} ${r.branchDeleted ? 'deleted (merged)' : 'kept'}` : ''}`);
      } else {
        Object.assign(wt, { removed: false, branch: await currentBranch(wt.dir) });
        this.emitEvent('worktree.kept', { dir: wt.dir, branch: wt.branch });
        log('info', `worktree: kept ${wt.dir}${wt.branch ? ` (branch ${wt.branch})` : ''} to resume the run`);
      }
    } catch (e) {
      log('warn', `worktree: cleanup failed: ${e.message}`);
    }
  }

  // Programs an agent started from the worktree and left running (a UI check's electron.exe, a
  // dev server) hold its files: every later `npm ci` fails with EBUSY and no agent may stop them.
  // Stopped after each agent turn and at the end of the run; see src/engine/processes.js.
  async stopWorktreeProcesses(after) {
    const dir = this.worktree?.dir;
    if (!dir || !this.stopProcesses) return;
    let found;
    try {
      found = await this.stopProcesses(dir);
    } catch (e) {
      this.emitEvent('log', { level: 'warn', message: `worktree: could not check for processes left in ${dir}: ${e.message}` });
      return;
    }
    if (!found?.length) return;
    const processes = found.map((p) => ({ pid: p.pid, exe: p.exe || null, cwd: p.cwd || null, reason: p.reason, stopped: !!p.stopped, error: p.error }));
    this.emitEvent('worktree.processes_stopped', { dir, after, processes });
    const list = processes.map((p) => `${path.basename(p.exe || '?')} (pid ${p.pid}${p.stopped ? '' : `, not stopped: ${p.error}`})`).join(', ');
    this.emitEvent('log', { level: 'warn', kind: 'worktree_processes', message: `worktree: stopped ${processes.filter((p) => p.stopped).length} process(es) left running in ${dir} after ${after}: ${list}` });
  }

  worktreeSummary() {
    const wt = this.worktree;
    if (!wt) return this.ctx.worktree_dir ? { dir: null, work_dir: this.ctx.worktree_dir } : null;
    return {
      dir: wt.dir, work_dir: wt.workDir, repo: wt.repo, base: wt.base, ref: wt.ref, commit: wt.commit,
      branch: wt.branch || null, removed: !!wt.removed, branch_deleted: !!wt.branchDeleted,
    };
  }

  stop() {
    this.abort.abort();
    for (const a of this.approvals.values()) a.reject(new Error('Cancelled'));
  }

  checkLimits() {
    const lim = this.wf.orchestrator?.limits || {};
    const maxDur = parseDuration(lim.max_total_duration, null);
    if (maxDur && Date.now() - this.startedAt > maxDur) {
      this.emitEvent('limit.exceeded', { limit: 'max_total_duration', value: lim.max_total_duration });
      throw new Error(`Maximum duration exceeded (${lim.max_total_duration}).`);
    }
    const cost = [...this.sessions.values()].reduce((a, s) => a + s.costUsd, 0);
    if (lim.max_total_cost_usd && cost > lim.max_total_cost_usd) {
      this.emitEvent('limit.exceeded', { limit: 'max_total_cost_usd', value: lim.max_total_cost_usd, current: cost });
      throw new Error(`Maximum cost exceeded (US$ ${lim.max_total_cost_usd}).`);
    }
  }

  async runStep(step) {
    const st = this.ctx.steps[step.id];
    // /loop iteration: resets whenever the step is (re)entered from another step
    const again = this.prevStepId === step.id;
    if (!again) { st.iteration = 0; st.loopStartedAt = Date.now(); st.blocked = null; st.probeBaseline = null; }
    st.iteration++;
    this.ctx.previous_step = this.prevStepId || null;
    this.prevStepId = step.id;
    const t0 = Date.now();
    // `wait:` the engine checks the PR/MR or CI run itself; the agent only runs on news
    if (again && step.wait) {
      const next = await this.pollStep(step, st, t0);
      if (next) return next;
    }
    st.visits++;
    st.firstVisitAt ??= Date.now();
    st.tools = { ran: 0, denials: 0, denied: [] }; // this visit's tool calls, for the blocked-loop check
    st.turnRecs = []; // this visit's turn records (turnLog), marked as waste when the visit was blocked
    this.emitEvent('step.started', { step_id: step.id, visit: st.visits, iteration: st.iteration, step_type: step.type || 'agent', agent: stepAgentLabel(step) });

    let output, scope;
    if (step.type === 'human_approval') {
      const { answer, feedback } = await this.requestApproval(step);
      if (step.choices) {
        output = { choice: answer, feedback };
        scope = { ...this.ctx, output, choice: answer, feedback };
      } else {
        output = { approved: answer, feedback };
        scope = { ...this.ctx, output, approved: answer, rejected: !answer, feedback };
      }
      st.output = output;
    } else {
      try {
        output = step.agents ? await this.runFanOut(step, st) : await this.runAgentStep(step, st, step.agent);
      } catch (e) {
        this.lastStepError = e.message;
        if (this.abort.signal.aborted) throw e;
        // the AI supervisor may fix the output, retry with an instruction, or go to an allowed step
        const r = e.idleInterrupt ? this.idleRetry(step, st, e) : await this.superviseFailure(step, st, e);
        if (r?.output) {
          output = r.output;
        } else if (r?.goto) {
          st.output = { error: e.message, supervisor: r.decision };
          this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output: st.output, duration_ms: Date.now() - t0, error: true });
          this.emitEvent('step.transition', { from: step.id, to: r.goto, when: `supervisor: ${r.decision.action}` });
          return r.goto;
        }
      } finally {
        await this.stopWorktreeProcesses(`step ${step.id}`);
      }
      if (output === undefined) {
        const e = new Error(this.lastStepError || `Step "${step.id}" failed.`);
        // `on_error: <step>`: a failing step (agent error, invalid output) does not end the run;
        // its output becomes { error } and the flow goes to that step.
        if (!step.on_error) throw e;
        st.output = { error: e.message };
        this.emitEvent('log', { level: 'error', message: `${step.id} failed: ${e.message} → ${step.on_error}` });
        this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output: st.output, duration_ms: Date.now() - t0, error: true });
        this.emitEvent('step.transition', { from: step.id, to: step.on_error, when: 'on_error' });
        return step.on_error;
      }
      st.output = output;
      scope = { ...this.ctx, output, iteration: st.iteration };
      if (step.wait) await this.afterAgentTurn(step, st);
    }
    return this.finishStep(step, st, output, scope, t0);
  }

  // step.finished, the /goal check and the transitions of a step that has its output.
  async finishStep(step, st, output, scope, t0, extra = {}) {
    this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output, duration_ms: Date.now() - t0, ...extra });

    if (step.goal) {
      const met = evalExpr(step.goal.until, scope);
      this.emitEvent('step.goal', { step_id: step.id, goal: render(step.goal.description, scope), met, iteration: st.iteration });
    }

    if (!step.transitions?.length) {
      const i = this.wf.steps.indexOf(step);
      const next = this.wf.steps[i + 1]?.id || 'end';
      this.emitEvent('step.transition', { from: step.id, to: next, when: '(sequential)' });
      return next;
    }

    for (const t of step.transitions) {
      if (!evalExpr(t.when, scope)) continue;
      // an action that renders empty (a conditional one whose condition is false) runs nothing
      const action = t.action ? render(t.action, scope).trim() : '';
      try {
        if (action) await this.runAction(action);
        // `merge: local`: the engine merges the run's branch into the local base (no push, no PR)
        if (t.merge === 'local') await this.mergeWorktreeLocally();
      } catch (e) {
        // `on_error: <step>` on the transition: a failed action or merge goes there (the error is
        // in the template context as `action_error`) instead of ending the run
        if (!t.on_error || this.abort.signal.aborted) throw e;
        this.ctx.action_error = { step: step.id, message: e.message };
        this.emitEvent('log', { level: 'warn', message: `${step.id}: ${e.message} → ${t.on_error}` });
        this.emitEvent('step.transition', { from: step.id, to: t.on_error, when: 'on_error' });
        return t.on_error;
      }
      // limits first: once max_visits / loop.max_iterations is reached the flow goes to
      // on_exhausted and the delegation is skipped (nothing would check that fix any more)
      let target = this.applyCounters(step, t);
      let delegated = null;
      if (t.delegate && target === t.goto) {
        this.emitEvent('log', { level: 'info', message: `${step.id} delegated to ${t.delegate.agent}` });
        const res = await this.sendToAgent(t.delegate.agent, render(t.delegate.prompt, scope), { stepId: `${step.id}:delegate` })
          .finally(() => this.stopWorktreeProcesses(`${step.id} delegation to ${t.delegate.agent}`));
        delegated = { agent: t.delegate.agent, text: res.text };
      }
      if (delegated) st.blocked = null; // another agent acted: the next check is a fresh start
      if (target === step.id && isLooping(step)) target = await this.loopWait(step, output, { probed: !!extra.probe });
      // the delegation result goes to the next step (e.g. babysitter replies on the PR with the hash)
      if (delegated && this.ctx.steps[target]) this.ctx.steps[target].delegate_result = delegated;
      const ends = target === 'end' && t.status && t.status !== 'success';
      if (ends) this.endStatus = { status: t.status, message: `Run ended as ${t.status} at step "${step.id}" (${t.when}).` };
      this.emitEvent('step.transition', { from: step.id, to: target, when: t.when, ...(ends ? { status: t.status } : {}) });
      return target;
    }
    throw new Error(`No transition matched in step "${step.id}".`);
  }

  // ---- `wait:` deterministic checks between the agent's turns of a /loop (src/engine/probes.js) ----
  // Returns the next step (poll again, /loop limit, or the step finished by the check), or null to
  // run the agent turn: after a delegation or a supervisor note, and whenever the check has news
  // (a failure, a conflict, a change on the PR/MR, an unknown state or a check that could not run).
  async pollStep(step, st, t0) {
    const w = step.wait;
    if (st.delegate_result || st.supervisorNote || !st.output || st.output.error) return null;
    const target = render(w.target, { ...this.ctx, output: st.output }).trim();
    const stats = (this.probeStats[step.id] ??= { polls: 0, agent_calls: 0, completed: 0, errors: 0 });
    let r;
    try {
      if (!target) throw new Error(`${w.probe}: no target yet (${w.target} is empty)`);
      r = await this.probe({ probe: w.probe, target, cwd: this.ctx.worktree_dir || undefined, signal: this.abort.signal, stepId: step.id, quota: this.actionsQuota });
    } catch (e) {
      if (this.abort.signal.aborted) throw new Error('Cancelled');
      r = { state: 'error', detail: `the check could not run (${e.message})` };
      stats.errors++;
    }
    let state = r.state;
    // pr_changes: news = the PR/MR differs from what the agent saw at the end of its last turn
    if (w.probe === 'pr_changes' && r.fingerprint !== undefined && !['merged', 'closed', 'error'].includes(state)) {
      state = st.probeBaseline && r.fingerprint === st.probeBaseline ? 'unchanged' : 'changed';
      if (state === 'changed') r.detail = st.probeBaseline ? `the PR/MR changed since your last turn (${r.detail})` : `the PR/MR could not be compared with your last turn (${r.detail})`;
    }
    let action = 'agent';
    let output = null;
    // the agent's last output with the given fields over it (templates see `probe`: { state, detail })
    const finishWith = (key) => {
      const scope = { ...this.ctx, output: st.output, probe: { state, detail: r.detail || state } };
      const out = { ...st.output, ...Object.fromEntries(Object.entries(w[key]).map(([k, v]) => [k, typeof v === 'string' ? render(v, scope) : v])) };
      const errs = validateSchema(out, step.output_schema);
      if (!errs.length) return out;
      this.emitEvent('log', { level: 'warn', message: `${step.id}: wait.${key} does not match the output schema (${errs.join('; ')}); calling the agent` });
      return null;
    };
    if (state === 'pending' || state === 'unchanged') action = 'poll';
    else if (state === 'none') action = Date.now() - (st.lastAgentAt || 0) < parseDuration(w.grace ?? DEFAULT_WAIT_GRACE, 600000) ? 'poll' : 'agent';
    else if (state === 'passed' && w.output) output = finishWith('output');
    // CI cannot run at all (the Actions quota ran out): no agent turn or fix round helps
    else if (state === 'quota_exhausted' && w.infra_output) output = finishWith('infra_output');
    if (output) action = 'output';
    if (state === 'none' && action === 'agent') r.detail = `${r.detail}, ${w.grace ?? DEFAULT_WAIT_GRACE} after your last turn`;
    st.probePolls = (st.probePolls || 0) + 1;
    this.emitEvent('step.probe', {
      step_id: step.id, probe: w.probe, target, state, detail: r.detail || state, action, iteration: st.iteration, polls: st.probePolls,
    });
    if (state === 'error') this.emitEvent('log', { level: 'warn', kind: 'probe_error', step_id: step.id, message: `${step.id}: ${r.detail}; calling the agent instead` });

    if (action === 'poll') {
      stats.polls++;
      const next = await this.loopWait(step, st.output, { probed: true });
      if (next !== step.id) this.emitEvent('step.transition', { from: step.id, to: next, when: `/loop limit (${loopConfig(step).max_duration})` });
      return next;
    }
    if (action === 'output') {
      stats.completed++;
      this.logDecisions('orchestrator', step.id, [['wait', `finished ${step.id} without an agent turn`, `${w.probe}: ${r.detail}`, target, JSON.stringify(state === 'passed' ? w.output : w.infra_output)]]);
      st.output = output;
      return this.finishStep(step, st, output, { ...this.ctx, output, iteration: st.iteration }, t0, { probe: w.probe });
    }
    stats.agent_calls++;
    st.probeNews = { detail: r.detail || state, polls: st.probePolls };
    return null;
  }

  // After an agent turn of a `wait:` step: the grace period for "no check yet" starts again, and
  // pr_changes records what the agent saw, so only a later change calls it again.
  async afterAgentTurn(step, st) {
    st.lastAgentAt = Date.now();
    st.probePolls = 0;
    st.probeBaseline = null;
    if (step.wait.probe !== 'pr_changes') return;
    const target = render(step.wait.target, { ...this.ctx, output: st.output }).trim();
    if (!target) return;
    try {
      const r = await this.probe({ probe: step.wait.probe, target, cwd: this.ctx.worktree_dir || undefined, signal: this.abort.signal, stepId: step.id, baseline: true });
      st.probeBaseline = r?.fingerprint ?? null;
    } catch { /* no baseline: the next check calls the agent */ }
  }

  mockProbe({ probe, stepId, baseline }) {
    if (baseline) return Promise.resolve({});
    const seq = this.mockSequences?.probes?.[stepId] || MOCK_PROBES[probe];
    const n = (this.mockProbeCalls[stepId] = (this.mockProbeCalls[stepId] || 0) + 1);
    const state = seq[Math.min(n - 1, seq.length - 1)];
    return Promise.resolve({ state, detail: `(simulated) ${probe}: ${state}` });
  }

  applyCounters(step, t) {
    let target = t.goto;
    // limits can be templates over the inputs (max_iterations: "{{ inputs.max_rounds }}")
    const limit = (v) => +render(String(v), this.ctx);
    if (t.max_visits) {
      const key = `${step.id}->${t.goto}`;
      this.counters[key] = (this.counters[key] || 0) + 1;
      if (this.counters[key] > limit(t.max_visits)) {
        target = t.on_exhausted || 'fail';
        this.emitEvent('log', { level: 'warn', message: `max_visits (${t.max_visits}) reached at ${key} → ${target}` });
      }
    }
    if (t.loop) {
      const name = t.loop.name || `${step.id}->${t.goto}`;
      this.loops[name] = (this.loops[name] || 0) + 1;
      if (this.loops[name] > limit(t.loop.max_iterations)) {
        target = t.loop.on_exhausted || 'fail';
        this.emitEvent('log', { level: 'warn', message: `loop "${name}" reached ${t.loop.max_iterations} iterations → ${target}` });
      } else {
        this.ctx.loop = { name, iteration: this.loops[name] };
      }
    }
    return target;
  }

  // probed: the iteration was the engine's own check (`wait:`), not an agent turn, so it cannot be "blocked"
  async loopWait(step, output, { probed = false } = {}) {
    const st = this.ctx.steps[step.id];
    const cfg = loopConfig(step);
    const exhausted = step.goal?.on_exhausted || cfg.on_exhausted || 'fail';
    const maxDur = parseDuration(cfg.max_duration, null);
    if (maxDur && Date.now() - st.loopStartedAt > maxDur) {
      this.emitEvent('log', { level: 'warn', message: `/loop of ${step.id} exceeded ${cfg.max_duration} without meeting the /goal → ${exhausted}` });
      return exhausted;
    }
    const stop = probed ? null : this.checkBlocked(step, st, output);
    if (stop) {
      this.emitEvent('log', { level: 'warn', kind: 'loop_blocked', step_id: step.id, message: `/loop of ${step.id} stopped: ${stop} → ${exhausted}` });
      this.logDecisions('orchestrator', step.id, [[
        'loop', `stopped the /loop of ${step.id} → ${exhausted}`,
        `${stop}; polling again (every ${cfg.interval || '1m'}, up to ${cfg.max_duration || 'no limit'}) could not change anything`,
        `refused: ${st.blocked.denied.slice(-3).join(' · ') || '(no tool call)'}; answer: ${JSON.stringify(output).slice(0, 200)}`,
        exhausted,
      ]]);
      return exhausted;
    }
    // simulation: at most 3s, scaled like the mock's delays (tests run with a small scale)
    const interval = Math.min(parseDuration(cfg.interval, 60000), this.mock ? 3000 * +(process.env.MULTIAGENT_MOCK_DELAY_SCALE ?? 1) : Infinity);
    this.emitEvent('step.waiting', { step_id: step.id, until: new Date(Date.now() + interval).toISOString(), interval_ms: interval });
    this.setStatus(this.orchestrator, 'waiting');
    await sleep(interval, this.abort.signal);
    this.setStatus(this.orchestrator, 'active');
    return step.id;
  }

  // Counts blocked /loop iterations in a row (see DEFAULT_MAX_BLOCKED); returns why the loop
  // must stop once `loop.max_blocked` is reached, else null.
  checkBlocked(step, st, output) {
    const max = +render(String(maxBlocked(step)), this.ctx);
    const tools = st.tools || { ran: 0, denials: 0, denied: [] };
    const key = decisionKey(output, step.output_schema);
    const prev = st.blocked;
    const blind = tools.ran === 0; // everything refused, or no tool call at all
    const repeated = tools.denials > 0 && (!prev || prev.key === key);
    if (!blind && !repeated) { st.blocked = null; return null; }
    st.blocked = { count: (prev?.count || 0) + 1, key, denied: [...(prev?.denied || []), ...tools.denied].slice(-10) };
    for (const rec of st.turnRecs || []) rec.waste ??= 'blocked'; // tokens spent on an iteration that could not progress
    if (!max || st.blocked.count < max) return null;
    const why = blind && !tools.denials ? 'made no tool call' : blind ? 'had every tool call refused' : 'had tool calls refused and gave the same answer';
    return `${st.blocked.count} iterations in a row blocked (the agent ${why}, ${tools.denials} refused in the last one)`;
  }

  // Fan-out: the same step runs in parallel for each agent in `agents`, each one
  // in its own session. output = { results: { agent: output }, succeeded, failed }.
  // `min_success` (default: all) says how many must respond for the step to count.
  async runFanOut(step, st) {
    const settled = await Promise.allSettled(step.agents.map((name) => this.runAgentStep(step, st, name)));
    st.delegate_result = null; // consumed by all agents
    st.supervisorNote = null;
    if (this.abort.signal.aborted) throw new Error('Cancelled');
    const results = {};
    const failed = [];
    settled.forEach((r, i) => {
      const name = step.agents[i];
      if (r.status === 'fulfilled') { results[name] = r.value; return; }
      failed.push({ agent: name, error: r.reason?.message || String(r.reason) });
      this.emitEvent('log', { level: 'error', message: `[${step.id}] ${name} failed: ${r.reason?.message || r.reason}` });
    });
    const succeeded = Object.keys(results);
    const min = step.min_success ?? step.agents.length;
    if (succeeded.length < min) {
      const why = failed.map((f) => `${f.agent}: ${f.error}`).join(' | ');
      throw new Error(`Step "${step.id}": only ${succeeded.length}/${step.agents.length} agents responded (minimum ${min}). ${why}`);
    }
    return { results, succeeded, failed };
  }

  async runAgentStep(step, st, agentName) {
    const visit = st.visits;
    const schema = step.output_schema;
    const scope = { ...this.ctx, iteration: st.iteration, delegate_result: st.delegate_result, agent: agentName };
    let prompt = render(step.prompt, scope).trim();
    if (st.supervisorNote) {
      prompt += `\n\n---\nNote from the run supervisor (a previous attempt of this step failed):\n${st.supervisorNote}`;
      if (!step.agents) st.supervisorNote = null;
    }
    if (!step.agents) st.delegate_result = null; // consumed (in a fan-out, after all of them)
    // step skills go in the prompt itself; the name can be a template ("{{ inputs.document_skill }}")
    const skills = this.loadSkills((step.skills || []).map((n) => render(n, scope).trim()));
    if (skills.length) prompt = `${skills.map(skillPrompt).join('\n\n')}\n\n${prompt}`;
    const extra = goalLoopInstructions(step, st, this.ctx);
    st.probeNews = null; // consumed
    if (extra) prompt += '\n\n---\n' + extra;
    if (schema) {
      prompt += '\n\n---\nAt the end of your response you MUST include a ```json block with an object that validates against this JSON Schema:\n```json\n'
        + JSON.stringify(schema, null, 2) + '\n```';
    }
    const hint = { stepId: step.id, visit, schema, agent: agentName, sequences: this.mockSequences };
    const opts = { stepId: step.id, hint, skills, capabilities: step.capabilities, editsTests: step.edits_tests };
    const countTools = (r) => {
      if (r.turnRec) st.turnRecs?.push(r.turnRec);
      if (!r.tools || !st.tools) return;
      st.tools.ran += r.tools.ran;
      st.tools.denials += r.tools.denials;
      st.tools.denied.push(...r.tools.denied);
    };
    let res = await this.sendToAgent(agentName, prompt, opts);
    countTools(res);
    st.lastAnswer = res.text;
    if (!schema) {
      this.saveOutput(step, scope, res.text, { text: res.text });
      return { text: res.text };
    }

    for (let attempt = 0; ; attempt++) {
      let errs;
      try {
        const out = extractJson(res.text);
        errs = validateSchema(out, schema);
        if (!errs.length) {
          this.saveOutput(step, scope, JSON.stringify(out, null, 2), out);
          return out;
        }
      } catch (e) {
        errs = [e.message];
      }
      this.emitEvent('log', { level: 'warn', message: `Invalid output in ${step.id}${step.agents ? ` (${agentName})` : ''}: ${errs.join('; ')}` });
      if (attempt >= 2) throw new Error(`Output of step "${step.id}" failed validation: ${errs.join('; ')}`);
      res = await this.sendToAgent(agentName, this.retryPrompt(agentName, prompt, res.text, schema, errs), { ...opts, retry: true });
      countTools(res);
      st.lastAnswer = res.text;
    }
  }

  // ---- AI supervisor (orchestrator.supervisor in the YAML; skill run-supervisor) ------------
  // Called only when a step fails. It explains the failure and picks a recovery; the engine
  // validates it: fixed outputs must match the step's schema, goto only to the step's own
  // targets, and it never touches a human gate.
  setupSupervisor() {
    const orch = this.wf.orchestrator || {};
    const cfg = orch.supervisor;
    if (!cfg || cfg.enabled === false) { this.supervisorCfg = null; return; }
    const providerName = cfg.provider || orch.provider || 'claude';
    const name = this.wf.agents.supervisor ? '_supervisor' : 'supervisor';
    // read-only on the run folder: it works on the workflow, never on the user's code
    this.wf.agents[name] = {
      provider: providerName, model: cfg.model || orch.model, session: 'ephemeral', working_dir: '{{ run_dir }}',
      skills: ['run-supervisor'], capabilities: { tools: ['read'], web: false }, timeout: cfg.timeout || '10m',
      system_prompt: 'You are the run supervisor of this workflow engine.',
    };
    this.ctx.agents[name] = { provider: providerName, model: cfg.model || orch.model };
    this.supervisorCfg = { agent: name, perStep: cfg.max_interventions ?? 2, total: cfg.max_total ?? 6 };
    this.supervisorUsed = 0;
  }

  async superviseFailure(step, st, err) {
    const cfg = this.supervisorCfg;
    if (!cfg) return null;
    st.interventions ??= [];
    if (st.interventions.length >= cfg.perStep || this.supervisorUsed >= cfg.total) {
      this.emitEvent('log', { level: 'warn', message: `Supervisor: no more interventions allowed on ${step.id}.` });
      return null;
    }
    this.supervisorUsed++;
    const allowed = [...new Set([step.id, step.on_error, ...(step.transitions || []).flatMap((t) => [t.goto, t.on_exhausted])])]
      .filter((x) => x && x !== 'end' && x !== 'fail' && this.wf.steps.some((y) => y.id === x && y.type !== 'human_approval'));
    this.emitEvent('supervisor.started', { step_id: step.id, error: err.message });
    // the agents' own summaries of where they are, instead of their full transcripts
    const handoffs = (step.agents || [step.agent]).map((a) => this.handoffNotes.get(a) && { agent: a, ...this.handoffNotes.get(a) }).filter(Boolean);
    const prompt = supervisor.decisionPrompt({ wf: this.wf, step, error: err.message, answer: st.lastAnswer, allowed, events: this.recent, previous: st.interventions, handoffs });
    const decision = await this.askSupervisor(step, prompt, supervisor.DECISION_SCHEMA, st.interventions.length + 1);
    if (!decision) return null;
    st.interventions.push({ action: decision.action, explanation: decision.explanation });
    const emit = (action, extra = {}) => this.emitEvent('supervisor.decision', {
      step_id: step.id, action, cause_class: decision.cause_class || null, explanation: decision.explanation,
      instruction: decision.instruction || null, goto: decision.goto || null, ...extra,
    });
    const retry = (instruction) => { st.supervisorNote = instruction || decision.instruction || 'Your previous attempt failed; read the error and try again.'; return { goto: step.id, decision }; };

    switch (decision.action) {
      case 'fix_output': {
        const errs = step.agents ? ['parallel steps cannot be fixed'] : step.output_schema ? validateSchema(decision.output, step.output_schema) : [];
        if (decision.output != null && !errs.length) { emit('fix_output'); return { output: decision.output, decision }; }
        emit('retry', { note: `fixed output rejected: ${errs.join('; ') || 'empty'}` });
        return retry();
      }
      case 'retry':
        emit('retry');
        return retry();
      case 'goto':
        if (allowed.includes(decision.goto)) { emit('goto'); return { goto: decision.goto, decision }; }
        emit('ask_human', { note: `goto "${decision.goto}" is not allowed` });
        return this.supervisorAsksHuman(step, decision, retry);
      case 'ask_human':
        emit('ask_human');
        return this.supervisorAsksHuman(step, decision, retry);
      default:
        emit('fail');
        return null;
    }
  }

  // One supervisor decision that validates against `schema` (asked again once), or null.
  async askSupervisor(step, prompt, schema, visit) {
    const cfg = this.supervisorCfg;
    const opts = { stepId: `${step.id}:supervisor`, hint: { stepId: `${step.id}:supervisor`, visit, schema, sequences: this.mockSequences } };
    let decision;
    try {
      const full = `${prompt}\n\n---\nAt the end of your response you MUST include a \`\`\`json block with an object that validates against this JSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``;
      let res = await this.sendToAgent(cfg.agent, full, opts);
      for (let attempt = 0; ; attempt++) {
        let errs;
        try { decision = extractJson(res.text); errs = validateSchema(decision, schema); } catch (e) { errs = [e.message]; }
        if (!errs.length) return decision;
        if (attempt >= 1) throw new Error(`invalid decision: ${errs.join('; ')}`);
        res = await this.sendToAgent(cfg.agent, this.retryPrompt(cfg.agent, full, res.text, schema, errs), opts);
      }
    } catch (e) {
      this.emitEvent('log', { level: 'error', message: `Supervisor could not decide on ${step.id}: ${e.message}` });
      return null;
    }
  }

  // An agent_idle warning on a step's turn wakes the supervisor with the command being waited on.
  // `wait` leaves the turn alone; `interrupt` stops it (interrupt()), and the step runs again with the
  // supervisor's instruction (idleRetry). Counts against max_total, not the step's failure interventions.
  async superviseIdle(step, stall, { agentName, interrupt }) {
    const cfg = this.supervisorCfg;
    if (this.supervisorUsed >= cfg.total) {
      this.emitEvent('log', { level: 'warn', message: `Supervisor: no more interventions allowed; ${step.id} keeps waiting.` });
      return;
    }
    this.supervisorUsed++;
    const st = this.ctx.steps[step.id];
    st.idleChecks = (st.idleChecks || 0) + 1;
    this.emitEvent('supervisor.started', { step_id: step.id, kind: 'idle', error: `agent idle: ${stall.command}` });
    const handoffs = (step.agents || [step.agent]).map((a) => this.handoffNotes.get(a) && { agent: a, ...this.handoffNotes.get(a) }).filter(Boolean);
    const prompt = supervisor.idlePrompt({ wf: this.wf, step, agent: agentName, idle: stall, events: this.recent, handoffs });
    const decision = await this.askSupervisor(step, prompt, supervisor.IDLE_SCHEMA, st.idleChecks);
    if (!decision) return;
    const interrupted = decision.action === 'interrupt' && interrupt(decision, stall);
    this.emitEvent('supervisor.decision', {
      step_id: step.id, kind: 'idle', action: decision.action, explanation: decision.explanation,
      instruction: decision.instruction || null, command: stall.command,
      ...(decision.action === 'interrupt' && !interrupted ? { note: 'not interrupted: the agent had resumed or the turn had ended' } : {}),
    });
  }

  // A turn the supervisor interrupted: the step runs again with its instruction (no second supervisor call).
  idleRetry(step, st, e) {
    st.supervisorNote = e.idleInterrupt.instruction
      || `Your previous attempt was stopped after waiting with no output on: ${e.idleInterrupt.command}. Run long commands in the foreground with a timeout and read their exit code.`;
    return { goto: step.id, decision: { action: 'retry', explanation: e.message } };
  }

  async supervisorAsksHuman(step, decision, retry) {
    const { answer, feedback } = await this.requestApproval({
      id: step.id, raw: true,
      message: `The step "${step.id}" failed and the supervisor needs you.\n\n${decision.explanation}${decision.instruction ? `\n\nSuggested instruction for a new attempt:\n${decision.instruction}` : ''}`,
      choices: [{ id: 'retry', label: 'Retry the step with the suggestion' }, { id: 'stop', label: 'Stop here' }],
      feedback: { label: 'Your instruction for the new attempt (optional, replaces the suggestion)' },
    });
    return answer === 'retry' ? retry(feedback) : null;
  }

  // Asks the agent to fix an answer that did not validate. The schema always goes along; an
  // ephemeral or handoff agent answers in a fresh session that has not seen the task nor its previous
  // answer, so those go along too (otherwise it answers "{}" or describes the errors).
  retryPrompt(agentName, prompt, previous, schema, errs) {
    const fix = `Your last response did not validate against the JSON Schema:\n- ${errs.join('\n- ')}\n`
      + `Reply again with only a \`\`\`json block that validates against this schema, keeping the content of your answer:\n`
      + `\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``;
    const def = { ...(this.wf.defaults || {}), ...this.wf.agents[agentName] };
    if ((def.session || 'persistent') === 'persistent') return fix;
    return `${prompt}\n\n---\nYou already answered this task:\n<previous_answer>\n${String(previous).slice(-20000)}\n</previous_answer>\n\n${fix}`;
  }

  // Read once per run: editing the skill mid-run does not change what the agents already received.
  // Expands `uses:` from the skills' frontmatter: dependencies come first, each skill
  // once, cycles ignored. E.g. unit-test-writer-go uses testing-principles.
  loadSkills(names) {
    const out = [];
    const seen = new Set();
    const visit = (name, chain) => {
      if (!name || seen.has(name) || chain.includes(name)) return;
      const skill = this.loadSkill(name);
      for (const dep of skill.uses) visit(dep, [...chain, name]);
      seen.add(name);
      out.push(skill);
    };
    for (const n of names) visit(n, []);
    return out;
  }

  loadSkill(name) {
    this.skillCache ??= new Map();
    if (!this.skillCache.has(name)) {
      const skill = resolveSkill(this.skillsDirs, name);
      this.skillCache.set(name, skill);
      this.emitEvent('log', { level: 'info', message: `skill "${skill.name}" loaded from ${skill.path}` });
    }
    return this.skillCache.get(name);
  }

  // `save_as`: writes the agent's response to a file (a path or a list;
  // templates have access to `agent`). Relative paths go in the run folder.
  // An entry can also be `{ path, content }`: `content` is a template with the step's `output`,
  // e.g. { path: document.md, content: "{{ output.document }}" } saves one field of a JSON answer.
  saveOutput(step, scope, text, output) {
    for (const t of step.save_as ? [].concat(step.save_as) : []) {
      const rel = render(typeof t === 'object' ? t.path : t, scope).trim();
      if (!rel) continue;
      const content = typeof t === 'object' && t.content != null ? render(t.content, { ...scope, output }) : text;
      const file = path.resolve(this.runDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(content ?? ''));
      this.emitEvent('file.saved', { step_id: step.id, agent: scope.agent, path: file });
    }
  }

  // Monthly budget per provider: checked before every real (non-mock) turn, over this run's sessions
  // and those of the other runs in progress.
  // orchestrator.limits.max_total_context (e.g. 20M): the context the run's agents have read
  // (input + cache read/write, summed over every turn). Past it, the run pauses before the next
  // agent turn until the user answers: Continue grants one more block of the same size, Stop
  // ends the run as cancelled (its worktree is kept, so it can be resumed). Never cuts a turn.
  async contextGate(stepId) {
    const raw = this.wf.orchestrator?.limits?.max_total_context;
    const lim = raw == null ? null : parseTokens(render(String(raw), this.ctx));
    if (!lim) return;
    const used = [...this.sessions.values()].reduce((a, s) => a + contextTokens(s.tokens), 0);
    this.contextAllowance ??= lim;
    if (used < this.contextAllowance) return;
    const m = (n) => `${(n / 1e6).toFixed(1)}M`;
    this.emitEvent('limit.exceeded', { limit: 'max_total_context', value: this.contextAllowance, current: used, paused: true });
    const { answer } = await this.requestApproval({
      id: `${stepId}:context_limit`, raw: true,
      message: `Paused: this run's agents have read ${m(used)} tokens of context, past its limit of ${m(this.contextAllowance)} (orchestrator.limits.max_total_context).\n\nContinue to allow another ${m(lim)}, or stop the run (its worktree is kept, so it can be resumed).`,
      choices: [{ id: 'continue', label: `Continue (another ${m(lim)})` }, { id: 'stop', label: 'Stop the run' }],
    });
    if (answer !== 'continue') {
      this.emitEvent('log', { level: 'info', message: `context limit: stopped by ${answer === false || answer === 'stop' ? 'the user' : 'timeout'}` });
      this.stop();
      throw new Error('Cancelled');
    }
    this.contextAllowance = used + lim;
    this.emitEvent('log', { level: 'info', message: `context limit: continued up to ${m(this.contextAllowance)}` });
    this.setStatus(this.orchestrator, 'active');
  }

  checkBudget(providerName) {
    const id = providerId(providerName);
    const b = id && this.budget[id];
    if (!b || (!b.limitUsd && !b.limitTokens)) return;
    let usd = b.usedUsd || 0;
    let tokens = b.usedTokens || 0;
    for (const s of [...this.sessions.values(), ...this.peerSessions()]) {
      if (providerId(s.provider) !== id) continue;
      usd += sessionCost({ cost_usd: s.costUsd, model: s.model, tokens: s.tokens }, this.prices) || 0;
      tokens += totalTokens(s.tokens);
    }
    const pct = Math.max(b.limitUsd ? usd / b.limitUsd : 0, b.limitTokens ? tokens / b.limitTokens : 0);
    const detail = [b.limitUsd && `$${usd.toFixed(2)} of $${b.limitUsd}`, b.limitTokens && `${tokens} of ${b.limitTokens} tokens`].filter(Boolean).join(', ');
    if (pct >= 1) {
      this.emitEvent('budget.exceeded', { provider: id, usd, tokens, limit_usd: b.limitUsd, limit_tokens: b.limitTokens, blocked: b.blockOnLimit });
      if (b.blockOnLimit) throw new Error(`Monthly budget for ${b.name || id} reached (${detail}). Raise it in Usage or wait for next month.`);
    } else if (pct >= WARN_AT && !this.budgetWarned.has(id)) {
      this.budgetWarned.add(id);
      this.emitEvent('log', { level: 'warn', message: `${b.name || id} is at ${Math.round(pct * 100)}% of its monthly budget (${detail}).` });
    }
  }

  // Decision log (decision-log skill): agents end their answer with a ```decisions block of
  // "phase | decision | why | evidence | result" lines; the engine appends them, stamped with
  // time, agent and step, to <run>/decisions.tsv. Works the same for every provider and needs
  // no write access outside the repository.
  recordDecisions(agentName, stepId, text) {
    const rows = [...String(text || '').matchAll(/```decisions[^\n]*\n([\s\S]*?)```/g)]
      .flatMap((m) => m[1].split('\n'))
      .map((l) => l.trim().replace(/^[-*]\s+/, ''))
      .filter(Boolean)
      .map((l) => (l.includes('\t') ? l.split('\t') : l.split('|')));
    this.logDecisions(agentName, stepId, rows);
  }

  // Appends rows of [phase, decision, why, evidence, result] to decisions.tsv (also used by the
  // engine itself, as agent "orchestrator", for decisions like stopping a blocked /loop).
  logDecisions(agentName, stepId, rows) {
    rows = rows.map((r) => r.map((c) => String(c).trim().replace(/\s+/g, ' ')));
    if (!rows.length) return;
    const file = path.join(this.runDir, 'decisions.tsv');
    fs.mkdirSync(this.runDir, { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, 'ts\tagent\tstep\tphase\tdecision\twhy\tevidence\tresult\n');
    const ts = new Date().toISOString();
    fs.appendFileSync(file, rows.map((c) => [ts, agentName, stepId, ...[...c, '', '', '', '', ''].slice(0, 5)].join('\t')).join('\n') + '\n');
    this.emitEvent('decision.logged', { agent: agentName, step_id: stepId, count: rows.length, path: file });
  }

  // One turn of an agent. `session` in the YAML (agent or defaults):
  // - persistent (default): one conversation for the whole run. With `max_context` (e.g. 150k), a turn
  //   that ends above it makes the next turn start a fresh session from the agent's handoff note
  //   (never in the middle of a turn);
  // - ephemeral: a fresh session per turn with only the prompt;
  // - handoff: a fresh session per turn that starts from the agent's latest handoff note.
  // Persistent and handoff agents end each turn with a handoff note (runs/<id>/handoffs/).
  // opts.capabilities: the step's capabilities over the agent's; opts.retry: a schema retry
  // (no new note, no rotation); opts.editsTests: the step's `edits_tests` over the agent's.
  // `edits_tests: false`: the turn may not change test files (tests_paths, src/engine/test-paths.js).
  // The engine checks the checkout after the turn and sends it back with the list of files, at most
  // twice; after that the turn fails (the supervisor or the step's on_error take over). A snapshot or
  // a check that cannot run (git error) fails the turn too; only a folder outside git is unchecked.
  async sendToAgent(agentName, prompt, opts = {}) {
    const agent = { ...(this.wf.defaults || {}), ...this.wf.agents[agentName] };
    const guarded = !!this.wf.agents[agentName] && (opts.editsTests ?? agent.edits_tests) === false;
    const dir = guarded ? this.workingDir(agent) : null;
    const snap = guarded ? await testPaths.snapshot(dir, this.wf.tests_paths)
      .catch((e) => { throw new Error(`Could not snapshot the test files before ${agentName}'s turn in ${opts.stepId || 'a delegated turn'} (edits_tests: false): ${e.message}`); }) : null;
    let res = await this.agentTurn(agentName, prompt, { ...opts, guarded });
    for (let attempt = 1; snap; attempt++) {
      // an unchecked turn fails the step: passing it would let test changes through the guard
      const files = await testPaths.changedTestFiles(snap, { bases: this.baseRefs() })
        .catch((e) => { throw new Error(`Could not check the test files changed by ${agentName} in ${opts.stepId || 'a delegated turn'} (edits_tests: false): ${e.message}`); });
      if (!files.length) break;
      const stepId = opts.stepId || 'a delegated turn';
      this.emitEvent('tests.refused', { agent: agentName, step_id: opts.stepId || null, files, attempt });
      this.emitEvent('log', { level: 'warn', kind: 'tests_refused', agent: agentName, message: `[${agentName}] changed test files in ${stepId}, which it may not edit (edits_tests: false): ${files.join(', ')}` });
      if (attempt > 2) throw new Error(`${agentName} changed test files in ${stepId} and did not put them back: ${files.join(', ')}. Only the test writer edits tests.`);
      res = await this.agentTurn(agentName, this.testsRefusedPrompt(agentName, prompt, res.text, files, snap.head), { ...opts, guarded, retry: true });
    }
    return res;
  }

  // The run's base branch, local and remote: commits reachable from it are not the agent's.
  baseRefs() {
    const base = this.worktree?.base || render(this.wf.orchestrator?.worktree?.base || '', this.ctx).trim();
    return base ? [`refs/heads/${base}`, `refs/remotes/origin/${base}`] : [];
  }

  // A turn refused because it changed test files. As in retryPrompt, a handoff or ephemeral agent
  // answers in a fresh session, so the task and its previous answer go along.
  testsRefusedPrompt(agentName, prompt, previous, files, head) {
    const fix = 'The orchestrator refused your last turn: it changed test files, and you never create, edit or delete tests'
      + ' (only the test writer does):\n' + files.map((f) => `- ${f}`).join('\n') + '\n'
      + `Put them back as they were before your turn (\`git checkout ${head} -- <file>\` for a changed or deleted file, \`git rm\` for a new one)`
      + ' and commit, keeping your production changes. Describe what should be tested in your answer instead (in `test_notes` when the answer has it).'
      + ' Then answer again in full, in the format you were asked for.';
    const def = { ...(this.wf.defaults || {}), ...this.wf.agents[agentName] };
    if ((def.session || 'persistent') === 'persistent') return fix;
    return `${prompt}\n\n---\nYou already answered this task:\n<previous_answer>\n${String(previous).slice(-20000)}\n</previous_answer>\n\n${fix}`;
  }

  async agentTurn(agentName, prompt, { stepId, hint, skills: stepSkills = [], capabilities: stepCaps, retry = false, guarded = false } = {}) {
    const def = this.wf.agents[agentName];
    if (!def) throw new Error(`Unknown agent: ${agentName}`);
    const agent = { ...(this.wf.defaults || {}), ...def };
    const mode = agent.session || 'persistent';
    const persistent = mode === 'persistent';
    // agent skills go in the system prompt (1st turn); step skills, in the step prompt
    const agentSkills = this.loadSkills((agent.skills || []).map((n) => render(n, this.ctx).trim()));

    // the conversation grew above max_context in its last turn: continue in a fresh one
    if (persistent && !retry && this.rotate.has(agentName)) {
      this.rotate.delete(agentName);
      const old = this.sessions.get(this.agentSessions.get(agentName));
      if (old) this.closeSession(old, 'success');
      this.agentSessions.delete(agentName);
    }
    let session = persistent ? this.sessions.get(this.agentSessions.get(agentName)) : null;
    if (!session) {
      session = this.openSession({
        agent: agentName, provider: this.mock ? 'mock' : agent.provider, model: agent.model,
        parentId: this.orchestrator.id, stepId, mode,
      });
      if (persistent) this.agentSessions.set(agentName, session.id);
      // resumed run: continue the agent's previous conversation (its system prompt is already there),
      // only for its first session in this run
      this.resumeSessions ??= { ...(this.resume?.sessions || {}) };
      const previous = persistent && !this.mock && this.resumeSessions[agentName];
      delete this.resumeSessions[agentName];
      if (previous) { session.providerSessionId = previous; session.turns = 1; }
    }

    const turn = ++session.turns;
    const wantNote = mode !== 'ephemeral' && !retry;
    // a fresh session of an agent that already worked in this run (or the run it resumes) starts from its note
    const note = turn === 1 ? this.handoffNotes.get(agentName) : null;
    const parts = [];
    if (turn === 1 && (agent.system_prompt || agentSkills.length)) {
      const system = [render(agent.system_prompt, this.ctx).trim(), ...agentSkills.map(skillPrompt)].filter(Boolean).join('\n\n');
      parts.push(`<system>\n${system}\n</system>`);
    }
    if (note) {
      parts.push(`<handoff_note>\n${note.text}\n</handoff_note>\nThis is a fresh session. The note above is what you wrote at the end of your previous turn in this run`
        + ` (step ${note.step}, visit ${note.visit}). The code is in git: re-read only the files you need.`);
    }
    parts.push(wantNote ? `${prompt}\n\n---\n${HANDOFF_INSTRUCTIONS}` : prompt);
    const fullPrompt = parts.join('\n\n');

    const provider = this.mock ? { type: 'mock' } : this.wf.providers?.[agent.provider];
    // capabilities + isolation → this CLI's flags (see capabilities.js); cli_args still apply on top
    const providerType = this.wf.providers?.[agent.provider]?.type;
    const caps = capabilities.merge(agent.capabilities, stepCaps);
    const isolated = agent.isolation !== false;
    const denyEdits = guarded ? this.wf.tests_paths || testPaths.TESTS_PATHS : [];
    const { args: capArgs, notes } = capabilities.providerArgs(providerType, { caps, isolated, mcpServers: this.wf.mcp_servers || {}, denyEdits });
    const capsKey = `${agentName}|${capabilities.describe(caps)}|${guarded}`;
    if (!this.capsLogged.has(capsKey)) {
      this.capsLogged.add(capsKey);
      this.emitEvent('log', {
        level: 'info', kind: 'capabilities', agent: agentName,
        message: `capabilities: ${agentName} (${providerType || agent.provider}, ${isolated ? 'isolated' : 'not isolated'}): ${capabilities.describe(caps)}${guarded ? ' · test files: not editable' : ''}${notes.length ? ` · not enforced: ${notes.join('; ')}` : ''}`,
      });
    }
    // The provider's `skill_args` grants read access to each skill's folder, which lives
    // outside the working_dir (e.g. claude --add-dir <folder>). Applies to every turn.
    const skillDirs = [...new Set([...agentSkills, ...stepSkills].map((sk) => sk.path))];
    const skillArgs = skillDirs.flatMap((dir) => (provider?.skill_args || []).map((a) => render(a, { skill_dir: dir })));
    // cli_args may be keyed by provider when the provider is picked at run time
    const cliArgs = Array.isArray(agent.cli_args) ? agent.cli_args : agent.cli_args?.[agent.provider] || [];
    const extraArgs = capabilities.dedupeFlags([...capArgs, ...cliArgs, ...skillArgs], provider?.args || []);

    const visit = this.ctx.steps[String(stepId).split(':')[0]]?.visits || 0;
    hint = { ...(hint || { stepId, visit }), handoff: wantNote };
    // simulation: which answer of this step this is (mockSequences.invalid_answers: { step: n } makes the first n invalid)
    if (this.mock) { this.mockCalls ??= {}; hint.call = this.mockCalls[hint.stepId] = (this.mockCalls[hint.stepId] || 0) + 1; }

    const call = { session, agentName, agent, provider, extraArgs, stepId, hint };
    let res;
    try {
      res = await this.invokeTurn(call, turn, fullPrompt);
    } catch (e) {
      if (persistent) this.setStatus(session, 'error');
      else this.closeSession(session, 'failed');
      throw e;
    }

    // metrics: context at the start and peak of the turn, tokens, and whether they were wasted
    const rec = {
      agent: agentName, step: stepId, visit, session: session.id, mode, fresh: turn === 1,
      context_start: res.context.start, context_peak: res.context.peak,
      tokens: totalTokens(res.usage), cost_usd: res.costUsd || 0,
      waste: res.tools.ran === 0 && res.tools.denials > 0 ? 'refused' : null,
    };
    this.turnLog.push(rec);
    res.turnRec = rec;
    const max = persistent && !retry ? parseTokens(render(String(agent.max_context ?? ''), this.ctx)) : null;
    if (max && res.context.peak > max) {
      this.rotate.add(agentName);
      this.emitEvent('log', {
        level: 'info', kind: 'context_rotation', agent: agentName, step_id: stepId, context: res.context.peak, max_context: max,
        message: `[${agentName}] context reached ${kTokens(res.context.peak)} (max_context ${kTokens(max)}): its next turn starts a fresh session from its handoff note`,
      });
    }
    if (wantNote) {
      const needed = mode === 'handoff' || this.rotate.has(agentName);
      let text = res.handoff;
      if (!text && needed) text = await this.requestHandoffNote(call, rec);
      let fallback = false;
      if (!text && needed) {
        fallback = true;
        text = `- (No handoff note: the agent did not write one.)\n- Its last answer (step ${stepId}), shortened:\n\n${String(res.text || '').slice(0, 1500)}`;
      }
      if (text) this.saveHandoff({ agentName, stepId, visit, session, text, fallback });
    }
    if (!persistent) this.closeSession(session, 'success');
    return res;
  }

  // A turn that ended without its note, when the next one needs it: one cheap follow-up in the
  // same provider conversation asking only for the note.
  async requestHandoffNote(call, rec) {
    const { session } = call;
    if (!session.providerSessionId) return null;
    try {
      const res = await this.invokeTurn({ ...call, hint: { ...call.hint, handoffOnly: true }, attempts: 1 }, ++session.turns, HANDOFF_ONLY);
      rec.tokens += totalTokens(res.usage);
      rec.cost_usd += res.costUsd || 0;
      const plain = String(res.text || '').trim();
      return res.handoff || (plain && !plain.includes('```') ? plain.slice(0, 4000) : null);
    } catch (e) {
      session.status = 'idle';
      this.emitEvent('log', { level: 'warn', message: `[${call.agentName}] could not get a handoff note: ${e.message}` });
      return null;
    }
  }

  // runs/<id>/handoffs/<step>-v<visit>-<agent>.md, one per turn (a second turn of the same visit,
  // e.g. a delegation, gets -2, -3...). The latest one per agent starts its next fresh session.
  saveHandoff({ agentName, stepId, visit, session, text, fallback }) {
    const dir = path.join(this.runDir, 'handoffs');
    const base = `${String(stepId).replace(/[^A-Za-z0-9_.-]+/g, '-')}-v${visit}-${agentName}`;
    let file = path.join(dir, `${base}.md`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base}-${n}.md`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `# Handoff note: ${agentName}\n\n_Step ${stepId}, visit ${visit}, session ${session.id}, ${new Date().toISOString()}_\n\n${text.trim()}\n`);
    this.handoffNotes.set(agentName, { text: text.trim(), step: stepId, visit, path: file });
    this.emitEvent('handoff.saved', { agent: agentName, step_id: stepId, visit, session_id: session.id, path: file, note: text.trim(), fallback: fallback || undefined });
  }

  // Runs one provider turn in `session` (with the agent's retry policy) and reports it:
  // session.message_sent / .stream / .message_received. The answer comes back without its
  // ```handoff block (res.handoff), with its tool calls (res.tools) and context size (res.context).
  async invokeTurn({ session, agentName, agent, provider, extraArgs, stepId, hint, attempts }, turn, fullPrompt) {
    this.emitEvent('session.message_sent', { session_id: session.id, turn, step_id: stepId, prompt: fullPrompt });
    if (!provider) throw new Error(`Provider "${agent.provider}" is not defined.`);
    if (!this.mock) this.checkBudget(agent.provider);
    await this.contextGate(stepId);

    const retry = agent.retry || {};
    const maxAttempts = attempts || retry.max_attempts || 1;
    let delay = this.mock ? 1000 : parseDuration(retry.initial_delay, 5000);
    let lastErr;

    for (let a = 1; a <= maxAttempts; a++) {
      const t0 = Date.now();
      this.setStatus(session, 'active');
      // tool calls of this turn: refused ones (allowlist) vs the ones that ran
      const tools = { ran: 0, denials: 0, streak: 0, maxStreak: 0, denied: [] };
      // context window of each model request: the first one and the largest
      const context = { start: null, peak: null };
      const calls = new Map();
      const track = (item) => {
        if (item.kind === 'context') { context.start ??= item.tokens; context.peak = Math.max(context.peak || 0, item.tokens); return; }
        if (item.kind === 'tool_call') calls.set(item.id, item);
        if (item.kind !== 'tool_result') return;
        if (!isPermissionDenial(item)) { tools.ran++; tools.streak = 0; return; }
        tools.denials++;
        tools.maxStreak = Math.max(tools.maxStreak, ++tools.streak);
        const call = calls.get(item.id);
        tools.denied.push(`${call?.name || 'tool'}: ${String(call?.input?.command ?? JSON.stringify(call?.input ?? '')).slice(0, 120)}`);
      };
      // this turn's own abort: the run's cancel, or the supervisor interrupting an idle wait
      const turnAbort = new AbortController();
      const cancel = () => turnAbort.abort();
      this.abort.signal.addEventListener('abort', cancel, { once: true });
      let interrupted = null;
      // only while the stall the supervisor decided on still holds: the command may have produced
      // output or finished while it was thinking
      const interrupt = (decision, stall) => {
        if (timed || !idle.stillStalled(stall)) return false;
        interrupted = decision;
        turnAbort.abort();
        return true;
      };
      const idle = new IdleWatch({ idleMs: this.idleWarnMs });
      const idleTimer = this.idleWarnMs > 0 && setInterval(() => this.warnIdle(idle, { session, agentName, stepId, turn, interrupt }), Math.min(30e3, Math.max(50, this.idleWarnMs / 4)));
      idleTimer?.unref?.();
      let timed = null;
      const timing = () => {
        if (timed) return timed;
        this.abort.signal.removeEventListener('abort', cancel);
        clearInterval(idleTimer);
        this.addStepTiming(stepId, (timed = idle.finish()));
        return timed;
      };
      try {
        const res = await runTurn({
          provider, model: agent.model, effort: agent.effort, providerSessionId: session.providerSessionId,
          prompt: fullPrompt, cwd: (session.cwd = this.workingDir(agent)), extraArgs,
          timeoutMs: parseDuration(agent.timeout, 30 * 60e3),
          signal: turnAbort.signal, hint, render,
          onItem: (item) => { track(item); idle.item(item); this.emitEvent('session.stream', { session_id: session.id, turn, item }); },
        });
        const { active_ms, waiting_ms, stalled_ms } = timing();
        res.tools = tools;
        res.context = context;
        [res.text, res.handoff] = takeHandoff(res.text);
        if (tools.maxStreak >= DENIAL_WARN) {
          // the agent is fighting its allowlist (cli_args): visible in the run, the supervisor's timeline and the run chat
          this.emitEvent('log', {
            level: 'warn', kind: 'permission_denials', step_id: stepId, agent: agentName, denials: tools.denials,
            message: `[${agentName}] ${tools.denials} tool calls refused by its allowlist in one turn of ${stepId} (${tools.maxStreak} in a row), e.g. ${tools.denied.slice(-2).join(' · ')}`,
          });
        }
        const dur = Date.now() - t0;
        session.activeMs += dur;
        if (res.providerSessionId) session.providerSessionId = res.providerSessionId;
        addUsage(session.tokens, res.usage);
        session.costUsd += res.costUsd || 0;
        session.status = 'idle';
        this.emitEvent('session.message_received', {
          session_id: session.id, turn, step_id: stepId, text: res.text, usage: res.usage,
          cost_usd: res.costUsd, duration_ms: dur, active_ms, waiting_ms, stalled_ms, session: this.snapshot(session),
          context, ...(res.handoff ? { handoff: res.handoff } : {}),
        });
        this.recordDecisions(agentName, stepId, res.text);
        return res;
      } catch (e) {
        timing();
        session.activeMs += Date.now() - t0;
        lastErr = e;
        if (this.abort.signal.aborted) break;
        if (interrupted) {
          const stall = idle.lastStall;
          lastErr = Object.assign(new Error(`[${agentName}] turn interrupted by the supervisor: no output while waiting on ${stall?.tool || 'a tool'}: ${stall?.command || '?'}`),
            { idleInterrupt: { instruction: interrupted.instruction || null, command: stall?.command || null } });
          this.emitEvent('log', { level: 'warn', kind: 'agent_interrupted', step_id: stepId, agent: agentName, message: lastErr.message });
          break;
        }
        this.emitEvent('log', { level: 'error', message: `[${agentName}] attempt ${a}/${maxAttempts} failed: ${e.message}` });
        if (!isRetryable(e)) {
          this.emitEvent('log', { level: 'error', message: `[${agentName}] non-retryable error, giving up.` });
          break;
        }
        if (a < maxAttempts) {
          this.setStatus(session, 'retrying');
          await sleep(delay, this.abort.signal);
          if (retry.backoff === 'exponential') delay *= 2;
        }
      }
    }
    throw lastErr;
  }

  // An agent silent for idleWarnMs while a command is waiting: probably polling for output that never
  // comes, or a hung process. Visible in the run, the run chat and the supervisor's timeline; on a
  // step's turn it also wakes the supervisor, when the workflow has one (superviseIdle).
  warnIdle(idle, { session, agentName, stepId, turn, interrupt }) {
    const stall = idle.check();
    if (!stall) return;
    const minutes = Math.round(stall.idle_ms / 6e3) / 10;
    this.emitEvent('log', {
      level: 'warn', kind: 'agent_idle', step_id: stepId, agent: agentName, session_id: session.id, turn,
      idle_ms: stall.idle_ms, tool: stall.tool, command: stall.command,
      message: `[${agentName}] no output for ${minutes} min in ${stepId || 'a delegated turn'} while waiting on ${stall.tool}: ${stall.command}`,
    });
    const step = this.supervisorCfg && this.wf.steps.find((s) => s.id === stepId);
    if (step) this.superviseIdle(step, stall, { agentName, interrupt }).catch((e) => this.emitEvent('log', { level: 'error', message: `Supervisor could not decide on ${stepId}: ${e.message}` }));
  }

  addStepTiming(stepId, t) {
    const s = (this.stepTiming[stepId || 'delegated'] ??= { turns: 0, duration_ms: 0, active_ms: 0, waiting_ms: 0, stalled_ms: 0 });
    s.turns++;
    for (const k of ['duration_ms', 'active_ms', 'waiting_ms', 'stalled_ms']) s[k] += t[k];
  }

  // Agent time per step: active (the model working) vs waiting (a tool call running), and the part
  // of the waits with no output past idleWarnMs (stalled). Explains why a slow step was slow.
  timingSummary() {
    const total = { duration_ms: 0, active_ms: 0, waiting_ms: 0, stalled_ms: 0 };
    for (const s of Object.values(this.stepTiming)) for (const k of Object.keys(total)) total[k] += s[k];
    return { steps: this.stepTiming, ...total };
  }

  // Per run and per agent: context at the start of each turn, its peak, tokens, and the tokens spent
  // on turns that could not progress ("waste": every tool call refused, or a blocked /loop iteration).
  contextSummary() {
    const agents = {};
    let waste = 0;
    for (const r of this.turnLog) {
      const a = (agents[r.agent] ??= { mode: r.mode, turns: 0, fresh_sessions: 0, tokens: 0, peak: null, waste_tokens: 0, per_turn: [] });
      a.turns++;
      if (r.fresh) a.fresh_sessions++;
      a.tokens += r.tokens;
      if (r.context_peak != null) a.peak = Math.max(a.peak || 0, r.context_peak);
      if (r.waste) { a.waste_tokens += r.tokens; waste += r.tokens; }
      a.per_turn.push({ step: r.step, visit: r.visit, start: r.context_start, peak: r.context_peak, tokens: r.tokens, ...(r.waste ? { waste: r.waste } : {}) });
      if (a.per_turn.length > 200) a.per_turn.shift();
    }
    return { agents, waste_tokens: waste };
  }

  // Without a working_dir (workflow with no repository), the agent runs in the run folder.
  workingDir(agent) {
    const dir = render(agent.working_dir, this.ctx).trim();
    if (dir) return dir;
    fs.mkdirSync(this.runDir, { recursive: true });
    return this.runDir;
  }

  // Resolves to { answer, feedback }. `feedback: true | { label, placeholder }` on the step asks the
  // UI for an optional free text next to the choices; it is the gate's `output.feedback`, and every
  // non-empty one is appended to the run-wide `feedback` list the next prompts can include.
  requestApproval(step) {
    const id = `a${++this.nApproval}`;
    const message = step.raw ? String(step.message).trim() : render(step.message, this.ctx).trim();
    const choices = step.choices ? step.choices.map((c) => ({ id: c.id, label: render(c.label, this.ctx) })) : null;
    const fb = step.feedback === true ? {} : step.feedback || null;
    const feedback = fb && { label: render(fb.label || 'Anything to add? (optional)', this.ctx), placeholder: render(fb.placeholder || '', this.ctx) };
    this.emitEvent('approval.requested', { approval_id: id, step_id: step.id, message, choices, feedback });
    this.setStatus(this.orchestrator, 'waiting');
    const timeout = parseDuration(step.timeout, null);

    return new Promise((resolve, reject) => {
      const onTimeout = step.choices ? step.choices[step.choices.length - 1].id : false;
      const timer = timeout ? setTimeout(() => this.resolveApproval(id, onTimeout, 'timeout'), timeout) : null;
      this.approvals.set(id, {
        stepId: step.id,
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  // answer: boolean (approve/reject) or the id of one of the step's choices; feedback: optional text
  resolveApproval(id, answer, by = 'user', feedback = '') {
    const a = this.approvals.get(id);
    if (!a) return false;
    this.approvals.delete(id);
    const text = String(feedback ?? '').trim();
    const data = typeof answer === 'boolean' ? { approved: answer } : { choice: answer };
    this.emitEvent('approval.resolved', { approval_id: id, ...data, by, ...(text ? { feedback: text } : {}) });
    if (text) this.ctx.feedback.push({ step: a.stepId, choice: typeof answer === 'boolean' ? String(answer) : answer, text, ts: new Date().toISOString() });
    this.setStatus(this.orchestrator, 'active');
    a.resolve({ answer, feedback: text });
    return true;
  }

  // The `merge: local` transition (local workflows): fast-forwards the local base to the run's
  // branch, rebasing it first when the base moved; see mergeLocally in src/engine/worktree.js.
  // A failure (conflict, uncommitted changes where the base is checked out) fails the run with
  // the reason; the worktree is kept, so the run can be resumed after fixing it.
  async mergeWorktreeLocally() {
    if (this.mock) {
      this.emitEvent('action.executed', { command: 'merge: local', skipped: true, output: '[mock] local merge not executed' });
      return;
    }
    const wt = this.worktree;
    if (!wt) throw new Error('merge: local needs the run\'s git worktree (orchestrator.worktree on a git repository).');
    const log = (level, message) => this.emitEvent('log', { level, message });
    const r = await mergeLocally({ repo: wt.repo, dir: wt.dir, base: wt.base, log });
    this.emitEvent('worktree.merged', { branch: r.branch, base: r.base, commit: r.commit, checkout: r.checkout, rebased: r.rebased });
    this.ctx.local_merge = r;
  }

  runAction(cmd) {
    if (this.mock) {
      this.emitEvent('action.executed', { command: cmd, skipped: true, output: '[mock] action not executed' });
      return Promise.resolve();
    }
    // in the run's worktree when there is one (the feature branch is checked out there)
    const cwd = [this.ctx.worktree_dir, this.inputs.repo_path].find((d) => d && fs.existsSync(d)) || process.cwd();
    return new Promise((resolve, reject) => {
      exec(cmd, { cwd, windowsHide: true, env: process.env }, (err, stdout, stderr) => {
        const exitCode = err ? err.code ?? 1 : 0;
        this.emitEvent('action.executed', { command: cmd, exit_code: exitCode, output: `${stdout}${stderr}`.slice(-4000) });
        if (exitCode) reject(new Error(`Action failed (exit ${exitCode}): ${cmd}
${stderr || stdout}`.slice(0, 1500)));
        else resolve();
      });
    });
  }

  finish(status, err) {
    this.status = status;
    for (const a of this.approvals.values()) a.reject(new Error('Finished'));
    this.approvals.clear();
    for (const s of this.sessions.values()) {
      // the session status reflects the session itself, not the workflow outcome
      if (!s.closedAt) this.closeSession(s, s.status === 'error' ? 'failed' : status === 'cancelled' ? 'cancelled' : s.id === 'orchestrator' ? status : 'success');
    }
    const sessions = [...this.sessions.values()].map((s) => this.snapshot(s));
    const tokens = emptyUsage();
    sessions.forEach((s) => addUsage(tokens, s.tokens));
    this.emitEvent('workflow.finished', {
      status, error: err?.message || null,
      summary: {
        run_id: this.runId, workflow: this.wf.metadata?.name, project_id: this.projectId, issues: this.issues || undefined, status,
        started_at: new Date(this.startedAt).toISOString(), finished_at: new Date().toISOString(),
        duration_ms: Date.now() - this.startedAt, inputs: this.inputs, mock: this.mock, worktree: this.worktreeSummary(),
        // `merge: local`: what landed on the local base, not pushed (Backlog: "Local" column, Push)
        local_merge: this.ctx.local_merge ? { branch: this.ctx.local_merge.branch, base: this.ctx.local_merge.base, commit: this.ctx.local_merge.commit } : null,
        tokens, cost_usd: +sessions.reduce((a, s) => a + s.cost_usd, 0).toFixed(6),
        context: this.contextSummary(),
        timing: this.timingSummary(),
        // `wait:` steps: checks made without an agent turn, agent turns they asked for, steps they finished
        ...(Object.keys(this.probeStats).length ? { probes: this.probeStats } : {}),
        steps: Object.fromEntries(Object.entries(this.ctx.steps).map(([k, v]) => [k, { visits: v.visits, output: v.output }])),
        // step visits in order with their agents (runs list); this event's own update lands in it
        groups: this.wf.groups, progress: this.trail.steps,
        sessions,
      },
    });
  }
}

module.exports = { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render, takeHandoff, parseTokens };
