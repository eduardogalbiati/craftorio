// Agent inboxes (#240): the request card (apps/desktop/renderer/agent-request.js) drawn in the Product Owner's
// drawer and the Supervisor chat: its Working / Done / Failed state, its cost and the link back to
// the Oracle's chat. The script runs in a vm with a minimal window and document.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

function load() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'agent-request.js'), 'utf8');
  const window = {};
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sandbox = { window, esc, document: { addEventListener() {}, querySelectorAll: () => [] }, setTimeout };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(src, sandbox);
  return window.AgentRequest;
}

const request = (over = {}) => ({ ts: '2026-10-04T16:10:00.000Z', role: 'request', text: 'Request from the Oracle: roadmap.add (ready)', request: { from: 'oracle', kind: 'roadmap.add', ref: 'r1' }, reason: 'ready to build', ...over });
const result = (over = {}) => ({ ts: '2026-10-04T16:10:01.000Z', role: 'po', text: 'Done: #1 in stage 2', request: { from: 'oracle', kind: 'roadmap.add', ref: 'r1' }, costUsd: 0, ...over });

test('a request without its result yet shows Working and no cost', () => {
  const { cardHtml } = load();
  const html = cardHtml(request(), [request()], { testid: 'po-request' });
  assert.match(html, /data-testid="po-request"/);
  assert.match(html, /Request from the Oracle at/);
  assert.match(html, /roadmap\.add/);
  assert.match(html, /Working/);
  assert.doesNotMatch(html, /US\$/);
});

test('a mechanical request done shows Done, its result, the reason and "US$ 0 · no model call"', () => {
  const { cardHtml } = load();
  const all = [request(), result()];
  const html = cardHtml(all[0], all, { testid: 'svc-request' });
  assert.match(html, /data-testid="svc-request"/);
  assert.match(html, /Done/);
  assert.match(html, /ready to build/);
  assert.match(html, /Done: #1 in stage 2/);
  assert.match(html, /US\$ 0 · no model call/);
  assert.match(html, /data-request-ref="r1"/);
});

test('a failed request shows Failed and its error', () => {
  const { cardHtml } = load();
  const all = [request(), result({ text: 'Failed: #99 is not in the synced backlog.', error: '#99 is not in the synced backlog.' })];
  const html = cardHtml(all[0], all, { testid: 'po-request' });
  assert.match(html, /Failed/);
  assert.match(html, /#99 is not in the synced backlog/);
  assert.doesNotMatch(html, /pill-success/);
});

test('a judgment request shows the model and its cost, and its answer is drawn below the card', () => {
  const { cardHtml, inCard } = load();
  const answer = result({ text: 'Stage 2 first.', answer: { groups: [] }, model: 'claude-opus-5-5', costUsd: 0.42, request: { from: 'oracle', kind: 'plan', ref: 'r1' } });
  const all = [request({ request: { from: 'oracle', kind: 'plan', ref: 'r1' } }), answer];
  const html = cardHtml(all[0], all, { testid: 'po-request' });
  assert.match(html, /US\$ 0\.42 · claude-opus-5-5/);
  assert.match(html, /Answered below/);
  assert.equal(inCard(answer), false, 'the plan answer stays a normal message');
  assert.equal(inCard(result()), true, 'a mechanical result is drawn inside its card');
});

test('only a request from the Oracle links back to the Oracle\'s chat', () => {
  const { cardHtml } = load();
  assert.match(cardHtml(request(), [request()], { testid: 'po-request' }), /data-open-oracle-chat/);
  const other = request({ request: { from: 'night-watch', kind: 'roadmap.add', ref: 'r2' } });
  assert.doesNotMatch(cardHtml(other, [other], { testid: 'po-request' }), /data-open-oracle-chat/);
});

// #241: the owner's click on a card. The module's document click listener is captured; the card is a
// minimal element (its pill and buttons), the owner's channel a stub whose answer the test releases.
function loadClicks(api) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'agent-request.js'), 'utf8');
  const events = [];
  const window = { api, dispatchEvent: (ev) => events.push(ev) };
  let onClick = null;
  const esc = (s) => String(s ?? '');
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const document = { addEventListener: (type, fn) => { if (type === 'click') onClick = fn; }, querySelectorAll: () => [] };
  const sandbox = { window, esc, document, setTimeout, CustomEvent };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(src, sandbox);
  return { click: (target) => onClick({ target, preventDefault() {} }), events };
}

