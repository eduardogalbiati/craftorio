// #634 (spec R12) Monitor: production errors are grouped and deduplicated with no model.
// Acceptance tests, written before the code.
//
// Seam assumed: packages/engine/domains/monitor/grouping.js exports fingerprint(event) and
// groupErrors(events). An event is { id, at, source, status (500 or 'ERR'), method?, path?, worker?,
// message, file?, line? }. The fingerprint ignores id and at; numeric or uuid path segments become
// :id. A group is { fingerprint, title, status, message, where, count, firstSeen, lastSeen }, sorted by
// count descending; one event id counted once. Pure functions: nothing is mocked.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/monitor/grouping');

const ev = (over = {}) => ({
  id: 'e1', at: '2026-11-02T10:00:00Z', source: 's1', status: 500, method: 'GET', path: '/api/orders/123',
  message: 'Order not found', file: 'orders.js', line: 88, ...over,
});

test('#634 fingerprint ignores the event id and time', () => {
  const { fingerprint } = load();
  assert.equal(fingerprint(ev({ id: 'a', at: '2026-11-02T10:00:00Z' })), fingerprint(ev({ id: 'b', at: '2026-11-03T08:30:00Z' })));
});

test('#634 numeric path segments normalize to :id: /api/orders/123 and /api/orders/9 make one group titled GET /api/orders/:id', () => {
  const groups = load().groupErrors([ev({ id: 'a', path: '/api/orders/123' }), ev({ id: 'b', path: '/api/orders/9' })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, 'GET /api/orders/:id');
  assert.equal(groups[0].count, 2);
});

test('#634 a uuid path segment normalizes to :id', () => {
  const groups = load().groupErrors([
    ev({ id: 'a', path: '/api/carts/3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b' }),
    ev({ id: 'b', path: '/api/carts/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }),
  ]);
  assert.deepEqual(groups.map((g) => g.title), ['GET /api/carts/:id']);
});

test('#634 a different status, method, path or message makes a different group', () => {
  const { fingerprint } = load();
  const base = fingerprint(ev());
  assert.notEqual(fingerprint(ev({ status: 502 })), base);
  assert.notEqual(fingerprint(ev({ method: 'POST' })), base);
  assert.notEqual(fingerprint(ev({ path: '/api/invoices/123' })), base);
  assert.notEqual(fingerprint(ev({ message: 'Database timeout' })), base);
});

test('#634 a worker event is titled worker: <name> and has no where without file and line', () => {
  const [group] = load().groupErrors([{ id: 'w1', at: '2026-11-02T03:00:00Z', source: 's1', status: 'ERR', worker: 'refund-sync', message: 'Stripe 429: rate limited' }]);
  assert.equal(group.title, 'worker: refund-sync');
  assert.equal(group.status, 'ERR');
  assert.equal(group.where, null);
});

test('#634 a group carries status, message, where (file:line), count, firstSeen and lastSeen', () => {
  const [group] = load().groupErrors([
    ev({ id: 'a', at: '2026-11-02T10:05:00Z', method: 'POST', path: '/api/checkout', message: "TypeError: cannot read 'total' of undefined", file: 'checkout.js', line: 412 }),
    ev({ id: 'b', at: '2026-11-02T09:00:00Z', method: 'POST', path: '/api/checkout', message: "TypeError: cannot read 'total' of undefined", file: 'checkout.js', line: 412 }),
    ev({ id: 'c', at: '2026-11-02T11:30:00Z', method: 'POST', path: '/api/checkout', message: "TypeError: cannot read 'total' of undefined", file: 'checkout.js', line: 412 }),
  ]);
  assert.equal(group.title, 'POST /api/checkout');
  assert.equal(group.status, 500);
  assert.equal(group.message, "TypeError: cannot read 'total' of undefined");
  assert.equal(group.where, 'checkout.js:412');
  assert.equal(group.count, 3);
  assert.equal(group.firstSeen, '2026-11-02T09:00:00Z');
  assert.equal(group.lastSeen, '2026-11-02T11:30:00Z');
  assert.equal(typeof group.fingerprint, 'string');
  assert.ok(group.fingerprint.length > 0);
});

test('#634 the same event id given twice is counted once', () => {
  const groups = load().groupErrors([ev({ id: 'dup' }), ev({ id: 'dup' }), ev({ id: 'other' })]);
  assert.equal(groups[0].count, 2);
});

test('#634 groups are sorted by count, highest first', () => {
  const groups = load().groupErrors([
    ev({ id: 'w1', method: undefined, path: undefined, status: 'ERR', worker: 'refund-sync', message: 'Stripe 429' }),
    ev({ id: 'o1' }), ev({ id: 'o2' }), ev({ id: 'o3' }),
    ev({ id: 'c1', method: 'POST', path: '/api/checkout', message: 'boom' }), ev({ id: 'c2', method: 'POST', path: '/api/checkout', message: 'boom' }),
  ]);
  assert.deepEqual(groups.map((g) => `${g.title} ${g.count}`), ['GET /api/orders/:id 3', 'POST /api/checkout 2', 'worker: refund-sync 1']);
});

test('#634 no events, no groups', () => {
  assert.deepEqual(load().groupErrors([]), []);
});
