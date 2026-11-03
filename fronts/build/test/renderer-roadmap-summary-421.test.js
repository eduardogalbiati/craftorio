// #421 The Roadmap bar's summary, on the screen: "Planned ≈ $X · ≈ T (n items, m stages)", "+ n without
// estimate", "Spent $Y", the tooltip "work time; gates not included", and a "By release" toggle only
// when the roadmap has release cut lines (#260). Acceptance tests written before the code.
//
// backlog-roadmap.js in its sandbox (test/roadmap-status-helpers.js), BacklogRoadmap.html(data, rerender,
// view) read as markup. The new module packages/shared/roadmap-summary.js (window.RoadmapSummary, see
// test/roadmap-summary-421.test.js for its contract) is evaluated into the sandbox here once it exists;
// the view reads it when it draws (as it reads RoadmapModel), not when it loads.
//
// Test ids: roadmap-summary-by-release (the "By release" toggle); #750: the figures are the header's numbers band
// (roadmap-stats > roadmap-stat, backlog-live.js statsHtml), no longer a roadmap-summary sentence in roadmap-bar.
// Items carry what the service sends: `estimate` ({ usd, minutes, runs, basis }), `actualUsd`.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const H = require('./roadmap-status-helpers');

const VIEW = { showAll: false, since: 'total' }; // Planned
const SUMMARY = ['..', '..', '..', 'packages', 'shared', 'roadmap-summary.js'];

function load() {
  const out = H.loadRoadmap();
  if (H.exists(...SUMMARY)) vm.runInContext(H.read(...SUMMARY), out.sandbox);
  vm.runInContext(H.read('views', 'backlog', 'backlog-live.js'), out.sandbox); // #750: statsHtml, the numbers band
  return out;
}

const estimate = (usd, minutes) => ({ usd, minutes, runs: 3, basis: 'From 3 past runs' });
// done i1 ($2.50 spent); left: i2 ≈ $1.50 / 20 min, i3 ≈ $1.00 / 40 min, i4 no estimate (stage 2), i5 ≈ $3.00 / 60 min (stage 3)
function fixture({ cut = false } = {}) {
  return {
    roadmap: {
      state: 'paused',
      stages: [
        { id: 'st1', name: 'Login', note: '', items: [H.item('i1', 'done', 1, 'Issue 1', { estimate: estimate(2, 30), actualUsd: 2.5, actualMinutes: 28, origin: '2026-10-01T10:00:00.000Z' })] },
        { id: 'st2', name: 'Profile', note: '', ...(cut ? { release: { name: '1.0.0' } } : {}), items: [
          H.item('i2', 'planned', 2, 'Issue 2', { estimate: estimate(1.5, 20) }),
          H.item('i3', 'planned', 3, 'Issue 3', { estimate: estimate(1, 40) }),
          H.item('i4', 'planned', 4, 'Issue 4', { estimate: null }),
        ] },
        { id: 'st3', name: 'Reports', note: '', items: [H.item('i5', 'planned', 5, 'Issue 5', { estimate: estimate(3, 60) })] },
      ],
    },
    issues: [1, 2, 3, 4, 5].map((n) => ({ number: n, title: `Issue ${n}`, labels: [] })),
  };
}

const byTestId = (html, id) => H.findAll(html, (e) => e.attrs['data-testid'] === id);
// #750: the summary is the header's numbers band (roadmap-stats, drawn by backlog-live.js statsHtml): one column per figure
function columnOf(html, label) {
  const stats = byTestId(html, 'roadmap-stats')[0];
  assert.ok(stats, 'the numbers band of the header');
  const col = byTestId(stats.outer, 'roadmap-stat').find((c) => H.visibleText(byTestId(c.outer, 'roadmap-stat-label')[0].inner).trim() === label);
  assert.ok(col, `a "${label}" column`);
  return col;
}
// every title and aria-label inside an element (its tooltips)
const tips = (el) => H.elements(el.outer).flatMap((e) => [e.attrs.title || '', e.attrs['aria-label'] || '']).join('\n');

