// src/renderer/artifact-menu.js (#114): the right-click copy menu shared by the Artifacts screen, the
// Run Details Artifacts tab and a gate's panel. It runs only inside the Electron renderer (document,
// window, api), so it is evaluated whole in a sandbox with a minimal real DOM (a class hierarchy good
// enough for createElement/appendChild/addEventListener/classList, not a full parser), the way
// test/artifacts-panel.test.js checks its own module as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'artifact-menu.js'), 'utf8');

// Element: so `e.target instanceof Element` resolves the way it does in a browser.
class Element {}
class FakeElement extends Element {
  constructor(tag) {
    super();
    this.tagName = tag;
    this._class = new Set();
    this.dataset = {};
    this.style = {};
    this._html = '';
    this.parent = null;
    this.listeners = {};
    this.isConnected = true;
    this.focused = false;
  }
  set className(v) { this._class = new Set(String(v).split(' ').filter(Boolean)); }
  get className() { return [...this._class].join(' '); }
  get classList() { return { add: (c) => this._class.add(c), contains: (c) => this._class.has(c) }; }
  setAttribute() {}
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
  appendChild(el) { (this.children ||= []).push(el); el.parent = this; return el; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  contains(el) { let cur = el; while (cur) { if (cur === this) return true; cur = cur.parent; } return false; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  // fixed and good enough for the clamp-to-viewport math in open()
  getBoundingClientRect() { return { left: 10, top: 10, width: 100, height: 20 }; }
  focus() { this.focused = true; }
  querySelector(sel) { return sel === '.ctx-item' && /ctx-item/.test(this._html) ? { focus() {} } : null; }
  querySelectorAll(sel) { return sel === '.ctx-item' ? [...this._html.matchAll(/data-ctx="(\d+)"/g)].map(() => ({ focus() {} })) : []; }
}

function load(opts = {}) {
  const toasts = [];
  const bodyListeners = {};
  const winListeners = {};
  const body = new FakeElement('body');
  body.children = [];
  const document = {
    createElement: (tag) => new FakeElement(tag),
    body,
    addEventListener: (type, fn) => { (bodyListeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { bodyListeners[type] = (bodyListeners[type] || []).filter((f) => f !== fn); },
  };
  const window = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener: (type, fn) => { (winListeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { winListeners[type] = (winListeners[type] || []).filter((f) => f !== fn); },
  };
  const sandbox = {
    Element,
    document,
    window,
    esc: (s) => (s == null ? '' : String(s)),
    errMsg: (e) => String(e?.message || e),
    showToast: (...a) => toasts.push(a),
    api: {
      platform: opts.platform || 'win32',
      clipboardWriteImage: opts.clipboardWriteImage || (async () => true),
      clipboardWriteFile: opts.clipboardWriteFile || (async () => true),
      clipboardWrite: opts.clipboardWrite || (async () => true),
      readArtifact: opts.readArtifact || (async () => ({ text: '' })),
    },
    setTimeout, clearTimeout,
  };
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { ArtifactMenu: window.ArtifactMenu, toasts, document, docListeners: bodyListeners, winListeners };
}

const ev = (over = {}) => ({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0, target: null, currentTarget: null, ...over });
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------------------------
// copyContent: what is copied, by kind (#114) — no DOM involved.

test('copyContent: an image file copies the image itself (clipboard.writeImage)', async () => {
  const calls = [];
  const { ArtifactMenu } = load({ clipboardWriteImage: async (p) => { calls.push(p); return true; } });
  const detail = await ArtifactMenu.copyContent({ path: '/r/shot.png', name: 'shot.png', kind: 'image' });
  assert.deepEqual(calls, ['/r/shot.png']);
  assert.equal(detail, 'The image shot.png.');
});

test('copyContent: a file whose content turns out to be an image (readArtifact returns one) copies it as an image too', async () => {
  const calls = [];
  const { ArtifactMenu } = load({
    readArtifact: async () => ({ image: 'data:image/png;base64,...' }),
    clipboardWriteImage: async (p) => { calls.push(p); },
  });
  const detail = await ArtifactMenu.copyContent({ path: '/r/weird.bin', name: 'weird.bin', kind: 'other' });
  assert.deepEqual(calls, ['/r/weird.bin']);
  assert.match(detail, /weird\.bin/);
});

test('copyContent: a text file copies its content as text, noting when it was truncated', async () => {
  const calls = [];
  const { ArtifactMenu } = load({ readArtifact: async () => ({ text: 'hello', truncated: false }), clipboardWrite: async (t) => { calls.push(t); } });
  const detail = await ArtifactMenu.copyContent({ path: '/r/notes.md', name: 'notes.md', kind: 'markdown' });
  assert.deepEqual(calls, ['hello']);
  assert.equal(detail, 'The text of notes.md.');

  const { ArtifactMenu: menu2 } = load({ readArtifact: async () => ({ text: 'x', truncated: true }) });
  assert.match(await menu2.copyContent({ path: '/r/big.log', name: 'big.log', kind: 'text' }), /first 5 MB/);
});

test('copyContent: a binary file copies the file itself on desktop; the browser UI has no way to and refuses instead of failing silently', async () => {
  const calls = [];
  const { ArtifactMenu } = load({ platform: 'win32', readArtifact: async () => ({ binary: true }), clipboardWriteFile: async (p) => { calls.push(p); } });
  const detail = await ArtifactMenu.copyContent({ path: '/r/app.zip', name: 'app.zip', kind: 'other' });
  assert.deepEqual(calls, ['/r/app.zip']);
  assert.match(detail, /not text/);

  const { ArtifactMenu: browserMenu } = load({ platform: 'browser', readArtifact: async () => ({ binary: true }) });
  await assert.rejects(browserMenu.copyContent({ path: '/r/app.zip', name: 'app.zip', kind: 'other' }), /is not a text file/);
});

// ---------------------------------------------------------------------------------------------
// open(): the menu's items by target kind, and acting on one (#114).

test('open: a file offers Copy to clipboard, Copy file (desktop) and Copy path; the browser UI has no Copy file', () => {
  const { ArtifactMenu, document } = load({ platform: 'win32' });
  ArtifactMenu.open(ev({ target: new FakeElement('button'), currentTarget: new FakeElement('button') }), { path: '/r/notes.md', name: 'notes.md', kind: 'markdown' });
  const desktopMenu = document.body.children[0];
  assert.match(desktopMenu.innerHTML, /Copy to clipboard/);
  assert.match(desktopMenu.innerHTML, /Copy file/);
  assert.match(desktopMenu.innerHTML, /Copy path/);

  const { ArtifactMenu: browserMenu, document: browserDoc } = load({ platform: 'browser' });
  browserMenu.open(ev({ target: new FakeElement('button'), currentTarget: new FakeElement('button') }), { path: '/r/notes.md', name: 'notes.md', kind: 'markdown' });
  const browserMenuEl = browserDoc.body.children[0];
  assert.match(browserMenuEl.innerHTML, /Copy to clipboard/);
  assert.doesNotMatch(browserMenuEl.innerHTML, /Copy file/);
  assert.match(browserMenuEl.innerHTML, /Copy path/);
});

test('open: an open image offers only Copy image and Copy path, never a file\'s actions', () => {
  const { ArtifactMenu, document } = load();
  ArtifactMenu.open(ev({ target: new FakeElement('img'), currentTarget: new FakeElement('img') }), { path: '/r/shot.png', image: true });
  const menu = document.body.children[0];
  assert.match(menu.innerHTML, /Copy image/);
  assert.match(menu.innerHTML, /Copy path/);
  assert.doesNotMatch(menu.innerHTML, /Copy to clipboard|Copy file/);
});

test('open: clicking Copy image copies it and shows a "Copied" toast', async () => {
  const calls = [];
  const { ArtifactMenu, document, toasts } = load({ clipboardWriteImage: async (p) => { calls.push(p); } });
  ArtifactMenu.open(ev({ target: new FakeElement('img'), currentTarget: new FakeElement('img') }), { path: '/r/shot.png', image: true });
  const menu = document.body.children[0];
  menu.listeners.click[0]({ target: { closest: (sel) => (sel === '[data-ctx]' ? { dataset: { ctx: '0' } } : null) } });
  await tick();
  assert.deepEqual(calls, ['/r/shot.png']);
  assert.equal(toasts[0]?.[0], 'Copied');
});

test('open: clicking Copy path copies the path itself, through the plain clipboard write', async () => {
  const calls = [];
  const { ArtifactMenu, document } = load({ clipboardWrite: async (t) => { calls.push(t); } });
  ArtifactMenu.open(ev({ target: new FakeElement('button'), currentTarget: new FakeElement('button') }), { path: '/r/notes.md', name: 'notes.md', kind: 'markdown' });
  const menu = document.body.children[0];
  // items: 0 Copy to clipboard, 1 Copy file, 2 Copy path (desktop, default platform win32)
  menu.listeners.click[0]({ target: { closest: (sel) => (sel === '[data-ctx]' ? { dataset: { ctx: '2' } } : null) } });
  await tick();
  assert.deepEqual(calls, ['/r/notes.md']);
});

test('open: a copy refused outside the workspace (the main process\'s own check) shows the error as a toast instead of failing silently', async () => {
  const { ArtifactMenu, document, toasts } = load({
    clipboardWriteImage: async () => { throw new Error("Outside the workspace and the project's folder: /etc/passwd.png"); },
  });
  ArtifactMenu.open(ev({ target: new FakeElement('img'), currentTarget: new FakeElement('img') }), { path: '/etc/passwd.png', image: true });
  const menu = document.body.children[0];
  menu.listeners.click[0]({ target: { closest: () => ({ dataset: { ctx: '0' } }) } });
  await tick();
  assert.equal(toasts[0]?.[0], 'Could not copy');
  assert.match(toasts[0]?.[1], /Outside the workspace/);
});

test('open: Escape closes the menu and refocuses the element that opened it', () => {
  const { ArtifactMenu, document } = load();
  const opener = new FakeElement('button');
  ArtifactMenu.open(ev({ target: opener, currentTarget: opener }), { path: '/r/a.md', name: 'a.md', kind: 'markdown' });
  const menu = document.body.children[0];
  menu.listeners.keydown[0]({ key: 'Escape', preventDefault() {} });
  assert.equal(document.body.children.length, 0, 'the menu was removed');
  assert.equal(opener.focused, true);
});

test('open: a keyboard-triggered contextmenu (no pointer position, e.g. Shift+F10) opens under the focused element instead of at (0,0)', () => {
  const { ArtifactMenu, document } = load();
  const btn = new FakeElement('button'); // getBoundingClientRect: { left: 10, top: 10, width: 100, height: 20 }
  ArtifactMenu.open(ev({ clientX: 0, clientY: 0, target: btn, currentTarget: btn }), { path: '/r/a.md', name: 'a.md', kind: 'markdown' });
  const menu = document.body.children[0];
  assert.equal(menu.style.left, '22px'); // rect.left (10) + 12
  assert.equal(menu.style.top, '30px'); // rect.top (10) + min(rect.height (20), 28)
});

test('open: a second right-click replaces the previous menu instead of stacking another one', () => {
  const { ArtifactMenu, document } = load();
  ArtifactMenu.open(ev({ target: new FakeElement('button'), currentTarget: new FakeElement('button') }), { path: '/r/a.md', name: 'a.md', kind: 'markdown' });
  const first = document.body.children[0];
  ArtifactMenu.open(ev({ target: new FakeElement('img'), currentTarget: new FakeElement('img') }), { path: '/r/b.png', image: true });
  assert.equal(document.body.children.length, 1, 'the first menu was removed, not stacked');
  assert.notEqual(document.body.children[0], first);
  assert.match(document.body.children[0].innerHTML, /Copy image/, 'the new menu, for the new target');
});
