// #268 "Roadmap: a date filter, infinite scroll and a Planned | All switch". Acceptance tests written
// before the code. backlog-roadmap.js is evaluated whole in a vm sandbox
// (test/roadmap-status-helpers.js loadRoadmap) with a fixed "now" (2026-10-04 12:00 UTC); clicks and
// changes go through BacklogRoadmap.onClick / onChange with fake targets built from the markup.
//
// Contract (the seam these tests assume):
// - html(data, rerender, view): `view` = { epic, showAll, since } from backlog.js. showAll false is
//   Planned (the default), true is All: the same remembered flag as today's Show all
//   (backlog.js SHOW_ALL_KEY), shared with the Board's open-work filter; `since` is the date window's
//   id, '24h' when absent.
// - The switch: a segmented control like the Mode's Automatic / Validated (`.seg` with
//   role="group"), two buttons "Planned" and "All" with aria-pressed; a click on All calls
//   ctx.setShowAll(true). The Show all checkbox ([data-rm-show-all-toggle]) and the
//   "N finished stages hidden · Show all" line are gone.
// - The date select: `<select data-rm-since>` with options, in order, Last 24 hours (24h, selected by
//   default), Last 2 days (2d), Last 3 days (3d), Last week (1w), Last 15 days (15d), Last month (1m),
//   Total (total); a change calls ctx.setSince(value).
// - An item's last activity: the latest of its `origin`, its run's startedAt and finishedAt.
//   Planned: every item but done and skipped (cancelled); open items (planned, running, waiting,
//   failed) whatever their age; finished items in the window folded under the "+n done" chip (#267);
//   a stage with nothing left is hidden. All: every item whose last activity is in the window.
// - A header line "<shown> of <total> items · last 24 hours".
// - Pages: about 15 stages at first and a "Loading…" row carrying `data-rm-load-more` while more
//   are left; BacklogRoadmap.loadMore() adds the next page (backlog.js calls it when that row comes
//   near the screen, with an IntersectionObserver as run-list.js does, then re-renders). The current
//   stage (running, or the next to run) is always in the first page; a change of the switch, the
//   date window or the epic goes back to the first page; a re-read of the roadmap file keeps the
//   pages loaded.
// Not unit-testable here: the scroll position kept across a re-read (scrollTop is the real list's,
// in backlog.js's DOM) and the observer firing near the end of the list; covered by the
// screenshot / e2e checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const ago = (ms) => H.iso(H.NOW - ms);
const finishedItem = (id, status, n, title, { origin, start, end }) => H.item(id, status, n, title, {
  origin: ago(origin), runId: `run-${id}`, runs: [`run-${id}`],
  run: H.run({ status: status === 'done' ? 'success' : 'failed', startedAt: ago(start), finishedAt: ago(end) }),
});
// a roadmap spanning 40 days: 8 items in 5 stages
function data() {
  return {
    roadmap: { state: 'running', stages: [
      { id: 'st1', name: '', note: '', items: [
        finishedItem('old-done', 'done', 1, 'Old done', { origin: 41 * H.DAY, start: 40 * H.DAY + H.HOUR, end: 40 * H.DAY }),
        H.item('old-skip', 'skipped', 2, 'Old skipped', { origin: ago(39 * H.DAY) }),
      ] },
      { id: 'st2', name: '', note: '', items: [
        finishedItem('recent-done', 'done', 3, 'Recent done', { origin: 3 * H.DAY, start: 3 * H.HOUR, end: 2 * H.HOUR }),
        finishedItem('older-done', 'done', 8, 'Older done', { origin: 6 * H.DAY, start: 4 * H.DAY + H.HOUR, end: 4 * H.DAY }),
        H.item('old-planned', 'planned', 4, 'Old planned', { origin: ago(35 * H.DAY) }),
      ] },
      { id: 'st3', name: '', note: '', items: [
        finishedItem('failed-old', 'failed', 5, 'Failed old', { origin: 21 * H.DAY, start: 20 * H.DAY + H.HOUR, end: 20 * H.DAY }),
      ] },
      { id: 'st4', name: '', note: '', items: [
        H.item('running-now', 'running', 6, 'Running now', { origin: ago(2 * H.DAY), runId: 'run-now', runs: ['run-now'], run: H.run({ status: 'running', startedAt: ago(30 * H.MIN) }) }),
      ] },
      { id: 'st5', name: '', note: '', items: [
        finishedItem('done-2d', 'done', 7, 'Done two days ago', { origin: 5 * H.DAY, start: 2.5 * H.DAY + H.HOUR, end: 2.5 * H.DAY }),
      ] },
    ] },
    issues: [
      { number: 1, title: 'Old done', labels: [], epic: '#10' },
      { number: 3, title: 'Recent done', labels: [], epic: '#10' },
      { number: 7, title: 'Done two days ago', labels: [], epic: '#10' },
      { number: 6, title: 'Running now', labels: [] },
    ],
    epics: [{ id: '#10', title: 'Auth' }],
  };
}
const shown = (html) => ['old-done', 'old-skip', 'recent-done', 'older-done', 'old-planned', 'failed-old', 'running-now', 'done-2d'].filter((id) => H.itemShown(html, id));
const draw = (view) => H.loadRoadmap().R.html(data(), () => {}, view);

