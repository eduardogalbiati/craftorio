// The lanes of the Roadmap's stage block (the redesign of 2026-11-27, proposal C "one lane per workflow"):
// fronts/build/views/backlog/backlog-roadmap.js draws a stage's items as rows grouped by workflow, the workflow's
// stations as columns named once, and a Progress cell per row (a ring and two bars, cost then time).
// backlog-roadmap.js is evaluated whole in a vm sandbox (roadmap-status-helpers.js loadRoadmap, fixed clock); the
// workflows come from api.listWorkflows, built here from the bundled workflows/*.yaml (as renderer-roadmap-card-282).
//
// What this file holds (the rest of the row is in renderer-roadmap-card-282.test.js and its neighbours):
// - the stage head's chips `roadmap-stage-chip` (data-chip waiting | failed | running | done), only what is not zero;
// - the groups `roadmap-workflow`: one per workflow, the roadmap's own order inside each, the columns of a group
//   being every station of its rows (a row without one leaves the cell empty);
// - the Progress cell `roadmap-status`: the ring `roadmap-ring` and the bars (data-bar cost | time, data-level none |
//   ok | warn | over, data-fill), the overrun beside them, the exact figures in its title; tick() moves the time bar;
// - the row's line (the attempt), the rows that stay open, the unfolded finished rows in the roadmap's order.
// Not testable here: the widths (the lane block's 580px, the sideways scroll under 1040px), the colours, screenshots.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./roadmap-status-helpers');

const ROOT = path.join(__dirname, '..', '..', '..');
const FEATURE = 'feature.yaml';
const FIX = 'fix.yaml';

// a bundled workflow as api.listWorkflows gives it (packages/engine/service/areas/workflows.js), with its groups
function wfEntry(file) {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const wf = loadWorkflow(path.join(ROOT, 'workflows', file));
  return {
    file,
    name: wf.metadata?.name || file,
    inputs: wf.inputs || {},
    outputs: wf.outputs || {},
    groups: wf.groups || [],
    agents: Object.fromEntries(Object.entries(wf.agents || {}).map(([k, a]) => [k, { provider: a.provider, model: a.model }])),
    steps: wf.steps.map((s) => ({ ...s, type: s.type || 'agent', agent: s.agents ? s.agents.join(' · ') : s.agent || null })),
  };
}

const view = { showAll: true, since: 'total' };
const recent = H.iso(H.NOW - H.HOUR);
const ESTIMATE = { usd: 10, minutes: 100, runs: 12, estimated: false, basis: 'Median of the last 12 successful runs', timeBasis: 'From 12 past runs' };
const item = (id, extra = {}) => ({
  id, status: 'planned', workflow: FEATURE, workflowName: 'feature', inputs: {}, mock: false,
  issues: [H.ref(100 + id.charCodeAt(0), `Issue ${id}`)], origin: recent, runId: null, runs: [], error: null, ...extra,
});
const dev = () => [{ agent: 'developer', provider: 'claude', model: 'claude-sonnet-5', cost: 0.1, durationMs: 1000 }];
const step = (id, status, at, extra = {}) => ({ step: id, status, ts: H.iso(at), agents: dev(), ...(status === 'running' || status === 'waiting' ? {} : { durationMs: 5 * H.MIN }), ...extra });
// an item whose run ended well: what it spent is its `actualUsd` and `actualMinutes`
const spent = (id, actualUsd, actualMinutes, extra = {}) => {
  const start = H.NOW - 3 * H.HOUR;
  return item(id, { status: 'done', runId: `run-${id}`, runs: [`run-${id}`], estimate: ESTIMATE, actualUsd, actualMinutes,
    run: H.run({ status: 'success', workflow: FEATURE, startedAt: H.iso(start), finishedAt: H.iso(start + H.HOUR), progress: [step('develop', 'done', start)], groups: wfEntry(FEATURE).groups }), ...extra });
};
const stageOf = (items, extra = {}) => ({ id: 'st1', name: '', note: '', items, ...extra });
const roadmapOf = (items, roadmap = {}) => ({ roadmap: { state: 'running', stages: [stageOf(items)], ...roadmap }, issues: [] });

