// INSTALL.md (#44) is followed by an AI session on somebody else's computer: what it names must exist. The workspace's
// instructions (workspace-instructions/AGENTS.workspace.md, seeded as <workspace>/AGENTS.md by #43) name only channels the
// control channel answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CHANNELS } = require('../packages/engine/control/allowlist');
const { fileStore, resolveWorkspace } = require('../packages/engine/domains/workspace/workspace');
const { decideMode, readConnection } = require('../apps/desktop/host/engine-connection');
const { migrateLegacyUserData } = require('../apps/desktop/host/legacy-user-data');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const INSTALL = 'INSTALL.md';
const ORACLE = 'workspace-instructions/AGENTS.workspace.md';

test('INSTALL.md: its npm scripts, files and repository exist', () => {
  const text = read(INSTALL);
  const pkg = JSON.parse(read('package.json'));
  for (const [, script] of text.matchAll(/\bnpm (?:run )?(start|test|serve|build)\b/g)) assert.ok(pkg.scripts[script], `npm script ${script}`);
  for (const [, file] of text.matchAll(/\bnode (\S+\.js)\b/g)) assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
  const repo = pkg.repository.url.replace(/^git\+/, '');
  for (const [url] of text.matchAll(/https:\/\/github\.com\/\S+?\.git/g)) assert.equal(url, repo);
  for (const [, rel] of text.matchAll(/\]\(([^)#\s:]+)\)/g)) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is missing`);
});

test('INSTALL.md: asks for the Node version the package needs', () => {
  const major = JSON.parse(read('package.json')).engines.node.match(/\d+/)[0];
  assert.ok(read(INSTALL).includes(`Node.js ${major} or newer`));
});

test('INSTALL.md: every package it names is one the Deploy workflow publishes, and each published one is named', () => {
  const names = (text) => [...new Set(text.match(/\bCraftorio-(?:win32|darwin|linux)-[a-z0-9]+\.(?:zip|AppImage|tar\.gz)/g))].sort();
  assert.deepEqual(names(read(INSTALL)), names(read('.github/workflows/deploy.yml')));
});

test('INSTALL.md: offers the executable and the source, and checks the download before it is opened', () => {
  const text = read(INSTALL);
  const order = ['## 1. Choose how to install', '## 3A. Get the app', 'SHA256SUMS', '## 3B. Get the code', '## 5. Open the app'].map((s) => text.indexOf(s));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), order.join(', '));
});

const section = (from, to) => { const text = read(INSTALL); return text.slice(text.indexOf(from), text.indexOf(to)); };
const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('INSTALL.md: a workspace that exists is never opened without asking, and a clean start is offered first', () => {
  const text = section('## 4. The workspace', '## 5. Open the app');
  assert.match(text, /\*\*One exists\*\*: \*\*ask\*\*, always/);
  assert.ok(text.indexOf('Start clean') > 0 && text.indexOf('Keep it') > text.indexOf('Start clean'));
  assert.match(text, /Never delete, move or empty the old workspace/);
});

test('INSTALL.md: the clean start it describes wins over an older install\'s workspace', (t) => {
  const home = tempDir(t);
  const [clean, old] = ['clean', 'old'].map((d) => path.join(home, d));
  for (const d of [clean, old, path.join(home, 'multiagent-workspace')]) fs.mkdirSync(d);
  const [file, legacy] = ['.craftorio.json', '.multiagent-orchestrator.json'].map((f) => path.join(home, f));
  fs.writeFileSync(legacy, JSON.stringify({ workspace: old }));
  const where = () => resolveWorkspace({ store: fileStore(file, legacy), env: {}, home, tmp: home }).dir;
  assert.equal(where(), old, 'without it, the older install\'s workspace is opened');
  const [, json] = section('## 4. The workspace', '## 5. Open the app').match(/`(\{ "workspace": [^`]+\})` to `~\/\.craftorio\.json`/);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(json), workspace: clean }));
  assert.equal(where(), clean);
});

test('INSTALL.md: the engine file it describes keeps this computer, and the older install\'s data out', (t) => {
  const dir = tempDir(t);
  const [userData, legacy] = ['craftorio', 'multiagent-orchestrator'].map((d) => path.join(dir, d));
  for (const d of [userData, legacy]) fs.mkdirSync(d);
  fs.writeFileSync(path.join(legacy, 'engine-connection.json'), JSON.stringify({ mode: 'remote', address: 'https://engine.example:8443' }));
  fs.writeFileSync(path.join(legacy, 'account.bin'), 'x');
  const text = section('## 5. Open the app', '## 6. Check that the app answers');
  for (const name of ['engine-connection.json', 'multiagent-orchestrator']) assert.ok(text.includes(name), name);
  const file = path.join(userData, 'engine-connection.json');
  fs.writeFileSync(file, text.match(/`(\{ "mode": [^`]+\})`/)[1]);
  assert.equal(migrateLegacyUserData({ userData }), null);
  assert.equal(fs.existsSync(path.join(userData, 'account.bin')), false);
  assert.deepEqual(decideMode({ connection: readConnection(file) }), { mode: 'local' });
});

