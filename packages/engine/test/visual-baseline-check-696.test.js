// Acceptance tests for #696 (written before the code): a new @visual scenario carries its baseline
// before the review. After develop, the orchestrator checks that every screenshot name the issue's
// scenarios use has its PNG under features/__screenshots__/ (Playwright's snapshotPathTemplate
// `{arg}-{platform}{ext}`, playwright.config.js); a missing one sends the run back to develop with
// the file and the update command, like testid_check (#246). The code review treats a missing
// baseline as blocking.
//
// The interface these tests fix (the issue leaves the names open):
//   - packages/engine/engine/visual-baselines.js, next to test-ids.js:
//     `missingBaselines(root, { issues, platform = process.platform, steps = 'features/steps' })` →
//     one `{ name, file, feature, scenario, command }` per screenshot name the scenarios tagged
//     @issue-<n> (on the scenario or the Feature) use without a baseline: name '671-documents.png',
//     file 'features/__screenshots__/671-documents-win32.png', feature (repository-relative, forward
//     slashes), command 'npm run test:e2e:update -- --grep "@issue-671(?![0-9])"' (#93: anchored,
//     so @issue-67 never selects @issue-671). A name is a quoted "*.png" in
//     a step's text (Scenario Outline placeholders expanded from the Examples), or the static
//     `toHaveScreenshot('…png')` of the step definition (in `steps`) whose text the step matches.
//     The .feature files are every one of the repository (node_modules and .git skipped).
//     `missingBaselineLines(missing)` → one Markdown line per missing baseline, for a prompt.
//   - step type `visual_baselines` (no agent), field `issues` (a template: the issue numbers);
//     output { kind: 'visual_baselines', status: pass | missing | skipped, missing, message }.
//   - ai-development-local-hero's step `baseline_check`, reached after a develop commit (directly
//     or after testid_check): status missing goes back to develop at most twice
//     (vars.baseline_returns), then the run goes on; develop's prompt shows its message.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '.craftorio', 'workflows', 'ai-development-local-hero.yaml');

// the module the change creates: loaded inside each test
const load = () => require('../engine/visual-baselines');
const engine = () => require('../engine/workflow');

const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const png = (dir, rel) => write(dir, rel, PNG);

