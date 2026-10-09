// #309: the agent editor's hex field needs one parser for what the owner types. Acceptance tests,
// written before the code: src/renderer/agent-colors.js (UMD, module.exports in Node) exports
// normalizeHex(input) → '#RRGGBB' uppercase for a valid colour (with or without '#', 3 or 6 digits,
// surrounding spaces ignored), null for anything else. isHex stays as it is.
const test = require('node:test');
const assert = require('node:assert/strict');

// resolved inside each test: the export does not exist until the change lands
const normalizeHex = (input) => {
  const mod = require('../src/renderer/agent-colors.js');
  assert.equal(typeof mod.normalizeHex, 'function', 'agent-colors.js exports normalizeHex (#309)');
  return mod.normalizeHex(input);
};

test('#309 normalizeHex: a 6-digit colour with # comes back uppercase', () => {
  assert.equal(normalizeHex('#aabbcc'), '#AABBCC');
});

test('#309 normalizeHex: a 6-digit colour without # gets its #', () => {
  assert.equal(normalizeHex('aabbcc'), '#AABBCC');
});

test('#309 normalizeHex: a 3-digit shorthand with # expands to 6 digits', () => {
  assert.equal(normalizeHex('#abc'), '#AABBCC');
});

test('#309 normalizeHex: a 3-digit shorthand without # expands and gets its #', () => {
  assert.equal(normalizeHex('ABC'), '#AABBCC');
});

test('#309 normalizeHex: surrounding spaces and mixed case are ignored', () => {
  assert.equal(normalizeHex('  #AaBbCc '), '#AABBCC');
});

test('#309 normalizeHex: letters outside 0-9 A-F are not a colour', () => {
  assert.equal(normalizeHex('#GG00ZZ'), null);
});

test('#309 normalizeHex: 5 digits are not a colour', () => {
  assert.equal(normalizeHex('#12345'), null);
});

test('#309 normalizeHex: 8 digits (an alpha channel) are not accepted', () => {
  assert.equal(normalizeHex('#AABBCCDD'), null);
});

test('#309 normalizeHex: an empty string and a lone # are not a colour', () => {
  assert.equal(normalizeHex(''), null);
  assert.equal(normalizeHex('#'), null);
});

test('#309 normalizeHex: null, undefined and a number are not a colour (no throw)', () => {
  assert.equal(normalizeHex(null), null);
  assert.equal(normalizeHex(undefined), null);
  assert.equal(normalizeHex(42), null);
});

test('#309 normalizeHex: a CSS colour name is not accepted', () => {
  assert.equal(normalizeHex('red'), null);
});
