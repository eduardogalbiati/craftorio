// #835 Mockups phase 2, Interact mode:
// - the canvas' inspector (fronts/plan/views/mockups/mockup-inspector.js, install(win) inside the sandboxed
//   iframe) follows { type: 'mockup:mode' } and { type: 'mockup:highlight', mids } only from its parent
//   window; in Interact mode a click posts { type: 'mockup:navigate', mid } instead of mockup:select;
// - the editor (fronts/plan/views/mockups/mockup-editor.js, index.html?window=mockup) in Interact mode, with a
//   flow chosen, loads the screen the flow links the clicked element to (MockupModel.flowTarget); in Select
//   mode, or from a window that is not the canvas, a navigate message does nothing.
// The editor runs on the real page through packages/ui-kit/test/renderer-app-harness.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');

const INSPECTOR = path.join(__dirname, '..', 'views', 'mockups', 'mockup-inspector.js');

// ---- the inspector -----------------------------------------------------------------------------

// a minimal element with a data-mid (what describeElement reads)
function element(mid, { tag = 'button', text = 'Pay' } = {}) {
  const attrs = { 'data-mid': mid };
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), localName: tag, nodeName: tag.toUpperCase(), id: '', attrs,
    parentElement: null, parentNode: null, children: [], childNodes: [],
    classList: Object.assign([], { contains: () => false }), className: '',
    dataset: { mid }, textContent: text, innerText: text, outerHTML: `<${tag} data-mid="${mid}">${text}</${tag}>`,
    style: {},
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    hasAttribute: (k) => k in attrs,
    matches: (sel) => sel === '[data-mid]' || sel === `[data-mid="${mid}"]` || sel === tag,
    closest(sel) { return this.matches(sel) ? this : null; },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10, left: 0, top: 0, right: 10, bottom: 10 }),
  };
  return node;
}

// a frame window whose parent records what it is posted; fire(type, ev) calls the frame's listeners
function frameWindow(elements) {
  const posted = [];
  const parent = { postMessage: (data) => posted.push(JSON.parse(JSON.stringify(data))) };
  const winListeners = {};
  const docListeners = {};
  const win = {
    parent,
    addEventListener: (type, fn) => { (winListeners[type] ||= []).push(fn); },
    document: {
      addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
      querySelector: (sel) => elements.find((e) => sel === `[data-mid="${e.attrs['data-mid']}"]`) || null,
    },
  };
  const message = (data, source = parent) => { for (const fn of winListeners.message || []) fn({ source, data }); };
  const click = (target) => {
    const ev = { target, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} };
    for (const fn of docListeners.click || []) fn(ev);
  };
  return { win, parent, posted, message, click };
}

function installed(elements = [element('m1')]) {
  const { install } = require(INSPECTOR);
  const f = frameWindow(elements);
  assert.equal(install(f.win), true);
  return f;
}

test('#835 the inspector selects on a click until its parent switches it to Interact mode', () => {
  const f = installed();
  const m1 = element('m1');
  f.click(m1);
  f.message({ type: 'mockup:mode', mode: 'interact' });
  f.click(m1);
  assert.deepEqual(f.posted.map((p) => [p.type, p.mid]), [['mockup:select', 'm1'], ['mockup:navigate', 'm1']]);
});

test('#835 the inspector ignores a mode message that does not come from its parent', () => {
  const f = installed();
  f.message({ type: 'mockup:mode', mode: 'interact' }, { postMessage() {} });
  f.click(element('m1'));
  assert.deepEqual(f.posted.map((p) => p.type), ['mockup:select']);
});

test('#835 the inspector goes back to selecting when its parent sends the select mode', () => {
  const f = installed();
  f.message({ type: 'mockup:mode', mode: 'interact' });
  f.message({ type: 'mockup:mode', mode: 'select' });
  f.click(element('m1'));
  assert.deepEqual(f.posted.map((p) => p.type), ['mockup:select']);
});