// a roadmap module whose workflows are loaded (the first draw asks api.listWorkflows)
async function ready() {
  const loaded = H.loadRoadmap({ listWorkflows: async () => [FEATURE, FIX].map(wfEntry) });
  loaded.R.html(H.roadmapOf([]), () => {});
  await H.settle();
  await H.settle();
  return loaded;
}
const draw = (R, d, v = view) => R.html(d, () => {}, v);
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
const allByTestId = (html, id) => H.findAll(html, (e) => e.attrs['data-testid'] === id);
const hasClass = (e, name) => String(e.attrs.class || '').split(/\s+/).includes(name);
const text = (el) => H.visibleText(el.inner);
const rowOf = (html, id) => H.itemEl(html, id);
const cellOf = (html, id) => byTestId(rowOf(html, id).outer, 'roadmap-status');
// a bar of the Progress cell: [its level, how far it is filled]
const barOf = (html, id, kind) => {
  const bar = H.findEl(cellOf(html, id).outer, (e) => e.attrs['data-bar'] === kind);
  assert.ok(bar, `item ${id} has a ${kind} bar`);
  return [bar.attrs['data-level'], bar.attrs['data-fill']];
};
const overOf = (html, id) => text(H.findEl(cellOf(html, id).outer, (e) => 'data-rm-over' in e.attrs));

// ---- the Progress cell: the bars ------------------------------------------------------------------------

test('lanes: a bar is filled to what is spent of the estimate: green up to 80% of it, amber up to 100%, red past it with the bar full', async () => {
  const { R } = await ready();
  // estimate: $10 and 100 min
  const html = draw(R, roadmapOf([spent('a', 5, 79), spent('b', 8, 80), spent('c', 8.1, 81), spent('d', 10, 100), spent('e', 10.1, 192)]));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((id) => barOf(html, id, 'cost')), [
    ['ok', 'max(3px, 50.0%)'], ['ok', 'max(3px, 80.0%)'], ['warn', 'max(3px, 81.0%)'], ['warn', 'max(3px, 100.0%)'], ['over', 'max(3px, 100.0%)'],
  ]);
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((id) => barOf(html, id, 'time')[0]), ['ok', 'ok', 'warn', 'warn', 'over']);
});

test('lanes: the two limits of the bars\' colours are named constants (the designer\'s proposal, 80% and 100%)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'fronts', 'build', 'views', 'backlog', 'backlog-roadmap-meters.js'), 'utf8');
  assert.match(src, /const BAR_WARN_AT = 0\.8;/);
  assert.match(src, /const BAR_OVER_AT = 1;/);
});

test('lanes: past the estimate the overrun is said beside the bars ("+92%"), the larger of the two; nothing within it', async () => {
  const { R } = await ready();
  const html = draw(R, roadmapOf([spent('a', 5, 79), spent('b', 10.5, 192), spent('c', 13, 100)]));
  assert.deepEqual(['a', 'b', 'c'].map((id) => overOf(html, id)), ['', '+92%', '+30%']);
});

test('lanes: a small spend still shows (at least 3px); nothing spent is an empty bar', async () => {
  const { R } = await ready();
  const html = draw(R, roadmapOf([spent('a', 0.04, 1), spent('b', 0, 0)]));
  assert.deepEqual([barOf(html, 'a', 'cost'), barOf(html, 'b', 'cost'), barOf(html, 'b', 'time')], [['ok', 'max(3px, 0.4%)'], ['ok', '0'], ['ok', '0']]);
});

test('lanes: without an estimate both bars are empty and neutral; a simulated run spends nothing, whatever its events say', async () => {
  const { R } = await ready();
  const html = draw(R, roadmapOf([spent('a', 5, 50, { estimate: null }), spent('b', 5, 50, { mock: true })]));
  assert.deepEqual([barOf(html, 'a', 'cost'), barOf(html, 'a', 'time')], [['none', '0'], ['none', '0']]);
  assert.deepEqual([barOf(html, 'b', 'cost'), barOf(html, 'b', 'time')[0]], [['none', '0'], 'ok']);
});

test('lanes: a row that has not started shows an empty ring "0%", empty bars and no estimate; the estimate is in the cell\'s title and in the open row', async () => {
  const { R } = await ready();
  const html = draw(R, roadmapOf([item('a', { estimate: ESTIMATE })], { state: 'planned' }));
  const cell = cellOf(html, 'a');
  const ring = byTestId(cell.outer, 'roadmap-ring');
  assert.deepEqual([ring.attrs.class, ring.attrs['data-percent'], barOf(html, 'a', 'cost'), barOf(html, 'a', 'time')], ['rm-ring st-none', '0', ['none', '0'], ['none', '0']]);
  assert.equal(/10\.00|1 h 40/.test(text(cell)), false, 'no estimate in the row');
  assert.match(cell.attrs.title, /^Progress 0% · Cost ≈ \$10\.00 · Time ≈ 1 h 40 min$/);
  assert.match(text(byTestId(rowOf(html, 'a').outer, 'roadmap-meter-cost')), /≈ \$10\.00/);
});

