// #603 acceptance: a gate answered from the Run screen's gate card updates from the HTTP answer at
// once (optimistic); the approval.resolved push only confirms it. In the remote-engine window that
// push can be lost: the gate card, the sidebar's gates badge and the run's entry in the left menu
// must not keep showing a gate that was answered.
//
// Driven through the page's own seam: the whole page loaded by
// packages/ui-kit/test/renderer-app-harness.js, the run events handed to the handlers it registered with
// window.api.onEvent, and a click on the gate card's button handed to the Run screen's
// onRunGateClick (fronts/build/views/run/run.js) with a fake card, as renderer-run-gates.test.js does.
//
// The interface these tests expect (the developer implements it; this file is not edited):
// 1. `api.resolveApproval(...)` resolving `true` (the engine took the answer): at once, with no
//    approval.resolved event, the gate leaves the run's pending gates (`state.runs.get(runId).approvals`,
//    what pendingGates(), the gate card, the sidebar badge `#nav-run-gates` and the run's entry in
//    `#nav-runs` read): the badge shows no gate and the run's entry no longer says "Waiting for you".
//    A later approval.resolved push for it changes nothing more.
// 2. `api.resolveApproval(...)` resolving `{ already_answered: true, answered_at: <ISO date> }` (the
//    engine's answer for a gate answered before, packages/engine/test/service/gates-already-answered-603.test.js):
//    the page shows a text matching /already answered at <the time>/i (on the card, or in a toast),
//    never the error toasts ("Could not answer the gate", "The gate did not accept the answer"), and
//    the gate leaves the pending gates as in 1.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('@multiagent/ui-kit/test/renderer-app-harness');

const ts = (s) => `2026-10-25T10:00:${String(s).padStart(2, '0')}.000Z`;

async function openPage(resolveApproval) {
  const page = loadApp({ api: { listActiveRuns: async () => [], resolveApproval } });
  await page.boot();
  page.el('#toast').innerHTML = '';
  return page;
}
const fire = (page, ev) => { for (const fn of page.apiHandlers.onEvent || []) fn(ev); };

// a run waiting at its gate g1
async function runAtGate(page) {
  fire(page, { seq: 1, run_id: 'r1', ts: ts(0), type: 'workflow.started', workflow: 'fixture', version: '1', mock: true, inputs: {}, steps: [{ id: 'work' }, { id: 'review' }] });
  fire(page, { seq: 2, run_id: 'r1', ts: ts(1), type: 'approval.requested', approval_id: 'g1', step_id: 'review', message: 'Merge?' });
  await page.settle(20);
}

// primitives only: the run's pending gates, the badge, the run's menu entry
const pending = (page) => JSON.parse(page.run('JSON.stringify([...(state.runs.get("r1")?.approvals?.keys() || [])])'));
const pendingCount = (page) => Number(page.run('pendingGates().length'));
const badgeShowsGates = (page) => {
  const b = page.el('#nav-run-gates');
  return !b.classList.contains('hidden') && String(b.textContent) !== '0' && String(b.textContent) !== '';
};
const navRunsText = (page) => text(page.el('#nav-runs').innerHTML);

// A recording element: what the page writes into it stays readable as text.
function recorder(tag = 'div') {
  const kids = new Map();
  const appended = [];
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(), innerHTML: '', textContent: '', innerText: '', title: '', hidden: false, disabled: false,
    dataset: {}, attrs: {}, style: {}, inserted: [], appended, kids,
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; if (on) classes.add(c); else classes.delete(c); return on; }, contains: (c) => classes.has(c) },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, removeAttribute(k) { delete this.attrs[k]; },
    insertAdjacentHTML(_p, html) { this.inserted.push(String(html)); },
    insertAdjacentElement(_p, n) { appended.push(n); return n; },
    append(...n) { appended.push(...n); }, prepend(...n) { appended.unshift(...n); }, appendChild(n) { appended.push(n); return n; },
    replaceChildren(...n) { appended.length = 0; appended.push(...n); }, before() {}, after(...n) { appended.push(...n); }, remove() { this.removed = true; },
    addEventListener() {}, removeEventListener() {}, focus() {}, scrollIntoView() {},
    querySelectorAll: () => [],
  };
  el.querySelector = (sel) => {
    if (sel === '.run-gate-feedback') return null;
    if (!kids.has(sel)) kids.set(sel, recorder());
    return kids.get(sel);
  };
  return el;
}
// every string an element (and what was put in it) holds
function textsOf(node, out = [], depth = 0) {
  if (!node || depth > 6) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  for (const k of ['innerHTML', 'textContent', 'innerText', 'title']) if (typeof node[k] === 'string' && node[k]) out.push(node[k]);
  for (const h of node.inserted || []) out.push(String(h));
  for (const n of node.appended || []) textsOf(n, out, depth + 1);
  for (const n of node.kids?.values?.() || []) textsOf(n, out, depth + 1);
  return out;
}

