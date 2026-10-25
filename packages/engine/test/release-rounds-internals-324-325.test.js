// Release internals (#324, #325) the simulated runs cannot reach: the mock developer commits nothing
// and a mock run has no worktree. `failedFirstRound` (suite `scope: failed`) adds the `.feature`
// files a fix changed since the base to the files that failed; `runReleaseVersionStep` turns a git
// error into an unchanged version with a warning (the release goes on); the Ship and Try again
// messages of workflows/release.yaml name the version commit next to the fix. The engine methods are
// called on WorkflowRun.prototype with a small run state (worktree, ctx, emitEvent) and a throwaway
// git repository in os.tmpdir(); the messages are rendered with the engine's `render`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow, render } = require('../engine/workflow');
const machineActions = require('../engine/machine-actions');

const WORKFLOW = path.join(__dirname, '..', '..', '..', 'workflows', 'release.yaml');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// main with `base` files, then the run's branch with `fix` files committed on it
function repo(t, base, fix = {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'release-internals-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const write = (files) => {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), text);
    }
  };
  git(dir, 'init', '-q');
  write(base);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'release-fix-run1');
  if (Object.keys(fix).length) {
    write(fix);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fix');
  }
  return dir;
}

const runState = (dir, extra = {}) => {
  const events = [];
  return { events, state: { mock: false, machine: machineActions.real(), runDir: dir, worktree: { repo: dir, base: 'main' }, ctx: { worktree_dir: dir }, emitEvent: (type, data) => events.push({ type, ...data }), ...extra } };
};

test('scope failed: a later round adds the .feature files a fix changed, with the reason "changed by a fix" (#324)', async (t) => {
  const dir = repo(t, { 'features/a.feature': 'Feature: a\n', 'features/b.feature': 'Feature: b\n', 'src/x.js': '1\n' }, { 'features/b.feature': 'Feature: b fixed\n', 'src/x.js': '2\n' });
  const { state } = runState(dir);
  const calls = [];
  const once = async (extra = {}) => {
    calls.push({ files: extra.files ? [...extra.files] : null, reasons: { ...(extra.selection?.reasons || {}) } });
    return { kind: 'suite', status: 'fail', scope: extra.files ? 'files' : 'full', failures: [], message: 'red' };
  };
  const st = { visits: 2, outputs: [{ status: 'fail', round: 1, scope: 'full', failures: [{ test: 'x', file: 'features/a.feature' }] }] };
  const out = await WorkflowRun.prototype.failedFirstRound.call(state, { id: 'e2e' }, st, once);
  assert.equal(calls.length, 1, 'a red focused run: no whole run after it');
  assert.deepEqual(calls[0].files.sort(), ['features/a.feature', 'features/b.feature'], 'the failed file and the feature file the fix changed; never src/x.js');
  assert.equal(calls[0].reasons['features/a.feature'], 'failed in round 1');
  assert.equal(calls[0].reasons['features/b.feature'], 'changed by a fix');
  assert.equal(out.status, 'fail');
});

test('scope failed: a feature file that failed and was also changed by the fix is listed once, as failed (#324)', async (t) => {
  const dir = repo(t, { 'features/a.feature': 'Feature: a\n' }, { 'features/a.feature': 'Feature: a fixed\n' });
  const { state } = runState(dir);
  const calls = [];
  const once = async (extra = {}) => {
    calls.push({ files: extra.files ? [...extra.files] : null, reasons: { ...(extra.selection?.reasons || {}) } });
    return { kind: 'suite', status: 'fail', scope: 'files', failures: [], message: 'red' };
  };
  const st = { visits: 2, outputs: [{ status: 'fail', round: 1, failures: [{ file: 'features/a.feature' }, { file: 'features/a.feature' }] }] };
  await WorkflowRun.prototype.failedFirstRound.call(state, { id: 'e2e' }, st, once);
  assert.deepEqual(calls[0].files, ['features/a.feature']);
  assert.equal(calls[0].reasons['features/a.feature'], 'failed in round 1');
});

