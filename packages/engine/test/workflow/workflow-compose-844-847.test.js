// #844 / #847 acceptance, written before the code: packages/engine/domains/workflow/workflow-compose.js
// openQuestions and the composition invent no test style, default the release style as the wizard does,
// and carry no English prose (the panel takes its labels from i18n).
//
// Spec (the interface these tests assume):
// - #844 a profile with no test command and its tests unset: no question defaults to 'unit' and the
//   composed settings' tests is not 'unit' (an open question or 'none');
// - #844 the release question's default is the release the wizard suggests for the same profile
//   (packages/shared/onboarding-model.js suggestWorkflows: 'milestone' when nothing settles it), local or remote;
// - #847 the questions carry ids and i18n keys, never English prose: every label, question and option
//   label they hold is a key present in both packages/shared/i18n/en.json and pt-BR.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const EN = require('@multiagent/shared/i18n/en.json');
const PT = require('@multiagent/shared/i18n/pt-BR.json');
const OnboardingModel = require('@multiagent/shared/onboarding-model');

const load = () => require('../../domains/workflow/workflow-compose');

// the imported repository of #844: no test command, no test file, no CI, the tests left unset
const NO_TESTS = { mode: 'local', ci: 'none', tests: null, release: null, testCommand: null, checkCommand: null, e2eCommand: null, languages: ['python'] };

// today's English prose of the questions (#847): none may stay in what the engine answers
const ENGLISH = [
  'Validate every round', 'Approve every change before it lands', 'The most one issue may spend on models',
  'Capture the screens a change touches', 'Trust auto', 'How hard the code review is', 'Light: one round',
  'Budget per issue', 'Review rigour', 'Release style', 'How the project releases',
];

test('#844 no test command and the tests unset: no open question defaults to unit tests', () => {
  const qs = load().openQuestions(NO_TESTS);
  const unit = qs.filter((q) => q.default === 'unit' || q.default === 'unit+e2e').map((q) => q.id);
  assert.deepEqual(unit, [], `questions defaulting to unit: ${JSON.stringify(unit)}`);
});

test('#844 no test command and the tests unset: the composed set does not settle on unit tests', () => {
  const { settings } = load().composeWorkflowSet({ profile: NO_TESTS, answers: {}, facts: { languages: ['python'], skills: [] } });
  assert.notEqual(settings.tests, 'unit', `settings.tests: ${JSON.stringify(settings.tests)}`);
  assert.notEqual(settings.tests, 'unit+e2e', `settings.tests: ${JSON.stringify(settings.tests)}`);
});

test('#844 the release question defaults to the release the wizard suggests, local or remote', () => {
  for (const mode of ['local', 'remote']) {
    const profile = { ...NO_TESTS, mode, release: null };
    const asked = load().openQuestions(profile).find((q) => q.id === 'release');
    assert.ok(asked, `${mode}: no release style settled, so it is asked`);
    const wizard = OnboardingModel.suggestWorkflows(profile).suggestions.find((s) => s.id === 'release').value;
    assert.equal(asked.default, wizard, `${mode}: the question's default ${asked.default}, the wizard's ${wizard}`);
  }
});

test('#847 the open questions carry no English prose', () => {
  const text = JSON.stringify(load().openQuestions({}));
  const found = ENGLISH.filter((s) => text.includes(s));
  assert.deepEqual(found, [], 'English text in openQuestions({})');
});

test('#847 every label, question and option label of the open questions is an i18n key in en.json and pt-BR.json', () => {
  const texts = [];
  for (const q of load().openQuestions({})) {
    for (const v of [q.label, q.question]) if (v != null) texts.push([q.id, v]);
    for (const o of q.options || []) if (o.label != null) texts.push([`${q.id}.${o.value}`, o.label]);
  }
  const notKeys = texts.filter(([, v]) => typeof v !== 'string' || !(v in EN) || !(v in PT)).map(([where, v]) => `${where}: ${JSON.stringify(v)}`);
  assert.deepEqual(notKeys, [], 'texts that are not keys of both catalogs');
});
