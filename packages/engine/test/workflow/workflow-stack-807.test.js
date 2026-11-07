// #807 a stacked stage's PR targets the previous stage's branch and names the PR it builds on
// (fragments/pr-pipeline.yaml, its ci and pr_open steps). Acceptance tests, written before the code.
//
// The interface these tests assume: outside fork mode, with inputs.parent_branch (set by the roadmap for a
// stacked item) the step's prompt opens the PR against that branch (its base: `--base <parent_branch>`)
// and names the parent PR (inputs.parent_pr) it builds on; without it, the base stays inputs.base_branch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { render } = require('../../engine/run/templates');

const FRAGMENT = path.join(__dirname, '..', '..', '..', '..', 'fragments', 'pr-pipeline.yaml');
const stepOf = (id) => (yaml.load(fs.readFileSync(FRAGMENT, 'utf8')).steps || {})[id];
const scope = (inputs) => ({
  inputs: { mode: 'remote', base_branch: 'main', issue: 'https://github.com/acme/widgets/issues/7', task: 'the task', parent_branch: '', parent_pr: '', ...inputs },
  steps: { develop: { output: { branch: 'feat-x', summary: 'the summary' } } },
});
const prompt = (id, inputs) => render(String(stepOf(id)?.prompt || ''), scope(inputs));
const STACKED = { parent_branch: 'feat/stage-1', parent_pr: 'https://github.com/acme/widgets/pull/12' };

for (const id of ['ci', 'pr_open']) {
  test(`#807 ${id}: a stacked stage's PR targets the parent's branch and names the PR it builds on`, () => {
    const text = prompt(id, STACKED);
    assert.match(text, /--base feat\/stage-1\b/, text);
    assert.match(text, /https:\/\/github\.com\/acme\/widgets\/pull\/12/, text);
  });
}

test('#807 pr_open: a stage stacked on nothing keeps the project\'s base and names no parent', () => {
  const text = prompt('pr_open', {});
  assert.doesNotMatch(text, /feat\/stage-1|pull\/12/, text);
  assert.match(text, /base `main`/, text);
});
