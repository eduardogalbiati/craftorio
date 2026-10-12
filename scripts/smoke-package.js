// Smoke test of a packaged app (the release jobs in deploy.yml and preview.yml): starts it in simulation
// (MULTIAGENT_SIMULATION_ONLY=1) on a scratch workspace and checks that its window loads and that it
// quits by itself (src/main.js writes MULTIAGENT_SMOKE_FILE, then quits). Exits 1 otherwise.
//   node scripts/smoke-package.js [executable or AppImage]   (default: this machine's build in dist/)
// Linux needs a display: run it under xvfb-run.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executablePath } = require('./package');

const root = path.join(__dirname, '..');
const DEADLINE_MS = 120000;

const exe = path.resolve(process.argv[2] || executablePath(path.join(root, 'dist', `MultiagentOrchestrator-${process.platform}-${process.arch}`), process.platform));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-smoke-'));
const report = path.join(scratch, 'loaded.txt');
const workspace = path.join(scratch, 'workspace');
fs.mkdirSync(workspace);

console.log(`Smoke: starting ${exe} on ${workspace}`);
// A packaged app ignores MULTIAGENT_USER_DATA: Chromium's --user-data-dir keeps its user data (sign-in,
// window state) away from the machine's real install
const child = spawn(exe, [`--user-data-dir=${path.join(scratch, 'user-data')}`], {
  stdio: 'inherit',
  env: { ...process.env, MULTIAGENT_SIMULATION_ONLY: '1', MULTIAGENT_WORKSPACE: workspace, MULTIAGENT_SMOKE_FILE: report },
});
const fail = (why) => {
  console.error(`Smoke failed: ${why}`);
  process.exitCode = 1;
};
const timer = setTimeout(() => {
  fail(`the app did not quit within ${DEADLINE_MS / 1000} s`);
  child.kill();
}, DEADLINE_MS);
child.on('error', (e) => { clearTimeout(timer); fail(`cannot start it: ${e.message}`); });
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (process.exitCode) return;
  if (code !== 0) fail(`the app exited with ${signal || code}`);
  else if (!fs.existsSync(report)) fail('the app quit before its window loaded');
  else console.log(`Smoke passed: ${fs.readFileSync(report, 'utf8').trim()}`);
});
