// #804 Skip says what starts next and can leave the roadmap paused. Acceptance tests written before the
// code: the screen on the whole page (the real index.html and the real dialogs, packages/ui-kit/test/
// agent-chat-page-harness.js, so it does not matter which modal the dialog is built on) and the channel
// through the service (mock runs only, as #391's tests).
//
// The contract (shared with the BDD agent):
// - clicking Skip on the item that paused the roadmap, when work would start, opens `roadmap-skip-dialog`,
//   whose text names the next stage or item; `roadmap-skip-go-on` calls window.api.roadmapItem as today,
//   `roadmap-skip-stay-paused` with keepPaused true (roadmapItem(projectId, itemId, action, confirmed,
//   keepPaused)), and a way to cancel calls nothing. No work would start: no dialog, the call as today.
// - channel `roadmap:item`: params projectId, itemId, action, confirmed, keepPaused (a flag).
//
// The dialog may live in the page or in the Roadmap's own markup: the screen is drawn into #bl-list on
// every render, so both are found the same way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { ISSUE_WORKFLOW, makeService, roadmapProject, until, watchRuns } = require('@craftorio/engine/test/service/helpers');
const H = require('../roadmap-status-helpers');

const ERROR = 'Stage 1: #1 failed.';
const item = (id, number, title, over = {}) => ({ id, status: 'planned', workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: false, issues: [H.ref(number, title)], runId: null, runs: [], error: null, ...over });
const failed = () => item('i1', 1, 'Login page', { status: 'failed', runId: 'r1', runs: ['r1'], error: 'boom' });
const stage = (id, items, over = {}) => ({ id, name: '', note: '', items, ...over });
const paused = (stages, over = {}) => ({ roadmap: { state: 'paused', pausedBy: 'i1', error: ERROR, stages, ...over }, issues: [] });

// a roadmap whose next item is in the same stage, and one whose next stage has a name
const NEXT_ITEM = () => paused([stage('s1', [failed(), item('i2', 2, 'Logout button')])]);
const NEXT_STAGE = () => paused([stage('s1', [failed()]), stage('s2', [item('i3', 3, 'Reset password')], { name: 'Hardening' })]);

