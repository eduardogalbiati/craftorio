// #807 the Roadmap's notice under a stage waiting for its merge (views/backlog/backlog-roadmap.js), drawn on
// the whole page (packages/ui-kit/test/agent-chat-page-harness.js, as #804's tests). Acceptance tests,
// written before the code.
//
// The contract (shared with the E2E writer):
// - under (inside) the stage's section, `roadmap-merge-wait-notice` when RoadmapModel.mergeWait gives one:
//   it says the roadmap waits for that merge, `roadmap-merge-wait-pr-link` links the PR (href = pr.url);
// - `roadmap-merge-wait-move-on` (its text or hint says the next stage starts without that work) calls
//   window.api.roadmapItem(projectId, itemId, 'skip') (#797's go on without the merge);
// - `roadmap-merge-wait-stack` calls window.api.roadmapItem(projectId, itemId, 'stack'); not drawn in
//   Fork + PR mode; past 3 PRs `roadmap-merge-wait-stack-refused` says why and nothing is called;
// - `roadmap-merge-wait-overlap` names the files the next stage expects to change that the waiting one
//   changes too (the items' `files`).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('@multiagent/ui-kit/test/agent-chat-page-harness');
const { textOf } = require('@multiagent/ui-kit/test/mini-dom');
const H = require('../roadmap-status-helpers');

const PR = (number) => ({ number, url: `https://github.com/o/r/pull/${number}`, state: 'open' });
const item = (id, number, title, over = {}) => ({ id, status: 'planned', workflow: 'w.yaml', workflowName: 'w', inputs: { mode: 'remote' }, mock: false, issues: [H.ref(number, title)], runId: null, runs: [], error: null, ...over });
const waiting = (id, number, title, over = {}) => item(id, number, title, { status: 'waiting_merge', runId: `r-${id}`, runs: [`r-${id}`], pr: PR(number + 6), ...over });
const stage = (id, items, over = {}) => ({ id, name: '', note: '', items, ...over });
const data = (stages) => ({ roadmap: { state: 'running', pausedBy: null, error: null, stages }, issues: [] });
// stage 1 waits for PR #7, stage 2 not started
const TWO = (first = {}, next = {}) => data([stage('s1', [waiting('i1', 1, 'Login page', first)]), stage('s2', [item('i2', 2, 'Logout button', next)])]);

// the Roadmap drawn in the page; every window.api.roadmapItem call as [projectId, itemId, action]
async function open(d) {
  const calls = [];
  const page = await loadPage({
    api: { roadmapItem: async (projectId, itemId, action) => { calls.push([String(projectId), String(itemId), String(action)]); return d; } },
  });
  const R = page.sandbox.BacklogRoadmap;
  const host = page.$('#bl-list');
  const ctx = { projectId: 'p1', setData() {}, setError() {}, render: () => { host.innerHTML = R.html(d, () => {}, { showAll: true, since: 'total' }); } };
  ctx.render();
  host.addEventListener('click', (e) => { R.onClick(e, ctx, d); });
  return { page, calls };
}
const inStage = (s, n, testid) => s.page.$(`#bl-list [data-testid="roadmap-stage"][data-stage="${n}"] [data-testid="${testid}"]`);
const any = (s, testid) => s.page.$(`#bl-list [data-testid="${testid}"]`);

test('#807 a stage waiting for its PR shows the notice under it, with the link to the PR', async () => {
  const s = await open(TWO());
  const notice = inStage(s, 0, 'roadmap-merge-wait-notice');
  assert.ok(notice, 'the notice is in stage 1');
  const link = inStage(s, 0, 'roadmap-merge-wait-pr-link');
  assert.deepEqual([link?.getAttribute('href'), /#7\b/.test(textOf(notice)), !!inStage(s, 1, 'roadmap-merge-wait-notice')], ['https://github.com/o/r/pull/7', true, false]);
});

test('#807 the notice leaves once the merge is seen', async () => {
  const s = await open(TWO({ status: 'done', pr: { ...PR(7), state: 'merged' } }));
  assert.equal(any(s, 'roadmap-merge-wait-notice'), null);
});

test('#807 Move on says the next stage starts without that work and goes on without the merge', async () => {
  const s = await open(TWO());
  const notice = inStage(s, 0, 'roadmap-merge-wait-notice');
  assert.ok(notice, 'the notice is in stage 1');
  assert.match(textOf(notice), /without/i);
  const moveOn = inStage(s, 0, 'roadmap-merge-wait-move-on');
  assert.ok(moveOn, 'the notice offers Move on');
  moveOn.click();
  await settle();
  assert.deepEqual(s.calls, [['p1', 'i1', 'skip']]);
});

test('#807 Stack asks the service to stack the next stage on the waiting one', async () => {
  const s = await open(TWO());
  const stack = inStage(s, 0, 'roadmap-merge-wait-stack');
  assert.ok(stack, 'the notice offers Stack');
  stack.click();
  await settle();
  assert.deepEqual(s.calls, [['p1', 'i1', 'stack']]);
});

test('#807 the notice names the files both stages change; none in common, no warning', async () => {
  const overlap = await open(TWO({ files: ['src/login.js'] }, { files: ['src/login.js', 'src/logout.js'] }));
  const warning = inStage(overlap, 0, 'roadmap-merge-wait-overlap');
  assert.ok(warning, 'the overlap is named');
  assert.match(textOf(warning), /src\/login\.js/);
  const apart = await open(TWO({ files: ['src/login.js'] }, { files: ['src/logout.js'] }));
  assert.equal(any(apart, 'roadmap-merge-wait-overlap'), null);
});

test('#807 Fork + PR mode: the notice offers Move on, never Stack', async () => {
  const s = await open(TWO({ inputs: { mode: 'fork' } }, { inputs: { mode: 'fork' } }));
  assert.deepEqual([!!inStage(s, 0, 'roadmap-merge-wait-move-on'), !!any(s, 'roadmap-merge-wait-stack')], [true, false]);
});

test('#807 a stack of 3 PRs: the third stage\'s notice says why it cannot stack, and nothing is called', async () => {
  const s = await open(data([
    stage('s1', [waiting('i1', 1, 'One')]),
    stage('s2', [waiting('i2', 2, 'Two', { stacksOn: 'i1' })]),
    stage('s3', [waiting('i3', 3, 'Three', { stacksOn: 'i2' })]),
    stage('s4', [item('i4', 4, 'Four')]),
  ]));
  const refused = inStage(s, 2, 'roadmap-merge-wait-stack-refused');
  assert.ok(refused, 'the reason is shown');
  assert.match(`${textOf(refused)} ${refused.getAttribute('title') || ''}`, /\b3\b/);
  const stack = inStage(s, 2, 'roadmap-merge-wait-stack');
  if (stack) stack.click();
  await settle();
  assert.deepEqual(s.calls, []);
});