// ---- the switch and the date select --------------------------------------------------------------

test('#268 a Planned | All segmented switch replaces the Show all checkbox and the "finished stages hidden" line', () => {
  const html = draw();
  const seg = H.findAll(html, (e) => /\bseg\b/.test(e.attrs.class || '') && e.attrs.role === 'group')
    .find((e) => H.findAll(e.inner, (b) => b.name === 'button').map((b) => H.visibleText(b.inner)).join('|') === 'Planned|All');
  assert.ok(seg, 'a .seg role="group" with the buttons Planned and All');
  assert.equal(H.findEl(html, (e) => 'data-rm-show-all-toggle' in e.attrs), null, 'no Show all checkbox');
  assert.doesNotMatch(H.visibleText(html), /finished stages? hidden/);
});

test('#268 Planned is pressed by default; a click on All turns the shared open-work filter off (ctx.setShowAll(true))', async () => {
  const { R } = H.loadRoadmap();
  const html = R.html(data(), () => {});
  const btn = (label) => H.findEl(html, (e) => e.name === 'button' && H.visibleText(e.inner) === label && e.attrs['aria-pressed'] != null);
  assert.equal(btn('Planned')?.attrs['aria-pressed'], 'true');
  assert.equal(btn('All')?.attrs['aria-pressed'], 'false');
  const { ctx, calls } = H.makeCtx();
  await R.onClick(H.clickOn(html, (e) => e.name === 'button' && H.visibleText(e.inner) === 'All' && e.attrs['aria-pressed'] != null), ctx, data());
  assert.deepEqual(calls.showAll, [true]);
});

test('#268 the date select offers, in order, Last 24 hours (default) … Total', () => {
  const html = draw();
  const select = H.findEl(html, (e) => e.name === 'select' && 'data-rm-since' in e.attrs);
  assert.ok(select, 'a <select data-rm-since>');
  const options = H.findAll(select.inner, (e) => e.name === 'option');
  assert.deepEqual(options.map((o) => H.visibleText(o.inner)), ['Last 24 hours', 'Last 2 days', 'Last 3 days', 'Last week', 'Last 15 days', 'Last month', 'Total']);
  assert.deepEqual(options.map((o) => o.attrs.value), ['24h', '2d', '3d', '1w', '15d', '1m', 'total']);
  assert.deepEqual(options.filter((o) => 'selected' in o.attrs).map((o) => o.attrs.value), ['24h']);
});

test('#268 choosing a date window asks the Backlog to remember it (ctx.setSince)', async () => {
  const { R } = H.loadRoadmap();
  const html = R.html(data(), () => {});
  const select = H.findEl(html, (e) => e.name === 'select' && 'data-rm-since' in e.attrs);
  assert.ok(select, 'a <select data-rm-since>');
  const { ctx, calls } = H.makeCtx();
  const handled = await R.onChange({ target: H.fakeEl(select, { value: 'total' }) }, ctx, data());
  assert.equal(handled, true);
  assert.deepEqual(calls.since, ['total']);
});

test('#268 the header says how many items show and the window: "N of 8 items · last 24 hours"', () => {
  assert.match(H.visibleText(draw()), /\b\d+ of 8 items · last 24 hours\b/);
});

// ---- what Planned and All show -------------------------------------------------------------------

test('#268 Planned keeps every open item whatever its age: a planned item of 35 days, a failed one of 20, the running one', () => {
  const s = shown(draw());
  for (const id of ['old-planned', 'failed-old', 'running-now']) assert.ok(s.includes(id), `${id} is shown`);
});

