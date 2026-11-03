// #748: the app's shared menu (packages/ui-kit/menu.js), the one the roadmap stage's ⋮ menu, the
// roadmap bar's Pause menu and the Backlog card's ⋯ menu draw with. Acceptance tests written before
// the code: the module is read inside each test.
//
// Assumed API (Browser: window.Menu; Node: module.exports, like select.js):
// - menuHtml(items, { label, testid, className } = {}) → the menu's markup:
//   <div class="ui-menu[ className]" role="menu" aria-label="label"[ data-testid="testid"]> with, in order:
//   - per entry { id, icon?, label, title?, disabledReason?, danger?, testid?, attrs? }:
//     <button type="button" role="menuitem" class="ui-menu-item[ ui-menu-danger]" data-menu-id="id"
//       title="disabledReason || title"[ aria-disabled="true"][ data-testid="testid"][ attrs]>
//       <span class="ui-menu-icon" aria-hidden="true">icon or nothing</span><span class="ui-menu-label">label</span>
//     </button>
//     A refused entry (disabledReason) stays in the menu, reachable by the keyboard (aria-disabled, never
//     `disabled`), its reason only in its title: no line under it (no .bl-menu-why), no extra text.
//   - per divider { divider: true }: <div role="separator" class="ui-menu-sep"></div>; falsy items are
//     skipped, and dividers collapse: never first, never last, never two in a row (an empty group
//     leaves no trace).
//   Labels, titles and icons are escaped.
// - bindMenu(menuEl, { onPick(id), onClose(reason) }) → { close() }: on the menu element
//   ArrowDown / ArrowUp (wrapping), Home, End move the focus between the entries (dividers skipped,
//   refused entries reached); Enter or a click on an entry calls onPick(id) (not for a refused entry);
//   Escape closes (onClose('escape')); a mousedown/click outside the menu closes (onClose('outside')),
//   once. close() removes the document listeners.
// - The menu's CSS (packages/ui-kit/menu.css, or style.css) gives the icon a fixed-width column.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDom, textOf } = require('./mini-dom');

const KIT = path.join(__dirname, '..');
const MENU = path.join(KIT, 'menu.js');
const requireMenu = () => require(MENU);

// menu.js in a sandbox on a small real DOM (mini-dom), the way select-383.test.js loads select.js
function loadDom() {
  const sandbox = { console, setTimeout, clearTimeout, requestAnimationFrame: (f) => setTimeout(f, 0), getComputedStyle: () => ({ getPropertyValue: () => '' }) };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  sandbox.placePopover = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(MENU, 'utf8'), sandbox, { filename: 'menu.js' });
  return { Menu: sandbox.Menu, dom, document: dom.document };
}

const ENTRIES = [
  { id: 'enable', icon: '⏻', label: 'Enable' },
  { id: 'run', icon: '▶', label: 'Run this stage', disabledReason: 'No planned item in this stage' },
  { divider: true },
  { id: 'up', label: 'Move up' },
  { id: 'down', label: 'Move down' },
  { divider: true },
  { id: 'remove', icon: '🗑', label: 'Remove from roadmap', danger: true },
];

// the menu drawn into the page, with a button outside it
function mounted(items = ENTRIES) {
  const page = loadDom();
  page.document.body.innerHTML = `<button id="outside">elsewhere</button><div id="host">${page.Menu.menuHtml(items, { label: 'Stage 2 actions' })}</div>`;
  const menu = page.document.querySelector('#host [role="menu"]');
  const picks = [];
  const closes = [];
  page.Menu.bindMenu(menu, { onPick: (id) => picks.push(String(id)), onClose: (why) => closes.push(String(why)) });
  const entries = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const focused = () => {
    const el = page.document.activeElement;
    return el && el.getAttribute ? String(el.getAttribute('data-menu-id')) : '';
  };
  return { ...page, menu, picks, closes, entries, focused };
}

// the menu's rows in order: a separator as '|', an entry as its label
function rows(html) {
  const { document } = createDom();
  document.body.innerHTML = html;
  const menu = document.querySelector('[role="menu"]');
  return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((el) => (el.getAttribute('role') === 'separator' ? '|' : textOf(el.querySelector('.ui-menu-label') || el)));
}

function parsed(html) {
  const { document } = createDom();
  document.body.innerHTML = html;
  return document;
}

// ---------- menuHtml ----------

