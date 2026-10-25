// #263: the Agents window's owner in the main process, pure of Electron: src/host/agents-window.js
// createAgentsWindow({ BrowserWindow, statePath, dirname }) → { open({ agent }), current() }. A fake
// BrowserWindow stands in for the real one (like test/keep-awake.test.js's fake powerSaveBlocker).
// The window loads with the main window's preload (dirname/preload.js, contextIsolation, no
// nodeIntegration), says which agent to show, is one at a time (a second open focuses it), remembers
// its bounds and the last agent in the state file (a JSON file in the workspace), and survives a
// missing or corrupt state file. Acceptance tests, written before the code.
// #466 CONTRACT: after open(), the window's webContents prevents EVERY 'will-navigate' (a file: URL
// included) and every 'will-attach-webview' (src/host/window-guards.js guardWindow, or the same rule inline).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

// resolved inside each test: the module does not exist until the change lands
function create(opts) {
  const mod = require('../../src/host/agents-window.js');
  assert.equal(typeof mod.createAgentsWindow, 'function', 'src/host/agents-window.js exports createAgentsWindow (#263)');
  return mod.createAgentsWindow(opts);
}

/** A fake Electron: BrowserWindow records its options, loads and listeners; a test emits its events. */
function fakeElectron() {
  const windows = [];
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.listeners = {};
      this.loads = [];
      this.focused = 0;
      this.shown = 0;
      this.destroyed = false;
      this.bounds = { x: 10, y: 10, width: 800, height: 600 };
      // #466: webContents records its listeners so a test can emit will-navigate / will-attach-webview
      const wcListeners = {};
      this.webContents = {
        listeners: wcListeners,
        send() {},
        on(event, fn) { (wcListeners[event] ||= []).push(fn); return this; },
        once(event, fn) { return this.on(event, fn); },
        emit(event, ...args) { for (const fn of [...(wcListeners[event] || [])]) fn(...args); },
        setWindowOpenHandler(fn) { this.openHandler = fn; },
        openDevTools() {},
      };
      windows.push(this);
    }
    loadFile(file, opts) { this.loads.push([file, opts]); return Promise.resolve(); }
    loadURL(url, opts) { this.loads.push([url, opts]); return Promise.resolve(); }
    on(event, fn) { (this.listeners[event] ||= []).push(fn); return this; }
    once(event, fn) { return this.on(event, fn); }
    emit(event, ...args) { for (const fn of [...(this.listeners[event] || [])]) fn({ preventDefault() {} }, ...args); if (event === 'closed') this.destroyed = true; }
    focus() { this.focused++; }
    show() { this.shown++; }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    restore() {}
    getBounds() { return this.bounds; }
    setMenuBarVisibility() {}
    removeMenu() {}
  }
  return { BrowserWindow, windows };
}

function statePathIn(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-window-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'agents-window.json');
}

test('#263 open({ agent }) creates one window with the main window\'s preload and isolation, loading the page for that agent', (t) => {
  const { BrowserWindow, windows } = fakeElectron();
  const aw = create({ BrowserWindow, statePath: statePathIn(t), dirname: SRC });
  aw.open({ agent: 'oracle' });
  assert.equal(windows.length, 1);
  const w = windows[0];
  assert.equal(w.options.webPreferences.preload, path.join(SRC, 'preload.js'));
  assert.ok(String(w.options.webPreferences.preload).endsWith('preload.js'));
  assert.equal(w.options.webPreferences.contextIsolation, true);
  assert.equal(w.options.webPreferences.nodeIntegration, false);
  assert.ok(w.loads.length >= 1, 'the window loaded a page');
  assert.ok(JSON.stringify(w.loads).includes('oracle'), `the load names the agent: ${JSON.stringify(w.loads)}`);
});

test('#263 a second open() while the window lives focuses it instead of creating another; after "closed" a new one is created', (t) => {
  const { BrowserWindow, windows } = fakeElectron();
  const aw = create({ BrowserWindow, statePath: statePathIn(t), dirname: SRC });
  aw.open({ agent: 'oracle' });
  aw.open({ agent: 'supervisor' });
  assert.equal(windows.length, 1, 'still one window');
  assert.ok(windows[0].focused >= 1, 'the existing window was focused');
  windows[0].emit('close');
  windows[0].emit('closed');
  aw.open({ agent: 'oracle' });
  assert.equal(windows.length, 2, 'a new window after the first closed');
});

