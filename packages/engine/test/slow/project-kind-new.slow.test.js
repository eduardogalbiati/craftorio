// #57: a project made by "Create new project" (README only, no UI folder yet) gets its screenshots and its
// visual review once the developer's change has UI files. Acceptance tests written before the code: whole mock
// runs of workflows/feature.yaml (docs/agents/testing/simulated-runs.md; the cheap tests of the issue are in
// packages/engine/test/project-kind-new.test.js), one per case of the issue's table plus an owner's backend.
//
// Each run starts as the app starts it: the project's run defaults (runDefaultsWith: its files, its saved
// `kind` when the owner picked one) resolved against feature.yaml's inputs (resolveRunInputs, what the owner
// typed first), on a git repository holding the project's files. Then:
// - "ran" for developer_screenshots: the step finished in the run (a mock run captures nothing, its output
//   says so); for the ui_reviewer: code_review opened a ui_reviewer session.
// - "sent back once": develop went back to develop exactly once (#670: a UI change and no screen listed).
//
// Contract assumed here (the developer implements it):
// - the mock provider's `screenshots` list (develop's screens to capture) is settable per visit like
//   `files_changed`: `mockSequences.screenshots: [[...visit 1], [...visit 2]]`, the last one repeating; an
//   empty list is "no screen listed". Without it the mock keeps its one simulated screen (as today).
// - an owner-chosen backend (`project.kind: 'backend'`) is respected: no screenshots, no ui_reviewer, and the
//   run says "screen not reviewed: <reason>" in result.md and at its gates (here developer_check, validated
//   mode).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../engine/workflow');
const { runUntilStall } = require('../helpers/run-watch');
const { runDefaultsWith, resolveRunInputs } = require('../../domains/project/project-run-defaults');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'feature.yaml');
const FEATURE = yaml.load(fs.readFileSync(WORKFLOW, 'utf8'));

// git with no config of this machine: identity, branch and line endings given per command
const gitCfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-57-gitcfg-'));
const gitCfg = path.join(gitCfgDir, 'config');
fs.writeFileSync(gitCfg, '');
process.on('exit', () => { try { fs.rmSync(gitCfgDir, { recursive: true, force: true }); } catch { /* temp folder */ } });
const gitEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))), GIT_CONFIG_GLOBAL: gitCfg, GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const json = (v) => JSON.stringify(v, null, 2);
// what "Create new project" makes with "README and .gitignore"
const NEW_PROJECT = { 'README.md': '# Field Notes\n', '.gitignore': 'node_modules/\n' };
// a plain site: one page at the root, no package.json
const PLAIN_SITE = { 'index.html': '<!doctype html><title>Home</title><h1>Home</h1>\n' };
// a React app: its page under src/
const REACT_APP = {
  'package.json': json({ name: 'site', dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' } }),
  'index.html': '<!doctype html><div id="root"></div>\n',
  'src/App.jsx': 'export default function App() { return <h1>Site</h1>; }\n',
};
// one screen in the shape of develop's `screenshots` items (name, caption, the screenshot command's args)
const SCREEN = { name: '57-home', caption: 'The home page', args: ['--view', 'home'] };
// the developer lists no screen on its first answer, then one after being sent back
const NO_SCREEN_THEN_ONE = [[], [SCREEN]];

// the project's files committed on main, then the run's branch (a run's commits are never on main)
function projectRepo(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-57-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// A mock run of feature.yaml for a project with these files (and the kind the owner picked, if any): the
// inputs the app would start it with, the developer's answer changing `filesChanged` and listing `screens`
// per visit (undefined: the mock's default screen). Gates get their first choice.
async function runProject(t, { files, kind, filesChanged, screens, typed = {} }) {
  const repo = projectRepo(t, files);
  const project = { id: 'field-notes', folder: repo, ...(kind ? { kind } : {}) };
  const defaults = runDefaultsWith({ project, profile: null });
  const { values } = resolveRunInputs({
    typed: { task: 'Add the home page', repo_path: repo, unit_tests: 'run_existing', secret_scan: 'off', ...typed },
    project: defaults,
    workflow: FEATURE,
  });
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-57-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 }));
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: values,
    mock: true,
    runsDir,
    mockSequences: {
      verdict: ['approved'],
      suite: { red_check: ['fail'], suite: ['pass'] },
      files_changed: [filesChanged],
      ...(screens ? { screenshots: screens } : {}),
    },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices?.[0]?.id ?? true, 'user'));
  });
  await runUntilStall(run, { stallMs: 15000 });
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const finished = events.find((e) => e.type === 'workflow.finished');
  const resultFile = path.join(run.runDir, 'result.md');
  const result = fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8') : '';
  return {
    events,
    transitions,
    finished,
    result,
    screenshotsRan: events.some((e) => e.type === 'step.finished' && e.step_id === 'developer_screenshots'),
    uiReviewerRan: events.some((e) => e.type === 'session.opened' && e.session?.step_id === 'code_review' && e.session?.agent === 'ui_reviewer'),
    sentBack: transitions.filter((x) => x === 'develop>develop').length,
  };
}

