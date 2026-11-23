// #30 the environment failure of the rule checks and the onboarding's dependency install are in both
// catalogs (packages/shared/i18n/en.json, pt-BR.json). Acceptance tests written before the code.
// Assumed keys:
//   engine.check_deps_missing: the one-line cause of rule_check's environment failure, with {dir}
//     (packages/engine/engine/check-step.js; pt-BR "as dependências do projeto não estão instaladas: rode npm ci em {dir}");
//   engine.check_environment_retry: the check_environment gate's retry choice ("Try again" / "Tentar de novo");
//   onboarding.deps_missing: the wizard's line after the clone (the dependencies are not installed, the machine
//     checks need them: npm ci);
//   onboarding.deps_install: the wizard's button that installs them.
const test = require('node:test');
const assert = require('node:assert/strict');
const en = require('../i18n/en.json');
const pt = require('../i18n/pt-BR.json');

const KEYS = ['engine.check_deps_missing', 'engine.check_environment_retry', 'onboarding.deps_missing', 'onboarding.deps_install'];
const text = (v) => (typeof v === 'string' ? v : '');

test('#30 i18n: the keys exist in en.json and pt-BR.json, none empty, each translated', () => {
  const missing = (cat) => KEYS.filter((k) => !text(cat[k]).trim());
  assert.deepEqual([missing(en), missing(pt)], [[], []]);
  assert.deepEqual(KEYS.filter((k) => text(pt[k]) === text(en[k])), []);
});

test('#30 i18n: the environment cause reads "as dependências do projeto não estão instaladas: rode npm ci em {dir}" in pt-BR', () => {
  assert.equal(pt['engine.check_deps_missing'], 'as dependências do projeto não estão instaladas: rode npm ci em {dir}');
});

test('#30 i18n: the environment cause names npm ci and {dir} in English', () => {
  assert.equal(text(en['engine.check_deps_missing']).includes('npm ci'), true, en['engine.check_deps_missing']);
  assert.equal(text(en['engine.check_deps_missing']).includes('{dir}'), true, en['engine.check_deps_missing']);
});

test('#30 i18n: the retry choice reads Try again / Tentar de novo', () => {
  assert.equal(en['engine.check_environment_retry'], 'Try again');
  assert.equal(pt['engine.check_environment_retry'], 'Tentar de novo');
});

test('#30 i18n: the onboarding line mentions npm ci in both languages and "dependências" in pt-BR', () => {
  assert.equal(text(en['onboarding.deps_missing']).includes('npm ci'), true, en['onboarding.deps_missing']);
  assert.equal(text(pt['onboarding.deps_missing']).includes('npm ci'), true, pt['onboarding.deps_missing']);
  assert.equal(text(pt['onboarding.deps_missing']).includes('dependências'), true, pt['onboarding.deps_missing']);
});
