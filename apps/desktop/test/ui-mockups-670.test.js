// #670: an issue's mockups reach the run's UI review. Acceptance tests written before the code, on
// every bundled workflow with a ui_reviewer (workflows/ and the project's .multiagent/workflows/):
// - the ui_reviewer's prompt (and develop's) carries the issue's mockups, a difference from one being
//   blocking (back to develop, not a suggestion);
// - a UI change always has screenshots: develop changing files under the `ui_folders` input while
//   listing no screen in `screenshots` goes back to develop (evalExpr on develop's transitions, as
//   test/suite-outside-change-396.test.js does for the suite step).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow, evalExpr } = require('@craftorio/engine/engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIRS = [path.join(ROOT, 'workflows'), path.join(ROOT, '.multiagent', 'workflows')];

const stepAgents = (s) => [].concat(s.agents || [], s.agent || []);
// every Code & Build workflow file (one with a develop step) with a step the ui_reviewer runs in:
// [{ file, wf, step }]. #702: sdlc-test's ui_reviewer has no develop to send a difference back to;
// its differences are findings at the code owner's gate (packages/engine/test/workflow/sdlc-workflows-702.test.js).
const ALL_UI_WORKFLOWS = DIRS.filter((d) => fs.existsSync(d)).flatMap((d) => fs.readdirSync(d)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => path.join(d, f))
  .map((file) => ({ file, wf: loadWorkflow(file) }))
  .map((x) => ({ ...x, step: (x.wf.steps || []).find((s) => stepAgents(s).includes('ui_reviewer')) }))
  .filter((x) => x.step));
const UI_WORKFLOWS = ALL_UI_WORKFLOWS.filter((x) => x.wf.steps.some((s) => s.id === 'develop'));
const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

