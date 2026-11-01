// #630 (spec R8): the ways-of-working profile revisited (packages/engine/domains/workflow/workflow-compose.js).
// Acceptance tests, written before the code.
//
// Spec (the interface these tests assume):
// - PROFILE_FIELDS drops `team` and gains mode (local | remote), ci (none | release | pr+release), tests
//   (unit | unit+e2e) and e2eCommand, keeping release, testCommand, checkCommand and languages;
// - openQuestions never asks solo or team;
// - composeWorkflowSet builds the set from the new workflows: names include feature, fix and release (none
//   named solo or team); settings carries mode, ci and e2eCommand, and no `team`.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/workflow/workflow-compose');

const FACTS = { languages: ['javascript'], skills: ['unit-test-writer-js'] };
const LOCAL = { mode: 'local', ci: 'none', tests: 'unit', release: 'per-merge', testCommand: 'npm test', checkCommand: null, languages: ['javascript'] };
const REMOTE = { ...LOCAL, mode: 'remote', ci: 'pr+release', tests: 'unit+e2e', e2eCommand: 'npx playwright test' };

const compose = (profile) => load().composeWorkflowSet({ profile, answers: {}, facts: FACTS });

test('#630 PROFILE_FIELDS drops team and has mode, ci, tests and e2eCommand', () => {
  const fields = [...load().PROFILE_FIELDS];
  assert.equal(fields.includes('team'), false, JSON.stringify(fields));
  const missing = ['mode', 'ci', 'tests', 'e2eCommand', 'release', 'testCommand', 'checkCommand', 'languages'].filter((f) => !fields.includes(f));
  assert.deepEqual(missing, []);
});

test('#630 openQuestions never asks solo or team', () => {
  for (const profile of [LOCAL, REMOTE, {}]) {
    const ids = load().openQuestions(profile).map((q) => q.id);
    assert.equal(ids.includes('team'), false, `the questions for ${JSON.stringify(profile)}: ${JSON.stringify(ids)}`);
  }
});

test('#630 a local profile composes feature, fix and release, none named solo or team', () => {
  const out = compose(LOCAL);
  const names = out.workflows.map((w) => String(w.name));
  const missing = ['feature', 'fix', 'release'].filter((n) => !names.includes(n));
  assert.deepEqual(missing, [], `the set: ${JSON.stringify(names)}`);
  assert.deepEqual(names.filter((n) => /solo|team/.test(n)), []);
});

test('#630 a local profile\'s settings say mode local and carry no team', () => {
  const { settings } = compose(LOCAL);
  assert.equal(settings.mode, 'local');
  assert.equal('team' in settings, false, `the settings' keys: ${JSON.stringify(Object.keys(settings))}`);
});

test('#630 a remote profile composes feature, fix and release, none named solo or team', () => {
  const names = compose(REMOTE).workflows.map((w) => String(w.name));
  const missing = ['feature', 'fix', 'release'].filter((n) => !names.includes(n));
  assert.deepEqual(missing, [], `the set: ${JSON.stringify(names)}`);
  assert.deepEqual(names.filter((n) => /solo|team/.test(n)), []);
});

test('#630 a remote profile\'s settings carry mode, ci and the E2E command, and no team', () => {
  const { settings } = compose(REMOTE);
  assert.deepEqual([settings.mode, settings.ci, settings.e2eCommand], ['remote', 'pr+release', 'npx playwright test']);
  assert.equal('team' in settings, false, `the settings' keys: ${JSON.stringify(Object.keys(settings))}`);
});