test('#748 menuHtml: a role="menu" with its entries and a role="separator" between the groups, in order', () => {
  const { menuHtml } = requireMenu();
  const html = menuHtml(ENTRIES, { label: 'Stage 2 actions' });
  assert.deepEqual(rows(html), ['Enable', 'Run this stage', '|', 'Move up', 'Move down', '|', 'Remove from roadmap']);
  const doc = parsed(html);
  assert.equal(doc.querySelector('[role="menu"]').getAttribute('aria-label'), 'Stage 2 actions');
  assert.equal(doc.querySelector('[role="menu"]').classList.contains('ui-menu'), true);
});

test('#748 menuHtml: an empty group leaves no divider first, last or twice in a row; falsy items are skipped', () => {
  const { menuHtml } = requireMenu();
  const html = menuHtml([
    null, { divider: true }, { id: 'a', label: 'A' }, { divider: true }, false, { divider: true }, { divider: true },
    { id: 'b', label: 'B' }, { divider: true }, '', { divider: true },
  ]);
  assert.deepEqual(rows(html), ['A', '|', 'B']);
});

test('#748 menuHtml: only dividers and nothing else draws no separator at all', () => {
  const { menuHtml } = requireMenu();
  const doc = parsed(menuHtml([{ divider: true }, { divider: true }]));
  assert.equal(doc.querySelectorAll('[role="separator"]').length, 0);
});

test('#748 menuHtml: a refused entry is aria-disabled (not disabled), its reason only in its title, no line under it', () => {
  const { menuHtml } = requireMenu();
  const doc = parsed(menuHtml(ENTRIES));
  const run = doc.querySelector('[data-menu-id="run"]');
  assert.equal(run.getAttribute('role'), 'menuitem');
  assert.equal(run.getAttribute('aria-disabled'), 'true');
  assert.equal(run.hasAttribute('disabled'), false, 'still reached by the keyboard');
  assert.equal(run.getAttribute('title'), 'No planned item in this stage');
  assert.equal(textOf(run).replace('▶', '').trim(), 'Run this stage', 'the reason is not written in the entry');
  assert.equal(doc.querySelectorAll('.bl-menu-why').length, 0);
  assert.equal(textOf(doc.querySelector('[role="menu"]')).includes('No planned item in this stage'), false, 'no explanation line in the menu');
  assert.equal(doc.querySelector('[data-menu-id="up"]').hasAttribute('aria-disabled'), false, 'an allowed entry is not marked');
});

test('#748 menuHtml: a danger entry is flagged with ui-menu-danger, the others are not', () => {
  const { menuHtml } = requireMenu();
  const doc = parsed(menuHtml(ENTRIES));
  assert.equal(doc.querySelector('[data-menu-id="remove"]').classList.contains('ui-menu-danger'), true);
  assert.equal(doc.querySelectorAll('.ui-menu-danger').length, 1);
});

test('#748 menuHtml: every entry has one icon slot, first, empty when the entry has no icon', () => {
  const { menuHtml } = requireMenu();
  const doc = parsed(menuHtml(ENTRIES));
  const slots = [...doc.querySelectorAll('[role="menuitem"]')].map((el) => {
    const icons = el.querySelectorAll('.ui-menu-icon');
    return `${el.getAttribute('data-menu-id')}:${icons.length}:${el.firstElementChild === icons[0]}:${textOf(icons[0])}`;
  });
  assert.deepEqual(slots, ['enable:1:true:⏻', 'run:1:true:▶', 'up:1:true:', 'down:1:true:', 'remove:1:true:🗑']);
  assert.equal(doc.querySelector('.ui-menu-icon').getAttribute('aria-hidden'), 'true');
});

test('#748 menuHtml: labels and reasons are escaped', () => {
  const { menuHtml } = requireMenu();
  const html = menuHtml([{ id: 'x', label: '<b>bold</b>', disabledReason: 'a "quoted" <i>why</i>' }]);
  assert.doesNotMatch(html, /<b>bold<\/b>|<i>why<\/i>/);
  const doc = parsed(html);
  assert.equal(textOf(doc.querySelector('.ui-menu-label')), '<b>bold</b>');
  assert.equal(doc.querySelector('[data-menu-id="x"]').getAttribute('title'), 'a "quoted" <i>why</i>');
});

// ---------- bindMenu: keyboard, pick, close ----------

test('#748 bindMenu: ArrowDown / ArrowUp move between the entries, skipping the dividers, reaching a refused one, wrapping', () => {
  const m = mounted();
  m.entries()[0].focus();
  const seen = [m.focused()];
  for (let i = 0; i < 5; i++) { m.dom.keydown(m.document.activeElement, 'ArrowDown'); seen.push(m.focused()); }
  assert.deepEqual(seen, ['enable', 'run', 'up', 'down', 'remove', 'enable']);
  m.dom.keydown(m.document.activeElement, 'ArrowUp');
  assert.equal(m.focused(), 'remove');
  m.dom.keydown(m.document.activeElement, 'ArrowUp');
  assert.equal(m.focused(), 'down');
});

