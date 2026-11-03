// #634 (spec R12) Monitor: the polling connectors read production errors from a log file, a log URL
// or Sentry. Acceptance tests, written before the code.
//
// Seam assumed: packages/engine/domains/monitor/connectors.js exports
// async pollSource(source, { fetch, readFile, getToken, since }) -> { ok: true, events, cursor } or
// { ok: false, error }, never throwing. Sources: { id, type: 'log-file', path }, { id, type: 'log-url', url },
// { id, type: 'sentry', org, project }. Logs are JSON lines (blank or malformed lines skipped). Sentry GETs
// a URL containing /api/0/projects/<org>/<project>/ with `Authorization: Bearer <token>`, the token only
// from `await getToken(source.id)`. Boundaries mocked: fetch (a stub recording url and headers), the
// keychain (getToken), the filesystem (a real temp file, read with the default fs: no readFile given).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/monitor/connectors');

const LINE_A = JSON.stringify({ id: 'e1', at: '2026-11-02T10:00:00Z', status: 500, method: 'POST', path: '/api/checkout', message: "TypeError: cannot read 'total' of undefined", file: 'checkout.js', line: 412 });
const LINE_B = JSON.stringify({ id: 'e2', at: '2026-11-02T10:01:00Z', status: 500, method: 'POST', path: '/api/checkout', message: "TypeError: cannot read 'total' of undefined", file: 'checkout.js', line: 412 });
const LOG = `${LINE_A}\n\nnot json at all {\n${LINE_B}\n`;

const SENTRY_EVENTS = [{ eventID: 'a1', title: "TypeError: cannot read 'total' of undefined", dateCreated: '2026-11-02T10:00:00Z', tags: [{ key: 'url', value: '/api/checkout' }] }];

// fetch stub: records each call's url and headers, answers with `status` and `body`
function fetchStub({ status = 200, body = [], text } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const h = opts.headers || {};
    const headers = typeof h.get === 'function' ? { Authorization: h.get('Authorization') } : { ...h };
    calls.push({ url: String(url), headers });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (text ?? JSON.stringify(body)),
    };
  };
  return { fn, calls };
}

const authOf = (headers) => headers.Authorization ?? headers.authorization ?? null;

function tempLog(t, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-634-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'api.log');
  fs.writeFileSync(file, content);
  return file;
}

test('#634 a log file of JSON lines gives its events, blank and malformed lines skipped', async (t) => {
  const file = tempLog(t, LOG);
  const res = await load().pollSource({ id: 'f1', type: 'log-file', path: file }, {});
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.events.map((e) => e.id), ['e1', 'e2']);
  assert.equal(res.events[0].status, 500);
  assert.equal(res.events[0].message, "TypeError: cannot read 'total' of undefined");
});

test('#634 a log file that does not exist is { ok: false } with an error, not a throw', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-634-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = await load().pollSource({ id: 'f1', type: 'log-file', path: path.join(dir, 'missing.log') }, {});
  assert.equal(res.ok, false);
  assert.equal(typeof res.error, 'string');
  assert.ok(res.error.length > 0);
});

test('#634 a log URL is fetched and its JSON lines become events', async () => {
  const stub = fetchStub({ text: LOG });
  const res = await load().pollSource({ id: 'u1', type: 'log-url', url: 'https://logs.example.test/api.log' }, { fetch: stub.fn });
  assert.equal(res.ok, true, res.error);
  assert.equal(stub.calls.length, 1);
  assert.match(stub.calls[0].url, /^https:\/\/logs\.example\.test\/api\.log/);
  assert.deepEqual(res.events.map((e) => e.id), ['e1', 'e2']);
});

test('#634 Sentry: GETs the project\'s events with the keychain token as a Bearer header', async () => {
  const stub = fetchStub({ body: SENTRY_EVENTS });
  const asked = [];
  const getToken = async (id) => { asked.push(id); return 'tok-test-634'; };
  const res = await load().pollSource({ id: 's1', type: 'sentry', org: 'acme', project: 'shop' }, { fetch: stub.fn, getToken });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(asked, ['s1']);
  assert.equal(stub.calls.length, 1);
  assert.match(stub.calls[0].url, /\/api\/0\/projects\/acme\/shop\//);
  assert.equal(authOf(stub.calls[0].headers), 'Bearer tok-test-634');
});

test('#634 Sentry: each event comes back with the source id and its title as the message', async () => {
  const stub = fetchStub({ body: SENTRY_EVENTS });
  const res = await load().pollSource({ id: 's1', type: 'sentry', org: 'acme', project: 'shop' }, { fetch: stub.fn, getToken: async () => 'tok-test-634' });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.events.map((e) => [e.source, e.message]), [['s1', "TypeError: cannot read 'total' of undefined"]]);
});

test('#634 Sentry: a 401 answer is { ok: false } with an error naming the status', async () => {
  const stub = fetchStub({ status: 401, body: { detail: 'Invalid token' } });
  const res = await load().pollSource({ id: 's1', type: 'sentry', org: 'acme', project: 'shop' }, { fetch: stub.fn, getToken: async () => 'tok-test-634' });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /401/);
});

test('#634 Sentry with no token in the keychain is { ok: false } and nothing is fetched', async () => {
  const stub = fetchStub({ body: SENTRY_EVENTS });
  const res = await load().pollSource({ id: 's1', type: 'sentry', org: 'acme', project: 'shop' }, { fetch: stub.fn, getToken: async () => null });
  assert.equal(res.ok, false);
  assert.equal(stub.calls.length, 0);
});

test('#634 a fetch that throws (network down) is { ok: false }, not a throw', async () => {
  const fetch = async () => { throw new Error('ECONNREFUSED'); };
  const res = await load().pollSource({ id: 'u1', type: 'log-url', url: 'https://logs.example.test/api.log' }, { fetch });
  assert.equal(res.ok, false);
  assert.equal(typeof res.error, 'string');
});
