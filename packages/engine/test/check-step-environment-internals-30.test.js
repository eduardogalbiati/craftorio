// #30 internals: deps-cache's missingDeps (the rule rule_check and the onboarding share) and the
// environment classification's edges: a check's own "not found" finding stays a rule failure, a pnpm
// project's cause names pnpm's install, not npm ci.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { missingDeps } = require('../engine/deps-cache');
const { runCheck } = require('../engine/check-step');
const I18n = require('@craftorio/shared/i18n');

function tmpDir(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'check-env-30-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const pkg = JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { check: 'node check.js' } });

test('#30 missingDeps: no lockfile → null', (t) => {
  assert.equal(missingDeps(tmpDir(t, { 'package.json': pkg })), null);
});

test('#30 missingDeps: an npm lockfile and no node_modules → npm, with its install', (t) => {
  const d = missingDeps(tmpDir(t, { 'package.json': pkg, 'package-lock.json': '{}' }));
  assert.equal(d.manager, 'npm');
  assert.equal(d.lockfile, 'package-lock.json');
  assert.match(d.install, /^npm ci\b/);
});

test('#30 missingDeps: an empty node_modules still counts as missing; the sentinel as installed', (t) => {
  const dir = tmpDir(t, { 'package.json': pkg, 'package-lock.json': '{}', 'node_modules/.keep': '' });
  assert.equal(missingDeps(dir)?.manager, 'npm');
  fs.writeFileSync(path.join(dir, 'node_modules', '.package-lock.json'), '{}');
  assert.equal(missingDeps(dir), null);
});

test('#30 missingDeps: pnpm and yarn answer with their own manager', (t) => {
  assert.equal(missingDeps(tmpDir(t, { 'pnpm-lock.yaml': '' })).manager, 'pnpm');
  assert.equal(missingDeps(tmpDir(t, { 'yarn.lock': '' })).manager, 'yarn');
  assert.equal(missingDeps(tmpDir(t, { 'yarn.lock': '', '.pnp.cjs': '' })), null);
});

const run = (t, dir) => runCheck({ dir, command: '', logFile: path.join(tmpDir(t), 'logs', 'check-1.log') });

test('#30 runCheck: a check finding ending in "not found" (deps installed) stays a rule failure', { timeout: 60000 }, async (t) => {
  const dir = tmpDir(t, {
    'package.json': pkg,
    'package-lock.json': '{}',
    'node_modules/.package-lock.json': '{}',
    'check.js': "console.log('docs: README.md: not found');\nprocess.exit(1);\n",
  });
  const out = await run(t, dir);
  assert.equal(out.failure_kind, 'rules');
});

test('#30 runCheck: a pnpm project without dependencies names pnpm\'s install, not npm ci', { timeout: 60000 }, async (t) => {
  const before = I18n.getLanguage();
  I18n.setLanguage('en');
  t.after(() => I18n.setLanguage(before));
  const dir = tmpDir(t, { 'package.json': pkg, 'pnpm-lock.yaml': '', 'check.js': "require('fixture-dep-30');\n" });
  const out = await run(t, dir);
  assert.equal(out.failure_kind, 'environment');
  assert.equal(out.environment.manager, 'pnpm');
  assert.equal(out.cause.includes('npm ci'), false, out.cause);
  assert.equal(out.cause.includes('pnpm install'), true, out.cause);
});
