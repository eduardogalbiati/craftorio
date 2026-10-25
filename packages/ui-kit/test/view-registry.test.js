// packages/ui-kit/view-registry.js: a screen registers itself with registerView({ id, nav, markup,
// modals, mount, show }) instead of index.html listing its markup and nav entry (#78). It runs only
// inside the Electron renderer (document, window), so it is evaluated in a sandbox against a small
// DOM stub that implements just the calls registerView makes, the way test/renderer-sessions.test.js
// checks sessions.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'view-registry.js'), 'utf8');

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

// #329 the interface language: screens whose markup is a function are drawn again (redrawMarkup),
// and the menu's texts come from the catalog by key (relabelNav). A DOM stub with sections that can be
// replaced in place, and nav buttons with a label span.
function makeLanguageDom() {
  const sections = []; // { id, hidden, html, removed }
  const sectionOf = (html) => {
    const id = (html.match(/id="([^"]+)"/) || [])[1];
    const cls = (html.match(/class="([^"]*)"/) || [])[1] || '';
    const el = {
      id,
      html,
      hidden: cls.split(/\s+/).includes('hidden'),
      classList: {
        contains: (c) => c === 'hidden' && el.hidden,
        toggle: (c, on) => { if (c === 'hidden') el.hidden = on === undefined ? !el.hidden : Boolean(on); },
      },
      insertAdjacentHTML(_pos, markup) { sections.splice(sections.indexOf(el) + 1, 0, sectionOf(markup)); },
      remove() { sections.splice(sections.indexOf(el), 1); },
    };
    return el;
  };
  const buttons = [];
  const menu = {
    querySelectorAll: () => [],
    insertBefore(node) { buttons.push(node); return node; },
  };
  const document = {
    querySelector(sel) {
      if (sel === 'main.content') return { insertAdjacentHTML: (_pos, markup) => sections.push(sectionOf(markup)) };
      if (sel === 'nav.sidebar .sidebar-menu') return menu;
      if (sel.startsWith('.nav-group')) return null;
      throw new Error(`unsupported selector: ${sel}`);
    },
    querySelectorAll(sel) {
      if (sel === '.nav-item[data-view]') return buttons;
      throw new Error(`unsupported selector: ${sel}`);
    },
    getElementById: (id) => sections.find((s) => s.id === id) || null,
    createElement(tag) {
      const span = { innerHTML: '' };
      const btn = {
        tagName: tag, className: '', dataset: {}, _innerHTML: '',
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) { this._innerHTML = v; span.innerHTML = (v.match(/<span>(.*)<\/span>/) || [])[1] || ''; },
        querySelector: () => span,
        span,
      };
      return btn;
    },
    body: { insertAdjacentHTML() {} },
  };
  return { document, sections, buttons };
}

