// #330 a live language switch (Settings › Language › Interface, InterfaceLanguage.apply) puts the open
// screens in the new language without a reload: packages/ui-kit/view-registry.js repaints a view's markup
// and a markup a mount drew elsewhere (ViewRegistry.draw: the Oracle dock on Home) in place, so mount()
// does not run again (its listeners and timers are not registered twice) and what the screen drew since
// stays. view-registry.js and interface-language.js run in a sandbox over a small DOM that parses the
// markup and walks it (the page harness, test/renderer-app-harness.js, has no tree walker); the labels
// are the Backlog's tabs and the Oracle dock's, read from the catalog (packages/shared/i18n.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pageDirs, pageFile, pageFiles } = require('../../../scripts/source-tree');
const PAGE_ROOT = path.join(__dirname, '..', '..', '..');
// a page file by its page-relative name, wherever its layer is (phase 3 of the reorganisation study)
const page = (rel) => pageFile(PAGE_ROOT, rel);
void pageDirs; void pageFiles; void page;
const vm = require('vm');
const I18n = require('@multiagent/shared/i18n.js');

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);

// ---- a small DOM: elements and text nodes, parsed from markup, walked in document order -----------
class Text {
  constructor(value) { Object.assign(this, { nodeType: 3, nodeName: '#text', nodeValue: value, parentNode: null }); }
  get isConnected() { return connected(this); }
  get nextSibling() { return sibling(this, 1); }
}

