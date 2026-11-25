// #67: on a Windows that does not speak English, a check whose command does not exist exits 1 with a
// translated text in the console's code page: it is an environment failure (#30) there too. Acceptance
// tests written before the code (packages/engine/engine/check-step.js).
//
// Contract (the interface these tests assume), the one runSuite already has:
//   runCheck({ ..., env, run, platform }): `run` replaces suite-step's runCommand (the child process),
//   `platform` replaces process.platform, `env` is the environment the command runs with (Windows may
//   spell PATH as `Path`; PATHEXT names the extensions). On 'win32' a program that resolves nowhere is
//   missing whatever the output says, and the output's text in another language decides nothing.
//   The result's `environment.reason` is command_missing or deps_missing, as in #30.
// Machine-independent: nothing is spawned but the last test; the folders, PATH and output are fixtures.
// PATH has one folder (no delimiter) and PATHEXT is lower case (a case-sensitive disk): any host runs them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');

const load = () => require('../engine/check-step');

const MISSING = 'craftorio-no-such-command-67';
const LOCAL_TOOL = 'fixture-tool-67';
// what cmd prints for a missing command, as the bytes of each system's console code page
const cmdText = (name) => ({
  en: Buffer.from(`'${name}' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n`),
  // code page 850: ã is 0xC6, é 0x82, á 0xA0
  'pt-BR': Buffer.from(`'${name}' n\xC6o \x82 reconhecido como um comando interno\r\nou externo, um programa oper\xA0vel ou um arquivo em lotes.\r\n`, 'latin1'),
  de: Buffer.from(`Der Befehl "${name}" ist entweder falsch geschrieben oder\r\nkonnte nicht gefunden werden.\r\n`),
});
const LANGUAGES = ['en', 'pt-BR', 'de'];

function tmpDir(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-cmd-67-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, { mode: 0o755 });
  }
  return dir;
}

function inEnglish(t) {
  const before = I18n.getLanguage();
  I18n.setLanguage('en');
  t.after(() => I18n.setLanguage(before));
}

const pkg = (check) => JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { check } });
const LOCK = JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture', version: '1.0.0' } } });
const INSTALLED = { 'package-lock.json': LOCK, 'node_modules/.package-lock.json': LOCK };

// the PATH folder of a Windows with Node (and `tool-67`) installed
const windowsEnv = (t) => ({ Path: tmpDir(t, { 'node.exe': '', 'npm.cmd': '', 'tool-67.cmd': '' }), PATHEXT: '.com;.exe;.bat;.cmd' });

// runCheck with the child process replaced: it prints `output` and exits `code`
async function check(t, { dir, command = '', output, code = 1, platform = 'win32', env = windowsEnv(t) }) {
  const run = async ({ logFile }) => {
    fs.appendFileSync(logFile, output);
    return { code, timedOut: false, error: null, running: [] };
  };
  const out = await load().runCheck({ dir, command, logFile: path.join(tmpDir(t), 'logs', 'check-1.log'), env, run, platform });
  assert.equal(out.status, 'fail');
  // the replaced process's own result, not a real command's
  assert.equal(out.exit_code, code);
  return out;
}

// --- Missing command, any language

for (const lang of LANGUAGES) {
  test(`#67 win32 (${lang}): a check whose command does not exist is command_missing`, async (t) => {
    inEnglish(t);
    const command = `${MISSING} --check`;
    const out = await check(t, { dir: tmpDir(t), command, output: cmdText(MISSING)[lang] });
    assert.equal(out.failure_kind, 'environment');
    assert.equal(out.environment.reason, 'command_missing');
    assert.equal(out.cause, `the check command was not found: install what \`${command}\` needs, or set the check_command input`);
  });
}

// --- Missing dependencies, any language

for (const lang of LANGUAGES) {
  test(`#67 win32 (${lang}): \`npm run check\` calling a local tool with no node_modules is deps_missing`, async (t) => {
    inEnglish(t);
    const dir = tmpDir(t, { 'package.json': pkg(`${LOCAL_TOOL} .`), 'package-lock.json': LOCK });
    const banner = Buffer.from(`\r\n> fixture@1.0.0 check\r\n> ${LOCAL_TOOL} .\r\n\r\n`);
    const out = await check(t, { dir, output: Buffer.concat([banner, cmdText(LOCAL_TOOL)[lang]]) });
    assert.equal(out.failure_kind, 'environment');
    assert.equal(out.environment.reason, 'deps_missing');
    assert.equal(out.cause, `the project's dependencies are not installed: run npm ci in ${dir}`);
  });
}

