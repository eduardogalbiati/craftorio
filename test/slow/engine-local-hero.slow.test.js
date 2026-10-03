const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../../src/engine/workflow');
const evidence = require('../../src/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { root } = require('../engine-helpers');

test('e2e-release workflow: a simulated run fails once, fixes it (developer, review), passes, and approves the merge', { timeout: 60000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'e2e-release.yaml'),
    inputs: { task: 'Release check', repo_path: root },
    mock: true, runsDir,
    mockSequences: { verdict: ['approved'] },
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
  assert.deepEqual(visited, ['e2e', 'fix', 'review', 'e2e', 'approve_fixes']);
  const e2eOutputs = events.filter((e) => e.type === 'step.finished' && e.step_id === 'e2e').map((e) => e.output);
  assert.deepEqual(e2eOutputs.map((o) => o.e2e_status), ['fail', 'pass']);
  // the developer only went through the fix loop once (max_rounds default: 2)
  assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'e2e_failed'));
});
test('local hero workflow: a simulated run merges right after verify_change and ends as success', { timeout: 120000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({ file: path.join(root, 'workflows', 'software-development-local-hero.yaml'), inputs: { task: 'Engine test', repo_path: root }, mock: true, runsDir });
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
  assert.ok(transitions.includes('verify_change>end'), transitions.join(' '));
  // no gate on the way to the merge; in simulation the merge is skipped, never run
  assert.ok(!events.some((e) => e.type === 'approval.requested' && ['verify_change', 'resolve_merge', 'merge_blocked'].includes(e.step_id)));
  assert.ok(events.some((e) => e.type === 'action.executed' && e.command === 'merge: local' && e.skipped));
});
test('local hero workflow: validated mode stops at developer_check with a local diff_base (no origin/ prefix); auto mode skips it', { timeout: 120000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'software-development-local-hero.yaml'),
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
  // E2E scenarios (#143): local-hero points "none yet" readers to the run's summary, not a merge gate
  assert.match(gate.message, /Dev\/QA: read the E2E scenarios and the screenshots/);
  // #203: e2e_tests defaults to "write" (not "write_and_run"), so the test writer only writes them
  assert.match(gate.message, /E2E scenarios: none yet\. The test writer writes them after the code review; they show in the run's summary\./);
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  assert.deepEqual(transitions.filter((x) => /developer_check|developer_screenshots/.test(x)), [
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
  ]);
});
test('local hero workflow: a successful run saves <run>/e2e/scenarios.feature and scenarios.json; the test step reports them pending, never run (#199)', { timeout: 120000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({ file: path.join(root, 'workflows', 'software-development-local-hero.yaml'), inputs: { task: 'Engine test', repo_path: root }, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const testOutputs = events.filter((e) => e.type === 'step.finished' && e.step_id === 'test').map((e) => e.output);
  assert.equal(testOutputs.length, 2, 'tests_status fails once by default, then passes on retry');
  for (const output of testOutputs) {
    assert.ok(output.scenarios.length, 'the test step still reports scenarios');
    assert.ok(output.scenarios.every((s) => s.status === 'pending'), 'a development run writes scenarios, it never runs them (#199)');
  }

  assert.ok(events.some((e) => e.type === 'file.saved' && e.step_id === 'test' && /e2e[\\/]scenarios\.feature$/.test(e.path)));
  assert.match(fs.readFileSync(path.join(run.runDir, 'e2e', 'scenarios.feature'), 'utf8'), /# pending/);
  const saved = JSON.parse(fs.readFileSync(path.join(run.runDir, 'e2e', 'scenarios.json'), 'utf8'));
  assert.ok(saved.scenarios.every((s) => s.status === 'pending'));
  assert.equal(saved.counts.pending, saved.counts.total);
  fs.rmSync(runsDir, { recursive: true, force: true });
});