// the ui_reviewer's branch of a fan-out prompt: from `{% if agent == 'ui_reviewer' %}` to the next branch
function uiReviewerPrompt(step) {
  const text = String(step.prompt || '');
  const at = text.search(/\{%-?\s*if agent == ['"]ui_reviewer['"]\s*-?%\}/);
  if (at < 0) return text;
  const rest = text.slice(at + 1);
  const end = rest.search(/\{%-?\s*(elif|else)\b/);
  return end < 0 ? rest : rest.slice(0, end);
}

test('#670 the bundled workflows with a ui_reviewer are found (ai-development-local-hero among them)', () => {
  assert.equal(UI_WORKFLOWS.some((x) => rel(x.file) === 'workflows/feature.yaml'), true);
  assert.equal(UI_WORKFLOWS.some((x) => rel(x.file) === '.multiagent/workflows/ai-development-local-hero.yaml'), true);
});

test('#670 the ui_reviewer\'s prompt carries the issue\'s mockups', () => {
  for (const { file, step } of ALL_UI_WORKFLOWS) assert.match(uiReviewerPrompt(step), /mockup/i, rel(file));
});

test('#670 the ui_reviewer\'s prompt makes a difference from the mockup blocking', () => {
  for (const { file, step } of UI_WORKFLOWS) assert.match(uiReviewerPrompt(step), /mockup[\s\S]{0,240}\bblocking\b|\bblocking\b[\s\S]{0,240}mockup/i, rel(file));
});

test('#670 develop\'s prompt carries the issue\'s mockups', () => {
  for (const { file, wf } of UI_WORKFLOWS) {
    const develop = wf.steps.find((s) => s.id === 'develop');
    assert.match(String(develop.prompt || ''), /mockup/i, rel(file));
  }
});

// ---- develop's routing: a UI change always has screenshots -------------------------------------------

function emptyDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-mock-670-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// develop's first matching transition for a committed answer, automatic mode, no E2E, no check command
function developRoute(wf, worktree, output) {
  const step = wf.steps.find((s) => s.id === 'develop');
  const ctx = {
    inputs: { mode: 'auto', screenshots: 'all', ui_folders: ['src/renderer/'], issues: [], e2e_tests: 'off', check_command: '', base_branch: 'main' },
    vars: {},
    steps: {},
    worktree_dir: worktree,
    output: { committed: true, left_out: [], issues: [], ...output },
  };
  const tr = step.transitions.find((x) => x.when === undefined || evalExpr(x.when, ctx));
  return tr?.goto ?? null;
}

test('#670 develop changing files under the UI folders with no screen in `screenshots` goes back to develop', (t) => {
  const worktree = emptyDir(t);
  for (const { file, wf } of UI_WORKFLOWS) {
    assert.equal(developRoute(wf, worktree, { files_changed: ['src/renderer/home.js'], screenshots: [] }), 'develop', rel(file));
  }
});

test('#670 develop changing UI files and listing its screens is captured as before (control)', (t) => {
  const worktree = emptyDir(t);
  for (const { file, wf } of UI_WORKFLOWS) {
    assert.equal(developRoute(wf, worktree, { files_changed: ['src/renderer/home.js'], screenshots: ['--view home'] }), 'developer_screenshots', rel(file));
  }
});

test('#670 a change without UI files and without screenshots goes on to the review as before (control)', (t) => {
  const worktree = emptyDir(t);
  for (const { file, wf } of UI_WORKFLOWS) {
    assert.equal(developRoute(wf, worktree, { files_changed: ['packages/engine/x.js'], screenshots: [] }), 'code_review', rel(file));
  }
});

// ---- the routes after review round 1: any step, with its vars, previous step and other steps' outputs --

const MOCKUP_TASK = 'Home screen\n\n- [ ] The home screen matches `mock-1.jpg`: layout, icons, texts, controls, order\n\n![mock-1.jpg](https://example.com/files/mock-1.jpg)';
// the step's first matching transition: [goto, set] (set as plain JSON)
function route(wf, id, { worktree, inputs = {}, vars = {}, steps = {}, output = {}, previous_step } = {}) {
  const step = wf.steps.find((s) => s.id === id);
  const ctx = {
    inputs: { mode: 'auto', screenshots: 'all', ui_folders: ['src/renderer/'], issues: [], e2e_tests: 'off', check_command: '', base_branch: 'main', task: 'A task without mockups.', ...inputs },
    vars,
    steps,
    worktree_dir: worktree,
    output,
    previous_step,
  };
  const tr = step.transitions.find((x) => x.when === undefined || evalExpr(x.when, ctx));
  return [tr?.goto ?? null, JSON.parse(JSON.stringify(tr?.set || {}))];
}

test('#670 develop sends a UI change without screens back once; the second time it goes on to the capture', (t) => {
  const worktree = emptyDir(t);
  const output = { committed: true, left_out: [], issues: [], files_changed: ['src/renderer/home.js'], screenshots: [] };
  for (const { file, wf } of UI_WORKFLOWS) {
    assert.deepEqual(route(wf, 'develop', { worktree, output }), ['develop', { ui_screens_returned: 'yes' }], rel(file));
    assert.equal(route(wf, 'develop', { worktree, output, vars: { ui_screens_returned: 'yes' } })[0], 'developer_screenshots', rel(file));
  }
});

test('#670 developer_screenshots: an issue with mockups and screens taken goes back to develop once, for its self-check', (t) => {
  const worktree = emptyDir(t);
  for (const { file, wf } of UI_WORKFLOWS) {
    assert.deepEqual(route(wf, 'developer_screenshots', { worktree, inputs: { task: MOCKUP_TASK }, output: { taken: 2 } }), ['develop', { mockup_self_check: 'yes' }], rel(file));
    assert.equal(route(wf, 'developer_screenshots', { worktree, inputs: { task: MOCKUP_TASK }, output: { taken: 2 }, vars: { mockup_self_check: 'yes' } })[0], 'code_review', rel(file));
  }
});

test('#670 developer_screenshots: no mockup in the issue, or no screen taken, goes on to the review as before', (t) => {
  const worktree = emptyDir(t);
  for (const { file, wf } of UI_WORKFLOWS) {
    assert.equal(route(wf, 'developer_screenshots', { worktree, output: { taken: 2 } })[0], 'code_review', rel(file));
    assert.equal(route(wf, 'developer_screenshots', { worktree, inputs: { task: MOCKUP_TASK }, output: { taken: 0 } })[0], 'code_review', rel(file));
  }
});

test('#670 develop changing nothing after its mockup self-check goes back to the same screens, then the review', (t) => {
  const worktree = emptyDir(t);
  const output = { committed: false, left_out: [], issues: [] };
  for (const { file, wf } of UI_WORKFLOWS) {
    assert.equal(route(wf, 'develop', { worktree, output, previous_step: 'developer_screenshots', vars: { mockup_self_check: 'yes' } })[0], 'developer_screenshots', rel(file));
    // without the self-check, a turn with no commit does not jump to the screenshots
    assert.notEqual(route(wf, 'develop', { worktree, output, previous_step: 'developer_screenshots' })[0], 'developer_screenshots', rel(file));
  }
});

test('#670 after testid_check, a UI change without screens goes back to develop once (vars.ui_screens_returned)', (t) => {
  const worktree = emptyDir(t);
  const steps = { develop: { output: { committed: true, files_changed: ['src/renderer/home.js'], screenshots: [], issues: [] } } };
  const output = { kind: 'test_ids', status: 'pass', missing: [] };
  for (const { file, wf } of UI_WORKFLOWS) {
    assert.deepEqual(route(wf, 'testid_check', { worktree, steps, output }), ['develop', { ui_screens_returned: 'yes' }], rel(file));
    assert.equal(route(wf, 'testid_check', { worktree, steps, output, vars: { ui_screens_returned: 'yes' } })[0], 'developer_screenshots', rel(file));
  }
});

// ---- the `mockups` template filter: the issue's mockups as the prompts see them ----------------------

test('#670 the `mockups` filter lists an issue\'s mockup images and repository HTML mockups, each once', () => {
  const { render } = require('@craftorio/engine/engine/run/templates');
  const text = `${MOCKUP_TASK}\n\nAgain: ![mock-1.jpg](https://example.com/files/mock-1.jpg)\nSettings: docs/work/home-screen/mock-2.html\n`;
  assert.equal(render('{% for m in t | mockups %}{{ m.file }};{% endfor %}', { t: text }), 'mock-1.jpg;mock-2.html;');
});

test('#670 the `mockups` filter ignores an outside HTML page and text without mockups', () => {
  const { render } = require('@craftorio/engine/engine/run/templates');
  assert.equal(render('{{ t | mockups | length }}', { t: 'See [the guide](https://example.com/guide.html) and R1, R2.' }), '0');
  assert.equal(render('{{ t | mockups | length }}', { t: '' }), '0');
});