function pendingCard({ owner = 'supervisor', projectId = '' } = {}) {
  const pill = { className: 'pill pill-cancelled', textContent: 'Waits for your click' };
  const attrs = {};
  const card = {
    dataset: { requestRef: 'r1', requestOwner: owner, requestProject: projectId },
    querySelector: (sel) => (sel === '[data-testid="request-state"]' ? pill : null),
    querySelectorAll: () => buttons,
    setAttribute: (k, v) => { attrs[k] = v; },
  };
  const button = (act) => ({ disabled: false, dataset: { requestAct: act }, closest: (sel) => (sel === '[data-request-act]' ? buttons.find((b) => b.dataset.requestAct === act) : sel === '[data-request-ref]' ? card : null) });
  const buttons = [button('do'), button('dismiss')];
  return { card, pill, attrs, buttons, btn: (act) => buttons.find((b) => b.dataset.requestAct === act) };
}

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setImmediate(r));

test('after Do it, the card\'s state reads Running until the owner\'s channel answers, then its result is drawn', async () => {
  const answer = deferred();
  const calls = [];
  const { click, events } = loadClicks({ supervisorRequestAct: (input) => { calls.push(input); return answer.promise; } });
  const c = pendingCard();

  click(c.btn('do'));
  assert.equal(c.pill.textContent, 'Running');
  assert.equal(c.pill.className, 'pill pill-running');
  assert.equal(c.btn('do').disabled, true);
  assert.equal(c.btn('dismiss').disabled, true);
  assert.equal(c.attrs['aria-busy'], 'true');
  assert.deepEqual(calls.map((x) => [x.ref, x.action]), [['r1', 'do']]);
  await tick();
  assert.equal(c.pill.textContent, 'Running', 'still running while the act has not answered');
  assert.equal(events.length, 0);

  const messages = [request({ pending: true, status: 'proposed' }), result({ text: 'Done: run r9 was stopped.' })];
  answer.resolve({ ok: true, text: 'Done: run r9 was stopped.', costUsd: 0, messages });
  await tick();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'agent-request:changed');
  assert.equal(events[0].detail.owner, 'supervisor');
  assert.equal(events[0].detail.error, null);

  const { cardHtml } = load();
  const html = cardHtml(events[0].detail.messages[0], events[0].detail.messages, { testid: 'svc-request', owner: 'supervisor' });
  assert.match(html, /data-testid="request-state">Done</);
  assert.match(html, /Done: run r9 was stopped\./);
  assert.doesNotMatch(html, /data-testid="request-do"/);
});

test('after Dismiss on a Product Owner card, the state reads Dismissing and the PO\'s channel gets the project', async () => {
  const answer = deferred();
  const calls = [];
  const { click } = loadClicks({ productOwnerRequestAct: (input) => { calls.push(input); return answer.promise; } });
  const c = pendingCard({ owner: 'po', projectId: 'demo' });

  click(c.btn('dismiss'));
  assert.equal(c.pill.textContent, 'Dismissing');
  assert.equal(c.pill.className, 'pill pill-running');
  assert.deepEqual(calls.map((x) => [x.ref, x.action, x.projectId]), [['r1', 'dismiss', 'demo']]);
  answer.resolve({ ok: true, messages: [] });
  await tick();
});

test('the cost reads US$ 0 for nothing and keeps cents otherwise', () => {
  const { usd } = load();
  assert.equal(usd(0), 'US$ 0');
  assert.equal(usd(undefined), 'US$ 0');
  assert.equal(usd(1.5), 'US$ 1.50');
});
