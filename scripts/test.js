// Test suite: unit tests (node:test in test/*.test.js and test/<area>/*.test.js, e.g.
// test/service/, #156, and every workspace's <workspace>/test/, phase 2 of
// docs/reorganisation-study-2026-10.md) + full flow in mock mode. Lists the files explicitly so it
// works on any Node version; fixtures/ folders hold no tests.
//   npm test -w packages/shared        one workspace's tests (`node scripts/test.js --workspace <dir>`:
//                                      its test/ folder only, no full flow)
// The files run in parallel, one process each: the concurrency is explicit (MULTIAGENT_TEST_CONCURRENCY,
// else the CPUs minus one) and printed with what could lower it (an inspector in NODE_OPTIONS forces
// node --test to one file at a time), so a slow suite inside the app can be compared with a shell (#210).
// The unit report ends with the five slowest files and their wall time (#305): the suite's wall
// time is bounded below by its longest file.
// With test files as arguments (the suite step's check of failures on the base, #211), only those
// run, without the full flow. #553: the same with MULTIAGENT_TEST_FILES=<file> (one test path per
// line, relative to the project), the suite step's selection too long for the command line.
// Agent mode (#219, src/engine/agent-test-report.js isAgentMode: inside an agent or the orchestrator,
// never in a terminal or CI; MULTIAGENT_AGENT_MODE=1/0 forces it): stdout is one JSON line, failures
// only (scripts/test-reporter-agent.js), with the full flow's result; the human-readable report goes
// to MULTIAGENT_TEST_HUMAN_LOG (default .test-output/human.log), named in the JSON's `human_log`.
//   npm test
//   npm test -- test/a.test.js test/b.test.js
// Every test has a timeout (#390; MULTIAGENT_TEST_TIMEOUT_MS, 0 = none) and a file's process exits
// once its tests end (scripts/test-exit.js, a short grace instead of --test-force-exit, which aborts
// processes on Windows): a hung test fails with its name and file instead of running,
// and holding the run's worktree, forever. The default budget is per file (#402,
// src/engine/test-timeouts.js): 90 s for test/*.test.js, 5 min for the slow files, so the unit files
// and the slow ones run as two node --test runs at the same time, each with its own --test-timeout
// and half the concurrency (the slow files' half at most their count); their reports merge into one.
// With a concurrency of 1 the two runs go one after the other. With the override, one run.
// --experimental-test-coverage (`npm run test:coverage`, the suite step's `coverage: true`, #225)
// passes on to node --test: each run's coverage table ends its report (coverage-summary.js merges them).
//   npm run test:coverage [-- test/a.test.js]
// One whole suite at a time per machine (#455): in agent mode, the whole suite (no file, no list) takes
// the machine-wide `suite` slot first (src/engine/machine-slot.js), unless it inherits it, and lends
// it to the test files it runs (#528).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { isAgentMode, REPORTER } = require('../src/engine/agent-test-report');
const { workspaces } = require('./source-tree');
const machineSlot = require('../src/engine/machine-slot');
const { TEST_FILES_ENV } = require('../src/engine/suite-command-line');
const { testTimeoutMs } = require('../src/engine/test-timeouts');

// decided before the variable below is set: the orchestrator's own MULTIAGENT_SIMULATION_ONLY counts
const agent = isAgentMode(process.env, { isTTY: !!process.stdout.isTTY });
// Automated checks never call real models: the engine refuses real runs and real providers.
process.env.MULTIAGENT_SIMULATION_ONLY = '1';

const root = path.join(__dirname, '..');
const humanLog = agent ? path.resolve(root, process.env.MULTIAGENT_TEST_HUMAN_LOG || path.join('.test-output', 'human.log')) : null;
const reportFile = agent ? humanLog.replace(/(\.log)?$/, '.report.json') : null;
if (agent) {
  fs.mkdirSync(path.dirname(humanLog), { recursive: true });
  fs.writeFileSync(humanLog, '');
  fs.rmSync(reportFile, { force: true });
}
// in agent mode every process writes to the human log, and only the JSON reaches stdout
const say = (line) => (agent ? fs.appendFileSync(humanLog, `${line}\n`) : console.log(line));
const run = (args, env = {}) => {
  const fd = agent ? fs.openSync(humanLog, 'a') : null;
  try {
    return spawnSync(process.execPath, args, { cwd: root, stdio: agent ? ['ignore', fd, fd] : 'inherit', env: { ...process.env, ...env } }).status;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
};

const testFiles = (dir) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir), { withFileTypes: true }) : []).flatMap((e) => {
  if (e.isDirectory()) return e.name === 'fixtures' ? [] : testFiles(path.join(dir, e.name));
  return e.name.endsWith('.test.js') ? [path.join(dir, e.name)] : [];
}).sort();
// --workspace <dir>: one workspace's test/ folder (its `npm test`); else the root test/ and every workspace's
const workspaceAt = process.argv.indexOf('--workspace');
const workspaceDir = workspaceAt >= 0 ? path.relative(root, path.resolve(process.argv[workspaceAt + 1] || '.')) : null;
const allTestFiles = () => (workspaceDir !== null
  ? testFiles(path.join(workspaceDir, 'test'))
  : [...testFiles('test'), ...workspaces(root).flatMap((w) => testFiles(path.join(w.dir, 'test')))]);
