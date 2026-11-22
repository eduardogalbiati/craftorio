// T3: the desktop app's user data folder from before the rename to Craftorio is copied to the new
// folder on the first launch (caches and locks left out), never over a folder that exists, never
// for a throwaway folder; main.js calls it before the single-instance lock creates the new folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrateLegacyUserData } = require('../../host/legacy-user-data');

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
  assert.equal(fs.readFileSync(path.join(now, 'engine-connection.json'), 'utf8'), '{"mode":"remote"}');
  assert.equal(fs.existsSync(path.join(now, 'account.bin')), true);
  assert.equal(fs.existsSync(path.join(now, 'speech-models', 'model.bin')), true);
  assert.equal(fs.existsSync(path.join(now, 'Cache')), false);
  assert.equal(fs.existsSync(path.join(now, 'SingletonLock')), false);
  assert.equal(fs.existsSync(path.join(old, 'engine-connection.json')), true, 'the old folder is left as it was');
  assert.match(logs.join('\n'), /copied/);
});

test('T3 a new folder that exists is never touched, and no old folder means nothing to do', (t) => {
  const { dir, now } = appData(t);
  fs.mkdirSync(now);
  assert.equal(migrateLegacyUserData({ userData: now }), null);
  assert.deepEqual(fs.readdirSync(now), []);
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