test('#268 Planned hides done and skipped items; of stage 2\'s two done items only the one finished in the last day is folded ("+1 done")', () => {
  const html = draw();
  assert.deepEqual(shown(html).filter((id) => ['old-done', 'old-skip', 'recent-done', 'older-done', 'done-2d'].includes(id)), []);
  assert.match(H.visibleText(H.stageEl(html, 2)?.outer || ''), /\+1 done/);
  assert.equal(H.stageEl(html, 1), null, 'stage 1 (all finished, 40 days ago) is hidden');
  assert.equal(H.stageEl(html, 5), null, 'stage 5 (done 2.5 days ago) is hidden');
});

test('#268 All with Total shows every item', () => {
  assert.deepEqual(shown(draw({ showAll: true, since: 'total' })).sort(), ['done-2d', 'failed-old', 'old-done', 'old-planned', 'old-skip', 'older-done', 'recent-done', 'running-now']);
});

test('#268 All with Last 24 hours shows the item finished 2 hours ago, not the ones finished 2.5 or 40 days ago', () => {
  const s = shown(draw({ showAll: true, since: '24h' }));
  assert.ok(s.includes('recent-done'));
  assert.ok(s.includes('running-now'));
  assert.ok(!s.includes('done-2d'));
  assert.ok(!s.includes('old-done'));
});

test('#268 All with Last 3 days brings back the item finished 2.5 days ago, still not the 40-day-old one', () => {
  const s = shown(draw({ showAll: true, since: '3d' }));
  assert.ok(s.includes('done-2d'));
  assert.ok(!s.includes('old-done'));
});

test('#268 the epic filter combines with the date window (AND)', () => {
  const s = shown(draw({ showAll: true, since: '24h', epic: '#10' }));
  assert.deepEqual(s, ['recent-done']);
});

// ---- pages (infinite scroll) ---------------------------------------------------------------------

// `n` stages of one planned item each (open work: shown in Planned whatever its age)
function many(n, statuses = () => 'planned') {
  return {
    roadmap: { state: 'running', stages: Array.from({ length: n }, (_, k) => ({ id: `s${k + 1}`, name: '', note: '', items: [
      H.item(`i${k + 1}`, statuses(k), k + 1, `Item ${k + 1}`, { origin: ago(35 * H.DAY) }),
    ] })) },
    issues: [],
  };
}

test('#268 a long roadmap draws its first page (about 15 stages) and a "Loading…" row (data-rm-load-more)', () => {
  const html = H.loadRoadmap().R.html(many(40), () => {});
  const count = H.stageCount(html);
  assert.ok(count >= 10 && count <= 20, `about 15 stages in the first page, got ${count}`);
  const more = H.findEl(html, (e) => 'data-rm-load-more' in e.attrs);
  assert.ok(more, 'a [data-rm-load-more] row');
  assert.match(H.visibleText(more.inner), /Loading…/);
});

test('#268 loadMore() draws the next page', () => {
  const { R } = H.loadRoadmap();
  const first = H.stageCount(R.html(many(40), () => {}));
  R.loadMore();
  assert.ok(H.stageCount(R.html(many(40), () => {})) > first);
});

test('#268 the current stage is in the first page even deep in the roadmap (All, Total)', () => {
  // 30 done stages, the running one (stage 31), then 9 planned
  const d = many(40, (k) => (k < 30 ? 'done' : k === 30 ? 'running' : 'planned'));
  const html = H.loadRoadmap().R.html(d, () => {}, { showAll: true, since: 'total' });
  assert.ok(H.stageCount(html) < 40, 'paged');
  assert.ok(H.stageEl(html, 31), 'Stage 31 (current) is in the first page');
});

test('#268 switching Planned / All goes back to the first page', () => {
  const { R } = H.loadRoadmap();
  const first = H.stageCount(R.html(many(40), () => {}, { showAll: false, since: 'total' }));
  R.loadMore();
  assert.ok(H.stageCount(R.html(many(40), () => {}, { showAll: false, since: 'total' })) > first, 'the next page was loaded');
  assert.equal(H.stageCount(R.html(many(40), () => {}, { showAll: true, since: 'total' })), first);
});

test('#268 a re-read of the roadmap file keeps the pages already loaded', () => {
  const { R } = H.loadRoadmap();
  R.html(many(40), () => {});
  R.loadMore();
  const loaded = H.stageCount(R.html(many(40), () => {}));
  assert.equal(H.stageCount(R.html(H.clone(many(40)), () => {})), loaded);
});