// The gate card of g1 with its Approve button, as renderRunGates draws it.
function gateCard() {
  const card = recorder('div');
  Object.assign(card.dataset, { approval: 'g1', run: 'r1' });
  card.classList.add('run-gate');
  const approve = recorder('button');
  approve.dataset.answer = 'true';
  approve.textContent = 'Approve';
  approve.closest = (sel) => (String(sel).startsWith('button') ? approve : String(sel).includes('.run-gate') ? card : null);
  card.querySelectorAll = (sel) => (sel === 'button' ? [approve] : []);
  return { card, approve };
}

async function clickApprove(page) {
  const { card, approve } = gateCard();
  page.run('onRunGateClick')({ target: approve });
  await page.settle(20);
  return card;
}

// every text the page shows: the card, the toast, the Run screen's gates and every element it made
function pageTexts(page, card) {
  const out = textsOf(card);
  for (const el of [...page.elements.values(), ...page.created]) {
    for (const k of ['innerHTML', 'textContent', 'innerText']) if (typeof el[k] === 'string' && el[k]) out.push(el[k]);
    for (const [, html] of el.inserted || []) out.push(String(html));
  }
  return out.map((s) => text(s));
}

test('#603 an approved gate leaves the gate card, the sidebar badge and the run\'s menu entry at once, without waiting for the push', async () => {
  const page = await openPage(async () => true);
  await runAtGate(page);
  assert.deepEqual(pending(page), ['g1'], 'the run waits at g1');
  assert.equal(badgeShowsGates(page), true, 'the sidebar badge counts the gate');
  assert.match(navRunsText(page), /Waiting for you/, 'the run\'s menu entry says it waits');

  await clickApprove(page);
  assert.equal(JSON.stringify(page.callsTo('resolveApproval').map((a) => a.slice(0, 4))), JSON.stringify([['g1', true, '', 'r1']]));
  // no approval.resolved event was pushed
  assert.deepEqual(pending(page), [], 'the answered gate is still pending in the run');
  assert.equal(pendingCount(page), 0, 'pendingGates() still counts the answered gate');
  assert.equal(badgeShowsGates(page), false, 'the sidebar badge still counts the answered gate');
  assert.doesNotMatch(navRunsText(page), /Waiting for you/, 'the run\'s menu entry still says it waits');

  // the push arrives later: it only confirms
  fire(page, { seq: 3, run_id: 'r1', ts: ts(2), type: 'approval.resolved', approval_id: 'g1', step_id: 'review', approved: true, by: 'user' });
  await page.settle(20);
  assert.deepEqual(pending(page), []);
  assert.equal(badgeShowsGates(page), false);
});

test('#603 answering a gate already answered says "already answered at <time>", not an error', async () => {
  const answeredAt = '2026-10-25T09:58:30.000Z';
  const page = await openPage(async () => ({ already_answered: true, answered_at: answeredAt }));
  await runAtGate(page);
  assert.deepEqual(pending(page), ['g1']);

  const card = await clickApprove(page);
  const texts = pageTexts(page, card);
  const said = texts.find((s) => /already answered at\s*\S/i.test(s)) || '';
  assert.ok(said, 'no "already answered at <time>" shown on the card or in a toast');
  const toast = text(page.el('#toast').innerHTML);
  assert.doesNotMatch(toast, /could not answer the gate|did not accept the answer/i, `an error toast: "${toast}"`);
  assert.deepEqual(pending(page), [], 'a gate answered before is no longer pending');
  assert.equal(badgeShowsGates(page), false, 'the sidebar badge still counts it');
});
