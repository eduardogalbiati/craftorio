// #651: the declared outputs the SDLC post-flow reads render to the right values (feature, fix,
// write-doc), and a `type: object` input takes an output object as it is (chain-model convertValue).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { loadWorkflow } = require('../../engine/run/load');
const { render } = require('../../engine/run/templates');
const { convertValue } = require('@multiagent/shared/chain-model');

const WORKFLOWS = path.join(__dirname, '..', '..', '..', '..', 'workflows');
const value = (name, out, scope) => JSON.parse(render(loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`)).outputs[out].value, scope).trim());
const text = (name, out, scope) => render(loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`)).outputs[out].value, scope).trim();

test('#651 feature evidence: the suite, the E2E, the screenshots and the axe findings of the run', () => {
  const steps = {
    suite: { output: { status: 'pass' } },
    e2e: { output: { status: 'pass', message: '3 scenarios passed' } },
    evidence: { output: { screenshots: [{ path: 'evidence/a.png', caption: 'A' }] } },
    developer_screenshots: { output: { axe_findings: [] } },
  };
  assert.deepEqual(value('feature', 'evidence', { steps, run: {} }), {
    suite: 'pass', e2e: '3 scenarios passed', screenshots: [{ path: 'evidence/a.png', caption: 'A' }], axe: [],
  });
});

test('#651 feature evidence: a step that did not run is "not run" or empty', () => {
  assert.deepEqual(value('feature', 'evidence', { steps: {}, run: {} }), { suite: 'not run', e2e: 'not run', screenshots: [], axe: [] });
});

test('#651 fix outputs: the merged commit, the PR and the suite of the run', () => {
  const scope = { steps: { suite: { output: { status: 'pass' } }, ci: { output: { pr_url: 'https://x/pr/1' } } }, run: { issues: [], local_merge: { commit: 'abc' } } };
  assert.equal(text('fix', 'merged_commit', scope), 'abc');
  assert.equal(text('fix', 'pr_url', scope), 'https://x/pr/1');
  assert.deepEqual(value('fix', 'evidence', scope), { suite: 'pass', e2e: 'not run', screenshots: [], axe: [] });
  assert.equal(text('fix', 'pr_url', { steps: {}, run: {} }), '');
});

test('#651 write-doc issues: the filed issues, or an empty list', () => {
  const filed = [{ action: 'created', number: 7, url: 'https://x/7', title: 'Step 1' }];
  assert.deepEqual(value('write-doc', 'issues', { steps: { file_issues: { output: { filed } } }, run: {} }), filed);
  assert.deepEqual(value('write-doc', 'issues', { steps: {}, run: {} }), []);
});

test('#651 convertValue: an object input takes an object as it is, a JSON text parsed, nothing else', () => {
  const def = { type: 'object' };
  assert.deepEqual(convertValue({ suite: 'pass' }, def), { suite: 'pass' });
  assert.deepEqual(convertValue('{"suite":"pass"}', def), { suite: 'pass' });
  assert.equal(convertValue('not json', def), undefined);
  assert.equal(convertValue([1, 2], def), undefined);
});

// ---- sdlc-record's record prompt, rendered from the chained run's inputs ---------------------------------

const recordPrompt = (inputs) => {
  const wf = loadWorkflow(path.join(WORKFLOWS, 'sdlc-record.yaml'));
  const step = wf.steps.find((s) => s.id === 'record');
  return render(step.prompt, { inputs: { item: 'write-doc', base_branch: 'main', ...inputs }, run_id: 'r-1', steps: {} });
};

test('#651 sdlc-record\'s prompt shows the run, its commit, its PR, its issues and its evidence', () => {
  const text = recordPrompt({
    run: '20261103-101010-abcd1234',
    merged_commit: '1a2b3c4',
    pr_url: 'https://example.test/pr/7',
    issues: ['https://example.test/issues/12'],
    evidence: { suite: 'pass', e2e: '3 scenarios passed', screenshots: [{ path: 'evidence/a.png', caption: 'A' }], axe: [] },
  });
  assert.equal(text.includes('Record the Code & Build run 20261103-101010-abcd1234'), true);
  assert.equal(text.includes('merged commit: 1a2b3c4'), true);
  assert.equal(text.includes('PR / MR: https://example.test/pr/7'), true);
  assert.equal(text.includes('issues: https://example.test/issues/12'), true);
  assert.equal(text.includes('suite: pass'), true, 'the evidence is listed');
  assert.equal(text.includes('evidence/a.png'), true, 'the screenshots are listed');
  assert.equal(text.includes('docs/work/write-doc/plan.md'), true);
  assert.equal(text.includes('docs/work/write-doc/test.md'), true);
  assert.equal(text.includes('sdlc-record/write-doc-r-1'), true, 'the branch is named after the item and the run');
});

