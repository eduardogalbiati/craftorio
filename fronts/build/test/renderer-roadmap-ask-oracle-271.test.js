// #271 "Ask the Oracle about this failure" on the Roadmap's cards. Acceptance tests written before
// the code. fronts/build/views/backlog/backlog-roadmap.js is evaluated whole in a vm sandbox
// (test/roadmap-status-helpers.js loadRoadmap); the shared context helper is evaluated into the same
// sandbox after it: apps/desktop/renderer/oracle-context.js when the change creates it, then the real
// packages/ui-kit/gate-oracle.js (window.GateOracle). So backlog-roadmap.js must look the helper up when
// it renders / clicks (window.GateOracle… or window.OracleContext…), never at load time.
// window.OracleChat is a stub: { openWith(context) (recorded), pendingRef() }.
//
// Interface the developer implements:
// - A roadmap card whose item failed (status 'failed': its run failed, was interrupted or stopped /
//   cancelled, or it failed to start: an `error` and no `runId`) shows
//     <button type="button" data-rm-ask-oracle …><span class="oracle-avatar …">…</span>Ask the Oracle about this failure</button>
//   ("… about this interruption" when its run was interrupted). No such button on planned, running,
//   waiting or done cards.
// - BacklogRoadmap.onClick on it (returns true) calls window.OracleChat.openWith(context) once, the
//   context (any shape, checked through JSON.stringify) carrying the run id, the item's issue
//   numbers, the status, the error text, and the prefilled question
//   "What happened to this run, and what should I do: retry, resume from a step, skip or fix something first?"
//   An item that failed to start (no run) sends its error and no run id (no non-empty run_id / runId).
// - Context building is shared with gate-oracle.js (a generalised helper); tested only through the
//   card and the openWith call.
// - While the Oracle answers another question (window.OracleChat.pendingRef() returns another ref,
//   gate-oracle.js's busy mechanism) the button reads "Oracle is answering…".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (phase 3 of the reorganisation study)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const H = require('./roadmap-status-helpers');

const QUESTION = 'What happened to this run, and what should I do: retry, resume from a step, skip or fix something first?';
const view = { showAll: true, since: 'total' };
const recent = H.iso(H.NOW - H.HOUR);

function load({ pending = null } = {}) {
  const out = H.loadRoadmap();
  const opened = [];
  out.sandbox.Robots = { svg: () => '<svg></svg>' };
  out.sandbox.showToast = () => {};
  out.sandbox.OracleChat = { openWith: (ctx) => { opened.push(JSON.stringify(ctx)); }, pendingRef: () => pending, open() {} };
  for (const file of ['oracle-context.js', 'gate-oracle.js']) {
    const p = pageFileOf(file);
    if (p) vm.runInContext(fs.readFileSync(p, 'utf8'), out.sandbox);
  }
  return { ...out, opened };
}

const failedRun = (runStatus, error) => H.item('a', 'failed', 241, 'Readable statuses', {
  runId: 'run-42', runs: ['run-42'], origin: recent, error,
  run: H.run({ status: runStatus, startedAt: H.iso(H.NOW - 20 * H.MIN), finishedAt: H.iso(H.NOW - 5 * H.MIN), error }),
});
const FAILED = () => failedRun('failed', 'Run run-42 failed: 3 tests failed in test/roadmap.test.js');
const INTERRUPTED = () => failedRun('interrupted', 'Run run-42 was interrupted');
const STOPPED = () => failedRun('cancelled', 'Run run-42 cancelled');
const NOT_STARTED = () => H.item('a', 'failed', 241, 'Readable statuses', { origin: recent, error: 'Could not start #241: Step testid_check references unknown agent' });

const dataOf = (x, roadmap = { state: 'paused', pausedBy: x.id, error: x.error || null }) => H.roadmapOf([{ id: 'st1', name: '', note: '', items: [x] }], roadmap);
const askBtn = (html, id = 'a') => H.findEl(H.itemEl(html, id).outer, (e) => 'data-rm-ask-oracle' in e.attrs);