// the Roadmap drawn in the page; every window.api.roadmapItem call as [projectId, itemId, action, keepPaused]
async function open(data) {
  const calls = [];
  const page = await loadPage({
    api: { roadmapItem: async (projectId, itemId, action, confirmed, keepPaused) => { calls.push([String(projectId), String(itemId), String(action), !!keepPaused]); return { roadmap: { state: 'running', stages: [] }, issues: [] }; } },
  });
  const R = page.sandbox.BacklogRoadmap;
  const host = page.$('#bl-list');
  const errors = [];
  const ctx = { projectId: 'p1', setData() {}, setError: (e) => errors.push(String(e)), render: () => { host.innerHTML = R.html(data, () => {}, { showAll: true, since: 'total' }); } };
  ctx.render();
  host.addEventListener('click', (e) => { R.onClick(e, ctx, data); });
  return { page, R, ctx, data, calls, errors };
}
const shown = (el) => {
  for (let n = el; n; n = n.parentElement) if (n.classList?.contains('hidden') || n.hidden) return false;
  return true;
};
function dialogOf(page) {
  const el = page.$('[data-testid="roadmap-skip-dialog"]');
  return el && shown(el) ? el : null;
}
async function click(s, itemId, action) {
  const button = s.page.$(`#bl-list [data-item="${itemId}"] [data-rm-item="${action}"]`);
  assert.ok(button, `item ${itemId} offers ${action}`);
  button.click();
  await settle();
}
async function clickInDialog(s, testid) {
  const button = s.page.$(`[data-testid="${testid}"]`);
  assert.ok(button, `the dialog has ${testid}`);
  button.click();
  await settle();
}
// the dialog's Cancel, or Esc when it has no such button
async function cancel(s) {
  const dialog = dialogOf(s.page);
  assert.ok(dialog, 'the dialog is open');
  const box = dialog.closest('.modal') || dialog;
  const button = Array.from(box.querySelectorAll('button')).find((b) => shown(b) && /^(cancel|cancelar)$/i.test(textOf(b) || b.getAttribute('aria-label') || ''));
  if (button) button.click();
  else box.dispatchEvent(new s.page.sandbox.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
}

// ---- criterion 1: the action names what starts next -------------------------------------------------------

test('#804 Skip on the item that paused the roadmap asks first, naming the next item of its stage; nothing is called yet', async () => {
  const s = await open(NEXT_ITEM());
  await click(s, 'i1', 'skip');
  const dialog = dialogOf(s.page);
  assert.ok(dialog, 'the dialog opens');
  assert.match(textOf(dialog), /#2\b|Logout button/);
  assert.deepEqual(s.calls, []);
});

test('#804 Skip on the item that paused the roadmap, the last of its stage: the dialog names the next stage or its item', async () => {
  const s = await open(NEXT_STAGE());
  await click(s, 'i1', 'skip');
  const dialog = dialogOf(s.page);
  assert.ok(dialog, 'the dialog opens');
  assert.match(textOf(dialog), /Hardening|Stage 2|#3\b|Reset password/);
});

test('#804 the paused roadmap\'s alert offers the same choice: its Skip asks first too', async () => {
  const s = await open(NEXT_STAGE());
  const skip = Array.from(s.R.alerts(s.data, s.ctx)[0].actions).find((a) => a.label === 'Skip');
  skip.onClick();
  await settle();
  assert.deepEqual([!!dialogOf(s.page), s.calls], [true, []]);
});

test('#804 Skip on an item that did not pause the roadmap: no dialog, the call as today', async () => {
  const s = await open(paused([stage('s1', [failed(), item('i2', 2, 'Logout button', { status: 'failed', runId: 'r2', runs: ['r2'], error: 'also' })]), stage('s2', [item('i3', 3, 'Reset password')])]));
  await click(s, 'i2', 'skip');
  assert.deepEqual([!!dialogOf(s.page), s.calls], [false, [['p1', 'i2', 'skip', false]]]);
});

for (const [label, data] of [
  ['it is the only item left', () => paused([stage('s1', [failed()])])],
  ['the items after it are finished', () => paused([stage('s1', [failed(), item('i2', 2, 'Logout button', { status: 'done' })]), stage('s2', [item('i3', 3, 'Reset password', { status: 'skipped' })])])],
  ['only a disabled stage follows', () => paused([stage('s1', [failed()]), stage('s2', [item('i3', 3, 'Reset password')], { disabled: true })])],
  ['the roadmap runs its stage alone and it has nothing left', () => paused([stage('s1', [failed()]), stage('s2', [item('i3', 3, 'Reset password')])], { scope: { stage: 's1' } })],
]) {
  test(`#804 nothing would start (${label}): Skip has no dialog, the call as today`, async () => {
    const s = await open(data());
    await click(s, 'i1', 'skip');
    assert.deepEqual([!!dialogOf(s.page), s.calls], [false, [['p1', 'i1', 'skip', false]]]);
  });
}

test('#804 Retry on the item that paused the roadmap: no dialog, the call as today', async () => {
  const s = await open(NEXT_STAGE());
  await click(s, 'i1', 'retry');
  assert.deepEqual([!!dialogOf(s.page), s.calls], [false, [['p1', 'i1', 'retry', false]]]);
});

// ---- criterion 2: the choice ---------------------------------------------------------------------------------

test('#804 "skip and go on" makes the call without keepPaused, and the dialog closes', async () => {
  const s = await open(NEXT_STAGE());
  await click(s, 'i1', 'skip');
  await clickInDialog(s, 'roadmap-skip-go-on');
  assert.deepEqual([s.calls, !!dialogOf(s.page)], [[['p1', 'i1', 'skip', false]], false]);
});

test('#804 "skip and stay paused" makes the call with keepPaused true, and the dialog closes', async () => {
  const s = await open(NEXT_STAGE());
  await click(s, 'i1', 'skip');
  await clickInDialog(s, 'roadmap-skip-stay-paused');
  assert.deepEqual([s.calls, !!dialogOf(s.page)], [[['p1', 'i1', 'skip', true]], false]);
});

test('#804 cancelling the dialog calls nothing', async () => {
  const s = await open(NEXT_STAGE());
  await click(s, 'i1', 'skip');
  await cancel(s);
  assert.deepEqual([s.calls, !!dialogOf(s.page)], [[], false]);
});

// ---- criterion 3: the channel takes the same choice -----------------------------------------------------------

const ONE_SLOT = { concurrentRuns: { enabled: true, max: 1, perProject: null, countSimulations: true } };
const ticks = (ms = 500) => new Promise((r) => setTimeout(r, ms));
const hasIssue = (r, n) => (r.issues || []).some((i) => i.number === n);

// a simulated roadmap of two stages, #1 stopped: paused by its item, #2 not started
async function pausedByFailure(t, name) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], name);
  api['settings:set'](ONE_SLOT);
  watchRuns(service);
  await api['roadmap:save']({ projectId: p.id, stages: [1, 2].map((number) => ({ items: [{ workflow: 'fixture-issue.yaml', number, mock: true }] })) });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  const runOf = (n) => api['runs:active']().find((r) => hasIssue(r, n));
  await until(() => !!runOf(1));
  const get = () => api['roadmap:get']({ projectId: p.id });
  const itemId = get().stages[0].items[0].id;
  api['run:stop']({ runId: runOf(1).runId });
  await until(() => get().state === 'paused' && !runOf(1));
  assert.equal(get().pausedBy, itemId);
  return { api, p, get, itemId, runOf };
}

