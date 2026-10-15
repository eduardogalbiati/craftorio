// #263: the Agents window's links open in the main window. The main process relays
// `agents-window:navigate` (sent from the window's page, manifest: navigateMainWindow) to the main
// window as `main-window:navigate` after bringing it to the front. The relay lives inline in
// src/main.js (not in an Electron-free module), so this reads its source like
// test/clipboard-api.test.js does: the handler is sliced out and its steps asserted in order.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const relay = () => {
  const m = mainSrc.match(/ipcMain\.on\('agents-window:navigate'[\s\S]*?\n\s*\}\);/);
  assert.ok(m, 'src/main.js listens to agents-window:navigate with ipcMain.on');
  return m[0];
};

test('#263 the main process relays agents-window:navigate to the main window as main-window:navigate', () => {
  const handler = relay();
  assert.match(handler, /win\.webContents\.send\('main-window:navigate'/);
});

test('#263 the relay brings the main window to the front first: restores it when minimized, shows and focuses it, then sends', () => {
  const handler = relay();
  const at = (re) => {
    const i = handler.search(re);
    assert.ok(i >= 0, `the relay has ${re}`);
    return i;
  };
  const restore = at(/if \(win\.isMinimized\(\)\) win\.restore\(\)/);
  const show = at(/win\.show\(\)/);
  const focus = at(/win\.focus\(\)/);
  const send = at(/win\.webContents\.send\('main-window:navigate'/);
  assert.ok(restore < show && show < focus && focus < send, 'restore, show, focus, then the message');
});

test('#263 the relay does nothing without a live main window', () => {
  const handler = relay();
  assert.match(handler, /if \(!win \|\| win\.isDestroyed\(\)\) return;/);
});

test('#263 the relay forwards the payload it got, an empty object when none', () => {
  const handler = relay();
  assert.match(handler, /send\('main-window:navigate', arg \|\| \{\}\)/);
});
