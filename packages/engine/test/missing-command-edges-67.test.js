// #67 edges of the missing command on Windows: what cmd reads as a redirection or a drive change is not a
// program (programMissing), and the check and suite steps around the exit code 9009, a timeout, a suite that
// printed its counts and an npm script whose local tool is missing. Nothing is spawned: `run`, `platform`
// and `env` are injected (PATH of one folder, PATHEXT in lower case: any host runs them).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { programMissing } = require('../engine/command-missing');
const { runCheck } = require('../engine/check-step');
const { runSuite } = require('../engine/suite-step');

const GONE = 'no-such-tool-67';
// cmd's text in pt-BR, code page 850
const PT = Buffer.from(`'${GONE}' n\xC6o \x82 reconhecido como um comando interno\r\nou externo, um programa oper\xA0vel ou um arquivo em lotes.\r\n`, 'latin1');
const LOCK = JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: {} });
const pkg = (scripts) => JSON.stringify({ name: 'fixture', version: '1.0.0', scripts });

function tmpDir(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-edges-67-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
  return dir;
}

const winEnv = (t) => ({ PATH: tmpDir(t, { 'npm.cmd': '', 'node.exe': '', 'tool.cmd': '' }), PATHEXT: '.exe;.cmd' });

const prints = (output, { code = 1, timedOut = false } = {}) => async ({ logFile }) => {
  fs.appendFileSync(logFile, output);
  return { code, timedOut, error: null, running: [] };
};

const check = (t, { command = '', files = {}, output = PT, platform = 'win32', ...ended }) => runCheck({
  dir: tmpDir(t, files), command, logFile: path.join(tmpDir(t), 'check-1.log'), env: winEnv(t), platform, run: prints(output, ended),
});

const suite = (t, { command = `${GONE} --all`, files = {}, output = PT, platform = 'win32', ...ended }) => runSuite({
  command, cwd: tmpDir(t, files), runDir: tmpDir(t), round: 1, env: winEnv(t), platform, run: prints(output, ended),
});

// --- What cmd does not read as a program

for (const command of [
  '2>nul tool --check',
  '1>out.txt tool',
  '2>>err.log tool --check',
  'D: && tool',
]) {
  test(`#67 not missing: ${command}`, (t) => {
    assert.equal(programMissing(command, { code: 1, cwd: tmpDir(t), env: winEnv(t), platform: 'win32' }), false);
  });
}

// --- The check step

test('#67 runCheck win32: exit 9009 from an existing .cmd that calls a missing command stays a rule failure', async (t) => {
  const out = await check(t, { command: 'tool --check', code: 9009 });
  assert.equal(out.exit_code, 9009);
  assert.equal(out.failure_kind, 'rules');
});

test('#67 runCheck win32: exit 9009 of a command that does not exist is command_missing', async (t) => {
  const out = await check(t, { command: `${GONE} --check`, code: 9009 });
  assert.equal(out.environment?.reason, 'command_missing');
});

test('#67 runCheck win32: a check cut by its timeout is a rule failure, its program is not looked up', async (t) => {
  const out = await check(t, { command: `${GONE} --check`, timedOut: true });
  assert.equal(out.failure_kind, 'rules');
  assert.match(out.message, /timed out/);
});

test('#67 runCheck win32: a drive change or a leading redirection before a check that failed is a rule failure', async (t) => {
  for (const command of ['D: && tool', '2>nul tool --check']) {
    const out = await check(t, { command, output: 'layers: src/a.js:2 requires src/b.js\r\n' });
    assert.equal(out.failure_kind, 'rules', command);
  }
});

test('#67 runCheck win32: deps_missing names the manager of the lockfile in a pnpm project', async (t) => {
  const out = await check(t, { command: 'npm run check', files: { 'package.json': pkg({ check: `${GONE} .` }), 'pnpm-lock.yaml': '' } });
  assert.equal(out.environment?.reason, 'deps_missing');
  assert.equal(out.environment?.manager, 'pnpm');
});

// --- The suite step

test('#67 runSuite win32 (pt-BR): `npm test` whose local tool is missing is blocked, not a failure', async (t) => {
  const out = await suite(t, { command: 'npm test', files: { 'package.json': pkg({ test: `${GONE} run` }), 'package-lock.json': LOCK } });
  assert.equal(out.status, 'blocked');
  assert.equal(out.reason, 'the command was not found (`npm test`, exit 1)');
});

test('#67 runSuite: exit 9009 is the command not found on win32 only, by the injected platform', async (t) => {
  const win = await suite(t, { code: 9009 });
  assert.equal(win.status, 'blocked');
  assert.equal(win.reason, `the command was not found (\`${GONE} --all\`, exit 9009)`);
  const linux = await suite(t, { code: 9009, platform: 'linux' });
  assert.equal(linux.status, 'fail');
});

test('#67 runSuite win32: a suite that printed its counts ran, even with no failing test and a program not found', async (t) => {
  const out = await suite(t, { output: 'ℹ tests 3\nℹ pass 3\nℹ fail 0\n' });
  assert.equal(out.status, 'fail');
  assert.equal(out.reason, null);
});

test('#67 runSuite win32: a shell refusal keeps its own reason when the program exists', async (t) => {
  const out = await suite(t, { command: 'tool --all', output: 'Linha de comando muito longa.\r\n' });
  assert.equal(out.status, 'blocked');
  assert.match(String(out.reason), /the shell refused the command/);
});
