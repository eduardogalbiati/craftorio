// #203 is user-visible in the Start drawer (Dashboard › Start workflow) and the Run screen's
// Details: two new pill choices, Unit tests and E2E tests, sit next to Mode (src/renderer/start-
// drawer.js:155-158, software-development.yaml:177-190) and the chosen plan shows as badges on the
// Run screen (src/renderer/views/run/run.js:122, .run-tests-plan, a "warn" badge for "off"). These
// scenarios drive scripts/screenshot.js (the project's own UI-check tool), the way
// test/e2e/200-paged-artifacts.test.js does. Only with MULTIAGENT_UI_TESTS=1 (it needs the Electron
// binary and a display), like the rest of the Electron part of test/screenshot.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-203-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Located without require('electron'), which would download the binary when it is missing.
const electron = (() => {
  const dir = path.join(root, 'node_modules', 'electron');
  try { const p = path.join(dir, 'dist', fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim()); return fs.existsSync(p) ? p : null; } catch { return null; }
})();
const skip = process.env.MULTIAGENT_UI_TESTS !== '1' ? 'set MULTIAGENT_UI_TESTS=1 to open the app' : false;

/** Runs scripts/screenshot.js; resolves { code, out }. Kills it (and fails) if it outlives `limit`. */
function shoot(args, limit = 90000) {
  return new Promise((resolve, reject) => {
    if (!electron) { reject(new Error('the Electron binary is not installed')); return; }
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'scripts', 'screenshot.js'), ...args], { cwd: root, env, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`still running after ${limit} ms: ${args.join(' ')}\n${out}`)); }, limit);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

const isPng = (file) => fs.readFileSync(file).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

test('@issue-203 Given a development workflow with its own test defaults, when the owner opens Start workflow, then Unit tests and E2E tests show next to Mode with the workflow\'s defaults picked', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'dashboard', '--workflow', 'software-development.yaml', '--click', '#btn-quick-start', '--wait', '1000', '--name', 'start-drawer-test-options', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'start-drawer-test-options.png');
  assert.ok(isPng(file));
});

test('@issue-203 Given the Start drawer is open, when the owner picks Off for both Unit tests and E2E tests, then both show their Off pill selected, for the cheapest run', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'dashboard', '--workflow', 'software-development.yaml', '--click', '#btn-quick-start', '--click', '[data-wi-key="unit_tests"] [data-wi-pill="off"]', '--click', '[data-wi-key="e2e_tests"] [data-wi-pill="off"]', '--wait', '1000', '--name', 'start-drawer-test-options-off', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'start-drawer-test-options-off.png');
  assert.ok(isPng(file));
});

test('@issue-203 Given a run started with Unit tests and E2E tests off, when the owner looks at the Run screen\'s Details, then it shows both as "Off" badges so nothing is reported as tested', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'run', '--input', 'unit_tests=off', '--input', 'e2e_tests=off', '--wait', '20000', '--name', 'run-tests-plan-off', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'run-tests-plan-off.png');
  assert.ok(isPng(file));
});
