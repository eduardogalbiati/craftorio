// #282 the stage's ⋮ menu, internal details the acceptance tests do not cover: an entry that is off
// (aria-disabled, with its reason) ignores a click and keeps the menu open, a click elsewhere closes
// the menu, and an open menu holds the screen's live reloads back (BacklogRoadmap.busy).
// Same harness as the acceptance tests (test/roadmap-status-helpers.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const view = { showAll: true, since: 'total' };
const it = (id, status, n) => H.item(id, status, n, `Issue ${n}`, { origin: H.iso(H.NOW - H.HOUR), runId: null, runs: [], error: null });
const data = (state) => ({ roadmap: { state, stages: [{ id: 'st1', name: '', note: '', items: [it('a', 'planned', 1)] }, { id: 'st2', name: '', note: '', items: [it('b', 'planned', 2)] }] }, issues: [] });
const stageOf = (html, s) => H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-stage' && e.attrs['data-stage'] === String(s));
const menuOf = (html, s) => H.findAll(stageOf(html, s).outer, (e) => e.attrs.role === 'menu')[0] || null;
const entry = (attr) => (e) => e.attrs.role === 'menuitem' && attr in e.attrs;

function load() {
  const out = H.loadRoadmap();
  const calls = { start: 0, save: 0 };
  out.sandbox.api.startRoadmap = async () => { calls.start += 1; return { roadmap: { state: 'running', stages: [] } }; };
  out.sandbox.api.saveRoadmap = async (projectId, stages) => { calls.save += 1; return { roadmap: { state: 'planned', stages }, issues: [] }; };
  return { ...out, calls };
}
async function open(R, d, s) {
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(stageOf(R.html(d, () => {}, view), s).outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-menu'), ctx, d);
  return R.html(d, () => {}, view);
}

test('#282 stage menu: an entry that is off ignores the click, says why under it, and its menu stays open', async () => {
  const { R, calls } = load();
  const d = data('running');
  const html = await open(R, d, 1);
  const run = H.findEl(menuOf(html, 1).outer, entry('data-rm-run-stage'));
  assert.equal(run.attrs['aria-disabled'], 'true');
  assert.ok(!('disabled' in run.attrs), 'still reachable by the keyboard');
  assert.match(H.visibleText(menuOf(html, 1).inner), /The roadmap is running: pause or stop it first/, 'the reason is on the line under the entry');
  const { ctx } = H.makeCtx();
  assert.equal(await R.onClick(H.clickOn(stageOf(html, 1).outer, entry('data-rm-run-stage')), ctx, d), true);
  assert.equal(calls.start, 0);
  assert.ok(menuOf(R.html(d, () => {}, view), 1), 'the menu is still open');
});

test('#282 stage menu: the first and the last stage cannot move further, with the reason', async () => {
  const { R, calls } = load();
  const d = data('planned');
  const first = await open(R, d, 0);
  assert.equal(H.findEl(menuOf(first, 0).outer, (e) => e.attrs['data-rm-stage'] === 'up').attrs['aria-disabled'], 'true');
  assert.ok(!('aria-disabled' in H.findEl(menuOf(first, 0).outer, (e) => e.attrs['data-rm-stage'] === 'down').attrs));
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(stageOf(first, 0).outer, (e) => e.attrs['data-rm-stage'] === 'up'), ctx, d);
  assert.equal(calls.save, 0, 'nothing saved by the entry that is off');
});

test('#282 stage menu: one menu at a time; a click elsewhere on the roadmap closes it; an open menu holds live reloads back', async () => {
  const { R } = load();
  const d = data('planned');
  assert.equal(R.busy(), false);
  let html = await open(R, d, 0);
  assert.ok(menuOf(html, 0));
  assert.equal(R.busy(), true, 'a redraw would take the focus from the menu\'s entries');
  html = await open(R, d, 1);
  assert.equal(menuOf(html, 0), null, 'opening another stage\'s menu closes the first');
  assert.ok(menuOf(html, 1));
  // a click on something that is not the roadmap's to handle (the page's own controls)
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(stageOf(html, 0).outer, (e) => e.attrs['data-rm-name'] !== undefined), ctx, d);
  html = R.html(d, () => {}, view);
  assert.equal(menuOf(html, 1), null);
  assert.equal(R.busy(), false);
});