// #553: the list file of a selection too long for the command line (src/engine/suite-step.js
// TEST_FILES_ENV), read once and dropped, so the test files this run spawns never inherit it
const listed = (() => {
  const list = process.env[TEST_FILES_ENV];
  delete process.env[TEST_FILES_ENV];
  if (!list) return [];
  return fs.readFileSync(path.resolve(list), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
})();
const only = [...process.argv.slice(2).filter((a, i, all) => !a.startsWith('-') && all[i - 1] !== '--workspace'), ...listed];
const files = only.length ? only : allTestFiles();

// #455: an agent's whole suite waits for the machine-wide suite slot (the suite step's own child
// inherits it through SUITE_SLOT_ENV); a focused run never waits
if (agent && !only.length && !process.env[machineSlot.SUITE_SLOT_ENV]) {
  try {
    const held = machineSlot.acquireSlotSync(machineSlot.SUITE_SLOT, {
      holder: 'npm test (agent)',
      waitMs: machineSlot.SUITE_MAX_HOLD_MS,
      onWait: (h) => say(`waiting for the suite slot (run ${h?.holder || '?'}, pid ${h?.pid ?? '?'}): one whole suite at a time on this machine`),
    });
    process.on('exit', () => held.release());
    // #528: the test files inherit the slot, so a test taking it (runBaseCheck) never waits on this suite
    process.env[machineSlot.SUITE_SLOT_ENV] = held.token;
  } catch (e) {
    say(`warning: ${e.message}; running without the suite slot`);
  }
}

const cpus = Math.max(os.availableParallelism(), os.cpus().length);
const concurrency = Math.max(1, Number(process.env.MULTIAGENT_TEST_CONCURRENCY) || cpus - 1);
const inspector = /--(inspect|debug)/.test(process.env.NODE_OPTIONS || '') || process.execArgv.some((a) => /^--(inspect|debug)/.test(a));
say(`\n== Unit tests (${files.length} file(s), concurrency ${concurrency}, availableParallelism ${os.availableParallelism()}, cpus ${os.cpus().length}) ==`);
if (inspector) say('warning: an inspector is enabled (NODE_OPTIONS or execArgv): node --test runs one file at a time');
if (process.env.NODE_TEST_CONTEXT) say(`warning: NODE_TEST_CONTEXT=${process.env.NODE_TEST_CONTEXT} is set: node --test acts as a test file, not a runner`);
// Per-file wall times (scripts/test-reporter-slowest.js, #305), written to a temp file and printed
// after the report: the five slowest files, the suite's critical path.
const timesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-test-times-'));
const coverage = process.argv.includes('--experimental-test-coverage') ? ['--experimental-test-coverage'] : [];
// One group per budget (#402), the shortest first; the override gives every file the same budget
const budgetOf = new Map(files.map((f) => [f, testTimeoutMs(f)]));
const budgets = [...new Set(budgetOf.values())].sort((a, b) => a - b);
const groups = budgets.length < 2
  ? [{ timeout: Math.max(0, ...budgets), files }]
  : budgets.map((ms) => ({ timeout: ms, files: files.filter((f) => budgetOf.get(f) === ms) }));
// two groups share the concurrency: the slow files get half, at most their count
if (groups.length === 2) {
  const slow = Math.min(groups[1].files.length, Math.max(1, Math.floor(concurrency / 2)));
  groups[1].concurrency = slow;
  groups[0].concurrency = Math.max(1, concurrency - slow);
} else groups[0].concurrency = concurrency;
groups.forEach((g, i) => {
  const suffix = groups.length > 1 ? `-${i + 1}` : '';
  g.reportFile = agent ? reportFile.replace(/\.report\.json$/, `${suffix}.report.json`) : null;
  g.timesFile = path.join(timesDir, `times${suffix}.json`);
  // the first group's spec report streams; the others' is printed when they end, not interleaved
  g.specFile = i ? path.join(timesDir, `spec${suffix}.log`) : null;
  if (g.reportFile) fs.rmSync(g.reportFile, { force: true });
  if (groups.length > 1) say(`${g.files.length} file(s): --test-timeout=${g.timeout} ms, concurrency ${g.concurrency}`);
});
const argsOf = (g) => [
  '--test', `--test-concurrency=${g.concurrency}`, `--test-timeout=${g.timeout}`, '--require', path.join(__dirname, 'test-exit.js'), ...coverage,
  '--test-reporter=spec', `--test-reporter-destination=${g.specFile || 'stdout'}`,
  ...(agent ? ['--test-reporter=./scripts/test-reporter-agent.js', `--test-reporter-destination=${g.reportFile}`] : []),
  '--test-reporter=./scripts/test-reporter-slowest.js', `--test-reporter-destination=${g.timesFile}`,
  ...g.files,
];
// the groups run at the same time: an async spawn each, with run()'s output and environment
const runAsync = (args) => new Promise((resolve) => {
  const fd = agent ? fs.openSync(humanLog, 'a') : null;
  const child = spawn(process.execPath, args, { cwd: root, stdio: agent ? ['ignore', fd, fd] : 'inherit', env: process.env });
  let closed = false;
  // a spawn error may emit both 'error' and 'exit'
  const done = (code) => {
    if (closed) return;
    closed = true;
    if (fd != null) fs.closeSync(fd);
    resolve(code);
  };
  child.on('error', () => done(null));
  child.on('exit', (code) => done(code));
});

function saySlowest() {
  const times = {};
  for (const g of groups) {
    try { Object.assign(times, JSON.parse(fs.readFileSync(g.timesFile, 'utf8'))); } catch { /* the runner died before reporting */ }
  }
  fs.rmSync(timesDir, { recursive: true, force: true });
  const slowest = Object.entries(times).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!slowest.length) return;
  const shown = (file) => {
    const rel = path.relative(root, file);
    return (rel.startsWith('..') || path.isAbsolute(rel) ? file : rel).split(path.sep).join('/');
  };
  say(`\n== Slowest test files (wall time, ${Object.keys(times).length} file(s)) ==`);
  for (const [file, ms] of slowest) say(`  ${(ms / 1000).toFixed(1).padStart(7)} s  ${shown(file)}`);
}