test('lanes: the cell\'s title and accessible name say the exact figures: the percent, then what was spent of each estimate', async () => {
  const { R } = await ready();
  const cell = cellOf(draw(R, roadmapOf([spent('a', 5, 79)])), 'a');
  assert.equal(cell.attrs.title, 'Progress 100% · Cost $5.00 of ≈ $10.00 · Time 1 h 19 min of ≈ 1 h 40 min');
  assert.deepEqual([cell.attrs['aria-label'], cell.attrs.role], [cell.attrs.title, 'img']);
});

// ---- the Progress cell: the ring ------------------------------------------------------------------------

test('lanes: the ring is coloured by the run\'s state (st-running, st-waiting, st-failed); a done run is a full ring with a check, no number', async () => {
  const { R } = await ready();
  const start = H.NOW - 20 * H.MIN;
  const groups = wfEntry(FEATURE).groups;
  const withRun = (id, status, run, extra = {}) => item(id, { status, runId: `run-${id}`, runs: [`run-${id}`], run: H.run({ workflow: FEATURE, startedAt: H.iso(start), groups, ...run }), ...extra });
  const html = draw(R, roadmapOf([
    withRun('a', 'running', { status: 'running', progress: [step('develop', 'running', start)] }),
    withRun('b', 'running', { status: 'running', waiting: true, gate: 'Try it', progress: [step('develop', 'done', start), step('developer_check', 'waiting', start + 5 * H.MIN, { type: 'human_approval', agents: [] })] }, { waiting: true }),
    withRun('c', 'failed', { status: 'failed', finishedAt: H.iso(start + 10 * H.MIN), progress: [step('develop', 'failed', start)] }),
    spent('d', 5, 50),
  ]));
  const ring = (id) => byTestId(cellOf(html, id).outer, 'roadmap-ring');
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => ring(id).attrs.class), ['rm-ring st-running', 'rm-ring st-waiting', 'rm-ring st-failed', 'rm-ring st-done']);
  assert.deepEqual([/^\d+%$/.test(text(ring('a'))), text(ring('d')), /rm-ring-check/.test(ring('d').inner), ring('d').attrs['data-percent']], [true, '', true, '100']);
});

// ---- tick(): the time bar follows the timer ---------------------------------------------------------------

// the timer of a run that started `minutes` ago against an estimate, with the row's time bar and overrun around it
function tickTarget(sinceMs, estimateMinutes, costRatio = '') {
  const inner = { style: {} };
  const bar = { dataset: { level: 'ok', fill: '0' }, querySelector: (sel) => (sel === 'i' ? inner : null) };
  const over = { dataset: { rmOver: String(costRatio) }, textContent: '' };
  const row = { querySelector: (sel) => (sel === '[data-rm-timebar]' ? bar : sel === '[data-rm-over]' ? over : null) };
  const meter = { dataset: {}, querySelector: () => null };
  const timer = { dataset: { rmTimer: String(sinceMs), estimate: String(estimateMinutes), tone: 'ok' }, textContent: '', classList: { replace() {} } };
  timer.closest = (sel) => (sel === '.rm-meter' ? meter : sel === '[data-item]' ? row : null);
  return { root: { querySelectorAll: (sel) => (sel === '[data-rm-timer]' ? [timer] : []) }, bar, inner, over, timer };
}

test('lanes: tick() moves the row\'s time bar with the timer: its fill, its colour, and the overrun once past the estimate', async () => {
  const { R } = await ready();
  const at = (minutes) => tickTarget(H.NOW - minutes * H.MIN, 60);
  const seen = [30, 54, 115].map((minutes) => { const t = at(minutes); R.tick(t.root); return [t.bar.dataset.level, t.inner.style.height, t.over.textContent]; });
  assert.deepEqual(seen, [['ok', 'max(3px, 50.0%)', ''], ['warn', 'max(3px, 90.0%)', ''], ['over', 'max(3px, 100.0%)', '+92%']]);
});

