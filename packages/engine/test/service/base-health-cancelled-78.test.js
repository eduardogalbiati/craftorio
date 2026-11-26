// #78 a base check whose suite was cut short (cancelled or timed-out test files, no failed test) is
// inconclusive, not "Red on the base". A project whose `npm test` prints what Node's test runner prints
// then (spec reporter: `ℹ fail 0`, `ℹ cancelled N`, each cancelled file under "✖ failing tests:" with
// 'Promise resolution is still pending but the event loop has already resolved') and exits 1.
//
// Seams: the service area (packages/engine/service/areas/base-health.js afterBaseMerge) on a real git
// repository, as test/service/base-health-rerun-613.test.js; the store read back
// (packages/engine/engine/base-health-store.js readStore, knownFailures); the roadmap read back.
//
// Assumptions for the developer: the inconclusive check is `status: 'error'` with an `error` naming the
// cancelled files' count (e.g. "the suite was cut short: 2 file(s) cancelled, 0 failed"); a real failed
// test in the same log (`ℹ fail 1`) keeps the check red, with only that test recorded.
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
const loadRoadmap = () => require('../../domains/roadmap/roadmap');

const PENDING = "'Promise resolution is still pending but the event loop has already resolved'";
const cancelledFile = (file) => [`test at ${file}:1:1`, `✖ ${file} (30012.4ms)`, `  ${PENDING}`, ''];

// Node 24's spec reporter, 10 tests: 8 pass, `fail` failed, the two hang files cancelled
function nodeLog(fail) {
  return [
    '✔ ok always passes (0.6ms)',
    'ℹ tests 10',
    'ℹ suites 0',
    `ℹ pass ${8 - fail}`,
    `ℹ fail ${fail}`,
    'ℹ cancelled 2',
    'ℹ skipped 0',
    'ℹ todo 0',
    'ℹ duration_ms 30123.4',
    '',
    '✖ failing tests:',
    '',
    ...cancelledFile('test/hang-a.test.js'),
    ...cancelledFile('test/hang-b.test.js'),
    ...(fail ? ['test at test/cart.test.js:3:1', '✖ cart totals include tax (1.1ms)', '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:', ''] : []),
  ].join('\n');
}

let saved;
test.beforeEach(() => { saved = { locks: process.env.CRAFTORIO_LOCKS_DIR, inherit: process.env[SUITE_SLOT_ENV] }; delete process.env[SUITE_SLOT_ENV]; });
test.afterEach(() => {
  for (const [k, v] of [['CRAFTORIO_LOCKS_DIR', saved.locks], [SUITE_SLOT_ENV, saved.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// a git repository on main whose `npm test` prints `log` and exits 1; given files (the #613 second
// round), it prints `rerunLog` instead when there is one
function printingProject(t, log, rerunLog = null) {
  const dir = tmp(t, 'bh78s-repo-');
  const cfg = path.join(tmp(t, 'bh78s-gitcfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bh78', private: true, scripts: { test: 'node report.js' } }, null, 2));
  const first = JSON.stringify(`${log}\n`);
  const second = JSON.stringify(`${rerunLog ?? log}\n`);
  fs.writeFileSync(path.join(dir, 'report.js'), `process.stdout.write(process.argv.length > 2 ? ${second} : ${first});\nprocess.exitCode = 1;\n`);
  for (const f of ['hang-a', 'hang-b', 'cart', 'tax', 'ok']) fs.writeFileSync(path.join(dir, 'test', `${f}.test.js`), '// printed by report.js\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  return dir;
}

async function check(t, log, rerunLog = null) {
  const { service, api } = makeService(t);
  process.env.CRAFTORIO_LOCKS_DIR = tmp(t, 'bh78s-locks-');
  api['settings:set']({ baseCheck: { onRed: 'fix' } });
  const project = await api['projects:create']({ name: 'bh78', folder: printingProject(t, log, rerunLog) });
  const area = loadArea()({ ws: service.workspace(), active: new Map(), isReleaseRun: () => false, notify: () => {}, events: { emit: () => {} } });
  const started = area.afterBaseMerge({ projectId: project.id, runId: 'run-78', mock: false }, { base: 'main', tested: 'merge' });
  assert.ok(started && typeof started.then === 'function', 'a check started (fixture check)');
  const r = await started;
  const ws = service.workspace();
  return {
    r,
    known: loadHealth().knownFailures(ws.root, project.id).map((x) => x.test),
    lastCheck: loadStore().readStore(ws.root, project.id).lastCheck?.status ?? null,
    flaky: (loadStore().readStore(ws.root, project.id).flaky || []).map((x) => x.test),
    fixStages: loadRoadmap().readRoadmap(ws.backlog, project.id).stages.filter((s) => s.name === 'Fix the base').length,
  };
}

test('#78 a suite with fail 0 and 2 cancelled files: the check is error, nothing recorded, no issue, no fix item', async (t) => {
  const { r, known, lastCheck, fixStages } = await check(t, nodeLog(0));
  assert.equal(r.status, 'error', `the check: ${JSON.stringify({ status: r.status, error: r.error })}`);
  assert.deepEqual(known, [], 'nothing recorded as red on the base');
  assert.equal(lastCheck, 'error');
  assert.deepEqual([(r.issues || []).length, r.fixItem ?? null, fixStages], [0, null, 0]);
});

test('#78 the cut-short check names why: cancelled files, none failed', async (t) => {
  const { r } = await check(t, nodeLog(0));
  assert.match(String(r.error), /cancel/i);
  assert.match(String(r.error), /\b2\b/);
});

test('#78 a suite with fail 1 and 2 cancelled files is still red, and only the failed test is recorded', async (t) => {
  const { r, known, lastCheck } = await check(t, nodeLog(1));
  assert.equal(r.status, 'red', `the check: ${JSON.stringify({ status: r.status, error: r.error })}`);
  assert.deepEqual(known, ['cart totals include tax']);
  assert.equal(lastCheck, 'red');
});

// the whole suite: two real failures (cart, tax); the second round: cart red again, tax's file cancelled
const failure = (file, name, error) => [`test at ${file}:3:1`, `✖ ${name} (1.1ms)`, `  ${error}`, ''];
const twoFailed = ['ℹ tests 10', 'ℹ pass 8', 'ℹ fail 2', 'ℹ cancelled 0', '', '✖ failing tests:', '',
  ...failure('test/cart.test.js', 'cart totals include tax', 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:'),
  ...failure('test/tax.test.js', 'tax rounds half up', 'AssertionError [ERR_ASSERTION]: 0.5 !== 1')].join('\n');
const mixedRerun = ['ℹ tests 2', 'ℹ pass 0', 'ℹ fail 1', 'ℹ cancelled 1', '', '✖ failing tests:', '',
  ...failure('test/cart.test.js', 'cart totals include tax', 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:'),
  ...cancelledFile('test/tax.test.js')].join('\n');

test('#78 a second round with one test red again and the other one\'s file cancelled: the first is red, the second is not flaky', async (t) => {
  const { r, known, flaky } = await check(t, twoFailed, mixedRerun);
  assert.equal(r.status, 'red', `the check: ${JSON.stringify({ status: r.status, error: r.error })}`);
  assert.equal(known.includes('cart totals include tax'), true, 'cart, red twice, is red on the base');
  assert.deepEqual(flaky, [], 'tax was cancelled in the second round, not seen green: no flaky sighting');
});
