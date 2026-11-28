// #130 workflows/refactor.yaml gets a `mode` input (local | remote | fork, default local), as feature.yaml
// and fix.yaml have. Acceptance tests, written before the code.
//
// The interface these tests assume:
// - refactor.yaml's input `mode`: the same enum, default, label, options and description as feature.yaml's
//   (feature's parsed input is the spec, not a copy of today's literals);
// - Remote and Fork + PR end through fragments/pr-pipeline.yaml as feature does: an approved review (the
//   `review` step, and the `review_blocked` human_approval gate's Approve) goes, without a local merge, to
//   the step feature's verified change goes to in that mode (ci), and refactor.yaml has the same
//   pr-pipeline steps feature has (ci, ci_failed, pr_monitor). Local keeps `merge: local`;
// - review_blocked stays a human_approval gate; in Remote its message says Approve pushes the branch /
//   opens the pull request, not that it merges into the local base;
// - the characterization (pin_behaviour, green_check `expect: green`, the developer's `edits_tests: false`
//   and `protect_files` on the pinned tests) is the same whatever the mode;
// - packages/engine/domains/project/project-run-defaults.js: a project set up with Remote / Fork gives
//   refactor.yaml's run `mode: remote` / `fork` through resolveRunInputs, with nothing typed;
// - the roadmap's ending of a refactor item (DefaultWorkflow.runEnding, what the card's badge shows) in a
//   Remote project is the pull request ('pr'), not 'local'.
// Each test loads the workflows itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { loadWorkflow, evalExpr, render } = require('../../engine/workflow');

const root = path.join(__dirname, '..', '..', '..', '..');
const loadBundled = (name) => loadWorkflow(path.join(root, 'workflows', `${name}.yaml`));
const refactorWf = () => loadBundled('refactor');
const stepOf = (wf, id) => {
  const step = (wf.steps || []).find((s) => String(s.id) === id);
  assert.ok(step, `step "${id}" in ${wf.metadata?.name}`);
  return step;
};
const runDefaults = () => require('../../domains/project/project-run-defaults');
const DefaultWorkflow = () => require('@craftorio/shared/default-workflow');

const MODES = ['local', 'remote', 'fork'];
const PR_STEPS_IN_FRAGMENT = () => Object.keys(yaml.load(fs.readFileSync(path.join(root, 'fragments', 'pr-pipeline.yaml'), 'utf8')).steps || {});

// the run's scope at the review, in `mode`, with an approved review
const scope = (mode, extra = {}) => ({
  inputs: { mode, base_branch: 'main', task: 'Split the click handler', target: 'src/app.js', issue: '', issues: [] },
  steps: {
    pin_behaviour: { output: { branch: 'refactor-app', tests_added: ['test/app.pin.test.js'], commit: 'abc1234', target_files: ['src/app.js'], summary: 'pinned' } },
    refactor: { output: { branch: 'refactor-app', summary: 'split it' } },
    develop: { output: { branch: 'refactor-app', summary: 'split it' } },
    review: { output: { verdict: 'changes_requested', same_behaviour: false, simpler_structure: true, findings: [] } },
  },
  vars: {},
  ...extra,
});
const APPROVED_REVIEW = { verdict: 'approved', same_behaviour: true, simpler_structure: true, before: { lines: 10, files_touched: 0 }, after: { lines: 8, files_touched: 1 }, findings: [] };
const landing = (step, s) => (step.transitions || []).find((tr) => evalExpr(String(tr.when ?? 'true'), s));

// where feature's verified change goes in `mode` (the pr-pipeline's first step in remote / fork)
function featureLanding(mode) {
  const s = { inputs: { mode, base_branch: 'main', task: 't', issue: '' }, steps: { develop: { output: { branch: 'b' } } }, output: { verdict: 'verified' }, vars: {} };
  return landing(stepOf(loadBundled('feature'), 'verify_change'), s);
}

// ---- 1. the input -------------------------------------------------------------------------------