function tmp(t, prefix = 'visual-baselines-696-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

const DOCS_FEATURE = [
  'Feature: Documents',
  '  @issue-671 @visual',
  '  Scenario: The documents list looks like its baseline',
  '    Given the app is open',
  '    Then the documents list looks like the baseline "671-documents.png"',
  '',
].join('\n');

const DOCS_STEPS = [
  "const { Then } = require('./fixtures');",
  "Then('the documents list looks like the baseline {string}', async ({ page }, name) => {",
  '  await expect(page.getByTestId(\'docs-list\')).toHaveScreenshot(name);',
  '});',
  '',
].join('\n');

const pick = (m) => ({ name: m.name, file: m.file, feature: m.feature, scenario: m.scenario, command: m.command });

// ---- the rule (packages/engine/engine/visual-baselines.js) ------------------------------------------

test('#696 missingBaselines: a scenario of the issue naming a PNG without a baseline is reported with its file and the update command', (t) => {
  const { missingBaselines } = load();
  const root = tmp(t);
  write(root, 'fronts/plan/features/docs.feature', DOCS_FEATURE);
  write(root, 'fronts/plan/features/steps/docs.steps.js', DOCS_STEPS);
  png(root, 'features/__screenshots__/backlog-board-light-win32.png');
  assert.deepEqual(missingBaselines(root, { issues: [671], platform: 'win32' }).map(pick), [{
    name: '671-documents.png',
    file: 'features/__screenshots__/671-documents-win32.png',
    feature: 'fronts/plan/features/docs.feature',
    scenario: 'The documents list looks like its baseline',
    command: 'npm run test:e2e:update -- --grep "@issue-671(?![0-9])"',
  }]);
});

test('#696 missingBaselines: nothing is missing once the PNG of the platform is under features/__screenshots__', (t) => {
  const { missingBaselines } = load();
  const root = tmp(t);
  write(root, 'features/docs.feature', DOCS_FEATURE);
  png(root, 'features/__screenshots__/671-documents-win32.png');
  assert.deepEqual(missingBaselines(root, { issues: [671], platform: 'win32' }), []);
  // the baseline is per platform: the win32 one does not stand for linux
  assert.deepEqual(missingBaselines(root, { issues: [671], platform: 'linux' }).map((m) => m.file), ['features/__screenshots__/671-documents-linux.png']);
});

test('#696 missingBaselines: a Scenario Outline\'s name is expanded from its Examples; only the missing theme is reported', (t) => {
  const { missingBaselines } = load();
  const root = tmp(t);
  write(root, 'features/agents.feature', [
    'Feature: Agents',
    '  @issue-671 @visual',
    '  Scenario Outline: The look modal looks like its baseline in the <theme> theme',
    '    Given the app is open in the <theme> theme',
    '    Then the look modal looks like the baseline "671-look-<theme>.png"',
    '',
    '    Examples:',
    '      | theme |',
    '      | light |',
    '      | dark  |',
    '',
  ].join('\n'));
  png(root, 'features/__screenshots__/671-look-dark-win32.png');
  assert.deepEqual(missingBaselines(root, { issues: [671], platform: 'win32' }).map((m) => ({ name: m.name, file: m.file })), [
    { name: '671-look-light.png', file: 'features/__screenshots__/671-look-light-win32.png' },
  ]);
});

test('#696 missingBaselines: only the issue\'s scenarios count; a Feature-level @issue tag covers its scenarios', (t) => {
  const { missingBaselines } = load();
  const root = tmp(t);
  write(root, 'features/sidebar.feature', [
    'Feature: Sidebar',
    '  @issue-600 @visual',
    '  Scenario: The sidebar looks like its baseline',
    '    Then the sidebar looks like the baseline "sidebar-600.png"',
    '',
  ].join('\n'));
  write(root, 'features/board.feature', [
    '@issue-671',
    'Feature: Board',
    '  @visual',
    '  Scenario: The board looks like its baseline',
    '    Then the board looks like the baseline "671-board.png"',
    '',
  ].join('\n'));
  assert.deepEqual(missingBaselines(root, { issues: [671], platform: 'win32' }).map((m) => m.name), ['671-board.png']);
  assert.deepEqual(missingBaselines(root, { issues: [600], platform: 'win32' }).map((m) => m.command), ['npm run test:e2e:update -- --grep "@issue-600(?![0-9])"']);
});

test('#696 missingBaselines: a static toHaveScreenshot(\'…png\') of the step definition the scenario\'s step matches is checked too', (t) => {
  const { missingBaselines } = load();
  const root = tmp(t);
  write(root, 'features/docs.feature', [
    'Feature: Documents',
    '  @issue-671 @visual',
    '  Scenario: The documents list looks like its baseline',
    '    Then the documents list looks like the documents baseline',
    '',
  ].join('\n'));
  write(root, 'features/steps/docs.steps.js', [
    "const { Then } = require('./fixtures');",
    "Then('the documents list looks like the documents baseline', async ({ page }) => {",
    "  await expect(page.getByTestId('docs-list')).toHaveScreenshot('671-documents.png');",
    '});',
    "Then('an unused step', async ({ page }) => {",
    "  await expect(page).toHaveScreenshot('never-used.png');",
    '});',
    '',
  ].join('\n'));
  assert.deepEqual(missingBaselines(root, { issues: [671], platform: 'win32' }).map((m) => ({ name: m.name, file: m.file })), [
    { name: '671-documents.png', file: 'features/__screenshots__/671-documents-win32.png' },
  ]);
});

test('#696 missingBaselines: .feature files under node_modules are not read', (t) => {
  const { missingBaselines } = load();
  const root = tmp(t);
  write(root, 'node_modules/some-lib/features/docs.feature', DOCS_FEATURE);
  assert.deepEqual(missingBaselines(root, { issues: [671], platform: 'win32' }), []);
});

test('#696 missingBaselineLines: one line per missing baseline naming the file and the update command', () => {
  const { missingBaselineLines } = load();
  const text = missingBaselineLines([{
    name: '671-documents.png',
    file: 'features/__screenshots__/671-documents-win32.png',
    feature: 'features/docs.feature',
    scenario: 'The documents list looks like its baseline',
    command: 'npm run test:e2e:update -- --grep @issue-671',
  }]);
  assert.equal(text.split('\n').length, 1);
  assert.match(text, /features\/__screenshots__\/671-documents-win32\.png/);
  assert.match(text, /npm run test:e2e:update -- --grep @issue-671/);
  assert.equal(missingBaselineLines([]), '');
});

// ---- the step type `visual_baselines` -------------------------------------------------------------

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function makeRepo(t) {
  const dir = tmp(t, 'visual-baselines-repo-');
  git(dir, 'init', '-q');
  write(dir, 'src/app.js', 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// a workflow with only a visual_baselines step, run on `repo` (worktree_dir = the repository)
async function runCheckOnly(t, repo, fields) {
  const { WorkflowRun } = engine();
  const dir = tmp(t, 'visual-baselines-wf-');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, JSON.stringify({
    name: 'baselines-only',
    orchestrator: { worktree: { repo: repo.replace(/\\/g, '/'), base: 'main', remote: false } },
    agents: { dev: { provider: 'claude' } },
    steps: [{ id: 'check', type: 'visual_baselines', ...fields, transitions: [{ when: 'true', goto: 'end' }] }],
  }));
  const run = new WorkflowRun({ file, inputs: { task: 'check' }, mock: true, runsDir: dir });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  return { finished: events.find((e) => e.type === 'workflow.finished'), output: events.find((e) => e.type === 'step.finished' && e.step_id === 'check')?.output };
}

test('#696 run: a visual_baselines step reports the missing baseline (file and update command) and passes once it is there', { timeout: 60000 }, async (t) => {
  const repo = makeRepo(t);
  write(repo, 'features/docs.feature', DOCS_FEATURE);
  write(repo, 'features/steps/docs.steps.js', DOCS_STEPS);
  const baseline = `features/__screenshots__/671-documents-${process.platform}.png`;
  const missing = await runCheckOnly(t, repo, { issues: '671' });
  assert.equal(missing.finished.status, 'success', missing.finished.error);
  assert.equal(missing.output.kind, 'visual_baselines');
  assert.equal(missing.output.status, 'missing');
  assert.deepEqual(missing.output.missing.map((m) => m.file), [baseline]);
  assert.ok(missing.output.message.includes(baseline), missing.output.message);
  assert.ok(missing.output.message.includes('npm run test:e2e:update -- --grep "@issue-671(?![0-9])"'), missing.output.message);
  png(repo, baseline);
  const present = await runCheckOnly(t, repo, { issues: '671' });
  assert.equal(present.output.status, 'pass');
  assert.deepEqual(present.output.missing, []);
});

// ---- the workflow (.craftorio/workflows/ai-development-local-hero.yaml) ---------------------------

test('#696 workflow: a baseline_check step without an agent (type visual_baselines)', () => {
  const wf = engine().loadWorkflow(WORKFLOW);
  const check = wf.steps.find((s) => s.id === 'baseline_check');
  assert.ok(check, 'the workflow has a baseline_check step');
  assert.equal(check.agent, undefined, 'no agent: the orchestrator checks the files itself');
  assert.equal(check.agents, undefined, 'no fan-out either');
  assert.equal(check.type, 'visual_baselines');
});

// the first matching transition of a step: [goto, set]
function route(wf, id, ctx) {
  const { evalExpr } = engine();
  const step = wf.steps.find((s) => s.id === id);
  const tr = step.transitions.find((x) => x.when === undefined || evalExpr(x.when, ctx));
  return [tr?.goto ?? null, JSON.parse(JSON.stringify(tr?.set || {}))];
}

// from a develop commit (automatic mode, scenarios written first, no screenshots, no check command)
// through the agent-less checks after it: the steps visited, ending at the next agent's step
function walkAfterDevelop(t, { baselineOutput, vars = {} }) {
  const wf = engine().loadWorkflow(WORKFLOW);
  const develop = { committed: true, left_out: [], issues: [], files_changed: ['packages/engine/engine/docs.js'], screenshots: [] };
  const outputs = {
    develop,
    testid_check: { kind: 'test_ids', status: 'pass', missing: [] },
    baseline_check: baselineOutput,
    secret_scan: { kind: 'secret_scan', status: 'pass', findings: [], message: 'No secret found.' }, // #49
  };
  const steps = {
    acceptance_tests: { output: { e2e_scope: 'scenarios', e2e_files: ['features/docs.feature', 'features/steps/docs.steps.js'] } },
    develop: { output: develop },
  };
  const ctx = (output, previous_step) => ({
    inputs: { mode: 'auto', screenshots: 'off', ui_folders: ['src/renderer/'], steps_folders: ['features/steps'], issue: 'https://github.com/o/r/issues/671', issues: ['https://github.com/o/r/issues/671'], e2e_tests: 'on', check_command: '', base_branch: 'main', task: 'A task without mockups.' },
    vars,
    steps,
    worktree_dir: tmp(t),
    output,
    previous_step,
  });
  const path_ = [];
  let at = 'develop';
  let previous;
  let set = {};
  for (let hop = 0; hop < 6; hop++) {
    const [next, s] = route(wf, at, ctx(outputs[at], previous));
    path_.push(next);
    set = s;
    vars = { ...vars, ...s };
    if (!['testid_check', 'baseline_check', 'secret_scan'].includes(next)) break;
    steps[next] = { output: outputs[next] };
    previous = at;
    at = next;
  }
  return { path: path_, set };
}

const MISSING = {
  kind: 'visual_baselines',
  status: 'missing',
  missing: [{ name: '671-documents.png', file: 'features/__screenshots__/671-documents-win32.png', feature: 'features/docs.feature', scenario: 'The documents list looks like its baseline', command: 'npm run test:e2e:update -- --grep @issue-671' }],
  message: '1 baseline missing: features/__screenshots__/671-documents-win32.png (npm run test:e2e:update -- --grep @issue-671)',
};

test('#696 workflow: after a develop commit, a missing baseline sends the run back to develop through baseline_check', (t) => {
  const { path: visited, set } = walkAfterDevelop(t, { baselineOutput: MISSING });
  assert.ok(visited.includes('baseline_check'), `baseline_check runs after develop (got ${visited.join(' > ')})`);
  assert.equal(visited[visited.length - 1], 'develop', `back to develop (got ${visited.join(' > ')})`);
  assert.ok('baseline_returns' in set, `the return is counted in vars.baseline_returns (got ${JSON.stringify(set)})`);
});

test('#696 workflow: a baseline still missing after two returns goes on (no loop): the E2E step generates it', (t) => {
  const { path: visited } = walkAfterDevelop(t, { baselineOutput: MISSING, vars: { baseline_returns: '2' } });
  assert.ok(visited.includes('baseline_check'), visited.join(' > '));
  assert.equal(visited[visited.length - 1], 'code_review', visited.join(' > '));
});

test('#696 workflow: every baseline present, the run goes on from baseline_check to the review (control)', (t) => {
  const { path: visited } = walkAfterDevelop(t, { baselineOutput: { kind: 'visual_baselines', status: 'pass', missing: [], message: 'Every baseline is there.' } });
  assert.ok(visited.includes('baseline_check'), visited.join(' > '));
  assert.equal(visited[visited.length - 1], 'code_review', visited.join(' > '));
});

test('#696 workflow: develop\'s prompt shows baseline_check\'s message (the files and the update command) when it sent the run back', () => {
  const wf = engine().loadWorkflow(WORKFLOW);
  const develop = wf.steps.find((s) => s.id === 'develop');
  assert.match(String(develop.prompt), /previous_step == 'baseline_check'/);
  assert.match(String(develop.prompt), /steps\.baseline_check\.output\.message/);
});

test('#696 workflow: the code review treats a missing baseline of a new @visual scenario as blocking', () => {
  const wf = engine().loadWorkflow(WORKFLOW);
  const review = wf.steps.find((s) => s.id === 'code_review');
  assert.match(String(review.prompt), /\bmissing\b[^.]{0,80}\bbaselines?\b[\s\S]{0,240}\bblocking\b|\bblocking\b[\s\S]{0,240}\bmissing\b[^.]{0,80}\bbaselines?\b/i);
});
