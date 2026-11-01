// feature.yaml (remote) whole runs in mock mode (#305: one theme per slow file; #630: the old
// software-development.yaml): the team's merge on the platform (pr_review) and merged_commit; a run
// for several issues and the issue_not_done gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { root, runSoftwareDevelopment, GROUP } = require('../engine-helpers');

const REMOTE = { file: 'feature.yaml' };
const run = ({ inputs = {}, ...rest } = {}) => runSoftwareDevelopment({ ...REMOTE, ...rest, inputs: { mode: 'remote', ...inputs } });

test('feature.yaml (remote): rejecting the team review ends the run as failed at pr_review; nothing was merged, so merged_commit is empty', { timeout: 120000 }, async () => {
  const { finished, transitions } = await run({ answers: { pr_review: false } });
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /ended as failed at step "pr_review" \(rejected\)/);
  assert.ok(transitions.includes('ci>pr_review'), transitions.join(' '));
  assert.ok(!transitions.some((x) => /push_main|resolve_merge/.test(x)), 'remote mode never merges locally');
  // the template renders empty (no run.local_merge): computeOutputs keeps an empty text as null (#134)
  assert.equal(finished.summary.outputs.merged_commit, null);
});
// #134: merged_commit is the commit the RUN merged (run.local_merge.commit), never the branch's own
// last commit. In remote mode the team merges on the platform: the run records no merge.
test('feature.yaml (remote): merged_commit comes from run.local_merge, so a remote run that ends green records none', { timeout: 120000 }, async () => {
  const wf = loadWorkflow(path.join(root, 'workflows', 'feature.yaml'));
  assert.equal(wf.outputs.merged_commit.value, "{{ run.local_merge.commit if run.local_merge else '' }}");

  const { finished, transitions } = await run();
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(transitions.includes('verify_change>ci'), transitions.join(' '));
  assert.deepEqual(transitions.slice(-2), ['ci>pr_review', 'pr_review>end']);
  assert.ok(!finished.summary.local_merge, 'no local merge in remote mode');
  assert.equal(finished.summary.outputs.merged_commit, null);
});
test('feature.yaml (remote): a run for several issues records them, and its commits close each one', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await run({ issues: GROUP, inputs: { issues: GROUP.map((i) => i.url) } });
  assert.equal(finished.status, 'success', finished.error);
  const started = events.find((e) => e.type === 'workflow.started');
  assert.deepEqual(started.issues, GROUP);
  assert.deepEqual(finished.summary.issues, GROUP);
  assert.ok(!transitions.some((x) => x.endsWith('>issue_not_done')), 'every issue was done');
  const prompt = (step) => events.find((e) => e.type === 'session.message_sent' && e.step_id === step).prompt;
  assert.match(prompt('develop'), /This run implements 3 issues together[\s\S]*issues\/53, https:\/\/github\.com\/o\/r\/issues\/65, https:\/\/github\.com\/o\/r\/issues\/77/);
  assert.match(prompt('code_review'), /check the spec axis per issue/);
  assert.match(prompt('verify_change'), /verify each one the developer did/);
  // the PR/MR closes them through the developer's commits: one `Closes #<number>` line per issue
  const wf = loadWorkflow(path.join(root, 'workflows', 'feature.yaml'));
  assert.match(wf.agents.developer.system_prompt, /End every commit message with one line per issue this run implements,\s+`Closes #<number>`/);
});
test('feature.yaml (remote): an issue of the group that cannot be done stops at the owner\'s gate', { timeout: 120000 }, async () => {
  const group = { issues: GROUP, inputs: { issues: GROUP.map((i) => i.url).join('\n') } }; // a list typed in a form
  const stopped = await run({ ...group, mockSequences: { done: [false] }, answers: { issue_not_done: 'stop' } });
  const gate = stopped.events.find((e) => e.type === 'approval.requested' && e.step_id === 'issue_not_done');
  assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'stop']);
  assert.match(gate.message, /could not do every issue/);
  assert.equal(stopped.finished.status, 'failed');
  assert.deepEqual(stopped.events.find((e) => e.type === 'workflow.started').inputs.issues, GROUP.map((i) => i.url));

  // continue without it: asked once, even though later developer turns still report it
  const went = await run({ ...group, mockSequences: { done: [false], verdict: ['changes_requested', 'approved'] } });
  assert.equal(went.finished.status, 'success', went.finished.error);
  const asked = went.transitions.filter((x) => /issue_not_done/.test(x));
  // reached from develop, or from testid_check when the test writer wrote E2E scenarios (e2e_tests write_and_run)
  assert.equal(asked.filter((x) => /^(develop|testid_check)>issue_not_done$/.test(x)).length, 1, asked.join(' '));
  assert.equal(asked.filter((x) => x.startsWith('issue_not_done>')).length, 1, asked.join(' '));
  assert.ok(went.transitions.filter((x) => x === 'code_review>develop').length >= 1);
  // a run for one issue never asks
  const single = await run({ mockSequences: { done: [false] }, issues: [GROUP[0]], inputs: { issue: GROUP[0].url } });
  assert.ok(!single.transitions.some((x) => x.endsWith('>issue_not_done')));
});
