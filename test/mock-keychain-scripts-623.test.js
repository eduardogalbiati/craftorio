// #623 (acceptance tests, written before the code): the throwaway launches that do not go through
// apps/desktop/host/main.js's own guard (#578) run on Chromium's mock keychain on macOS, so they never
// ask the machine's keychain for "Safe Storage":
//   - scripts/smoke-package.js passes --use-mock-keychain to the packaged app next to --user-data-dir,
//     on darwin only (Windows' DPAPI and Linux's libsecret untouched; the AppImage sandbox check of
//     #476 still runs);
//   - scripts/screenshot.js appends use-mock-keychain while it loads, before Electron's app is ready,
//     on darwin only.
// Each script runs in a child Node with test/fixtures/mock-keychain-623-preload.js, which fakes the OS
// (process.platform), the spawned packaged app and Electron's main process, and records what the
// script did. The packaged app itself (main.js never appends the switch when app.isPackaged) stays
// covered by apps/desktop/test/host/mock-keychain-simulation.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const preload = path.join(__dirname, 'fixtures', 'mock-keychain-623-preload.js');

/** Runs one script under the preload; returns its exit status, output and the recorded entries. */
function runScript(t, script, args, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keychain-623-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const recordFile = path.join(dir, 'record.jsonl');
  const r = spawnSync(process.execPath, ['-r', preload, path.join(root, 'scripts', script), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, KEYCHAIN_623_RECORD: recordFile, ...env },
  });
  const entries = fs.existsSync(recordFile)
    ? fs.readFileSync(recordFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { status: r.status, output: `${r.stdout || ''}${r.stderr || ''}`, entries };
}

const smoke = (t, platform, exe, extraEnv = {}) => {
  const r = runScript(t, 'smoke-package.js', [exe], { KEYCHAIN_623_PLATFORM: platform, ...extraEnv });
  const spawns = r.entries.filter((e) => e.spawn).map((e) => e.spawn.args);
  assert.equal(spawns.length, 1, `the smoke starts the packaged app once:\n${r.output}`);
  return { ...r, args: spawns[0] };
};

test('the packaged smoke passes --use-mock-keychain to the app on macOS, next to its scratch --user-data-dir', (t) => {
  const r = smoke(t, 'darwin', '/Applications/MultiagentOrchestrator.app/Contents/MacOS/MultiagentOrchestrator');
  assert.equal(r.args.includes('--use-mock-keychain'), true, `spawn arguments: ${JSON.stringify(r.args)}`);
  assert.equal(r.args.some((a) => a.startsWith('--user-data-dir=')), true, `spawn arguments: ${JSON.stringify(r.args)}`);
  assert.equal(r.status, 0, r.output);
});

test('the packaged smoke does not pass --use-mock-keychain on Windows', (t) => {
  const r = smoke(t, 'win32', 'C:\\dist\\MultiagentOrchestrator.exe');
  assert.equal(r.args.includes('--use-mock-keychain'), false, `spawn arguments: ${JSON.stringify(r.args)}`);
  assert.equal(r.args.some((a) => a.startsWith('--user-data-dir=')), true, `spawn arguments: ${JSON.stringify(r.args)}`);
  assert.equal(r.status, 0, r.output);
});

test('the packaged smoke does not pass --use-mock-keychain on Linux', (t) => {
  const r = smoke(t, 'linux', '/dist/MultiagentOrchestrator-linux-x64/multiagent-orchestrator');
  assert.equal(r.args.includes('--use-mock-keychain'), false, `spawn arguments: ${JSON.stringify(r.args)}`);
  assert.equal(r.status, 0, r.output);
});

test('on Linux the smoke still fails an AppImage started without the sandbox that prints no warning (#476)', (t) => {
  const r = smoke(t, 'linux', '/dist/MultiagentOrchestrator-x86_64.AppImage', { KEYCHAIN_623_NO_USERNS: '1' });
  assert.equal(r.args.includes('--use-mock-keychain'), false, `spawn arguments: ${JSON.stringify(r.args)}`);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /#476/);
});

const screenshotSwitches = (t, platform) => {
  const r = runScript(t, 'screenshot.js', ['--help'], { KEYCHAIN_623_PLATFORM: platform, KEYCHAIN_623_ELECTRON: '1' });
  assert.equal(r.entries.some((e) => e.exit === 0), true, `the screenshot tool prints its usage and exits 0 (--help):\n${r.output}`);
  return r.entries.filter((e) => e.appendSwitch === 'use-mock-keychain');
};

test('the screenshot tool appends use-mock-keychain on macOS while it loads, before the app is ready', (t) => {
  const appended = screenshotSwitches(t, 'darwin');
  assert.equal(appended.length, 1, 'use-mock-keychain appended once');
  assert.equal(appended[0].ready, false, 'appended before app is ready');
});

test('the screenshot tool does not append use-mock-keychain on Windows nor on Linux', (t) => {
  assert.equal(screenshotSwitches(t, 'win32').length, 0, 'Windows');
  assert.equal(screenshotSwitches(t, 'linux').length, 0, 'Linux');
});