test('#421 #750 the Forecast column shows "≈ T" and "≈ $X" for what is left (planned items, longest item per stage)', () => {
  const text = H.visibleText(columnOf(load().R.html(fixture(), () => {}, VIEW), 'Forecast').inner);
  assert.match(text, /≈ \$5\.50/, text);
  assert.match(text, /≈ 1 h 40 min/, text);
});

test('#421 #750 the Left column counts the items and stages left', () => {
  const text = H.visibleText(columnOf(load().R.html(fixture(), () => {}, VIEW), 'Left').inner);
  assert.match(text, /4 items/, text);
  assert.match(text, /2 stages/, text);
});

test('#421 #750 items without an estimate: "+ 1 without estimate", its tooltip names it', () => {
  const el = columnOf(load().R.html(fixture(), () => {}, VIEW), 'Forecast');
  assert.match(H.visibleText(el.inner), /\+ ?1 without estimate/);
  assert.match(tips(el), /Issue 4|#4/);
});

test('#421 #750 the tooltip says the time is work time, gates not included', () => {
  assert.match(tips(columnOf(load().R.html(fixture(), () => {}, VIEW), 'Forecast')), /work time; gates not included/);
});

test('#421 #750 the Spent column shows "$Y": the real cost of the finished and running items', () => {
  assert.match(H.visibleText(columnOf(load().R.html(fixture(), () => {}, VIEW), 'Spent').inner), /\$2\.50/);
});

test('#421 with a release cut line: a "By release" toggle', () => {
  const html = load().R.html(fixture({ cut: true }), () => {}, VIEW);
  const toggle = byTestId(html, 'roadmap-summary-by-release')[0];
  assert.ok(toggle, 'a roadmap-summary-by-release toggle');
  assert.match(`${H.visibleText(toggle.outer)} ${toggle.attrs['aria-label'] || ''}`, /By release/);
});

const releaseRows = (html) => byTestId(html, 'roadmap-summary-release-row').map((e) => H.visibleText(e.inner));
const openByRelease = async (R, d) => {
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(R.html(d, () => {}, VIEW), (e) => e.attrs['data-testid'] === 'roadmap-summary-by-release'), ctx, d);
  return ctx;
};

test('#421 "By release" opens a list: the cut line\'s stages, then the part after the last cut line', async () => {
  const { R } = load();
  const d = fixture({ cut: true });
  await openByRelease(R, d);
  const html = R.html(d, () => {}, VIEW);
  assert.equal(byTestId(html, 'roadmap-summary-releases').length, 1, 'the open list');
  assert.equal(byTestId(html, 'roadmap-summary-by-release')[0].attrs['aria-expanded'], 'true');
  const [cut, after, ...rest] = releaseRows(html);
  assert.equal(rest.length, 0, 'one row per cut line, then the rest');
  // 1.0.0: stages 1-2 left: i2 + i3 ($2.50, longest 40 min), i4 without estimate
  assert.match(cut, /1\.0\.0/);
  assert.match(cut, /≈ \$2\.50 · ≈ 40 min/, cut);
  assert.match(cut, /1 without estimate/, cut);
  // after the last cut line: stage 3, i5 ($3.00, 60 min)
  assert.match(after, /after the last cut line/i);
  assert.match(after, /≈ \$3\.00 · ≈ 1 h/, after);
  assert.doesNotMatch(after, /without estimate/, after);
});

test('#421 the By release list closes with its toggle and with a click outside it', async () => {
  const { R } = load();
  const d = fixture({ cut: true });
  await openByRelease(R, d);
  await openByRelease(R, d); // its toggle again
  assert.equal(byTestId(R.html(d, () => {}, VIEW), 'roadmap-summary-releases').length, 0, 'closed by its toggle');
  await openByRelease(R, d);
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(R.html(d, () => {}, VIEW), (e) => e.attrs['data-testid'] === 'roadmap-stage'), ctx, d);
  assert.equal(byTestId(R.html(d, () => {}, VIEW), 'roadmap-summary-releases').length, 0, 'closed by a click outside it');
});

test('#421 without cut lines: no "By release" toggle', () => {
  const html = load().R.html(fixture(), () => {}, VIEW);
  columnOf(html, 'Forecast'); // the summary is there
  assert.equal(byTestId(html, 'roadmap-summary-by-release').length, 0);
});
