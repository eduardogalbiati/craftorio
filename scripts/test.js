// Test suite: unit tests (node:test in test/*.test.js and test/<area>/*.test.js, e.g.
// test/service/, #156) + full flow in mock mode. Lists the files explicitly so it works on any
// Node version; test/fixtures/ holds no tests.
//   npm test

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
const files = testFiles('test');

console.log(`\n== Unit tests (${files.length} file(s)) ==`);
if (run(['--test', ...files]) !== 0) process.exit(1);

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
