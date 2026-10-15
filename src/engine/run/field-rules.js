// @ts-check
// The workflow YAML's field rules as a table (#352): `FIELD_RULES` holds one entry per checked field,
// `{ field, appliesTo, type, template, required, message }` (plus `values` for a `one of` type,
// `present` when "set" is not "defined", `elsewhere: 'skip'` for a field ignored on other step types,
// `placeMessage` when being on the wrong step type has its own message). `checkField` is the small
// interpreter that applies one entry; src/engine/run/load.js runs them in its order, between the
// named rules that span several fields. `fieldReference` is the Markdown table `npm run docs`
// writes to docs/agents/engine/field-reference.md (gitignored), so the docs follow the checks.
// With them, the vocabularies (`SESSION_MODES`, `MACHINE_STEP_TYPES`, `GATE_KINDS`, `END_STATUSES`)
// and the value parsers (`parseDuration`, `parseTokens`, `parseRequests`) the table's types use.

'use strict';

const { PROBES } = require('../probes');

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
  'project_map',
  'release_version',
  'screenshots',
  'suite',
  'test_ids',
  'workflow',
];
// Human gates (#41): `decision` (default) is a choice only the person makes (scope, merge, publish);
// `escalation` is a problem the supervisor on call tries to solve before the person is asked.
const GATE_KINDS = ['decision', 'escalation'];
// `type: project_map` (#372, analyze #381): what the step does (src/engine/run/project-map-steps.js)
const PROJECT_MAP_ACTIONS = ['facts', 'validate', 'save', 'analyze', 'fail'];
const DISPLAY_MAX = 40;