test('#748 bindMenu: Home and End go to the first and the last entry', () => {
  const m = mounted();
  m.entries()[2].focus();
  m.dom.keydown(m.document.activeElement, 'End');
  assert.equal(m.focused(), 'remove');
  m.dom.keydown(m.document.activeElement, 'Home');
  assert.equal(m.focused(), 'enable');
});

test('#748 bindMenu: the arrow keys are the menu\'s (default prevented, the page does not scroll)', () => {
  const m = mounted();
  m.entries()[0].focus();
  assert.equal(m.dom.keydown(m.document.activeElement, 'ArrowDown').defaultPrevented, true);
});

test('#748 bindMenu: Enter on an entry picks it; Enter on a refused entry picks nothing and the menu stays', () => {
  const m = mounted();
  m.entries()[3].focus(); // Move down
  m.dom.keydown(m.document.activeElement, 'Enter');
  assert.deepEqual(m.picks, ['down']);
  const again = mounted();
  again.entries()[1].focus(); // Run this stage, refused
  again.dom.keydown(again.document.activeElement, 'Enter');
  assert.deepEqual(again.picks, []);
  assert.deepEqual(again.closes, []);
});

test('#748 bindMenu: a click on an entry picks it; on a refused entry nothing happens', () => {
  const m = mounted();
  m.menu.querySelector('[data-menu-id="run"]').click();
  assert.deepEqual(m.picks, []);
  assert.deepEqual(m.closes, []);
  m.menu.querySelector('[data-menu-id="up"]').click();
  assert.deepEqual(m.picks, ['up']);
});

test('#748 bindMenu: Escape closes the menu', () => {
  const m = mounted();
  m.entries()[0].focus();
  m.dom.keydown(m.document.activeElement, 'Escape');
  assert.deepEqual(m.closes, ['escape']);
  assert.deepEqual(m.picks, []);
});

test('#748 bindMenu: a click outside the menu closes it, once; a click inside does not', () => {
  const m = mounted();
  const { MouseEvent } = m.dom.classes;
  m.menu.querySelector('[data-menu-id="run"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  assert.deepEqual(m.closes, [], 'a press inside keeps it');
  const out = m.document.querySelector('#outside');
  out.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  out.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(m.closes, ['outside']);
});

// ---------- the CSS ----------

test('#748 the menu\'s CSS gives the icon slot a fixed-width column', () => {
  const css = ['menu.css', 'style.css'].map((f) => path.join(KIT, f)).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel, body }));
  const iconColumn = rules.some(({ sel, body }) => /\.ui-menu-icon\b/.test(sel) && /(^|[;\s])(width|min-width|flex(-basis)?)\s*:/.test(body));
  const gridColumn = rules.some(({ sel, body }) => /\.ui-menu(-item)?\b/.test(sel) && /grid-template-columns\s*:/.test(body));
  assert.equal(iconColumn || gridColumn, true, 'a .ui-menu-icon rule with a width (or a grid column on .ui-menu-item)');
});

test('#748 the page loads menu.js (desktop and web), before the views that draw menus with it', () => {
  for (const app of ['desktop', 'web']) {
    const html = fs.readFileSync(path.join(KIT, '..', '..', 'apps', app, 'renderer', 'index.html'), 'utf8');
    const menu = html.indexOf('packages/ui-kit/menu.js');
    assert.ok(menu > 0, `apps/${app}/renderer/index.html loads packages/ui-kit/menu.js`);
    assert.ok(menu < html.indexOf('fronts/build/views/backlog/backlog-roadmap.js'), `apps/${app}: before backlog-roadmap.js`);
    const css = html.indexOf('packages/ui-kit/menu.css');
    if (fs.existsSync(path.join(KIT, 'menu.css'))) assert.ok(css > 0, `apps/${app} links menu.css`);
  }
});

// ---------- the agent notes ----------

test('#748 packages/ui-kit/AGENTS.md documents the shared menu: menu.js, menuHtml and bindMenu', () => {
  const notes = fs.readFileSync(path.join(KIT, 'AGENTS.md'), 'utf8');
  assert.match(notes, /menu\.js/);
  assert.match(notes, /menuHtml\(/);
  assert.match(notes, /bindMenu\(/);
});
