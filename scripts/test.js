// Test suite: unit tests (node:test in test/*.test.js and test/<area>/*.test.js, e.g.
// test/service/, #156) + full flow in mock mode. Lists the files explicitly so it works on any
// Node version; test/fixtures/ holds no tests.
// The files run in parallel, one process each: the concurrency is explicit (MULTIAGENT_TEST_CONCURRENCY,
// else the CPUs minus one) and printed with what could lower it (an inspector in NODE_OPTIONS forces
// node --test to one file at a time), so a slow suite inside the app can be compared with a shell (#210).
// The unit report ends with the five slowest files and their wall time (#305): the suite's wall
// time is bounded below by its longest file.
// With test files as arguments (the suite step's check of failures on the base, #211), only those
// run, without the full flow.
// Agent mode (#219, src/engine/agent-test-report.js isAgentMode: inside an agent or the orchestrator,
// never in a terminal or CI; MULTIAGENT_AGENT_MODE=1/0 forces it): stdout is one JSON line, failures
// only (scripts/test-reporter-agent.js), with the full flow's result; the human-readable report goes
// to MULTIAGENT_TEST_HUMAN_LOG (default .test-output/human.log), named in the JSON's `human_log`.
//   npm test
//   npm test -- test/a.test.js test/b.test.js
// --experimental-test-coverage (`npm run test:coverage`, the suite step's `coverage: true`, #225)
// passes on to node --test: its coverage table ends the report.
//   npm run test:coverage [-- test/a.test.js]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { isAgentMode, REPORTER } = require('../src/engine/agent-test-report');

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

const testFiles = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
  if (e.isDirectory()) return e.name === 'fixtures' ? [] : testFiles(path.join(dir, e.name));
  return e.name.endsWith('.test.js') ? [path.join(dir, e.name)] : [];
}).sort();
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const files = only.length ? only : testFiles('test');

const cpus = Math.max(os.availableParallelism(), os.cpus().length);
const concurrency = Math.max(1, Number(process.env.MULTIAGENT_TEST_CONCURRENCY) || cpus - 1);
const inspector = /--(inspect|debug)/.test(process.env.NODE_OPTIONS || '') || process.execArgv.some((a) => /^--(inspect|debug)/.test(a));
say(`\n== Unit tests (${files.length} file(s), concurrency ${concurrency}, availableParallelism ${os.availableParallelism()}, cpus ${os.cpus().length}) ==`);
if (inspector) say('warning: an inspector is enabled (NODE_OPTIONS or execArgv): node --test runs one file at a time');
if (process.env.NODE_TEST_CONTEXT) say(`warning: NODE_TEST_CONTEXT=${process.env.NODE_TEST_CONTEXT} is set: node --test acts as a test file, not a runner`);
// Per-file wall times (scripts/test-reporter-slowest.js, #305), written to a temp file and printed
// after the report: the five slowest files, the suite's critical path.
const timesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-test-times-'));
const timesFile = path.join(timesDir, 'times.json');
const reporters = [
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  ...(agent ? ['--test-reporter=./scripts/test-reporter-agent.js', `--test-reporter-destination=${reportFile}`] : []),
  '--test-reporter=./scripts/test-reporter-slowest.js', `--test-reporter-destination=${timesFile}`,
];
const coverage = process.argv.includes('--experimental-test-coverage') ? ['--experimental-test-coverage'] : [];
const unitStatus = run(['--test', `--test-concurrency=${concurrency}`, ...coverage, ...reporters, ...files]);

function saySlowest() {
  let times = {};
  try { times = JSON.parse(fs.readFileSync(timesFile, 'utf8')); } catch { /* the runner died before reporting */ }
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
saySlowest();

// The last lines of the human log: why something failed that the reporter could not see.
const tail = () => {
  try { return fs.readFileSync(humanLog, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3).join('\n'); } catch { return ''; }
};
function finish(flow) {
  if (!agent) process.exit(flow ? flow.status : unitStatus === 0 ? 0 : 1);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch { /* the runner died before reporting */ }
  if (!report) {
    report = { reporter: REPORTER, passed: 0, failed: 1, skipped: 0, todo: 0, cancelled: 0, duration_ms: 0, failures: [{ test: '(the test runner)', file: '', line: null, error: tail() || `exit ${unitStatus}`, kind: 'file' }] };
  }
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
if (unitStatus !== 0 || only.length) finish(null);

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
