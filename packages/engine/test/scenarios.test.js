// packages/engine/engine/scenarios.js (#143): the test writer's E2E BDD scenarios, kept as a step output's
// `scenarios` ([{ feature, name, steps, status, reason, screenshots }]) and `e2e_note`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const scenarios = require('../engine/scenarios');

function tmpRunDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenarios-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- normalizeScenarios ---------------------------------------------------------------------

test('normalizeScenarios: an unknown status becomes skipped, with a reason saying so', () => {
  const [s] = scenarios.normalizeScenarios([{ name: 'A', status: 'blocked' }]);
  assert.equal(s.status, 'skipped');
  assert.equal(s.reason, 'no valid status reported (blocked)');
});

test('normalizeScenarios: a given reason is kept even with a valid status', () => {
  const [s] = scenarios.normalizeScenarios([{ name: 'A', status: 'failed', reason: 'the button was missing' }]);
  assert.equal(s.status, 'failed');
  assert.equal(s.reason, 'the button was missing');
});

test('normalizeScenarios: steps given as a newline-separated string split into trimmed, non-empty lines', () => {
  const [s] = scenarios.normalizeScenarios([{ name: 'A', status: 'passed', steps: 'Given a\n  When b  \n\nThen c' }]);
  assert.deepEqual(s.steps, ['Given a', 'When b', 'Then c']);
});

test('normalizeScenarios: steps given as an array are kept, trimmed, empty ones dropped', () => {
  const [s] = scenarios.normalizeScenarios([{ name: 'A', status: 'passed', steps: [' Given a ', '', 'Then c'] }]);
  assert.deepEqual(s.steps, ['Given a', 'Then c']);
});

test('normalizeScenarios: an absolute screenshot path is made relative to the run folder, with forward slashes', () => {
  const runDir = path.join('C:', 'runs', 'r1');
  const abs = path.join(runDir, 'evidence', 'test', 'round-1', 'shot.png');
  const [s] = scenarios.normalizeScenarios([{ name: 'A', status: 'passed', screenshots: [abs] }], runDir);
  assert.deepEqual(s.screenshots, ['evidence/test/round-1/shot.png']);
});

test('normalizeScenarios: a relative screenshot path is kept as given, and an object { path } is accepted', () => {
  const [s] = scenarios.normalizeScenarios([{ name: 'A', status: 'passed', screenshots: ['evidence/x.png', { path: 'evidence/y.png' }, { path: '' }, ''] }]);
  assert.deepEqual(s.screenshots, ['evidence/x.png', 'evidence/y.png']);
});

test('normalizeScenarios: drops entries with no name, non-objects and falsy items; a non-array list gives []', () => {
  assert.deepEqual(scenarios.normalizeScenarios([{ name: '  ' }, null, 'x', 42, { name: 'Kept', status: 'passed' }]).map((s) => s.name), ['Kept']);
  assert.deepEqual(scenarios.normalizeScenarios(null), []);
  assert.deepEqual(scenarios.normalizeScenarios(undefined), []);
  assert.deepEqual(scenarios.normalizeScenarios('not an array'), []);
});

// ---- scenarioCounts ---------------------------------------------------------------------------

test('scenarioCounts: counts total and each status', () => {
  const list = [{ name: 'A', status: 'passed' }, { name: 'B', status: 'failed' }, { name: 'C', status: 'skipped' }, { name: 'D', status: 'passed' }];
  assert.deepEqual(scenarios.scenarioCounts(list), { total: 4, passed: 2, failed: 1, skipped: 1, pending: 0 });
});

test('scenarioCounts: a pending scenario (#199, written by a development run, run at release) is counted on its own', () => {
  const list = [{ name: 'A', status: 'pending' }, { name: 'B', status: 'pending' }];
  assert.deepEqual(scenarios.scenarioCounts(list), { total: 2, passed: 0, failed: 0, skipped: 0, pending: 2 });
});

test('scenarioCounts: an empty or invalid list counts all zero', () => {
  assert.deepEqual(scenarios.scenarioCounts([]), { total: 0, passed: 0, failed: 0, skipped: 0, pending: 0 });
  assert.deepEqual(scenarios.scenarioCounts(null), { total: 0, passed: 0, failed: 0, skipped: 0, pending: 0 });
});

// ---- featureText --------------------------------------------------------------------------------

