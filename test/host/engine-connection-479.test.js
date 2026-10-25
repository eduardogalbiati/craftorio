// #479 (SEC-14), src/host/engine-connection.js: the server's side of `--host` and the saved token's storage.
//
// resolveListenHost(host, interfaces, { insecureHttp }) (scripts/serve.js calls it with its
// `--insecure-http` flag): an address beyond this machine that is not a Tailscale one (100.64.0.0/10),
// e.g. 0.0.0.0 or a LAN IP, is refused with { error } naming --insecure-http, unless insecureHttp is
// true. Loopback and a Tailscale IP stay allowed without the flag.
//
// tokenStorage(file): how the saved token of the engine connection is kept, so Settings › Engine
// connection can warn when it is unencrypted: 'encrypted' (safeStorage), 'plain' (the computer offers
// no encryption: writeConnection's `{ plain }`), or null when no token is saved. connectionView(c,
// { tokenStorage }) carries it to the page as `tokenEncrypted` (true / false), never the token.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../src/host/engine-connection');
const NO_INTERFACES = {};

test('#479 resolveListenHost: 0.0.0.0 without insecureHttp is refused with an error naming --insecure-http', () => {
  const r = load().resolveListenHost('0.0.0.0', NO_INTERFACES, { insecureHttp: false });
  assert.equal(r.host, undefined);
  assert.match(String(r.error), /--insecure-http/);
});

test('#479 resolveListenHost: a LAN address (192.168.1.10) without insecureHttp is refused; with it, it is allowed', () => {
  const { resolveListenHost } = load();
  assert.match(String(resolveListenHost('192.168.1.10', NO_INTERFACES, {}).error), /--insecure-http/);
  assert.equal(resolveListenHost('192.168.1.10', NO_INTERFACES, { insecureHttp: true }).host, '192.168.1.10');
  assert.equal(resolveListenHost('0.0.0.0', NO_INTERFACES, { insecureHttp: true }).host, '0.0.0.0');
});

test('#479 resolveListenHost: loopback and a Tailscale IP (100.64.0.0/10) need no flag', () => {
  const { resolveListenHost } = load();
  assert.equal(resolveListenHost('127.0.0.1', NO_INTERFACES, {}).host, '127.0.0.1');
  assert.equal(resolveListenHost('::1', NO_INTERFACES, {}).host, '::1');
  assert.equal(resolveListenHost('100.101.102.103', NO_INTERFACES, {}).host, '100.101.102.103');
});

function tmpFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-conn-479-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'engine-connection.json');
}

test('#479 tokenStorage: a token saved without encryption reads as plain, with encryption as encrypted, none as null', (t) => {
  const { writeConnection, tokenStorage } = load();
  const file = tmpFile(t);
  writeConnection(file, { mode: 'remote', address: 'my-pc', token: 'plain-token-0123456789' }, { encrypt: null });
  assert.equal(tokenStorage(file), 'plain');
  writeConnection(file, { mode: 'remote', address: 'my-pc', token: 'enc-token-0123456789' }, { encrypt: (s) => Buffer.from(`enc:${s}`) });
  assert.equal(tokenStorage(file), 'encrypted');
  writeConnection(file, { mode: 'local' }, { encrypt: null });
  assert.equal(tokenStorage(file), null);
});

test('#479 connectionView: tells the Settings page the token is stored unencrypted (tokenEncrypted false), never the token', () => {
  const { connectionView } = load();
  const plain = connectionView({ mode: 'remote', address: 'my-pc', token: 'secret-token-0123456789' }, { tokenStorage: 'plain' });
  assert.equal(plain.tokenEncrypted, false);
  assert.equal(JSON.stringify(plain).includes('secret'), false);
  const enc = connectionView({ mode: 'remote', address: 'my-pc', token: 'secret-token-0123456789' }, { tokenStorage: 'encrypted' });
  assert.equal(enc.tokenEncrypted, true);
});