test('#263 current() is the live window and null once it closed', (t) => {
  const { BrowserWindow, windows } = fakeElectron();
  const aw = create({ BrowserWindow, statePath: statePathIn(t), dirname: SRC });
  assert.equal(aw.current(), null, 'nothing open yet');
  aw.open({ agent: 'oracle' });
  assert.equal(aw.current() === windows[0], true);
  windows[0].emit('close');
  windows[0].emit('closed');
  assert.equal(aw.current(), null);
});

test('#263 the bounds at close are remembered in the state file and reused by the next instance (a second monitor)', (t) => {
  const statePath = statePathIn(t);
  const first = fakeElectron();
  const aw1 = create({ BrowserWindow: first.BrowserWindow, statePath, dirname: SRC });
  aw1.open({ agent: 'oracle' });
  first.windows[0].bounds = { x: 2000, y: 100, width: 900, height: 700 };
  first.windows[0].emit('close');
  first.windows[0].emit('closed');

  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const bounds = saved.bounds || saved;
  assert.equal(bounds.x, 2000);
  assert.equal(bounds.y, 100);
  assert.equal(bounds.width, 900);
  assert.equal(bounds.height, 700);

  const second = fakeElectron();
  const aw2 = create({ BrowserWindow: second.BrowserWindow, statePath, dirname: SRC });
  aw2.open({ agent: 'oracle' });
  const o = second.windows[0].options;
  assert.equal(o.x, 2000);
  assert.equal(o.y, 100);
  assert.equal(o.width, 900);
  assert.equal(o.height, 700);
});

test('#263 the last agent shown is remembered: open() without an agent loads it in the next instance', (t) => {
  const statePath = statePathIn(t);
  const first = fakeElectron();
  const aw1 = create({ BrowserWindow: first.BrowserWindow, statePath, dirname: SRC });
  aw1.open({ agent: 'product-owner' });
  first.windows[0].emit('close');
  first.windows[0].emit('closed');

  const second = fakeElectron();
  const aw2 = create({ BrowserWindow: second.BrowserWindow, statePath, dirname: SRC });
  aw2.open();
  assert.equal(second.windows.length, 1);
  assert.ok(JSON.stringify(second.windows[0].loads).includes('product-owner'), `the load names the remembered agent: ${JSON.stringify(second.windows[0].loads)}`);
});

test('#263 a missing state file: open() works with default sizes and no position', (t) => {
  const { BrowserWindow, windows } = fakeElectron();
  const aw = create({ BrowserWindow, statePath: statePathIn(t), dirname: SRC });
  aw.open({ agent: 'oracle' });
  const o = windows[0].options;
  assert.ok(Number(o.width) > 0, `a default width: ${o.width}`);
  assert.ok(Number(o.height) > 0, `a default height: ${o.height}`);
  assert.equal('x' in o, false, 'no x: the OS places the window');
  assert.equal('y' in o, false, 'no y');
});

// #466 the Agents window never navigates away from the app's page, not even to a file: page (a
// sanitizer bypass, a dropped file), and never attaches a webview. No http URL here: the module
// requires electron's shell lazily for those.
const fakeEvent = () => ({ prevented: false, preventDefault() { this.prevented = true; } });

test('#466 the Agents window prevents will-navigate to a file: URL', (t) => {
  const { BrowserWindow, windows } = fakeElectron();
  const aw = create({ BrowserWindow, statePath: statePathIn(t), dirname: SRC });
  aw.open({ agent: 'oracle' });
  const ev = fakeEvent();
  windows[0].webContents.emit('will-navigate', ev, 'file:///C:/tmp/x.html');
  assert.equal(ev.prevented, true);
});

test('#466 the Agents window prevents will-attach-webview', (t) => {
  const { BrowserWindow, windows } = fakeElectron();
  const aw = create({ BrowserWindow, statePath: statePathIn(t), dirname: SRC });
  aw.open({ agent: 'oracle' });
  const ev = fakeEvent();
  windows[0].webContents.emit('will-attach-webview', ev, {}, {});
  assert.equal(ev.prevented, true);
});

test('#263 a corrupt state file does not throw: open() works with default sizes and no position', (t) => {
  const statePath = statePathIn(t);
  fs.writeFileSync(statePath, '{ not json');
  const { BrowserWindow, windows } = fakeElectron();
  const aw = create({ BrowserWindow, statePath, dirname: SRC });
  aw.open({ agent: 'oracle' });
  const o = windows[0].options;
  assert.ok(Number(o.width) > 0, `a default width: ${o.width}`);
  assert.ok(Number(o.height) > 0, `a default height: ${o.height}`);
  assert.equal('x' in o, false, 'no x');
  assert.equal('y' in o, false, 'no y');
});
