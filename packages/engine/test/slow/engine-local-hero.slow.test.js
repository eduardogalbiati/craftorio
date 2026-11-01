const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../../engine/workflow');
const evidence = require('../../domains/evidence/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { root } = require('../engine-helpers');

test('release workflow: a simulated E2E suite fails once, the developer fixes it, both suites pass again, the review writes the summary and the run ships', { timeout: 60000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'release.yaml'),
    inputs: { task: 'Release check', repo_path: root },
    mock: true, runsDir,
    mockSequences: { verdict: ['approved'], suite: { e2e: ['fail', 'pass'] } },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  fs.rmSync(runsDir, { recursive: true, force: true });
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const visited = events.filter((e) => e.type === 'step.finished').map((e) => e.step_id);
  // workflows/release.yaml: version, unit, e2e (red) > fix > unit, e2e (green) > review (after a fix) > ship
  assert.deepEqual(visited, ['version', 'unit', 'e2e', 'fix', 'unit', 'e2e', 'review', 'ship']);
  const e2eOutputs = events.filter((e) => e.type === 'step.finished' && e.step_id === 'e2e').map((e) => e.output);
  assert.deepEqual(e2eOutputs.map((o) => o.status), ['fail', 'pass']);
  // the developer only went through the fix loop once (max_rounds), so no regression_failed gate
  assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'regression_failed'));
});
test('feature workflow (local mode): a simulated run merges right after verify_change, pushes the local base at push_main and ends as success', { timeout: 120000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({ file: path.join(root, 'workflows', 'feature.yaml'), inputs: { task: 'Engine test', repo_path: root }, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  fs.rmSync(runsDir, { recursive: true, force: true });
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  // #630: the merge is on verify_change's transition; push_main (the developer's git push) ends the run
  assert.deepEqual(transitions.slice(-2), ['verify_change>push_main', 'push_main>end'], transitions.join(' '));
  // no gate on the way to the merge; in simulation the merge is skipped, never run
  assert.ok(!events.some((e) => e.type === 'approval.requested' && ['verify_change', 'resolve_merge', 'merge_blocked'].includes(e.step_id)));
  assert.ok(events.some((e) => e.type === 'action.executed' && e.command === 'merge: local' && e.skipped));
});
test('feature workflow (local mode): validated mode stops at developer_check with a local diff_base (no origin/ prefix); auto mode skips it', { timeout: 120000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'feature.yaml'),
    inputs: { task: 'Engine test', repo_path: root, mode: 'validated' },
    mock: true, runsDir,
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  fs.rmSync(runsDir, { recursive: true, force: true });
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
  assert.ok(gate);
  assert.equal(gate.diff_base, 'main');
  assert.equal(gate.work_dir, root);
  // E2E scenarios (#143): the gate lists them for the Dev/QA
  assert.match(gate.message, /Dev\/QA: read the E2E scenarios and the screenshots/);
  // #223: the scenarios are written first, with the acceptance tests, so the gate already lists them
  assert.match(gate.message, /E2E scenarios \(written by the test writer[^)]*\): /);
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  // #246/#404: develop's commit goes through testid_check, the screenshots and rule_check before the
  // owner's gate; after the owner approved, a review fix round skips the gate (rule_check>code_review)
  const gateRoute = transitions.filter((x) => /developer_check|developer_screenshots/.test(x));
  assert.deepEqual(gateRoute.slice(0, 4), [
    'testid_check>developer_screenshots', 'developer_screenshots>rule_check', 'rule_check>developer_check', 'developer_check>code_review',
  ]);
  assert.equal(transitions.filter((x) => x.endsWith('>developer_check')).length, 1, 'the owner is asked once');
});
test('feature workflow (local mode): a successful run saves <run>/e2e/scenarios.feature and scenarios.json; the acceptance tests step reports them pending (#199, #223)', { timeout: 120000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({ file: path.join(root, 'workflows', 'feature.yaml'), inputs: { task: 'Engine test', repo_path: root }, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  // #223: the scenarios are written first, with the acceptance tests (no longer by the test step)
  const acceptanceOutputs = events.filter((e) => e.type === 'step.finished' && e.step_id === 'acceptance_tests').map((e) => e.output);
  assert.ok(acceptanceOutputs.length, 'acceptance_tests ran');
  for (const output of acceptanceOutputs) {
    assert.ok(output.scenarios.length, 'the acceptance tests step reports scenarios');
    assert.ok(output.scenarios.every((s) => s.status === 'pending'), 'scenarios written first are pending (#199)');
  }

  assert.ok(events.some((e) => e.type === 'file.saved' && e.step_id === 'acceptance_tests' && /e2e[\\/]scenarios\.feature$/.test(e.path)));
  assert.match(fs.readFileSync(path.join(run.runDir, 'e2e', 'scenarios.feature'), 'utf8'), /# pending/);
  const saved = JSON.parse(fs.readFileSync(path.join(run.runDir, 'e2e', 'scenarios.json'), 'utf8'));
  assert.ok(saved.scenarios.every((s) => s.status === 'pending'));
  assert.equal(saved.counts.pending, saved.counts.total);
  fs.rmSync(runsDir, { recursive: true, force: true });
});