test('#130 refactor.yaml declares the input mode: local, remote, fork, default local, as feature.yaml', () => {
  const mine = refactorWf().inputs?.mode;
  assert.ok(mine, 'refactor.yaml has an input `mode`');
  const feature = loadBundled('feature').inputs.mode;
  assert.deepEqual((mine.enum || []).map(String), ['local', 'remote', 'fork']);
  assert.equal(mine.default, 'local');
  assert.equal(mine.type, feature.type);
  assert.equal(mine.label, feature.label);
  assert.deepEqual(Object.entries(mine.options || {}).map(([k, v]) => `${k}=${v}`), Object.entries(feature.options).map(([k, v]) => `${k}=${v}`));
});

test('#130 refactor.yaml\'s mode input has the same description as feature.yaml\'s and fix.yaml\'s', () => {
  const mine = refactorWf().inputs?.mode;
  assert.ok(mine, 'refactor.yaml has an input `mode`');
  assert.equal(mine.description, loadBundled('feature').inputs.mode.description);
  assert.equal(mine.description, loadBundled('fix').inputs.mode.description);
});

// ---- 2. the run defaults ------------------------------------------------------------------------

const resolvedMode = (variant) => {
  const project = { id: 'widgets', workflows: [{ id: 'refactor', variant }] };
  const defaults = runDefaults().runDefaultsWith({ project, profile: null });
  const { values, sources } = runDefaults().resolveRunInputs({ typed: {}, roadmap: {}, project: defaults, workflow: refactorWf() });
  return [values.mode ?? null, sources.mode ?? null];
};

test('#130 a project set up with Remote runs refactor.yaml in mode remote, nothing typed', () => {
  assert.deepEqual(resolvedMode('remote-code'), ['remote', 'project']);
});

test('#130 a project set up with Fork + PR runs refactor.yaml in mode fork, nothing typed', () => {
  assert.deepEqual(resolvedMode('fork-code'), ['fork', 'project']);
});

test('#130 a project set up with Local runs refactor.yaml in mode local', () => {
  assert.equal(resolvedMode('local-code')[0], 'local');
});

// ---- 3. how an approved refactor lands, per mode ------------------------------------------------

test('#130 refactor.yaml has the pr-pipeline steps feature.yaml has (push, PR/MR, CI, PR monitor)', () => {
  const fragment = PR_STEPS_IN_FRAGMENT();
  const featureSteps = loadBundled('feature').steps.map((s) => String(s.id)).filter((id) => fragment.includes(id));
  assert.ok(featureSteps.length > 0, 'feature.yaml uses pr-pipeline steps');
  const mine = refactorWf().steps.map((s) => String(s.id));
  assert.deepEqual(featureSteps.filter((id) => !mine.includes(id)), []);
});

for (const mode of ['remote', 'fork']) {
  test(`#130 refactor.yaml (${mode}): an approved review goes to the pull-request half, as feature's verified change, with no local merge`, () => {
    const expected = featureLanding(mode);
    assert.ok(expected && expected.goto, `feature's landing in ${mode}`);
    const tr = landing(stepOf(refactorWf(), 'review'), scope(mode, { output: APPROVED_REVIEW }));
    assert.ok(tr, 'a transition takes the approved review');
    assert.deepEqual([tr.merge ?? null, tr.goto], [null, expected.goto]);
  });

  test(`#130 refactor.yaml (${mode}): review_blocked's Approve goes to the pull-request half, with no local merge`, () => {
    const expected = featureLanding(mode);
    const tr = landing(stepOf(refactorWf(), 'review_blocked'), scope(mode, { approved: true, rejected: false }));
    assert.ok(tr, 'a transition takes the approval');
    assert.deepEqual([tr.merge ?? null, tr.goto], [null, expected.goto]);
  });
}

