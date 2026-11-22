// #638 acceptance tests of the onboarding's pure model (packages/shared/onboarding-model.js, spec
// R1, R3, R5, R7 of docs/work/first-project-onboarding/spec.md), written before the code.
// The public interface these tests fix:
// - STEPS: the wizard's 4 steps in order, [{ id }]: 'start', 'repository', 'analysis', 'review';
// - initialState(): { step: 'start', ... }; a state is a plain object the wizard fills
//   (start needs `source`, repository needs `repository` and `name`);
// - canGoNext(state), next(state), back(state), skipAnalysis(state): pure moves, never mutating
//   the given state; skipAnalysis ("Skip, analyze later") goes from analysis to review with
//   analyzeLater: true;
// - suggestWorkflows(profile): { suggestions: [{ id, reason }], defaulted } for a profile
//   { mode: 'local' | 'remote', ci: 'none' | 'release' | 'pr+release', tests: 'unit' | 'unit+e2e' };
// - costSummary(analyses): { total, parts: [{ id, estimate }], unknown: [id] } for
//   [{ id, estimate, checked }] (estimate in USD, missing = unknown, never $0);
// - dual-load: module.exports in Node, window.OnboardingModel in the renderer.
// The module does not exist before the change: it is loaded inside each test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', '..', 'shared', 'onboarding-model.js');
const load = () => require('@craftorio/shared/onboarding-model');

// the workflows bundled today (workflows/*.yaml): the wizard suggests only among these (#630:
// feature, fix and release replace the old development and release workflows; #631: analyze-project,
// test-backfill and retrospective)
const TODAY = [
  'ai-arena', 'analyze-project', 'backlog-refresh', 'feature', 'fix', 'issue-tracker',
  'refactor', 'release', 'retrospective', 'test-backfill', 'write-doc', 'writer-reviewer',
];
const DEFAULT = 'feature';
const ids = (r) => r.suggestions.map((s) => s.id);

// ---------------------------------------------------------------------------
// Steps and state (R1)
// ---------------------------------------------------------------------------
test('STEPS lists the wizard\'s four steps in order: Start, Repository, Analysis & workflows, Review', () => {
  const { STEPS } = load();
  assert.deepEqual(STEPS.map((s) => s.id), ['start', 'repository', 'analysis', 'review']);
});

test('the wizard starts on the Start step and cannot go on before a source is chosen', () => {
  const { initialState, canGoNext, next } = load();
  const s = initialState();
  assert.equal(s.step, 'start');
  assert.equal(canGoNext(s), false);
  assert.equal(next(s).step, 'start');
});

test('the Repository step needs both the repository and the project name to go on', () => {
  const { initialState, canGoNext, next } = load();
  const atRepo = next({ ...initialState(), source: 'import' });
  assert.equal(atRepo.step, 'repository');
  assert.equal(canGoNext({ ...atRepo, repository: 'owner/repo' }), false);
  assert.equal(canGoNext({ ...atRepo, name: 'Repo' }), false);
  assert.equal(canGoNext({ ...atRepo, repository: '', name: 'Repo' }), false);
  const filled = { ...atRepo, repository: 'owner/repo', name: 'Repo' };
  assert.equal(canGoNext(filled), true);
  assert.equal(next(filled).step, 'analysis');
});

test('next and back walk the four steps, back stops at Start and next stops at Review', () => {
  const { initialState, next, back } = load();
  let s = { ...initialState(), source: 'import', repository: 'owner/repo', name: 'Repo' };
  s = next(s); assert.equal(s.step, 'repository');
  s = next(s); assert.equal(s.step, 'analysis');
  s = next(s); assert.equal(s.step, 'review');
  assert.equal(next(s).step, 'review');
  s = back(s); assert.equal(s.step, 'analysis');
  s = back(s); assert.equal(s.step, 'repository');
  s = back(s); assert.equal(s.step, 'start');
  assert.equal(back(s).step, 'start');
  assert.equal(s.repository, 'owner/repo', 'going back keeps what was filled in');
});

test('"Skip, analyze later" goes from the analysis step to the review, marking the analyses for later', () => {
  const { initialState, skipAnalysis } = load();
  const s = skipAnalysis({ ...initialState(), source: 'import', repository: 'owner/repo', name: 'Repo', step: 'analysis' });
  assert.equal(s.step, 'review');
  assert.equal(s.analyzeLater, true);
});

test('the moves are pure: they return a new state and leave the given one unchanged', () => {
  const { initialState, next, back, skipAnalysis } = load();
  const s = { ...initialState(), source: 'import', repository: 'owner/repo', name: 'Repo', step: 'repository' };
  const before = JSON.stringify(s);
  next(s); back(s); skipAnalysis({ ...s, step: 'analysis' });
  assert.equal(JSON.stringify(s), before);
});

// ---------------------------------------------------------------------------
// Suggestions among today's workflows (R7)
// ---------------------------------------------------------------------------
const PROFILES = [];
for (const mode of ['local', 'remote']) {
  for (const ci of ['none', 'release', 'pr+release']) {
    for (const tests of ['unit', 'unit+e2e']) PROFILES.push({ mode, ci, tests });
  }
}

test('every local/remote x CI x tests profile gets suggestions among today\'s workflows, each with a reason', () => {
  const { suggestWorkflows } = load();
  for (const p of PROFILES) {
    const label = JSON.stringify(p);
    const r = suggestWorkflows(p);
    assert.equal(r.defaulted, false, label);
    assert.ok(r.suggestions.length > 0, label);
    assert.deepEqual(ids(r).filter((id) => !TODAY.includes(id)), [], `${label}: only today's workflows`);
    assert.equal(new Set(ids(r)).size, r.suggestions.length, `${label}: no workflow twice`);
    // #726: a reason is an i18n key ({ key, params })
    for (const s of r.suggestions) assert.ok(typeof s.reason?.key === 'string' && s.reason.key.startsWith('onboarding.'), `${label}: ${s.id} has a reason`);
  }
});

