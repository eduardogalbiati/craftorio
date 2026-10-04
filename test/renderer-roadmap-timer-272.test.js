// #272 "Roadmap card: a live run timer under the ring, coloured against the estimate; no progress
// drop on a fix round". Acceptance tests written before the code. backlog-roadmap.js is evaluated
// whole in a vm sandbox (test/roadmap-status-helpers.js loadRoadmap) with a fixed clock (setNow moves
// it); the item's `run` is the service's (src/service/areas/roadmap.js runView: status, startedAt,
// finishedAt, progress trail, stepTimes, history) and the workflow's steps come from
// api.listWorkflows, as RunProgress.estimateProgress gets them.
//
// Contract (the seam these tests assume):
// - Inside the ring's box (the `.rm-progress` element, [data-rm-progress]) an element carrying
//   `data-rm-timer` shows the run's elapsed time: "23:41" (m:ss under an hour), "1:05:12" (h:mm:ss)
//   beyond. Elapsed = now − run.startedAt, gate waits left out (a human_approval step's durationMs,
//   and the time since the gate it waits at started); frozen at run.finishedAt once the run ended.
//   Each render reads the clock (backlog.js / the roadmap re-renders it every second while a run is
//   active).
// - Its colour against the item's estimate (item.estimate.minutes): `data-timer-state="ok"` within
//   the estimate, "warn" from 100% to 130%, "over" beyond 130%, "neutral" without an estimate
//   (classes rm-timer-ok / rm-timer-warn / rm-timer-over / rm-timer-neutral may mirror it).
// - Its tooltip (title or aria-label): "23 min of ≈ 22 min (estimate from 30 past runs)".
// - Progress never falls back: on a return to an earlier step (review → develop) the ring's
//   percentage (.rm-ring-pct) stays at or above what it showed, and the card says it is round 2
//   ("round 2" or "×2") and "fix round after review" (or the step that sent it back), outside the
//   steps popover (.rm-steps, which already shows "Develop ×2" chips). The run link (data-run) stays.
// Not unit-testable here: the one-second ticking itself (a timer in backlog.js / the roadmap that
// redraws the card); the tests check that each render reads the clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const WF = { file: 'w.yaml', name: 'Work', steps: [{ id: 'develop' }, { id: 'code_review' }, { id: 'verify' }], agents: {}, inputs: {} };
const TYPICAL = { develop: 10 * H.MIN, code_review: 5 * H.MIN, verify: 5 * H.MIN };
const view = { showAll: true, since: 'total' };
const dev = (agent = 'developer') => [{ agent, provider: 'claude', model: 'claude-sonnet-5', cost: 0.1, durationMs: 1000 }];
const step = (id, status, at, extra = {}) => ({ step: id, status, ts: H.iso(at), agents: dev(), ...(status === 'running' || status === 'waiting' ? {} : { durationMs: 5 * H.MIN }), ...extra });

// the item with a run started `start` (ms), its trail, its estimate
function timed({ start, progress, status = 'running', runStatus = 'running', finishedAt = null, estimate = null, waiting = false }) {
  return H.item('a', status, 1, 'Login page', {
    workflow: 'w.yaml', workflowName: 'Work', origin: H.iso(start), runId: 'run-9', runs: ['run-9'], estimate, ...(waiting ? { waiting: true } : {}),
    run: H.run({ status: runStatus, workflow: 'w.yaml', startedAt: H.iso(start), finishedAt: finishedAt && H.iso(finishedAt), waiting, progress, stepTimes: TYPICAL, history: 12 }),
  });
}
// a roadmap module whose workflows are loaded (the first draw asks api.listWorkflows)
async function ready() {
  const loaded = H.loadRoadmap({ listWorkflows: async () => [WF] });
  loaded.R.html(H.roadmapOf([]), () => {});
  await H.settle();
  return loaded;
}
const draw = (R, x) => R.html(H.roadmapOf([{ id: 'st1', name: '', note: '', items: [x] }]), () => {}, view);
function timerOf(html) {
  const box = H.itemEl(html, 'a');
  const el = H.findEl(box.outer, (e) => 'data-rm-timer' in e.attrs);
  assert.ok(el, 'the card has a timer ([data-rm-timer])');
  return { el, text: H.visibleText(el.inner), state: el.attrs['data-timer-state'], tip: `${el.attrs.title || ''} ${el.attrs['aria-label'] || ''}` };
}
const pctOf = (html) => {
  const m = /class="rm-ring-pct">(\d+)%</.exec(H.itemEl(html, 'a').outer);
  assert.ok(m, 'the ring shows a percentage');
  return Number(m[1]);
};
// the card's visible text outside the steps popover
const cardText = (html) => H.visibleText(H.dropWhere(H.itemEl(html, 'a').outer, (e) => /\brm-steps\b/.test(e.attrs.class || '')));

// ---- the timer --------------------------------------------------------------------------------

test('#272 the timer shows the elapsed time since the run started as m:ss ("23:41")', async () => {
  const { R } = await ready();
  const start = H.NOW - (23 * 60 + 41) * 1000;
  assert.equal(timerOf(draw(R, timed({ start, progress: [step('develop', 'running', start)] }))).text, '23:41');
});

test('#272 beyond one hour the timer reads h:mm:ss ("1:05:12")', async () => {
  const { R } = await ready();
  const start = H.NOW - (3600 + 5 * 60 + 12) * 1000;
  assert.equal(timerOf(draw(R, timed({ start, progress: [step('develop', 'running', start)] }))).text, '1:05:12');
});

