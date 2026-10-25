// packages/ui-kit/workflow-inputs.js (#340): clicking the toggles of a `multiple: true` enum (the
// Start panel's Language "js,rust"). The module wires one click listener on the document; it runs
// here in a vm sandbox with a few plain objects standing for the field, its toggles and its hidden
// input. Assertions compare strings only (testing-principles: never a sandbox object).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'workflow-inputs.js'), 'utf8');

// One Language field with a toggle per value; returns the click on a toggle and the state read back.
function languageField(values, value) {
  const listeners = {};
  const field = { dataset: {} };
  const input = {
    type: 'hidden', value, dataset: { wiInput: 'language', wiMulti: '1' }, changes: 0,
    closest: (sel) => (sel === '.wi-field' ? field : null),
    dispatchEvent(ev) { if (ev.type === 'change') this.changes += 1; },
  };
  const buttons = values.map((v) => {
    const b = {
      dataset: { wiPill: v }, attrs: {}, classes: new Set(),
      classList: { toggle: (c, on) => (on ? b.classes.add(c) : b.classes.delete(c)) },
      setAttribute: (k, val) => { b.attrs[k] = val; },
      closest: (sel) => (sel === '[data-wi-pill]' ? b : sel === '.wi-field' ? field : null),
    };
    return b;
  });
  field.querySelector = (sel) => (sel.startsWith('[data-wi-input') ? input : null);
  field.querySelectorAll = (sel) => (sel === '[data-wi-pill]' ? buttons : []);
  const document = { body: null, addEventListener: (type, fn) => { listeners[type] = fn; } };
  class Event { constructor(type) { this.type = type; } }
  vm.runInContext(SRC, vm.createContext({ document, Event, window: {} }));
  const click = (v) => listeners.click({ target: buttons[values.indexOf(v)] });
  const state = () => ({
    value: String(input.value),
    on: buttons.filter((b) => b.attrs['aria-checked'] === 'true').map((b) => b.dataset.wiPill).join(','),
    touched: field.dataset.wiTouched === '1',
    changes: input.changes,
  });
  return { click, state };
}

test('multi toggles: turning a value on adds it at the end, so the main language stays first', () => {
  const f = languageField(['js', 'python', 'rust'], 'rust');
  f.click('js');
  assert.deepEqual(f.state(), { value: 'rust,js', on: 'js,rust', touched: true, changes: 1 });
});

test('multi toggles: turning a value off removes it and keeps the others in their order', () => {
  const f = languageField(['js', 'python', 'rust'], 'rust,python,js');
  f.click('python');
  assert.equal(f.state().value, 'rust,js');
  assert.equal(f.state().on, 'js,rust');
});

test('multi toggles: the last value that is on cannot be turned off (no change, no event)', () => {
  const f = languageField(['js', 'rust'], 'rust');
  f.click('rust');
  // on: '' = no toggle was redrawn (the fake field starts undrawn)
  assert.deepEqual(f.state(), { value: 'rust', on: '', touched: false, changes: 0 });
});
