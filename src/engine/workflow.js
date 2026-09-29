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
const { prepareWorktree, removeWorktree, currentBranch } = require('./worktree');
const { stopProcessesIn } = require('./processes');

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

const render = (s, scope) => (s == null ? '' : tpl.renderString(String(s), scope));
const evalExpr = (expr, scope) => render(`{% if ${expr} %}1{% else %}0{% endif %}`, scope).trim() === '1';

function parseDuration(v, def) {
  if (v == null) return def;
  if (typeof v === 'number') return v;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/.exec(String(v).trim());
  return m ? +m[1] * { ms: 1, s: 1e3, m: 6e4, h: 36e5 }[m[2]] : def;
}

// Outcome of a run that reaches `end` through a transition with `status:` (default success),
// e.g. a rejected failure gate → failed, a rejected merge → cancelled.
const END_STATUSES = ['success', 'failed', 'cancelled'];

function loadWorkflow(file) {
  const wf = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!wf || !Array.isArray(wf.steps) || !wf.steps.length) throw new Error('Workflow has no "steps".');
  if (!wf.agents) throw new Error('Workflow has no "agents".');
  const ids = new Set(wf.steps.map((s) => s.id));
  for (const s of wf.steps) {
    if (s.type !== 'human_approval') {
      // `agents: [...]` = fan-out: the same prompt goes to several agents in parallel
      if (s.agents && (!Array.isArray(s.agents) || !s.agents.length)) throw new Error(`Step "${s.id}": agents must be a non-empty list.`);
      if (s.agents && s.goal) throw new Error(`Step "${s.id}": goal is not supported on a fan-out step (agents).`);
      for (const n of s.agents || [s.agent]) if (!wf.agents[n]) throw new Error(`Step "${s.id}" references unknown agent "${n}".`);
    }
    if (s.goal && !s.goal.until) throw new Error(`Step "${s.id}": goal requires "until".`);
    if (s.choices && s.type !== 'human_approval') throw new Error(`Step "${s.id}": choices is only valid for human_approval.`);
    for (const t of s.transitions || []) {
      for (const target of [t.goto, t.on_exhausted, t.loop?.on_exhausted, s.goal?.on_exhausted, s.loop?.on_exhausted, s.on_error].filter(Boolean)) {
        if (!ids.has(target) && target !== 'end' && target !== 'fail') throw new Error(`Step "${s.id}" points to unknown step "${target}".`);
      }
      if (t.status !== undefined) {
        if (!END_STATUSES.includes(t.status)) throw new Error(`Step "${s.id}": transition status must be one of ${END_STATUSES.join(', ')}.`);
        if (![t.goto, t.on_exhausted, t.loop?.on_exhausted].includes('end')) throw new Error(`Step "${s.id}": a transition status only applies when the transition ends the run (goto: end or on_exhausted: end).`);
      }
    }
  }
  return wf;
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
    lines.push(`/loop: iteration ${st.iteration}. The orchestrator will call you again every ${cfg.interval || '1m'} (limit: ${cfg.max_duration || 'none'}) until the /goal is met.`);
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

// What the transitions decide on: enum, boolean and number fields of the schema (not the
// free text, which an LLM rewords on every call). Without a schema, the whole answer.
function decisionKey(output, schema) {
  const props = schema?.properties;
  if (!props || !output || typeof output !== 'object') return JSON.stringify(output ?? null);
  const keys = Object.keys(props).filter((k) => props[k].enum || ['boolean', 'integer', 'number'].includes(props[k].type));
  return JSON.stringify(keys.length ? keys.map((k) => output[k] ?? null) : output);
}

