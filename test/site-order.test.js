// site/assets/order.js: the public page puts an item after the items it depends on (`depends_on:` in
// docs/work/CONVENTIONS.md) within its group, keeps the rest of the order, and ignores missing folders
// and cycles. Seam: the module itself, required as CommonJS (the page loads it as window.SdlcOrder).
const test = require('node:test');
const assert = require('node:assert/strict');
const { dependsOn, orderByDeps } = require('../site/assets/order');

const names = (list) => list.map((i) => i.name);
const group = (i) => i.group;

test('dependsOn reads a string, a list, and nothing', () => {
  assert.deepEqual(dependsOn('write-doc'), ['write-doc']);
  assert.deepEqual(dependsOn('write-doc, first-project-onboarding'), ['write-doc', 'first-project-onboarding']);
  assert.deepEqual(dependsOn(['write-doc', ' x ']), ['write-doc', 'x']);
  assert.deepEqual(dependsOn(''), []);
  assert.deepEqual(dependsOn(undefined), []);
  assert.deepEqual(dependsOn('../escape'), [], 'a path is not a folder name');
});

test('an item moves after the item it depends on, in the same group; the rest keeps its order', () => {
  const items = [
    { name: 'onboarding', group: 'progress' },
    { name: 'mockups', group: 'planned', deps: ['write-doc'] },
    { name: 'other', group: 'planned' },
    { name: 'write-doc', group: 'planned' },
    { name: 'shipped', group: 'shipped' },
  ];
  assert.deepEqual(names(orderByDeps(items, group)), ['onboarding', 'write-doc', 'mockups', 'other', 'shipped']);
});

test('a dependency already before stays put; chains follow', () => {
  const items = [
    { name: 'a', group: 'planned' },
    { name: 'c', group: 'planned', deps: ['b'] },
    { name: 'b', group: 'planned', deps: ['a'] },
  ];
  assert.deepEqual(names(orderByDeps(items, group)), ['a', 'b', 'c']);
});

test('a missing folder, another group and a cycle are ignored, and every item stays', () => {
  const items = [
    { name: 'x', group: 'planned', deps: ['nowhere', 'done'] },
    { name: 'y', group: 'planned', deps: ['z'] },
    { name: 'z', group: 'planned', deps: ['y'] },
    { name: 'done', group: 'shipped' },
  ];
  const out = orderByDeps(items, group);
  assert.deepEqual(names(out), ['x', 'z', 'y', 'done']);
  assert.equal(new Set(out).size, items.length);
});
