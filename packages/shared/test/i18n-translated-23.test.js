// #23: I18n.translated(key, fallback) — a text with an English original outside the catalog (a workflow file,
// a seed row, the engine's line): the original in English, the key's text in another language, the original
// when no catalog has the key.
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('../i18n.js');

test('#23 translated: English shows the original, pt-BR the catalog text, a missing key the original', (t) => {
  t.after(() => I18n.setLanguage('en'));
  I18n.setLanguage('en');
  assert.equal(I18n.translated('settings.machine.unread', 'From the file'), 'From the file');
  assert.equal(I18n.translated('settings.machine.unread', ''), I18n.t('settings.machine.unread'), 'no original: the English catalog text');
  I18n.setLanguage('pt-BR');
  assert.equal(I18n.translated('settings.machine.unread', 'From the file'), I18n.t('settings.machine.unread', null, 'pt-BR'));
  assert.equal(I18n.translated('no.such.key_23', 'From the file'), 'From the file');
  assert.equal(I18n.translated('no.such.key_23'), '');
});
