// #412 the Roadmap stage's ⋮ menu gets "Stop" next to "Pause after current step" (Stop and Pause
// left the header). Acceptance tests written before the code.
// src/renderer/views/backlog/backlog-roadmap.js runs whole in a vm sandbox (test/roadmap-status-helpers.js
// loadRoadmap); the menu is opened through BacklogRoadmap.onClick, as in
// test/renderer-roadmap-pause-391.test.js.
//
// Assumed interface: a role="menuitem" entry whose label is "Stop", right after the stage's pause
// entry ([data-rm-pause-stage]). With no live run in the stage (no item running) it is off the way
// the menu's other entries are (aria-disabled="true"), with its reason in its title; with one it is on
// (no aria-disabled). Suggested hook: data-rm-stop-stage, data-testid="roadmap-stage-stop".
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const view = { showAll: true, since: 'total' };
const it = (id, status, n, extra = {}) => H.item(id, status, n, `Issue ${n}`, { origin: H.iso(H.NOW - H.HOUR), runId: null, runs: [], error: null, ...extra });
// stage 1 (index 0) has a live run; stage 2 (index 1) only planned items
const data = () => ({
  roadmap: {
    state: 'running',
    stages: [
      { id: 'st1', name: '', note: '', items: [it('a', 'running', 1, { runId: 'run-a', run: H.run() }), it('b', 'planned', 2)] },
      { id: 'st2', name: '', note: '', items: [it('c', 'planned', 3)] },
    ],
  },
  issues: [],
});
const stageOf = (html, s) => H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-stage' && e.attrs['data-stage'] === String(s));

async function menuEntries(s) {
  const { R } = H.loadRoadmap();
  const d = data();
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(stageOf(R.html(d, () => {}, view), s).outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-menu'), ctx, d);
  const stage = stageOf(R.html(d, () => {}, view), s);
  assert.ok(stage, `stage ${s + 1} is rendered`);
  return H.findAll(stage.outer, (e) => e.attrs.role === 'menuitem');
}
const label = (e) => H.visibleText(e.inner).trim();

test('#412 stage menu: a "Stop" entry sits right after "Pause after current step"', async () => {
  const entries = await menuEntries(0);
  const pause = entries.findIndex((e) => 'data-rm-pause-stage' in e.attrs);
  assert.ok(pause >= 0, 'the stage menu has its pause entry');
  assert.equal(entries[pause + 1] ? label(entries[pause + 1]) : '(none)', 'Stop');
});

test('#412 stage menu: with a live run in the stage, Stop is on', async () => {
  const stop = (await menuEntries(0)).find((e) => label(e) === 'Stop');
  assert.ok(stop, 'the stage menu has Stop');
  assert.equal(stop.attrs['aria-disabled'] === 'true' || 'disabled' in stop.attrs, false);
});

test('#412 stage menu: with no live run in the stage, Stop is off and its title says why', async () => {
  const stop = (await menuEntries(1)).find((e) => label(e) === 'Stop');
  assert.ok(stop, 'the stage menu has Stop');
  assert.equal(stop.attrs['aria-disabled'] === 'true' || 'disabled' in stop.attrs, true);
  assert.notEqual(H.decode(stop.attrs.title || '').trim(), '', 'the reason is in its title');
});
