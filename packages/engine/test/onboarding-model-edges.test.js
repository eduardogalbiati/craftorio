// #638 edges of the onboarding's pure model beyond the acceptance tests (onboarding-model.test.js):
// the steps' needs, an unknown step, skipAnalysis outside the analysis step, the E2E and CI rules
// of the suggestions in both modes, a partly valid profile, and the cost's rounding and strict numbers.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STEPS, back, canGoNext, costSummary, initialState, next, skipAnalysis, suggestWorkflows,
} = require('@craftorio/shared/onboarding-model');
const I18n = require('@craftorio/shared/i18n');

const ids = (r) => r.suggestions.map((s) => s.id);
const filled = { ...initialState(), source: 'import', repository: 'owner/repo', name: 'Repo' };

// ---------------------------------------------------------------------------
// Steps and state
// ---------------------------------------------------------------------------
test('each step says what it needs to go on: a source, then a repository and a name, then nothing', () => {
  assert.deepEqual(STEPS.map((s) => [s.id, s.needs]), [
    ['start', ['source']],
    ['repository', ['repository', 'name']],
    ['analysis', []],
    ['review', []],
  ]);
});

test('a project name of blanks does not count as filled in', () => {
  assert.equal(canGoNext({ ...filled, step: 'repository', name: '   ' }), false);
});

test('the review is the last step: it never goes on', () => {
  assert.equal(canGoNext({ ...filled, step: 'review' }), false);
});

test('an unknown step is treated as the Start step', () => {
  const s = { ...filled, step: 'somewhere' };
  assert.equal(back(s).step, 'start');
  assert.equal(next(s).step, 'repository');
  assert.equal(canGoNext({ ...s, source: null }), false);
});

test('"Skip, analyze later" outside the analysis step changes nothing', () => {
  for (const step of ['start', 'repository', 'review']) {
    const s = { ...filled, step };
    const out = skipAnalysis(s);
    assert.equal(out.step, step);
    assert.equal(out.analyzeLater, false);
    assert.equal(out === s, false, 'a new object');
  }
});

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------
const valueOf = (p, id) => suggestWorkflows(p).suggestions.find((s) => s.id === id).value;

test('a profile with unit and end-to-end tests gets feature and fix in their E2E variant, in both modes', () => {
  for (const mode of ['local', 'remote']) {
    for (const ci of ['none', 'release', 'pr+release']) {
      const p = { mode, ci, tests: 'unit+e2e' };
      assert.equal(valueOf(p, 'feature'), `${mode}-e2e`, JSON.stringify(p));
      assert.equal(valueOf(p, 'fix'), `${mode}-e2e`, JSON.stringify(p));
    }
  }
});

test('a profile with unit tests only gets the code-first variant (implement, then unit tests)', () => {
  for (const mode of ['local', 'remote']) {
    for (const ci of ['none', 'release', 'pr+release']) {
      const p = { mode, ci, tests: 'unit' };
      assert.equal(valueOf(p, 'feature'), `${mode}-code`, JSON.stringify(p));
    }
  }
});

test('every profile gets feature, fix and release; the release reason says whether a CI run is waited for', () => {
  for (const mode of ['local', 'remote']) {
    for (const tests of ['unit', 'unit+e2e']) {
      // #726: the reason is an i18n key, its English text here
      const reason = (ci) => I18n.t(suggestWorkflows({ mode, ci, tests }).suggestions.find((s) => s.id === 'release').reason.key, undefined, 'en');
      for (const ci of ['none', 'release', 'pr+release']) assert.deepEqual(ids(suggestWorkflows({ mode, ci, tests })), ['feature', 'fix', 'release']);
      assert.match(reason('release'), /waits for that CI run/, `${mode} ${tests} release`);
      assert.match(reason('pr+release'), /waits for that CI run/, `${mode} ${tests} pr+release`);
      assert.doesNotMatch(reason('none'), /waits/, `${mode} ${tests} none`);
    }
  }
});

test('a profile with one invalid field gets the default profile\'s suggestions and says so', () => {
  for (const p of [
    { mode: 'local', ci: 'none' },
    { mode: 'local', ci: 'nightly', tests: 'unit' },
    { mode: 'remote', ci: 'release', tests: 'e2e' },
  ]) {
    const r = suggestWorkflows(p);
    assert.equal(r.defaulted, true, JSON.stringify(p));
    assert.deepEqual(ids(r), ['feature', 'fix', 'release'], JSON.stringify(p));
    assert.equal(valueOf(p, 'feature'), 'local-code', JSON.stringify(p));
  }
});

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------
test('the total drops the float noise: 0.1 + 0.2 is 0.3', () => {
  const r = costSummary([{ id: 'a', estimate: 0.1, checked: true }, { id: 'b', estimate: 0.2, checked: true }]);
  assert.equal(r.total, 0.3);
});

test('a tiny cost is not rounded down to $0', () => {
  assert.equal(costSummary([{ id: 'a', estimate: 0.000001, checked: true }]).total, 0.000001);
});

test('a free analysis (estimate 0) is known, not unknown', () => {
  const r = costSummary([{ id: 'facts', estimate: 0, checked: true }]);
  assert.equal(r.total, 0);
  assert.deepEqual(r.unknown, []);
});

test('an estimate given as a string is unknown, never coerced', () => {
  const r = costSummary([{ id: 'project-map', estimate: '1.25', checked: true }, { id: 'b', estimate: 2, checked: true }]);
  assert.equal(r.total, 2);
  assert.deepEqual(r.parts, [{ id: 'project-map', estimate: null }, { id: 'b', estimate: 2 }]);
  assert.deepEqual(r.unknown, ['project-map']);
});

test('no list of analyses costs nothing', () => {
  assert.deepEqual(costSummary(undefined), { total: 0, parts: [], unknown: [] });
});