// the outcome in primitives: { screenshots, ui_reviewer, sent_back }
const outcome = (r) => ({ screenshots: r.screenshotsRan, ui_reviewer: r.uiReviewerRan, sent_back: r.sentBack });

describe('#57 the project\'s kind and a UI change (whole mock runs of feature.yaml)', { concurrency: true }, () => {
  test('#57 a new project (README only, kind not picked) whose developer lists a screen: the screenshots and the UI review run', { timeout: 300000 }, async (t) => {
    const r = await runProject(t, { files: NEW_PROJECT, filesChanged: ['src/App.jsx'] });
    assert.equal(r.finished?.status, 'success', r.finished?.error);
    assert.deepEqual(outcome(r), { screenshots: true, ui_reviewer: true, sent_back: 0 }, r.transitions.join(' '));
  });

  test('#57 a new project the owner made a frontend, developer lists a screen: the screenshots and the UI review run', { timeout: 300000 }, async (t) => {
    const r = await runProject(t, { files: NEW_PROJECT, kind: 'frontend', filesChanged: ['src/App.jsx'] });
    assert.equal(r.finished?.status, 'success', r.finished?.error);
    assert.deepEqual(outcome(r), { screenshots: true, ui_reviewer: true, sent_back: 0 }, r.transitions.join(' '));
  });

  test('#57 a new project the owner made a frontend, developer lists no screen: sent back once, then the screenshots and the UI review run', { timeout: 300000 }, async (t) => {
    const r = await runProject(t, { files: NEW_PROJECT, kind: 'frontend', filesChanged: ['src/App.jsx'], screens: NO_SCREEN_THEN_ONE });
    assert.equal(r.finished?.status, 'success', r.finished?.error);
    assert.deepEqual(outcome(r), { screenshots: true, ui_reviewer: true, sent_back: 1 }, r.transitions.join(' '));
  });

  test('#57 a plain index.html site whose developer changes index.html and lists a screen: the screenshots and the UI review run', { timeout: 300000 }, async (t) => {
    const r = await runProject(t, { files: PLAIN_SITE, filesChanged: ['index.html'] });
    assert.equal(r.finished?.status, 'success', r.finished?.error);
    assert.deepEqual(outcome(r), { screenshots: true, ui_reviewer: true, sent_back: 0 }, r.transitions.join(' '));
  });

  test('#57 guard: a React app (src/App.jsx) whose developer lists a screen: the screenshots and the UI review run', { timeout: 300000 }, async (t) => {
    const r = await runProject(t, { files: REACT_APP, filesChanged: ['src/App.jsx'] });
    assert.equal(r.finished?.status, 'success', r.finished?.error);
    assert.deepEqual(outcome(r), { screenshots: true, ui_reviewer: true, sent_back: 0 }, r.transitions.join(' '));
  });

  test('#57 a React app whose developer lists no screen for src/App.jsx: sent back once, then the screenshots and the UI review run', { timeout: 300000 }, async (t) => {
    const r = await runProject(t, { files: REACT_APP, filesChanged: ['src/App.jsx'], screens: NO_SCREEN_THEN_ONE });
    assert.equal(r.finished?.status, 'success', r.finished?.error);
    assert.deepEqual(outcome(r), { screenshots: true, ui_reviewer: true, sent_back: 1 }, r.transitions.join(' '));
  });

  test('#57 the owner\'s backend is respected: a UI change takes no screenshots nor UI review, and the run says "screen not reviewed" in result.md and at its gate', { timeout: 300000 }, async (t) => {
    const r = await runProject(t, { files: NEW_PROJECT, kind: 'backend', filesChanged: ['src/App.jsx'], typed: { validation: 'validated' } });
    assert.equal(r.finished?.status, 'success', r.finished?.error);
    assert.deepEqual({ screenshots: r.screenshotsRan, ui_reviewer: r.uiReviewerRan }, { screenshots: false, ui_reviewer: false }, r.transitions.join(' '));
    const said = /screen not reviewed: \S/i;
    assert.match(r.result, said, 'result.md says the screen was not reviewed, with the reason');
    const gate = r.events.find((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
    assert.ok(gate, `the validated run stops at developer_check: ${r.transitions.join(' ')}`);
    assert.match([gate.summary, gate.message].filter(Boolean).join('\n'), said, 'the gate says the screen was not reviewed, with the reason');
  });
});
