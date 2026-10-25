// Internals of #324 / #325 not covered by the acceptance tests: writeReleaseVersion's semver order
// (a pre-release is lower than its release), a package.json without `name`, a lockfile without
// `packages[""]`; suiteScope (the release summary's focused / whole round line); the loader's
// `scope: failed` and `type: release_version`. Throwaway repositories in os.tmpdir().
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { execFileSync } = require('child_process');
const { writeReleaseVersion } = require('../src/domains/releases/releases');
const { suiteScope } = require('../src/engine/suite-step');
const { loadWorkflow } = require('../src/engine/run/load');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function repoWith(t, files) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'release-version-int-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  git(dir, 'init', '-q');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

test('writeReleaseVersion: a pre-release of the file\'s version is lower (no write); the release after its pre-release is written (#325)', async (t) => {
  const a = repoWith(t, { 'package.json': '{\n  "name": "a",\n  "version": "1.2.0"\n}\n' });
  const ra = await writeReleaseVersion({ dir: a, version: '1.2.0-rc.1' });
  assert.equal(ra.written, false);
  assert.match(ra.reason, /lower/);
  const b = repoWith(t, { 'package.json': '{\n  "name": "b",\n  "version": "1.2.0-rc.2"\n}\n' });
  assert.equal((await writeReleaseVersion({ dir: b, version: '1.2.0-rc.10' })).written, true, 'numeric pre-release identifiers compare as numbers');
  const c = repoWith(t, { 'package.json': '{\n  "name": "c",\n  "version": "1.2.0-rc.1"\n}\n' });
  assert.equal((await writeReleaseVersion({ dir: c, version: '1.2.0' })).written, true);
});

test('writeReleaseVersion: a detached checkout gets the given branch; no name: version first; a lockfile without packages[""] keeps its packages (#325)', async (t) => {
  const lock = '{\n  "version": "0.1.0",\n  "lockfileVersion": 1,\n  "dependencies": {\n    "x": { "version": "0.1.0" }\n  }\n}\n';
  const dir = repoWith(t, { 'package.json': '{\n\t"private": true\n}\n', 'package-lock.json': lock });
  git(dir, 'checkout', '-q', '--detach');
  const r = await writeReleaseVersion({ dir, version: 'v2.0.0', branch: 'release-fix-x' });
  assert.equal(r.written, true);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), '{\n\t"version": "2.0.0",\n\t"private": true\n}\n');
  assert.equal(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'), lock.replace('"version": "0.1.0",', '"version": "2.0.0",'));
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'release-fix-x');
  assert.equal(git(dir, 'rev-parse', 'refs/heads/main'), git(dir, 'rev-parse', 'HEAD~1'));
});

test('suiteScope: a round as focused (then whole) or whole, with its tests and minutes (#324)', () => {
  assert.equal(suiteScope({ kind: 'suite', scope: 'full', passed: 182, failed: 11, duration_ms: 44 * 60e3 }, 'scenario'), 'whole: 193 scenarios (182 passed, 11 failed), 44.0 min');
  assert.equal(suiteScope({ kind: 'suite', scope: 'files', passed: 1, failed: 1, duration_ms: 90e3, selection: { files: ['features/a.feature'] } }, 'scenario'), 'focused on 1 file: 2 scenarios (1 passed, 1 failed), 1.5 min');
  const both = suiteScope({ kind: 'suite', scope: 'full', passed: 193, failed: 0, duration_ms: 44 * 60e3, affected: { files: ['a', 'b'], passed: 11, failed: 0, duration_ms: 3 * 60e3 } }, 'scenario');
  assert.equal(both, 'focused on 2 files: 11 scenarios (11 passed, 0 failed), 3.0 min; then whole: 193 scenarios (193 passed, 0 failed), 44.0 min');
  assert.equal(suiteScope({ kind: 'suite', scope: 'full', passed: null, failed: null, duration_ms: 0 }), 'whole: tests unknown, 0.0 min');
  assert.equal(suiteScope({ kind: 'other' }), '');
});

test('loadWorkflow: suite scope failed is accepted; a release_version step takes no agent (#324, #325)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-version-wf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (steps) => {
    const file = path.join(dir, `wf-${Math.random().toString(36).slice(2)}.yaml`);
    fs.writeFileSync(file, yaml.dump({ agents: { dev: { provider: 'x' } }, steps }));
    return file;
  };
  assert.doesNotThrow(() => loadWorkflow(write([{ id: 'v', type: 'release_version', version: '1.0.0', transitions: [{ when: 'true', goto: 'e2e' }] }, { id: 'e2e', type: 'suite', scope: 'failed' }])));
  assert.throws(() => loadWorkflow(write([{ id: 'v', type: 'release_version', agent: 'dev' }])), /no agent/);
  assert.throws(() => loadWorkflow(write([{ id: 'v', type: 'release_version', version: 1 }])), /version must be a string/);
  assert.throws(() => loadWorkflow(write([{ id: 's', type: 'suite', scope: 'some' }])), /affected, failed or full/);
});