const stepAgentLabel = (s) => (s.agents ? s.agents.join(' · ') : s.agent || null);

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
  // issue: { number, url, title } the run implements (Backlog screen), recorded the same way.
  // resume: { runId, fromStep, steps: { id: { output, visits } }, sessions: { agent: providerSessionId }, instruction, worktree: { dir, branch } }
  //   starts at fromStep with the previous run's step outputs and agent conversations (src/supervisor.js resumeSpec),
  //   in the previous run's worktree.
  // worktreesDir: where orchestrator.worktree creates the run's git worktree (<workspace>/worktrees);
  //   without it (e.g. simulation runs) the agents work in the repository folder itself.
  // mockSequences: { field: [value per visit] } over the mock provider's defaults (tests).
  // notices: [{ level, message }] logged right after workflow.started (e.g. the workflow file came from a fallback folder).
  // stopProcesses: (dir) => Promise<[{ pid, exe, cwd, reason, stopped }]>, stops what agents left running in the
  //   worktree (src/engine/processes.js). Default: the real one, none for simulations (mock agents start nothing).
  constructor({ file, inputs, mock, runsDir, skillsDirs, budget, prices, projectId, issue, resume, worktreesDir, mockSequences, notices, stopProcesses }) {
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
    this.issue = issue || null;
    this.worktreesDir = worktreesDir || null;
    this.worktree = null; // see setupWorktree
    this.stopProcesses = stopProcesses === undefined ? (this.mock ? null : stopProcessesIn) : stopProcesses;
    this.budget = budget || {};
    this.prices = prices || {};
    this.budgetWarned = new Set();
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
    this.ctx = {
      inputs: this.inputs, steps: {}, loop: { iteration: 0 }, run_id: this.runId, run_dir: this.runDir, runs_dir: runsDir, workflows_dir: path.dirname(path.resolve(file)),
      agents: Object.fromEntries(Object.entries(this.wf.agents).map(([k, a]) => [k, { provider: a.provider, model: a.model }])),
      // what the user typed at the human gates, oldest first: [{ step, choice, text, ts }]
      feedback: [],
      // the step that ran before the current one (null for the first)
      previous_step: null,
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
    this.setupSupervisor();

    this.sessions = new Map();      // local id -> session
    this.agentSessions = new Map(); // persistent agent -> local id
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
    if (type !== 'session.stream') { this.recent.push(ev); if (this.recent.length > 300) this.recent.shift(); }
    this.emit('event', ev);
    return ev;
  }

  // ---- sessions -------------------------------------------------------------
  openSession({ agent, provider, model, parentId, stepId }) {
    const s = {
      id: agent === 'orchestrator' ? 'orchestrator' : `s${++this.nSession}`,
      agent, provider, model, parentId, stepId,
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
      status: s.status, provider_session_id: s.providerSessionId, cwd: s.cwd || null,
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
      issue: this.issue || undefined,
      file: path.basename(this.file), inputs: this.inputs, mock: this.mock, run_dir: this.runDir,
      resumed_from: this.resume ? { run_id: this.resume.runId, step: this.resume.fromStep } : undefined,
      steps: this.wf.steps.map((s) => ({ id: s.id, type: s.type || 'agent', agent: stepAgentLabel(s) })),
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
    this.ctx.worktree_dir = repo;
    const log = (level, message) => this.emitEvent('log', { level, message });
    if (!this.worktreesDir) {
      log('info', `worktree: ${this.mock ? 'simulation, ' : ''}no worktree for this run; agents work in ${repo}`);
      return;
    }
    const prev = this.resume?.worktree;
    const dir = prev?.dir || path.join(this.worktreesDir, this.runId);
    const info = await prepareWorktree({ repo, base, dir, branch: prev?.branch || null, log });
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
        const r = await removeWorktree({ repo: wt.repo, dir: wt.dir, base: wt.base, log });
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
    st.visits++;
    st.firstVisitAt ??= Date.now();
    // /loop iteration: resets whenever the step is (re)entered from another step
    if (this.prevStepId !== step.id) { st.iteration = 0; st.loopStartedAt = Date.now(); st.blocked = null; }
    st.iteration++;
    st.tools = { ran: 0, denials: 0, denied: [] }; // this visit's tool calls, for the blocked-loop check
    this.ctx.previous_step = this.prevStepId || null;
    this.prevStepId = step.id;
    const t0 = Date.now();
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
        const r = await this.superviseFailure(step, st, e);
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
    }
    this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output, duration_ms: Date.now() - t0 });

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
      if (t.action) await this.runAction(render(t.action, scope));
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
      if (target === step.id && isLooping(step)) target = await this.loopWait(step, output);
      // the delegation result goes to the next step (e.g. babysitter replies on the PR with the hash)
      if (delegated && this.ctx.steps[target]) this.ctx.steps[target].delegate_result = delegated;
      const ends = target === 'end' && t.status && t.status !== 'success';
      if (ends) this.endStatus = { status: t.status, message: `Run ended as ${t.status} at step "${step.id}" (${t.when}).` };
      this.emitEvent('step.transition', { from: step.id, to: target, when: t.when, ...(ends ? { status: t.status } : {}) });
      return target;
    }
    throw new Error(`No transition matched in step "${step.id}".`);
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

  async loopWait(step, output) {
    const st = this.ctx.steps[step.id];
    const cfg = loopConfig(step);
    const exhausted = step.goal?.on_exhausted || cfg.on_exhausted || 'fail';
    const maxDur = parseDuration(cfg.max_duration, null);
    if (maxDur && Date.now() - st.loopStartedAt > maxDur) {
      this.emitEvent('log', { level: 'warn', message: `/loop of ${step.id} exceeded ${cfg.max_duration} without meeting the /goal → ${exhausted}` });
      return exhausted;
    }
    const stop = this.checkBlocked(step, st, output);
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
    if (extra) prompt += '\n\n---\n' + extra;
    if (schema) {
      prompt += '\n\n---\nAt the end of your response you MUST include a ```json block with an object that validates against this JSON Schema:\n```json\n'
        + JSON.stringify(schema, null, 2) + '\n```';
    }
    const hint = { stepId: step.id, visit, schema, agent: agentName, sequences: this.mockSequences };
    const opts = { stepId: step.id, hint, skills };
    const countTools = (r) => {
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
      res = await this.sendToAgent(agentName, this.retryPrompt(agentName, prompt, res.text, schema, errs), opts);
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
    const type = this.wf.providers?.[providerName]?.type;
    const name = this.wf.agents.supervisor ? '_supervisor' : 'supervisor';
    const readOnly = {
      'claude-code': ['--allowedTools', 'Read Glob Grep', '--disallowedTools', 'Edit Write NotebookEdit Bash'],
      'codex-cli': ['-s', 'read-only'],
      'grok-cli': ['--tools', 'read_file,list_dir,grep', '--always-approve'],
    }[type] || [];
    this.wf.agents[name] = {
      provider: providerName, model: cfg.model || orch.model, session: 'ephemeral', working_dir: '{{ run_dir }}',
      skills: ['run-supervisor'], cli_args: readOnly, timeout: cfg.timeout || '10m',
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
    const prompt = supervisor.decisionPrompt({ wf: this.wf, step, error: err.message, answer: st.lastAnswer, allowed, events: this.recent, previous: st.interventions });
    const schema = supervisor.DECISION_SCHEMA;
    const opts = { stepId: `${step.id}:supervisor`, hint: { stepId: `${step.id}:supervisor`, visit: st.interventions.length + 1, schema } };
    let decision;
    try {
      const full = `${prompt}\n\n---\nAt the end of your response you MUST include a \`\`\`json block with an object that validates against this JSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``;
      let res = await this.sendToAgent(cfg.agent, full, opts);
      for (let attempt = 0; ; attempt++) {
        let errs;
        try { decision = extractJson(res.text); errs = validateSchema(decision, schema); } catch (e) { errs = [e.message]; }
        if (!errs.length) break;
        if (attempt >= 1) throw new Error(`invalid decision: ${errs.join('; ')}`);
        res = await this.sendToAgent(cfg.agent, this.retryPrompt(cfg.agent, full, res.text, schema, errs), opts);
      }
    } catch (e) {
      this.emitEvent('log', { level: 'error', message: `Supervisor could not decide on ${step.id}: ${e.message}` });
      return null;
    }
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
  // ephemeral agent answers in a fresh session that has not seen the task nor its previous
  // answer, so those go along too (otherwise it answers "{}" or describes the errors).
  retryPrompt(agentName, prompt, previous, schema, errs) {
    const fix = `Your last response did not validate against the JSON Schema:\n- ${errs.join('\n- ')}\n`
      + `Reply again with only a \`\`\`json block that validates against this schema, keeping the content of your answer:\n`
      + `\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``;
    const def = { ...(this.wf.defaults || {}), ...this.wf.agents[agentName] };
    if (def.session !== 'ephemeral') return fix;
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

  // Monthly budget per provider: checked before every real (non-mock) turn.
  checkBudget(providerName) {
    const id = providerId(providerName);
    const b = id && this.budget[id];
    if (!b || (!b.limitUsd && !b.limitTokens)) return;
    let usd = b.usedUsd || 0;
    let tokens = b.usedTokens || 0;
    for (const s of this.sessions.values()) {
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

  async sendToAgent(agentName, prompt, { stepId, hint, skills: stepSkills = [] } = {}) {
    const def = this.wf.agents[agentName];
    if (!def) throw new Error(`Unknown agent: ${agentName}`);
    const agent = { ...(this.wf.defaults || {}), ...def };
    const persistent = agent.session !== 'ephemeral';
    // agent skills go in the system prompt (1st turn); step skills, in the step prompt
    const agentSkills = this.loadSkills((agent.skills || []).map((n) => render(n, this.ctx).trim()));

    let session = persistent ? this.sessions.get(this.agentSessions.get(agentName)) : null;
    if (!session) {
      session = this.openSession({
        agent: agentName, provider: this.mock ? 'mock' : agent.provider, model: agent.model,
        parentId: this.orchestrator.id, stepId,
      });
      if (persistent) this.agentSessions.set(agentName, session.id);
      // resumed run: continue the agent's previous conversation (its system prompt is already there)
      const previous = persistent && !this.mock && this.resume?.sessions?.[agentName];
      if (previous) { session.providerSessionId = previous; session.turns = 1; }
    }

    const turn = ++session.turns;
    let fullPrompt = prompt;
    if (turn === 1 && (agent.system_prompt || agentSkills.length)) {
      const system = [render(agent.system_prompt, this.ctx).trim(), ...agentSkills.map(skillPrompt)].filter(Boolean).join('\n\n');
      fullPrompt = `<system>\n${system}\n</system>\n\n${prompt}`;
    }
    this.emitEvent('session.message_sent', { session_id: session.id, turn, step_id: stepId, prompt: fullPrompt });

    const provider = this.mock ? { type: 'mock' } : this.wf.providers?.[agent.provider];
    if (!provider) throw new Error(`Provider "${agent.provider}" is not defined.`);
    if (!this.mock) this.checkBudget(agent.provider);
    // simulation: which answer of this step this is (mockSequences.invalid_answers: { step: n } makes the first n invalid)
    if (this.mock && hint) { this.mockCalls ??= {}; hint.call = this.mockCalls[hint.stepId] = (this.mockCalls[hint.stepId] || 0) + 1; }
    // The provider's `skill_args` grants read access to each skill's folder, which lives
    // outside the working_dir (e.g. claude --add-dir <folder>). Applies to every turn.
    const skillDirs = [...new Set([...agentSkills, ...stepSkills].map((sk) => sk.path))];
    const skillArgs = skillDirs.flatMap((dir) => (provider.skill_args || []).map((a) => render(a, { skill_dir: dir })));

    const retry = agent.retry || {};
    const maxAttempts = retry.max_attempts || 1;
    let delay = this.mock ? 1000 : parseDuration(retry.initial_delay, 5000);
    let lastErr;

    for (let a = 1; a <= maxAttempts; a++) {
      const t0 = Date.now();
      this.setStatus(session, 'active');
      // tool calls of this turn: refused ones (allowlist) vs the ones that ran
      const tools = { ran: 0, denials: 0, streak: 0, maxStreak: 0, denied: [] };
      const calls = new Map();
      const track = (item) => {
        if (item.kind === 'tool_call') calls.set(item.id, item);
        if (item.kind !== 'tool_result') return;
        if (!isPermissionDenial(item)) { tools.ran++; tools.streak = 0; return; }
        tools.denials++;
        tools.maxStreak = Math.max(tools.maxStreak, ++tools.streak);
        const call = calls.get(item.id);
        tools.denied.push(`${call?.name || 'tool'}: ${String(call?.input?.command ?? JSON.stringify(call?.input ?? '')).slice(0, 120)}`);
      };
      try {
        const res = await runTurn({
          provider, model: agent.model, effort: agent.effort, providerSessionId: session.providerSessionId,
          prompt: fullPrompt, cwd: (session.cwd = this.workingDir(agent)),
          // cli_args may be keyed by provider when the provider is picked at run time
          extraArgs: [...(Array.isArray(agent.cli_args) ? agent.cli_args : agent.cli_args?.[agent.provider] || []), ...skillArgs],
          timeoutMs: parseDuration(agent.timeout, 30 * 60e3),
          signal: this.abort.signal, hint, render,
          onItem: (item) => { track(item); this.emitEvent('session.stream', { session_id: session.id, turn, item }); },
        });
        res.tools = tools;
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
          cost_usd: res.costUsd, duration_ms: dur, session: this.snapshot(session),
        });
        this.recordDecisions(agentName, stepId, res.text);
        if (!persistent) this.closeSession(session, 'success');
        return res;
      } catch (e) {
        session.activeMs += Date.now() - t0;
        lastErr = e;
        if (this.abort.signal.aborted) break;
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
    if (persistent) this.setStatus(session, 'error');
    else this.closeSession(session, 'failed');
    throw lastErr;
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
        run_id: this.runId, workflow: this.wf.metadata?.name, project_id: this.projectId, issue: this.issue || undefined, status,
        started_at: new Date(this.startedAt).toISOString(), finished_at: new Date().toISOString(),
        duration_ms: Date.now() - this.startedAt, inputs: this.inputs, mock: this.mock, worktree: this.worktreeSummary(),
        tokens, cost_usd: +sessions.reduce((a, s) => a + s.cost_usd, 0).toFixed(6),
        steps: Object.fromEntries(Object.entries(this.ctx.steps).map(([k, v]) => [k, { visits: v.visits, output: v.output }])),
        sessions,
      },
    });
  }
}

module.exports = { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render };
