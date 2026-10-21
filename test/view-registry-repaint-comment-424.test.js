// #424 src/renderer/view-registry.js repaintNodes: a comment drawn at a markup's top level (nodesOf
// keeps every top node, comments included) is skipped, so a language change goes on to redraw the
// rest (it threw "getAttribute is not a function" and InterfaceLanguage.apply stopped before
// I18n.notify(), leaving Settings › Language in the previous language). Stubs as in
// view-registry-repaint-330.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'view-registry.js'), 'utf8');

function repaintNodes() {
  const sandbox = { document: {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.ViewRegistry.repaintNodes;
}

const text = (value) => ({ nodeName: '#text', nodeType: 3, nodeValue: value, isConnected: true });
const comment = (value) => ({ nodeName: '#comment', nodeType: 8, nodeValue: value, isConnected: true });

test('repaintNodes: a top-level comment is skipped and the texts after it are repainted', () => {
  const live = [comment(' a note '), text('Sync')];
  const before = [comment(' a note '), text('Sync')];
  const after = [comment(' a note '), text('Sincronizar')];
  assert.equal(repaintNodes()(live, before, after), true);
  assert.equal(live[0].nodeValue, ' a note ');
  assert.equal(live[1].nodeValue, 'Sincronizar');
});
