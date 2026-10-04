// Internal details of #266, #267, #268 and #272 that the acceptance tests do not reach: the progress
// model's `keep` option, the status helper's extra ids, a stage longer than a page, items without a
// date, and the one-second tick of the run timers. Loaded as the acceptance tests load the renderer
// (test/roadmap-status-helpers.js: vm sandboxes, a fixed clock).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');
const RunProgress = require('../src/renderer/run-progress-model.js');

const MIN = H.MIN;
const START = H.NOW - 20 * MIN;
const TYPICAL = { develop: 10 * MIN, code_review: 5 * MIN, verify: 5 * MIN };
const PATH = ['develop', 'code_review', 'verify'];
const step = (id, status, at, durationMs) => ({ step: id, status, ts: H.iso(at), ...(durationMs ? { durationMs } : {}) });
// develop → code_review → develop again (5 minutes in)
const LOOP = [step('develop', 'done', START, 10 * MIN), step('code_review', 'done', START + 10 * MIN, 5 * MIN), step('develop', 'running', START + 15 * MIN)];

test('#272 estimateProgress: without `keep` a return still lowers the estimate and the result has no round', () => {
  const est = RunProgress.estimateProgress({ steps: LOOP, path: PATH, typical: TYPICAL, startedAt: H.iso(START), now: H.NOW });
  assert.equal(est.percent, 25);
  assert.equal('round' in est, false);
  assert.equal('sentBackBy' in est, false);
});

test('#272 estimateProgress: `keep` holds what the run had earned (the furthest step at its cap), names the round and the step that sent it back', () => {
  const est = RunProgress.estimateProgress({ steps: LOOP, path: PATH, typical: TYPICAL, startedAt: H.iso(START), now: H.NOW, keep: true });
  assert.equal(est.percent, 72); // develop (10) + 90% of code_review (4.5) of 20 minutes
  assert.equal(est.round, 2);
  assert.equal(est.sentBackBy, 'code_review');
  assert.equal(est.leftMs, 15 * MIN, 'the time left still counts the steps to redo');
});

test('#272 estimateProgress: `keep` on a run that never went back changes nothing but the round (1)', () => {
  const steps = LOOP.slice(0, 1).concat(step('code_review', 'running', START + 10 * MIN));
  const plain = RunProgress.estimateProgress({ steps, path: PATH, typical: TYPICAL, startedAt: H.iso(START), now: START + 12 * MIN });
  const kept = RunProgress.estimateProgress({ steps, path: PATH, typical: TYPICAL, startedAt: H.iso(START), now: START + 12 * MIN, keep: true });
  assert.equal(kept.percent, plain.percent);
  assert.equal(kept.round, 1);
  assert.equal(kept.sentBackBy, null);
});

test('#272 estimateProgress: back in the step it was sent back from (round 2), the kept progress holds until the run passes it', () => {
  const steps = [...LOOP.slice(0, 2), step('develop', 'done', START + 15 * MIN, 5 * MIN), step('code_review', 'running', START + 20 * MIN)];
  const est = RunProgress.estimateProgress({ steps, path: PATH, typical: TYPICAL, startedAt: H.iso(START), now: START + 21 * MIN, keep: true });
  assert.equal(est.percent, 72);
  assert.equal(est.round, 2);
});

test('#272 estimateProgress: a step retried in place (the supervisor ran it again) is round 2 with nothing that sent it back, and keeps its progress', () => {
  const steps = [step('develop', 'failed', START, 8 * MIN), step('develop', 'running', START + 8 * MIN)];
  const est = RunProgress.estimateProgress({ steps, path: PATH, typical: TYPICAL, startedAt: H.iso(START), now: START + 9 * MIN, keep: true });
  assert.equal(est.round, 2);
  assert.equal(est.sentBackBy, null);
  assert.equal(est.percent, 45); // 90% of develop (10 of 20 minutes), not the 5% of its second visit so far
});

