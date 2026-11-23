// #23 acceptance, written before the code: the second pt-BR pass's vocabulary in the catalogs
// (packages/shared/i18n/en.json, pt-BR.json) and the City card's district count as a plural, read through t().
//
// The contract assumed here:
// - one word per thing in pt-BR: the onboarding (wizard, Next steps) says "Caixa de entrada", never "Inbox"; the
//   profile is "Jeito de trabalhar" everywhere (no value says "Formas de trabalho"); the Oracle is "Oracle", never
//   "Oráculo";
// - onboarding.review_city is a plural ({ one, other }) in both catalogs, its form picked by params.count (the
//   district count, also passed as {districts}); pt-BR counts with the City tab's word: "1 bairro", "2 bairros".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I18n = require('../i18n.js');

const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${lang}.json`), 'utf8'));
const textsOf = (value) => (value && typeof value === 'object' ? Object.values(value) : [value]).map(String);
const keysSaying = (cat, re, scope = () => true) => Object.keys(cat).filter((k) => scope(k) && textsOf(cat[k]).some((s) => re.test(s)));

test('#23 pt-BR: no onboarding text (wizard, Next steps) says "Inbox": it is "Caixa de entrada"', () => {
  const pt = catalog('pt-BR');
  assert.deepEqual(keysSaying(pt, /\bInbox\b/, (k) => k.startsWith('onboarding.')), []);
  assert.match(pt['onboarding.open_inbox'], /Caixa de entrada/i);
  assert.match(textsOf(pt['onboarding.review_idea_help']).join(' '), /Caixa de entrada/i);
});

test('#23 pt-BR: one name for the profile, no value says "Formas de trabalho"', () => {
  const pt = catalog('pt-BR');
  assert.deepEqual(keysSaying(pt, /Formas de trabalho/i), []);
  assert.equal(pt['project.ways_of_working'], 'Jeito de trabalhar');
  assert.match(pt['onboarding.job_profile'], /Jeito de trabalhar/);
});

test('#23 pt-BR: no value says "Oráculo": the Oracle keeps its name', () => {
  const pt = catalog('pt-BR');
  assert.deepEqual(keysSaying(pt, /Oráculo/i), []);
  assert.match(textsOf(pt['onboarding.review_findings_empty']).join(' '), /Oracle/);
});

test('#23 onboarding.review_city is a plural with "one" and "other" in en.json and pt-BR.json', () => {
  for (const lang of ['en', 'pt-BR']) {
    const v = catalog(lang)['onboarding.review_city'];
    assert.equal(v !== null && typeof v === 'object', true, `${lang}: a plural object, got ${JSON.stringify(v)}`);
    assert.deepEqual(['one', 'other'].map((f) => typeof v[f] === 'string' && v[f].length > 0), [true, true], `${lang}: ${JSON.stringify(v)}`);
  }
});

test('#23 t(onboarding.review_city) in pt-BR: "1 bairro" for one district, never "1 zonas"', () => {
  const s = I18n.t('onboarding.review_city', { count: 1, districts: 1, files: 12 }, 'pt-BR');
  assert.match(s, /\b1 bairro\b/, s);
  assert.equal(s.includes('bairros'), false, s);
  assert.equal(/zona/i.test(s), false, s);
  assert.match(s, /\b12 arquivos\b/, s);
});

test('#23 t(onboarding.review_city) in pt-BR: "2 bairros" for two districts', () => {
  const s = I18n.t('onboarding.review_city', { count: 2, districts: 2, files: 12 }, 'pt-BR');
  assert.match(s, /\b2 bairros\b/, s);
  assert.equal(/zona/i.test(s), false, s);
});

test('#23 t(onboarding.review_city) in English: singular for one district, plural for two', () => {
  const one = I18n.t('onboarding.review_city', { count: 1, districts: 1, files: 12 }, 'en');
  const two = I18n.t('onboarding.review_city', { count: 2, districts: 2, files: 12 }, 'en');
  // the files part ("12 files") left out: the district count alone
  const districtsPart = (s) => s.replace(/\b12 files\b/, '');
  assert.match(districtsPart(one), /\b1 [a-z]+\b/, one);
  assert.equal(/\b1 [a-z]+s\b/.test(districtsPart(one)), false, `singular for one: ${one}`);
  assert.match(districtsPart(two), /\b2 [a-z]+s\b/, two);
});
