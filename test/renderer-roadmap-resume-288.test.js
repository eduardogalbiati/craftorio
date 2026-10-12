// #288: a Roadmap card whose item's run was interrupted (the roadmap paused on it) has "Resume run"
// next to Retry and Skip; it opens Resume from step… for the item's run. Cards without an ended
// run (planned, done, running) have none.
//
// Acceptance tests written before the code: backlog-roadmap.js in its sandbox
// (test/roadmap-status-helpers.js), BacklogRoadmap.html for the card, BacklogRoadmap.onClick for
// the click, window.openResumeDialog replaced by a spy.
//
// Interface the developer provides: <button data-testid="roadmap-item-resume">Resume run</button>
// in the card's Retry / Skip row (.rm-fail-actions); its click → openResumeDialog(item.runId).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const view = { showAll: true, since: 'total' };
const recent = H.iso(H.NOW - H.HOUR);

const interrupted = () => H.item('a', 'failed', 288, 'Resume an interrupted run', {
  runId: 'run-288', runs: ['run-288'], origin: recent, error: 'Run run-288 was interrupted',
  run: H.run({ status: 'interrupted', startedAt: H.iso(H.NOW - 20 * H.MIN), finishedAt: H.iso(H.NOW - 5 * H.MIN) }),
});
const dataOf = (x, roadmap = { state: 'paused', pausedBy: x.id, error: x.error || null }) => H.roadmapOf([{ id: 'st1', name: '', note: '', items: [x] }], roadmap);
const resumeBtn = (html, id = 'a') => H.findEl(H.itemEl(html, id).outer, (e) => e.attrs['data-testid'] === 'roadmap-item-resume');

function load() {
  const out = H.loadRoadmap();
  const opened = [];
  out.sandbox.openResumeDialog = (...args) => { opened.push(JSON.stringify(args)); };
  out.sandbox.showToast = () => {};
  return { ...out, opened: () => opened.map((s) => JSON.parse(s)) };
}

test('#288 an interrupted item\'s card has "Resume run" in the Retry / Skip row', () => {
  const { R } = load();
  const html = R.html(dataOf(interrupted()), () => {}, view);
  const btn = resumeBtn(html);
  assert.ok(btn, 'a [data-testid="roadmap-item-resume"] button on the card');
  assert.equal(H.visibleText(btn.inner), 'Resume run');
  const row = H.findEl(H.itemEl(html, 'a').outer, (e) => /\brm-fail-actions\b/.test(e.attrs.class || ''));
  assert.ok(row, 'the Retry / Skip row');
  const labels = H.findAll(row.outer, (e) => e.name === 'button').map((b) => H.visibleText(b.inner));
  for (const l of ['Retry', 'Skip', 'Resume run']) assert.ok(labels.includes(l), `${l} in the row: ${labels.join(', ')}`);
});

test('#288 "Resume run" opens Resume from step… for the item\'s run', async () => {
  const { R, opened } = load();
  const d = dataOf(interrupted());
  const html = R.html(d, () => {}, view);
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(html, (e) => e.attrs['data-testid'] === 'roadmap-item-resume'), ctx, d);
  const calls = opened();
  assert.equal(calls.length, 1, 'openResumeDialog called once');
  assert.equal(calls[0][0], 'run-288');
});

test('#288 a planned item and a done item have no "Resume run"', () => {
  const { R } = load();
  const planned = H.item('a', 'planned', 1, 'Not started', { origin: recent });
  assert.equal(resumeBtn(R.html(dataOf(planned, { state: 'planned' }), () => {}, view)) === null, true);
  const done = H.item('a', 'done', 2, 'Done', { origin: recent, runId: 'run-2', runs: ['run-2'], run: H.run({ status: 'success', startedAt: recent, finishedAt: recent }) });
  assert.equal(resumeBtn(R.html(dataOf(done, { state: 'running' }), () => {}, view)) === null, true);
});