test('#266 StatusPill: a run\'s "success" reads "Succeeded", a refused start "Failed to start"; the title is escaped', () => {
  const { statusLabel, statusPill } = H.loadStatusPill();
  assert.equal(statusLabel('success'), 'Succeeded');
  assert.equal(statusLabel('failed_to_start'), 'Failed to start');
  assert.equal(statusLabel(''), '');
  assert.match(statusPill('failed', { title: 'a "quoted" <error>' }), /title="a &quot;quoted&quot; &lt;error&gt;"/);
});

const bulk = (n) => H.roadmapOf([{ id: 'bulk', name: '', note: '', items: Array.from({ length: n }, (_, k) => H.item(`b${k}`, 'planned', 1000 + k, `Planned ${k}`)) }]);
const cards = (html) => H.findAll(html, (e) => e.attrs['data-testid'] === 'roadmap-item').length;

test('#268 a stage longer than a page is cut: fewer cards than items at first, the header counts them all, loadMore() draws more', () => {
  const { R } = H.loadRoadmap();
  const first = R.html(bulk(200), () => {});
  assert.ok(cards(first) < 200, `${cards(first)} cards in the first page`);
  assert.match(H.visibleText(first), /\b200 of 200 items · last 24 hours\b/);
  assert.ok(H.findEl(first, (e) => 'data-rm-load-more' in e.attrs), 'a Loading… row');
  R.loadMore();
  assert.ok(cards(R.html(bulk(200), () => {})) > cards(first));
  for (let k = 0; k < 5; k++) R.loadMore();
  const all = R.html(bulk(200), () => {});
  assert.equal(cards(all), 200);
  assert.equal(H.findEl(all, (e) => 'data-rm-load-more' in e.attrs), null, 'no Loading… row once everything is drawn');
});

test('#268 All: an item without any date is in every date range, and so is a run in progress that started long ago', () => {
  const old = H.iso(H.NOW - 10 * H.DAY);
  const data = H.roadmapOf([{ id: 's1', name: '', note: '', items: [
    H.item('undated', 'done', 1, 'Undated done'),
    H.item('old-done', 'done', 2, 'Old done', { origin: old }),
    H.item('long-run', 'running', 3, 'Long run', { origin: old, runId: 'run-3', run: H.run({ startedAt: old }) }),
  ] }]);
  const html = H.loadRoadmap().R.html(data, () => {}, { showAll: true, since: '24h' });
  assert.equal(H.itemShown(html, 'undated'), true);
  assert.equal(H.itemShown(html, 'long-run'), true);
  assert.equal(H.itemShown(html, 'old-done'), false);
});

test('#268 an unknown date range id falls back to the last 24 hours', () => {
  const html = H.loadRoadmap().R.html(bulk(1), () => {}, { since: 'forever' });
  assert.match(H.visibleText(html), /· last 24 hours\b/);
});

// a fake timer element as tick() uses it
function timerEl(since, estimateMinutes, tone) {
  const classes = new Set(['rm-timer', `rm-timer-${tone}`]);
  return {
    dataset: { rmTimer: since == null ? '' : String(since), estimate: String(estimateMinutes ?? ''), tone, timerState: tone },
    classList: { replace: (a, b) => { classes.delete(a); classes.add(b); } },
    textContent: '0:00',
    classes,
  };
}

test('#272 tick(): a running timer reads the clock again and changes its tone once past the estimate; a paused one is left alone', () => {
  const { R, setNow } = H.loadRoadmap();
  const running = timerEl(H.NOW - 19 * MIN, 20, 'ok');
  const paused = timerEl(null, 20, 'ok');
  const root = { querySelectorAll: () => [running, paused] };
  R.tick(root);
  assert.equal(running.textContent, '19:00');
  assert.equal(running.dataset.tone, 'ok');
  setNow(H.NOW + 2 * MIN);
  R.tick(root);
  assert.equal(running.textContent, '21:00');
  assert.equal(running.dataset.tone, 'warn');
  assert.equal(running.dataset.timerState, 'warn');
  assert.deepEqual([...running.classes], ['rm-timer', 'rm-timer-warn']);
  assert.equal(paused.textContent, '0:00');
});
