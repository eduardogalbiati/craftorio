// src/engine/providers.js withCliPath (#397): the spawn env every CLI the app starts gets (cliEnv's
// terminals and agent turns alike): the env's own PATH first, then the lookup's extra folders that
// exist, without duplicates. The home folder is injected through HOME/USERPROFILE/APPDATA, the
// platform through the argument.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { withCliPath } = require('../src/engine/providers');

function isolatedHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-path-397-'));
  const home = path.join(dir, 'home');
  const own = path.join(dir, 'own-bin');
  fs.mkdirSync(home);
  fs.mkdirSync(own);
  const saved = {};
  for (const k of ['HOME', 'USERPROFILE', 'APPDATA']) saved[k] = process.env[k];
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { home, own, localBin: path.join(home, '.local', 'bin') };
}

const pathKeys = (env) => Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');
const entries = (env) => String(env[pathKeys(env)[0]] || '').split(path.delimiter).filter(Boolean);

test('withCliPath (#397): keeps an env\'s `Path` key on Windows (one PATH key), its folders first, then ~\\.local\\bin', (t) => {
  const { own, localBin } = isolatedHome(t);
  fs.mkdirSync(localBin, { recursive: true });
  const env = withCliPath({ Path: own, OTHER: 'x' }, 'win32');
  assert.deepEqual(pathKeys(env), ['Path']);
  assert.deepEqual(entries(env), [own, localBin]);
  assert.equal(env.OTHER, 'x');
});

test('withCliPath (#397): an env without PATH gets the existing extra folders alone', (t) => {
  const { localBin } = isolatedHome(t);
  fs.mkdirSync(localBin, { recursive: true });
  const env = withCliPath({}, 'linux');
  assert.deepEqual(pathKeys(env), ['PATH']);
  assert.equal(entries(env)[0], localBin);
});

test('withCliPath (#397): the env it is given is not changed (agent turns and terminals each get their own copy)', (t) => {
  const { own, localBin } = isolatedHome(t);
  fs.mkdirSync(localBin, { recursive: true });
  const input = { PATH: own };
  withCliPath(input, 'darwin');
  assert.deepEqual(input, { PATH: own });
});

test('withCliPath (#397): the global npm prefix of ~/.npmrc (its bin folder) is added on macOS and Linux', (t) => {
  const { home, own } = isolatedHome(t);
  const prefix = path.join(home, 'npm-prefix');
  fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, '.npmrc'), `prefix=${prefix}\n`);
  for (const platform of ['darwin', 'linux']) {
    const list = entries(withCliPath({ PATH: own }, platform));
    assert.equal(list[0], own);
    assert.equal(list.filter((p) => p === path.join(prefix, 'bin')).length, 1, `${platform}: ${list.join(path.delimiter)}`);
  }
});

test('withCliPath (#397): on Windows a PATH folder with a trailing backslash is not added again', (t) => {
  const { own, localBin } = isolatedHome(t);
  fs.mkdirSync(localBin, { recursive: true });
  const list = entries(withCliPath({ PATH: [own, `${localBin}\\`].join(path.delimiter) }, 'win32'));
  assert.equal(list.filter((p) => p.toLowerCase().replace(/[\\/]+$/, '') === localBin.toLowerCase()).length, 1, list.join(path.delimiter));
});

test('withCliPath (#397): nothing to add leaves the PATH exactly as it was', (t) => {
  const { own } = isolatedHome(t);
  const env = withCliPath({ PATH: own }, 'linux');
  // /opt/homebrew/bin and /usr/local/bin may exist on the host: only the home folders are isolated
  assert.equal(entries(env)[0], own);
  assert.equal(entries(env).filter((p) => p.startsWith(path.dirname(own))).length, 1);
});
