// #735: no Node assumption in the bundled workflows' defaults, and a project without UI gets no UI
// step. Acceptance tests written before the code, on the bundled YAML (workflows/feature.yaml,
// workflows/release.yaml) and the engine's own condition evaluation (packages/engine/engine/run/
// templates.js evalExpr, a cheap check of the `when:` / `agent_when:` conditions, not a whole run).
// The contract the developer implements for the run screen's plan:
// - packages/shared/run-plan.js (require and browser <script>, window.RunPlan) exports
//   `stepsThatDontApply(workflow, inputs)` → [{ id, reason }]: the steps (and fan-out agents, e.g.
//   code_review's ui_reviewer) that cannot run with these inputs; for a project without UI
//   (ui_folders empty, screenshots off, e2e_tests off) developer_screenshots, testid_check, e2e and
//   ui_reviewer, each with reason 'run.doesnt_apply_no_ui' (the i18n key of "Doesn't apply: no UI in
//   this project"), which the run screen shows dimmed or hides.
// The condition tests already pass: they guard what the change must keep (empty ui_folders is no UI,
// not the src/renderer/ default).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { evalExpr } = require('../../engine/run/templates');

const WORKFLOWS = path.join(__dirname, '..', '..', '..', '..', 'workflows');
const workflow = (name) => yaml.load(fs.readFileSync(path.join(WORKFLOWS, name), 'utf8'));
const stepOf = (wf, id) => wf.steps.find((s) => s.id === id);
const loadPlan = () => require('@craftorio/shared/run-plan');

// a backend project's run: no UI folders, no screenshots, no E2E (#735's run defaults)
const NO_UI = { task: 'Add retries', validation: 'auto', validate_every_round: false, screenshots: 'off', ui_folders: [], steps_folders: [], e2e_tests: 'off', e2e_command: '', issues: [] };
const FULL_STACK = { ...NO_UI, screenshots: 'all', ui_folders: ['web/'], steps_folders: ['features/steps'], e2e_tests: 'write_and_run', e2e_command: 'npm run test:e2e' };
// a committed change that touches files under the old default UI folder
const DEVELOP = { committed: true, screenshots: [], files_changed: ['src/renderer/app.js', 'src/lib.rs'], issues: [] };
const scope = (inputs, extra = {}) => ({
  inputs, output: DEVELOP, vars: {}, previous_step: 'develop',
  steps: { develop: { output: DEVELOP }, acceptance_tests: { output: { e2e_scope: 'scenarios' } } }, ...extra,
});
const whensTo = (step, target) => (step.transitions || []).filter((tr) => tr.goto === target).map((tr) => tr.when);

// ---- the workflows' defaults: no npm assumed ----------------------------------------------------

test('#735 feature.yaml: the E2E command has no npm default (empty)', () => {
  assert.equal(workflow('feature.yaml').inputs.e2e_command.default, '');
});

test('#735 release.yaml: the E2E command has no npm default (empty)', () => {
  assert.equal(workflow('release.yaml').inputs.e2e_command.default, '');
});

test('#735 feature.yaml: the test command\'s discovery lists Cargo.toml', () => {
  assert.match(String(workflow('feature.yaml').inputs.test_command.description), /Cargo\.toml/);
});

// ---- the existing conditions skip the UI steps when the project has no UI (guards) --------------

test('#735 no UI: develop never goes to the screenshots (empty ui_folders, screenshots off)', () => {
  const whens = whensTo(stepOf(workflow('feature.yaml'), 'develop'), 'developer_screenshots');
  assert.ok(whens.length > 0, 'develop has no transition to developer_screenshots any more');
  assert.deepEqual(whens.map((w) => evalExpr(w, scope(NO_UI))), whens.map(() => false));
});

test('#735 empty ui_folders: a change under src/renderer/ is not a UI change (no fallback to the old default)', () => {
  const whens = whensTo(stepOf(workflow('feature.yaml'), 'develop'), 'developer_screenshots');
  assert.deepEqual(whens.map((w) => evalExpr(w, scope({ ...NO_UI, screenshots: 'all' }))), whens.map(() => false));
});

test('#735 no UI: the code review never starts the UI reviewer', () => {
  const when = stepOf(workflow('feature.yaml'), 'code_review').agent_when.ui_reviewer;
  assert.equal(evalExpr(when, scope(NO_UI, { previous_step: 'developer_screenshots' })), false);
});

test('#735 no UI: develop never goes to the test id check (E2E off)', () => {
  const whens = whensTo(stepOf(workflow('feature.yaml'), 'develop'), 'testid_check');
  assert.deepEqual(whens.map((w) => evalExpr(w, scope(NO_UI))), whens.map(() => false));
});

test('#735 no UI: a green suite never goes to the E2E suite (E2E off)', () => {
  const whens = whensTo(stepOf(workflow('feature.yaml'), 'suite'), 'e2e');
  assert.ok(whens.length > 0, 'suite has no transition to e2e any more');
  const out = { status: 'pass', in_change: 0 };
  assert.deepEqual(whens.map((w) => evalExpr(w, scope(NO_UI, { output: out }))), whens.map(() => false));
});

// ---- the run screen's plan: the steps that don't apply ------------------------------------------

test('#735 the plan of a project without UI marks the screenshots, the test id check, the E2E suite and the UI reviewer as not applying', () => {
  const ids = loadPlan().stepsThatDontApply(workflow('feature.yaml'), NO_UI).map((s) => s.id);
  assert.deepEqual(['developer_screenshots', 'testid_check', 'e2e', 'ui_reviewer'].filter((id) => !ids.includes(id)), []);
});

test('#735 each step that does not apply says why: no UI in this project (run.doesnt_apply_no_ui)', () => {
  const reasons = [...new Set(loadPlan().stepsThatDontApply(workflow('feature.yaml'), NO_UI).map((s) => s.reason))];
  assert.deepEqual(reasons, ['run.doesnt_apply_no_ui']);
});

test('#735 the plan of a full-stack project keeps its UI steps', () => {
  const ids = loadPlan().stepsThatDontApply(workflow('feature.yaml'), FULL_STACK).map((s) => s.id);
  assert.deepEqual(['developer_screenshots', 'testid_check', 'e2e', 'ui_reviewer'].filter((id) => ids.includes(id)), []);
});

test('#735 the plan of a project without UI keeps the steps that do run (develop, code review, unit suite)', () => {
  const ids = loadPlan().stepsThatDontApply(workflow('feature.yaml'), NO_UI).map((s) => s.id);
  assert.deepEqual(['develop', 'code_review', 'suite'].filter((id) => ids.includes(id)), []);
});
