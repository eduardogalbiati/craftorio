// #129 Settings › Execution › Memory guard (packages/ui-kit/views/settings/settings.js renderMemoryGuard): with
// no memoryGuard in the settings, the screen falls back to the new default, off with a 25% limit and a
// 10% floor: the On switch unchecked.
// The renderer runs only inside Electron: as in renderer-settings-memory-guard-276.test.js, the function is
// pulled out of the source and run in a vm sandbox against a minimal fake DOM; only primitives are
// compared (the switch's checked flag, the fields' values).
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

const { settingsSource, t } = require('./settings-source-329');

const TESTIDS = ['memory-guard-enabled', 'memory-guard-limit', 'memory-guard-floor', 'memory-guard-limit-hint'];

function fakeEl() {
  const classes = new Set();
  const attrs = new Map();
  let value = '';
  return {
    textContent: '', checked: false, dataset: {}, style: {},
    get value() { return value; }, set value(v) { value = String(v ?? ''); },
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : !!force; if (on) classes.add(c); else classes.delete(c); return on; },
      contains: (c) => classes.has(c),
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    removeAttribute: (k) => attrs.delete(k),
    querySelector: () => fakeEl(), querySelectorAll: () => [],
  };
}

// renderMemoryGuard run on settings with no memoryGuard; → { checked, limit, floor } as primitives
async function renderWithoutSaved() {
  const src = settingsSource();
  const render = /(?:async )?function renderMemoryGuard\([^)]*\) \{[\s\S]*?\n\}/.exec(src)?.[0];
  assert.ok(render, 'renderMemoryGuard not found in settings.js');
  const tagOf = (testid) => new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`).exec(src)?.[0] || '';
  const byTestid = new Map(TESTIDS.map((id) => [id, fakeEl()]));
  const byId = new Map();
  for (const testid of TESTIDS) {
    const id = /\sid="([^"]+)"/.exec(tagOf(testid))?.[1];
    if (id) byId.set(id, byTestid.get(testid));
  }
  const others = new Map();
  const find = (sel) => {
    const m = /^\[data-testid=["']?([^"'\]]+)["']?\]$/.exec(sel);
    if (m && byTestid.has(m[1])) return byTestid.get(m[1]);
    if (sel.startsWith('#') && byId.has(sel.slice(1))) return byId.get(sel.slice(1));
    if (!others.has(sel)) others.set(sel, fakeEl());
    return others.get(sel);
  };
  const totalMemoryBytes = 16 * 1024 ** 3;
  const sandbox = {
    $: find, t, I18n: require('@craftorio/shared/i18n'),
    document: { querySelector: find, querySelectorAll: () => [], getElementById: (id) => find(`#${id}`) },
    state: { settings: {}, totalMemoryBytes },
    api: { appInfo: async () => ({ totalMemoryBytes }), setSettings: async (p) => p },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${render}\nthis.renderMemoryGuard = renderMemoryGuard;`, sandbox);
  await sandbox.renderMemoryGuard();
  const el = (id) => byTestid.get(id);
  return { checked: el('memory-guard-enabled').checked === true, limit: String(el('memory-guard-limit').value), floor: String(el('memory-guard-floor').value) };
}

test('#129 renderMemoryGuard with no saved memoryGuard: the On switch is unchecked, 25% and 10% shown', async () => {
  assert.deepEqual(await renderWithoutSaved(), { checked: false, limit: '25', floor: '10' });
});
