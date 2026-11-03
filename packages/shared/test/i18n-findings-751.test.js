// #751: the Findings overlay's tool labels, its empty marks list, its undo and its capture failure
// message are in the catalogs, English and Brazilian Portuguese, under `findings.*` keys (whatever
// their names: the developer chooses them), the pt-BR value translated. The overlay's use of them is
// tested in packages/ui-kit/test/findings-capture-751.test.js. Acceptance tests written before the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const en = require('../i18n/en.json');
const pt = require('../i18n/pt-BR.json');

const text = (v) => (typeof v === 'string' ? v : v?.other || '');
const findingsKeys = (pred) => Object.keys(en).filter((k) => k.startsWith('findings.') && pred(text(en[k])));

// the overlay's English labels (packages/ui-kit/findings.js before #751)
for (const english of ['Pin', 'Circle', 'Box', 'Arrow', 'Freehand', 'No marks yet.']) {
  test(`#751 i18n: "${english}" is a findings.* key, translated in pt-BR`, () => {
    const keys = findingsKeys((v) => v === english);
    assert.ok(keys.length > 0, `no findings.* key reads "${english}" in en.json`);
    const translated = keys.filter((k) => text(pt[k]).trim() && text(pt[k]) !== english);
    assert.ok(translated.length > 0, `pt-BR.json: ${keys.map((k) => `${k} → ${pt[k]}`).join(', ')}`);
  });
}

test('#751 i18n: "Undo mark" reads "Desfazer marca" in pt-BR', () => {
  const keys = findingsKeys((v) => v === 'Undo mark');
  assert.ok(keys.length > 0, 'a findings.* key reading "Undo mark"');
  assert.ok(keys.some((k) => pt[k] === 'Desfazer marca'), keys.map((k) => `${k} → ${pt[k]}`).join(', '));
});

test('#751 i18n: a capture failure message in both languages (pt-BR: "capturar"), translated', () => {
  const keys = Object.keys(pt).filter((k) => k.startsWith('findings.') && /capturar/i.test(text(pt[k])));
  assert.ok(keys.length > 0, 'a findings.* pt-BR value saying the screen could not be captured ("Não foi possível capturar a tela…")');
  for (const k of keys) {
    assert.match(text(en[k]), /captur/i, `${k} in en.json`);
    assert.notEqual(text(pt[k]), text(en[k]), `${k}: translated in pt-BR`);
  }
});
