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
const { loadWorkflow, evalExpr } = require('@multiagent/engine/engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIRS = [path.join(ROOT, 'workflows'), path.join(ROOT, '.multiagent', 'workflows')];

const stepAgents = (s) => [].concat(s.agents || [], s.agent || []);
// every workflow file with a step the ui_reviewer runs in: [{ file, wf, step }]
const UI_WORKFLOWS = DIRS.filter((d) => fs.existsSync(d)).flatMap((d) => fs.readdirSync(d)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => path.join(d, f))
  .map((file) => ({ file, wf: loadWorkflow(file) }))
  .map((x) => ({ ...x, step: (x.wf.steps || []).find((s) => stepAgents(s).includes('ui_reviewer')) }))
  .filter((x) => x.step));
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
  assert.equal(UI_WORKFLOWS.some((x) => rel(x.file) === 'workflows/ai-development-local-hero.yaml'), true);
  assert.equal(UI_WORKFLOWS.some((x) => rel(x.file) === '.multiagent/workflows/ai-development-local-hero.yaml'), true);
});

test('#670 the ui_reviewer\'s prompt carries the issue\'s mockups', () => {
  for (const { file, step } of UI_WORKFLOWS) assert.match(uiReviewerPrompt(step), /mockup/i, rel(file));
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
