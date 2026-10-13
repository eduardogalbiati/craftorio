// Loading and validating the workflow YAML (#250, from src/engine/workflow.js): `loadWorkflow` parses
// the file, checks agents, steps, transitions, gates, `outputs:`, `groups:`, `display`, fallbacks and
// model limits, and returns the workflow object the engine walks. With it, the YAML's vocabularies
// (`END_STATUSES`, `SESSION_MODES`, `MACHINE_STEP_TYPES`, `GATE_KINDS`, `isLooping` / `loopConfig`) and
// value parsers (`toBoolean`, `parseDuration`, `parseTokens`, `parseRequests`, `renderFileList`) the
// run modules share.

'use strict';

const fs = require('fs');
const yaml = require('js-yaml');
const capabilities = require('../capabilities');
const { PROBES } = require('../probes');
const { validateWorkflowStep } = require('../workflow-step');
const testPaths = require('../test-paths');
const chain = require('../../shared/chain-model');
const { render } = require('./templates');

// A list of files in the YAML (`protect_files`, a suite step's `files`, #220): a template or a list of
// them. Rendered, each item may hold several files (a rendered list reads "a,b"; one per line works too).
function validateFileList(v, what) {
  if (v === undefined) return;
  if (!(typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')))) throw new Error(`${what} must be a file list: a template or a list of paths.`);
}
const renderFileList = (v, scope) => [...new Set([v ?? []].flat()
  .flatMap((x) => render(String(x), scope).split(/[\n,]/))
  .map((f) => f.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
  .filter(Boolean))];

// A `type: boolean` input's value: true/false, or their text ("true", "yes", "1" / "false", "no", "0", "").
function toBoolean(key, v) {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(s)) return true;
  if (['false', 'no', 'off', '0', ''].includes(s)) return false;
  throw new Error(`Input "${key}" must be true or false`);
}

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

// A number of model requests (max_requests, #302): a positive whole number.
function parseRequests(v) {
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v ?? '').trim()) ? +String(v).trim() : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Outcome of a run that reaches `end` through a transition with `status:` (default success),
// e.g. a rejected failure gate → failed, a rejected merge → cancelled.
const END_STATUSES = ['success', 'failed', 'cancelled'];

// persistent: one conversation for the whole run (max_context: a fresh one with the handoff note
// once a turn ends above it); ephemeral: a fresh session per turn with only the step prompt;
// handoff: a fresh session per turn that starts from the agent's latest handoff note.
const SESSION_MODES = ['persistent', 'ephemeral', 'handoff'];
// Step types without an agent: the engine does the work (no supervisor, no stall check, no agent keys)
const MACHINE_STEP_TYPES = [
  'human_approval',
  'release_version',
  'screenshots',
  'suite',
  'test_ids',
  'workflow',
];
const DISPLAY_MAX = 40;

// #245: `display` on an agent or a step, the name the screens show instead of its key or id
function validateDisplay(v, what) {
  if (v === undefined) return;
  if (typeof v !== 'string' || !v.trim() || v.length > DISPLAY_MAX) throw new Error(`${what}: display must be a name of 1 to ${DISPLAY_MAX} characters.`);
}

// #262: `fallbacks` on an agent or in `defaults` (and Settings' providers.<p>.fallbacks): the ordered
// "<provider>:<model>" entries a turn moves on to when its provider is out of credits
const FALLBACK_ENTRY = /^([A-Za-z0-9_.-]+):(\S+)$/;
function validateFallbacks(v, what, providers) {
  if (v === undefined) return;
  if (!Array.isArray(v)) throw new Error(`${what}: fallbacks must be a list of "<provider>:<model>" entries.`);
  for (const entry of v) {
    const m = FALLBACK_ENTRY.exec(String(entry ?? ''));
    if (typeof entry !== 'string' || !m) throw new Error(`${what}: fallbacks entry "${entry}" must be "<provider>:<model>", e.g. "codex:gpt-6-luna".`);
    if (providers && !Object.hasOwn(providers, m[1])) throw new Error(`${what}: fallbacks entry "${entry}" names provider "${m[1]}", which the workflow's providers do not define.`);
  }
}

// #262: `models: { <model id>: { timeout_factor?, max_total_cost_usd? } }` (the workflow's, or Settings')
function validateModels(models, what = 'models') {
  if (models === undefined || models === null) return;
  if (typeof models !== 'object' || Array.isArray(models)) throw new Error(`${what} must map a model id to its limits.`);
  for (const [id, lim] of Object.entries(models)) {
    for (const k of Object.keys(lim || {})) {
      if (!['timeout_factor', 'max_total_cost_usd'].includes(k)) throw new Error(`${what}.${id}: unknown limit "${k}" (timeout_factor, max_total_cost_usd).`);
      if (!(Number(lim[k]) > 0)) throw new Error(`${what}.${id}.${k} must be a positive number.`);
    }
  }
}

function loadWorkflow(file) {
  const wf = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!wf || !Array.isArray(wf.steps) || !wf.steps.length) throw new Error('Workflow has no "steps".');
  if (!wf.agents) throw new Error('Workflow has no "agents".');
  const mcpServers = wf.mcp_servers || {};
  validateModels(wf.models);
  for (const [name, a] of [['defaults', wf.defaults || {}], ...Object.entries(wf.agents).map(([n, a]) => [`Agent "${n}"`, a || {}])]) {
    validateFallbacks(a.fallbacks, name, wf.providers);
    if (a.session !== undefined && !SESSION_MODES.includes(a.session)) throw new Error(`${name}: session must be one of ${SESSION_MODES.join(', ')}.`);
    if (a.max_context !== undefined && !String(a.max_context).includes('{{') && !parseTokens(a.max_context)) throw new Error(`${name}: max_context must be a token count such as 150k.`);
    if (a.max_requests !== undefined && !String(a.max_requests).includes('{{') && !parseRequests(a.max_requests)) throw new Error(`${name}: max_requests must be a whole number of model requests such as 40.`);
    if (a.fresh_after_idle !== undefined && parseDuration(a.fresh_after_idle, null) == null) throw new Error(`${name}: fresh_after_idle must be a duration such as 55m.`);
    if (a.persona !== undefined && a.persona !== 'random') throw new Error(`${name}: persona must be "random".`);
    if (a.edits_tests !== undefined && typeof a.edits_tests !== 'boolean') throw new Error(`${name}: edits_tests must be true or false.`);
    validateFileList(a.protect_files, `${name}: protect_files`);
    capabilities.validate(a.capabilities, name, mcpServers);
    validateDisplay(a.display, name);
  }
  testPaths.validateTestsPaths(wf.tests_paths);
  const ids = new Set(wf.steps.map((s) => s.id));
  for (const s of wf.steps) {
    capabilities.validate(s.capabilities, `Step "${s.id}"`, mcpServers);
    validateDisplay(s.display, `Step "${s.id}"`);
    if (s.edits_tests !== undefined && typeof s.edits_tests !== 'boolean') throw new Error(`Step "${s.id}": edits_tests must be true or false.`);
    // #220: files its agent may not change (a template, e.g. another step's tests_added), and the
    // code → tests map given to its prompt as {{ test_map }} (#219)
    validateFileList(s.protect_files, `Step "${s.id}": protect_files`);
    if (s.protect_files !== undefined && MACHINE_STEP_TYPES.includes(s.type)) throw new Error(`Step "${s.id}": protect_files is only valid on an agent step.`);
    if (s.test_map !== undefined && (typeof s.test_map !== 'boolean' || MACHINE_STEP_TYPES.includes(s.type))) throw new Error(`Step "${s.id}": test_map must be true or false, on an agent step.`);
    if (s.type === 'screenshots') {
      // `type: screenshots` (#144): no agent; the screens listed in `from`'s `screenshots` output
      if (s.agent || s.agents) throw new Error(`Step "${s.id}": a screenshots step has no agent.`);
      if (!ids.has(s.from)) throw new Error(`Step "${s.id}": from must be the step whose output lists the screenshots.`);
      if (s.folder !== undefined && !/^[\w-]+$/.test(String(s.folder))) throw new Error(`Step "${s.id}": folder must be a plain folder name (e.g. developer).`);
      if (s.timeout !== undefined && parseDuration(s.timeout, null) == null) throw new Error(`Step "${s.id}": timeout must be a duration such as 3m.`);
    } else if (s.type === 'suite') {
      // `type: suite` (#177): no agent; the project's whole test suite, once per visit
      if (s.agent || s.agents) throw new Error(`Step "${s.id}": a suite step has no agent.`);
      if (s.command !== undefined && typeof s.command !== 'string') throw new Error(`Step "${s.id}": command must be a string (a template; empty = found from the project's files).`);
      if (s.timeout !== undefined && !String(s.timeout).includes('{{') && parseDuration(s.timeout, null) == null) throw new Error(`Step "${s.id}": timeout must be a duration such as 30m.`);
      // #212: affected = the affected test files each visit, the whole suite once when they pass;
      // #324: failed = whole first, then the files that failed in the previous round and the whole suite
      if (s.scope !== undefined && !String(s.scope).includes('{{') && !['affected', 'failed', 'full'].includes(s.scope)) throw new Error(`Step "${s.id}": scope must be affected, failed or full.`);
      // #220: given test files only (a template, e.g. "{{ steps.acceptance_tests.output.tests_added }}"),
      // and `expect: red` for tests written before the code (the red check)
      validateFileList(s.files, `Step "${s.id}": files`);
      if (s.files !== undefined && s.scope !== undefined) throw new Error(`Step "${s.id}": files and scope cannot be combined.`);
      if (s.expect !== undefined && (s.expect !== 'red' || s.files === undefined)) throw new Error(`Step "${s.id}": expect must be "red", with files (the red check of tests written before the code).`);
    } else if (s.type === 'workflow') {
      // `type: workflow` (#174): a child run of another workflow, once or per `foreach` item
      validateWorkflowStep(s, file);
    } else if (s.type === 'test_ids') {
      // `type: test_ids` (#246): no agent; the test ids the E2E step definitions use and the renderer lacks
      if (s.agent || s.agents) throw new Error(`Step "${s.id}": a test_ids step has no agent.`);
      for (const key of ['steps', 'renderer']) {
        if (s[key] !== undefined && (typeof s[key] !== 'string' || !s[key].trim())) throw new Error(`Step "${s.id}": ${key} must be a repository-relative folder (a template).`);
      }
    } else if (s.type === 'release_version') {
      // `type: release_version` (#325): no agent; the release's version into the project's package.json
      if (s.agent || s.agents) throw new Error(`Step "${s.id}": a release_version step has no agent.`);
      for (const key of ['version', 'dir', 'branch']) {
        if (s[key] !== undefined && typeof s[key] !== 'string') throw new Error(`Step "${s.id}": ${key} must be a string (a template).`);
      }
    } else if (s.type !== 'human_approval') {
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
    if (s.full_suite !== undefined && (s.full_suite !== 'warn' || MACHINE_STEP_TYPES.includes(s.type))) throw new Error(`Step "${s.id}": full_suite must be "warn", on an agent step (a whole-suite command its agent starts is noted, #177).`);
    if (s.commit_tests !== undefined && (s.commit_tests !== true || MACHINE_STEP_TYPES.includes(s.type) || s.agents)) throw new Error(`Step "${s.id}": commit_tests must be true, on a single-agent step (the orchestrator commits the test files its agent left uncommitted, #209).`);
    if (s.base_worktree !== undefined && (typeof s.base_worktree !== 'boolean' || MACHINE_STEP_TYPES.includes(s.type) || !wf.orchestrator?.worktree)) throw new Error(`Step "${s.id}": base_worktree must be true or false, on an agent step of a workflow with orchestrator.worktree.`);
    if (s.local_preview !== undefined && (s.type !== 'human_approval' || typeof s.local_preview !== 'boolean')) throw new Error(`Step "${s.id}": local_preview must be true or false, on a human_approval step.`);
    if (s.diff_base !== undefined && (s.type !== 'human_approval' || typeof s.diff_base !== 'string' || !s.diff_base.trim())) throw new Error(`Step "${s.id}": diff_base must be a ref (e.g. "origin/{{ inputs.base_branch }}"), on a human_approval step.`);
    if (s.save_to_issue !== undefined && (s.type !== 'human_approval' || !(s.choices || []).some((c) => c.id === s.save_to_issue))) throw new Error(`Step "${s.id}": save_to_issue must be the id of one of the step's choices (e.g. accept), on a human_approval step.`);
    if ((s.choices || []).some((c) => c.feedback_required) && !s.feedback) throw new Error(`Step "${s.id}": a choice with feedback_required needs the step's feedback field.`);
    // a gate's summary for a person (#213): `summary:` / `recommend:` templates, what the buttons
    // say and do (`approve_label` / `reject_label` / `approve_help` / `reject_help`, a choice's `help`)
    for (const key of ['summary', 'recommend', 'approve_label', 'reject_label', 'approve_help', 'reject_help']) {
      if (s[key] === undefined) continue;
      if (s.type !== 'human_approval' || typeof s[key] !== 'string') throw new Error(`Step "${s.id}": ${key} must be a text (a template), on a human_approval step.`);
      if (key.startsWith('approve_') || key.startsWith('reject_')) {
        if (s.choices) throw new Error(`Step "${s.id}": ${key} is for an Approve / Reject gate; a gate with choices sets each choice's label and help.`);
      }
    }
    if ((s.choices || []).some((c) => c.help !== undefined && typeof c.help !== 'string')) throw new Error(`Step "${s.id}": a choice's help must be a text.`);
    // a choice's `then` (#134): picking it sets what happens with the run's result when it finishes
    for (const c of s.choices || []) {
      if (c.then === undefined) continue;
      try { chain.normalizeThen(c.then); } catch (e) { throw new Error(`Step "${s.id}": choice "${c.id}": ${e.message}`); }
    }
    // `kind: escalation`: a gate about a problem (a failure, an exhausted loop), where the supervisor on
    // call tries first; `decision` (default): a choice only the person makes, never answered by it
    if (s.kind !== undefined) {
      if (s.type !== 'human_approval' || !GATE_KINDS.includes(s.kind)) throw new Error(`Step "${s.id}": kind must be one of ${GATE_KINDS.join(', ')}, on a human_approval step.`);
      if (s.kind === 'escalation' && s.check) throw new Error(`Step "${s.id}": a gate with check (a merge) is a decision, not an escalation.`);
    }
    // a deterministic PR/MR check: `check:` before a gate opens, `precheck:` before a transition's action
    const validateCheck = (c, what) => {
      if (!c || typeof c !== 'object' || !PROBES.includes(c.probe) || !c.target) throw new Error(`Step "${s.id}": ${what} needs a probe (${PROBES.join(', ')}) and a target.`);
    };
    // `recover:` steps the supervisor may send the run back to after a failed action or check
    const validateRecover = (recover, failTo, what) => {
      if (recover === undefined) return;
      if (!Array.isArray(recover) || !recover.length) throw new Error(`Step "${s.id}": ${what}.recover must be a non-empty list of steps.`);
      if (!failTo) throw new Error(`Step "${s.id}": ${what}.recover needs a failure route (on_error / on_fail) for when the supervisor does not recover.`);
      for (const r of recover) {
        const target = wf.steps.find((x) => x.id === r);
        if (!target || target.type === 'human_approval') throw new Error(`Step "${s.id}": ${what}.recover must list agent steps ("${r}" is not one).`);
      }
    };
    if (s.check !== undefined) {
      if (s.type !== 'human_approval') throw new Error(`Step "${s.id}": check is only valid for human_approval.`);
      validateCheck(s.check, 'check');
      if (s.check.on_fail && !ids.has(s.check.on_fail)) throw new Error(`Step "${s.id}" points to unknown step "${s.check.on_fail}".`);
      validateRecover(s.check.recover, s.check.on_fail, 'check');
    }
    if (s.stall !== undefined) {
      const fields = s.stall?.same_output_fields;
      if (!s.stall || typeof s.stall !== 'object' || !Array.isArray(fields) || !fields.length || fields.some((f) => typeof f !== 'string' || !f)) {
        throw new Error(`Step "${s.id}": stall.same_output_fields must be a non-empty list of output field names.`);
      }
      const props = s.output_schema?.properties;
      const unknown = props && fields.find((f) => !(f in props));
      if (unknown) throw new Error(`Step "${s.id}": stall.same_output_fields names "${unknown}", which is not in its output_schema.`);
    }
    for (const t of s.transitions || []) {
      if (t.precheck !== undefined) {
        if (t.precheck === true) { if (!s.check) throw new Error(`Step "${s.id}": precheck: true reuses the step's check, which it does not have.`); } else validateCheck(t.precheck, 'precheck');
      }
      validateRecover(t.recover, t.on_error, 'transition');
      if (t.set !== undefined && (!t.set || typeof t.set !== 'object' || Array.isArray(t.set))) throw new Error(`Step "${s.id}": transition set must be a map of run variables.`);
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
      // `ship: { tag }` (#260): only the answer a person gives at a decision gate ships a release
      if (t.ship !== undefined) {
        if (!t.ship || typeof t.ship !== 'object' || !String(t.ship.tag || '').trim()) throw new Error(`Step "${s.id}": transition ship needs a tag (ship: { tag: "{{ inputs.version }}" }).`);
        if (s.type !== 'human_approval' || s.kind === 'escalation' || s.timeout !== undefined) throw new Error(`Step "${s.id}": ship belongs to a human gate nobody else answers (type: human_approval, no kind: escalation, no timeout).`);
        if (!wf.orchestrator?.worktree) throw new Error(`Step "${s.id}": ship needs orchestrator.worktree (the repository and its base branch).`);
      }
    }
  }
  const maxCtx = wf.orchestrator?.limits?.max_total_context;
  if (maxCtx != null && !String(maxCtx).includes('{{') && !parseTokens(maxCtx)) throw new Error('orchestrator.limits.max_total_context must be a token count such as 20M.');
  const lp = wf.orchestrator?.local_preview;
  if (lp != null && (typeof lp !== 'object' || !String(lp.command || '').trim())) throw new Error('orchestrator.local_preview needs a command (e.g. "npm start").');
  const sup = wf.orchestrator?.supervisor || {};
  if (sup.on_call !== undefined && typeof sup.on_call !== 'boolean') throw new Error('orchestrator.supervisor.on_call must be true or false.');
  const isAmount = (v) => typeof v === 'number' && v >= 0;
  if (sup.max_cost_usd !== undefined && !isAmount(sup.max_cost_usd)) throw new Error('orchestrator.supervisor.max_cost_usd must be a number of US$ (0 or more).');
  for (const k of ['same_output', 'slow_factor']) {
    if (sup.stall?.[k] !== undefined && !isAmount(sup.stall[k])) throw new Error(`orchestrator.supervisor.stall.${k} must be a number (0 = off).`);
  }
  validateGroups(wf.groups, ids);
  validateOutputs(wf.outputs);
  // #286: problems that do not stop a run, shown on the workflow's screen (not enumerable, so
  // nothing that walks the workflow's keys sees it); a templated provider is checked per run
  Object.defineProperty(wf, 'warnings', { value: silentEfforts(wf), enumerable: false, writable: true });
  return wf;
}

// #286: the agents whose `effort` never reaches their CLI (the engine adds a provider's
// effort_args only when it declares them); a templated provider or effort that resolves to
// nothing is skipped, the run checks its resolved agents again
function silentEfforts(wf) {
  const out = [];
  for (const [name, a] of Object.entries(wf.agents || {})) {
    const effort = String(a?.effort ?? '').trim();
    const provider = String(a?.provider ?? '');
    if (!effort || provider.includes('{{')) continue;
    const p = wf.providers?.[provider];
    if (p && !(Array.isArray(p.effort_args) && p.effort_args.length)) out.push(`the effort of ${name} is not passed: its provider has no effort_args`);
  }
  return out;
}

// `outputs:` (#134): the run's result contract, { <name>: { type, description, value } }. `value` is a
// template over the run's context plus `run` ({ issues, local_merge }); a type other than string is
// rendered as JSON (`| to_json`). Filled when the run finishes (WorkflowRun.computeOutputs).
const OUTPUT_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];
function validateOutputs(outputs) {
  if (outputs === undefined) return;
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) throw new Error('outputs must be a map of output names to { type, description, value }.');
  for (const [name, o] of Object.entries(outputs)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`outputs.${name}: the name must be lower case letters, digits and _.`);
    if (!o || typeof o !== 'object') throw new Error(`outputs.${name} must be { type, description, value }.`);
    if (!OUTPUT_TYPES.includes(o.type || 'string')) throw new Error(`outputs.${name}.type must be one of ${OUTPUT_TYPES.join(', ')}.`);
    if (typeof o.value !== 'string' || !o.value.trim()) throw new Error(`outputs.${name}.value must be a template (e.g. "{{ steps.write.output.document }}").`);
  }
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

// `loop` is the current format; `mode: polling` + `poll` are still accepted
const isLooping = (step) => !!step.loop || step.mode === 'polling';
const loopConfig = (step) => step.loop || step.poll || {};

// Human gates (#41): `decision` (default) is a choice only the person makes (scope, merge, publish);
// `escalation` is a problem the supervisor on call tries to solve before the person is asked.
const GATE_KINDS = ['decision', 'escalation'];

module.exports = {
  FALLBACK_ENTRY,
  isLooping,
  loadWorkflow,
  loopConfig,
  MACHINE_STEP_TYPES,
  parseDuration,
  parseRequests,
  parseTokens,
  renderFileList,
  silentEfforts,
  toBoolean,
  validateModels,
};