test('#271 a failed item\'s card has "Ask the Oracle about this failure" with the Oracle\'s avatar', () => {
  const { R } = load();
  const btn = askBtn(R.html(dataOf(FAILED()), () => {}, view));
  assert.ok(btn, 'a [data-rm-ask-oracle] button on the card');
  assert.equal(H.visibleText(btn.inner), 'Ask the Oracle about this failure');
  assert.equal(!!H.findEl(btn.inner, (e) => /\boracle-avatar\b/.test(e.attrs.class || '')), true, 'the Oracle\'s avatar');
});

test('#271 an interrupted run\'s card asks "about this interruption"; a stopped run and a failed start show the button too', () => {
  const { R } = load();
  const label = (x) => { const b = askBtn(R.html(dataOf(x), () => {}, view)); return b ? H.visibleText(b.inner) : null; };
  assert.equal(label(INTERRUPTED()), 'Ask the Oracle about this interruption');
  assert.match(label(STOPPED()) || '', /^Ask the Oracle about this /);
  assert.match(label(NOT_STARTED()) || '', /^Ask the Oracle about this /);
});

test('#271 no Ask the Oracle button on planned, running, waiting or done cards', () => {
  const { R } = load();
  const running = H.item('r', 'running', 2, 'Two', { runId: 'run-50', runs: ['run-50'], origin: recent, run: H.run({ status: 'running', startedAt: recent }) });
  const waiting = H.item('w', 'running', 3, 'Three', { runId: 'run-51', runs: ['run-51'], origin: recent, waiting: true, run: H.run({ status: 'running', waiting: true, startedAt: recent }) });
  const done = H.item('d', 'done', 4, 'Four', { runId: 'run-52', runs: ['run-52'], origin: recent, run: H.run({ status: 'success', startedAt: recent, finishedAt: recent }) });
  const items = [H.item('p', 'planned', 1, 'One', { origin: recent }), running, waiting, done];
  const html = R.html(H.roadmapOf([{ id: 'st1', name: '', note: '', items }], { state: 'running' }), () => {}, view);
  assert.deepEqual(['p', 'r', 'w', 'd'].map((id) => !!askBtn(html, id)), [false, false, false, false]);
});

test('#271 a click opens the Oracle with the run id, the issue numbers, the status, the error and the prefilled question', async () => {
  const { R, opened } = load();
  const d = dataOf(FAILED());
  const html = R.html(d, () => {}, view);
  const { ctx } = H.makeCtx();
  const handled = await R.onClick(H.clickOn(html, (e) => 'data-rm-ask-oracle' in e.attrs), ctx, d);
  assert.equal(handled, true);
  assert.equal(opened.length, 1, 'OracleChat.openWith was called once');
  const sent = opened[0];
  for (const v of ['run-42', '241', 'failed', '3 tests failed in test/roadmap.test.js', QUESTION]) {
    assert.ok(sent.includes(v), `the Oracle's context has ${v}`);
  }
});

test('#271 a failed start (no run) sends the item\'s error and no run id', async () => {
  const { R, opened } = load();
  const d = dataOf(NOT_STARTED());
  const html = R.html(d, () => {}, view);
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(html, (e) => 'data-rm-ask-oracle' in e.attrs), ctx, d);
  assert.equal(opened.length, 1);
  assert.ok(opened[0].includes('Step testid_check references unknown agent'), 'the error is sent');
  assert.ok(opened[0].includes('241'), 'the issue number is sent');
  assert.equal(/"run_?id"\s*:\s*"[^"]+"/i.test(opened[0]), false, 'no run id');
});

