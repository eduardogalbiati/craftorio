// #276 memory guard, Settings › Execution (packages/ui-kit/views/settings/settings.js): a "Memory guard"
// group under "Concurrent runs" with an On switch, the limit (% of RAM) with a hint giving that limit
// in GB for this machine, and the low-memory floor (% of RAM; 0 = no hold). Like the screen's other
// groups (saveConcurrency, saveOracleSettings), its fields save on change through api.setSettings;
// a value out of range puts the field in its error state and nothing is saved.
// The renderer runs only inside Electron, so, as in test/renderer-settings-oracle.test.js, the two
// functions are pulled out of the source and run in a vm sandbox against a minimal fake DOM.
// Assumptions (acceptance tests written before the code):
//   - the functions are `renderMemoryGuard()` (may be async) and `saveMemoryGuard()`; renderSettings
//     calls the first, mount() wires the group's fields' onchange to the second;
//   - the fields carry data-testid memory-guard-enabled (checkbox), memory-guard-limit (number,
//     min 5, max 90), memory-guard-floor (number, min 0, max 50) and memory-guard-limit-hint; the
//     fake `$` resolves both `[data-testid="…"]` and the element's `#id` from the markup;
//   - the setting is `settings.memoryGuard = { enabled, limitPercent, floorPercent }`, saved whole;
//   - the total memory comes from api.appInfo().totalMemoryBytes (the app:info channel gains it,
//     os.totalmem()); the sandbox also sets state.totalMemoryBytes to the same value;
//   - the GB in the hint are binary (GiB, like Task Manager): 32 GiB at 25% -> "8.0 GB";
//   - error state = the input has aria-invalid="true" or the class `invalid` or `error`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// #329: the markup lives in settings-markup.js, its texts in the catalog
const { settingsSource, t } = require('./settings-source-329');
const src = settingsSource();
const GIB = 1024 ** 3;
const TESTIDS = ['memory-guard-enabled', 'memory-guard-limit', 'memory-guard-floor', 'memory-guard-limit-hint'];

