// #287 src/roadmap-merge.js: an edit based on an older read applied to the stored stages, by id
// (the developer's tests of the cases the acceptance tests do not reach; pure, no files).
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeEdit, onStored } = require('../src/roadmap-merge');

const clone = (x) => JSON.parse(JSON.stringify(x));
const item = (id, issues, inputs = {}) => ({ id, workflow: 'w.yaml', issues: issues.map((number) => ({ number })), inputs, mock: false, status: 'planned' });
const read = () => [
  { id: 's1', name: 'One', note: '', items: [item('a', [1]), item('b', [2])] },
  { id: 's2', name: 'Two', note: '', items: [item('c', [3])] },
];
const ids = (stages) => stages.map((s) => [s.id, s.items.map((x) => x.id)]);
const numbers = (x) => x.issues.map((i) => i.number);

test('#287 merge: an item moved to another stage lands there, after the item before it in the edit', () => {
  const edited = clone(read());
  const [b] = edited[0].items.splice(1, 1);
  edited[1].items.push(b);
  const current = clone(read());
  current[1].items.push(item('d', [4])); // added elsewhere
  const out = mergeEdit(read(), edited, current);
  assert.ok(out.ok, out.reason);
  assert.deepEqual(ids(out.stages), [['s1', ['a']], ['s2', ['c', 'b', 'd']]]);
});

test('#287 merge: a new order of the items is applied, an item added elsewhere keeps its place', () => {
  const edited = clone(read());
  edited[0].items.reverse();
  const current = clone(read());
  current[0].items.push(item('d', [4]));
  const out = mergeEdit(read(), edited, current);
  assert.ok(out.ok, out.reason);
  assert.deepEqual(ids(out.stages)[0], ['s1', ['b', 'a', 'd']]);
});

test('#287 merge: an issue taken out of an item goes, one appended elsewhere stays', () => {
  const base = read();
  base[0].items[0].issues.push({ number: 5 });
  const edited = clone(base);
  edited[0].items[0].issues = [{ number: 1 }];
  const current = clone(base);
  current[0].items[0].issues.push({ number: 6 });
  const out = mergeEdit(base, edited, current);
  assert.ok(out.ok, out.reason);
  assert.deepEqual(numbers(out.stages[0].items[0]), [1, 6]);
});

test('#287 merge: inputs merge by key; a new stage of the edit comes after the stage before it', () => {
  const edited = clone(read());
  edited[0].items[0].inputs = { model: 'sonnet' };
  edited.splice(1, 0, { name: 'New', note: '', items: [item(undefined, [7])] });
  const current = clone(read());
  current[0].items[0].inputs = { language: 'go' };
  const out = mergeEdit(read(), edited, current);
  assert.ok(out.ok, out.reason);
  assert.deepEqual(out.stages[0].items[0].inputs, { language: 'go', model: 'sonnet' });
  assert.deepEqual(out.stages.map((s) => s.name), ['One', 'New', 'Two']);
});

test('#287 merge: removing an item changed elsewhere is refused; an item removed elsewhere and left as is by the edit stays out', () => {
  const edited = clone(read());
  edited[1].items = [];
  const current = clone(read());
  current[1].items[0].inputs = { model: 'haiku' };
  const out = mergeEdit(read(), edited, current);
  assert.equal(out.ok, false);
  assert.match(out.reason, /#3 was changed elsewhere.*Nothing was saved/);

  const gone = clone(read());
  gone[0].items.splice(1, 1);
  const ok = mergeEdit(read(), clone(read()).map((s, n) => (n === 1 ? { ...s, name: 'Later' } : s)), gone);
  assert.ok(ok.ok, ok.reason);
  assert.deepEqual(ids(ok.stages), [['s1', ['a']], ['s2', ['c']]]);
  assert.equal(ok.stages[1].name, 'Later');
});

test('#287 onStored: no base or the same updatedAt passes the edit as sent; an unknown read is refused', () => {
  const stored = { updatedAt: 'T2', stages: read() };
  const stages = [{ name: 'X', items: [] }];
  assert.equal(onStored({ stored, stages, base: null, read: null }).stages, stages);
  assert.equal(onStored({ stored, stages, base: 'T2', read: null }).stages, stages);
  const out = onStored({ stored, stages, base: 'T1', read: null });
  assert.equal(out.ok, false);
  assert.match(out.reason, /changed elsewhere/);
});