test('#130 refactor.yaml (local): an approved review and review_blocked\'s Approve still merge locally', () => {
  const wf = refactorWf();
  const review = landing(stepOf(wf, 'review'), scope('local', { output: APPROVED_REVIEW }));
  const blocked = landing(stepOf(wf, 'review_blocked'), scope('local', { approved: true, rejected: false }));
  assert.deepEqual([review.merge, review.goto, blocked.merge, blocked.goto], ['local', 'end', 'local', 'end']);
});

test('#130 refactor.yaml: review_blocked is a human_approval gate in every mode', () => {
  const wf = refactorWf();
  for (const mode of MODES) {
    const step = stepOf(wf, 'review_blocked');
    const ts = (step.transitions || []).map((tr) => evalExpr(String(tr.when ?? 'true'), scope(mode, { approved: true, rejected: false })));
    assert.deepEqual([mode, step.type, ts.includes(true)], [mode, 'human_approval', true]);
  }
});

test('#130 refactor.yaml (remote): review_blocked says Approve pushes the branch and opens the pull request, not a local merge', () => {
  const text = render(String(stepOf(refactorWf(), 'review_blocked').message), scope('remote'));
  assert.match(text, /pull request|push/i);
  assert.doesNotMatch(text, /into the local|nothing is pushed/i);
});

test('#130 refactor.yaml (local): review_blocked still says Approve merges into the local base', () => {
  const text = render(String(stepOf(refactorWf(), 'review_blocked').message), scope('local'));
  assert.match(text, /merge the branch into the local main/i);
});

// ---- 4. the characterization, whatever the mode -------------------------------------------------

test('#130 refactor.yaml: every mode starts by pinning the behaviour, and a green check goes on to the refactor', () => {
  const wf = refactorWf();
  const green = stepOf(wf, 'green_check');
  const seen = MODES.map((mode) => {
    const pin = landing(stepOf(wf, 'pin_behaviour'), scope(mode, { output: { tests_added: ['test/app.pin.test.js'] } }));
    const pass = landing(green, scope(mode, { output: { status: 'pass' } }));
    const fail = landing(green, scope(mode, { output: { status: 'fail' } }));
    return [mode, String(wf.steps[0].id), pin.goto, green.type, green.expect, pass.goto, fail.goto];
  });
  assert.deepEqual(seen, MODES.map((mode) => [mode, 'pin_behaviour', 'green_check', 'suite', 'green', 'refactor', 'pin_behaviour']));
});

test('#130 refactor.yaml: no test may change in any mode (edits_tests false, the pinned tests protected)', () => {
  const dev = refactorWf().agents.developer;
  const protectedFiles = (dev.protect_files || []).map((f) => render(String(f), scope('remote')).trim());
  assert.deepEqual([dev.edits_tests, protectedFiles.includes('test/app.pin.test.js')], [false, true]);
  // the step the refactor runs on is the same in every mode
  for (const mode of MODES) {
    const green = landing(stepOf(refactorWf(), 'green_check'), scope(mode, { output: { status: 'pass' } }));
    assert.equal(stepOf(refactorWf(), green.goto).agent, 'developer');
  }
});

// ---- 6. the roadmap's ending of a refactor item ---------------------------------------------------

const endingIn = (variant, itemInputs = {}) => {
  const wf = refactorWf();
  const project = { id: 'widgets', workflows: [{ id: 'refactor', variant }] };
  const defaults = runDefaults().runDefaultsWith({ project, profile: null });
  const resolved = runDefaults().resolveRunInputs({ typed: {}, roadmap: itemInputs, project: defaults, workflow: wf });
  return DefaultWorkflow().runEnding(wf, resolved);
};

test('#130 roadmap: a refactor item in a Remote project ends in a pull request, not a local merge', () => {
  assert.equal(endingIn('remote-code'), 'pr');
});

test('#130 roadmap: a refactor item in a Fork + PR project ends in a fork pull request', () => {
  assert.equal(endingIn('fork-code'), 'fork');
});

test('#130 roadmap: a refactor item in a Local project still ends in a local merge', () => {
  assert.equal(endingIn('local-code'), 'local');
});
