// INSTALL.md (#44) is followed by an AI session on somebody else's computer: what it names must exist. The workspace's
// instructions (workspace-instructions/AGENTS.workspace.md, seeded as <workspace>/AGENTS.md by #43) name only channels the
// control channel answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { CHANNELS } = require('../packages/engine/control/allowlist');

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

test('INSTALL.md: ends with the handover of the workspace folder, the new session first', () => {
  const text = read(INSTALL);
  const fresh = text.indexOf('open a new session in the folder');
  const added = text.indexOf('add the folder');
  assert.ok(fresh > 0 && added > fresh, 'the new session is offered before adding the folder');
  assert.match(text, /read `<workspace>\/AGENTS\.md` before anything else/);
});

test('the prompt of the README clones first, so it works on a private repository, and INSTALL.md says why', () => {
  assert.match(read('README.md'), /Clone https:\/\/github\.com\/eduardogalbiati\/craftorio and install Craftorio following its INSTALL\.md/);
  assert.match(read(INSTALL), /Clone the repository first/);
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