// The last lines of the human log: why something failed that the reporter could not see.
const tail = () => {
  try { return fs.readFileSync(humanLog, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3).join('\n'); } catch { return ''; }
};
const COUNTS = ['passed', 'failed', 'skipped', 'todo', 'cancelled'];
// One report from the groups' (#402): counts summed, failures in group order
function groupsReport() {
  const reports = groups.map((g) => {
    try { return JSON.parse(fs.readFileSync(g.reportFile, 'utf8')); } catch { /* the runner died before reporting */ }
    return { reporter: REPORTER, passed: 0, failed: 1, skipped: 0, todo: 0, cancelled: 0, duration_ms: 0, failures: [{ test: '(the test runner)', file: '', line: null, error: tail() || `exit ${g.status}`, kind: 'file' }] };
  });
  if (reports.length === 1) return reports[0];
  const report = { reporter: REPORTER, ...Object.fromEntries(COUNTS.map((k) => [k, reports.reduce((n, r) => n + (r[k] || 0), 0)])) };
  report.duration_ms = Math.max(...reports.map((r) => r.duration_ms || 0));
  report.failures = reports.flatMap((r) => r.failures || []);
  if (reports.every((r) => r.files)) report.files = Object.assign({}, ...reports.map((r) => r.files));
  return report;
}
let unitStatus = 0;
function finish(flow) {
  if (!agent) process.exit(flow ? flow.status : unitStatus === 0 ? 0 : 1);
  const report = groupsReport();
  if (flow) {
    report.flow = { status: flow.status === 0 ? 'passed' : 'failed' };
    if (flow.status !== 0) {
      report.flow.error = tail();
      report.failed++;
      report.failures.push({ test: '(full flow in mock mode)', file: 'scripts/run.js', line: null, error: report.flow.error, kind: 'file' });
    }
  }
  report.human_log = path.relative(root, humanLog).split(path.sep).join('/');
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(unitStatus === 0 && (!flow || flow.status === 0) ? 0 : 1);
}

async function main() {
  // a concurrency of 1 is one test file at a time: the groups run one after the other
  if (concurrency < 2) for (const g of groups) g.status = await runAsync(argsOf(g));
  else await Promise.all(groups.map(async (g) => { g.status = await runAsync(argsOf(g)); }));
  unitStatus = groups.every((g) => g.status === 0) ? 0 : 1;
  for (const g of groups.filter((x) => x.specFile)) {
    try { say(fs.readFileSync(g.specFile, 'utf8').trimEnd()); } catch { /* the runner died before reporting */ }
  }
  saySlowest();
  if (unitStatus !== 0 || only.length || workspaceDir !== null) finish(null);

  say('\n== Full flow in mock mode ==');
  // Fresh temporary workspace: the tests do not write to the user's workspace or the registry, and the
  // bundled skills and workflows are seeded from scratch. Kept on failure for inspection.
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-test-ws-'));
  const status = run(['scripts/run.js', '--mock', '--auto-approve', '--task', 'Engine test'], {
    MULTIAGENT_MOCK_DELAY_SCALE: '0.2',
    MULTIAGENT_WORKSPACE: wsDir,
  });
  if (status === 0) { try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch { /* temp folder */ } }
  else say(`test workspace kept in ${wsDir}`);
  finish({ status: status ?? 1 });
}
main();
