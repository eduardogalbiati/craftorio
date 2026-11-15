// #833: the 3D view's HUD labels. The Cost card's $/M line and the new Tokens card read their text
// from the catalogs (en, pt-BR); the output-only line under the cost is gone.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const catalog = (lang) => require(path.join(__dirname, '..', '..', 'shared', 'i18n', `${lang}.json`));
const placeholders = (s) => (String(s).match(/\{[a-z_]+\}/g) || []).sort();

for (const lang of ['en', 'pt-BR']) {
  test(`${lang}: the Cost card's $/M and the Tokens card's labels are in the catalog`, () => {
    const c = catalog(lang);
    for (const key of ['run3d.cost_per_m', 'run3d.tokens', 'run3d.tokens_split', 'run3d.tokens_title']) {
      assert.equal(typeof c[key], 'string', `${key} missing`);
      assert.notEqual(c[key].trim(), '', `${key} empty`);
    }
    assert.deepEqual(placeholders(c['run3d.cost_per_m']), ['{cost}']);
    assert.deepEqual(placeholders(c['run3d.tokens_split']), ['{output}', '{share}']);
    assert.deepEqual(placeholders(c['run3d.tokens_title']), ['{cache_read}', '{cache_write}', '{input}', '{output}']);
  });

  test(`${lang}: the output-only line under the cost is gone`, () => {
    assert.equal('run3d.output_tokens' in catalog(lang), false);
  });
}