function loadWithLanguage(dom, catalog) {
  const sandbox = {
    document: dom.document,
    I18n: { t: (key) => catalog.current[key] ?? key },
    NavGroups: { GROUPS: [] },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

test('#329 redrawMarkup: a screen whose markup is a function is drawn again in the new text, mounted again, and shown when it was showing', () => {
  const dom = makeLanguageDom();
  const catalog = { current: { title: 'General' } };
  const w = loadWithLanguage(dom, catalog);
  const calls = { mount: 0, show: 0 };
  w.registerView({
    id: 'settings',
    markup: () => `<section id="view-settings" class="view hidden"><h1>${catalog.current.title}</h1></section>`,
    mount() { calls.mount += 1; },
    show() { calls.show += 1; },
  });
  dom.document.getElementById('view-settings').classList.toggle('hidden', false); // showView opened it
  catalog.current = { title: 'Geral' };
  w.ViewRegistry.redrawMarkup();
  const el = dom.document.getElementById('view-settings');
  assert.equal(dom.sections.filter((s) => s.id === 'view-settings').length, 1, 'the old section is replaced, not duplicated');
  assert.equal(el.html.includes('<h1>Geral</h1>'), true);
  assert.equal(el.hidden, false, 'it still shows');
  assert.deepEqual(calls, { mount: 2, show: 1 });
});

test('#329 redrawMarkup: a hidden screen stays hidden and is not shown; a screen with fixed markup is left alone', () => {
  const dom = makeLanguageDom();
  const catalog = { current: { title: 'Agents' } };
  const w = loadWithLanguage(dom, catalog);
  const calls = { hiddenMount: 0, hiddenShow: 0, fixedMount: 0 };
  w.registerView({
    id: 'agents',
    markup: () => `<section id="view-agents" class="view hidden">${catalog.current.title}</section>`,
    mount() { calls.hiddenMount += 1; },
    show() { calls.hiddenShow += 1; },
  });
  w.registerView({ id: 'fixed', markup: '<section id="view-fixed" class="view hidden">Fixed</section>', mount() { calls.fixedMount += 1; } });
  catalog.current = { title: 'Agentes' };
  w.ViewRegistry.redrawMarkup();
  const agents = dom.document.getElementById('view-agents');
  assert.equal(agents.html.includes('Agentes'), true);
  assert.equal(agents.hidden, true);
  assert.equal(dom.document.getElementById('view-fixed').html.includes('Fixed'), true);
  assert.deepEqual(calls, { hiddenMount: 2, hiddenShow: 0, fixedMount: 1 });
});

test('#329 the menu label comes from the catalog key nav.<id>, else the entry\'s own text; relabelNav repaints it', () => {
  const dom = makeLanguageDom();
  const catalog = { current: { 'nav.settings': 'Settings' } };
  const w = loadWithLanguage(dom, catalog);
  w.registerView({ id: 'settings', nav: { label: 'Settings', order: 110 } });
  w.registerView({ id: 'usage', nav: { label: 'Usage', order: 90 } });
  const label = (id) => dom.buttons.find((b) => b.dataset.view === id).span.innerHTML;
  assert.equal(label('settings'), 'Settings');
  catalog.current = { 'nav.settings': 'Configurações' };
  w.ViewRegistry.relabelNav();
  assert.equal(label('settings'), 'Configurações');
  assert.equal(label('usage'), 'Usage', 'a view without a catalog key keeps its English label');
});

// Phase 3 of the reorganisation study (#579): Home is the UI kit's and Analytics the analyser front's, so
// Home registers first and draws an empty `#view-analytics` placeholder; the panel registered later
// takes the placeholder's place.
test('a `panel` with a `section` registered after its section drew an empty placeholder replaces the placeholder', () => {
  const dom = makeFakeDom();
  const placeholder = { children: [], drawn: [], removed: false, insertAdjacentHTML(_pos, markup) { this.drawn.push(markup); }, remove() { this.removed = true; } };
  dom.document.getElementById = (id) => (id === 'view-analytics' ? placeholder : null);
  const registerView = load(dom);
  registerView({ id: 'analytics', section: 'dashboard', menu: 'dashboard', panel: () => '<div id="view-analytics" class="hidden">panel</div>' });
  assert.deepEqual(placeholder.drawn, ['<div id="view-analytics" class="hidden">panel</div>']);
  assert.equal(placeholder.removed, true);
  assert.deepEqual(dom.mainContent.html, [], 'a panel is never added to the content as a section of its own');
});

test('a `panel` whose section already holds it (the placeholder has children) is left alone', () => {
  const dom = makeFakeDom();
  const drawn = { children: [{}], drawn: [], removed: false, insertAdjacentHTML(_pos, markup) { this.drawn.push(markup); }, remove() { this.removed = true; } };
  dom.document.getElementById = () => drawn;
  const registerView = load(dom);
  registerView({ id: 'analytics', section: 'dashboard', panel: () => '<div id="view-analytics"></div>' });
  assert.deepEqual(drawn.drawn, []);
  assert.equal(drawn.removed, false);
});
