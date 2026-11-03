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
