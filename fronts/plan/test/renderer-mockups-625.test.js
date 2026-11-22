// #625 Project mockups: the Mockups screen (Plan & Design › Mockups, fronts/plan/views/mockups/mockups.js) and
// its element inspector (fronts/plan/views/mockups/mockup-inspector.js). The real page in the renderer harness
// (packages/ui-kit/test/renderer-app-harness.js) with a fake window.api. The contract:
// - the view registers as id 'mockups' with nav { label 'Mockups', group 'plan', order } and 115 < order < 120
//   (between Discovery and Write & Review), following the header's project;
// - testids: mockups-view, mockups-empty (no kit, no screens; its text has the kit estimate $1.50 and $4.00),
//   mockups-build-kit ("Build the visual kit"), mockups-new ("New mockup"), mockups-gallery, mockups-card (one
//   per screen, with its title), mockups-open;
// - describeElement(el) → { mid, selector, kit, text, box, html } for the nearest ancestor with data-mid.
// Assumptions beyond the contract (the window.api method names are not in it): a method whose name starts with
// `list` and names mockups or screens returns the screens ([{ slug, title }]); a method whose name has
// `estimate` returns the D15 estimate of the action it is given (build-kit when none); every other method
// resolves to the harness defaults (list* → [], others → null: no kit). The inspector is a browser script:
// it is required when it exports describeElement, else run in a vm with `window` and read from
// window.describeElement or window.MockupInspector.describeElement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadApp, navEntries, text } = require('@craftorio/ui-kit/test/renderer-app-harness');

const SCREENS = [
  { slug: 'orders-dashboard', title: 'Orders Dashboard' },
  { slug: 'settings', title: 'Account Settings' },
];
const COSTS = { 'build-kit': { model: 'opus', min: 1.5, max: 4 }, 'generate-screen': { model: 'opus', min: 0.4, max: 1.2 }, 'chat-edit': { model: 'sonnet', min: 0.03, max: 0.3 }, 'review-screen': { model: 'sonnet', min: 0.1, max: 0.4 } };

// window.api overrides: the projects, the screens and the estimates by name pattern (see the header)
function apiWith(screens) {
  const base = {
    listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
    getSettings: async () => ({ lastProject: 'p1' }),
  };
  const route = (name) => {
    if (typeof name !== 'string') return undefined;
    if (/estimate/i.test(name)) return async (arg) => COSTS[typeof arg === 'string' ? arg : arg?.action] || COSTS['build-kit'];
    if (/^list\w*(mockup|screen)/i.test(name)) return async () => screens;
    return undefined;
  };
  return new Proxy(base, {
    has: (tg, name) => name in tg || route(name) !== undefined,
    get: (tg, name) => (name in tg ? tg[name] : route(name)),
  });
}

async function mockups(screens = []) {
  const app = loadApp({ storage: { 'multiagent.currentProject': 'p1' }, api: apiWith(screens) });
  await app.boot();
  app.run("showView('mockups')");
  await app.settle(10);
  return app;
}
// all the markup the page's elements hold, the view's own markup included
const allMarkup = (app) => [...app.elements.values(), ...app.created].map((e) => String(e.innerHTML || ''))
  .concat(String(app.defs.get('mockups')?.markup || '')).join('\n');
// the text of the element marked `testid` up to its closing tag `tag`
const textOf = (html, testid, tag) => {
  const at = html.indexOf(`data-testid="${testid}"`);
  return at < 0 ? null : text(html.slice(html.lastIndexOf('<', at), html.indexOf(`</${tag}>`, at)));
};

// ---- the view ----------------------------------------------------------------------------------

test('#625 the menu has a Mockups entry in Plan & Design between Discovery (115) and Write & Review (120)', () => {
  const entry = navEntries(loadApp().defs).find((e) => e.id === 'mockups');
  assert.ok(entry, 'no mockups menu entry');
  assert.deepEqual([text(entry.label), entry.group, entry.order > 115 && entry.order < 120], ['Mockups', 'plan', true]);
});

test('#625 a project without kit and screens shows the empty state with the kit estimate $1.50 to $4.00', async () => {
  const html = allMarkup(await mockups());
  assert.deepEqual(['mockups-view', 'mockups-empty'].map((id) => html.includes(`data-testid="${id}"`)), [true, true]);
  const empty = text(html.slice(html.indexOf('data-testid="mockups-empty"')));
  assert.deepEqual([empty.includes('$1.50'), empty.includes('$4.00')], [true, true]);
});

test('#625 the empty state offers "Build the visual kit"', async () => {
  assert.equal(textOf(allMarkup(await mockups()), 'mockups-build-kit', 'button'), 'Build the visual kit');
});

test('#625 the Mockups screen offers "New mockup"', async () => {
  assert.equal(textOf(allMarkup(await mockups()), 'mockups-new', 'button'), 'New mockup');
});

