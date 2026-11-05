// #785: the internals of po-chosen-inputs.js the acceptance tests reach only through ask: which mode an
// 'auto' question takes before the turn, the owner's options over the model's, and when the prompt names
// the project's run defaults.
const test = require('node:test');
const assert = require('node:assert/strict');
const { chosenInputs, groupInputs, runDefaultsSection, turnMode } = require('../../domains/po/po-chosen-inputs');

const DEFS = { mode: { enum: ['local', 'fork'], default: 'local' }, ui_folders: { type: 'array', default: ['src/renderer/'] }, flag: { type: 'boolean', default: false } };
const auto = (extra = {}) => turnMode('auto', { draftOpen: false, mock: false, scenarioMode: undefined, question: 'x', ...extra });

test('#785 turnMode: an explicit mode stays what it is', () => {
  assert.deepEqual(['plan', 'issue'].map((m) => turnMode(m, { draftOpen: true, mock: true, question: 'Register' })), ['plan', 'issue']);
});

test('#785 turnMode: a real auto question stays auto until the answer says', () => {
  assert.equal(auto(), 'auto');
});

test('#785 turnMode: a draft still open is revised, simulated or not', () => {
  assert.deepEqual([auto({ draftOpen: true }), auto({ draftOpen: true, mock: true })], ['issue', 'issue']);
});

test('#785 turnMode: simulated, a forced scenario wins over the message', () => {
  assert.equal(auto({ mock: true, scenarioMode: 'plan', question: 'Register an issue' }), 'plan');
});

test('#785 turnMode: simulated, the words of the message decide, in either language', () => {
  assert.deepEqual(['Registrar uma issue', 'Register an issue', 'File an issue', 'Montar um roadmap'].map((question) => auto({ mock: true, question })), ['issue', 'issue', 'issue', 'plan']);
});

test('#785 groupInputs: an option the owner sent wins over the model\'s value for that key, even at the workflow\'s default', () => {
  assert.deepEqual(groupInputs({ mode: 'fork' }, { mode: 'local' }, DEFS, null), {});
});

test('#785 groupInputs: an owner\'s option equal to the project\'s value stays: only the workflow\'s default is dropped', () => {
  assert.deepEqual(groupInputs({}, { mode: 'fork' }, DEFS, { mode: 'fork' }), { mode: 'fork' });
});

test('#785 chosenInputs: a list and its text, a boolean and its word, are one value', () => {
  assert.deepEqual(chosenInputs({ ui_folders: 'src/renderer/', flag: 'false' }, DEFS), {});
});

test('#785 chosenInputs: an input the workflow does not declare stays, a blank one never', () => {
  assert.deepEqual(chosenInputs({ other: 'x', blank: ' ' }, DEFS), { other: 'x' });
});

test('#785 runDefaultsSection: only a plan or auto turn names the run defaults', () => {
  const section = (mode) => runDefaultsSection({ kind: 'backend' }, mode).includes('backend');
  assert.deepEqual(['plan', 'auto', 'issue', 'commit'].map(section), [true, true, false, false]);
});

test('#785 runDefaultsSection: nothing without run defaults', () => {
  assert.equal(runDefaultsSection(null), '');
});
