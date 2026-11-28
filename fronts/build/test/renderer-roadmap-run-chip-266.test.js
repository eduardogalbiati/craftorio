// #266 "Readable statuses everywhere": the Roadmap card's run chip and readable states.
// Acceptance tests written before the code. fronts/build/views/backlog/backlog-roadmap.js is
// evaluated whole in a vm sandbox (test/roadmap-status-helpers.js loadRoadmap), with the real
// run-list.js chips, displayName and, when it exists, packages/ui-kit/status-pill.js (#266).
//
// Contract (the seam these tests assume):
// - An item with a run shows the kanban's run chip: an element carrying `data-run="<runId>"` (a click
//   opens the run, as backlog.js runLink and onClick's [data-run] handling do) that contains a
//   status pill (an element with `data-status`, the raw id: running / waiting / failed / …; the
//   visible label readable: "Running", "Waiting for you", "Failed", "Done") followed by the
//   workflow's display name (#245) and the run's title (window.runTitle of run-meta.js, here a stub
//   giving the issue's title). A running chip's pill holds the pulsing `.status-dot`.
// - An item that failed BEFORE any run started (an `error`, no `runId`): a pill reading
//   "Failed to start", no `data-run` anywhere in the card, the error in a title on (or around) that
//   pill and in the card's text; Retry and Skip stay ([data-rm-item="retry"], [data-rm-item="skip"]).
// - The roadmap bar's state badge and the item's state pill are readable ("Running", "Planned").
// - A sweep: no visible text node of the rendered roadmap equals a raw lower-case status id; the
//   pills keep data-status.
// "Visible text": tags dropped, never titles / aria-labels / svg / tooltip cards (role="tooltip").
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const RAW_IDS = ['running', 'waiting', 'queued', 'pending', 'planned', 'done', 'succeeded', 'success', 'failed', 'stopped', 'cancelled', 'interrupted', 'skipped', 'paused'];
const runTitle = (r) => (r && (r.title || (r.runId === 'run-42' ? 'Login page' : r.runId))) || 'workflow';
const view = { showAll: true, since: 'total' };

const trail = (step, status, extra = {}) => ({ step, status, ts: H.iso(H.NOW - 20 * H.MIN), durationMs: status === 'running' ? undefined : 60000, agents: [{ agent: 'developer', provider: 'claude', model: 'claude-sonnet-5', cost: 0.2, durationMs: 60000 }], ...extra });
function withRun(id, status, runStatus, extra = {}) {
  return H.item(id, status, 1, 'Login page', {
    runId: 'run-42', runs: ['run-42'], origin: H.iso(H.NOW - 2 * H.HOUR),
    run: H.run({ status: runStatus, startedAt: H.iso(H.NOW - 20 * H.MIN), finishedAt: runStatus === 'running' ? null : H.iso(H.NOW - 5 * H.MIN), progress: [trail('develop', runStatus === 'running' ? 'running' : runStatus === 'failed' ? 'failed' : 'done')] }),
    ...extra,
  });
}
function render(x, opts = {}) {
  const { R } = H.loadRoadmap({ runTitle });
  return R.html(H.roadmapOf([{ id: 'st1', name: '', note: '', items: [x] }], opts.roadmap), () => {}, opts.view || view);
}
// the run chip of item `id`: the element with data-run that holds a data-status pill
function runChip(html, id) {
  const box = H.itemEl(html, id);
  const chip = H.findAll(box.outer, (e) => e.attrs['data-run'] === 'run-42').find((e) => H.findEl(e.inner, (p) => 'data-status' in p.attrs));
  assert.ok(chip, 'the card has a run chip: an element with data-run holding a data-status pill');
  const pill = H.findEl(chip.inner, (p) => 'data-status' in p.attrs);
  return { chip, pill, text: H.visibleText(chip.inner), label: H.visibleText(pill.inner) };
}

test('#266 roadmap card: a run in progress shows the run chip "Running" (pulsing dot) + workflow name, opening the run; #282: not the run title again', () => {
  const { pill, label, text } = runChip(render(withRun('a', 'running', 'running')), 'a');
  assert.equal(pill.attrs['data-status'], 'running');
  assert.equal(label, 'Running');
  assert.ok(H.findEl(pill.inner, (e) => /\bstatus-dot\b/.test(e.attrs.class || '')), 'the running pill holds the pulsing .status-dot');
  assert.match(text, /local hero/i, 'the workflow\'s display name');
  assert.match(text, /Open run/);
  assert.doesNotMatch(text, /Login page/, 'the issues list already says the title');
});

test('#266 roadmap card: a run waiting at a gate shows the run chip "Waiting for you"', () => {
  const x = withRun('a', 'running', 'running', { waiting: true });
  x.run.waiting = true;
  x.run.progress = [trail('human_review', 'waiting', { type: 'human_approval', agents: [] })];
  const { pill, label } = runChip(render(x), 'a');
  assert.equal(pill.attrs['data-status'], 'waiting');
  assert.equal(label, 'Waiting for you');
});

