// @ts-check
// Loading and validating the workflow YAML (#250, from packages/engine/engine/workflow.js): `loadWorkflow` parses
// the file, checks agents, steps, transitions, gates, `outputs:`, `groups:`, `display`, fallbacks and
// model limits, and returns the workflow object the engine walks. The checks of a single field are the
// rule table of packages/engine/engine/run/field-rules.js (#352); the rules across fields (references between
// steps, agents, transitions and groups) are the named functions here, one per rule. The sequences
// (WORKFLOW_CHECKS, AGENT_CHECKS, STEP_CHECKS, TRANSITION_CHECKS) give the order errors are reported in.
// Templates are code: a template reaching `constructor` / `process`… (#474) and agent output put
// unquoted into an action or a ship.build (#469) are refused here, before any run.
// A repository's own workflow (#485) loads through `loadRepositoryWorkflow`: accepted, then capped.
// With it, the YAML's vocabularies (`MACHINE_STEP_TYPES`, `isLooping` / `loopConfig`) and value parsers
// (`toBoolean`, `parseDuration`, `parseTokens`, `parseRequests`, `renderFileList`) the run modules share.

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const capabilities = require('../capabilities');
const { PROBES } = require('../probes');
const { validateWorkflowStep } = require('../workflow-step');
const testPaths = require('../test-paths');
const { bundledDir } = require('../../domains/workspace/app-root');
const architectureReport = require('@craftorio/shared/architecture-report');
const chain = require('@craftorio/shared/chain-model');
const {
  render,
  SHELL_SAFE_FILTERS,
  UNSAFE_TEMPLATE_NAMES,
} = require('./templates');
const {
  FIELD_RULES,
  GATE,
  MACHINE_STEP_TYPES,
  parseDuration,
  parseRequests,
  parseTokens,
  resolveChecks,
  runChecks,
} = require('./field-rules');

// A list of files in the YAML (`protect_files`, a suite step's `files`, #220): a template or a list of
// them. Rendered, each item may hold several files (a rendered list reads "a,b"; one per line works too).
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

// The named rules across fields: (the object checked, ctx), ctx = { prefix, type, wf, ids, file,
// mcpServers, step }; the message of a rule that shares its field's message comes from the table
const fail = (ctx, message) => { throw new Error(`${ctx.prefix}${message}`); };
// (every caller names a field of the table)
const messageOf = (field) => /** @type {{ message: string }} */ (FIELD_RULES.find((r) => r.field === field)).message;
const isAgentStep = (s) => !MACHINE_STEP_TYPES.includes(s.type);
const isGate = (s) => GATE.includes(s.type);

// an agent's (or `defaults`') fallbacks and capabilities
const agentFallbacks = (a, ctx) => validateFallbacks(a.fallbacks, ctx.name, ctx.wf.providers);
const agentCapabilities = (a, ctx) => capabilities.validate(a.capabilities, ctx.name, ctx.mcpServers);

