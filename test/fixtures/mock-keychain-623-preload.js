// #623: preloaded (`node -r`) into scripts/smoke-package.js or scripts/screenshot.js by
// test/mock-keychain-scripts-623.test.js. It stands in for the system boundaries those scripts reach:
// the OS (process.platform from KEYCHAIN_623_PLATFORM), the packaged app the smoke spawns (a fake child
// that "loads" and quits) and, with KEYCHAIN_623_ELECTRON=1, Electron's main process (a fake `electron`
// module whose app is never ready). What the scripts do is written as JSON lines to KEYCHAIN_623_RECORD.
const fs = require('fs');
const os = require('os');
const Module = require('module');
const { EventEmitter } = require('events');

const record = (entry) => fs.appendFileSync(process.env.KEYCHAIN_623_RECORD, `${JSON.stringify(entry)}\n`);

Object.defineProperty(process, 'platform', { value: process.env.KEYCHAIN_623_PLATFORM, configurable: true });

// A Linux kernel that makes an AppImage start without Chromium's sandbox (#476)
if (process.env.KEYCHAIN_623_NO_USERNS === '1') {
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) {
    if (p === '/proc/sys/kernel/apparmor_restrict_unprivileged_userns') return '1';
    if (p === '/proc/sys/kernel/unprivileged_userns_clone') return '1';
    return readFileSync.call(this, p, ...rest);
  };
}

const childProcess = require('child_process');
childProcess.spawn = (command, args, options) => {
  record({ spawn: { command, args } });
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    const report = options && options.env && options.env.MULTIAGENT_SMOKE_FILE;
    if (report) fs.writeFileSync(report, 'window loaded');
    child.emit('exit', 0, null);
  });
  return child;
};

if (process.env.KEYCHAIN_623_ELECTRON === '1') {
  process.type = 'browser';
  // the E2E suite's Electron main (features/support/electron-main.js) only imports the helpers
  if (process.env.KEYCHAIN_623_E2E_HELPERS === '1') global.multiagentScreenshotHelpers = {};
  const app = {
    isPackaged: false,
    isReady: () => false,
    whenReady: () => new Promise(() => {}),
    on() { return app; },
    once() { return app; },
    quit() {},
    exit: (code) => record({ exit: code }),
    setPath() {},
    getPath: () => os.tmpdir(),
    getAppPath: () => process.cwd(),
    commandLine: {
      appendSwitch: (name, value) => record({ appendSwitch: name, value: value ?? null, ready: app.isReady() }),
      appendArgument() {},
      hasSwitch: () => false,
      getSwitchValue: () => '',
    },
  };
  const electron = { app, nativeTheme: {}, ipcMain: { handle() {}, on() {}, removeHandler() {} }, BrowserWindow: function BrowserWindow() {} };
  const load = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'electron' ? electron : load.call(this, request, ...rest);
  };
}