test('lanes: tick() keeps the cost\'s overrun beside the bars when it is the larger one', async () => {
  const { R } = await ready();
  const t = tickTarget(H.NOW - 66 * H.MIN, 60, 1.5);
  R.tick(t.root);
  assert.deepEqual([t.bar.dataset.level, t.over.textContent], ['over', '+50%']);
});

// ---- the stage head's chips -------------------------------------------------------------------------------

const chipsOf = (html) => allByTestId(byTestId(html, 'roadmap-stage').outer, 'roadmap-stage-chip').map((e) => [e.attrs['data-chip'], text(e)]);

test('lanes: the stage head counts its items in chips, only what is not zero: waiting for you, failed, running, done of all', async () => {
  const { R } = await ready();
  const start = H.NOW - 20 * H.MIN;
  const live = (id, extra = {}) => item(id, { status: 'running', runId: `run-${id}`, runs: [`run-${id}`], run: H.run({ status: 'running', workflow: FEATURE, startedAt: H.iso(start), progress: [step('develop', 'running', start)], groups: wfEntry(FEATURE).groups }), ...extra });
  const items = [
    live('a'), live('b'), live('c', { waiting: true }), item('d', { status: 'waiting_merge' }),
    item('e', { status: 'failed', error: 'Could not start: no agent' }), item('f', { error: 'Could not start #1: kept work' }), // a refused start counts as failed
    spent('g', 1, 1), item('h'),
  ];
  assert.deepEqual(chipsOf(draw(R, roadmapOf(items, { state: 'paused', pausedBy: 'f' }))), [['waiting', '2 waiting for you'], ['failed', '2 failed'], ['running', '2 running'], ['done', '1 of 8 done']]);
  assert.deepEqual(chipsOf(draw(R, roadmapOf([item('a'), item('b')], { state: 'planned' }))), [], 'a stage of planned items has no chip');
});

test('lanes: the stage\'s estimate and its ⋮ menu close its head, after the chips; "Show the stage on the map" is no button of the head', async () => {
  const { R } = await ready();
  const d = { roadmap: { state: 'planned', stages: [stageOf([item('a')], { estimate: { usd: 12.34, minutes: 60, runs: 12 } })] }, issues: [] };
  const head = H.findEl(draw(R, d), (e) => hasClass(e, 'rm-stage-head'));
  assert.match(text(head), /12\.34/);
  assert.ok(byTestId(head.outer, 'roadmap-stage-menu'), 'the stage menu button');
  assert.equal(byTestId(head.outer, 'show-stage-on-map'), null);
});

// ---- the groups -----------------------------------------------------------------------------------------

const groupsOf = (html) => allByTestId(html, 'roadmap-workflow').map((g) => ({
  name: text(byTestId(g.outer, 'roadmap-workflow-name')),
  head: text(H.findEl(g.outer, (e) => hasClass(e, 'rm-group-head'))),
  items: allByTestId(g.outer, 'roadmap-item').map((e) => e.attrs['data-item']),
  cols: H.findAll(H.findEl(H.findEl(g.outer, (e) => hasClass(e, 'rm-cols')).outer, (e) => hasClass(e, 'rm-lane')).inner, (e) => e.name === 'span').map((e) => text(e)),
  el: g,
}));

test('lanes: one group per workflow in a stage, in the order they first appear; inside a group the roadmap\'s own order', async () => {
  const { R } = await ready();
  const html = draw(R, roadmapOf([item('a'), item('b', { workflow: FIX, workflowName: 'fix' }), item('c'), item('d', { workflow: FIX, workflowName: 'fix' })], { state: 'planned' }));
  const groups = groupsOf(html);
  assert.deepEqual(groups.map((g) => g.items), [['a', 'c'], ['b', 'd']]);
  assert.deepEqual(groups.map((g) => /\b2 runs\b/.test(g.head)), [true, true]);
  assert.notEqual(groups[0].name, groups[1].name);
});

test('lanes: a stage keeps its groups to itself: the same workflow in two stages is a group in each', async () => {
  const { R } = await ready();
  const d = { roadmap: { state: 'planned', stages: [stageOf([item('a')]), { id: 'st2', name: '', note: '', items: [item('b')] }] }, issues: [] };
  assert.deepEqual(groupsOf(draw(R, d)).map((g) => g.items), [['a'], ['b']]);
});

