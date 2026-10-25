// A simulation never reaches the owner's keychain: apps/desktop/host/main.js turns Chromium's mock
// keychain on (`--use-mock-keychain`) when it runs under MULTIAGENT_SIMULATION_ONLY in a development
// checkout, so the smoke, the screenshots and every E2E scenario on macOS stop asking for "Chromium
// Safe Storage" (a dialog that blocked the run until it was dismissed). Only on a throwaway user data
// folder (MULTIAGENT_USER_DATA, which the smoke, the screenshots and the E2E launches set, or a scratch
// one the host chose): the owner's own account.bin keeps the real keychain. A packaged app never sets it.
// Read from the source: the switch has to be appended before the app is ready, so it cannot be
// observed from a test that requires the host.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', '..', 'host', 'main.js'), 'utf8');

test('main.js appends use-mock-keychain under MULTIAGENT_SIMULATION_ONLY, in a development checkout only', () => {
  const line = main.split(/\r?\n/).find((l) => l.includes("appendSwitch('use-mock-keychain')"));
  assert.ok(line, 'main.js appends the use-mock-keychain switch');
  assert.match(line, /process\.env\.MULTIAGENT_SIMULATION_ONLY === '1'/, 'only in a simulation');
  assert.match(line, /!app\.isPackaged/, 'never in the packaged app');
  assert.match(line, /scratchUserData/, 'only on a throwaway user data folder (MULTIAGENT_USER_DATA, or a scratch one the host chose)');
  // before the app is ready: the switch is read at startup, so it sits above whenReady
  assert.ok(main.indexOf("appendSwitch('use-mock-keychain')") < main.indexOf('app.whenReady('), 'appended before app.whenReady');
});