test('#625 the gallery draws one card per screen with its title', async () => {
  const html = allMarkup(await mockups(SCREENS));
  assert.equal(html.includes('data-testid="mockups-gallery"'), true, 'no gallery');
  assert.equal(html.split('data-testid="mockups-card"').length - 1, 2);
  const t = text(html);
  assert.deepEqual([t.includes('Orders Dashboard'), t.includes('Account Settings')], [true, true]);
});

test('#625 a gallery card can open the screen in the editor window', async () => {
  assert.equal(allMarkup(await mockups(SCREENS)).includes('data-testid="mockups-open"'), true);
});

// ---- the inspector -----------------------------------------------------------------------------

const INSPECTOR = path.join(__dirname, '..', 'views', 'mockups', 'mockup-inspector.js');

function inspector() {
  let mod = null;
  try { mod = require(INSPECTOR); } catch (e) { if (!fs.existsSync(INSPECTOR)) throw e; }
  if (typeof mod?.describeElement === 'function') return mod.describeElement;
  const sandbox = { module: { exports: {} }, console };
  sandbox.exports = sandbox.module.exports;
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(INSPECTOR, 'utf8'), sandbox, { filename: INSPECTOR });
  const fn = sandbox.module.exports.describeElement || sandbox.describeElement || sandbox.MockupInspector?.describeElement;
  assert.equal(typeof fn, 'function', 'mockup-inspector.js exports describeElement');
  return fn;
}
// plain values only (the result may come from another realm)
const plain = (v) => JSON.parse(JSON.stringify(v));

// a minimal element: tag, classes, attributes, text, box, children
function el(tag, { cls = [], attrs = {}, text: txt = '', rect = null, outer = null } = {}, children = []) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    localName: tag,
    nodeName: tag.toUpperCase(),
    id: attrs.id || '',
    attrs,
    parentElement: null,
    parentNode: null,
    children,
    childNodes: children,
    classList: Object.assign([...cls], { contains: (c) => cls.includes(c) }),
    className: cls.join(' '),
    dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v])),
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    matches(sel) { return matches(this, sel); },
    closest(sel) { for (let n = this; n; n = n.parentElement) if (matches(n, sel)) return n; return null; },
    getBoundingClientRect: () => {
      const r = rect || { x: 0, y: 0, width: 0, height: 0 };
      return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
    },
  };
  node.textContent = txt || children.map((c) => c.textContent).join('');
  node.innerText = node.textContent;
  node.outerHTML = outer || `<${tag}>${node.textContent}</${tag}>`;
  for (const c of children) { c.parentElement = node; c.parentNode = node; }
  return node;
}
// `[attr]`, `[attr="v"]`, `tag`, `.class`, `tag.class`
function matches(node, sel) {
  return String(sel).split(',').map((s) => s.trim()).some((s) => {
    let m;
    if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(s))) return m[1] in node.attrs && (m[2] === undefined || node.attrs[m[1]] === m[2]);
    if ((m = /^([a-z][\w-]*)?(?:\.([\w-]+))?$/i.exec(s)) && (m[1] || m[2])) return (!m[1] || node.localName === m[1].toLowerCase()) && (!m[2] || node.classList.contains(m[2]));
    return false;
  });
}

// body > header.page-head[m1] > button.export[m2, data-kit=button-primary] > span
function page() {
  const span = el('span', { text: '  Export  ' });
  const button = el('button', {
    cls: ['export'], attrs: { 'data-mid': 'm2', 'data-kit': 'button-primary' },
    rect: { x: 10.4, y: 20.6, width: 99.5, height: 31.49 },
    outer: `<button class="export" data-mid="m2" data-kit="button-primary"><span>Export</span>${'<!-- pad -->'.repeat(40)}</button>`,
  }, [span]);
  const header = el('header', { cls: ['page-head'], attrs: { 'data-mid': 'm1' }, rect: { x: 0, y: 0, width: 1440, height: 64 } }, [button]);
  const body = el('body', {}, [header]);
  el('html', {}, [body]);
  return { span, button, header };
}

test('#625 describeElement climbs from the clicked element to the nearest ancestor with data-mid', () => {
  const d = plain(inspector()(page().span));
  assert.equal(d.mid, 'm2');
});

test('#625 describeElement gives the kit component from data-kit, null without it', () => {
  const describe = inspector();
  const { span, header } = page();
  assert.deepEqual([plain(describe(span)).kit, plain(describe(header)).kit], ['button-primary', null]);
});

test('#625 describeElement gives the box rounded from getBoundingClientRect as [x, y, width, height]', () => {
  assert.deepEqual(plain(inspector()(page().span)).box, [10, 21, 100, 31]);
});

test('#625 describeElement gives a selector ending with tag.class, the trimmed text and at most 300 characters of html', () => {
  const d = plain(inspector()(page().span));
  assert.deepEqual([d.selector.endsWith('button.export'), d.text, d.html.length <= 300, d.html.startsWith('<button')], [true, 'Export', true, true], JSON.stringify(d));
});
