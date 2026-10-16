// #391 the Roadmap bar's Pause offers "Pause after this stage" or "Pause now", and the stage's pause
// (#368) is renamed "Pause after current step". Acceptance tests written before the code.
// src/renderer/views/backlog/backlog-roadmap.js runs whole in a vm sandbox (test/roadmap-status-helpers.js
// loadRoadmap); clicks go through BacklogRoadmap.onClick with targets built from the rendered markup.
//
// Assumed interface:
// - The bar's Pause ([data-rm="pause"]) no longer pauses at once: it opens a small menu (role="menu")
//   with two entries (role="menuitem"): "Pause after this stage", hint "The items of stage N still
//   start and finish; the next stage waits" (N: the current stage), and "Pause now", hint "Nothing new
//   starts; runs in progress go on" (each hint in the entry's markup: its title or a line under it).
// - "Pause after this stage" calls window.api.pauseRoadmap(projectId, false, 'stage'); "Pause now"
//   calls it as today (stop false, after not 'stage').
// - The stage menu's entry ([data-rm-pause-stage]) and the Run screen's #btn-pause read
//   "Pause after current step"; the tooltip keeps the rule (agents finish their current turn).
// - RunProgress.pauseLabel of a paused stage reads "Paused after the current step".
// The badge "Pausing after stage N" / "Cancel pause" is checked from a real roadmap file in
// test/roadmap-pause-after-stage-391.test.js (the pending pause's field is the developer's).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./roadmap-status-helpers');
const runProgress = require('../src/shared/run-progress-model');

const view = { showAll: true, since: 'total' };
const it = (id, status, n) => H.item(id, status, n, `Issue ${n}`, { origin: H.iso(H.NOW - H.HOUR), runId: null, runs: [], error: null });
// stage 1 over, stage 2 the current one (one item running, one planned), stage 3 planned
const data = () => ({
  roadmap: {
    state: 'running',
    stages: [
      { id: 'st1', name: '', note: '', items: [it('a', 'done', 1)] },
      { id: 'st2', name: '', note: '', items: [it('b', 'running', 2), it('c', 'planned', 3)] },
      { id: 'st3', name: '', note: '', items: [it('d', 'planned', 4)] },
    ],
  },
  issues: [],
});

function load() {
  const out = H.loadRoadmap();
  const calls = { pause: [], confirm: 0 };
  out.sandbox.confirmDialog = async () => { calls.confirm += 1; return true; };
  out.sandbox.api.pauseRoadmap = async (...a) => { calls.pause.push(a.map(String)); return { roadmap: { state: 'paused', stages: [] }, issues: [] }; };
  return { ...out, calls };
}
const pauseMenu = (html) => H.findAll(html, (e) => e.attrs.role === 'menu').find((m) => /Pause now/.test(H.visibleText(m.inner)))?.outer || '';
const menuItems = (html) => H.findAll(pauseMenu(html), (e) => e.attrs.role === 'menuitem');
const labelOf = (e) => H.visibleText(e.inner).trim();
// an entry's markup up to the next entry (its title, or a hint line drawn under it), decoded
function segmentOf(html, label) {
  const menu = pauseMenu(html);
  const items = menuItems(html);
  const at = items.findIndex((e) => labelOf(e).startsWith(label));
  return at < 0 ? '' : H.decode(menu.slice(items[at].start, items[at + 1]?.start ?? menu.length));
}
const isEntry = (label) => (e) => e.attrs.role === 'menuitem' && labelOf(e).startsWith(label);

async function openPause() {
  const loaded = load();
  const d = data();
  const { ctx } = H.makeCtx();
  await loaded.R.onClick(H.clickOn(loaded.R.html(d, () => {}, view), (e) => e.attrs['data-rm'] === 'pause'), ctx, d);
  return { ...loaded, d, ctx, html: loaded.R.html(d, () => {}, view) };
}

test('#391 bar: Pause opens a menu with "Pause after this stage" and "Pause now", each with its hint; nothing is paused yet', async () => {
  const { html, calls } = await openPause();
  assert.equal(calls.pause.length, 0, 'opening the menu pauses nothing');
  const labels = menuItems(html).map(labelOf);
  assert.equal(labels.length, 2, `entries: ${labels.join(' | ')}`);
  assert.deepEqual([labels.some((l) => l.startsWith('Pause after this stage')), labels.some((l) => l.startsWith('Pause now'))], [true, true], `entries: ${labels.join(' | ')}`);
  assert.equal(segmentOf(html, 'Pause after this stage').includes('The items of stage 2 still start and finish; the next stage waits'), true);
  assert.equal(segmentOf(html, 'Pause now').includes('Nothing new starts; runs in progress go on'), true);
});

test('#391 bar: "Pause after this stage" asks the service for a pause after the stage (pauseRoadmap(projectId, false, \'stage\'))', async () => {
  const { R, d, ctx, html, calls } = await openPause();
  await R.onClick(H.clickOn(html, isEntry('Pause after this stage')), ctx, d);
  assert.deepEqual(calls.pause, [['p1', 'false', 'stage']]);
});

test('#391 bar: "Pause now" pauses as today (stop false, not after the stage)', async () => {
  const { R, d, ctx, html, calls } = await openPause();
  await R.onClick(H.clickOn(html, isEntry('Pause now')), ctx, d);
  assert.equal(calls.pause.length, 1);
  assert.deepEqual(calls.pause[0].slice(0, 2), ['p1', 'false']);
  assert.notEqual(calls.pause[0][2], 'stage');
});

test('#391 stage menu: the stage\'s pause reads "Pause after current step"; its tooltip keeps the rule (agents finish their current turn)', async () => {
  const { R } = load();
  const d = data();
  const stageOf = (html) => H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-stage' && e.attrs['data-stage'] === '1');
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(stageOf(R.html(d, () => {}, view)).outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-menu'), ctx, d);
  const entry = H.findEl(stageOf(R.html(d, () => {}, view)).outer, (e) => e.attrs.role === 'menuitem' && 'data-rm-pause-stage' in e.attrs);
  assert.ok(entry, 'the stage menu has its pause entry');
  assert.equal(H.visibleText(entry.inner).trim(), 'Pause after current step');
  assert.match(H.decode(entry.attrs.title || ''), /current turn/);
});

// #412: the pause button left the header for the Run screen's tab row (views/run/run.js, or
// run-controls.js when it draws it); test/renderer-run-tabs-410.test.js checks where it shows
test('#391 Run screen: the run\'s pause button reads "Pause after current step"', () => {
  const renderer = path.join(__dirname, '..', 'src', 'renderer');
  const html = ['index.html', 'views/run/run.js', 'run-controls.js'].map((f) => fs.readFileSync(path.join(renderer, ...f.split('/')), 'utf8')).join('\n');
  const btn = H.findEl(html, (e) => e.name === 'button' && (e.attrs.id === 'btn-pause' || e.attrs['data-testid'] === 'run-pause'));
  assert.ok(btn, 'the run\'s pause button (#btn-pause or data-testid="run-pause") is on the Run screen');
  assert.equal(H.visibleText(btn.inner).trim(), 'Pause after current step');
});

test('#391 status line: a stage paused (#368) reads "Paused after the current step", not "turn"', () => {
  assert.equal(runProgress.pauseLabel({ state: 'paused', at: null, runs: 2 }), 'Paused after the current step (2 runs paused)');
  assert.equal(runProgress.pauseLabel({ state: 'paused', at: null }), 'Paused after the current step');
});
