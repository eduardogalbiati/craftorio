// #411 Sidebar: the runs stay open and pinned at the bottom; only the menu scrolls. `nav.sidebar`
// (apps/desktop/renderer/index.html) has two parts: the menu (`data-testid="sidebar-menu"`: Home, the groups,
// Night watch, Settings, placed by view-registry.js), the only part that scrolls, and after it a footer
// pinned at the bottom (`data-testid="sidebar-footer"`: Keeping awake, the Run item and the runs list,
// always visible). The footer has a ceiling (about half the window); past it only the runs list scrolls.
// The markup is read from index.html (a small tag reader, no DOM); the menu entries from the real page
// (test/renderer-app-harness.js loads index.html's scripts in a vm sandbox, whose fake DOM records
// what was appended to which element); the scroll rules from style.css (a CSS reader like
// test/narrow-window-208.test.js's). There is no layout engine here: the scroll checks are source-level.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, text, RENDERER } = require('./renderer-app-harness');
const { pageFile } = require('../../../scripts/source-tree');

// a page file by its page-relative name, whichever layer holds it (style.css is the UI kit's, index.html the app's)
const read = (name) => fs.readFileSync(pageFile(path.join(RENDERER, '..', '..', '..'), name), 'utf8');

// ---- a tiny HTML reader: the elements inside `<nav class="sidebar">`, each with its attributes
// and its ancestors' attributes (outermost first) ---------------------------------------------
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'path', 'line', 'circle', 'rect', 'polyline', 'polygon']);
function sidebarElements() {
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
  const start = html.search(/<nav\b[^>]*class="[^"]*\bsidebar\b[^"]*"[^>]*>/);
  assert.ok(start >= 0, 'index.html has no <nav class="sidebar">');
  const out = [];
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    const [, closing, rawTag, rawAttrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const i = stack.map((e) => e.tag).lastIndexOf(tag);
      if (i >= 0) stack.length = i;
      if (!stack.length) break; // the nav closed
      continue;
    }
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    const el = { tag, attrs, ancestors: stack.map((e) => e.attrs) };
    out.push(el);
    if (!selfClose && !VOID.has(tag)) stack.push(el);
  }
  return out;
}
const testidOf = (attrs) => attrs['data-testid'] || '';
// the data-testid of every ancestor of the element with this id (inside the sidebar)
function testidsAround(els, id) {
  const el = els.find((e) => e.attrs.id === id);
  assert.ok(el, `no #${id} in the sidebar`);
  return el.ancestors.map(testidOf).filter(Boolean);
}
// the selectors that may name the element with this data-testid in a script or a stylesheet
function selectorsFor(testid) {
  const el = sidebarElements().find((e) => testidOf(e.attrs) === testid);
  if (!el) return [];
  return [
    `[data-testid="${testid}"]`,
    ...(el.attrs.id ? [`#${el.attrs.id}`] : []),
    ...String(el.attrs.class || '').split(/\s+/).filter(Boolean).map((c) => `.${c}`),
  ];
}

// ---- a tiny CSS reader (as test/narrow-window-208.test.js): comments stripped, every
// `selectors { declarations }` block, flagged media: true inside an @-block ----------------------
function cssRules(src) {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buf = '';
  for (const ch of css) {
    if (ch === '{') {
      const prelude = buf.trim();
      buf = '';
      if (prelude.startsWith('@')) { stack.push(prelude); continue; }
      stack.push({ prelude });
    } else if (ch === '}') {
      const open = stack.pop();
      if (open && typeof open === 'object') {
        const decls = {};
        for (const d of buf.split(';')) {
          const i = d.indexOf(':');
          if (i > 0) decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim().replace(/\s*!important$/, '');
        }
        const selectors = open.prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
        rules.push({ selectors, decls, media: stack.length > 0 });
      }
      buf = '';
    } else buf += ch;
  }
  return rules;
}
// the declarations of the rules whose selector names the element: one of `names` alone, or as the last
// compound of a selector (`nav.sidebar .x`, `.sidebar > [data-testid="x"]`), no pseudo-class
function declsFor(rules, names) {
  const hits = (sel) => names.some((n) => sel === n || sel.endsWith(` ${n}`) || sel.endsWith(`>${n}`)
    || (/^[a-z]+/.test(sel) && sel.replace(/^[a-z]+/, '') === n));
  return rules.filter((r) => r.selectors.some(hits)).map((r) => r.decls);
}
const scrolls = (decls) => decls.some((d) => [d.overflow, d['overflow-y']].some((v) => /\b(auto|scroll)\b/.test(v || '')));