test('lanes: a group\'s columns are every station of its rows, named once; a row without one of them leaves its cell empty', async () => {
  const { R } = await ready();
  // Validated adds the owner's gate "Your check" after Develop: the Automatic row has no such station
  const html = draw(R, roadmapOf([item('a', { inputs: { mode: 'auto' } }), item('b', { inputs: { mode: 'validated' } })], { state: 'planned' }));
  const [group] = groupsOf(html);
  assert.deepEqual([groupsOf(html).length, group.items], [1, ['a', 'b']]);
  assert.equal(group.cols.filter((name) => name === 'Your check').length, 1);
  const cells = (id) => H.findAll(byTestId(rowOf(html, id).outer, 'roadmap-pipeline').inner, (e) => hasClass(e, 'rm-station'));
  const at = group.cols.indexOf('Your check');
  assert.deepEqual([cells('a').length, cells('b').length], [group.cols.length, group.cols.length], 'each row has a cell under each column');
  assert.deepEqual([hasClass(cells('a')[at], 'st-none'), cells('a')[at].attrs['data-testid'] || null, cells('b')[at].attrs['data-state']], [true, null, 'gate']);
  // the stations the two rows share sit under the same columns
  const names = (id) => cells(id).map((c) => (H.findEl(c.inner, (e) => 'aria-label' in e.attrs)?.attrs['aria-label'] || '').replace(/: [^:]*$/, ''));
  assert.deepEqual(names('b'), group.cols);
  assert.deepEqual(names('a'), group.cols.map((name) => (name === 'Your check' ? '' : name)));
});

test('lanes: the track runs from a row\'s first station to its last (first, last), and through an empty cell between them', async () => {
  const { R } = await ready();
  const html = draw(R, roadmapOf([item('a', { inputs: { mode: 'auto' } }), item('b', { inputs: { mode: 'validated' } })], { state: 'planned' }));
  const cells = H.findAll(byTestId(rowOf(html, 'a').outer, 'roadmap-pipeline').inner, (e) => hasClass(e, 'rm-station'));
  assert.deepEqual([hasClass(cells[0], 'first'), hasClass(cells.at(-1), 'last'), cells.filter((c) => hasClass(c, 'first')).length, cells.filter((c) => hasClass(c, 'last')).length], [true, true, 1, 1]);
  const empty = cells.find((c) => hasClass(c, 'st-none'));
  assert.equal(hasClass(empty, 'off'), false, 'the track goes on through the cell the row has no station for');
});

// ---- the row ----------------------------------------------------------------------------------------------

