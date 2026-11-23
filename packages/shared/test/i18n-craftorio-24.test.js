// #24 acceptance, written before the code: the product's own usage is named "Craftorio", not "Orchestrator" /
// "Orquestrador", in the header's usage widget and the Usage screen (packages/ui-kit/usage-widget.js,
// fronts/ai/views/usage/usage.js read these keys of packages/shared/i18n/en.json and pt-BR.json). The texts that
// mean the engine's orchestrator role (a run's orchestrator log, the roadmap's orchestrator) keep the word.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I18n = require('../i18n.js');

const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${lang}.json`), 'utf8'));
const PRODUCT_KEYS = ['shell.usage_orchestrator', 'usage.orchestrator', 'usage.orchestrator_share_of_this_month_s', 'usage_widget.orchestrator_usage_in_month'];

for (const lang of ['en', 'pt-BR']) {
  for (const key of PRODUCT_KEYS) {
    test(`#24 ${lang}.json ${key} says "Craftorio", not Orchestrator / Orquestrador`, () => {
      const v = catalog(lang)[key];
      assert.equal(typeof v, 'string', `${lang}.json has ${key}`);
      assert.match(v, /Craftorio/, v);
      assert.doesNotMatch(v, /orchestrator|orquestrador/i, v);
    });
  }
}

test('#24 the usage widget\'s tooltip, through t(), names Craftorio in English and Portuguese', () => {
  const params = { month: 'November', total: '1,000', costUsd: '$1.00', status: 'ok' };
  for (const lang of ['en', 'pt-BR']) {
    const s = I18n.t('usage_widget.orchestrator_usage_in_month', params, lang);
    assert.match(s, /\bCraftorio\b/, `${lang}: ${s}`);
    assert.doesNotMatch(s, /orchestrator|orquestrador/i, `${lang}: ${s}`);
    assert.match(s, /1,000/, `${lang}: the placeholders still filled: ${s}`);
  }
});

test('#24 guard: the engine\'s orchestrator role keeps its name (the run\'s orchestrator log)', () => {
  assert.equal(catalog('en')['run_list.follow_the_orchestrator_log'], 'Follow the orchestrator log in a terminal');
  assert.match(catalog('pt-BR')['run_list.follow_the_orchestrator_log'], /orquestrador/);
});

test('#24 guard: the engine\'s orchestrator role keeps its name (the roadmap\'s orchestrator)', () => {
  assert.equal(catalog('en')['backlog_roadmap.the_orchestrator'], 'The orchestrator');
  assert.equal(catalog('pt-BR')['backlog_roadmap.the_orchestrator'], 'O orquestrador');
});