test('#804 channel roadmap:item names keepPaused after confirmed, a flag', () => {
  const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
  const ctx = new Proxy({}, { get: (target, key) => (key === 'ws' ? null : stub) });
  const entry = require('@craftorio/engine/service/channels/roadmap')(ctx).find((e) => e.channel === 'roadmap:item');
  assert.deepEqual([entry.method, entry.params], ['roadmapItem', ['projectId', 'itemId', 'action', 'confirmed', 'keepPaused']]);
  assert.deepEqual(entry.schema.params.properties.keepPaused, { type: ['boolean', 'null'] });
});

test('#804 roadmap:item skip with keepPaused: the roadmap stays paused, nothing starts, and #2 starts once the owner resumes', async (t) => {
  const { api, p, get, itemId, runOf } = await pausedByFailure(t, 'skip-keep');
  await api['roadmap:item']({ projectId: p.id, itemId, action: 'skip', keepPaused: true });
  await ticks();
  const r = get();
  assert.deepEqual([r.state, r.pausedBy, r.error, !!runOf(2)], ['paused', null, null, false]);
  assert.deepEqual(r.stages.map((s) => s.items[0].status), ['skipped', 'planned']);

  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => !!runOf(2));
});

test('#804 roadmap:item skip without the choice goes on as today: #2 starts', async (t) => {
  const { api, p, get, itemId, runOf } = await pausedByFailure(t, 'skip-on');
  await api['roadmap:item']({ projectId: p.id, itemId, action: 'skip' });
  await until(() => !!runOf(2));
  assert.equal(get().state, 'running');
});

test('#804 roadmap:item retry with keepPaused behaves as a retry: the roadmap goes on and #1 runs again', async (t) => {
  const { api, p, get, itemId, runOf } = await pausedByFailure(t, 'retry-keep');
  await api['roadmap:item']({ projectId: p.id, itemId, action: 'retry', keepPaused: true });
  await until(() => !!runOf(1));
  assert.equal(get().state, 'running');
});
