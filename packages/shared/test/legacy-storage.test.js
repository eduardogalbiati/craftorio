// T2c: what a browser kept before the rename to Craftorio comes back under the new names: the
// preferences (multiagent.<name> -> craftorio.<name>, once), and the shared module runs it before the kit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { migrateLegacyStorage } = require('../legacy-storage');

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

test('T2c the old preference keys are copied to the new names once and removed; other keys stay', () => {
  const s = memoryStorage({ 'multiagent.currentProject': 'p1', 'multiagent.city.theme': 'dark', other: 'x' });
  assert.deepEqual(migrateLegacyStorage(s).sort(), ['craftorio.city.theme', 'craftorio.currentProject']);
  assert.deepEqual(s.dump(), { other: 'x', 'craftorio.currentProject': 'p1', 'craftorio.city.theme': 'dark' });
  assert.deepEqual(migrateLegacyStorage(s), [], 'a second load has nothing to copy');
});

test('T2c a value already under the new name wins over the old one', () => {
  const s = memoryStorage({ 'multiagent.navCollapsed': '1', 'craftorio.navCollapsed': '0' });
  assert.deepEqual(migrateLegacyStorage(s), []);
  assert.deepEqual(s.dump(), { 'craftorio.navCollapsed': '0' });
});

test('T2c no storage (Node, a blocked browser): nothing happens', () => {
  assert.deepEqual(migrateLegacyStorage(null), []);
});

test('T2c the page loads the shared modules (legacy-storage.js among them) before the UI kit', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'apps', 'desktop', 'renderer', 'index.html'), 'utf8');
  const legacy = html.indexOf('packages/shared/legacy-storage.js');
  const kit = html.indexOf('<script src="../../../packages/ui-kit/');
  assert.ok(legacy > 0, 'legacy-storage.js is on the page');
  assert.ok(kit > 0 && legacy < kit, 'it loads before the kit reads any preference');
});
