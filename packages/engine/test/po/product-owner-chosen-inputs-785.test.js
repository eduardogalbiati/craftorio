// #785: a Product Owner plan keeps only the inputs the model or the owner chose, the PO decides from
// the owner's message whether it plans or registers an issue, and each recommendation comes with a
// one-line reason per input. Acceptance tests written before the code.
// Seams: productOwner.normalizeAnswer, costInputs, ANSWER_SCHEMA and ask (simulated, or with the model
// stubbed at providers.runTurn). Contract the developer provides (chosen here):
// - normalizeAnswer and ask take `runDefaults` (the project's run defaults, what projectRunDefaults
//   gives): a value equal to the shown default (the project's, else the workflow's) is not kept in a
//   group's `inputs`; a value that differs from it is, even when it is the workflow's own default;
// - a group of the raw answer may carry `input_reasons` ({ key: 'one line' }): the normalized group
//   keeps them as `inputReasons`, also for a key left out of `inputs`;
// - ask's `mode: 'auto'` (the drawer, no toggle): the model's answer says `intent` ('plan' | 'register');
//   an explicit 'plan' or 'issue' stays what it is. `intent` is optional: no intent is a plan.
process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const productOwner = require('../../domains/po/product-owner');
const poCalibration = require('@craftorio/shared/po-calibration');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const FEATURE = (() => {
  const doc = yaml.load(fs.readFileSync(path.join(ROOT, 'workflows', 'feature.yaml'), 'utf8'));
  return { file: 'feature.yaml', name: doc.metadata.name, inputs: doc.inputs };
})();
// a code-first workflow: the Cost step applies to it (feature.yaml is tests first)
const CUSTOM = {
  file: 'custom-dev.yaml',
  name: 'custom-dev',
  inputs: {
    task: { type: 'string' },
    mode: { enum: ['local', 'remote', 'fork'], default: 'local' },
    unit_tests: { enum: ['write_and_run', 'run_existing', 'off'], default: 'write_and_run' },
    e2e_tests: { enum: ['off', 'write', 'write_and_run'], default: 'write_and_run' },
    screenshots: { enum: ['off', 'changed', 'all'], default: 'changed' },
  },
};
const ISSUES = [{ number: 1, state: 'open', title: 'Login page', labels: [{ name: 'complexity:2' }], body: 'x'.repeat(200) }];
const GENEROUS = 5;
const BALANCED = 3;
const RUN_DEFAULTS = { kind: 'backend', variant: 'fork-code', mode: 'fork', test_order: 'code_first', language: 'rust', test_command: 'cargo test', check_command: '', e2e_tests: 'off', e2e_command: '', ui_folders: [], screenshots: 'off', steps_folders: [] };

const group = (extra = {}) => ({ name: 'One', issues: [1], workflow: 'feature.yaml', reason: 'r', stage: 1, ...extra });
const normalized = (raw, opts = {}) => productOwner.normalizeAnswer({ summary: 'ok', groups: [raw], conflicts: [], enrich: [] }, { issues: ISSUES, history: [], workflows: [FEATURE, CUSTOM], ...opts }).groups[0];

