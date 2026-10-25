// #266 "Readable statuses everywhere": the shared status helper and the screens outside the Roadmap.
// Acceptance tests written before the code.
//
// Contract (the seam these tests assume; the developer implements it):
// - A new dual-mode renderer module packages/ui-kit/status-pill.js (Browser: window.StatusPill; Node:
//   module.exports), following display-name.js / estimates.js:
//     statusLabel(status, { waiting }) → the readable label ("Running", "Waiting for you", …; an
//       unknown id with its first letter capitalised). `waiting: true` (a run at a human gate) reads
//       "Waiting for you" whatever the status.
//     statusPill(status, { waiting, title }) → '<span class="pill pill-<tone>" data-status="<id>"
//       title="…">…Label</span>'. data-status keeps the raw id ("waiting" for a run at a gate), the
//       title (when given) is the tooltip. A running pill holds a dot element with class
//       `status-dot` (the sidebar's dot) that pulses.
// - style.css (or any apps/desktop/renderer css): a rule whose selector names the pill's `.status-dot` (with
//   `pill` in the selector) sets `animation: pulse` (the sidebar's keyframes) and the accent colour,
//   and a `@media (prefers-reduced-motion: reduce)` block sets `animation: none` for it.
// - The kanban / list card's run chip (backlog.js runLink) and the run list row (run-list.js
//   runListRow) show the readable label; the id stays in data-status.
// The module is required inside each test (loadStatusPill), so this file loads before it exists.
// Not unit-testable here: the pulse as seen on screen (only the CSS text is checked).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('@multiagent/desktop/test/roadmap-status-helpers');

