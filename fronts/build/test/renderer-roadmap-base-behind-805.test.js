// #805: the Roadmap's Start when the local base is behind origin (fronts/build/views/backlog/backlog-roadmap.js).
// Acceptance tests written before the code: the module in its sandbox (roadmap-status-helpers.js), BacklogRoadmap.onClick
// for the clicks, BacklogRoadmap.html for what is drawn.
//
// Contract (the seam these tests assume):
// - api.startRoadmap(projectId, simulated, scope) answers { confirm, baseCheck }: the answer is NOT passed to
//   ctx.setData; R.html(...) then has data-testid="roadmap-base-notice" with the count and "origin/main", with buttons
//   data-rm="base-update" and data-rm="base-continue", also data-testid="roadmap-base-update" / "roadmap-base-continue".
// - clicking calls api.startRoadmap(projectId, simulated, scope, 'update' | 'continue'), same scope, and the notice goes.
// - diverged: no update button, the text names the Backlog.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const view = { showAll: true, since: 'total' };
const behind = () => ({
  confirm: 'main is 16 commits behind origin/main.',
  baseCheck: { base: 'main', state: 'behind', ahead: 0, behind: 16, canUpdate: true },
});
const diverged = () => ({
  confirm: 'main has diverged: it is 16 commits behind origin/main and was not moved. Resolve it, then see the Backlog.',
  baseCheck: { base: 'main', state: 'diverged', ahead: 1, behind: 16, canUpdate: false },
});
const started = () => ({ roadmap: { state: 'running', stages: [] } });

const planned = (id) => H.item(id, 'planned', 805, 'A planned item', { mock: true });
const dataOf = (roadmap = { state: 'planned' }) => H.roadmapOf([
  { id: 'st1', name: 'One', note: '', items: [planned('a')] },
  { id: 'st2', name: 'Two', note: '', items: [planned('b')] },
], roadmap);
// a stage run on its own that paused: Resume goes on with that stage only, its id the start's scope
const pausedOnStage = () => dataOf({ state: 'paused', scope: { stage: 'st2' } });

const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
const noticeOf = (html) => byTestId(html, 'roadmap-base-notice');
const clickRm = (html, rm) => H.clickOn(html, (e) => e.attrs['data-rm'] === rm);

// The bar's Start, clicked once, answered by `answer`; later starts answer a started roadmap
async function startAnswered(answer, data = dataOf()) {
  const { R, sandbox } = H.loadRoadmap();
  const starts = [];
  const answers = [answer];
  sandbox.api.startRoadmap = async (...args) => { starts.push(JSON.parse(JSON.stringify(args))); return answers.shift() ?? started(); };
  const { ctx, calls } = H.makeCtx();
  const draw = () => R.html(data, () => {}, view);
  await R.onClick(clickRm(draw(), 'start'), ctx, data);
  return { starts, draw, data: calls.data, click: (rm) => R.onClick(clickRm(draw(), rm), ctx, data) };
}

test('#805 Start answered by a question: the answer is not given to the screen\'s data and the notice shows the count and origin/main', async () => {
  const { starts, draw, data } = await startAnswered(behind());
  assert.equal(starts.length, 1);
  assert.equal(data.length, 0);
  const notice = noticeOf(draw());
  assert.equal(notice === null, false, 'a [data-testid="roadmap-base-notice"]');
  assert.match(H.visibleText(notice.inner), /\b16 commits behind origin\/main/);
});

test('#805 the notice offers Update and Continue, by data-rm and by data-testid', async () => {
  const { draw } = await startAnswered(behind());
  const html = draw();
  assert.equal(byTestId(html, 'roadmap-base-update')?.attrs['data-rm'], 'base-update');
  assert.equal(byTestId(html, 'roadmap-base-continue')?.attrs['data-rm'], 'base-continue');
});

for (const choice of ['update', 'continue']) {
  test(`#805 the notice's ${choice} starts again with the same scope and the choice, and the notice goes`, async () => {
    const { starts, draw, data, click } = await startAnswered(behind(), pausedOnStage());
    assert.equal(starts[0][2], 'st2');
    await click(`base-${choice}`);
    assert.deepEqual(starts[1], [starts[0][0], starts[0][1], 'st2', choice]);
    assert.equal(data.length, 1, 'the start\'s answer reaches the screen');
    assert.equal(noticeOf(draw()) === null, true);
  });
}

test('#805 a diverged base: no update button, Continue stays and the notice names the Backlog', async () => {
  const { draw } = await startAnswered(diverged());
  const html = draw();
  assert.equal(byTestId(html, 'roadmap-base-update') === null, true);
  assert.equal(byTestId(html, 'roadmap-base-continue') === null, false);
  assert.match(H.visibleText(noticeOf(html)?.inner ?? ''), /Backlog/);
});
