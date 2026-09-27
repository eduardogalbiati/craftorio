// Test suite: unit tests (node:test in test/*.test.js) + full flow in mock mode.
// Lists the files explicitly so it works on any Node version.
//   npm test

const fs = require('fs');
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
// Isolated workspace: the tests do not write to the user's workspace or the registry.
const status = run(['scripts/run.js', '--mock', '--auto-approve', '--task', 'Engine test'], {
  MULTIAGENT_MOCK_DELAY_SCALE: '0.2',
  MULTIAGENT_WORKSPACE: path.join(root, 'runs', 'test-workspace'),
});
process.exit(status ?? 1);