test('#651 sdlc-record\'s prompt says "none" for what the run did not give (no commit, PR, issues or evidence)', () => {
  const text = recordPrompt({ run: 'r-0', merged_commit: '', pr_url: '', issues: [] });
  assert.equal(text.includes('merged commit: none'), true);
  assert.equal(text.includes('PR / MR: none (local mode)'), true);
  assert.equal(text.includes('issues: none named'), true);
  assert.match(text, /evidence \(suite, e2e, screenshots, axe\):\s*\n\s*none\s*\n/);
  assert.equal(text.includes('null'), false, 'no "null" leaks into the prompt');
  assert.equal(text.includes('undefined'), false);
});

// ---- write-doc: the routes after the approval --------------------------------------------------------------

// the step the first transition whose condition holds goes to (a gate answered with `answer`)
const nextStep = (stepId, inputs, answer) => {
  const { evalExpr } = require('../../engine/workflow');
  const wf = loadWorkflow(path.join(WORKFLOWS, 'write-doc.yaml'));
  const step = wf.steps.find((s) => s.id === stepId);
  const scope = { inputs: { item: 'write-doc', ...inputs }, steps: {}, vars: {}, output: {}, ...answer };
  const tr = (step.transitions || []).find((x) => x.when === undefined || evalExpr(x.when, scope));
  return tr ? { goto: tr.goto, merge: tr.merge || null } : null;
};

test('#651 write-doc: accepting a plan merges it and goes on to file_issues, then the run ends', () => {
  assert.deepEqual(nextStep('approval', { document: 'plan' }, { choice: 'accept' }), { goto: 'file_issues', merge: 'local' });
  assert.deepEqual(nextStep('file_issues', { document: 'plan' }, {}), { goto: 'end', merge: null });
});

test('#651 write-doc: accepting an intent or a spec merges it and ends (no issue is filed)', () => {
  for (const document of ['intent', 'spec']) {
    assert.deepEqual(nextStep('approval', { document }, { choice: 'accept' }), { goto: 'end', merge: 'local' }, document);
  }
});

test('#651 write-doc: a plan whose merge was blocked, approved again, still files its issues', () => {
  assert.deepEqual(nextStep('merge_blocked', { document: 'plan' }, { approved: true, rejected: false }), { goto: 'file_issues', merge: 'local' });
  assert.deepEqual(nextStep('merge_blocked', { document: 'spec' }, { approved: true, rejected: false }), { goto: 'end', merge: 'local' });
});

test('#651 write-doc: Back to the edit and Stop never file issues for a plan', () => {
  assert.equal(nextStep('approval', { document: 'plan' }, { choice: 'revise' }).goto, 'edit');
  assert.equal(nextStep('approval', { document: 'plan' }, { choice: 'stop' }).goto, 'end');
});

// ---- the chain to sdlc-record: when a Code & Build run goes on --------------------------------------------

test('#651 a successful local feature/fix run (a merged commit) goes on to its chain; a failed one does not', () => {
  const { blockedReason } = require('@multiagent/shared/chain-model');
  for (const name of ['feature', 'fix']) {
    const outputDefs = loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`)).outputs;
    assert.equal(blockedReason({ status: 'success', outputs: { merged_commit: 'abc', pr_url: '' }, outputDefs, mock: false }), '', name);
    assert.notEqual(blockedReason({ status: 'failed', outputs: { merged_commit: 'abc' }, outputDefs, mock: false }), '', name);
  }
});

test('#651 a remote feature/fix run (a PR, no merged commit) pauses its chain: sdlc-record is started by hand', () => {
  const { blockedReason } = require('@multiagent/shared/chain-model');
  for (const name of ['feature', 'fix']) {
    const outputDefs = loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`)).outputs;
    const reason = blockedReason({ status: 'success', outputs: { merged_commit: '', pr_url: 'https://example.test/pr/7' }, outputDefs, mock: false });
    assert.equal(typeof reason === 'string' && reason.length > 0, true, `${name}: ${JSON.stringify(reason)}`);
  }
});
