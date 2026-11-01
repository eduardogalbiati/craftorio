// #654: adding a Product Owner proposal never pauses the roadmap (a running one keeps running), so
// the "Build a roadmap" paste hint (backlog_roadmap.paste_the_product_owner_s_build) must not promise
// that the pasted stages wait for Start.
const test = require('node:test');
const assert = require('node:assert/strict');

const KEY = 'backlog_roadmap.paste_the_product_owner_s_build';

test('the English "Build a roadmap" paste hint no longer says the stages never start until Start', () => {
  const en = require('../i18n/en.json');
  assert.equal(typeof en[KEY], 'string');
  assert.doesNotMatch(en[KEY], /never starts until Start|press Start/i);
});

test('the Portuguese "Build a roadmap" paste hint no longer says the stages never start until Start', () => {
  const pt = require('../i18n/pt-BR.json');
  assert.equal(typeof pt[KEY], 'string');
  assert.doesNotMatch(pt[KEY], /nunca inicia até Iniciar|pressione Iniciar/i);
});
