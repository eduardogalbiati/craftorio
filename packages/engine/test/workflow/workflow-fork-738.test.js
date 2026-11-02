// #738: the bundled feature and fix workflows (workflows/feature.yaml, workflows/fix.yaml, their fragments)
// get the Fork + PR mode. Acceptance tests, written before the code.
//
// The interface these tests assume:
// - input `mode` offers fork (besides local and remote);
// - orchestrator.worktree.fork: a template rendering true in fork mode only (checkout.js passes it on);
// - in fork mode a verified change (verify_change) goes, without a local merge, to a step whose prompt
//   pushes the run's branch to `origin` (the fork), opens the PR against the original (`upstream`'s base
//   branch, <fork owner>:<branch> → upstream:<base>), says never to push to upstream, and follows the
//   project's CONTRIBUTING.md / PR template; that step, or one it goes to, waits for the PR's CI (wait probe
//   pr_checks).
// Each test loads the workflow itself: before the code exists each test fails on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const root = path.join(__dirname, '..', '..', '..', '..');
const engine = () => require('../../engine/run/load');
const templates = () => require('../../engine/run/templates');

const loadBundled = (name) => engine().loadWorkflow(path.join(root, 'workflows', `${name}.yaml`));
const stepOf = (wf, id) => (wf.steps || []).find((s) => String(s.id) === id);

// the run's scope in a mode, after develop and a verified change
const scope = (mode) => ({
  inputs: { mode, base_branch: 'main', issue: 'https://github.com/acme/widgets/issues/7', task: 'the task' },
  steps: { develop: { output: { branch: 'feat-x', summary: 'the summary' } } },
  output: { verdict: 'verified' },
});

// the first transition of verify_change whose `when` holds for a verified change in `mode`
function landing(wf, mode) {
  const step = stepOf(wf, 'verify_change');
  return (step.transitions || []).find((tr) => templates().evalExpr(String(tr.when ?? 'true'), scope(mode)));
}

const offered = (input) => [...(Array.isArray(input?.enum) ? input.enum : []), ...Object.keys(input?.options || {})].map(String);

for (const name of ['feature', 'fix']) {
  test(`#738 ${name}.yaml: the mode input offers fork`, () => {
    const values = offered(loadBundled(name).inputs?.mode);
    assert.equal(values.includes('fork'), true, JSON.stringify(values));
  });

  test(`#738 ${name}.yaml: worktree.fork renders true in fork mode only`, () => {
    const wt = loadBundled(name).orchestrator?.worktree || {};
    assert.notEqual(wt.fork, undefined, 'the worktree config has a fork key');
    const on = (mode) => templates().render(String(wt.fork), scope(mode)).trim().toLowerCase();
    assert.equal(on('fork'), 'true');
    assert.equal(on('remote'), 'false');
    assert.equal(on('local'), 'false');
  });

  test(`#738 ${name}.yaml: in fork mode a verified change is not merged locally nor pushed as main`, () => {
    const tr = landing(loadBundled(name), 'fork');
    assert.ok(tr, 'a transition takes the verified change');
    assert.equal(tr.merge ?? null, null, JSON.stringify(tr));
    assert.notEqual(tr.goto, 'push_main');
  });

  test(`#738 ${name}.yaml: the fork-mode PR step pushes to origin and opens the PR against upstream, never pushing upstream`, () => {
    const wf = loadBundled(name);
    const step = stepOf(wf, landing(wf, 'fork').goto);
    assert.ok(step, 'the step exists');
    const text = templates().render(String(step.prompt || ''), scope('fork'));
    assert.match(text, /push[^\n]*\borigin\b/i, text);
    assert.match(text, /upstream/i, text);
    assert.match(text, /never push[^\n]*upstream/i, text);
  });

  test(`#738 ${name}.yaml: the fork-mode PR follows the project's CONTRIBUTING.md and PR template`, () => {
    const wf = loadBundled(name);
    const step = stepOf(wf, landing(wf, 'fork').goto);
    const text = templates().render(String(step.prompt || ''), scope('fork'));
    assert.match(text, /CONTRIBUTING/, text);
    assert.match(text, /template/i, text);
  });

  test(`#738 ${name}.yaml: in fork mode the run waits for the upstream PR's CI`, () => {
    const wf = loadBundled(name);
    const seen = new Set();
    let todo = [landing(wf, 'fork').goto];
    for (let hop = 0; hop < 3 && todo.length; hop++) {
      const next = [];
      for (const id of todo) {
        if (seen.has(id)) continue;
        seen.add(id);
        for (const tr of stepOf(wf, id)?.transitions || []) if (tr.goto) next.push(tr.goto);
      }
      todo = next;
    }
    const waits = [...seen].filter((id) => stepOf(wf, id)?.wait?.probe === 'pr_checks');
    assert.notDeepEqual(waits, [], `the steps reached: ${JSON.stringify([...seen])}`);
  });
}
