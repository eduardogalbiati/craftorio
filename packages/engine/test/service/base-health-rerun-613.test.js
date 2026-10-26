// #613 the service's base check re-runs the failed tests' files once, for real: a project whose
// `npm test` is `node --test`, with a test red only the first time it runs in a checkout (it leaves a
// marker there), a test always red and a test always green.
//
// Seams: the service area (packages/engine/service/areas/base-health.js afterBaseMerge) on a real git
// repository, the store read back (packages/engine/engine/base-health-store.js readStore, knownFailures)
// and the second round's log next to the suite's (base-check-<project>-rerun.log).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('./helpers');
const { SUITE_SLOT_ENV } = require('../../engine/machine-slot');

const loadArea = () => require('../../service/areas/base-health');
const loadHealth = () => require('../../domains/project/base-health');
const loadStore = () => require('../../engine/base-health-store');

const FLAKY = 'flaky passes on its second run';
const BROKEN = 'broken always fails';

let saved;
test.beforeEach(() => { saved = { locks: process.env.MULTIAGENT_LOCKS_DIR, inherit: process.env[SUITE_SLOT_ENV] }; delete process.env[SUITE_SLOT_ENV]; });
test.afterEach(() => {
  for (const [k, v] of [['MULTIAGENT_LOCKS_DIR', saved.locks], [SUITE_SLOT_ENV, saved.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// a git repository on main: npm test is node --test over test/, the three tests one per file
function nodeProject(t) {
  const dir = tmp(t, 'bh613s-repo-');
  const cfg = path.join(tmp(t, 'bh613s-gitcfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bh613', private: true, scripts: { test: 'node --test' } }, null, 2));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.ran-flaky\n');
  fs.writeFileSync(path.join(dir, 'test', 'flaky.test.js'), [
    "const test = require('node:test');",
    "const fs = require('fs');",
    "const path = require('path');",
    `test('${FLAKY}', () => {`,
    "  const mark = path.join(__dirname, '..', '.ran-flaky');",
    "  if (!fs.existsSync(mark)) { fs.writeFileSync(mark, 'x'); throw new Error('red the first time'); }",
    '});',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'test', 'broken.test.js'), [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    `test('${BROKEN}', () => { assert.equal(1 + 1, 3); });`,
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'test', 'ok.test.js'), [
    "const test = require('node:test');",
    "test('ok always passes', () => {});",
    '',
  ].join('\n'));
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  return dir;
}

test('#613 the service re-runs only the failed files in one command: red twice is recorded, red then green is a flaky sighting', async (t) => {
  const { service, api } = makeService(t);
  process.env.MULTIAGENT_LOCKS_DIR = tmp(t, 'bh613s-locks-');
  const repo = nodeProject(t);
  const project = await api['projects:create']({ name: 'bh613', folder: repo });
  const logs = [];
  const log = console.log;
  console.log = (...a) => { logs.push(a.map(String).join(' ')); };
  t.after(() => { console.log = log; });
  const area = loadArea()({ ws: service.workspace(), active: new Map(), isReleaseRun: () => false, notify: () => {}, events: { emit: () => {} } });
  const check = area.afterBaseMerge({ projectId: project.id, runId: 'run-613', mock: false }, { base: 'main', tested: 'merge' });
  assert.ok(check && typeof check.then === 'function', 'a check started (fixture check)');
  const r = await check;
  console.log = log;

  const ws = service.workspace().root;
  assert.equal(r.status, 'red', `the check: ${JSON.stringify({ status: r.status, error: r.error })}`);
  assert.deepEqual(loadHealth().knownFailures(ws, project.id).map((x) => x.test), [BROKEN], 'only the test red twice is recorded');
  assert.deepEqual((loadStore().readStore(ws, project.id).flaky || []).map((x) => x.test), [FLAKY], 'the test red then green is a flaky sighting');
  assert.ok(logs.some((l) => /red in the whole suite, green on the re-run/.test(l) && l.includes(FLAKY)), `the server log says so: ${JSON.stringify(logs.filter((l) => /base check/.test(l)))}`);

  const rerunLog = loadHealth().baseCheckLog(ws, project.id).replace(/-suite\.log$/, '-rerun.log');
  assert.ok(fs.existsSync(rerunLog), `the second round's own log: ${rerunLog}`);
  const commandLines = fs.readFileSync(rerunLog, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('$ '));
  assert.equal(commandLines.length, 1, `one command: ${JSON.stringify(commandLines)}`);
  const cmd = commandLines[0].replace(/\\/g, '/');
  assert.ok(cmd.includes('test/broken.test.js') && cmd.includes('test/flaky.test.js'), `the failed files: ${cmd}`);
  assert.ok(!cmd.includes('ok.test.js'), `not the green one: ${cmd}`);
});
