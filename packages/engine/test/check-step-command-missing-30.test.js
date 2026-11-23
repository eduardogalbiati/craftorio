// #30: a check whose command is not found is an environment failure, whatever shell says it (sh with
// its path and line, bash's "line N", zsh's "command not found: x", Windows' cmd), even when the
// command exits 1 instead of 127; a rule finding that merely contains "not found" stays a rule failure.
// Real commands in temp folders (no lockfile: nothing to install), through runCheck.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../engine/check-step');

function tmpDir(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-cmd-30-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
  return dir;
}

// a project whose check prints `line` on stderr and exits 1
function projectPrinting(t, line) {
  const script = `process.stderr.write(${JSON.stringify(`${line}\n`)});\nprocess.exit(1);\n`;
  return tmpDir(t, {
    'package.json': JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { check: 'node check.js' } }),
    'check.js': script,
  });
}

const run = (t, dir) => load().runCheck({ dir, command: '', logFile: path.join(tmpDir(t), 'check-1.log') });

for (const line of [
  '/bin/sh: 1: eslint: not found',
  'sh: 1: eslint: not found',
  'bash: line 1: eslint: command not found',
  'bash: eslint: command not found',
  'zsh: command not found: eslint',
  "'eslint' is not recognized as an internal or external command,",
]) {
  test(`#30 runCheck: "${line}" is an environment failure (command missing)`, { timeout: 60000 }, async (t) => {
    const out = await run(t, projectPrinting(t, line));
    assert.equal(out.status, 'fail');
    assert.equal(out.failure_kind, 'environment');
    assert.equal(String(out.cause).includes('\n'), false, String(out.cause));
  });
}

for (const line of [
  'links: docs/guide.md: target ./setup.md: not found',
  'layers: src/a.js requires bash: line 1 (command not found in comment)',
  'i18n: key engine.missing: not found in pt-BR.json',
]) {
  test(`#30 runCheck: a rule finding "${line}" stays a rule failure`, { timeout: 60000 }, async (t) => {
    const out = await run(t, projectPrinting(t, line));
    assert.equal(out.status, 'fail');
    assert.equal(out.failure_kind, 'rules');
  });
}