const stepCapabilities = (s, ctx) => capabilities.validate(s.capabilities, `Step "${s.id}"`, ctx.mcpServers);
// `type: screenshots` (#144): `from` is the step whose `screenshots` output lists the screens
function screenshotsFrom(s, ctx) {
  if (s.type === 'screenshots' && !ctx.ids.has(s.from)) fail(ctx, 'from must be the step whose output lists the screenshots.');
}
// `type: project_map` (#372): every action but facts and analyze reads the output of its `from` step;
// `type: refactor_proposals` (#378): every action but facts
function projectMapFrom(s, ctx) {
  const reads = (s.type === 'project_map' && !['facts', 'analyze'].includes(s.action)) || (s.type === 'refactor_proposals' && s.action !== 'facts');
  if (reads && !ctx.ids.has(s.from)) fail(ctx, `from must be the step whose output the ${s.action} action reads.`);
}
function filesWithoutScope(s, ctx) {
  if (s.type === 'suite' && s.files !== undefined && s.scope !== undefined) fail(ctx, 'files and scope cannot be combined.');
}
function expectWithFiles(s, ctx) {
  if (s.type === 'suite' && s.expect !== undefined && s.files === undefined) fail(ctx, messageOf('steps[].expect'));
}
// `type: workflow` (#174): a child run of another workflow, once or per `foreach` item
function childWorkflow(s, ctx) {
  if (s.type === 'workflow') validateWorkflowStep(s, ctx.file);
}
function fanOutGoal(s, ctx) {
  if (isAgentStep(s) && s.agents && s.goal) fail(ctx, 'goal is not supported on a fan-out step (agents).');
}
function knownAgents(s, ctx) {
  if (!isAgentStep(s)) return;
  for (const n of s.agents || [s.agent]) if (!ctx.wf.agents[n]) throw new Error(`Step "${s.id}" references unknown agent "${n}".`);
}
function waitOnLoop(s, ctx) {
  if (s.wait !== undefined && (!isLooping(s) || s.agents)) fail(ctx, messageOf('steps[].wait'));
}
// wait.output / wait.infra_output only apply to the pr_checks and workflow_run probes
const outputNeedsProbe = (key) => function waitOutputProbe(s, ctx) {
  if (s.wait?.[key] !== undefined && s.wait.probe === 'pr_changes') fail(ctx, messageOf(`steps[].wait.${key}`));
};
function commitTestsSingleAgent(s, ctx) {
  if (s.commit_tests !== undefined && s.agents) fail(ctx, messageOf('steps[].commit_tests'));
}
// #567: the question is a field of one agent's JSON answer, so the step needs both
function askHumanShape(s, ctx) {
  if (s.ask_human === true && isAgentStep(s) && (s.agents || !s.output_schema)) fail(ctx, 'ask_human needs a single agent and an output_schema (needs_human is a field of its JSON answer).');
}
function baseWorktreeNeedsWorktree(s, ctx) {
  if (s.base_worktree !== undefined && !ctx.wf.orchestrator?.worktree) fail(ctx, messageOf('steps[].base_worktree'));
}
function saveToIssueChoice(s, ctx) {
  if (s.save_to_issue !== undefined && !(s.choices || []).some((c) => c.id === s.save_to_issue)) fail(ctx, messageOf('steps[].save_to_issue'));
}
function feedbackField(s, ctx) {
  if ((s.choices || []).some((c) => c.feedback_required) && !s.feedback) fail(ctx, 'a choice with feedback_required needs the step\'s feedback field.');
}
// approve_label / reject_label / approve_help / reject_help are for an Approve / Reject gate
const notWithChoices = (key) => function buttonWithoutChoices(s, ctx) {
  if (s[key] !== undefined && s.choices) fail(ctx, `${key} is for an Approve / Reject gate; a gate with choices sets each choice's label and help.`);
};
function choiceHelp(s, ctx) {
  if ((s.choices || []).some((c) => c.help !== undefined && typeof c.help !== 'string')) fail(ctx, 'a choice\'s help must be a text.');
}
// a choice's `then` (#134): picking it sets what happens with the run's result when it finishes
function choiceThen(s, ctx) {
  for (const c of s.choices || []) {
    if (c.then === undefined) continue;
    try { chain.normalizeThen(c.then); } catch (e) { fail(ctx, `choice "${c.id}": ${e.message}`); }
  }
}
function escalationWithCheck(s, ctx) {
  if (s.kind === 'escalation' && s.check) fail(ctx, 'a gate with check (a merge) is a decision, not an escalation.');
}
// #647: the person edits with the agent at a human_edit gate; the supervisor on call never answers it
function escalationOnEdit(s, ctx) {
  if (s.type === 'human_edit' && s.kind === 'escalation') fail(ctx, 'kind: escalation is not valid on a human_edit step (only the person ends it).');
}
// #647: a human_edit step sends the person's requests to its named agent
function editAgent(s, ctx) {
  if (s.type !== 'human_edit') return;
  if (!s.agent || !ctx.wf.agents[s.agent]) fail(ctx, `a human_edit step needs the agent its edit requests go to (unknown agent "${s.agent ?? ''}").`);
}
// a deterministic PR/MR check: `check:` before a gate opens, `precheck:` before a transition's action
function probeAndTarget(c, what, ctx) {
  if (!c || typeof c !== 'object' || !PROBES.includes(c.probe) || !c.target) fail(ctx, `${what} needs a probe (${PROBES.join(', ')}) and a target.`);
}
// `recover:` steps the supervisor may send the run back to after a failed action or check
function recoverSteps(recover, failTo, what, ctx) {
  if (recover === undefined) return;
  if (!Array.isArray(recover) || !recover.length) fail(ctx, `${what}.recover must be a non-empty list of steps.`);
  if (!failTo) fail(ctx, `${what}.recover needs a failure route (on_error / on_fail) for when the supervisor does not recover.`);
  for (const r of recover) {
    const target = ctx.wf.steps.find((x) => x.id === r);
    if (!target || isGate(target)) fail(ctx, `${what}.recover must list agent steps ("${r}" is not one).`);
  }
}
function checkProbe(s, ctx) {
  if (s.check !== undefined) probeAndTarget(s.check, 'check', ctx);
}
function checkOnFail(s, ctx) {
  if (s.check?.on_fail && !ctx.ids.has(s.check.on_fail)) throw new Error(`Step "${s.id}" points to unknown step "${s.check.on_fail}".`);
}
function checkRecover(s, ctx) {
  if (s.check !== undefined) recoverSteps(s.check.recover, s.check.on_fail, 'check', ctx);
}
// #378: `output_schema: <name>` is a schema the app defines once (the Oracle's architecture report),
// replaced here by its copy, so a step answers what the app's own turn answers
const NAMED_SCHEMAS = {
  architecture_report: architectureReport.REPORT_SCHEMA,
};
function namedSchema(s, ctx) {
  if (typeof s.output_schema !== 'string') return;
  const schema = NAMED_SCHEMAS[s.output_schema];
  if (!schema) fail(ctx, `output_schema "${s.output_schema}" is not a named schema (${Object.keys(NAMED_SCHEMAS).join(', ')}); write the schema inline.`);
  s.output_schema = structuredClone(schema);
}
function stallFieldsInSchema(s, ctx) {
  const props = s.stall !== undefined && s.output_schema?.properties;
  const unknown = props && s.stall.same_output_fields.find((f) => !(f in props));
  if (unknown) fail(ctx, `stall.same_output_fields names "${unknown}", which is not in its output_schema.`);
}
function transitions(s, ctx) {
  for (const t of s.transitions || []) runChecks(TRANSITION_CHECKS, t, { ...ctx, step: s });
}

