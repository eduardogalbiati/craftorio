// Test suite: unit tests (node:test in test/*.test.js) + full flow in mock mode.
// Lists the files explicitly so it works on any Node version.
//   npm test

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const run = (args, env = {}) => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } }).status;

const files = fs.readdirSync(path.join(root, 'test'))
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => path.join('test', f));

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