test('#272 the timer sits in the ring\'s box (.rm-progress), under its percentage', async () => {
  const { R } = await ready();
  const start = H.NOW - 10 * H.MIN;
  const { el } = timerOf(draw(R, timed({ start, progress: [step('develop', 'running', start)] })));
  let inRing = false;
  for (let p = el.parent; p; p = p.parent) if ('data-rm-progress' in p.attrs) inRing = true;
  assert.equal(inRing, true);
});

test('#272 each render reads the clock: one second later the timer says one second more', async () => {
  const { R, setNow } = await ready();
  const start = H.NOW - (23 * 60 + 41) * 1000;
  const x = timed({ start, progress: [step('develop', 'running', start)] });
  draw(R, x);
  setNow(H.NOW + 1000);
  assert.equal(timerOf(draw(R, H.clone(x))).text, '23:42');
});

test('#272 a finished gate wait is left out of the elapsed time', async () => {
  const { R } = await ready();
  const start = H.NOW - 30 * H.MIN;
  const progress = [
    step('develop', 'done', start, { durationMs: 10 * H.MIN }),
    step('human_review', 'done', start + 10 * H.MIN, { type: 'human_approval', agents: [], durationMs: 5 * H.MIN }),
    step('code_review', 'running', start + 15 * H.MIN),
  ];
  assert.equal(timerOf(draw(R, timed({ start, progress }))).text, '25:00');
});

test('#272 while the run waits at a gate the timer is paused: it does not grow', async () => {
  const { R, setNow } = await ready();
  const start = H.NOW - 30 * H.MIN;
  const progress = [
    step('develop', 'done', start, { durationMs: 20 * H.MIN }),
    step('human_review', 'waiting', start + 20 * H.MIN, { type: 'human_approval', agents: [] }),
  ];
  const x = timed({ start, progress, waiting: true });
  const before = timerOf(draw(R, x)).text;
  assert.equal(before, '20:00', 'the 10 minutes at the gate so far are left out');
  setNow(H.NOW + 5 * H.MIN);
  assert.equal(timerOf(draw(R, H.clone(x))).text, before);
});

test('#272 once the run ended the timer is frozen at its duration', async () => {
  const { R } = await ready();
  const start = H.NOW - 3 * H.HOUR;
  const x = timed({ start, status: 'done', runStatus: 'success', finishedAt: start + 40 * H.MIN, progress: [step('develop', 'done', start, { durationMs: 40 * H.MIN })] });
  assert.equal(timerOf(draw(R, x)).text, '40:00');
});

// ---- its colour against the estimate --------------------------------------------------------------

const estimate = (minutes, runs = 12) => ({ usd: 5, minutes, runs, complexity: 3, estimated: false, basis: `Median of the last ${runs} successful runs`, timeBasis: `From ${runs} past runs` });
async function stateAt(elapsedMin, est) {
  const { R } = await ready();
  const start = H.NOW - elapsedMin * H.MIN;
  return timerOf(draw(R, timed({ start, estimate: est, progress: [step('develop', 'running', start)] }))).state;
}

test('#272 at 50% of the estimate the timer is "ok"', async () => {
  assert.equal(await stateAt(10, estimate(20)), 'ok');
});

test('#272 at 110% of the estimate the timer is "warn" (amber)', async () => {
  assert.equal(await stateAt(22, estimate(20)), 'warn');
});

test('#272 at 150% of the estimate the timer is "over" (red)', async () => {
  assert.equal(await stateAt(30, estimate(20)), 'over');
});

test('#272 without an estimate the timer is "neutral"', async () => {
  assert.equal(await stateAt(30, null), 'neutral');
});

test('#272 the timer\'s tooltip compares with the estimate: "23 min of ≈ 22 min (estimate from 30 past runs)"', async () => {
  const { R } = await ready();
  const start = H.NOW - 23 * H.MIN;
  const { tip } = timerOf(draw(R, timed({ start, estimate: estimate(22, 30), progress: [step('develop', 'running', start)] })));
  assert.match(tip, /23 min of ≈ 22 min/);
  assert.match(tip, /30 past runs/);
});

// ---- a fix round: develop → review → develop ---------------------------------------------------------

// the run at code_review (4 of its typical 5 minutes in), then sent back to develop
async function fixRound() {
  const loaded = await ready();
  const start = H.NOW - 14 * H.MIN;
  const atReview = timed({ start, progress: [step('develop', 'done', start, { durationMs: 10 * H.MIN }), step('code_review', 'running', start + 10 * H.MIN)] });
  const first = draw(loaded.R, atReview);
  loaded.setNow(H.NOW + 6 * H.MIN);
  const back = timed({ start, progress: [
    step('develop', 'done', start, { durationMs: 10 * H.MIN }),
    step('code_review', 'done', start + 10 * H.MIN, { durationMs: 5 * H.MIN }),
    step('develop', 'running', start + 15 * H.MIN, { visit: 2 }),
  ] });
  return { first, second: draw(loaded.R, back) };
}

test('#272 a return from review to develop never lowers the ring\'s percentage', async () => {
  const { first, second } = await fixRound();
  const before = pctOf(first);
  assert.ok(before > 0, 'the ring had progressed');
  assert.ok(pctOf(second) >= before, `the ring went from ${before}% to ${pctOf(second)}%`);
});

test('#272 a fix round shows "round 2" on the card (outside the steps popover)', async () => {
  const { second } = await fixRound();
  assert.match(cardText(second), /round 2|×2/);
});

test('#272 a fix round says why it loops ("fix round after review") and keeps the run link', async () => {
  const { second } = await fixRound();
  assert.match(cardText(second), /fix round after (code )?review/i);
  assert.ok(H.findEl(H.itemEl(second, 'a').outer, (e) => e.attrs['data-run'] === 'run-9'), 'the card still opens run-9');
});