// a transition's rules (ctx.step: its step)
function precheck(t, ctx) {
  if (t.precheck === undefined) return;
  if (t.precheck !== true) probeAndTarget(t.precheck, 'precheck', ctx);
  else if (!ctx.step.check) fail(ctx, 'precheck: true reuses the step\'s check, which it does not have.');
}
const transitionRecover = (t, ctx) => recoverSteps(t.recover, t.on_error, 'transition', ctx);
function knownTargets(t, ctx) {
  const s = ctx.step;
  for (const target of [t.goto, t.on_exhausted, t.on_error, t.loop?.on_exhausted, s.goal?.on_exhausted, s.loop?.on_exhausted, s.on_error].filter(Boolean)) {
    if (!ctx.ids.has(target) && target !== 'end' && target !== 'fail') throw new Error(`Step "${s.id}" points to unknown step "${target}".`);
  }
}
function statusEndsRun(t, ctx) {
  if (t.status !== undefined && ![t.goto, t.on_exhausted, t.loop?.on_exhausted].includes('end')) fail(ctx, 'a transition status only applies when the transition ends the run (goto: end or on_exhausted: end).');
}
function mergeNeedsWorktree(t, ctx) {
  if (t.merge !== undefined && !ctx.wf.orchestrator?.worktree) fail(ctx, 'merge: local needs orchestrator.worktree (the run\'s branch lives in its worktree).');
}
// `ship` (#260): only the answer a person gives at a decision gate ships a release
function shipOnHumanGate(t, ctx) {
  const s = ctx.step;
  if (t.ship !== undefined && (s.type !== 'human_approval' || s.kind === 'escalation' || s.timeout !== undefined)) fail(ctx, 'ship belongs to a human gate nobody else answers (type: human_approval, no kind: escalation, no timeout).');
}
function shipNeedsWorktree(t, ctx) {
  if (t.ship !== undefined && !ctx.wf.orchestrator?.worktree) fail(ctx, 'ship needs orchestrator.worktree (the repository and its base branch).');
}
// #469: an action and a ship.build run in a shell, so they interpolate unfiltered only the names the
// workflow or the user controls (SHELL_SAFE_NAMES: inputs, the run's folders, skill_dir(), a gate's
// choice...) and an agent's output field its output_schema types as a number or a boolean
// (`steps.ci.output.pr_number`, the step's own `output.n`). Any other value (agent text, `vars.*`, an
// error, a probe's detail) goes through one filter that validates or quotes it
// (`{{ steps.ci.output.pr_url | pr_url }}`). A `{% if %}` reads values without printing them; a
// `{% set %}` or a `{% for %}` is checked like an interpolation, and the names it binds are then safe.
const SHELL_INTERPOLATION = /\{\{([\s\S]*?)\}\}|\{%-?\s*((?:set|for)\b[\s\S]*?)%\}/g;
const SHELL_SAFE_NAMES = [
  'choice',
  'inputs',
  'iteration',
  'loop',
  'release',
  'run_dir',
  'run_id',
  'runs_dir',
  'skill_dir',
  'workflows_dir',
  'worktree_dir',
];
const TEMPLATE_KEYWORDS = ['and', 'defined', 'else', 'false', 'for', 'if', 'in', 'is', 'none', 'not', 'null', 'or', 'set', 'true', 'undefined'];
const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;
const NAME_TOKEN = /([.|]\s*)?\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
const FILTERED_VALUE = new RegExp(`^\\s*[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+|\\[\\s*\\d+\\s*\\])*\\s*\\|\\s*(?:${SHELL_SAFE_FILTERS.join('|')})\\s*(?:\\([^()]*\\))?\\s*$`);
const SHELL_SAFE_TYPES = ['boolean', 'integer', 'number'];
const BOUND_NAMES = /\{%-?\s*(?:set|for)\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)/g;
function typedOutput(expr, at, ctx) {
  const m = /^steps\.([A-Za-z0-9_]+)\.output\.([A-Za-z0-9_]+)\b(?!\s*[.[(])/.exec(expr.slice(at))
    || /^(output)\.([A-Za-z0-9_]+)\b(?!\s*[.[(])/.exec(expr.slice(at));
  if (!m) return false;
  const step = m[1] === 'output' && !expr.startsWith('steps', at) ? ctx.step : ctx.wf.steps.find((s) => s.id === m[1]);
  return SHELL_SAFE_TYPES.includes(step?.output_schema?.properties?.[m[2]]?.type);
}
function shellUnsafeReference(text, ctx) {
  const bound = new Set([...String(text).matchAll(BOUND_NAMES)].flatMap((m) => m[1].split(',').map((n) => n.trim())));
  for (const m of String(text).matchAll(SHELL_INTERPOLATION)) {
    const expr = m[1] ?? m[2];
    if (FILTERED_VALUE.test(expr)) continue;
    const code = expr.replace(STRING_LITERAL, "''");
    for (const t of code.matchAll(NAME_TOKEN)) {
      const [, prefix, name] = t;
      if (prefix || TEMPLATE_KEYWORDS.includes(name) || SHELL_SAFE_NAMES.includes(name) || bound.has(name)) continue;
      if ((name === 'steps' || name === 'output') && typedOutput(code, t.index, ctx)) continue;
      return (/^[A-Za-z0-9_.]+/.exec(code.slice(t.index)) || [name])[0];
    }
  }
  return null;
}
// `release` is safe only as far as what fills it: release.tag is the rendered ship.tag, so a build
// that reads `release` holds ship.tag to the same rule.
function readsRelease(text) {
  return [...String(text).matchAll(SHELL_INTERPOLATION)].some((m) => [...(m[1] ?? m[2]).replace(STRING_LITERAL, "''")
    .matchAll(NAME_TOKEN)].some(([, prefix, name]) => !prefix && name === 'release'));
}
function shellSafeTemplates(t, ctx) {
  const tag = t.ship?.build != null && readsRelease(t.ship.build) ? [['ship.tag (read by ship.build as release.tag)', t.ship.tag]] : [];
  for (const [what, text] of [['transition action', t.action], ['ship.build', t.ship?.build], ...tag]) {
    const ref = text != null && shellUnsafeReference(text, ctx);
    if (ref) fail(ctx, `${what} interpolates ${ref} into a shell command without a safe filter (${SHELL_SAFE_FILTERS.join(', ')}); unfiltered, it may use only ${SHELL_SAFE_NAMES.join(', ')} and an agent output field its output_schema types as number, integer or boolean.`);
  }
}

// the workflow's rules
const models = (wf) => validateModels(wf.models);
function agents(wf, ctx) {
  for (const [name, a] of [['defaults', wf.defaults || {}], ...Object.entries(wf.agents).map(([n, a]) => [`Agent "${n}"`, a || {}])]) {
    runChecks(AGENT_CHECKS, a, { ...ctx, prefix: `${name}: `, name });
  }
}
const testsPaths = (wf) => testPaths.validateTestsPaths(wf.tests_paths);
function steps(wf, ctx) {
  const ids = new Set(wf.steps.map((s) => s.id));
  for (const s of wf.steps) runChecks(STEP_CHECKS, s, { ...ctx, prefix: `Step "${s.id}": `, type: s.type, ids });
}
const groups = (wf) => validateGroups(wf.groups, new Set(wf.steps.map((s) => s.id)));
const outputs = (wf) => validateOutputs(wf.outputs);

// The order the checks run in, so a YAML with several problems reports the same one first: a name is
// the table's entries for that field, a function a named rule
const AGENT_CHECKS = resolveChecks('agents.*.', [
  agentFallbacks, 'session', 'max_context', 'max_requests', 'fresh_after_idle', 'persona', 'edits_tests',
  'protect_files', agentCapabilities, 'display',
]);
const TRANSITION_CHECKS = resolveChecks('steps[].transitions[].', [
  precheck, transitionRecover, 'set', knownTargets, 'status', statusEndsRun, 'merge', mergeNeedsWorktree,
  'ship.tag', shipOnHumanGate, shipNeedsWorktree, shellSafeTemplates,
]);
const STEP_CHECKS = resolveChecks('steps[].', [
  stepCapabilities, namedSchema, 'display', 'edits_tests', 'protect_files', 'test_map', 'ask_human', 'agent', 'agents',
  askHumanShape,
  // the step types without an agent, then the agent steps (one applies to a step)
  screenshotsFrom, 'folder', 'command', 'timeout', 'scope', 'files', filesWithoutScope, 'expect', expectWithFiles,
  childWorkflow, 'steps', 'renderer', 'issues', 'version', 'dir', 'branch', 'item', 'stage', 'stage_summary', 'target', 'action', projectMapFrom, fanOutGoal, knownAgents, editAgent,
  'goal.until', 'wait', waitOnLoop, 'wait.probe', 'wait.target', 'wait.output', outputNeedsProbe('output'),
  'wait.infra_output', outputNeedsProbe('infra_output'), 'wait.grace', 'wait.parent',
  'choices', 'full_suite', 'commit_tests', commitTestsSingleAgent, 'base_worktree', baseWorktreeNeedsWorktree,
  'local_preview', 'diff_base', 'save_to_issue', saveToIssueChoice, feedbackField,
  'summary', 'recommend', 'approve_label', notWithChoices('approve_label'), 'reject_label', notWithChoices('reject_label'),
  'approve_help', notWithChoices('approve_help'), 'reject_help', notWithChoices('reject_help'), choiceHelp, choiceThen,
  'kind', escalationWithCheck, escalationOnEdit, 'check', checkProbe, checkOnFail, checkRecover,
  'stall.same_output_fields', stallFieldsInSchema, transitions,
]);
const WORKFLOW_CHECKS = resolveChecks('', [
  'steps', 'agents', models, agents, testsPaths, steps,
  'env.passthrough',
  'orchestrator.limits.max_total_context', 'orchestrator.local_preview.command', 'orchestrator.supervisor.on_call',
  'orchestrator.supervisor.max_cost_usd', 'orchestrator.supervisor.stall.same_output', 'orchestrator.supervisor.stall.slow_factor',
  groups, outputs,
]);

// #389: the parsed YAML of each file, kept while its mtime and size do not change (the Backlog and
// the roadmap load the same workflows many times); every call checks and hands out its own copy.
// #407: a rewrite of the same size within the mtime's resolution keeps the mtime, so an entry read
// less than RACY_MS after the file's mtime is checked against the text (still no parse) until the
// file is older than that (git's "racy clean" rule)
const RACY_MS = 2000; // above the coarsest mtime resolution we meet (FAT: 2 s)
const parsedCache = new Map(); // file → { key, readAt, text, wf }
function parseWorkflowFile(file) {
  let st = null;
  try { st = fs.statSync(file); } catch { /* readFileSync says why */ }
  const key = st && `${st.mtimeMs}:${st.size}`;
  const hit = key && parsedCache.get(path.resolve(file));
  if (st && hit && hit.key === key && hit.readAt - st.mtimeMs > RACY_MS) return structuredClone(hit.wf);
  const readAt = Date.now();
  const text = fs.readFileSync(file, 'utf8');
  if (hit && hit.key === key && hit.text === text) {
    hit.readAt = readAt;
    return structuredClone(hit.wf);
  }
  const wf = yaml.load(text);
  if (key) parsedCache.set(path.resolve(file), { key, readAt, text, wf: structuredClone(wf) });
  return wf;
}

// #434: step bodies several workflows share (fragments/<name>.yaml, `steps: { <id>: body }`). A step
// `{ id, fragment: <name>, ...keys }` becomes the fragment's body for its id under the step's own keys,
// before the checks. The fragments ship with the app: a workflow copied to the workspace (or to a
// scratch folder) still finds them.
const FRAGMENTS_DIR = bundledDir('fragments');
const fragmentName = (step) => path.basename(String(step.fragment));
const fragmentFile = (name) => path.join(FRAGMENTS_DIR, `${name}.yaml`);
const includesFragment = (step) => !!step && typeof step === 'object' && step.fragment != null;
function expandFragments(wf) {
  if (!Array.isArray(wf?.steps)) return;
  const bodies = new Map(); // fragment name → its steps
  wf.steps = wf.steps.map((step, i) => {
    if (!includesFragment(step)) return step;
    const { fragment, ...own } = step;
    const name = fragmentName(step);
    if (!bodies.has(name)) {
      try { bodies.set(name, parseWorkflowFile(fragmentFile(name))?.steps || {}); }
      catch (e) { throw new Error(`steps[${i}].fragment: cannot read fragments/${name}.yaml (${e.message})`); }
    }
    const body = bodies.get(name)[own.id];
    if (!body || typeof body !== 'object') throw new Error(`steps[${i}].fragment: fragments/${name}.yaml has no step "${own.id}"`);
    return { ...own, ...body, ...own };
  });
}

// The fragments a parsed, not yet expanded workflow includes, with their text ([{ name, text }],
// a missing one left out): the supervisor's read_workflow shows them next to the workflow's YAML.
function fragmentSources(wf) {
  const names = [...new Set((Array.isArray(wf?.steps) ? wf.steps : []).filter(includesFragment).map(fragmentName))];
  return names.flatMap((name) => {
    try { return [{ name, text: fs.readFileSync(fragmentFile(name), 'utf8') }]; } catch { return []; }
  });
}

// #474: nunjucks has no sandbox, so a template that names `constructor` (and the other
// UNSAFE_TEMPLATE_NAMES) could run code in the app's process: refused in every {{ }} and {% %} of
// the workflow, and in the whole text of an expression field (`when`, `until`, `agent_when`).
// A subscript takes a literal or a name (`results[name]`), never a built key (`x['const' ~ 'ructor']`).
// Prose outside the template blocks may use the words.
const TEMPLATE_BLOCK = /\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}/g;
const UNSAFE_NAME = new RegExp(`\\b(${UNSAFE_TEMPLATE_NAMES.join('|')})\\b`);
const SIMPLE_KEY = /^\s*(?:''|-?\d+|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)?\s*$/;
const EXPRESSION_KEYS = ['agent_when', 'until', 'when'];
// the first subscript of a template whose key is an expression, or null
function builtSubscript(text) {
  const code = text.replace(STRING_LITERAL, "''");
  for (let i = 0; i < code.length; i++) {
    const before = code[i] === '[' && /([A-Za-z0-9_]+|[)\]])\s*$/.exec(code.slice(0, i));
    if (!before || TEMPLATE_KEYWORDS.includes(before[1])) continue;
    let depth = 0, j = i;
    for (; j < code.length; j++) {
      if (code[j] === '[') depth++;
      else if (code[j] === ']' && --depth === 0) break;
    }
    const key = code.slice(i + 1, j);
    if (!SIMPLE_KEY.test(key)) return `[${key}]`;
  }
  return null;
}
function unsafeTemplates(v, where = '', expression = false) {
  if (typeof v === 'string') {
    const parts = expression ? [v] : [...v.matchAll(TEMPLATE_BLOCK)].map((m) => m[1] ?? m[2]);
    const hit = parts.map((p) => UNSAFE_NAME.exec(p)).find(Boolean);
    if (hit) throw new Error(`${where}: a template may not reach ${hit[1]} (templates run unsandboxed in the app; refused: ${UNSAFE_TEMPLATE_NAMES.join(', ')}). A step, input or variable with that name must be renamed.`);
    const built = parts.map(builtSubscript).find(Boolean);
    if (built) throw new Error(`${where}: a template subscript ${built} must be a literal or a name, not an expression (templates run unsandboxed in the app).`);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => unsafeTemplates(x, `${where}[${i}]`, expression));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) unsafeTemplates(x, where ? `${where}.${k}` : k, expression || EXPRESSION_KEYS.includes(k));
  }
}

