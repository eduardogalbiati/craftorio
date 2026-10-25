// apps/desktop/renderer/views/supervisor/supervisor.js, apps/desktop/renderer/views/workflows/builder.js and
// fronts/analyser/views/analytics/analytics.js run only inside the Electron renderer (document,
// window.api), so the screen-context helpers they expose for the Supervisor (#28) are pulled out
// of the source and evaluated in a sandbox, the way test/renderer-run-gates.test.js checks app.js
// as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');

const supervisorSrc = fs.readFileSync(pageFileOf('views/supervisor/supervisor.js'), 'utf8');
const builderSrc = fs.readFileSync(pageFileOf('views/workflows/builder.js'), 'utf8');
const analyticsSrc = fs.readFileSync(pageFileOf('views/analytics/analytics.js'), 'utf8');

function loadSupervisorScreenContext() {
  const LABELS = /const LABELS = \{[\s\S]*?\n  \};/.exec(supervisorSrc)?.[0];
  const screenContext = /function screenContext\(\) \{[\s\S]*?\n  \}/.exec(supervisorSrc)?.[0];
  assert.ok(LABELS, 'LABELS not found in supervisor.js: the source moved');
  assert.ok(screenContext, 'screenContext not found in supervisor.js: the source moved');
  const sandbox = { window: {}, state: {} };
  vm.createContext(sandbox);
  vm.runInContext(`${LABELS}\n${screenContext}\nthis.screenContext = screenContext;`, sandbox);
  return sandbox;
}

function loadBuilderContext() {
  const b = /const b = \{[\s\S]*?\n  \};/.exec(builderSrc)?.[0];
  const builderContext = /window\.builderContext = \(\) => \{[\s\S]*?\n  \};/.exec(builderSrc)?.[0];
  assert.ok(b, 'the b state object not found in builder.js: the source moved');
  assert.ok(builderContext, 'window.builderContext not found in builder.js: the source moved');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(`${b}\n${builderContext}\nthis.b = b; this.builderContext = window.builderContext;`, sandbox);
  return sandbox;
}

function loadAnalyticsContext(saved = {}, win = {}) {
  const DAY = /const DAY = [^\n]+;/.exec(analyticsSrc)?.[0];
  const ax = /const ax = \{[\s\S]*?\n  \};/.exec(analyticsSrc)?.[0];
  const today = /const today = \(\) => [^\n]+;/.exec(analyticsSrc)?.[0];
  const daysBack = /const daysBack = \(n\) => [^\n]+;/.exec(analyticsSrc)?.[0];
  const range = /function range\(\) \{[\s\S]*?\n  \}/.exec(analyticsSrc)?.[0];
  const analyticsContext = /window\.analyticsContext = \(\) => \{[\s\S]*?\n  \};/.exec(analyticsSrc)?.[0];
  for (const [name, code] of Object.entries({ DAY, ax, today, daysBack, range, analyticsContext })) {
    assert.ok(code, `${name} not found in analytics.js: the source moved`);
  }
  const sandbox = { window: win };
  vm.createContext(sandbox);
  vm.runInContext(`const saved = ${JSON.stringify(saved)};\n${DAY}\n${ax}\n${today}\n${daysBack}\n${range}\n${analyticsContext}\nthis.ax = ax; this.analyticsContext = window.analyticsContext;`, sandbox);
  return sandbox;
}

test('builderContext: a new workflow says so; an edited one names the file and version, with the desk and the dirty flag', () => {
  const sandbox = loadBuilderContext();
  assert.equal(sandbox.builderContext(), 'drawing a new workflow, mode full');

  Object.assign(sandbox.b, { file: 'x.yaml', mode: 'full', dirty: false, spec: { name: 'Demo', steps: [{ id: 'step_1' }] }, sel: 0 });
  assert.equal(sandbox.builderContext(), 'editing workflow x.yaml ("Demo"), mode full, desk step_1 selected');

  sandbox.b.dirty = true;
  assert.equal(sandbox.builderContext(), 'editing workflow x.yaml ("Demo"), mode full, desk step_1 selected, unsaved changes');
});

test('analyticsContext: the quick range (days) and a custom from/to both show, with the scope', () => {
  const sandbox = loadAnalyticsContext();
  const quick = sandbox.analyticsContext();
  assert.match(quick, /^range \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}, the orchestrator's runs$/);

  sandbox.ax.scope = 'machine';
  sandbox.ax.preset = null;
  sandbox.ax.from = '2026-09-01';
  sandbox.ax.to = '2026-09-30';
  assert.equal(sandbox.analyticsContext(), 'range 2026-09-01 to 2026-09-30, every CLI session on this machine');
});

test('#383 Analytics reads a saved date-range preset, and the older saved days as their preset', () => {
  const DateRange = require('@multiagent/ui-kit/date-range.js');
  const presetOf = (saved) => loadAnalyticsContext(saved, { DateRange }).ax.preset;
  for (const id of ['24h', '7d', '30d', 'all']) assert.equal(presetOf({ preset: id }), id);
  assert.equal(presetOf({ days: 7 }), '7d');
  assert.equal(presetOf({ days: 30 }), '30d');
  assert.equal(presetOf({ days: 90 }), '30d', 'the dropped 90 days reads as the longest preset with a range');
  assert.equal(presetOf({ preset: '90d', days: 7 }), '7d', 'an unknown preset falls back to the saved days');
  assert.equal(presetOf({ preset: 'nope' }), '30d');
  assert.equal(presetOf({}), '30d');
});

test('#383 Analytics with a preset gives the supervisor that preset\'s range', () => {
  const DateRange = require('@multiagent/ui-kit/date-range.js');
  const sandbox = loadAnalyticsContext({ preset: '7d' }, { DateRange });
  const [, from, to] = /^range (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2}), /.exec(sandbox.analyticsContext()) || [];
  assert.ok(from && to, sandbox.analyticsContext());
  assert.equal((Date.parse(to) - Date.parse(from)) / 864e5, 7);
});

test('supervisorScreenContext: Analytics includes window.analyticsContext()', () => {
  const sandbox = loadSupervisorScreenContext();
  sandbox.state.view = 'analytics';
  sandbox.window.analyticsContext = () => 'range 2026-09-01 to 2026-09-30, the orchestrator\'s runs';
  assert.equal(sandbox.screenContext(), 'Analytics, range 2026-09-01 to 2026-09-30, the orchestrator\'s runs');
});

test('supervisorScreenContext: Workflows > Builder includes the builder tab and window.builderContext()', () => {
  const sandbox = loadSupervisorScreenContext();
  sandbox.state.view = 'workflows';
  sandbox.state.workflowsTab = 'builder';
  sandbox.window.builderContext = () => 'editing workflow x.yaml, mode full';
  assert.equal(sandbox.screenContext(), 'Workflows, builder tab, editing workflow x.yaml, mode full');
});

test('supervisorScreenContext: Project includes the project\'s name and id', () => {
  const sandbox = loadSupervisorScreenContext();
  sandbox.state.view = 'project';
  sandbox.state.pv = { id: 'p1', project: { name: 'Demo project' } };
  assert.equal(sandbox.screenContext(), 'Project, project Demo project (id p1)');
});