test('a local project gets feature first, in its local variant, whatever its CI and tests', () => {
  const { suggestWorkflows } = load();
  for (const p of PROFILES.filter((x) => x.mode === 'local')) {
    const first = suggestWorkflows(p).suggestions[0];
    assert.equal(first.id, DEFAULT, JSON.stringify(p));
    assert.match(first.value, /^local-/, JSON.stringify(p));
  }
});

test('a remote project is suggested feature in its pull-request (remote) variant', () => {
  const { suggestWorkflows } = load();
  for (const p of PROFILES.filter((x) => x.mode === 'remote')) {
    const feature = suggestWorkflows(p).suggestions.find((s) => s.id === 'feature');
    assert.match(feature.value, /^remote-/, JSON.stringify(p));
  }
});

test('the mode, the CI and the tests each change the suggestion', () => {
  const { suggestWorkflows } = load();
  const key = (p) => JSON.stringify(suggestWorkflows(p).suggestions);
  const base = { mode: 'local', ci: 'none', tests: 'unit' };
  assert.notEqual(key(base), key({ ...base, mode: 'remote' }), 'mode');
  assert.notEqual(key(base), key({ ...base, ci: 'pr+release' }), 'ci');
  assert.notEqual(key(base), key({ ...base, tests: 'unit+e2e' }), 'tests');
});

test('an empty or unknown profile suggests the default workflow and says so', () => {
  const { suggestWorkflows } = load();
  for (const p of [undefined, null, {}, { mode: 'cloud', ci: 'nightly', tests: 'manual' }]) {
    const label = JSON.stringify(p) ?? 'undefined';
    const r = suggestWorkflows(p);
    assert.equal(r.defaulted, true, label);
    assert.equal(ids(r)[0], DEFAULT, label);
    assert.ok(typeof r.suggestions[0].reason?.key === 'string' && r.suggestions[0].reason.key.startsWith('onboarding.'), label);
  }
});

// ---------------------------------------------------------------------------
// Cost before the click (R3, R5)
// ---------------------------------------------------------------------------
test('the cost sums the checked analyses into one total with its parts', () => {
  const { costSummary } = load();
  const r = costSummary([
    { id: 'project-map', estimate: 1.25, checked: true },
    { id: 'refactor-proposals', estimate: 0.5, checked: true },
  ]);
  assert.equal(r.total, 1.75);
  assert.deepEqual(r.parts, [{ id: 'project-map', estimate: 1.25 }, { id: 'refactor-proposals', estimate: 0.5 }]);
  assert.deepEqual(r.unknown, []);
});

test('an unchecked analysis is not part of the cost', () => {
  const { costSummary } = load();
  const r = costSummary([
    { id: 'project-map', estimate: 1.25, checked: true },
    { id: 'refactor-proposals', estimate: 0.5, checked: false },
  ]);
  assert.equal(r.total, 1.25);
  assert.deepEqual(r.parts.map((p) => p.id), ['project-map']);
});

test('a missing estimate is unknown, never $0', () => {
  const { costSummary } = load();
  const r = costSummary([
    { id: 'project-map', estimate: 1.25, checked: true },
    { id: 'refactor-proposals', checked: true },
    { id: 'other', estimate: Number.NaN, checked: true },
  ]);
  assert.equal(r.total, 1.25);
  assert.deepEqual(r.parts, [
    { id: 'project-map', estimate: 1.25 },
    { id: 'refactor-proposals', estimate: null },
    { id: 'other', estimate: null },
  ]);
  assert.deepEqual(r.unknown, ['refactor-proposals', 'other']);
});

test('when no checked estimate is known the total is unknown (null), not 0', () => {
  const { costSummary } = load();
  const r = costSummary([{ id: 'project-map', estimate: null, checked: true }]);
  assert.equal(r.total, null);
  assert.deepEqual(r.unknown, ['project-map']);
});

test('nothing checked costs nothing', () => {
  const { costSummary } = load();
  assert.deepEqual(costSummary([]), { total: 0, parts: [], unknown: [] });
});

// ---------------------------------------------------------------------------
// Pure and dual-load, like setup-model.js
// ---------------------------------------------------------------------------
test('the model needs no DOM, no file system and nothing of the engine', () => {
  const src = fs.readFileSync(FILE, 'utf8');
  assert.equal(/require\(\s*['"](?:node:)?(?:fs|path|child_process|electron)['"]\s*\)/.test(src), false, 'no fs/path/child_process/electron');
  assert.equal(/require\([^)]*engine/.test(src), false, 'no engine require');
  assert.equal(/\bdocument\./.test(src), false, 'no DOM');
});

test('in the renderer the model loads as window.OnboardingModel', () => {
  const src = fs.readFileSync(FILE, 'utf8');
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(src, sandbox, { filename: 'onboarding-model.js' });
  const model = sandbox.window.OnboardingModel;
  assert.equal(typeof model, 'object');
  assert.equal(typeof model.suggestWorkflows, 'function');
  assert.equal(typeof model.costSummary, 'function');
  assert.equal(model.suggestWorkflows({ mode: 'local', ci: 'none', tests: 'unit' }).suggestions[0].id, DEFAULT);
});
