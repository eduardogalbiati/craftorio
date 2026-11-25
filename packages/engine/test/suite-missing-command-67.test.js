// #67: a suite whose command does not exist is blocked with the same reason on a Windows of any language
// (exit code 1 and a translated text, not 127 or 9009). Acceptance tests written before the code
// (packages/engine/engine/suite-step.js runSuite, whose `run`, `platform` and `env` are injected: nothing
// is spawned). PATH has one folder (no delimiter) and PATHEXT is lower case: any host runs them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runSuite } = require('../engine/suite-step');

const COMMAND = 'craftorio-no-such-suite-67 --all';
const TEXTS = {
  en: Buffer.from("'craftorio-no-such-suite-67' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n"),
  // code page 850: ã is 0xC6, é 0x82, á 0xA0
  'pt-BR': Buffer.from("'craftorio-no-such-suite-67' n\xC6o \x82 reconhecido como um comando interno\r\nou externo, um programa oper\xA0vel ou um arquivo em lotes.\r\n", 'latin1'),
};

function tmpDir(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-cmd-67-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text, { mode: 0o755 });
  return dir;
}

async function suite(t, { command = COMMAND, output, code = 1, platform = 'win32' }) {
  const run = async ({ logFile }) => {
    fs.appendFileSync(logFile, output);
    return { code, timedOut: false, error: null, running: [] };
  };
  const env = { PATH: tmpDir(t, { 'tool-67.cmd': '' }), PATHEXT: '.com;.exe;.bat;.cmd' };
  return runSuite({ command, cwd: tmpDir(t), runDir: tmpDir(t), round: 1, env, run, platform });
}

for (const [lang, output] of Object.entries(TEXTS)) {
  test(`#67 win32 (${lang}): a suite whose command does not exist is blocked: the command was not found`, async (t) => {
    const out = await suite(t, { output });
    assert.equal(out.status, 'blocked');
    assert.equal(out.reason, `the command was not found (\`${COMMAND}\`, exit 1)`);
  });
}

test('#67 win32: a suite whose program exists and exits 1 is a failure, whatever its last line says', async (t) => {
  const out = await suite(t, { command: 'tool-67 --all', output: TEXTS['pt-BR'] });
  assert.equal(out.status, 'fail');
  assert.equal(/was not found/.test(String(out.reason)), false, String(out.reason));
});

test('#67 win32: a suite that reports a failing test ran, its command is not missing', async (t) => {
  const out = await suite(t, { output: '✖ failing tests:\n\ntest at test/a.test.js:3:1\n✖ a test (1ms)\n  Error: a test broke\n\nℹ tests 1\nℹ pass 0\nℹ fail 1\n' });
  assert.equal(out.status, 'fail');
  assert.deepEqual(out.failures.map((f) => f.test), ['a test']);
});

test('#67 linux: exit code 127 is blocked as before, exit code 1 is a failure as before', async (t) => {
  const missing = await suite(t, { output: 'x\n', code: 127, platform: 'linux' });
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.reason, `the command was not found (\`${COMMAND}\`, exit 127)`);
  const failed = await suite(t, { output: 'x\n', platform: 'linux' });
  assert.equal(failed.status, 'fail');
});