function tmp(t, prefix = 'po-785-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// the model's turn stubbed at the system boundary; `answer` carries the fields of both answer schemas,
// so it validates whichever schema the turn asks for
function stubModel(t, answer) {
  const providers = require('../../engine/providers');
  const original = providers.runTurn;
  t.after(() => { providers.runTurn = original; });
  const turns = [];
  providers.runTurn = async ({ prompt, hint }) => {
    turns.push({ prompt, schema: hint?.schema });
    return { text: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``, costUsd: 0, usage: {} };
  };
  return turns;
}
const modelAnswer = (extra = {}) => ({
  summary: 'The plan.', groups: [], conflicts: [], enrich: [],
  reply: 'Here is the draft.', questions: [], draft: { title: 'Save fails with an accent', body: '## Tasks\n- [ ] Save works', labels: [], related: [] },
  duplicates: [], existing_issue: 0, addition: '', assumptions: [], ...extra,
});
const askOptions = (t, extra = {}) => ({
  backlogDir: tmp(t), runsDir: tmp(t), folder: tmp(t), projectId: 'demo', data: { projectId: 'demo', issues: ISSUES }, activeRuns: [], runs: [], workflows: [FEATURE],
  skillsDirs: [path.join(ROOT, 'skills')], resolveCommand: () => 'claude', agent: { model: 'claude-opus-5-5', effort: 'high' }, mock: false, ...extra,
});
const AMBIGUOUS = 'O botão Salvar quebra quando o nome tem acento';

// ---- a plan keeps only what was chosen ----------------------------------------------------------

test('#785 a group whose model set no inputs, with no option from the owner, has no inputs', () => {
  assert.deepEqual({ ...normalized(group(), { workflow: 'feature.yaml', inputs: null }).inputs }, {});
});

test('#785 an option the owner changed is the only key of the group\'s inputs', () => {
  assert.deepEqual({ ...normalized(group(), { workflow: 'feature.yaml', inputs: { e2e_tests: 'off' } }).inputs }, { e2e_tests: 'off' });
});

// #80: the UI and step definition folders default to empty lists (no src/renderer/ nor features/steps)
test('#785 a group that repeats the workflow\'s defaults keeps none of them (the full set of the owner\'s report)', () => {
  const inputs = {
    mode: 'local', test_order: 'e2e_first', e2e_tests: 'write_and_run', screenshots: 'changed', validate_every_round: false,
    ui_folders: [], steps_folders: [], developer_effort: 'default',
  };
  assert.deepEqual({ ...normalized(group({ inputs })).inputs }, {});
});

test('#785 an option sent equal to the workflow\'s default is not kept in the group', () => {
  assert.deepEqual({ ...normalized(group(), { workflow: 'feature.yaml', inputs: { mode: 'local', unit_tests: 'off' } }).inputs }, { unit_tests: 'off' });
});

test('#785 empty strings are never kept, from the model or from the owner\'s options', () => {
  const out = normalized(group({ inputs: { test_command: '', e2e_command: '  ', mode: 'fork' } }), { workflow: 'feature.yaml', inputs: { check_command: '' } });
  assert.deepEqual({ ...out.inputs }, { mode: 'fork' });
});

test('#785 a value equal to the project\'s run default is not kept: it reaches the run from the project', () => {
  assert.deepEqual({ ...normalized(group({ inputs: { mode: 'fork', e2e_tests: 'off', unit_tests: 'off' } }), { runDefaults: RUN_DEFAULTS }).inputs }, { unit_tests: 'off' });
});

test('#785 a workflow default that differs from the project\'s run default is a choice and is kept', () => {
  assert.deepEqual({ ...normalized(group({ inputs: { e2e_tests: 'write_and_run' } }), { runDefaults: RUN_DEFAULTS }).inputs }, { e2e_tests: 'write_and_run' });
});

test('#785 the Cost step\'s keys set on purpose are kept, even at the workflow\'s defaults (#205)', () => {
  const out = normalized(group({ workflow: 'custom-dev.yaml' }), { cost: GENEROUS });
  assert.deepEqual({ ...out.inputs }, { unit_tests: 'write_and_run', e2e_tests: 'write_and_run', screenshots: 'all' });
});

test('#785 costInputs sets only the Cost step\'s keys, never another input\'s default', () => {
  const out = productOwner.costInputs({ workflow: 'custom-dev.yaml', inputs: {} }, poCalibration.cost.step(BALANCED), [CUSTOM]);
  assert.deepEqual({ ...out.inputs }, { unit_tests: 'write_and_run', e2e_tests: 'write', screenshots: 'changed' });
});

// ---- the PO deduces each recommendation -----------------------------------------------------------

test('#785 the answer schema lets each group give a reason per input (input_reasons)', () => {
  assert.equal(productOwner.ANSWER_SCHEMA.properties.groups.items.properties.input_reasons?.type, 'object');
});

test('#785 a normalized group keeps the workflow the PO chose, its inputs and the reason of each input', () => {
  const out = normalized(group({ workflow: 'custom-dev.yaml', inputs: { unit_tests: 'off' }, input_reasons: { unit_tests: 'Sem suíte no projeto' } }));
  assert.deepEqual([out.workflow, { ...out.inputs }, { ...out.inputReasons }], ['custom-dev.yaml', { unit_tests: 'off' }, { unit_tests: 'Sem suíte no projeto' }]);
});

test('#785 a reason outlives its input: the decision equal to the project\'s value is not stored, its reason is shown', () => {
  const out = normalized(group({ inputs: { e2e_tests: 'off' }, input_reasons: { e2e_tests: 'E2E off: projeto backend sem UI' } }), { runDefaults: RUN_DEFAULTS });
  assert.deepEqual([{ ...out.inputs }, out.inputReasons?.e2e_tests], [{}, 'E2E off: projeto backend sem UI']);
});

test('#785 the plan\'s prompt names the project\'s run defaults and its variant', async (t) => {
  const turns = stubModel(t, modelAnswer());
  await productOwner.ask(askOptions(t, { question: 'Analyze the backlog', mode: 'plan', runDefaults: RUN_DEFAULTS }));
  assert.deepEqual(['fork-code', 'code_first', 'backend'].filter((word) => !turns[0].prompt.includes(word)), []);
});

test('#785 ask applies the project\'s run defaults to the model\'s groups', async (t) => {
  stubModel(t, modelAnswer({ groups: [group({ inputs: { mode: 'fork', e2e_tests: 'off', unit_tests: 'run_existing' } })] }));
  const out = await productOwner.ask(askOptions(t, { question: 'Analyze the backlog', mode: 'plan', runDefaults: RUN_DEFAULTS }));
  assert.deepEqual({ ...out.message.answer.groups[0].inputs }, { unit_tests: 'run_existing' });
});

// ---- the PO decides the intent ---------------------------------------------------------------------

test('#785 mode auto: the turn\'s answer schema offers the intent, plan or register', async (t) => {
  const turns = stubModel(t, modelAnswer({ intent: 'plan' }));
  await productOwner.ask(askOptions(t, { question: AMBIGUOUS, mode: 'auto' }));
  assert.deepEqual([...(turns[0].schema?.properties?.intent?.enum || [])].sort(), ['plan', 'register']);
});

test('#785 mode auto: the turn\'s prompt carries the owner\'s message', async (t) => {
  const turns = stubModel(t, modelAnswer({ intent: 'plan' }));
  await productOwner.ask(askOptions(t, { question: AMBIGUOUS, mode: 'auto' }));
  assert.equal(turns[0].prompt.includes(AMBIGUOUS), true);
});

test('#785 mode auto: an answer with the register intent registers: the message is an issue draft', async (t) => {
  stubModel(t, modelAnswer({ intent: 'register' }));
  const { message } = await productOwner.ask(askOptions(t, { question: AMBIGUOUS, mode: 'auto' }));
  assert.deepEqual([message.mode, message.issue?.draft?.title, message.answer ?? null], ['issue', 'Save fails with an accent', null]);
});

test('#785 mode auto: an answer with the plan intent is a plan with its groups', async (t) => {
  stubModel(t, modelAnswer({ intent: 'plan', groups: [group()] }));
  const { message } = await productOwner.ask(askOptions(t, { question: 'Analisar o backlog e propor runs', mode: 'auto' }));
  assert.deepEqual([message.mode === 'issue', message.answer?.groups?.length], [false, 1]);
});

test('#785 mode auto: an answer without an intent is a plan', async (t) => {
  stubModel(t, modelAnswer({ groups: [group()] }));
  const { message } = await productOwner.ask(askOptions(t, { question: 'Analisar o backlog e propor runs', mode: 'auto' }));
  assert.deepEqual([message.invalid ?? null, message.answer?.groups?.length], [null, 1]);
});

test('#785 mode auto, simulated: a message asking to register an issue registers', async (t) => {
  const { message } = await productOwner.ask(askOptions(t, { question: 'Registrar uma issue: o botão Salvar quebra', mode: 'auto', mock: true }));
  assert.deepEqual([message.mode, !!message.issue, message.answer ?? null], ['issue', true, null]);
});

test('#785 mode auto, simulated: a question about the backlog plans', async (t) => {
  const { message } = await productOwner.ask(askOptions(t, { question: 'Analisar o backlog e propor runs', mode: 'auto', mock: true }));
  assert.deepEqual([message.mode === 'issue', Array.isArray(message.answer?.groups)], [false, true]);
});

test('#785 mode auto: with a draft still open, the owner\'s next message revises that draft', async (t) => {
  const options = askOptions(t, { mock: true });
  await productOwner.ask({ ...options, question: 'O botão Salvar quebra', mode: 'issue', scenario: 'draft' });
  const { message } = await productOwner.ask({ ...options, question: 'Inclua também o nome vazio', mode: 'auto' });
  assert.equal(message.mode, 'issue');
});