test('lanes: a row waiting for the owner is marked rm-waiting (tinted amber, an amber rule above it); the stylesheet gives a row no accent at its left', async () => {
  const { R } = await ready();
  const start = H.NOW - 20 * H.MIN;
  const x = item('a', { status: 'running', waiting: true, runId: 'run-a', runs: ['run-a'], run: H.run({ status: 'running', waiting: true, workflow: FEATURE, startedAt: H.iso(start), progress: [step('develop', 'done', start), step('developer_check', 'waiting', start + 5 * H.MIN, { type: 'human_approval', agents: [] })], groups: wfEntry(FEATURE).groups }) });
  const row = rowOf(draw(R, roadmapOf([x])), 'a');
  assert.deepEqual([hasClass(row, 'rm-waiting'), row.attrs['data-status']], [true, 'waiting']);
  const css = fs.readFileSync(path.join(ROOT, 'fronts', 'build', 'views', 'backlog', 'backlog.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.rm-item\.rm-waiting, \.rm-item\.rm-waiting_merge \{[^}]*border-top-color:[^}]*background:/);
  assert.equal(/\.rm-item[^{}]*\{[^}]*border-left/.test(css), false, 'no left-border accent on a row');
});

test('lanes: the row\'s line says what the pill of its station does not: a parked item (#395) reads "Parked at a gate" beside its "Waiting for you" pill', async () => {
  const { R } = await ready();
  const start = H.NOW - 20 * H.MIN;
  const gateRun = () => H.run({ status: 'running', waiting: true, workflow: FEATURE, startedAt: H.iso(start), progress: [step('develop', 'done', start), step('developer_check', 'waiting', start + 5 * H.MIN, { type: 'human_approval', agents: [] })], groups: wfEntry(FEATURE).groups });
  const html = draw(R, roadmapOf([
    item('a', { status: 'parked', parked: { at: H.iso(start), gate: 'Developer check' }, runId: 'run-a', runs: ['run-a'], run: gateRun() }),
    item('b', { status: 'running', waiting: true, runId: 'run-b', runs: ['run-b'], run: gateRun() }),
  ]));
  const line = (id) => { const note = H.findEl(rowOf(html, id).outer, (e) => hasClass(e, 'rm-note')); return note ? text(note) : ''; };
  const pill = (id) => byTestId(byTestId(rowOf(html, id).outer, 'roadmap-pipeline').outer, 'status-label');
  assert.deepEqual([text(pill('a')), pill('a').attrs['data-status'], line('a')], ['Waiting for you', 'parked', 'Parked at a gate']);
  assert.deepEqual([text(pill('b')), pill('b').attrs['data-status'], line('b')], ['Waiting for you', 'waiting', '']);
  assert.deepEqual([hasClass(rowOf(html, 'a'), 'rm-waiting'), hasClass(rowOf(html, 'b'), 'rm-waiting')], [false, true]);
});

test('lanes: an item that ran before says its attempt in the row\'s line ("attempt 2"); its earlier runs are in the open row', async () => {
  const { R } = await ready();
  const start = H.NOW - 20 * H.MIN;
  const x = item('a', { status: 'running', runId: 'run-2', runs: ['run-1', 'run-2'], runHistory: [{ runId: '20261127-run-1', status: 'failed' }], run: H.run({ status: 'running', workflow: FEATURE, startedAt: H.iso(start), progress: [step('develop', 'running', start)], groups: wfEntry(FEATURE).groups }) });
  const html = draw(R, roadmapOf([x]));
  const row = rowOf(html, 'a');
  assert.match(text(H.findEl(row.outer, (e) => hasClass(e, 'rm-note'))), /· working… · attempt 2$/);
  const history = byTestId(row.outer, 'roadmap-run-history');
  assert.equal(allByTestId(history.outer, 'roadmap-run-history-entry').length, 1);
  assert.ok(H.findEl(byTestId(row.outer, 'roadmap-item-panel').outer, (e) => e.attrs['data-testid'] === 'roadmap-run-history'), 'the earlier runs are inside the open row');
});

test('lanes: a row is closed until its control opens it; an item whose Edit form is open has its row open', async () => {
  const { R } = await ready();
  const d = roadmapOf([item('a'), item('b')], { state: 'planned' });
  const state = (html, id) => { const row = rowOf(html, id); return ['data-open' in row.attrs, byTestId(row.outer, 'roadmap-item-toggle').attrs['aria-expanded'], 'hidden' in byTestId(row.outer, 'roadmap-item-panel').attrs]; };
  const html = draw(R, d);
  assert.deepEqual([state(html, 'a'), state(html, 'b')], [[false, 'false', true], [false, 'false', true]]);
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(rowOf(html, 'b').outer, (e) => 'data-rm-edit' in e.attrs), ctx, d);
  const editing = draw(R, d);
  assert.deepEqual([state(editing, 'a'), state(editing, 'b')], [[false, 'false', true], [true, 'true', false]]);
  assert.ok(H.findEl(rowOf(editing, 'b').outer, (e) => hasClass(e, 'rm-form')), 'the Edit form is in the open row');
});

test('lanes: the unfolded finished rows take their place among the open ones, in the roadmap\'s own order, the "+n done" chip after the groups', async () => {
  const { R } = await ready();
  const d = roadmapOf([spent('a', 1, 1), item('b'), spent('c', 1, 1), item('d')], { state: 'planned' });
  const planned = { showAll: false, since: 'total' };
  const folded = draw(R, d, planned);
  assert.deepEqual(allByTestId(folded, 'roadmap-item').map((e) => e.attrs['data-item']), ['b', 'd']);
  const chip = byTestId(folded, 'roadmap-done-chip');
  await R.onClick(H.clickOn(folded, (e) => e.attrs['data-testid'] === 'roadmap-done-chip'), H.makeCtx().ctx, d);
  const unfolded = draw(R, d, planned);
  assert.deepEqual([text(chip), allByTestId(unfolded, 'roadmap-item').map((e) => e.attrs['data-item'])], ['+2 done', ['a', 'b', 'c', 'd']]);
  assert.ok(unfolded.indexOf('data-testid="roadmap-done-chip"') > unfolded.lastIndexOf('data-testid="roadmap-item"'), 'the chip closes the stage');
});
