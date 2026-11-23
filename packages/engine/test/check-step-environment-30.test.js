// #30: rule_check on a freshly imported repository (no node_modules) failed with `Cannot find module`
// and went back to the developer as a code failure. packages/engine/engine/check-step.js now tells an
// environment failure apart from a rule failure. Acceptance tests written before the code.
//
// Contract (the interface these tests assume):
//   runCheck(...) keeps its result shape ({ kind: 'check', status, command, findings, message, log, ... })
//   and, when status is 'fail', adds:
//     failure_kind: 'environment' | 'rules'
//       'environment': the project cannot run its check here, whatever its code: the output says a
//         module is missing (`Cannot find module` / MODULE_NOT_FOUND) while the folder has a lockfile
//         (package-lock.json, ...) and no node_modules, or the command was not found (`command not
//         found`, exit code 127, Windows' "is not recognized as an internal or external command").
//       'rules': every other failure (a finding, a timeout, a missing module of the project's own
//         files with node_modules installed): unchanged, it goes back to develop.
//     cause: one line (no newline, no `at ...` stack frame), for the gate's brief.
//       For a missing-dependencies environment failure it is the catalog text
//       I18n.t('engine.check_deps_missing', { dir }) in the interface language
//       (@craftorio/shared/i18n's current language): en "... npm ci ... <dir>",
//       pt-BR "as dependências do projeto não estão instaladas: rode npm ci em <dir>".
//       For a rule failure: a one-line summary that contains the first finding.
// Real commands (`npm run check` running a tiny node script) in temp folders: local, free and fast.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');

const load = () => require('../engine/check-step');

function tmpDir(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-env-30-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function inLanguage(t, lang) {
  const before = I18n.getLanguage();
  I18n.setLanguage(lang);
  t.after(() => I18n.setLanguage(before));
}

const pkg = JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { check: 'node check.js' } });
const lock = JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture', version: '1.0.0' } } });
// a check that needs a dependency of the project (installed by npm ci)
const NEEDS_DEP = "require('fixture-dep-30');\nconsole.log('checks: pass');\n";

// a freshly cloned project: package.json, a lockfile, its check script, no node_modules
const freshClone = (t) => tmpDir(t, { 'package.json': pkg, 'package-lock.json': lock, 'check.js': NEEDS_DEP });

function installDep(dir) {
  const d = path.join(dir, 'node_modules', 'fixture-dep-30');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'fixture-dep-30', version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(d, 'index.js'), 'module.exports = 1;\n');
}

const run = (t, dir, command = '') => load().runCheck({ dir, command, logFile: path.join(tmpDir(t), 'logs', 'check-1.log') });
const hasStackFrame = (s) => /(^|\n)\s*at /.test(String(s));

test('#30 runCheck: a lockfile, no node_modules and a missing module is an environment failure', { timeout: 60000 }, async (t) => {
  inLanguage(t, 'en');
  const out = await run(t, freshClone(t));
  assert.equal(out.status, 'fail');
  assert.equal(out.failure_kind, 'environment');
});

test('#30 runCheck: the environment failure\'s cause is one line naming npm ci and the folder (en)', { timeout: 60000 }, async (t) => {
  inLanguage(t, 'en');
  const dir = freshClone(t);
  const out = await run(t, dir);
  assert.equal(typeof out.cause, 'string');
  assert.equal(out.cause.includes('\n'), false, out.cause);
  assert.equal(hasStackFrame(out.cause), false, out.cause);
  assert.equal(out.cause.includes('npm ci'), true, out.cause);
  assert.equal(out.cause.includes(dir), true, out.cause);
});

test('#30 runCheck: in pt-BR the cause says the dependencies are not installed: run npm ci in <folder>', { timeout: 60000 }, async (t) => {
  inLanguage(t, 'pt-BR');
  const dir = freshClone(t);
  const out = await run(t, dir);
  assert.equal(out.failure_kind, 'environment');
  assert.equal(out.cause, `as dependências do projeto não estão instaladas: rode npm ci em ${dir}`);
});

test('#30 runCheck: once the dependencies are installed, the same check passes (the retry)', { timeout: 60000 }, async (t) => {
  inLanguage(t, 'en');
  const dir = freshClone(t);
  const first = await run(t, dir);
  assert.equal(first.failure_kind, 'environment');
  installDep(dir);
  const again = await run(t, dir);
  assert.equal(again.status, 'pass', again.message);
});

test('#30 runCheck: a command that is not found is an environment failure with a one-line cause', { timeout: 60000 }, async (t) => {
  inLanguage(t, 'en');
  const dir = tmpDir(t, { 'package.json': pkg });
  const out = await run(t, dir, 'craftorio-no-such-command-30 --check');
  assert.equal(out.status, 'fail');
  assert.equal(out.failure_kind, 'environment');
  assert.equal(typeof out.cause, 'string');
  assert.equal(out.cause.includes('\n'), false, out.cause);
});

test('#30 runCheck: a rule finding with node_modules installed stays a rule failure (unchanged)', { timeout: 60000 }, async (t) => {
  inLanguage(t, 'en');
  const dir = tmpDir(t, {
    'package.json': pkg,
    'package-lock.json': lock,
    'node_modules/.package-lock.json': lock,
    'check.js': "console.log('layers: src/a.js:2 requires src/b.js');\nprocess.exit(1);\n",
  });
  const out = await run(t, dir);
  assert.equal(out.status, 'fail');
  assert.equal(out.failure_kind, 'rules');
  assert.equal(out.cause.includes('\n'), false, out.cause);
  assert.equal(out.cause.includes('layers: src/a.js:2 requires src/b.js'), true, out.cause);
});

test('#30 runCheck: a missing file of the project\'s own code, deps installed, is a rule failure', { timeout: 60000 }, async (t) => {
  inLanguage(t, 'en');
  const dir = tmpDir(t, {
    'package.json': pkg,
    'package-lock.json': lock,
    'node_modules/.package-lock.json': lock,
    'check.js': "require('./src/renamed-away.js');\n",
  });
  const out = await run(t, dir);
  assert.equal(out.status, 'fail');
  assert.equal(out.failure_kind, 'rules');
  assert.equal(out.cause.includes('\n'), false, out.cause);
  assert.equal(hasStackFrame(out.cause), false, out.cause);
});
