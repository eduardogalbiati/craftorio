// #785: what a Product Owner plan keeps of a group's inputs, and how the PO decides a recommendation.
// A saved item input outranks the project's run defaults (#735), so a group keeps only what was chosen:
// never a blank string, never a value equal to the one shown anyway (the project's run default when it
// has one, else the workflow's). The Cost step's inputs (#205) are set after this filter, on purpose.
// - chosenInputs(inputs, defs, runDefaults): that filter; an input the workflow does not declare stays.
// - groupInputs(model, owner, defs, runDefaults): a group's inputs: the model's through that filter, the
//   options the owner sent (they win) only against the workflow's defaults: they are the owner's choice.
// - reasonsField(raw): a group's `inputReasons` from the answer's `input_reasons`, the one-line reason of
//   each decision; a reason may outlive its input (one equal to the project's value is not stored).
// - runDefaultsSection(runDefaults, mode): a plan turn's prompt section on the project's configuration.
// - turnMode(mode, ...): what an 'auto' question (the drawer) is before the turn: a draft still open is
//   revised ('issue'); simulated, the scenario or the message tells; else it stays 'auto'.
// - autoTurn(plan, issue): the real 'auto' turn: the plan's and the issue's rules, an answer of either
//   shape, `intent` saying which (no intent is a plan).

const { shownDefault } = require('../project/project-run-defaults');

const REGISTER = /regist(rar|re|er)|file an issue/i;
// what the prompt names of the project's run defaults, in this order
const PROMPT_KEYS = ['kind', 'variant', 'mode', 'test_order', 'language', 'e2e_tests', 'screenshots', 'test_command', 'check_command', 'e2e_command'];

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
// a list and its comma-separated text, a boolean and its word, are one value
const comparable = (v) => (Array.isArray(v) ? v.join(',') : String(v ?? ''));

/** The inputs worth saving (see the header). `defs`: the workflow's inputs; `runDefaults`: the project's, or null. */
function chosenInputs(inputs, defs = {}, runDefaults = null) {
  const out = {};
  for (const [k, v] of Object.entries(inputs || {})) {
    if (isBlank(v)) continue;
    if (defs?.[k] && comparable(v) === comparable(shownDefault(k, defs[k], runDefaults))) continue;
    out[k] = v;
  }
  return out;
}

/** A group's inputs from the model's and the owner's (see the header). */
function groupInputs(model, owner, defs, runDefaults) {
  const fromModel = Object.fromEntries(Object.entries(model).filter(([k]) => !(k in owner)));
  return { ...chosenInputs(fromModel, defs, runDefaults), ...chosenInputs(owner, defs) };
}

/** The answer's `input_reasons` as a group's field: { inputReasons: { key: non-empty line } }, or {} with none. */
function reasonsField(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const reasons = Object.entries(raw).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim()]);
  return reasons.length ? { inputReasons: Object.fromEntries(reasons) } : {};
}

/** The prompt's section on what a run of this project takes by itself; '' without run defaults or outside a plan. */
function runDefaultsSection(runDefaults, mode = 'plan') {
  if (!runDefaults || !['auto', 'plan'].includes(mode)) return '';
  const rows = PROMPT_KEYS.filter((k) => !isBlank(runDefaults[k])).map((k) => `- ${k}: ${runDefaults[k]}`);
  return [
    '## The project\'s run defaults',
    'A run of this project takes these values by itself (`variant`: Fork + PR, remote or local, code or E2E first, as the owner set it up; `kind`: backend has no UI, E2E or screenshots):',
    ...rows,
    'Deduce each group\'s workflow and inputs from its issues and these values. Put in a group\'s `inputs` only what must differ from them; give the reason of each decision that matters in `input_reasons`, in one short line.',
  ].join('\n');
}

const INTENT_RULE = 'Decide from the owner\'s message what they want and say it in `intent`: `register` when they report a problem or describe one piece of work to file as an issue (answer with the fields of the issue rules below: `reply`, `questions`, `draft`...), `plan` for anything about the backlog, its order or its issues (answer with the plan\'s fields: `summary`, `groups`...). Follow only the rules of that intent.';

/** The mode of a turn (see the header); `scenarioMode`: the mode of the simulated scenario forced, if any. */
function turnMode(mode, { draftOpen, mock, scenarioMode, question }) {
  if (mode !== 'auto') return mode;
  if (draftOpen) return 'issue';
  if (!mock) return 'auto';
  return scenarioMode ?? (REGISTER.test(String(question || '')) ? 'issue' : 'plan');
}

/** The turn of a real 'auto' question, from the plan's and the issue's (see the header). */
function autoTurn(plan, issue) {
  return {
    ...plan,
    skills: [...plan.skills, ...issue.skills],
    rules: [plan.rules, INTENT_RULE, issue.rules].join('\n'),
    schema: { type: 'object', required: [], properties: { intent: { type: 'string', enum: ['plan', 'register'] }, ...plan.schema.properties, ...issue.schema.properties } },
  };
}

module.exports = {
  autoTurn,
  chosenInputs,
  groupInputs,
  reasonsField,
  runDefaultsSection,
  turnMode,
};