class Element {
  constructor(tag, attrs = {}) {
    Object.assign(this, { nodeType: 1, nodeName: tag.toUpperCase(), attrs: { ...attrs }, childNodes: [], parentNode: null, root: false, listeners: 0 });
    this.classList = {
      contains: (c) => this.classes().includes(c),
      toggle: (c, on) => {
        const set = new Set(this.classes());
        if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c);
        this.attrs.class = [...set].join(' ');
      },
    };
  }

  classes() { return String(this.attrs.class || '').split(/\s+/).filter(Boolean); }
  get id() { return this.attrs.id || ''; }
  get isConnected() { return connected(this); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() { return sibling(this, 1); }
  get textContent() { return this.childNodes.map((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent)).join(''); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() { this.listeners += 1; }
  append(...nodes) { for (const n of nodes) { n.parentNode = this; this.childNodes.push(n); } }
  remove() { const p = this.parentNode; if (p) p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentNode = null; }
  insertAdjacentHTML(pos, html) {
    const nodes = parse(html);
    if (pos === 'beforeend') this.append(...nodes);
    else if (pos === 'afterend') {
      const p = this.parentNode;
      p.childNodes.splice(p.childNodes.indexOf(this) + 1, 0, ...nodes);
      for (const n of nodes) n.parentNode = p;
    } else throw new Error(`unsupported position ${pos}`);
  }

  set innerHTML(html) { this.childNodes = []; this.content = { childNodes: parse(html) }; }
  descendants() { return this.childNodes.flatMap((n) => (n.nodeType === 1 ? [n, ...n.descendants()] : [n])); }
}

function connected(node) {
  let n = node;
  while (n.parentNode) n = n.parentNode;
  return n.root === true;
}
function sibling(node, step) {
  const list = node.parentNode?.childNodes || [];
  return list[list.indexOf(node) + step] || null;
}

function parse(html) {
  const top = new Element('fragment');
  const stack = [top];
  for (const m of String(html).matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g)) {
    const parent = stack[stack.length - 1];
    if (m[4] !== undefined) { if (m[4].trim()) parent.append(new Text(m[4].trim())); continue; }
    if (m[1]) { stack.pop(); continue; }
    const attrs = Object.fromEntries([...m[3].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const el = new Element(m[2], attrs);
    parent.append(el);
    if (!VOID.has(m[2].toLowerCase()) && !m[3].endsWith('/')) stack.push(el);
  }
  const nodes = top.childNodes.slice();
  for (const n of nodes) n.parentNode = null;
  return nodes;
}

function makeDocument() {
  const html = new Element('html');
  html.root = true;
  const body = new Element('body');
  const main = new Element('main', { class: 'content' });
  const dash = new Element('div', { id: 'dash' });
  html.append(body);
  body.append(main, dash);
  const all = () => [html, ...html.descendants()].filter((n) => n.nodeType === 1);
  return {
    documentElement: html,
    body,
    main,
    dash,
    getElementById: (id) => all().find((e) => e.id === id) || null,
    querySelector(sel) {
      if (sel === 'main.content') return main;
      const m = /^#([\w-]+)$/.exec(sel);
      if (m) return all().find((e) => e.id === m[1]) || null;
      throw new Error(`unsupported selector: ${sel}`);
    },
    querySelectorAll: () => [],
    createElement: (tag) => new Element(tag),
    createTreeWalker(root) {
      const list = root.nodeType === 1 ? root.descendants() : [];
      let i = 0;
      return { nextNode: () => list[i++] || null };
    },
  };
}

/** view-registry.js and interface-language.js loaded over the small DOM, in English. */
function loadPage() {
  I18n.setLanguage('en');
  const document = makeDocument();
  const store = new Map();
  const sandbox = {
    document,
    I18n,
    t: I18n.t,
    NavGroups: { GROUPS: [] },
    navigator: { language: 'en-US' },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    api: {},
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['view-registry.js', 'interface-language.js']) {
    vm.runInContext(fs.readFileSync(page(file), 'utf8'), sandbox, { filename: file });
  }
  sandbox.InterfaceLanguage.apply({ language: { interface: 'en' } });
  return { sandbox, document };
}

const pt = (key) => I18n.t(key, null, 'pt-BR');

/** A screen built like the Backlog: tabs from the catalog, a list its show() fills, a click listener set by mount(). */
function registerBacklogLike(sandbox, document, calls) {
  const { t } = I18n;
  sandbox.registerView({
    id: 'backlog',
    markup: () => `<section id="view-backlog" class="view hidden"><div id="bl-tabs" class="tabs">`
      + `<button id="tab-board" title="${t('backlog.the_issues_as_a_list_or')}">${t('backlog.board')}</button>`
      + `<button id="tab-epics">${t('backlog.epics')}</button></div>`
      + `<span id="bl-mode"><button id="mode-list">${t('backlog.list')}</button></span><ul id="bl-list"></ul></section>`,
    mount() {
      calls.mount += 1;
      document.getElementById('tab-board').addEventListener('click', () => {});
    },
    show() {
      calls.show += 1;
      const list = document.getElementById('bl-list');
      if (!list.childNodes.length) list.insertAdjacentHTML('beforeend', '<li>Issue 1</li>');
    },
  });
}

test('#330 a live switch to pt-BR repaints the Backlog\'s tabs in place: mount() runs once, its listener is not added twice', (t) => {
  t.after(() => I18n.setLanguage('en'));
  const { sandbox, document } = loadPage();
  const calls = { mount: 0, show: 0 };
  registerBacklogLike(sandbox, document, calls);
  document.getElementById('view-backlog').classList.toggle('hidden', false); // showView opened it
  const board = document.getElementById('tab-board');
  assert.equal(board.textContent, 'Board');
  assert.equal(document.getElementById('mode-list').textContent, 'List');

  sandbox.InterfaceLanguage.apply({ language: { interface: 'pt-BR' } });

  assert.equal(I18n.getLanguage(), 'pt-BR');
  assert.equal(document.documentElement.lang, 'pt-BR');
  assert.equal(document.getElementById('tab-board') === board, true, 'the same node, repainted, not drawn again');
  assert.equal(board.textContent, pt('backlog.board'));
  assert.notEqual(board.textContent, 'Board');
  assert.equal(board.getAttribute('title'), pt('backlog.the_issues_as_a_list_or'));
  assert.equal(document.getElementById('mode-list').textContent, pt('backlog.list'));
  assert.equal(document.getElementById('tab-epics').textContent, pt('backlog.epics'));
  assert.deepEqual(calls, { mount: 1, show: 1 }, 'not mounted again; shown again since it was showing');
  assert.equal(board.listeners, 1, 'the click listener mount() set is not registered twice');
  assert.equal(document.getElementById('bl-list').textContent, 'Issue 1', 'what show() drew stays');
});

test('#330 a live switch repaints a markup a mount drew elsewhere with ViewRegistry.draw (the Oracle dock on Home)', (t) => {
  t.after(() => I18n.setLanguage('en'));
  const { sandbox, document } = loadPage();
  const { t: tr } = I18n;
  let mounts = 0;
  sandbox.registerView({
    id: 'oracle',
    mount() {
      mounts += 1;
      sandbox.ViewRegistry.draw(document.dash, () => `<aside id="oracle-dock" aria-label="${tr('oracle.oracle_2')}">`
        + `<button id="oracle-memory" title="${tr('oracle.the_owner_s_standing_decisions_read')}">${tr('oracle.memory')}</button>`
        + `<textarea id="oracle-input" placeholder="${tr('oracle.ask_the_oracle_enter_to_send')}"></textarea></aside>`);
    },
  });
  const memory = document.getElementById('oracle-memory');
  assert.equal(memory.textContent, 'Memory');

  sandbox.InterfaceLanguage.apply({ language: { interface: 'pt-BR' } });

  assert.equal(memory.textContent, pt('oracle.memory'));
  assert.notEqual(memory.textContent, 'Memory');
  assert.equal(memory.getAttribute('title'), pt('oracle.the_owner_s_standing_decisions_read'));
  assert.equal(document.getElementById('oracle-input').getAttribute('placeholder'), pt('oracle.ask_the_oracle_enter_to_send'));
  assert.equal(document.dash.childNodes.length, 1, 'the dock is repainted, not drawn a second time');
  assert.equal(mounts, 1);

  sandbox.InterfaceLanguage.apply({ language: { interface: 'en' } });
  assert.equal(memory.textContent, 'Memory', 'and back to English');
});

test('#330 the real page booted in English shows the Backlog\'s tabs in pt-BR after InterfaceLanguage.apply, without a reload', async (t) => {
  t.after(() => I18n.setLanguage('en'));
  const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
  // without a tree walker every screen is drawn and mounted again: Settings' mount reads data the fake
  // api does not give (voice, tools), so its scripts are left out of this page
  const app = loadApp({
    storage: { interfaceLanguage: 'en' },
    api: { getSettings: async () => ({ language: { interface: 'en' } }) },
    only: (src) => !src.startsWith('views/settings/'),
  });
  await app.boot();
  app.run('showView("backlog")');
  await app.settle(10);
  const drawn = () => {
    const section = app.el('#view-backlog');
    const html = [...app.el('main.content').inserted, ...section.inserted].map(([, h]) => String(h)).filter((h) => h.includes('id="view-backlog"'));
    return html[html.length - 1] || '';
  };
  const tab = (html, name) => (new RegExp(`data-bl-tab="${name}"[^>]*>([^<]*)<`).exec(html) || [])[1];
  assert.equal(tab(drawn(), 'board'), 'Board');

  app.run('InterfaceLanguage.apply({ language: { interface: "pt-BR" } })');
  await app.settle(10);

  assert.equal(app.run('I18n.getLanguage()'), 'pt-BR');
  assert.equal(tab(drawn(), 'board'), pt('backlog.board'));
  assert.equal(tab(drawn(), 'epics'), pt('backlog.epics'));
  assert.match(drawn(), new RegExp(`title="${pt('backlog.the_issues_as_a_list_or')}"`));
});

test('#330 a label the screen changed since it was drawn keeps the screen\'s text after a live switch', (t) => {
  t.after(() => I18n.setLanguage('en'));
  const { sandbox, document } = loadPage();
  registerBacklogLike(sandbox, document, { mount: 0, show: 0 });
  const board = document.getElementById('tab-board');
  board.childNodes[0].nodeValue = 'Board (3)'; // e.g. a count the screen wrote on the tab

  sandbox.InterfaceLanguage.apply({ language: { interface: 'pt-BR' } });

  assert.equal(board.textContent, 'Board (3)');
  assert.equal(document.getElementById('mode-list').textContent, pt('backlog.list'));
});
