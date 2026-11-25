// #39: the Run screen of an issue run on a local backlog (git_platform recorded as `local`) names no platform, neither
// as a pill nor as a key / value; a run on a platform keeps its pill. Seam: the whole page's #run-summary.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const ISSUE = {
  file: 'issue.yaml', name: 'issue', steps: [], agents: {},
  inputs: {
    request: { label: 'Request', type: 'string', default: '' },
    git_platform: { type: 'string', enum: ['gh', 'gl'], default: 'gh', label: 'Platform', options: { gh: 'GitHub', gl: 'GitLab', local: 'Local' } },
  },
};

// `known`: the workflow is in the workspace (pills); without it every input is a key / value
async function summary(gitPlatform, { known = true } = {}) {
  const page = await loadPage({ api: { listRuns: async () => ({ runs: [] }) } });
  page.sandbox.__run = { id: '20261125-100000-issue001', workflow: 'issue', file: 'issue.yaml', status: 'success', mock: true, inputs: { request: 'Export the list', git_platform: gitPlatform }, steps: {}, order: [] };
  page.run(`state.workflows = ${JSON.stringify(known ? [ISSUE] : [])}; state.view = "run"; state.runs.set(__run.id, { ...newRunView(), run: __run, past: true }); state.runId = __run.id; renderRunSummary();`);
  await settle(20);
  const text = textOf(page.$('#run-summary'));
  assert.match(text, /Export the list/, 'the summary shows the run\'s inputs');
  const pills = Array.from(page.document.querySelectorAll('#run-summary [data-testid="input-pill"]')).map((el) => textOf(el).trim());
  return { text, pills: pills.filter((p) => /platform/i.test(p)) };
}

test('#39 a run on a local backlog shows no platform pill', async () => {
  const { text, pills } = await summary('local');
  assert.deepEqual(pills, []);
  assert.doesNotMatch(text, /platform/i);
});

test('#39 a run on a local backlog names no platform when its workflow is no longer in the workspace', async () => {
  assert.doesNotMatch((await summary('local', { known: false })).text, /platform/i);
});

test('#39 a run on a platform keeps its pill (guard)', async () => {
  const { pills } = await summary('gl');
  assert.equal(pills.length, 1);
  assert.match(pills[0], /GitLab/);
});
