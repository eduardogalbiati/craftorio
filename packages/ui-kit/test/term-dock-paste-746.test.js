// #746: pasting into a session's terminal (packages/ui-kit/term-dock.js). The keyboard shortcuts leave
// the browser's native paste event alone (no preventDefault), that event's clipboard text reaches the
// session without reading the clipboard api, a refused clipboard read (the context menu's fallback)
// says to use Ctrl+V in the interface language instead of the raw DOMException, and a read-only tab
// still refuses a paste. term-dock.js is a page script (globals, no exports): it runs in a vm sandbox
// over test/mini-dom.js's small DOM with the dock's markup, a fake xterm `Terminal` (the component's
// boundary: it records the key handler and turns paste(text) into onData(text), as xterm does) and a
// fake `api` (the clipboard and the engine's term:input). The seam is the page's openTerminal().
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const UI_KIT = path.join(__dirname, '..');
const DOCK_MARKUP = `<section id="term-dock" class="term-dock hidden"><div id="term-resize"></div><div class="term-bar">
  <div id="term-tabs"></div><span id="term-msg" class="muted small term-msg"></span>
  <button id="btn-term-popout"></button><button id="btn-term-collapse"></button></div>
  <div id="term-body" class="term-body"></div></section>`;

const tick = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// Loads term-dock.js (and app.js's esc / errMsg) into a fresh sandbox. Returns what a test drives and reads.
function loadDock({ platform = 'win32', clipboardRead } = {}) {
  const { createDom } = require('./mini-dom.js');
  const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
  const appSrc = fs.readFileSync(path.join(UI_KIT, 'app.js'), 'utf8');
  const dockSrc = fs.readFileSync(path.join(UI_KIT, 'term-dock.js'), 'utf8');
  const pick = (re, what) => { const m = re.exec(appSrc); assert.ok(m, `${what} not found in app.js: the source moved`); return m[0]; };
  const helpers = [
    pick(/const esc = \(s\) => [^\n]+;/, 'esc'),
    pick(/const NEEDS_RESTART = [^\n]+;/, 'NEEDS_RESTART'),
    pick(/const missingChannel = [^\n]+;/, 'missingChannel'),
    pick(/const errMsg = \(e\) => \{[\s\S]*?\n\};/, 'errMsg'),
  ].join('\n');

  const calls = { termInput: [], clipboardRead: 0, readText: 0 };
  const terms = [];
  class Terminal {
    constructor(options) { this.options = { ...options }; this.cols = 80; this.rows = 24; this._data = []; this._key = null; terms.push(this); }
    open(parent) {
      this.element = sandbox.document.createElement('div');
      this.element.className = 'xterm';
      this.textarea = sandbox.document.createElement('textarea');
      this.element.appendChild(this.textarea);
      parent.appendChild(this.element);
    }
    loadAddon() {}
    onData(fn) { this._data.push(fn); return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    attachCustomKeyEventHandler(fn) { this._key = fn; }
    paste(text) { for (const fn of this._data) fn(text); }
    hasSelection() { return false; }
    getSelection() { return ''; }
    clearSelection() {}
    focus() {}
    write() {}
    dispose() {}
  }

  const sandbox = {
    Terminal,
    FitAddon: { FitAddon: class { fit() {} } },
    state: {},
    localStorage: { getItem: () => null, setItem() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    setTimeout, clearTimeout, Date, Promise, console,
    navigator: { platform: '', clipboard: { readText: async () => { calls.readText++; return ''; } } },
    api: {
      platform,
      termOpen: async () => ({ id: 'pty-1' }),
      termInput: (id, data) => { calls.termInput.push([id, data]); },
      termResize() {},
      termKill: async () => {},
      clipboardWrite: async () => {},
      clipboardRead: async () => { calls.clipboardRead++; return clipboardRead ? clipboardRead() : ''; },
    },
  };
  sandbox.window = sandbox;
  const { document, classes } = createDom({ window: sandbox });
  sandbox.document = document;
  document.body.innerHTML = DOCK_MARKUP;
  sandbox.$ = (sel) => document.querySelector(sel);
  vm.createContext(withI18n(sandbox));
  vm.runInContext(`${helpers}\n${dockSrc}\nthis.openTerminal = openTerminal;`, sandbox);

  const Event = (type, init) => new classes.Event(type, init);
  return {
    open: (kind = 'cli') => sandbox.openTerminal({ kind, sessionId: 's1', runId: 'r1', label: 'Session' }),
    term: () => terms[terms.length - 1],
    // a keydown through xterm's custom key handler; returns how many times preventDefault was called
    key(init) {
      let prevented = 0;
      terms[terms.length - 1]._key({ type: 'keydown', key: 'v', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init, preventDefault: () => { prevented++; } });
      return prevented;
    },
    // the browser's native paste on the terminal's input element (bubbles through the terminal and its pane)
    paste(text) {
      const data = { getData: (type) => (type === 'text/plain' || type === 'text' ? text : '') };
      const ev = Event('paste', { bubbles: true, cancelable: true, clipboardData: data });
      terms[terms.length - 1].textarea.dispatchEvent(ev);
    },
    contextmenu() { terms[terms.length - 1].textarea.dispatchEvent(Event('contextmenu', { bubbles: true, cancelable: true, button: 2 })); },
    message: () => String(document.querySelector('#term-msg').textContent),
    calls,
  };
}

const notAllowed = () => { const e = new Error('Read permission denied'); e.name = 'NotAllowedError'; return e; };

// ---- the keyboard shortcuts leave the native paste event to the browser ------------------------------

test('#746: Ctrl+V in a terminal does not call preventDefault, so the browser fires its paste event', async () => {
  const dock = loadDock({ platform: 'win32' });
  await dock.open();
  assert.equal(dock.key({ key: 'v', ctrlKey: true }), 0);
});

test('#746: Cmd+V on a Mac does not call preventDefault, so the browser fires its paste event', async () => {
  const dock = loadDock({ platform: 'darwin' });
  await dock.open();
  assert.equal(dock.key({ key: 'v', metaKey: true }), 0);
});

test('#746: Shift+Insert in a terminal does not call preventDefault, so the browser fires its paste event', async () => {
  const dock = loadDock({ platform: 'win32' });
  await dock.open();
  assert.equal(dock.key({ key: 'Insert', shiftKey: true }), 0);
});

// ---- the native paste event pastes its own text ----------------------------------------------------

test('#746: a paste event carrying clipboard text sends that text to the session', async () => {
  const dock = loadDock();
  await dock.open();
  dock.paste('echo hi');
  await tick();
  assert.deepEqual(dock.calls.termInput.map(([id, d]) => `${id}|${d}`), ['pty-1|echo hi']);
});

test('#746: a paste event never reads the clipboard api (no clipboardRead, no navigator.clipboard.readText)', async () => {
  const dock = loadDock();
  await dock.open();
  dock.paste('echo hi');
  await tick();
  assert.equal(dock.calls.clipboardRead, 0);
  assert.equal(dock.calls.readText, 0);
});

test('#746: Ctrl+V followed by the browser\'s paste event sends the text once', async () => {
  const dock = loadDock({ platform: 'win32', clipboardRead: async () => 'echo hi' });
  await dock.open();
  dock.key({ key: 'v', ctrlKey: true });
  dock.paste('echo hi');
  await tick();
  assert.equal(dock.calls.termInput.length, 1);
  assert.equal(dock.calls.termInput[0][1], 'echo hi');
});

// ---- a refused clipboard read says to use Ctrl+V ---------------------------------------------------

test('#746: a refused clipboard read (context menu paste) shows "Use Ctrl+V to paste" in the session bar', async () => {
  const dock = loadDock({ clipboardRead: async () => { throw notAllowed(); } });
  await dock.open();
  dock.contextmenu();
  await tick();
  assert.match(dock.message(), /^Use Ctrl\+V to paste\.?$/);
});

test('#746: a refused clipboard read never shows the raw DOMException message', async () => {
  const dock = loadDock({ clipboardRead: async () => { throw notAllowed(); } });
  await dock.open();
  dock.contextmenu();
  await tick();
  assert.equal(dock.message().includes('Read permission denied'), false);
});

test('#746: in Portuguese a refused clipboard read shows "Use Ctrl+V para colar"', async () => {
  const I18n = require('@multiagent/shared/i18n.js');
  I18n.setLanguage('pt-BR');
  try {
    const dock = loadDock({ clipboardRead: async () => { throw notAllowed(); } });
    await dock.open();
    dock.contextmenu();
    await tick();
    assert.match(dock.message(), /^Use Ctrl\+V para colar\.?$/);
  } finally {
    I18n.setLanguage('en');
  }
});

test('#746: Ctrl+V right after a refused context-menu read still pastes the text', async () => {
  const dock = loadDock({ clipboardRead: async () => { throw notAllowed(); } });
  await dock.open();
  dock.contextmenu();
  await tick();
  dock.key({ key: 'v', ctrlKey: true });
  dock.paste('echo hi');
  await tick();
  assert.deepEqual(dock.calls.termInput.map(([id, d]) => `${id}|${d}`), ['pty-1|echo hi']);
});

test('#746: a context-menu paste followed at once by the native paste event sends the text once', async () => {
  const dock = loadDock({ clipboardRead: async () => 'echo hi' });
  await dock.open();
  dock.contextmenu();
  await tick();
  dock.paste('echo hi');
  await tick();
  assert.deepEqual(dock.calls.termInput.map(([, d]) => d), ['echo hi']);
});

// ---- a read-only tab still refuses a paste ---------------------------------------------------------

test('#746: a paste event on a read-only (live) tab sends nothing to the session', async () => {
  const dock = loadDock();
  await dock.open('live');
  dock.paste('echo hi');
  await tick();
  assert.equal(dock.calls.termInput.length, 0);
});

test('#746: a paste event on a read-only (live) tab says "This terminal is read-only."', async () => {
  const dock = loadDock();
  await dock.open('live');
  dock.paste('echo hi');
  await tick();
  assert.equal(dock.message(), 'This terminal is read-only.');
});