// ---- 1. the markup ---------------------------------------------------------------------------

test('#411 index.html: the sidebar has a menu part, then a footer part after it', () => {
  const ids = sidebarElements().map((e) => testidOf(e.attrs)).filter(Boolean);
  assert.ok(ids.includes('sidebar-menu'), 'no data-testid="sidebar-menu" inside nav.sidebar');
  assert.ok(ids.includes('sidebar-footer'), 'no data-testid="sidebar-footer" inside nav.sidebar');
  assert.ok(ids.indexOf('sidebar-menu') < ids.indexOf('sidebar-footer'), 'the footer comes before the menu');
});

test('#411 index.html: Keeping awake, the Run item and the runs list are in the footer, none in the menu', () => {
  const els = sidebarElements();
  for (const id of ['nav-keep-awake', 'nav-run', 'nav-runs']) {
    const around = testidsAround(els, id);
    assert.ok(around.includes('sidebar-footer'), `#${id} is not inside the sidebar footer`);
    assert.ok(!around.includes('sidebar-menu'), `#${id} is inside the sidebar menu`);
  }
});

// ---- 2. the menu entries the page places -------------------------------------------------------

test('#411 the page puts every menu entry (Home, the groups, Night watch, Settings) in the menu part, not on the sidebar itself, in the same order', () => {
  const app = loadApp();
  const nodes = [...app.elements.values(), ...app.created];
  const containerOf = (node) => nodes.find((n) => (n.appended || []).includes(node));
  const label = (n) => text(n.innerHTML);
  const top = ['Home', 'Night watch', 'Settings'].map((name) => {
    const btn = app.created.find((n) => n.classList.contains('nav-item') && label(n) === name);
    assert.ok(btn, `no "${name}" menu entry was created`);
    return btn;
  });
  const groups = app.created.filter((n) => n.classList.contains('nav-group'));
  assert.ok(groups.length >= 4, `only ${groups.length} menu groups`);
  const holders = [...new Set([...top, ...groups].map(containerOf))];
  assert.equal(holders.length, 1, 'the menu entries and groups are not all in one container');
  const holder = holders[0];
  assert.ok(holder, 'the menu entries were placed nowhere');
  assert.notEqual(String(holder.key), 'nav.sidebar', 'the menu entries are placed on nav.sidebar itself, not in its menu part');
  // the order is the entries' own (data-order): Home first, then the groups, Night watch, Settings last
  const order = (n) => Number(n.dataset.order);
  const [home, night, settings] = top;
  assert.ok(groups.every((g) => order(home) < order(g) && order(g) < order(night)), 'Home, the groups, Night watch: order changed');
  assert.ok(order(night) < order(settings), 'Settings is no longer after Night watch');
  const footerNames = ['sidebar-footer', ...selectorsFor('sidebar-footer')];
  assert.ok(!footerNames.some((n) => String(holder.key).includes(n)), 'the menu entries are placed in the footer');
});

// ---- 3. the scroll rules (style.css) -----------------------------------------------------------

test('#411 style.css: the sidebar no longer scrolls as one block; its menu part is what scrolls', () => {
  const rules = cssRules(read('style.css'));
  const sidebar = declsFor(rules, ['.sidebar']);
  assert.ok(sidebar.length, 'style.css has no .sidebar rule');
  assert.equal(scrolls(sidebar), false, '.sidebar still scrolls as a whole (overflow / overflow-y auto)');
  const menu = declsFor(rules, selectorsFor('sidebar-menu'));
  assert.ok(menu.length, 'style.css has no rule for the sidebar menu');
  assert.equal(scrolls(menu), true, 'the sidebar menu does not scroll (overflow-y: auto)');
});

test('#411 style.css: the footer has a ceiling of about half the window, and past it the runs list scrolls inside it', () => {
  const rules = cssRules(read('style.css'));
  const footer = declsFor(rules, selectorsFor('sidebar-footer'));
  assert.ok(footer.length, 'style.css has no rule for the sidebar footer');
  const ceilings = footer.map((d) => d['max-height']).filter(Boolean);
  assert.ok(ceilings.length, 'the sidebar footer has no max-height');
  const near = ceilings.some((v) => [...v.matchAll(/(\d+(?:\.\d+)?)(vh|%)/g)].some((m) => Number(m[1]) >= 40 && Number(m[1]) <= 60));
  assert.ok(near, `the footer's max-height is not about half the window: ${ceilings.join(', ')}`);
  assert.equal(scrolls(declsFor(rules, ['.nav-runs', '#nav-runs'])), true, 'the runs list does not scroll (overflow auto)');
});
