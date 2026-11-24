// T3: the desktop app's user data folder from before the rename to Craftorio is copied to the new
// folder on the first launch (caches and locks left out), never over a folder that exists, never
// for a throwaway folder, its engine connection on this computer; main.js calls it before the single-instance lock creates the new folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrateLegacyUserData } = require('../../host/legacy-user-data');
const { decideMode, readConnection } = require('../../host/engine-connection');

function appData(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-appdata-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const old = path.join(dir, 'multiagent-orchestrator');
  fs.mkdirSync(path.join(old, 'speech-models'), { recursive: true });
  fs.mkdirSync(path.join(old, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(old, 'engine-connection.json'), '{"mode":"remote"}');
  fs.writeFileSync(path.join(old, 'account.bin'), 'x');
  fs.writeFileSync(path.join(old, 'speech-models', 'model.bin'), 'm');
  fs.writeFileSync(path.join(old, 'Cache', 'data_0'), 'c');
  fs.writeFileSync(path.join(old, 'SingletonLock'), '');
  return { dir, old, now: path.join(dir, 'craftorio') };
}

test('T3 the first launch copies the old folder to the new one, without the caches and the locks, and leaves the old one', (t) => {
  const { old, now } = appData(t);
  const logs = [];
  assert.equal(migrateLegacyUserData({ userData: now, log: (m) => logs.push(m) }), old);
  assert.equal(readConnection(path.join(now, 'engine-connection.json')).mode, 'local');
  assert.equal(fs.existsSync(path.join(now, 'account.bin')), true);
  assert.equal(fs.existsSync(path.join(now, 'speech-models', 'model.bin')), true);
  assert.equal(fs.existsSync(path.join(now, 'Cache')), false);
  assert.equal(fs.existsSync(path.join(now, 'SingletonLock')), false);
  assert.equal(fs.existsSync(path.join(old, 'engine-connection.json')), true, 'the old folder is left as it was');
  assert.match(logs.join('\n'), /copied/);
});

test('T3 the folder Electron created before main.js (Chromium\'s files only) still gets the copy; Chromium\'s files are not overwritten', (t) => {
  const { old, now } = appData(t);
  fs.mkdirSync(path.join(now, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(now, 'DIPS'), 'new');
  fs.writeFileSync(path.join(old, 'DIPS'), 'old');
  assert.equal(migrateLegacyUserData({ userData: now }), old);
  assert.equal(readConnection(path.join(now, 'engine-connection.json')).mode, 'local');
  assert.equal(fs.readFileSync(path.join(now, 'DIPS'), 'utf8'), 'new', 'a file the new folder has is kept');
});

test('a remote engine of the old install: this computer runs it, the address and the token are kept, the old file is left as it was', (t) => {
  const { old, now } = appData(t);
  const saved = JSON.stringify({ mode: 'remote', address: 'https://engine.example:8443', insecure: true, token: { encrypted: 'YWJj' } });
  fs.writeFileSync(path.join(old, 'engine-connection.json'), saved);
  const logs = [];
  assert.equal(migrateLegacyUserData({ userData: now, log: (m) => logs.push(m) }), old);
  const file = path.join(now, 'engine-connection.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ...JSON.parse(saved), mode: 'local' });
  const connection = readConnection(file, { decrypt: (b) => b.toString('utf8') });
  assert.deepEqual(connection, { mode: 'local', address: 'https://engine.example:8443', token: 'abc', insecure: true });
  assert.deepEqual(decideMode({ connection }), { mode: 'local' });
  assert.equal(fs.readFileSync(path.join(old, 'engine-connection.json'), 'utf8'), saved);
  assert.match(logs.join('\n'), /this computer runs it now/);
  assert.doesNotMatch(logs.join('\n'), /engine\.example|YWJj/, 'neither the address nor the token is logged');
});

test('a local, missing or unreadable engine connection of the old install: this computer, as it was', (t) => {
  for (const text of ['{"mode":"local","address":"https://engine.example:8443"}', null, '{"mode":"remote"', 'null']) {
    const { old, now } = appData(t);
    const from = path.join(old, 'engine-connection.json');
    if (text === null) fs.rmSync(from); else fs.writeFileSync(from, text);
    const logs = [];
    assert.equal(migrateLegacyUserData({ userData: now, log: (m) => logs.push(m) }), old, String(text));
    const file = path.join(now, 'engine-connection.json');
    assert.deepEqual(decideMode({ connection: readConnection(file) }), { mode: 'local' }, String(text));
    if (text?.startsWith('{"mode":"local"')) assert.equal(fs.readFileSync(file, 'utf8'), text);
    assert.equal(fs.existsSync(path.join(now, 'account.bin')), true, 'the rest is copied');
    assert.doesNotMatch(logs.join('\n'), /remote engine/);
  }
});

test('a copy that fails leaves no remote engine behind', (t) => {
  const { now } = appData(t);
  t.mock.method(fs, 'cpSync', () => { throw new Error('disk full'); });
  const logs = [];
  assert.equal(migrateLegacyUserData({ userData: now, log: (m) => logs.push(m) }), null);
  assert.equal(fs.existsSync(path.join(now, 'engine-connection.json')), false);
  assert.match(logs.join('\n'), /disk full/);
});

test('T3 a new folder with one of the app\'s own files is never touched, and no old folder means nothing to do', (t) => {
  const { dir, now } = appData(t);
  fs.mkdirSync(now);
  fs.writeFileSync(path.join(now, 'engine-connection.json'), '{"mode":"local"}');
  assert.equal(migrateLegacyUserData({ userData: now }), null);
  assert.deepEqual(fs.readdirSync(now), ['engine-connection.json']);
  const lonely = path.join(dir, 'elsewhere', 'craftorio');
  assert.equal(migrateLegacyUserData({ userData: lonely }), null);
  assert.equal(fs.existsSync(lonely), false);
});

test('T3 main.js migrates before the single-instance lock, and only for the owner\'s own user data folder', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'host', 'main.js'), 'utf8');
  const at = main.indexOf('migrateLegacyUserData(');
  assert.ok(at > 0, 'main.js calls it');
  assert.ok(at < main.indexOf('requestSingleInstanceLock()'), 'before the lock creates the new folder');
  assert.match(main.slice(Math.max(0, at - 200), at), /!scratchUserData/);
});