test('#835 the inspector highlights the changed elements its parent names', () => {
  const m1 = element('m1');
  const m2 = element('m2');
  const f = installed([m1, m2]);
  f.message({ type: 'mockup:highlight', mids: ['m2'] });
  assert.deepEqual([m1.attrs['data-testid'] ?? null, m2.attrs['data-testid'] ?? null], [null, 'mockup-changed']);
});

test('#835 the inspector ignores a highlight message that does not come from its parent', () => {
  const m1 = element('m1');
  const f = installed([m1]);
  f.message({ type: 'mockup:highlight', mids: ['m1'] }, { postMessage() {} });
  assert.equal(m1.attrs['data-testid'] ?? null, null);
});

// ---- the editor ----------------------------------------------------------------------------------

const FLOW = { name: 'checkout', links: [{ from: { screen: 'orders-dashboard', mid: 'm1' }, to: 'payment' }] };

async function editor() {
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listMockupVersions: async () => [{ commit: 'c41e2a9aaaaaaaa', message: 'Smaller title' }],
      readMockupChat: async () => [],
      listMockupVariants: async () => ({ current: 'main', variants: [{ name: 'main' }] }),
      listMockupFlows: async () => [{ name: 'checkout' }],
      readMockupFlow: async () => FLOW,
      listMockups: async () => [{ slug: 'orders-dashboard', title: 'Orders dashboard' }, { slug: 'payment', title: 'Payment' }],
    },
  });
  app.sandbox.location.search = '?window=mockup&project=p1&slug=orders-dashboard';
  await app.boot();
  await app.settle(10);
  const frame = { name: 'canvas window', postMessage() {} };
  app.el('#mockup-canvas').contentWindow = frame;
  const post = async (data, source = frame) => { app.sandbox.dispatchEvent({ type: 'message', source, data }); await app.settle(); };
  const chooseFlow = async (name) => {
    const root = app.el('#mockup-editor-root');
    for (const fn of root.listeners.change || []) await fn({ target: { id: 'mockup-flow-select', value: name } });
    await app.settle();
  };
  const interact = () => app.click('#mockup-interact', { dataset: { mockupInteract: '' }, within: ['#mockup-editor-root'] });
  const loadedSlugs = () => app.callsTo('listMockupVersions').map((args) => args[1]);
  return { app, post, chooseFlow, interact, loadedSlugs };
}

test('#835 in Interact mode a click on a linked element loads the screen the flow leads to', async () => {
  const { app, post, chooseFlow, interact, loadedSlugs } = await editor();
  await chooseFlow('checkout');
  await interact();
  await post({ type: 'mockup:navigate', mid: 'm1' });
  assert.deepEqual(loadedSlugs(), ['orders-dashboard', 'payment']);
  assert.deepEqual(app.errors.map((e) => String(e.message)), []);
});

test('#835 in Interact mode a click on an element the flow does not link stays on the screen', async () => {
  const { post, chooseFlow, interact, loadedSlugs } = await editor();
  await chooseFlow('checkout');
  await interact();
  await post({ type: 'mockup:navigate', mid: 'm9' });
  assert.deepEqual(loadedSlugs(), ['orders-dashboard']);
});

test('#835 in Select mode a navigate message does not change the screen', async () => {
  const { post, chooseFlow, loadedSlugs } = await editor();
  await chooseFlow('checkout');
  await post({ type: 'mockup:navigate', mid: 'm1' });
  assert.deepEqual(loadedSlugs(), ['orders-dashboard']);
});

test('#835 a navigate message that does not come from the canvas is ignored', async () => {
  const { post, chooseFlow, interact, loadedSlugs } = await editor();
  await chooseFlow('checkout');
  await interact();
  await post({ type: 'mockup:navigate', mid: 'm1' }, { name: 'another window' });
  assert.deepEqual(loadedSlugs(), ['orders-dashboard']);
});
