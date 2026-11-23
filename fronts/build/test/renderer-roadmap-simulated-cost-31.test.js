// #31: a simulated run shows no spend on the Roadmap. Simulated sessions recorded a cost (e.g. cost_usd
// 0.0571 a turn), so an item whose run is simulated read "Cost $0.20 so far" on its card and the
// header's Spent (Gasto) added it. Runs recorded before the fix keep those costs in their events, so the
// view must not count them either: an item whose run is simulated shows $0.00 or "simulated" on its cost
// meter, and the header's Spent leaves it out while still counting a real run's cost. A real run is
// unchanged.
// Acceptance tests written before the code.
//
// Harness: fronts/build/views/backlog/backlog-roadmap.js whole in its vm sandbox
// (test/roadmap-status-helpers.js loadRoadmap) with what the page loads beside it (term-dock.js,
// backlog-live.js, packages/shared/roadmap-summary.js), as renderer-roadmap-header-750.test.js. Seam:
// BacklogRoadmap.html(data, rerender, view) read as markup: the card's [data-testid="roadmap-meter-cost"]
// and the header's Spent column (the 4th child of rm-head-stats: [label, value, detail]).
// The data is what the service gives today for a simulated run: the item's `mock: true`, its run's
// `mock: true` (packages/engine/service/areas/roadmap.js runView) and a non-zero historic `actualUsd`.
// Assumed: the developer may show "$0.00" or a "simulated" word; the tests only require that the
// simulated amount is gone and that one of those shows.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const H = require('./roadmap-status-helpers');

const SUMMARY = ['..', '..', '..', 'packages', 'shared', 'roadmap-summary.js'];
const VIEW = { showAll: true, since: 'total' };
const recent = H.iso(H.NOW - H.HOUR);

function load() {
  const out = H.loadRoadmap();
  out.sandbox.navigator = { platform: 'linux' };
  out.sandbox.api.platform = 'linux';
  vm.runInContext(H.read('term-dock.js'), out.sandbox);
  vm.runInContext(H.read('views', 'backlog', 'backlog-live.js'), out.sandbox);
  vm.runInContext(H.read(...SUMMARY), out.sandbox);
  return out;
}

// an item with a run; `mock`: the run (and the item) simulated; `actualUsd`: its runs' recorded cost
function withRun(id, n, { status, mock, actualUsd }) {
  const running = status === 'running';
  const run = H.run({
    status: running ? 'running' : 'success', mock,
    startedAt: H.iso(H.NOW - 2 * H.HOUR), finishedAt: running ? null : H.iso(H.NOW - H.HOUR),
  });
  return H.item(id, status, n, `Issue ${n}`, { origin: recent, mock, runId: `run-${id}`, runs: [`run-${id}`], actualUsd, run });
}
const data = (items) => ({
  roadmap: { state: 'running', stages: [{ id: 's1', name: '', note: '', items }] },
  issues: items.map((x) => ({ number: x.issues[0].number, title: x.issues[0].title, labels: [] })),
});
const html = (out, d) => out.R.html(d, () => {}, VIEW);

// ---- markup readers (primitives only leave them) ----
const meterText = (page, id) => H.visibleText(H.findEl(H.itemEl(page, id).outer, (e) => e.attrs['data-testid'] === 'roadmap-meter-cost').inner);
const hasClass = (e, c) => String(e.attrs.class || '').split(/\s+/).includes(c);
function spentColumn(page) {
  const statsEl = H.findAll(page, (e) => hasClass(e, 'rm-head-stats'))[0];
  assert.ok(statsEl, 'the header\'s rm-head-stats band');
  const cols = H.elements(statsEl.outer).filter((e) => e.parent && e.parent.start === 0 && e.start > 0).map((e) => H.textNodes(e.inner));
  assert.equal(cols.length, 4, JSON.stringify(cols));
  return cols[3];
}
const ZERO_OR_SIMULATED = /0[.,]00|simulad/i;

// ---- the card's cost meter -------------------------------------------------------------------------------

test('#31 a running item whose run is simulated does not show its recorded cost on the card ($0.20 so far)', () => {
  const out = load();
  const text = meterText(html(out, data([withRun('a', 1, { status: 'running', mock: true, actualUsd: 0.2 })])), 'a');
  assert.doesNotMatch(text, /0[.,]20/, text);
});

test('#31 a running item whose run is simulated shows $0.00 or "simulated" on its cost meter', () => {
  const out = load();
  const text = meterText(html(out, data([withRun('a', 1, { status: 'running', mock: true, actualUsd: 0.2 })])), 'a');
  assert.match(text, ZERO_OR_SIMULATED, text);
});

test('#31 a done item whose run was simulated shows $0.00 or "simulated", not its recorded $0.56', () => {
  const out = load();
  const text = meterText(html(out, data([withRun('a', 1, { status: 'done', mock: true, actualUsd: 0.56 })])), 'a');
  assert.doesNotMatch(text, /0[.,]56/, text);
  assert.match(text, ZERO_OR_SIMULATED, text);
});

test('#31 unchanged: a done item whose run was real shows its cost $0.56 on the card', () => {
  const out = load();
  const text = meterText(html(out, data([withRun('a', 1, { status: 'done', mock: false, actualUsd: 0.56 })])), 'a');
  assert.match(text, /\$0\.56/, text);
});

// ---- the header's Spent ----------------------------------------------------------------------------------

test('#31 the header\'s Spent counts a real run ($1.25) and leaves a simulated one ($0.56) out: $1.25', () => {
  const out = load();
  const page = html(out, data([
    withRun('a', 1, { status: 'done', mock: false, actualUsd: 1.25 }),
    withRun('b', 2, { status: 'done', mock: true, actualUsd: 0.56 }),
  ]));
  assert.equal(spentColumn(page)[1], '$1.25');
});

test('#31 a roadmap whose only run was simulated: the header\'s Spent does not show its $0.56', () => {
  const out = load();
  const value = spentColumn(html(out, data([withRun('b', 2, { status: 'done', mock: true, actualUsd: 0.56 })])))[1];
  assert.doesNotMatch(value, /0[.,]56/, value);
});

test('#31 unchanged: a real run\'s cost ($0.56) counts in the header\'s Spent', () => {
  const out = load();
  const value = spentColumn(html(out, data([withRun('a', 1, { status: 'done', mock: false, actualUsd: 0.56 })])))[1];
  assert.equal(value, '$0.56');
});
