// #111 (acceptance tests, written before the code): the first-run Setup's AIs step (packages/ui-kit/setup.js, cliCard,
// packages/shared/setup-model.js) warns on the Codex card when the account lacks the models Codex runs on as the
// orchestrator (#97 mapping) and names the ones it will use instead; with no usable Codex model, Codex cannot be
// chosen as the orchestrator (its radio disabled, like a CLI that is not ready). Claude's card never warns.
//
// Contract assumed:
// - env:details gives the Codex entry `models`: the slugs the account offers (no `models` when nothing is known);
// - the Codex card (data-testid="setup-cli-codex") holds a warning data-testid="setup-codex-models-warning", in the
//   interface language, when a mapped model (gpt-6.2-astra, gpt-6.2-sol, gpt-6.1-terra, gpt-6-luna) is missing; it
//   names the model used instead (slug gpt-6-luna or its label GPT Luna); no warning with the full list or no list;
// - with no usable model (only gpt-reserve / codex-auto-review) the warning is shown and the radio
//   data-testid="setup-orchestrator-codex" is disabled.
// Driven on the real page (renderer-app-harness.js); markup read as strings (page-pieces.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');
const H = require('./page-pieces');

const READY = (id, name, extra = {}) => ({ id, name, path: `/usr/bin/${id}`, version: '1.0.0', connected: true, auth: true, ...extra });
const OTHERS = [READY('gh', 'GitHub CLI'), READY('git', 'Git'), READY('gitleaks', 'gitleaks')];
const POOR = ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-reserve', 'codex-auto-review'];
const FULL = ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna'];
const NONE_USABLE = ['gpt-reserve', 'codex-auto-review'];

async function openSetup({ models, lang = 'en', settings = {} }) {
  let saved = { setupDone: true, language: { interface: lang }, ...settings };
  const codex = READY('codex', 'Codex CLI', models === undefined ? {} : { models });
  const app = loadApp({
    api: {
      getSettings: async () => JSON.parse(JSON.stringify(saved)),
      setSettings: async (patch) => { saved = { ...saved, ...JSON.parse(JSON.stringify(patch || {})) }; return JSON.parse(JSON.stringify(saved)); },
      listWorkflows: async () => [],
      listProjects: async () => [],
      envDetails: async () => JSON.parse(JSON.stringify([READY('claude', 'Claude Code'), codex, READY('grok', 'Grok Build'), ...OTHERS])),
      machineProfile: async () => ({ line: '8 cores' }),
    },
  });
  await app.boot();
  app.run('confirmDialog = async () => true;');
  if (app.sandbox.I18n.getLanguage() !== lang) app.sandbox.I18n.setLanguage(lang);
  await app.run('window.Setup.open("agents")');
  await app.settle(20);
  assert.equal(app.run('window.Setup.isOpen()'), true, 'the Setup is open');
  return app;
}

const body = (app) => String(app.el('#setup-modal #setup-body').innerHTML || '');
const card = (app, id) => {
  const el = H.findEl(body(app), (e) => e.attrs['data-testid'] === `setup-cli-${id}`);
  assert.ok(el, `the ${id} card is drawn`);
  return el.outer;
};
const warningText = (html) => {
  const el = H.findEl(html, (e) => e.attrs['data-testid'] === 'setup-codex-models-warning');
  return el ? H.visibleText(el.inner).trim() : null;
};
const codexRadio = (app) => {
  const el = H.findEl(card(app, 'codex'), (e) => e.name === 'input' && e.attrs['data-testid'] === 'setup-orchestrator-codex');
  assert.ok(el, 'the Codex orchestrator radio');
  return el;
};

test('#111 Setup: the Codex card warns when the account lacks the mapped models and names gpt-6-luna as the one used', { timeout: 30000 }, async () => {
  const app = await openSetup({ models: POOR });
  const shown = warningText(card(app, 'codex'));
  assert.ok(shown, 'the Codex card shows the models warning');
  assert.ok(/gpt-6-luna|GPT Luna/.test(shown), `the model used instead is named: ${shown}`);
  assert.equal('disabled' in codexRadio(app).attrs, false, 'a fallback exists: Codex can still be chosen');
});

test('#111 Setup: the Codex models warning follows the interface language (pt-BR differs from English)', { timeout: 30000 }, async () => {
  const en = warningText(card(await openSetup({ models: POOR, lang: 'en' }), 'codex'));
  const pt = warningText(card(await openSetup({ models: POOR, lang: 'pt-BR' }), 'codex'));
  assert.ok(en && pt, `warning in both languages (en: ${en}, pt-BR: ${pt})`);
  assert.notEqual(pt, en, 'the pt-BR warning is not the English one');
});

test('#111 Setup: with no usable Codex model the card warns and Codex cannot be chosen as the orchestrator', { timeout: 30000 }, async () => {
  const app = await openSetup({ models: NONE_USABLE });
  assert.ok(warningText(card(app, 'codex')), 'the Codex card shows the models warning');
  assert.equal('disabled' in codexRadio(app).attrs, true, 'the Codex radio is disabled');
});

test('#111 Setup: the full model list, or no known list, shows no warning and leaves Codex choosable', { timeout: 30000 }, async () => {
  for (const models of [FULL, undefined]) {
    const app = await openSetup({ models });
    assert.equal(warningText(card(app, 'codex')), null, `no warning with ${JSON.stringify(models)}`);
    assert.equal('disabled' in codexRadio(app).attrs, false, `Codex choosable with ${JSON.stringify(models)}`);
  }
});

test('#111 Setup: the Claude Code card never shows the Codex models warning', { timeout: 30000 }, async () => {
  const app = await openSetup({ models: NONE_USABLE });
  assert.equal(warningText(card(app, 'claude')), null);
});
