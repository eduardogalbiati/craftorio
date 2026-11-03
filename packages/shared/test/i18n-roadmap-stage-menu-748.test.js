// #748: the roadmap stage menu's renamed entries are in the catalogs, English and Brazilian
// Portuguese, under one key each (whatever its name: the developer chooses it, under
// `backlog_roadmap.*`). Acceptance tests written before the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const en = require('../i18n/en.json');
const pt = require('../i18n/pt-BR.json');

// [English, Brazilian Portuguese]: the stage menu's labels after #748
const LABELS = [
  ['Enable', 'Ativar'],
  ['Disable', 'Desativar'],
  ['Stop when finished', 'Parar após finalizar'],
  ['Stop now', 'Parar agora'],
  ['Release after this stage', 'Release após esse stage'],
  ['Move up', 'Mover para cima'],
  ['Move down', 'Mover para baixo'],
  ['Add note', 'Adicionar nota'],
  ['Edit note', 'Editar nota'],
  ['Remove from roadmap', 'Remover do roadmap'],
];

for (const [english, portuguese] of LABELS) {
  test(`#748 i18n: "${english}" is a backlog_roadmap key whose pt-BR value is "${portuguese}"`, () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('backlog_roadmap.') && en[k] === english);
    assert.ok(keys.length > 0, `no backlog_roadmap.* key reads "${english}" in en.json`);
    assert.deepEqual(keys.filter((k) => pt[k] === portuguese).length > 0, true, `pt-BR.json: ${keys.join(', ')} → ${keys.map((k) => pt[k]).join(', ')}`);
  });
}

test('#748 i18n: the Remove from roadmap confirmation names the stage and its item count in both languages', () => {
  const keys = Object.keys(en).filter((k) => k.startsWith('backlog_roadmap.') && /^Remove stage \{\w+\} and its/.test(typeof en[k] === 'string' ? en[k] : (en[k]?.other || '')));
  assert.ok(keys.length > 0, 'an en key like "Remove stage {stage} and its {count} items from the roadmap?"');
  const text = (v) => (typeof v === 'string' ? v : v?.other || '');
  for (const k of keys) {
    assert.match(text(en[k]), /\{count\}/, `${k}: the item count`);
    assert.ok(text(pt[k]).length > 0, `${k} in pt-BR.json`);
    assert.notEqual(text(pt[k]), text(en[k]), `${k}: translated in pt-BR`);
  }
});
