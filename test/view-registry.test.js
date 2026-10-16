// src/renderer/view-registry.js: a screen registers itself with registerView({ id, nav, markup,
// modals, mount, show }) instead of index.html listing its markup and nav entry (#78). It runs only
// inside the Electron renderer (document, window), so it is evaluated in a sandbox against a small
// DOM stub that implements just the calls registerView makes, the way test/renderer-sessions.test.js
// checks sessions.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'view-registry.js'), 'utf8');

/** The sidebar's menu (#411) and a content/body pair with just enough of the DOM API for registerView. */
function makeFakeDom({ navItems = [] } = {}) {
  const mainContent = { html: [], insertAdjacentHTML(_pos, markup) { this.html.push(markup); } };
  const body = { html: [], insertAdjacentHTML(_pos, markup) { this.html.push(markup); } };
  const sidebar = {
    children: navItems.map((it) => ({ className: '', dataset: {}, ...it })),
    querySelectorAll(sel) {
      if (sel !== '[data-order]') throw new Error(`unsupported selector: ${sel}`);
      return this.children.filter((c) => c.dataset.order !== undefined);
    },
    insertBefore(node, ref) {
      const idx = ref ? this.children.indexOf(ref) : this.children.length;
      this.children.splice(idx, 0, node);
      return node;
    },
  };
  const document = {
    querySelector(sel) {
      if (sel === 'main.content') return mainContent;
      if (sel === 'nav.sidebar .sidebar-menu') return sidebar;
      throw new Error(`unsupported selector: ${sel}`);
    },
    createElement(tag) { return { tagName: tag, className: '', dataset: {}, innerHTML: '' }; },
    body,
  };
  return { document, mainContent, body, sidebar };
}

/** Loads view-registry.js in a sandbox with the given fake DOM; returns window.registerView. */
function load(dom) {
  const sandbox = { document: dom.document };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.registerView;
}

// A sidebar entry as the real markup would leave it, identified by what distinguishes it in the test.
const idOf = (c) => c.dataset.view || c.dataset.order || c.className;

test('registerView: the markup goes into main.content and the modals into the body', () => {
  const dom = makeFakeDom();
  const registerView = load(dom);
  registerView({ id: 'x', markup: '<section id="view-x"></section>', modals: '<div id="x-modal"></div>' });
  assert.deepEqual(dom.mainContent.html, ['<section id="view-x"></section>']);
  assert.deepEqual(dom.body.html, ['<div id="x-modal"></div>']);
});

test('registerView: without markup or modals, neither main.content nor the body is touched', () => {
  const dom = makeFakeDom();
  const registerView = load(dom);
  registerView({ id: 'bare' });
  assert.deepEqual(dom.mainContent.html, []);
  assert.deepEqual(dom.body.html, []);
});

test('registerView: the nav button carries data-view, data-order and its icon/label, with no title by default', () => {
  const dom = makeFakeDom();
  const registerView = load(dom);
  registerView({ id: 'usage', nav: { label: 'Usage', order: 90, icon: '<svg></svg>' } });
  const btn = dom.sidebar.children[0];
  assert.equal(btn.className, 'nav-item');
  assert.equal(btn.dataset.view, 'usage');
  assert.equal(btn.dataset.order, '90');
  assert.equal(btn.title, undefined);
  assert.equal(btn.innerHTML, '<svg></svg><span>Usage</span>');
});

test('registerView: a nav title is set on the button when given', () => {
  const dom = makeFakeDom();
  const registerView = load(dom);
  registerView({ id: 'sessions', nav: { label: 'Sessions', order: 10, title: 'Claude Code, Codex and Grok sessions' } });
  assert.equal(dom.sidebar.children[0].title, 'Claude Code, Codex and Grok sessions');
});

test('registerView: the nav entry is placed before the first entry with a greater order (Usage between Skills and Analytics)', () => {
  const dom = makeFakeDom({ navItems: [
    { dataset: { order: '80' } }, // skills
    { dataset: { order: '100' } }, // analytics
  ] });
  const registerView = load(dom);
  registerView({ id: 'usage', nav: { label: 'Usage', order: 90 } });
  assert.deepEqual(dom.sidebar.children.map(idOf), ['80', 'usage', '100']);
});

test('registerView: with no entry of a greater order, the nav entry lands at the end of the menu (Settings after Analytics)', () => {
  const dom = makeFakeDom({ navItems: [
    { dataset: { order: '100' } }, // analytics
  ] });
  const registerView = load(dom);
  registerView({ id: 'settings', nav: { label: 'Settings', order: 110 } });
  assert.deepEqual(dom.sidebar.children.map(idOf), ['100', 'settings']);
});

test('registerView: without a nav entry, the sidebar is not touched', () => {
  const dom = makeFakeDom({ navItems: [{ dataset: { order: '100' } }] });
  const registerView = load(dom);
  registerView({ id: 'x', markup: '<section></section>' });
  assert.equal(dom.sidebar.children.length, 1);
});

test('registerView: mount runs exactly once, right after its own markup is already in place', () => {
  const dom = makeFakeDom();
  const registerView = load(dom);
  let calls = 0;
  let markupWhenMounted = null;
  registerView({
    id: 'x',
    markup: '<section id="view-x"></section>',
    mount() { calls += 1; markupWhenMounted = dom.mainContent.html.slice(); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(markupWhenMounted, ['<section id="view-x"></section>']);
});

test('registerView: a view with no mount does not throw', () => {
  const dom = makeFakeDom();
  const registerView = load(dom);
  assert.doesNotThrow(() => registerView({ id: 'x', markup: '<section></section>' }));
});
