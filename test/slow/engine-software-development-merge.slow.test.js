// software-development whole runs in mock mode (#305: one theme per slow file): merge, deploy and merged_commit; a run for several issues and the issue_not_done gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../../src/engine/workflow');
const evidence = require('../../src/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { root, runSoftwareDevelopment, GROUP } = require('../engine-helpers');

test('software-development: rejecting the merge ends the run as cancelled; deploy_prod never ran, so merged_commit is empty', { timeout: 120000 }, async () => {
  const { finished } = await runSoftwareDevelopment({ mockSequences: { preview_status: ['success'] }, answers: { approve_merge: false } });
  assert.equal(finished.status, 'cancelled');
  assert.match(finished.error, /ended as cancelled at step "approve_merge" \(rejected\)/);
  assert.equal(finished.summary.steps.deploy_prod.visits, 0);
  // the template renders empty (no steps.deploy_prod.output): computeOutputs keeps an empty text as
  // null, like any other output the run never set (#134: still falsy, blockedReason treats it the same).
  assert.equal(finished.summary.outputs.merged_commit, null);
});
// #134 (fixed by 3a5e236): the squash merge's commit the deployer reads from the platform, never the
// branch's own last commit (develop.output.commit_sha), which is not what the base branch received.
test('software-development: merged_commit is the deploy step\'s merge_commit, not the branch\'s own commit_sha', { timeout: 120000 }, async () => {
  const wf = loadWorkflow(path.join(root, 'workflows', 'software-development.yaml'));
  assert.deepEqual(wf.steps.find((s) => s.id === 'deploy_prod').output_schema.required, ['deploy_status', 'merge_commit']);

  const { finished } = await runSoftwareDevelopment({ mockSequences: { preview_status: ['success'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(finished.summary.outputs.merged_commit, finished.summary.steps.deploy_prod.output.merge_commit);
  assert.notEqual(finished.summary.outputs.merged_commit, finished.summary.steps.develop.output.commit_sha);
});
test('software-development: a run for several issues records them, and its PR/MR closes each one', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { preview_status: ['success'] }, issues: GROUP, inputs: { issues: GROUP.map((i) => i.url) },
  });
  assert.equal(finished.status, 'success', finished.error);
  const started = events.find((e) => e.type === 'workflow.started');
  assert.deepEqual(started.issues, GROUP);
  assert.deepEqual(finished.summary.issues, GROUP);
  assert.ok(!transitions.includes('develop>issue_not_done'), 'every issue was done');
  const prompt = (step) => events.find((e) => e.type === 'session.message_sent' && e.step_id === step).prompt;
  assert.match(prompt('develop'), /This run implements 3 issues together[\s\S]*issues\/53, https:\/\/github\.com\/o\/r\/issues\/65, https:\/\/github\.com\/o\/r\/issues\/77/);
  assert.match(prompt('code_review'), /check the spec axis per issue/);
  assert.match(prompt('verify_change'), /verify each one the developer did/);
  assert.match(prompt('ci'), /one line `Closes #<number>` per issue/);
});
test('software-development: an issue of the group that cannot be done stops at the owner\'s gate', { timeout: 120000 }, async () => {
  const group = { issues: GROUP, inputs: { issues: GROUP.map((i) => i.url).join('\n') } }; // a list typed in a form
  const stopped = await runSoftwareDevelopment({ ...group, mockSequences: { done: [false] }, answers: { issue_not_done: 'stop' } });
  const gate = stopped.events.find((e) => e.type === 'approval.requested' && e.step_id === 'issue_not_done');
  assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'stop']);
  assert.match(gate.message, /could not do every issue/);
  assert.equal(stopped.finished.status, 'failed');
  assert.deepEqual(stopped.events.find((e) => e.type === 'workflow.started').inputs.issues, GROUP.map((i) => i.url));

  // continue without it: asked once, even though later developer turns still report it
  const went = await runSoftwareDevelopment({ ...group, mockSequences: { done: [false], preview_status: ['success'], verdict: ['changes_requested', 'approved'] } });
  assert.equal(went.finished.status, 'success', went.finished.error);
  assert.deepEqual(went.transitions.filter((x) => /issue_not_done/.test(x)), ['develop>issue_not_done', 'issue_not_done>code_review']);
  assert.ok(went.transitions.filter((x) => x === 'code_review>develop').length >= 1);
  // a run for one issue never asks
  const single = await runSoftwareDevelopment({ mockSequences: { done: [false], preview_status: ['success'] }, issues: [GROUP[0]], inputs: { issue: GROUP[0].url } });
  assert.ok(!single.transitions.includes('develop>issue_not_done'));
});