function loadWorkflow(file) {
  const wf = parseWorkflowFile(file);
  expandFragments(wf);
  unsafeTemplates(wf);
  const root = wf || {};
  runChecks(WORKFLOW_CHECKS, root, { prefix: '', wf: root, file, mcpServers: root.mcp_servers || {} });
  // #286: problems that do not stop a run, shown on the workflow's screen (not enumerable, so
  // nothing that walks the workflow's keys sees it); a templated provider is checked per run
  Object.defineProperty(wf, 'warnings', { value: silentEfforts(wf), enumerable: false, writable: true });
  // #631: the workflow's name (metadata.name) at the top too, not enumerable like warnings
  if (!Object.hasOwn(wf, 'name')) Object.defineProperty(wf, 'name', { value: wf.metadata?.name, enumerable: false, writable: true });
  return wf;
}

// #485: a repository's own workflow (.craftorio/workflows/, packages/engine/domains/project/project-manifest.js) is code from the
// checkout: off until the owner accepts it for its commit, and capped even then. It never ships, runs
// its `action:`s only in the run's worktree and gives its agents only the tools of the workspace's
// policy: settings.json's `repositoryWorkflowTools` (no Settings field yet), else the tools the app's
// bundled workflows give their agents (read, edit, write and their bash:<toolchain> commands, never
// `bash`, any command), so a repository's copy of a bundled flow runs as the bundled one does.
const BUNDLED_WORKFLOWS_DIR = bundledDir('workflows');
let bundledPolicy = null;
function repositoryToolPolicy() {
  if (bundledPolicy) return bundledPolicy;
  const tools = new Set(['edit', 'read', 'write']);
  let files = [];
  try { files = fs.readdirSync(BUNDLED_WORKFLOWS_DIR).filter((f) => /\.ya?ml$/i.test(f)); } catch { /* none bundled */ }
  for (const f of files) {
    let wf = null;
    try { wf = yaml.load(fs.readFileSync(path.join(BUNDLED_WORKFLOWS_DIR, f), 'utf8')); } catch { continue; }
    const caps = [wf?.defaults?.capabilities, ...Object.values(wf?.agents || {}).map((a) => a?.capabilities), ...[...stepNodes(wf?.steps)].map((n) => n.capabilities)];
    for (const c of caps.filter(Boolean)) {
      let normal = null;
      try { normal = capabilities.normalize(c); } catch { continue; }
      for (const t of normal?.tools || []) if (String(t).startsWith('bash:')) tools.add(t);
    }
  }
  bundledPolicy = [...tools].sort();
  return bundledPolicy;
}

