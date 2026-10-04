// Agent inboxes (#240): the request card (src/renderer/agent-request.js) drawn in the Product Owner's
// drawer and the Supervisor chat: its Working / Done / Failed state, its cost and the link back to
// the Oracle's chat. The script runs in a vm with a minimal window and document.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'agent-request.js'), 'utf8');
  const window = {};
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sandbox = { window, esc, document: { addEventListener() {}, querySelectorAll: () => [] }, setTimeout };
  vm.createContext(sandbox);
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

test('the cost reads US$ 0 for nothing and keeps cents otherwise', () => {
  const { usd } = load();
  assert.equal(usd(0), 'US$ 0');
  assert.equal(usd(undefined), 'US$ 0');
  assert.equal(usd(1.5), 'US$ 1.50');
});
