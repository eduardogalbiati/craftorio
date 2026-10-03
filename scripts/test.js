// Test suite: unit tests (node:test in test/*.test.js and test/<area>/*.test.js, e.g.
// test/service/, #156) + full flow in mock mode. Lists the files explicitly so it works on any
// Node version; test/fixtures/ holds no tests.
// The files run in parallel, one process each: the concurrency is explicit (MULTIAGENT_TEST_CONCURRENCY,
// else the CPUs minus one) and printed with what could lower it (an inspector in NODE_OPTIONS forces
// node --test to one file at a time), so a slow suite inside the app can be compared with a shell (#210).
// With test files as arguments (the suite step's check of failures on the base, #211), only those
// run, without the full flow.
//   npm test
//   npm test -- test/a.test.js test/b.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Automated checks never call real models: the engine refuses real runs and real providers.
process.env.MULTIAGENT_SIMULATION_ONLY = '1';

const root = path.join(__dirname, '..');
const run = (args, env = {}) => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } }).status;

const testFiles = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
  if (e.isDirectory()) return e.name === 'fixtures' ? [] : testFiles(path.join(dir, e.name));
  return e.name.endsWith('.test.js') ? [path.join(dir, e.name)] : [];
}).sort();
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const files = only.length ? only : testFiles('test');

const cpus = Math.max(os.availableParallelism(), os.cpus().length);
const concurrency = Math.max(1, Number(process.env.MULTIAGENT_TEST_CONCURRENCY) || cpus - 1);
const inspector = /--(inspect|debug)/.test(process.env.NODE_OPTIONS || '') || process.execArgv.some((a) => /^--(inspect|debug)/.test(a));
console.log(`\n== Unit tests (${files.length} file(s), concurrency ${concurrency}, availableParallelism ${os.availableParallelism()}, cpus ${os.cpus().length}) ==`);
if (inspector) console.log('warning: an inspector is enabled (NODE_OPTIONS or execArgv): node --test runs one file at a time');
if (process.env.NODE_TEST_CONTEXT) console.log(`warning: NODE_TEST_CONTEXT=${process.env.NODE_TEST_CONTEXT} is set: node --test acts as a test file, not a runner`);
if (run(['--test', `--test-concurrency=${concurrency}`, ...files]) !== 0) process.exit(1);
if (only.length) process.exit(0);

console.log('\n== Full flow in mock mode ==');
// Fresh temporary workspace: the tests do not write to the user's workspace or the registry, and the
// bundled skills and workflows are seeded from scratch. Kept on failure for inspection.
const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-test-ws-'));
const status = run(['scripts/run.js', '--mock', '--auto-approve', '--task', 'Engine test'], {
  MULTIAGENT_MOCK_DELAY_SCALE: '0.2',
  MULTIAGENT_WORKSPACE: wsDir,
});
if (status === 0) { try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch { /* temp folder */ } }
else console.log(`test workspace kept in ${wsDir}`);
process.exit(status ?? 1);
