// #67: which commands programMissing (packages/engine/engine/command-missing.js) calls missing on Windows.
// Nothing is spawned; PATH and PATHEXT (lower case, for a case-sensitive disk) are fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isMissingCode, programMissing } = require('../engine/command-missing');

const GONE = 'no-such-tool-67';

function tmpDir(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-missing-67-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function missing(t, command, { files = {}, scripts = null, env = {}, sub = '', ...opts } = /** @type {any} */ ({})) {
  const cwd = tmpDir(t, scripts ? { ...files, [path.join(sub, 'package.json')]: JSON.stringify({ scripts }) } : files);
  const bin = tmpDir(t, { 'npm.cmd': '', 'node.exe': '', 'tool.cmd': '', plain: '' });
  return programMissing(command, { code: 1, cwd: path.join(cwd, sub), env: { Path: bin, PATHEXT: '.exe;.cmd', ...env }, platform: 'win32', ...opts });
}

for (const command of [
  GONE,
  `${GONE} && tool`,
  `${GONE} --check 2>&1`,
  `${GONE} > out.txt`,
  `"${GONE}" "a & b | c"`,
  '"missing folder/tool" --check',
  'node_modules\\.bin\\tool .',
  'node_modules/.bin/tool .',
  // cmd splits at `=`: the program is NODE_ENV
  'NODE_ENV=test tool',
  // no extension: cmd does not run it
  'plain --check',
]) test(`#67 missing: ${command}`, (t) => assert.equal(missing(t, command), true));

for (const command of [
  'tool',
  'tool.cmd --check',
  `tool && ${GONE}`,
  // the other command ran: the exit code is its own
  `${GONE} || tool`,
  `${GONE} & tool`,
  `${GONE} | tool`,
  `${GONE} && tool || node x`,
  // cannot be told
  `%TOOL% ${GONE}`,
  `(${GONE})`,
  `@${GONE}`,
  `to^ol ${GONE}`,
  `< in.txt ${GONE}`,
  `"${GONE}`,
  '',
  // cmd's own
  `call ${GONE}`,
  `CD /d x && ${GONE}`,
  'cd.. && tool',
  'cd/d x && tool',
  // the managers are only looked up themselves
  'npm --prefix web run x',
]) test(`#67 not missing: ${command || '(empty)'}`, (t) => assert.equal(missing(t, command), false));

test('#67 only Windows, a program that ended with the code of a missing command', (t) => {
  for (const platform of ['linux', 'darwin']) assert.equal(missing(t, GONE, { platform }), false);
  for (const code of [null, 0, 2, 3221225477]) assert.equal(missing(t, GONE, { code }), false, `exit ${code}`);
  assert.equal(missing(t, GONE, { code: 9009 }), true);
  assert.equal(missing(t, GONE, { timedOut: true }), false);
});

test('#67 without PATH or PATHEXT nothing is missing', (t) => {
  assert.equal(missing(t, GONE, { env: { PATHEXT: '' } }), false);
  assert.equal(missing(t, GONE, { env: { Path: '' } }), false);
});

test('#67 a quoted PATH entry among several', (t) => {
  const dir = tmpDir(t, { 'other-67.cmd': '' });
  assert.equal(missing(t, 'other-67', { env: { Path: `nowhere;"${dir}"` } }), false);
});

test('#67 an npm script: its first program, its pre script, the scripts it runs', (t) => {
  assert.equal(missing(t, 'npm test', { scripts: { test: `${GONE} .` } }), true);
  assert.equal(missing(t, 'npm run a -- --fix', { scripts: { a: 'npm run b && tool', b: `${GONE} .` } }), true);
  assert.equal(missing(t, 'npm run a && npm run b', { scripts: { a: GONE, b: 'tool' } }), true);
  assert.equal(missing(t, 'npm run a', { scripts: { prea: 'tool', a: GONE } }), false, 'the pre script may be what failed');
  assert.equal(missing(t, 'npm run a', { scripts: { prea: GONE, a: 'tool' } }), true);
  assert.equal(missing(t, 'npm run a', { scripts: { a: 'npm run a' } }), false, 'a loop ends');
  assert.equal(missing(t, 'npm run gone', { scripts: { a: 'tool' } }), false);
  assert.equal(missing(t, 'npm run a', { scripts: { a: 'node-gyp rebuild' } }), false, 'npm brings it');
  assert.equal(missing(t, 'npm run a', { scripts: { a: 'tool' }, env: { Path: 'nowhere' } }), true, 'npm itself');
});

test('#67 a local tool of node_modules/.bin: for a script, in the project or above it, not for the command itself', (t) => {
  const files = { 'node_modules/.bin/local.cmd': '' };
  assert.equal(missing(t, 'npm run a', { files, scripts: { a: 'local .' } }), false);
  assert.equal(missing(t, 'npm run a', { files, scripts: { a: 'local .' }, sub: 'packages/web' }), false);
  assert.equal(missing(t, 'npm run a', { files, scripts: { a: 'npm run b', b: 'local .' } }), false);
  assert.equal(missing(t, 'local .', { files }), true);
});

test('#67 another script shell than cmd: its scripts are not followed', (t) => {
  const scripts = { a: GONE };
  assert.equal(missing(t, 'npm run a', { scripts, files: { '.npmrc': 'script-shell=bash\n' } }), false);
  assert.equal(missing(t, 'npm run a', { scripts, env: { USERPROFILE: tmpDir(t, { '.npmrc': 'script-shell = bash\n' }) } }), false);
  assert.equal(missing(t, 'npm run a', { scripts, env: { npm_config_script_shell: 'bash' } }), false);
});

test('#67 isMissingCode: 127 everywhere, 9009 on Windows', () => {
  assert.equal(isMissingCode(127, 'linux'), true);
  assert.equal(isMissingCode(127, 'win32'), true);
  assert.equal(isMissingCode(9009, 'win32'), true);
  assert.equal(isMissingCode(9009, 'linux'), false);
  assert.equal(isMissingCode(1, 'win32'), false);
});