test('#266 roadmap card: a failed item with a run shows the chip "Failed" + workflow name, still opening the run', () => {
  const { pill, label, text } = runChip(render(withRun('a', 'failed', 'failed')), 'a');
  assert.equal(pill.attrs['data-status'], 'failed');
  assert.equal(label, 'Failed');
  assert.match(text, /local hero/i);
  assert.match(text, /Open run/);
});

test('#266 roadmap card: a done item keeps a clickable chip with its final status, readable', () => {
  const { label } = runChip(render(withRun('a', 'done', 'success')), 'a');
  assert.match(label, /^(Done|Succeeded)$/);
});

test('#266 roadmap card: an item that failed before any run started says "Failed to start", is not a link, and shows the error', () => {
  const error = 'Could not start #241: Step testid_check references unknown agent';
  const x = H.item('a', 'failed', 241, 'Readable statuses', { error });
  const box = H.itemEl(render(x), 'a');
  assert.match(H.visibleText(box.outer), /Failed to start/);
  assert.equal(H.findEl(box.outer, (e) => 'data-run' in e.attrs), null, 'no data-run: nothing to open');
  // the lanes (2026-11-27): "Failed to start" is the row's line, the error the line under it, whole in its own tooltip
  const label = H.findEl(box.outer, (e) => e.attrs['data-testid'] === 'status-label');
  assert.deepEqual([H.visibleText(label.inner), label.attrs['data-status']], ['Failed to start', 'failed_to_start']);
  const line = H.findEl(box.outer, (e) => /\brm-error\b/.test(e.attrs.class || ''));
  assert.deepEqual([line.attrs.title, H.visibleText(line.inner).includes(error)], [error, true], 'the row shows the error, its tooltip the whole of it');
  assert.ok(H.findEl(box.outer, (e) => e.attrs['data-rm-item'] === 'retry'), 'Retry stays');
  assert.ok(H.findEl(box.outer, (e) => e.attrs['data-rm-item'] === 'skip'), 'Skip stays');
});

// #269: the bar's state is a dot (no text badge); its readable state is in its title and aria-label.
test('#266 roadmap bar: the roadmap\'s state dot reads "Running", not "running"', () => {
  const html = render(H.item('a', 'planned', 1, 'Login page', { origin: H.iso(H.NOW - H.HOUR) }));
  const bar = H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-bar');
  assert.ok(bar, 'the roadmap bar is rendered');
  const dot = H.findEl(bar.inner, (e) => /\brm-state-dot\b/.test(e.attrs.class || ''));
  assert.ok(dot, 'the bar has a state dot');
  assert.match(dot.attrs['aria-label'] || '', /^Running\b/);
  assert.match(dot.attrs.title || '', /^Running\b/);
  assert.ok(!H.textNodes(bar.inner).includes('running'));
});

test('#266 roadmap card: a planned item\'s state pill reads "Planned" with data-status="planned"', () => {
  const box = H.itemEl(render(H.item('a', 'planned', 1, 'Login page', { origin: H.iso(H.NOW - H.HOUR) })), 'a');
  const pill = H.findEl(box.outer, (e) => e.attrs['data-status'] === 'planned' && e.attrs['data-testid'] !== 'roadmap-item');
  assert.ok(pill, 'the state pill has data-status="planned"');
  assert.equal(H.visibleText(pill.inner), 'Planned');
});

test('#266 sweep: the roadmap with every item state shows no raw lower-case status id as visible text, and keeps data-status', () => {
  const recent = H.iso(H.NOW - H.HOUR);
  const waiting = withRun('w', 'running', 'running', { waiting: true });
  waiting.runId = 'run-43';
  const items = [
    H.item('p', 'planned', 1, 'Planned one', { origin: recent }),
    withRun('r', 'running', 'running'),
    waiting,
    { ...withRun('d', 'done', 'success'), runId: 'run-44' },
    { ...withRun('f', 'failed', 'failed'), runId: 'run-45' },
    H.item('s', 'skipped', 6, 'Skipped one', { origin: recent }),
  ];
  const { R } = H.loadRoadmap({ runTitle });
  const html = R.html(H.roadmapOf([{ id: 'st1', name: '', note: '', items }]), () => {}, view);
  const leaks = H.textNodes(html).filter((t) => RAW_IDS.includes(t));
  assert.deepEqual(leaks, []);
  const ids = new Set(H.findAll(html, (e) => 'data-status' in e.attrs).map((e) => e.attrs['data-status']));
  for (const id of ['planned', 'running', 'waiting', 'failed', 'skipped']) assert.ok(ids.has(id), `a data-status="${id}" pill`);
});
