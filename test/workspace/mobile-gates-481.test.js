// #481 (SEC-20), src/domains/workspace/mobile-gates.js POST /pair: a per-IP attempt limit against guessing the pairing
// code. After a few wrong codes from one address (the limit is the implementation's, at most 19
// here), further attempts from it answer 429; another address still pairs with a valid code.
// The two client addresses are 127.0.0.1 and 127.0.0.2 (both loopback; the server listens on
// 127.0.0.1 only, never on every interface).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createMobileGatesServer } = require('../../src/domains/workspace/mobile-gates');

function setup(t, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-gates-481-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = { api: { 'runs:active': () => [] }, workspace: () => ({ root }), answerPhoneGate: () => true };
  return createMobileGatesServer({ service, secret: 'pair-limit-test-secret-0123456789abcdef', ...opts });
}

// from: the client's own address (localAddress), 127.0.0.1 or 127.0.0.2
function pair(from, port, code) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ code, name: 'Pixel' });
    const req = http.request({ host: '127.0.0.1', localAddress: from, port, method: 'POST', path: '/pair', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(body);
  });
}

// macOS routes only 127.0.0.1 on lo0 (127.0.0.2 needs an alias): the second address is not available there
test('#481 /pair: after repeated wrong codes from one IP, further attempts answer 429; another IP still pairs', { skip: process.platform === 'darwin' && 'no 127.0.0.2 on macOS' }, async (t) => {
  const m = setup(t);
  const { port } = await m.listen(0, '127.0.0.1');
  t.after(() => m.close());

  const statuses = [];
  for (let i = 0; i < 20; i++) statuses.push(await pair('127.0.0.1', port, `WRONG${i}`));
  assert.equal(statuses[0], 403, 'the first wrong code is still a plain refusal');
  assert.equal(statuses[19], 429, `attempts beyond the limit are throttled: ${statuses.join(',')}`);

  const { code } = m.pair();
  assert.equal(await pair('127.0.0.2', port, code), 200, 'another address is not affected');
});

test('#481 /pair: the limit is per window: once it has passed, the address gets plain refusals again (403) and pairs with a valid code', async (t) => {
  let clock = 1_000_000;
  const m = setup(t, { now: () => clock, linkTtlMs: 365 * 24 * 3600e3 });
  const { port } = await m.listen(0, '127.0.0.1');
  t.after(() => m.close());

  const statuses = [];
  for (let i = 0; i < 20; i++) statuses.push(await pair('127.0.0.1', port, `WRONG${i}`));
  assert.equal(statuses[19], 429, `throttled within the window: ${statuses.join(',')}`);

  clock += 16 * 60e3; // past the 15-minute window
  assert.equal(await pair('127.0.0.1', port, 'WRONG-AFTER'), 403, 'the counter starts again after the window');
  const { code } = m.pair();
  assert.equal(await pair('127.0.0.1', port, code), 200);
});