test('release_version step: a git error leaves the version unchanged, restores the files and logs a warning; it does not throw (#325)', async (t) => {
  const text = '{\n  "name": "app",\n  "version": "0.3.0"\n}\n';
  const dir = repo(t, { 'package.json': text });
  const head = git(dir, 'rev-parse', 'HEAD');
  // another git process holds the index: `git add` fails
  fs.writeFileSync(path.join(dir, '.git', 'index.lock'), '');
  t.after(() => fs.rmSync(path.join(dir, '.git', 'index.lock'), { force: true }));
  const { state, events } = runState(dir);
  const out = await WorkflowRun.prototype.runReleaseVersionStep.call(state, { id: 'version', type: 'release_version', version: '1.2.0' });
  assert.equal(out.written, false);
  assert.equal(out.status, 'unchanged');
  assert.match(String(out.reason), /could not be written/);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), text, 'package.json restored');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head, 'no commit');
  const warn = events.filter((e) => e.type === 'log' && e.level === 'warn' && e.kind === 'release_version');
  assert.equal(warn.length, 1, 'one warning in the run log');
});

test('release_version step: a real run without its own worktree writes nothing in the folder and says why (#325)', async (t) => {
  const text = '{\n  "name": "app",\n  "version": "0.3.0"\n}\n';
  const dir = repo(t, { 'package.json': text });
  const { state } = runState(dir, { worktree: null });
  const out = await WorkflowRun.prototype.runReleaseVersionStep.call(state, { id: 'version', type: 'release_version', version: '1.2.0' });
  assert.equal(out.written, false);
  assert.match(String(out.reason), /worktree/);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), text);
});

// ---- the Ship and Try again messages ------------------------------------------------------------

const stepOf = (id) => loadWorkflow(WORKFLOW).steps.find((s) => s.id === id);
const ctxFor = (dir, { written, fixVisits }) => ({
  run_id: 'run1',
  worktree_dir: dir,
  inputs: { version: '1.2.0', base_branch: 'main', e2e_suite: 'run', build_command: '' },
  action_error: { message: 'push rejected' },
  steps: {
    version: { visits: 1, output: written
      ? { written: true, change: 'package.json 0.3.0 → 1.2.0', commit: 'abcdef1234567890', message: 'Set package.json 0.3.0 → 1.2.0 and committed it.' }
      : { written: false, change: '', commit: null, message: 'package.json already names 1.2.0.' } },
    unit: { visits: 1, output: { status: 'pass', message: 'The suite passed in round 1.' } },
    e2e: { visits: 1, output: { status: 'pass', message: 'The suite passed in round 1.' } },
    fix: fixVisits ? { visits: fixVisits, output: { summary: 'fixed it', regression: '' } } : { visits: 0 },
    review: { visits: 0 },
  },
});
const lineOf = (text, start) => text.split('\n').find((l) => l.trim().startsWith(start)) || '';

test('Ship gate: with the version commit and a fix, Ship merges both and the message names the version change (#325)', (t) => {
  const dir = repo(t, { 'package.json': '{}\n' }, { 'a.txt': 'fix\n' });
  const message = render(String(stepOf('ship').message), ctxFor(dir, { written: true, fixVisits: 1 }));
  assert.match(lineOf(message, 'Ship:'), /merge the version commit and the fix into the local main/);
  assert.match(lineOf(message, 'Version:'), /package\.json 0\.3\.0 → 1\.2\.0/);
  assert.match(lineOf(message, 'Version:'), /abcdef12/);
});

test('Ship gate: no version commit and no fix: Ship only pushes and tags, and says why the version is unchanged (#325)', (t) => {
  const dir = repo(t, { 'package.json': '{}\n' });
  const message = render(String(stepOf('ship').message), ctxFor(dir, { written: false, fixVisits: 0 }));
  assert.doesNotMatch(lineOf(message, 'Ship:'), /merge/);
  assert.match(lineOf(message, 'Ship:'), /push the local main to origin and tag it `1\.2\.0`/);
  assert.match(lineOf(message, 'Version:'), /unchanged/);
});

test('Try again: the run branch to merge names the version change and the fix (#325)', (t) => {
  const dir = repo(t, { 'package.json': '{}\n' }, { 'a.txt': 'fix\n' });
  const message = render(String(stepOf('ship_failed').message), ctxFor(dir, { written: true, fixVisits: 1 }));
  const line = lineOf(message, 'Try again:');
  assert.match(line, /the version commit, package\.json 0\.3\.0 → 1\.2\.0/);
  assert.match(line, /the fix/);
  assert.match(line, /into the local main/);
});
