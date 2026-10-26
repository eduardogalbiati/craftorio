// #578: Electron 45 deprecates safeStorage.isEncryptionAvailable() (it prints "'safeStorage.isEncryptionAvailable'
// is deprecated and will be removed. Please use 'safeStorage.isAsyncEncryptionAvailable' instead.") and a later
// major removes it. The account session (account.bin, opened by createAccount in apps/desktop/host/main.js) must
// ask the async check instead. main.js is not an Electron-free module, so like clipboard-api.test.js this reads its
// source and the installed Electron's own type definitions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'host', 'main.js'), 'utf8');
const dts = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'electron', 'electron.d.ts'), 'utf8');

// the function that opens the account session (it may become async)
function createAccountSource() {
  const m = mainSrc.match(/(?:async\s+)?function createAccount\s*\([^)]*\)\s*\{[\s\S]*?\n\}\n/);
  assert.ok(m, 'apps/desktop/host/main.js still opens the account session in a createAccount function');
  return m[0];
}

test('the installed Electron offers safeStorage.isAsyncEncryptionAvailable() returning a promise', () => {
  assert.match(dts, /\bisAsyncEncryptionAvailable\(\): Promise<boolean>;/);
});

test('opening the account session awaits safeStorage.isAsyncEncryptionAvailable()', () => {
  const src = createAccountSource();
  assert.match(src, /^async\s+function createAccount/, 'createAccount is async, so it can await the check');
  assert.match(src, /\bawait\s+safeStorage\.isAsyncEncryptionAvailable\(\)/);
});

test('the account session (account.bin) never calls the deprecated safeStorage.isEncryptionAvailable()', () => {
  const src = createAccountSource();
  assert.match(src, /account\.bin/, 'createAccount still opens account.bin');
  assert.doesNotMatch(src, /\bsafeStorage\.isEncryptionAvailable\(/, 'deprecated in Electron 45 (#578)');
});

test('every caller waits for the account session to be opened before going on', () => {
  const calls = [...mainSrc.matchAll(/(^|[^\w.])createAccount\(\)/gm)]
    .filter((c) => !/function\s*$/.test(mainSrc.slice(Math.max(0, c.index - 20), c.index + c[1].length)));
  assert.ok(calls.length > 0, 'apps/desktop/host/main.js no longer calls createAccount()');
  for (const c of calls) {
    const before = mainSrc.slice(Math.max(0, c.index - 20), c.index + c[1].length);
    assert.match(before, /await\s*$/, `createAccount() is called without await: ${mainSrc.slice(c.index, c.index + 40).trim()}`);
  }
});
