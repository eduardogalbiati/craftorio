// src/renderer/run-chat.js: it runs only inside the Electron renderer (document, window.Robots),
// so the pure `robot()` and `cardLines()` helpers are pulled out of the source and evaluated in a
// sandbox, the way test/renderer-run-summary.test.js checks app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { providerType } = require('../src/renderer/run-chat-model.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'run-chat.js'), 'utf8');

function loadHelpers() {
  const isSupervisor = /const isSupervisor = [^\n]+/.exec(src)[0];
  const robot = /function robot\(who, st = 'idle', opts = \{\}\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const providersMap = /const PROVIDERS = \{[^\n]+\};/.exec(src)[0];
  const modesMap = /const MODES = \{[^\n]+\};/.exec(src)[0];
  const cardLines = /function cardLines\(who\) \{[\s\S]*?\n  \}/.exec(src)[0];
  for (const [name, code] of Object.entries({ isSupervisor, robot, providersMap, modesMap, cardLines })) {
    assert.ok(code, `${name} not found in run-chat.js: the source moved`);
  }
  const sandbox = {
    providerType,
    Robots: {
      svg: (variant, st, opts) => ({ variant, st, ...opts }),
      variantFor: (type) => type,
      plaqueFor: (model) => model,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${isSupervisor}\n${robot}\n${providersMap}\n${modesMap}\n${cardLines}\n`
    + 'this.helpers = { robot, cardLines };',
    sandbox,
  );
  return sandbox.helpers;
}

const { robot, cardLines } = loadHelpers();

test('robot(): an agent on the left is mirrored to face right, toward the centre of the screen', () => {
  assert.equal(robot({ agent: 'developer', side: 'left', provider: 'claude', model: 'claude-opus-5-5' }).mirror, true);
  // no side yet (a typing indicator before the first turn): stays on the left, mirrored
  assert.equal(robot({ agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' }).mirror, true);
});

test('robot(): an agent on the right is not mirrored, so it faces left, toward the centre', () => {
  assert.equal(robot({ agent: 'developer', side: 'right', provider: 'claude', model: 'claude-opus-5-5' }).mirror, false);
});

test('robot(): the supervisor is always mirrored, whatever side it is given', () => {
  assert.equal(robot({ agent: 'supervisor', side: 'right' }).mirror, true);
  assert.equal(robot({ agent: '_supervisor' }).mirror, true);
});

test('cardLines(): the hover card shows provider, model and effort, then the session mode and turn', () => {
  // spread into a plain array: the sandbox's Array is a different realm than assert's
  const lines = [...cardLines({ agent: 'developer', provider: 'claude', model: 'claude-opus-5-5', effort: 'high', mode: 'persistent', turn: 3 })];
  assert.deepEqual(lines, ['Claude · claude-opus-5-5 · effort high', 'persistent session · turn 3']);
});

test('cardLines(): missing effort, mode and turn are left out, not shown as blanks', () => {
  const lines = [...cardLines({ agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' })];
  assert.deepEqual(lines, ['Claude · claude-opus-5-5']);
});

test('cardLines(): a simulated session says so next to its provider', () => {
  const [first] = cardLines({ agent: 'developer', provider: 'mock', model: 'claude-opus-5-5' });
  assert.match(first, /\(simulated\)/);
});

test('turnHtml: a message on the right gets the rc-right class', () => {
  assert.match(src, /rc-\$\{it\.side === 'right' \? 'right' : 'left'\}/);
});
