// #28 acceptance, written before the code: the catalogs (packages/shared/i18n/en.json, pt-BR.json) read through
// t() (packages/shared/i18n.js) for the screens of a first issue in pt-BR.
//
// The contract assumed here:
// - inbox.inbox (the Inbox's title) says "Caixa de entrada" in pt-BR, the word the onboarding already uses;
// - a count of zero takes the plural in pt-BR: "0 issues", "0 itens", "em 0 etapas", "0 desativadas" (Intl's pt
//   rules file 0 under "one"; the fix may be in t() or in the catalog, the output is what is checked); one stays
//   singular, two plural. Keys: backlog.issues_count (the Backlog's count), backlog_roadmap.items_count,
//   backlog_roadmap.stat_in_stages, backlog_roadmap.stat_disabled (the Roadmap's summary);
// - the Setup's First project step (setup.* keys) no longer tells a created project's owner that New project
//   "imports a repository" nor that Finish "opens Start" (Concluir stays on the project page).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I18n = require('../i18n.js');

const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${lang}.json`), 'utf8'));
const textsOf = (value) => (value && typeof value === 'object' ? Object.values(value) : [value]).map(String);
const keysSaying = (cat, re, scope = () => true) => Object.keys(cat).filter((k) => scope(k) && textsOf(cat[k]).some((s) => re.test(s)));

test('#28 pt-BR: inbox.inbox is "Caixa de entrada"', () => {
  assert.equal(catalog('pt-BR')['inbox.inbox'], 'Caixa de entrada');
});

test('#28 pt-BR: the Backlog\'s issue count says "0 issues" for zero', () => {
  assert.equal(I18n.t('backlog.issues_count', { count: 0 }, 'pt-BR'), '0 issues');
});

test('#28 pt-BR: the Backlog\'s issue count says "1 issue" for one and "2 issues" for two', () => {
  assert.deepEqual([1, 2].map((count) => I18n.t('backlog.issues_count', { count }, 'pt-BR')), ['1 issue', '2 issues']);
});

test('#28 pt-BR: the Roadmap\'s item count says "0 itens" for zero', () => {
  assert.equal(I18n.t('backlog_roadmap.items_count', { count: 0 }, 'pt-BR'), '0 itens');
});

test('#28 pt-BR: the Roadmap\'s stage count says "em 0 etapas" for zero', () => {
  assert.equal(I18n.t('backlog_roadmap.stat_in_stages', { count: 0 }, 'pt-BR'), 'em 0 etapas');
});

test('#28 pt-BR: the Roadmap\'s disabled count says "0 desativadas" for zero', () => {
  assert.equal(I18n.t('backlog_roadmap.stat_disabled', { count: 0 }, 'pt-BR'), '0 desativadas');
});

test('#28 en: a zero count stays plural ("0 issues")', () => {
  assert.equal(I18n.t('backlog.issues_count', { count: 0 }, 'en'), '0 issues');
});

test('#28 pt-BR Setup: no setup text says New project "importa um repositório"', () => {
  assert.deepEqual(keysSaying(catalog('pt-BR'), /importa um repositório/i, (k) => k.startsWith('setup.')), []);
});

test('#28 pt-BR Setup: no setup text says "Concluir abre o Iniciar"', () => {
  assert.deepEqual(keysSaying(catalog('pt-BR'), /Concluir abre o Iniciar/i, (k) => k.startsWith('setup.')), []);
});