// every object of the steps' tree (nested steps, transitions, recover / on_error steps)
function* stepNodes(node) {
  if (Array.isArray(node)) for (const v of node) yield* stepNodes(v);
  else if (node && typeof node === 'object') {
    yield node;
    for (const v of Object.values(node)) yield* stepNodes(v);
  }
}
function repositoryNoShip(wf, name) {
  if ([...stepNodes(wf.steps)].some((n) => n.ship !== undefined)) throw new Error(`Workflow "${name}" from the repository cannot ship a release: ship is for the workspace's own workflows (clone it to the workspace to ship).`);
}
function repositoryActionsInWorktree(wf, name) {
  if (!wf.orchestrator?.worktree && [...stepNodes(wf.steps)].some((n) => n.action !== undefined)) throw new Error(`Workflow "${name}" from the repository runs an action outside a worktree: a repository workflow's action runs only in the run's worktree (orchestrator.worktree).`);
}
function repositoryToolsInPolicy(wf, name, policy) {
  const allowed = new Set(policy);
  const ok = (tool) => allowed.has(tool) || (allowed.has('bash') && tool.startsWith('bash:'));
  const sources = [
    ...Object.entries(wf.agents || {}).map(([k, a]) => [`agent "${k}"`, (a?.capabilities ?? wf.defaults?.capabilities)]),
    ...[...stepNodes(wf.steps)].filter((n) => n.capabilities && n.id !== undefined).map((n) => [`step "${n.id}"`, n.capabilities]),
  ];
  for (const [where, caps] of sources) {
    if (!caps) throw new Error(`Workflow "${name}" from the repository: ${where} declares no capabilities.tools (every tool); list its tools within the workspace's tool policy (${policy.join(', ')}).`);
    const beyond = (capabilities.normalize(caps)?.tools || []).filter((t) => !ok(t));
    if (beyond.length) throw new Error(`Workflow "${name}" from the repository: ${where} uses ${beyond.join(', ')}, beyond the workspace's tool policy (${policy.join(', ')}).`);
  }
}