// every css file of the page (the UI kit's, the fronts', the page folder's: scripts/source-tree.js pageFiles), as one text
function allCss() {
  const root = path.join(__dirname, '..', '..', '..');
  const { pageFiles } = require('../../../scripts/source-tree');
  return pageFiles(root, { match: /\.css$/ }).map((f) => fs.readFileSync(path.join(root, f.file), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}
// the top-level rules [{ selector, body }] of some css (the @media blocks' inner rules not included)
function rules(css) {
  return [...css.matchAll(/(^|[}\s])([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[2].trim(), body: m[3] }));
}
// the inner text of each `@media (prefers-reduced-motion: reduce) { … }` block
function reducedMotionBlocks(css) {
  const out = [];
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out;
}
const isPillDot = (selector) => /status-dot/.test(selector) && /pill/.test(selector);

// ---- the shared helper ---------------------------------------------------------------------------

test('#266 statusLabel maps every run and item status id to its readable label', () => {
  const { statusLabel } = H.loadStatusPill();
  const expected = {
    running: 'Running',
    waiting: 'Waiting for you',
    queued: 'Queued',
    pending: 'Pending',
    planned: 'Planned',
    done: 'Done',
    succeeded: 'Succeeded',
    failed: 'Failed',
    stopped: 'Stopped',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
    skipped: 'Skipped',
    paused: 'Paused',
    local: 'Merged locally', // the kanban's column id for "merged into the local base, not pushed"
    simulated: 'Simulated',
  };
  const got = Object.fromEntries(Object.keys(expected).map((id) => [id, statusLabel(id)]));
  assert.deepEqual(got, expected);
});

test('#266 statusLabel: a running run waiting at a human gate reads "Waiting for you"', () => {
  const { statusLabel } = H.loadStatusPill();
  assert.equal(statusLabel('running', { waiting: true }), 'Waiting for you');
});

test('#266 statusLabel: an unknown status falls back to its id with the first letter capitalised', () => {
  const { statusLabel } = H.loadStatusPill();
  assert.equal(statusLabel('mystery'), 'Mystery');
});

test('#266 statusPill: the pill shows the readable label, keeps the raw id in data-status and the tooltip in title', () => {
  const { statusPill } = H.loadStatusPill();
  const el = H.findEl(statusPill('failed', { title: 'Step develop failed' }), (e) => 'data-status' in e.attrs);
  assert.ok(el, 'a pill with data-status');
  assert.equal(el.attrs['data-status'], 'failed');
  assert.equal(H.visibleText(el.inner), 'Failed');
  assert.equal(el.attrs.title, 'Step develop failed');
  assert.match(el.attrs.class, /\bpill\b/);
});

test('#266 statusPill: a run waiting at a gate is data-status="waiting" and reads "Waiting for you"', () => {
  const { statusPill } = H.loadStatusPill();
  const el = H.findEl(statusPill('running', { waiting: true }), (e) => 'data-status' in e.attrs);
  assert.equal(el.attrs['data-status'], 'waiting');
  assert.equal(H.visibleText(el.inner), 'Waiting for you');
});

test('#266 statusPill: a running pill holds the sidebar\'s dot (.status-dot) next to "Running"', () => {
  const { statusPill } = H.loadStatusPill();
  const html = statusPill('running');
  const pill = H.findEl(html, (e) => e.attrs['data-status'] === 'running');
  assert.ok(pill, 'a pill with data-status="running"');
  assert.equal(H.visibleText(pill.inner), 'Running');
  assert.ok(H.findEl(pill.inner, (e) => /\bstatus-dot\b/.test(e.attrs.class || '')), 'a .status-dot inside the running pill');
});

test('#266 statusPill: an ended run\'s pill has no dot to pulse', () => {
  const { statusPill } = H.loadStatusPill();
  assert.equal(H.findEl(statusPill('failed'), (e) => /\bstatus-dot\b/.test(e.attrs.class || '')), null);
});

// ---- the pulse (CSS) -----------------------------------------------------------------------------

test('#266 css: the running pill\'s dot pulses like the sidebar\'s (animation: pulse) in the accent colour', () => {
  const css = allCss();
  const dot = rules(css).filter((r) => isPillDot(r.selector));
  assert.ok(dot.some((r) => /animation\s*:\s*pulse\b/.test(r.body)), 'a .pill … .status-dot rule with animation: pulse');
  assert.ok(dot.some((r) => /var\(--accent\)/.test(r.body)), 'a .pill … .status-dot rule in var(--accent)');
});

test('#266 css: prefers-reduced-motion turns the running pill\'s pulse off', () => {
  const inner = reducedMotionBlocks(allCss()).join('\n');
  const off = rules(inner).filter((r) => isPillDot(r.selector) && /animation\s*:\s*none/.test(r.body));
  assert.ok(off.length > 0, 'a @media (prefers-reduced-motion: reduce) rule for the pill\'s .status-dot with animation: none');
});

// ---- the kanban / list card's run chip (backlog.js runLink) ----------------------------------------

const kanbanRun = (extra = {}) => ({ runId: 'run-7', workflow: 'software-development-local-hero.yaml', status: 'running', title: 'Login page', ...extra });

test('#266 kanban card: a running run\'s chip reads "Running" (not "running"), its id in data-status, still opening the run', () => {
  const html = H.loadRunLink()(kanbanRun());
  const pill = H.findEl(html, (e) => 'data-status' in e.attrs);
  assert.ok(pill, 'the chip\'s status has data-status');
  assert.equal(pill.attrs['data-status'], 'running');
  assert.equal(H.visibleText(pill.inner), 'Running');
  assert.ok(H.findEl(html, (e) => e.attrs['data-run'] === 'run-7'), 'the chip keeps data-run');
  assert.ok(!H.textNodes(html).includes('running'));
});

test('#266 kanban card: a run waiting at a gate reads "Waiting for you" (not "waiting")', () => {
  const html = H.loadRunLink()(kanbanRun({ waiting: true }));
  const pill = H.findEl(html, (e) => 'data-status' in e.attrs);
  assert.ok(pill, 'the chip\'s status has data-status');
  assert.equal(pill.attrs['data-status'], 'waiting');
  assert.equal(H.visibleText(pill.inner), 'Waiting for you');
  assert.ok(!H.textNodes(html).includes('waiting'));
});

// ---- the run list (run-list.js runListRow) --------------------------------------------------------

test('#266 run list: a row\'s status pill is readable ("Failed", "Running") with the id in data-status', () => {
  const rl = H.loadRunList();
  const row = (status) => rl.runListRow({ runId: `run-${status}`, status, workflow: 'software-development.yaml', startedAt: '2026-10-04T11:00:00.000Z', durationMs: 60000, progress: [] }, { expanded: new Set(), id: 'p1', msgs: new Map() });
  for (const [status, label] of [['failed', 'Failed'], ['running', 'Running']]) {
    const html = row(status);
    const pill = H.findEl(html, (e) => e.attrs['data-status'] === status);
    assert.ok(pill, `the ${status} row's pill has data-status="${status}"`);
    assert.equal(H.visibleText(pill.inner), label);
    assert.ok(!H.textNodes(html).includes(status), `no raw "${status}" in the row's visible text`);
  }
});
