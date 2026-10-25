// Shared helpers for the tests that render packages/ui-kit/artifacts-panel.js in Node (#225, #182,
// #185): the panel runs only inside the Electron renderer, so it is evaluated whole in a vm sandbox
// with app.js's helpers stubbed and a fake `root` element (innerHTML stored, no parsing), the way
// test/artifacts-panel.test.js does it. Not a test file itself (no `.test.js`).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');

const panelSrc = () => fs.readFileSync(path.join(__dirname, '..', 'artifacts-panel.js'), 'utf8');

function loadPanel(opts = {}) {
  const calls = { openArtifactsAt: [], readArtifact: [], artifactMenuOpen: [], imageViewerOpen: [] };
  const sandbox = {
    esc: (s) => (s == null ? '' : String(s)),
    artKindIcon: (kind) => `<i data-kind="${kind}"></i>`,
    fmtSize: (n) => (n == null ? '' : `${n} B`),
    markdownHtml: (t) => `<md>${t}</md>`,
    renderJsonText: (t) => t,
    renderDelimited: (t) => `<table>${t}</table>`,
    errMsg: (e) => String(e?.message || e),
    showToast: () => {},
    ArtifactMenu: { open: (e, target) => calls.artifactMenuOpen.push(target) },
    ImageViewer: {
      THUMB: 'tabindex="0" role="button" title="Click to enlarge" data-iv-thumb',
      open: (o) => calls.imageViewerOpen.push(o),
    },
    api: {
      listArtifacts: opts.listArtifacts || (async () => [{ artifacts: [] }]),
      readArtifact: opts.readArtifact || (async (p) => { calls.readArtifact.push(p); return { text: '' }; }),
      runEvidence: opts.runEvidence,
    },
    window: { Actions: { call: (name, ...a) => { if (name === 'openArtifactsAt') calls.openArtifactsAt.push(a); } } },
    document: {},
    setTimeout, clearTimeout, Date,
  };
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(panelSrc(), sandbox);
  return { ArtifactsPanel: sandbox.window.ArtifactsPanel, calls };
}

// A fake root: innerHTML stored as is; listeners: the handlers mount() registered (click, contextmenu…)
function fakeRoot() {
  const body = { innerHTML: '' };
  const listeners = {};
  const root = {
    classList: { add() {} },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    isConnected: true,
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    querySelector: (sel) => (sel === '.ap-body' ? body : null),
    querySelectorAll: () => [],
  };
  return { root, body, listeners };
}

// A fake click target: e.target.closest(sel) resolves only for `match` (e.g. '[data-artifact-filter]'),
// to an element with the given dataset (and getAttribute reading `attrs`).
const closestTarget = (match, dataset, attrs = {}) => ({
  closest: (sel) => (sel === match ? { dataset, getAttribute: (n) => attrs[n] ?? null } : null),
  matches: () => false,
});

const waitTick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

module.exports = { closestTarget, fakeRoot, loadPanel, waitTick };
