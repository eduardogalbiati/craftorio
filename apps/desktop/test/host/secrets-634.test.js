// #634: the desktop keychain (apps/desktop/host/secrets.js) never writes a token as plain text.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSecrets } = require('../../host/secrets');

const fakeStorage = (available) => ({
  isAsyncEncryptionAvailable: async () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').toString('base64').split('').reverse().join(''), 'utf8'),
  decryptString: (b) => Buffer.from(b.toString('utf8').split('').reverse().join(''), 'base64').toString('utf8'),
});
const quiet = { warn() {} };

test('#634 secrets: a token is stored encrypted and read back by a new instance', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-634-'));
  const file = path.join(dir, 'secrets.bin');
  await createSecrets({ file, safeStorage: fakeStorage(true), log: quiet }).set('monitor:p:s', 'tok-plain-123');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('tok-plain-123'));
  const again = createSecrets({ file, safeStorage: fakeStorage(true), log: quiet });
  assert.strictEqual(await again.get('monitor:p:s'), 'tok-plain-123');
  await again.set('monitor:p:s', '');
  assert.strictEqual(await again.get('monitor:p:s'), null);
});

test('#634 secrets: without system encryption nothing is written, the token stays in memory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-634-'));
  const file = path.join(dir, 'secrets.bin');
  const s = createSecrets({ file, safeStorage: fakeStorage(false), log: quiet });
  await s.set('k', 'tok');
  assert.strictEqual(await s.get('k'), 'tok');
  assert.strictEqual(fs.existsSync(file), false);
});