test('#67 win32 (pt-BR): a check_command that is a local tool, with no node_modules, is deps_missing', async (t) => {
  const dir = tmpDir(t, { 'package.json': pkg('node check.js'), 'package-lock.json': LOCK });
  const out = await check(t, { dir, command: `${LOCAL_TOOL} .`, output: cmdText(LOCAL_TOOL)['pt-BR'] });
  assert.equal(out.failure_kind, 'environment');
  assert.equal(out.environment.reason, 'deps_missing');
});

// --- No false positives: the program exists, it ran and failed, whatever it printed

for (const [what, make] of /** @type {[string, (t: any) => { dir: string, command?: string }][]} */ ([
  ['a program of PATH, found by its PATHEXT extension', (t) => ({ dir: tmpDir(t), command: 'tool-67 --check' })],
  ['a program of PATH, named with its extension', (t) => ({ dir: tmpDir(t), command: 'tool-67.cmd --check' })],
  ['a script of the project\'s own folder', (t) => ({ dir: tmpDir(t, { 'lint-67.cmd': '' }), command: 'lint-67 --check' })],
  ['a quoted path with a space', (t) => ({ dir: tmpDir(t), command: `"${path.join(tmpDir(t, { 'my tools/lint.cmd': '' }), 'my tools', 'lint.cmd')}" --check` })],
  ['a command of the shell itself', (t) => ({ dir: tmpDir(t, { 'web/keep.txt': '' }), command: 'cd web && tool-67 --check' })],
  ['an npm script calling an installed local tool', (t) => ({ dir: tmpDir(t, { 'package.json': pkg(`${LOCAL_TOOL} .`), ...INSTALLED, [`node_modules/.bin/${LOCAL_TOOL}.cmd`]: '' }) })],
  ['an npm script that runs without the dependencies it lacks', (t) => ({ dir: tmpDir(t, { 'package.json': pkg('node check.js'), 'package-lock.json': LOCK, 'check.js': '' }) })],
])) {
  test(`#67 win32: ${what} that fails with "not found" findings is a rule failure`, async (t) => {
    const output = Buffer.concat([Buffer.from('docs: docs/a.md: target ./b.md: not found\r\n'), cmdText('docs')['pt-BR']]);
    const out = await check(t, { ...make(t), output });
    assert.equal(out.failure_kind, 'rules');
    assert.equal(out.environment === undefined, true);
  });
}

test('#67 win32 (en): an existing command that calls a missing one inside its script is command_missing, as before', async (t) => {
  const dir = tmpDir(t, { 'package.json': pkg('node check.js'), ...INSTALLED, 'check.js': '' });
  const out = await check(t, { dir, output: cmdText(MISSING).en });
  assert.equal(out.failure_kind, 'environment');
  assert.equal(out.environment.reason, 'command_missing');
});

// --- Linux and macOS unchanged

for (const platform of ['linux', 'darwin']) {
  test(`#67 ${platform}: exit code 127 is command_missing, whatever the output says`, async (t) => {
    const out = await check(t, { dir: tmpDir(t), command: `${MISSING} --check`, output: 'x\n', code: 127, platform });
    assert.equal(out.failure_kind, 'environment');
    assert.equal(out.environment.reason, 'command_missing');
  });

  test(`#67 ${platform}: the shell's own line with exit code 1 is command_missing`, async (t) => {
    const out = await check(t, { dir: tmpDir(t), command: 'tool-67 --check', output: `bash: line 1: ${MISSING}: command not found\n`, platform });
    assert.equal(out.failure_kind, 'environment');
    assert.equal(out.environment.reason, 'command_missing');
  });

  test(`#67 ${platform}: exit code 1 with a finding is a rule failure, the program is not looked up`, async (t) => {
    const out = await check(t, { dir: tmpDir(t), command: `${MISSING} --check`, output: 'docs: a.md: not found\n', platform });
    assert.equal(out.failure_kind, 'rules');
  });
}

// --- This machine's own shell, in its own language (a real `npm run check`)

test('#67 runCheck: a real `npm run check` calling a local tool with no node_modules is deps_missing', { timeout: 60000 }, async (t) => {
  const dir = tmpDir(t, { 'package.json': pkg(`${LOCAL_TOOL} .`), 'package-lock.json': LOCK });
  const out = await load().runCheck({ dir, command: '', logFile: path.join(tmpDir(t), 'check-1.log') });
  assert.equal(out.status, 'fail');
  assert.equal(out.failure_kind, 'environment');
  assert.equal(out.environment.reason, 'deps_missing');
});