/**
 * Loads a repository workflow (#485): every loadWorkflow check, then refused when the owner has not
 * accepted it and when it goes beyond the caps.
 * @param {string} file the workflow in the run's base checkout (or the text of its accepted commit)
 * @param {{ accepted: boolean, policy?: { tools?: string[] }, commit?: string }} opts commit: the
 *   commit the copy was read at (#554, named in the refusal); default: the copy's folder (its sha)
 */
function loadRepositoryWorkflow(file, { accepted, policy, commit } = { accepted: false }) {
  const name = () => path.basename(String(file), path.extname(String(file)));
  if (!accepted) {
    let shown = name();
    try { shown = String(parseWorkflowFile(file)?.metadata?.name || shown); } catch { /* the file's name */ }
    const sha = String(commit || path.basename(path.dirname(String(file)))).slice(0, 7);
    throw new Error(`Workflow "${shown}" from the repository @ ${sha} is not accepted: accept it on the Workflows screen for this commit first.`);
  }
  const wf = loadWorkflow(file);
  const shown = String(wf.metadata?.name || name());
  repositoryNoShip(wf, shown);
  repositoryActionsInWorktree(wf, shown);
  repositoryToolsInPolicy(wf, shown, policy?.tools || repositoryToolPolicy());
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

module.exports = {
  FALLBACK_ENTRY,
  fragmentSources,
  isLooping,
  loadRepositoryWorkflow,
  loadWorkflow,
  loopConfig,
  MACHINE_STEP_TYPES,
  parseDuration,
  parseRequests,
  parseTokens,
  renderFileList,
  repositoryToolPolicy,
  silentEfforts,
  toBoolean,
  validateModels,
};
