// Findings overlay (#361, apps/desktop/renderer/findings.js): the frozen view is scaled to fit the stage, and a
// numbered pin stays on the spot of the capture it marks when the window is resized (the review's
// finding: the canvas was laid out again but the pins kept their old position).
// The overlay runs in a mini DOM (test/mini-dom.js): no capture (a blank picture), no canvas context.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('./mini-dom');

const RENDERER = path.join(__dirname, '..', 'renderer');

// the overlay of a 1000×500 window; `room` is the stage's content box, which the test changes
function loadOverlay() {
  const room = { width: 1000, height: 500 };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    innerWidth: 1000,
    innerHeight: 500,
    getComputedStyle: () => ({ paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px', getPropertyValue: () => '' }),
    state: { view: 'run', tab: 'steps' },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
    api: {
      appInfo: async () => ({ isPackaged: false }),
      getSettings: async () => ({ findingsButton: false }),
      captureWindow: async () => null,
    },
  };
  const dom = createDom({ window: sandbox });
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.document = dom.document;
  Object.assign(sandbox, dom.classes);
  const { Element } = dom.classes;
  Element.prototype.getContext = () => null;
  for (const [prop, key] of [['clientWidth', 'width'], ['clientHeight', 'height']]) {
    const base = Object.getOwnPropertyDescriptor(Element.prototype, prop);
    Object.defineProperty(Element.prototype, prop, {
      get() { return this.classList.contains('fd-stage') ? room[key] : base.get.call(this); },
      set(v) { base.set.call(this, v); },
      configurable: true,
    });
  }
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const file of ['../../../packages/shared/findings-model.js', 'findings.js']) {
    vm.runInContext(fs.readFileSync(path.join(RENDERER, file), 'utf8'), sandbox, { filename: file });
  }
  return { sandbox, dom, document: dom.document, room };
}

const pinStyle = (document) => Array.from(document.querySelectorAll('[data-testid="findings-pin"]')).map((p) => String(p.getAttribute('style') || '').replace(/\s+/g, ''));

async function overlayWithPin() {
  const o = loadOverlay();
  await o.sandbox.Findings.open();
  assert.equal(o.sandbox.Findings.isOpen(), true, 'the overlay is open');
  const canvas = o.document.querySelector('[data-testid="findings-canvas"]');
  canvas.dispatchEvent(new o.dom.classes.MouseEvent('click', { bubbles: true, clientX: 400, clientY: 200 }));
  return o;
}

test('a numbered pin sits on the spot clicked on the frozen view', async () => {
  const { document } = await overlayWithPin();
  assert.deepEqual(pinStyle(document), ['left:400px;top:200px']);
});

test('a pin keeps its spot on the capture when the window is resized', async () => {
  const { sandbox, document, dom, room } = await overlayWithPin();
  room.width = 500;
  room.height = 250;
  sandbox.dispatchEvent(new dom.classes.Event('resize'));
  assert.deepEqual(pinStyle(document), ['left:200px;top:100px']);
});