// the lanes (2026-11-27): what the owner must do, Retry and Skip, is one group under the row's title
// (.rm-fail-actions); Ask the Oracle is in the open row with what opens from there (.rm-panel-open), and
// the reorder arrows and "remove" in the open row's .rm-actions
test('#271 a failed row groups Retry and Skip in .rm-fail-actions; Ask the Oracle is in its open row, apart from the arrows and remove', () => {
  const { R } = load();
  const card = H.itemEl(R.html(dataOf(FAILED()), () => {}, view), 'a').outer;
  const group = H.findEl(card, (e) => /\brm-fail-actions\b/.test(e.attrs.class || ''));
  assert.ok(group, 'a .rm-fail-actions group on the failed card');
  const has = (html, pred) => !!H.findEl(html, pred);
  assert.deepEqual([
    has(group.inner, (e) => e.attrs['data-rm-item'] === 'retry'),
    has(group.inner, (e) => e.attrs['data-rm-item'] === 'skip'),
    has(group.inner, (e) => 'data-rm-ask-oracle' in e.attrs),
    has(group.inner, (e) => 'data-rm-move' in e.attrs || 'data-rm-remove' in e.attrs),
  ], [true, true, false, false]);
  const opens = H.findEl(card, (e) => /\brm-panel-open\b/.test(e.attrs.class || ''));
  assert.equal(has(opens.inner, (e) => 'data-rm-ask-oracle' in e.attrs), true, 'Ask the Oracle beside "Open run" and "Show on the map"');
  const actions = H.findEl(card, (e) => /\brm-actions\b/.test(e.attrs.class || ''));
  assert.equal(has(actions.inner, (e) => 'data-rm-remove' in e.attrs), true, 'remove stays in .rm-actions');
  assert.equal(has(actions.inner, (e) => 'data-rm-ask-oracle' in e.attrs || e.attrs['data-rm-item'] === 'retry'), false);
});

test('#271 planned and running cards have no .rm-fail-actions group', () => {
  const { R } = load();
  const running = H.item('r', 'running', 2, 'Two', { runId: 'run-50', runs: ['run-50'], origin: recent, run: H.run({ status: 'running', startedAt: recent }) });
  const html = R.html(H.roadmapOf([{ id: 'st1', name: '', note: '', items: [H.item('p', 'planned', 1, 'One', { origin: recent }), running] }], { state: 'running' }), () => {}, view);
  const group = (id) => !!H.findEl(H.itemEl(html, id).outer, (e) => /\brm-fail-actions\b/.test(e.attrs.class || ''));
  assert.deepEqual([group('p'), group('r')], [false, false]);
});

// #282: the rows answer to their group's own width (a container query on .rm-items), so a narrow window and
// the Oracle's drawer beside the page are the same case: no rule per window width or for .shell.oracle-side
test('#271 backlog.css stacks Retry / Skip under the row\'s titles, and a group too narrow for its rows scrolls inside itself, whatever narrows it (window or the Oracle beside the page)', () => {
  const css = fs.readFileSync(pageFileOf('views/backlog/backlog.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.rm-items\s*\{[^}]*container:\s*rm-card\s*\/\s*inline-size/, 'the rows\' list is the container');
  assert.match(css, /@container\s+rm-card\s*\(max-width:\s*\d+px\)\s*\{\s*\.rm-group-scroll\s*\{[^}]*overflow-x:\s*auto/, 'a narrow group scrolls sideways inside itself');
  // the run cell is a column: the titles, the row\'s line, the error, then Retry / Skip, which wrap
  assert.match(css, /\.rm-cell-run\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /(^|[\s,}])\.rm-fail-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.rm-panel-open, \.rm-actions\s*\{[^}]*flex-wrap:\s*wrap/, 'the open row\'s buttons wrap too (the Oracle\'s longer one)');
  assert.doesNotMatch(css, /\.shell\.oracle-side \.rm-/);
});

test('#271 while the Oracle answers another question the button reads "Oracle is answering…"', () => {
  const { R } = load({ pending: 'gate:other-approval' });
  const btn = askBtn(R.html(dataOf(FAILED()), () => {}, view));
  assert.ok(btn, 'the button is still on the card');
  assert.equal(H.visibleText(btn.inner), 'Oracle is answering…');
});
