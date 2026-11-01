// #647 Write doc phase 1: the Documents screen's texts (packages/shared/i18n/*.json, flat dotted keys):
// the menu label nav.docs and the screen's docs.* keys, each with its pt-BR translation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${lang}.json`), 'utf8'));
const docsKeys = (c) => Object.keys(c).filter((k) => k.startsWith('docs.'));

test('#647 the English catalog labels the Documents menu entry', () => {
  assert.equal(catalog('en')['nav.docs'], 'Documents');
});

test('#647 the English catalog has the Documents screen\'s docs.* texts', () => {
  assert.equal(docsKeys(catalog('en')).length > 0, true);
});

test('#647 the pt-BR catalog translates nav.docs and every docs.* key of the English one', () => {
  const en = catalog('en');
  const pt = catalog('pt-BR');
  const keys = ['nav.docs', ...docsKeys(en)];
  assert.equal(keys.length > 1, true, 'no docs.* key in en.json');
  assert.deepEqual(keys.filter((k) => typeof pt[k] !== 'string' || !pt[k].trim()), []);
});
