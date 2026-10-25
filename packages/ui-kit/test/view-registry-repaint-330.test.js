// #330 packages/ui-kit/view-registry.js repaintNodes: a language change puts the new texts on a drawn
// markup in place (mount() does not run again), matched node by node with the markup drawn before.
// Only what still shows the previous language's text changes: what the screen drew since stays.
// Nodes are small stubs (nodeName, nodeType, nodeValue, attributes), the way view-registry.test.js
// stubs the DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'view-registry.js'), 'utf8');

function repaintNodes() {
  const sandbox = { document: {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.ViewRegistry.repaintNodes;
}

const text = (value) => ({ nodeName: '#text', nodeType: 3, nodeValue: value, isConnected: true });
function el(name, attrs = {}) {
  const a = { ...attrs };
  return {
    nodeName: name, nodeType: 1, isConnected: true, attrs: a,
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => { a[k] = String(v); },
  };
}

test('repaintNodes: the texts and labelled attributes still in the old language take the new one', () => {
  const live = [el('BUTTON', { title: 'Sync now', 'data-x': 'a' }), text('Sync'), el('INPUT', { placeholder: 'Search' })];
  const before = [el('BUTTON', { title: 'Sync now', 'data-x': 'a' }), text('Sync'), el('INPUT', { placeholder: 'Search' })];
  const after = [el('BUTTON', { title: 'Sincronizar agora', 'data-x': 'b' }), text('Sincronizar'), el('INPUT', { placeholder: 'Buscar' })];
  assert.equal(repaintNodes()(live, before, after), true);
  assert.equal(live[0].attrs.title, 'Sincronizar agora');
  assert.equal(live[0].attrs['data-x'], 'a', 'only the labelled attributes are repainted');
  assert.equal(live[1].nodeValue, 'Sincronizar');
  assert.equal(live[2].attrs.placeholder, 'Buscar');
});

test('repaintNodes: what the screen changed since it was drawn stays', () => {
  const live = [el('SPAN', { title: '3 runs' }), text('42 issues')];
  const before = [el('SPAN', { title: 'Runs' }), text('Issues')];
  const after = [el('SPAN', { title: 'Execuções' }), text('Issues (pt)')];
  assert.equal(repaintNodes()(live, before, after), true);
  assert.equal(live[0].attrs.title, '3 runs');
  assert.equal(live[1].nodeValue, '42 issues');
});

test('repaintNodes: a node removed since is skipped; a different structure is refused', () => {
  const gone = Object.assign(text('Old'), { isConnected: false });
  assert.equal(repaintNodes()([gone], [text('Old')], [text('Novo')]), true);
  assert.equal(gone.nodeValue, 'Old');
  assert.equal(repaintNodes()([text('A')], [text('A')], [text('A'), text('B')]), false, 'another node count');
  assert.equal(repaintNodes()([text('A')], [text('A')], [el('B')]), false, 'another node type');
});