test('featureText: an empty list writes "No scenario reported." with no Feature block', () => {
  const text = scenarios.featureText([]);
  assert.match(text, /# No scenario reported\.\n$/);
  assert.doesNotMatch(text, /Feature:/);
});

test('featureText: an empty list with a note drops "reported" and keeps the note in the header', () => {
  const text = scenarios.featureText([], { note: 'Engine-only change: no user-visible behaviour' });
  assert.match(text, /# Note: Engine-only change: no user-visible behaviour\n/);
  assert.match(text, /# No scenario\.\n$/);
});

test('featureText: a step without a recognized keyword gets a "*" prefix; recognized ones are kept as-is', () => {
  const text = scenarios.featureText([{ name: 'A', status: 'passed', steps: ['Given a', 'the page loads', 'Then it works'] }]);
  assert.match(text, /^\s*Given a$/m);
  assert.match(text, /^\s*\* the page loads$/m);
  assert.match(text, /^\s*Then it works$/m);
});

test('featureText: scenarios with no feature file group under the title, with no "# file:" comment', () => {
  const text = scenarios.featureText([{ name: 'A', status: 'passed', steps: [] }], { title: 'Acceptance scenarios' });
  assert.match(text, /^Feature: Acceptance scenarios$/m);
  assert.doesNotMatch(text, /# file:/);
});

test('featureText: scenarios grouped by feature file use its basename (no extension) as the Feature line, with a "# file:" comment', () => {
  const text = scenarios.featureText([{ feature: 'features/143-dashboard.feature', name: 'A', status: 'passed', steps: [] }]);
  assert.match(text, /# file: features\/143-dashboard\.feature/);
  assert.match(text, /^Feature: 143-dashboard$/m);
});

test('featureText: each scenario is commented with its status and reason, and its screenshots', () => {
  const text = scenarios.featureText([{ name: 'A', status: 'failed', reason: 'broken', screenshots: ['evidence/x.png'], steps: [] }]);
  assert.match(text, /# failed: broken/);
  assert.match(text, /# screenshot: evidence\/x\.png/);
  assert.match(text, /Scenario: A/);
});

// ---- scenariosMessage ---------------------------------------------------------------------------

test('scenariosMessage: no `scenarios` key on the output gives \'\' (the gate falls back to its own text)', () => {
  assert.equal(scenarios.scenariosMessage({}), '');
  assert.equal(scenarios.scenariosMessage({ scenarios: 'not an array' }), '');
  assert.equal(scenarios.scenariosMessage(null), '');
});

test('scenariosMessage: an empty list says "none", with the note in parentheses when there is one', () => {
  assert.equal(scenarios.scenariosMessage({ scenarios: [] }), 'E2E scenarios: none.');
  assert.equal(
    scenarios.scenariosMessage({ scenarios: [], e2e_note: 'Engine-only change: no user-visible behaviour' }),
    'E2E scenarios: none (Engine-only change: no user-visible behaviour).',
  );
});

test('scenariosMessage: mixed statuses list counts (non-zero only) and one line per scenario, with a trailing Note', () => {
  const msg = scenarios.scenariosMessage({
    scenarios: [
      { name: 'Filter the runs', status: 'passed' },
      { name: 'Empty filter result', status: 'failed', reason: 'no message shown' },
      { name: 'Restart keeps the filter', status: 'skipped', reason: 'no headless browser' },
    ],
    e2e_note: 'One skipped because of the environment',
  });
  assert.match(msg, /^E2E scenarios \(written by the test writer\): 1 passed · 1 failed · 1 skipped$/m);
  assert.match(msg, /^- passed: Filter the runs$/m);
  assert.match(msg, /^- failed: Empty filter result \(no message shown\)$/m);
  assert.match(msg, /^- skipped: Restart keeps the filter \(no headless browser\)$/m);
  assert.match(msg, /^Note: One skipped because of the environment$/m);
});

test('scenariosMessage: a pending scenario (#199) is shown as "written, run at release", and the header says "run at release" when every scenario is pending', () => {
  const msg = scenarios.scenariosMessage({
    scenarios: [{ name: 'Open the dashboard', status: 'pending' }],
  });
  assert.match(msg, /^E2E scenarios \(written by the test writer, run at release\): 1 written, run at release$/m);
  assert.match(msg, /^- written, run at release: Open the dashboard$/m);
});

// ---- recordScenarios ----------------------------------------------------------------------------

test('recordScenarios: no `scenarios` key on the output writes nothing and returns null', (t) => {
  const dir = tmpRunDir(t);
  assert.equal(scenarios.recordScenarios(dir, 'test', {}), null);
  assert.equal(fs.existsSync(path.join(dir, 'e2e')), false);
});

test('recordScenarios: writes <run>/e2e/scenarios.feature and scenarios.json, even for an empty list', (t) => {
  const dir = tmpRunDir(t);
  const saved = scenarios.recordScenarios(dir, 'test', { scenarios: [], e2e_note: 'Docs-only change' });
  assert.equal(saved.feature, path.join(dir, 'e2e', 'scenarios.feature'));
  assert.equal(saved.json, path.join(dir, 'e2e', 'scenarios.json'));
  assert.match(fs.readFileSync(saved.feature, 'utf8'), /# No scenario\.\n$/);
  const json = JSON.parse(fs.readFileSync(saved.json, 'utf8'));
  assert.deepEqual(json, { step: 'test', counts: { total: 0, passed: 0, failed: 0, skipped: 0, pending: 0 }, note: 'Docs-only change', scenarios: [] });
});

test('recordScenarios: scenarios.json keeps screenshot paths relative to the run folder', (t) => {
  const dir = tmpRunDir(t);
  const abs = path.join(dir, 'evidence', 'test', 'round-1', 'shot.png');
  const saved = scenarios.recordScenarios(dir, 'test', { scenarios: [{ name: 'A', status: 'passed', screenshots: [abs] }] });
  const json = JSON.parse(fs.readFileSync(saved.json, 'utf8'));
  assert.deepEqual(json.scenarios[0].screenshots, ['evidence/test/round-1/shot.png']);
  assert.equal(json.counts.passed, 1);
});
