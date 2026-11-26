// #50, internal details of the rule check that finds the project's tools: which scripts rewrite files
// (check-tools.js), what counts as a finding in each tool's output (check-findings.js) and how a run that cannot be
// compared ends (check-step.js, with a fake command runner). The behaviour is in check-step-found.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compareFindings, parseFindings } = require('../engine/check-findings');
const { checkCommands, runCheck } = require('../engine/check-step');
const { foundChecks } = require('../engine/check-tools');
const { programOnPath } = require('../engine/command-missing');

function tmp(t, files = {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'check-tools-50-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, { mode: 0o755 });
  }
  return dir;
}
const scripts = (s) => ({ 'package.json': JSON.stringify({ scripts: s }) });
const NO_PATH = { PATH: '' };

for (const [what, s, why] of [
  ['a script it runs', { lint: 'npm run lint:js', 'lint:js': 'eslint . --fix' }, '--fix'],
  ['a list of scripts', { lint: 'run-s lint:*', 'lint:css': 'stylelint . --fix' }, '--fix'],
  ['its pre script', { prelint: 'prettier -w .', lint: 'eslint .' }, '-w'],
  ['a formatter with no check flag', { lint: 'ruff format . && ruff check .' }, 'ruff format'],
]) {
  test(`#50 a lint script rewrites files through ${what}`, (t) => {
    const found = foundChecks(tmp(t, scripts(s)), { env: NO_PATH });
    assert.deepEqual(found, { checks: [], looked_for: [], rewrites: [{ name: 'npm run lint', why }] });
  });
}

for (const script of ['eslint . --fix-dry-run', 'ruff format --check .', 'eslint . --fix=false', 'npm run lint']) {
  test(`#50 a lint script that only reads runs: ${script}`, (t) => {
    assert.deepEqual(foundChecks(tmp(t, scripts({ lint: script })), { env: NO_PATH }).checks.map((c) => c.command), ['npm run lint']);
  });
}

test('#50 golangci-lint with fix: true in its configuration is said, not run', (t) => {
  const bin = tmp(t, { 'golangci-lint': '#!/bin/sh\n', 'golangci-lint.cmd': '' });
  const dir = tmp(t, { 'go.mod': 'module a\n', '.golangci.yml': 'issues:\n  fix: true\n' });
  const env = { PATH: bin, PATHEXT: '.CMD' };
  assert.deepEqual(foundChecks(dir, { env }), { checks: [], looked_for: [], rewrites: [{ name: 'golangci-lint run', why: 'fix: true in .golangci.yml' }] });
});

test('#50 programOnPath on Windows takes PATHEXT; the current folder does not count', (t) => {
  const bin = tmp(t, { 'ruff.CMD': '' });
  assert.equal(programOnPath('ruff', { env: { Path: bin, PATHEXT: '.EXE;.CMD' }, platform: 'win32' }), true);
  assert.equal(programOnPath('ruff', { env: { Path: '', PATHEXT: '.CMD' }, platform: 'win32' }), false);
});

test('#50 checkCommands: off in any case runs none, a given command runs alone', (t) => {
  const dir = tmp(t, scripts({ lint: 'eslint .' }));
  assert.deepEqual(checkCommands(dir, ' OFF '), []);
  assert.deepEqual(checkCommands(dir, 'make x'), ['make x']);
  assert.deepEqual(checkCommands(dir, ''), ['npm run lint']);
});

const OUTPUTS = {
  tsc: ["app/(group)/a.ts(2,3): error TS2322: Type 'x' is not assignable.", "app/(group)/a.ts:2:3: error TS2322: Type 'x' is not assignable."],
  'tsc pretty': ['src/a.ts:2:3 - error TS1: no.', 'src/a.ts:2:3: error TS1: no.'],
  checkstyle: ['[WARN] {dir}/src/F.java:[3,5] (naming) Name: bad.', 'src/F.java:3:5: (naming) Name: bad.'],
  eslint: ['{dir}/src/a.js\n  1:5  error  Unused x  no-unused-vars\n\n✖ 1 problem', 'src/a.js:1:5: error Unused x no-unused-vars'],
  mypy: ['src/a.py:3: error: Bad [arg-type]', 'src/a.py:3: error: Bad [arg-type]'],
};
for (const [tool, [text, line]] of Object.entries(OUTPUTS)) {
  test(`#50 a finding of ${tool} is read with its file`, (t) => {
    const dir = tmp(t);
    assert.deepEqual(parseFindings(text.replaceAll('{dir}', dir), dir).map((f) => f.line), [line]);
  });
}

test('#50 a summary, a duration, a banner, a stack frame and a time are no findings', (t) => {
  const text = ['> a@1.0.0 lint', 'Found 2 errors. (3)', 'Done in 1.20s.', '12:30:45 start', '    at f (/x/y.js:1:2)', 'npm error code 1', 'http://localhost:3000 up'].join('\n');
  assert.deepEqual(parseFindings(text, tmp(t)), []);
});

test('#50 compareFindings counts: one more of the same is new, a moved one is not', (t) => {
  const dir = tmp(t);
  const of = (...lines) => parseFindings(lines.join('\n'), dir);
  assert.deepEqual(compareFindings(of('a.js:9:1: bad', 'a.js:12:1: bad'), of('a.js:1:1: bad')), { added: ['a.js:12:1: bad'], old: 1 });
});

// a lint script whose command is faked: what it prints and exits with, in the checkout and on the base
async function fakeCheck(t, { now, before, baseFiles = scripts({ lint: 'x' }) }) {
  const dir = tmp(t, scripts({ lint: 'x' }));
  const baseDir = tmp(t, baseFiles);
  const run = async ({ cwd, logFile }) => {
    const r = cwd === dir ? now : before;
    fs.writeFileSync(logFile, r.text || '');
    return { code: 1, timedOut: false, error: null, ...r };
  };
  return runCheck({ dir, command: '', logFile: path.join(tmp(t), 'check-1.log'), env: NO_PATH, run, baseCheckout: async () => ({ dir: baseDir }) });
}

test('#50 a failure with no place in its output is new when the base passes, and only reported when it fails too', async (t) => {
  const fresh = await fakeCheck(t, { now: { text: 'a crash' }, before: { code: 0 } });
  assert.deepEqual([fresh.status, fresh.findings], ['fail', ['a crash']]);
  const both = await fakeCheck(t, { now: { text: 'a crash' }, before: { text: 'a crash' } });
  assert.equal(both.status, 'pass');
  assert.match(both.message, /could not be compared with the base[^\n]*\na crash/);
});

test('#50 a command the base does not have, or that timed out, is reported without blocking', async (t) => {
  const added = await fakeCheck(t, { now: { text: 'a.js:1:1: bad' }, before: {}, baseFiles: scripts({}) });
  assert.deepEqual([added.status, /the base does not have it/.test(added.message)], ['pass', true]);
  const slow = await fakeCheck(t, { now: { code: null, timedOut: true }, before: { code: 0 } });
  assert.deepEqual([slow.status, /timed out/.test(slow.message)], ['pass', true]);
});