// The value types of the table: name → check of a value that is set (a template is checked before)
const TYPES = {
  'amount': (v) => typeof v === 'number' && v >= 0,
  'any': () => true,
  'boolean': (v) => typeof v === 'boolean',
  'display name': (v) => typeof v === 'string' && Boolean(v.trim()) && v.length <= DISPLAY_MAX,
  'duration': (v) => parseDuration(v, null) != null,
  'field names': (v) => Array.isArray(v) && v.length > 0 && v.every((f) => typeof f === 'string' && f),
  'file list': (v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')),
  'map': (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v),
  'non-blank text': (v) => typeof v === 'string' && Boolean(v.trim()),
  'non-blank value': (v) => Boolean(String(v).trim()),
  'non-empty list': (v) => Array.isArray(v) && v.length > 0,
  'one of': (v, rule) => rule.values.includes(v),
  'plain name': (v) => /^[\w-]+$/.test(String(v)),
  'request count': (v) => Boolean(parseRequests(v)),
  'text': (v) => typeof v === 'string',
  'token count': (v) => Boolean(parseTokens(v)),
};

// Where a step field applies: every step type, a list of types, or every type except some
const AGENT_STEPS = { except: MACHINE_STEP_TYPES };
const NO_AGENT_TYPES = ['project_map', 'release_version', 'screenshots', 'suite', 'test_ids'];
const GATE = ['human_approval'];
const AGENTS = 'agents and defaults';
const WORKFLOW = 'workflow';

/**
 * @typedef {{ field: string, appliesTo: any, type: string, template: boolean, required: boolean, message: string,
 *   values?: string[], placeMessage?: string, elsewhere?: string }} FieldRule
 * @returns {FieldRule}
 */
const entry = (field, appliesTo, type, message, more = {}) => ({ field, appliesTo, type, template: false, required: false, message, ...more });
const gateText = (key) => entry(`steps[].${key}`, GATE, 'text', `${key} must be a text (a template), on a human_approval step.`, { template: true });
const text = (key, types) => entry(`steps[].${key}`, types, 'text', `${key} must be a string (a template).`, { template: true, elsewhere: 'skip' });
const folder = (key) => entry(`steps[].${key}`, ['test_ids'], 'non-blank text', `${key} must be a repository-relative folder (a template).`, { template: true, elsewhere: 'skip' });
const noAgent = (key) => entry(`steps[].${key}`, { except: NO_AGENT_TYPES }, 'any', 'a {type} step has no agent.', { present: 'truthy' });
const amount = (path, message) => entry(`orchestrator.supervisor.${path}`, WORKFLOW, 'amount', message);
const waitOutput = (key) => entry(`steps[].wait.${key}`, 'all', 'map', `wait.${key} must be a map of output fields, and only applies to the pr_checks and workflow_run probes.`);

// The table: the field's path (agents.*, steps[], steps[].transitions[] or from the workflow's root),
// the step types it applies to, its type, whether a template (`{{ … }}`) skips the type check,
// whether it is required (when its parent is set) and the error message (after "Step "<id>": " or
// "Agent "<name>": "; `{type}` is the step's type)
const FIELD_RULES = [
  entry('steps', WORKFLOW, 'non-empty list', 'Workflow has no "steps".', { required: true }),
  entry('agents', WORKFLOW, 'any', 'Workflow has no "agents".', { required: true }),
  entry('agents.*.session', AGENTS, 'one of', `session must be one of ${SESSION_MODES.join(', ')}.`, { values: SESSION_MODES }),
  entry('agents.*.max_context', AGENTS, 'token count', 'max_context must be a token count such as 150k.', { template: true }),
  entry('agents.*.max_requests', AGENTS, 'request count', 'max_requests must be a whole number of model requests such as 40.', { template: true }),
  entry('agents.*.fresh_after_idle', AGENTS, 'duration', 'fresh_after_idle must be a duration such as 55m.'),
  entry('agents.*.persona', AGENTS, 'one of', 'persona must be "random".', { values: ['random'] }),
  entry('agents.*.edits_tests', AGENTS, 'boolean', 'edits_tests must be true or false.'),
  entry('agents.*.protect_files', AGENTS, 'file list', 'protect_files must be a file list: a template or a list of paths.', { template: true }),
  entry('agents.*.display', AGENTS, 'display name', `display must be a name of 1 to ${DISPLAY_MAX} characters.`),
  entry('steps[].display', 'all', 'display name', `display must be a name of 1 to ${DISPLAY_MAX} characters.`),
  entry('steps[].edits_tests', 'all', 'boolean', 'edits_tests must be true or false.'),
  // #220: files its agent may not change (a template, e.g. another step's tests_added)
  entry('steps[].protect_files', AGENT_STEPS, 'file list', 'protect_files must be a file list: a template or a list of paths.', { template: true, placeMessage: 'protect_files is only valid on an agent step.' }),
  // #219: the code → tests map given to its prompt as {{ test_map }}
  entry('steps[].test_map', AGENT_STEPS, 'boolean', 'test_map must be true or false, on an agent step.'),
  noAgent('agent'),
  noAgent('agents'),
  // `agents: [...]` = fan-out: the same prompt goes to several agents in parallel
  entry('steps[].agents', AGENT_STEPS, 'non-empty list', 'agents must be a non-empty list.', { present: 'truthy', elsewhere: 'skip' }),
  // `type: screenshots` (#144): the screens listed in `from`'s `screenshots` output
  entry('steps[].folder', ['screenshots'], 'plain name', 'folder must be a plain folder name (e.g. developer).', { elsewhere: 'skip' }),
  entry('steps[].timeout', ['screenshots'], 'duration', 'timeout must be a duration such as 3m.', { elsewhere: 'skip' }),
  // `type: suite` (#177): the project's whole test suite, once per visit
  entry('steps[].command', ['suite'], 'text', 'command must be a string (a template; empty = found from the project\'s files).', { template: true, elsewhere: 'skip' }),
  entry('steps[].timeout', ['suite'], 'duration', 'timeout must be a duration such as 30m.', { template: true, elsewhere: 'skip' }),
  // #212: affected = the affected test files each visit, the whole suite once when they pass;
  // #324: failed = whole first, then the files that failed in the previous round and the whole suite
  entry('steps[].scope', ['suite'], 'one of', 'scope must be affected, failed or full.', { values: ['affected', 'failed', 'full'], template: true, elsewhere: 'skip' }),
  // #220: given test files only, and `expect: red` for tests written before the code (the red check);
  // #355: `expect: green` for tests that pin the current behaviour (they must pass on the unchanged code)
  entry('steps[].files', ['suite'], 'file list', 'files must be a file list: a template or a list of paths.', { template: true, elsewhere: 'skip' }),
  entry('steps[].expect', ['suite'], 'one of', 'expect must be "red", with files (the red check of tests written before the code), or "green" (the green check of tests that pin the current behaviour).', { values: ['red', 'green'], elsewhere: 'skip' }),
  // `type: test_ids` (#246): the test ids the E2E step definitions use and the renderer lacks
  folder('steps'),
  folder('renderer'),
  // `type: release_version` (#325): the release's version into the project's package.json
  text('version', ['release_version']),
  text('dir', ['release_version']),
  text('branch', ['release_version']),
  // `type: project_map` (#372): the project map's machine steps, `from` the step whose output they read
  entry('steps[].action', ['project_map'], 'one of', `action must be one of ${PROJECT_MAP_ACTIONS.join(', ')}, on a project_map step.`, { values: PROJECT_MAP_ACTIONS, required: true, elsewhere: 'skip' }),
  entry('steps[].goal.until', 'all', 'any', 'goal requires "until".', { required: true, present: 'truthy' }),
  entry('steps[].wait', { except: GATE }, 'any', 'wait is only valid on a single-agent step with a loop.'),
  entry('steps[].wait.probe', 'all', 'one of', `wait.probe must be one of ${PROBES.join(', ')}.`, { values: PROBES, required: true }),
  entry('steps[].wait.target', 'all', 'any', 'wait requires "target" (the PR/MR or CI run URL).', { required: true }),
  waitOutput('output'),
  waitOutput('infra_output'),
  entry('steps[].wait.grace', 'all', 'duration', 'wait.grace must be a duration such as 10m.'),
  entry('steps[].choices', GATE, 'any', 'choices is only valid for human_approval.', { present: 'truthy' }),
  entry('steps[].full_suite', AGENT_STEPS, 'one of', 'full_suite must be "warn", on an agent step (a whole-suite command its agent starts is noted, #177).', { values: ['warn'] }),
  entry('steps[].commit_tests', AGENT_STEPS, 'one of', 'commit_tests must be true, on a single-agent step (the orchestrator commits the test files its agent left uncommitted, #209).', { values: [true] }),
  entry('steps[].base_worktree', AGENT_STEPS, 'boolean', 'base_worktree must be true or false, on an agent step of a workflow with orchestrator.worktree.'),
  entry('steps[].local_preview', GATE, 'boolean', 'local_preview must be true or false, on a human_approval step.'),
  entry('steps[].diff_base', GATE, 'non-blank text', 'diff_base must be a ref (e.g. "origin/{{ inputs.base_branch }}"), on a human_approval step.', { template: true }),
  entry('steps[].save_to_issue', GATE, 'any', 'save_to_issue must be the id of one of the step\'s choices (e.g. accept), on a human_approval step.'),
  // a gate's summary for a person (#213), what its buttons say and do
  gateText('summary'),
  gateText('recommend'),
  gateText('approve_label'),
  gateText('reject_label'),
  gateText('approve_help'),
  gateText('reject_help'),
  // `kind: escalation`: a gate about a problem, where the supervisor on call tries first;
  // `decision` (default): a choice only the person makes, never answered by it
  entry('steps[].kind', GATE, 'one of', `kind must be one of ${GATE_KINDS.join(', ')}, on a human_approval step.`, { values: GATE_KINDS }),
  // a deterministic PR/MR check before a gate opens
  entry('steps[].check', GATE, 'any', 'check is only valid for human_approval.'),
  entry('steps[].stall.same_output_fields', 'all', 'field names', 'stall.same_output_fields must be a non-empty list of output field names.', { required: true }),
  entry('steps[].transitions[].set', 'all', 'map', 'transition set must be a map of run variables.'),
  entry('steps[].transitions[].status', 'all', 'one of', `transition status must be one of ${END_STATUSES.join(', ')}.`, { values: END_STATUSES }),
  entry('steps[].transitions[].merge', 'all', 'one of', 'transition merge must be "local".', { values: ['local'] }),
  // `ship: { tag }` (#260): only the answer a person gives at a decision gate ships a release
  entry('steps[].transitions[].ship.tag', 'all', 'non-blank value', 'transition ship needs a tag (ship: { tag: "{{ inputs.version }}" }).', { template: true, required: true }),
  entry('orchestrator.limits.max_total_context', WORKFLOW, 'token count', 'orchestrator.limits.max_total_context must be a token count such as 20M.', { template: true, present: 'set' }),
  entry('orchestrator.local_preview.command', WORKFLOW, 'non-blank value', 'orchestrator.local_preview needs a command (e.g. "npm start").', { required: true, present: 'set' }),
  entry('orchestrator.supervisor.on_call', WORKFLOW, 'boolean', 'orchestrator.supervisor.on_call must be true or false.'),
  amount('max_cost_usd', 'orchestrator.supervisor.max_cost_usd must be a number of US$ (0 or more).'),
  amount('stall.same_output', 'orchestrator.supervisor.stall.same_output must be a number (0 = off).'),
  amount('stall.slow_factor', 'orchestrator.supervisor.stall.slow_factor must be a number (0 = off).'),
];

// The scopes the loader walks: an entry's path inside the object it checks
const SCOPES = ['steps[].transitions[].', 'steps[].', 'agents.*.'];
const localPath = (field) => {
  const scope = SCOPES.find((p) => field.startsWith(p)) || '';
  return field.slice(scope.length).split('.');
};
const valueAt = (obj, keys) => keys.reduce((o, k) => (o == null ? undefined : o[k]), obj);
const PRESENT = {
  defined: (v) => v !== undefined,
  set: (v) => v != null,
  truthy: (v) => Boolean(v),
};
const appliesHere = (appliesTo, type) => (Array.isArray(appliesTo) ? appliesTo.includes(type)
  : typeof appliesTo === 'object' ? !appliesTo.except.includes(type) : true);
const isTemplate = (v) => typeof v === 'string' && v.includes('{{');

// The interpreter: one entry on the object of its scope (the workflow, an agent, a step, a
// transition); ctx: { prefix, type } (the error's prefix, the step's type)
function checkField(rule, obj, ctx = {}) {
  const keys = localPath(rule.field);
  const present = PRESENT[rule.present || 'defined'];
  // a required field is checked when its parent is set, another one when it is set itself
  const gate = rule.required ? (keys.length > 1 ? valueAt(obj, keys.slice(0, -1)) : obj) : valueAt(obj, keys);
  if (!present(gate)) return;
  const here = appliesHere(rule.appliesTo, ctx.type);
  if (!here && rule.elsewhere === 'skip') return;
  const value = valueAt(obj, keys);
  const fail = (message) => { throw new Error(`${ctx.prefix || ''}${message.replace('{type}', ctx.type)}`); };
  if (rule.required && !value) fail(rule.message);
  if (!(rule.template && isTemplate(value)) && !TYPES[rule.type](value, rule)) fail(rule.message);
  if (!here) fail(rule.placeMessage || rule.message);
}

// A loader's sequence: a name (an entry's path after `prefix`: every entry of that field, in table
// order) or a named rule (a function); an unknown name throws when the loader loads
function resolveChecks(prefix, checks) {
  return checks.map((c) => {
    if (typeof c === 'function') return c;
    const rules = FIELD_RULES.filter((r) => r.field === `${prefix}${c}`);
    if (!rules.length) throw new Error(`No field rule for ${prefix}${c}.`);
    return (obj, ctx) => { for (const r of rules) checkField(r, obj, ctx); };
  });
}

const runChecks = (checks, obj, ctx) => { for (const check of checks) check(obj, ctx); };

// The field reference (docs/agents/engine/field-reference.md, written by `npm run docs`)
const appliesText = (a) => (Array.isArray(a) ? a.join(', ')
  : typeof a === 'object' ? (a === AGENT_STEPS ? 'agent steps' : `all except ${a.except.join(', ')}`)
    : a === 'all' ? 'all steps' : a);
const where = (r) => (typeof r.appliesTo === 'string' ? appliesText(r.appliesTo)
  : `${appliesText(r.appliesTo)} (${r.elsewhere === 'skip' ? 'ignored' : 'an error'} elsewhere)`);
const cell = (s) => String(s).replace(/\|/g, '\\|');

function fieldReference() {
  const rows = FIELD_RULES.map((r) => [
    `\`${r.field}\``,
    where(r),
    r.type === 'one of' ? `one of ${/** @type {string[]} */ (r.values).join(', ')}` : r.type,
    r.template ? 'yes' : '',
    r.required ? 'yes' : '',
    r.placeMessage ? `${r.message} / ${r.placeMessage}` : r.message,
  ].map(cell));
  return [
    '# Workflow field reference',
    '',
    '<!-- Generated by `npm run docs` from FIELD_RULES (src/engine/run/field-rules.js): edit the table, not this file. -->',
    '',
    'Every field the workflow loader checks on its own (#352). Rules across fields (references between',
    'steps, agents, transitions and groups) are the named rules of `src/engine/run/load.js`, whose check',
    'sequences also give the order errors are reported in. Template: a `{{ … }}` text skips the type check.',
    'Required: needed when its parent is set.',
    '',
    '| Field | Applies to | Type | Template | Required | Message |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
  ].join('\n');
}

module.exports = {
  checkField,
  END_STATUSES,
  FIELD_RULES,
  fieldReference,
  GATE_KINDS,
  MACHINE_STEP_TYPES,
  parseDuration,
  parseRequests,
  parseTokens,
  PROJECT_MAP_ACTIONS,
  resolveChecks,
  runChecks,
  SESSION_MODES,
};