// the opening tag of the element with this data-testid in the screen's markup, or null
const tagOf = (testid) => new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`).exec(src)?.[0] || null;

function fakeEl() {
  const classes = new Set();
  const attrs = new Map();
  let value = '';
  return {
    textContent: '', innerHTML: '', checked: false, disabled: false, dataset: {}, style: {}, title: '',
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
    hasAttribute: (k) => attrs.has(k),
    toggleAttribute: (k, force) => { const on = force === undefined ? !attrs.has(k) : !!force; if (on) attrs.set(k, ''); else attrs.delete(k); return on; },
    setCustomValidity() {}, reportValidity: () => true,
    querySelector: () => fakeEl(), querySelectorAll: () => [],
  };
}

const inError = (el) => el.getAttribute('aria-invalid') === 'true' || el.classList.contains('invalid') || el.classList.contains('error');

function loadMemoryGuard({ memoryGuard, totalMemoryBytes = 32 * GIB } = {}) {
  const render = /(?:async )?function renderMemoryGuard\([^)]*\) \{[\s\S]*?\n\}/.exec(src)?.[0];
  const save = /(?:async )?function saveMemoryGuard\([^)]*\) \{[\s\S]*?\n\}/.exec(src)?.[0];
  assert.ok(render, 'renderMemoryGuard not found in settings.js');
  assert.ok(save, 'saveMemoryGuard not found in settings.js');

  const byTestid = new Map(TESTIDS.map((id) => [id, fakeEl()]));
  const byId = new Map();
  for (const testid of TESTIDS) {
    const id = /\sid="([^"]+)"/.exec(tagOf(testid) || '')?.[1];
    if (id) byId.set(id, byTestid.get(testid));
  }
  const others = new Map();
  const find = (sel) => {
    const t = /^\[data-testid=["']?([^"'\]]+)["']?\]$/.exec(sel);
    if (t && byTestid.has(t[1])) return byTestid.get(t[1]);
    if (sel.startsWith('#') && byId.has(sel.slice(1))) return byId.get(sel.slice(1));
    if (!others.has(sel)) others.set(sel, fakeEl());
    return others.get(sel);
  };
  const setSettingsCalls = [];
  const sandbox = {
    $: find,
    t,
    I18n: require('@craftorio/shared/i18n'),
    esc: (s) => String(s ?? ''),
    errMsg: (e) => String(e?.message || e),
    renderHeader() {},
    document: { querySelector: find, querySelectorAll: () => [], getElementById: (id) => find(`#${id}`) },
    state: { settings: memoryGuard === undefined ? {} : { memoryGuard }, totalMemoryBytes },
    api: {
      appInfo: async () => ({ simulationOnly: true, totalMemoryBytes }),
      setSettings: async (patch) => {
        setSettingsCalls.push(JSON.parse(JSON.stringify(patch)));
        sandbox.state.settings = { ...sandbox.state.settings, ...patch };
        return sandbox.state.settings;
      },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${render}\n${save}\nthis.renderMemoryGuard = renderMemoryGuard;\nthis.saveMemoryGuard = saveMemoryGuard;`, sandbox);
  const el = (testid) => byTestid.get(testid);
  // the memoryGuard objects saved, as plain JSON (never the sandbox's objects)
  const saves = () => setSettingsCalls.filter((p) => 'memoryGuard' in p).map((p) => JSON.stringify(p.memoryGuard));
  return { renderMemoryGuard: sandbox.renderMemoryGuard, saveMemoryGuard: sandbox.saveMemoryGuard, el, saves };
}

test('markup: a "Memory guard" group after "Concurrent runs" and before "Oracle" on the Execution page', () => {
  const concurrent = src.indexOf('<h3 class="s-subtitle">Concurrent runs</h3>');
  const oracle = src.indexOf('<h3 class="s-subtitle">Oracle</h3>');
  const guard = src.indexOf('Memory guard', concurrent);
  assert.ok(concurrent > 0 && oracle > concurrent, 'the Concurrent runs / Oracle subtitles moved');
  assert.equal(guard > concurrent && guard < oracle, true);
  for (const testid of TESTIDS) {
    const at = src.indexOf(`data-testid="${testid}"`);
    assert.equal(at > concurrent && at < oracle, true, `${testid} is not in the group between Concurrent runs and Oracle`);
  }
});

test('markup: an On checkbox, a limit field 5..90 and a floor field 0..50', () => {
  const enabled = tagOf('memory-guard-enabled') || '';
  const limit = tagOf('memory-guard-limit') || '';
  const floor = tagOf('memory-guard-floor') || '';
  assert.match(enabled, /type="checkbox"/);
  assert.match(limit, /type="number"/);
  assert.match(limit, /min="5"/);
  assert.match(limit, /max="90"/);
  assert.match(floor, /type="number"/);
  assert.match(floor, /min="0"/);
  assert.match(floor, /max="50"/);
  assert.notEqual(tagOf('memory-guard-limit-hint'), null);
});

test('renderSettings draws the group and mount() saves it when a field changes', () => {
  const renderSettings = /async function renderSettings\(\) \{[\s\S]*?\n\}/.exec(src)?.[0] || '';
  const mount = /\n  mount\(\) \{[\s\S]*?\n  \},/.exec(src)?.[0] || '';
  assert.match(renderSettings, /renderMemoryGuard\(/);
  assert.match(mount, /saveMemoryGuard/);
});

test('renderMemoryGuard: fills the switch and both fields from settings.memoryGuard', async () => {
  const { renderMemoryGuard, el } = loadMemoryGuard({ memoryGuard: { enabled: false, limitPercent: 40, floorPercent: 5 } });
  await renderMemoryGuard();
  assert.equal(el('memory-guard-enabled').checked, false);
  assert.equal(el('memory-guard-limit').value, '40');
  assert.equal(el('memory-guard-floor').value, '5');
});

test('renderMemoryGuard: without a saved memoryGuard, shows the defaults (off since #129, 25%, 10%)', async () => {
  const { renderMemoryGuard, el } = loadMemoryGuard({ memoryGuard: undefined });
  await renderMemoryGuard();
  assert.equal(el('memory-guard-enabled').checked, false);
  assert.equal(el('memory-guard-limit').value, '25');
  assert.equal(el('memory-guard-floor').value, '10');
});

test('renderMemoryGuard: the hint gives the limit in GB for this machine (32 GB at 25% -> 8.0 GB)', async () => {
  const { renderMemoryGuard, el } = loadMemoryGuard({ memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 }, totalMemoryBytes: 32 * GIB });
  await renderMemoryGuard();
  assert.match(el('memory-guard-limit-hint').textContent, /\b8\.0 GB\b/);
});

test('renderMemoryGuard: the hint follows the limit (16 GB at 50% -> 8.0 GB; 64 GB at 10% -> 6.4 GB)', async () => {
  const a = loadMemoryGuard({ memoryGuard: { enabled: true, limitPercent: 50, floorPercent: 10 }, totalMemoryBytes: 16 * GIB });
  await a.renderMemoryGuard();
  assert.match(a.el('memory-guard-limit-hint').textContent, /\b8\.0 GB\b/);
  const b = loadMemoryGuard({ memoryGuard: { enabled: true, limitPercent: 10, floorPercent: 10 }, totalMemoryBytes: 64 * GIB });
  await b.renderMemoryGuard();
  assert.match(b.el('memory-guard-limit-hint').textContent, /\b6\.4 GB\b/);
});

test('renderMemoryGuard: an unknown total memory never shows NaN or Infinity in the hint', async () => {
  const { renderMemoryGuard, el } = loadMemoryGuard({ memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 }, totalMemoryBytes: undefined });
  await renderMemoryGuard();
  assert.doesNotMatch(el('memory-guard-limit-hint').textContent, /NaN|Infinity|undefined/);
});

test('saveMemoryGuard: valid values save the whole object { enabled, limitPercent, floorPercent }', async () => {
  const { renderMemoryGuard, saveMemoryGuard, el, saves } = loadMemoryGuard({ memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 } });
  await renderMemoryGuard();
  el('memory-guard-enabled').checked = false;
  el('memory-guard-limit').value = '40';
  el('memory-guard-floor').value = '15';
  await saveMemoryGuard();
  assert.deepEqual(saves(), [JSON.stringify({ enabled: false, limitPercent: 40, floorPercent: 15 })]);
  assert.equal(inError(el('memory-guard-limit')), false);
  assert.equal(inError(el('memory-guard-floor')), false);
});

test('saveMemoryGuard: the range ends are valid (limit 5 and 90, floor 0 = no hold, floor 50)', async () => {
  for (const [limit, floor] of [['5', '0'], ['90', '50']]) {
    const { renderMemoryGuard, saveMemoryGuard, el, saves } = loadMemoryGuard({ memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 } });
    await renderMemoryGuard();
    el('memory-guard-limit').value = limit;
    el('memory-guard-floor').value = floor;
    await saveMemoryGuard();
    assert.deepEqual(saves(), [JSON.stringify({ enabled: true, limitPercent: Number(limit), floorPercent: Number(floor) })]);
  }
});

test('saveMemoryGuard: a limit out of 5..90 (or empty) shows the field\'s error state and nothing is saved', async () => {
  for (const bad of ['4', '91', '']) {
    const { renderMemoryGuard, saveMemoryGuard, el, saves } = loadMemoryGuard({ memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 } });
    await renderMemoryGuard();
    el('memory-guard-limit').value = bad;
    await saveMemoryGuard();
    assert.equal(saves().length, 0, `limit "${bad}" was saved`);
    assert.equal(inError(el('memory-guard-limit')), true, `limit "${bad}" is not in its error state`);
    assert.equal(inError(el('memory-guard-floor')), false);
  }
});

test('saveMemoryGuard: a floor out of 0..50 shows the field\'s error state and nothing is saved', async () => {
  for (const bad of ['-1', '51']) {
    const { renderMemoryGuard, saveMemoryGuard, el, saves } = loadMemoryGuard({ memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 } });
    await renderMemoryGuard();
    el('memory-guard-floor').value = bad;
    await saveMemoryGuard();
    assert.equal(saves().length, 0, `floor "${bad}" was saved`);
    assert.equal(inError(el('memory-guard-floor')), true, `floor "${bad}" is not in its error state`);
    assert.equal(inError(el('memory-guard-limit')), false);
  }
});

test('saveMemoryGuard: fixing an invalid value clears the error state and saves', async () => {
  const { renderMemoryGuard, saveMemoryGuard, el, saves } = loadMemoryGuard({ memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 } });
  await renderMemoryGuard();
  el('memory-guard-limit').value = '95';
  await saveMemoryGuard();
  assert.equal(inError(el('memory-guard-limit')), true);
  el('memory-guard-limit').value = '30';
  await saveMemoryGuard();
  assert.equal(inError(el('memory-guard-limit')), false);
  assert.deepEqual(saves(), [JSON.stringify({ enabled: true, limitPercent: 30, floorPercent: 10 })]);
});