test('INSTALL.md: the labels of the app it names exist', () => {
  const en = JSON.parse(read('packages/shared/i18n/en.json'));
  const text = read(INSTALL);
  for (const key of ['connection.use_local', 'settings.general.workspace', 'settings.general.change', 'settings.execution.control']) {
    assert.ok(text.replace(/\s+/g, ' ').includes(en[key]), `${key}: ${en[key]}`);
  }
});

test('INSTALL.md: ends with the handover of the workspace folder, the new session first', () => {
  const text = read(INSTALL);
  const fresh = text.indexOf('open a new session in the folder');
  const added = text.indexOf('add the folder');
  assert.ok(fresh > 0 && added > fresh, 'the new session is offered before adding the folder');
  assert.match(text, /read `<workspace>\/AGENTS\.md` before anything else/);
});

test('the README offers the source code (recommended while the builds are not signed) and the app with no clone', () => {
  const readme = read('README.md');
  assert.match(readme, /Install the Craftorio app \(the executable\) following https:\/\/github\.com\/eduardogalbiati\/craftorio\/blob\/main\/INSTALL\.md/);
  assert.match(readme, /Clone https:\/\/github\.com\/eduardogalbiati\/craftorio and install Craftorio from the source code following its INSTALL\.md/);
  const text = read(INSTALL);
  assert.match(text, /The app \(A\) needs no clone/);
  assert.match(text, /recommend B while the app's builds are not signed/);
  for (const [url] of text.matchAll(/https:\/\/github\.com\/eduardogalbiati\/craftorio\/releases\/latest\/download\/[^\s`]+/g)) assert.match(url, /\/download\/<file>$/);
});

test('Codex: the handover and the workspace instructions name what its sandbox needs', () => {
  for (const file of [INSTALL, ORACLE]) assert.match(read(file), /sandbox_workspace_write\.network_access=true/, file);
});

test('the app is started detached from the session', () => {
  const text = read(INSTALL);
  assert.match(text, /detached from this session/);
  for (const command of ['setsid nohup npm start', 'nohup npm start', 'Start-Process npm.cmd']) assert.ok(text.includes(command), command);
});

test('the workspace instructions name bundled workflows, with the extension', () => {
  const named = [...read(ORACLE).matchAll(/`?([a-z-]+\.yaml)`?/g)].map((m) => m[1]);
  assert.ok(named.length >= 2);
  for (const file of named) assert.ok(fs.existsSync(path.join(root, 'workflows', file)), file);
});

test('README and AGENTS.md lead to INSTALL.md', () => {
  for (const file of ['README.md', 'AGENTS.md']) assert.match(read(file), /\]\(INSTALL\.md\)/, file);
});

test('the workspace instructions: short, and every channel they name is allowed', () => {
  const text = read(ORACLE);
  assert.ok(text.split('\n').length <= 150, 'at most 150 lines');
  const named = [...text.matchAll(/`([a-z]+:[a-z][a-zA-Z-]*)`/g)].map((m) => m[1]);
  assert.ok(named.length >= 10);
  for (const channel of named) assert.ok(CHANNELS.has(channel), `${channel} is not in the allowlist`);
});
