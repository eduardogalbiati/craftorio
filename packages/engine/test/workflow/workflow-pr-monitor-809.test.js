// #809 "A run waits in a PR monitor and ends on the merge, with no Approve": the last step of the pull-request
// half (fragments/pr-pipeline.yaml) is a monitor `pr_monitor`, not the `pr_review` human_approval gate.
// Acceptance tests, written before the code, on the YAML and the bundled workflows as loaded (loadWorkflow).
//
// The interface these tests assume:
// - fragments/pr-pipeline.yaml has a step `pr_monitor` whose `type` is a step type without an agent
//   (load.js MACHINE_STEP_TYPES, not human_approval), with no prompt and no agent: no tokens, no Approve.
// - It has no `pr_review` step any more; workflows/feature.yaml, workflows/fix.yaml and
//   .multiagent/workflows/ai-development-remote-hero.yaml use `pr_monitor` instead (steps, goto,
//   on_exhausted, groups), and nothing in them goes to `pr_review`.
// - The monitor never touches the PR: none of its transitions runs an action, a merge, a precheck or a ship
//   (stopping it or ending it leaves the PR as it is); one of them ends the run as failed (PR closed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { loadWorkflow } = require('../../engine/workflow');
const { MACHINE_STEP_TYPES } = require('../../engine/run/load');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const FRAGMENT = path.join(ROOT, 'fragments', 'pr-pipeline.yaml');
const fragmentSteps = () => yaml.load(fs.readFileSync(FRAGMENT, 'utf8')).steps || {};

test('#809 pr-pipeline fragment: pr_monitor is a step with no agent and no prompt; pr_review and its "Approve to end the run" are gone', () => {
  const steps = fragmentSteps();
  const m = steps.pr_monitor || {};
  assert.deepEqual(
    ['pr_monitor' in steps, MACHINE_STEP_TYPES.includes(m.type), m.type === 'human_approval', m.agent ?? null, m.prompt ?? null, 'pr_review' in steps],
    [true, true, false, null, null, false],
  );
  assert.doesNotMatch(fs.readFileSync(FRAGMENT, 'utf8'), /Approve to end the run/i);
});

test('#809 pr-pipeline fragment: the monitor never touches the PR (no action, merge, precheck or ship) and a closed PR ends the run failed', () => {
  const ts = fragmentSteps().pr_monitor?.transitions || [];
  const touching = ts.filter((t) => t.action || t.merge || t.precheck || t.ship || t.delegate).length;
  const failed = ts.some((t) => t.goto === 'end' && t.status === 'failed');
  assert.deepEqual([ts.length > 0, touching, failed], [true, 0, true]);
});

const WORKFLOWS = ['workflows/feature.yaml', 'workflows/fix.yaml', '.multiagent/workflows/ai-development-remote-hero.yaml'];
const targetsOf = (wf) => wf.steps.flatMap((s) => [
  ...(s.transitions || []).flatMap((t) => [t.goto, t.on_exhausted, t.on_error]),
  s.goal?.on_exhausted, s.on_exhausted,
]).filter(Boolean);

for (const file of WORKFLOWS) {
  test(`#809 ${file}: ends in the pr_monitor step (no agent), with no pr_review gate and nothing going to pr_review`, () => {
    const wf = loadWorkflow(path.join(ROOT, file));
    const m = wf.steps.find((s) => s.id === 'pr_monitor');
    const gate = wf.steps.find((s) => s.id === 'pr_review' || (s.type === 'human_approval' && /Approve to end the run/i.test(String(s.message || ''))));
    const grouped = (wf.groups || []).flatMap((g) => g.steps || []);
    assert.deepEqual(
      [!!m, MACHINE_STEP_TYPES.includes(m?.type), m?.type === 'human_approval', m?.agent ?? null, !!gate, targetsOf(wf).includes('pr_review'), grouped.includes('pr_review')],
      [true, true, false, null, false, false, false],
    );
  });
}
