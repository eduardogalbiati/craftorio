// #111 (acceptance tests, written before the code): Settings › Agents & CLIs' orchestrator choice
// (packages/ui-kit/views/settings/settings-clis.js, #set-orchestrator) shows the same Codex models warning as the
// Setup: when the account lacks the mapped Codex models, which ones it will use instead; with no usable model the
// Codex radio is disabled.
//
// Contract assumed: env:details gives the Codex entry `models` (the slugs the account offers); the orchestrator box
// holds data-testid="settings-codex-models-warning" (interface language) naming the model used instead (gpt-6-luna or
// GPT Luna) when a mapped model is missing; none with the full list or no list.
// Harness: renderer-app-harness.js; the box found as renderer-settings-clis-orchestrator-97.test.js finds it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');
const H = require('./page-pieces');
const clone = (x) => JSON.parse(JSON.stringify(x));

const READY = (id, name, extra = {}) => ({ id, name, path: `C:/bin/${id}.exe`, version: '1.0.0', connected: true, auth: true, ...extra });
const POOR = ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-reserve', 'codex-auto-review'];
const FULL = ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna'];
const NONE_USABLE = ['gpt-reserve', 'codex-auto-review'];

async function openClis(models, lang = 'en') {
  const tools = [READY('claude', 'Claude Code'), READY('codex', 'Codex CLI', models === undefined ? {} : { models }), READY('git', 'Git')];
  const app = loadApp({
    api: {
      platform: 'browser',
      getSettings: async () => ({ setupDone: true, language: { interface: lang } }),
      envDetails: async () => clone(tools),
      cliSetupStart: async (data) => ({ jobId: 'job-1', id: data?.id, action: data?.action, status: 'running', output: '' }),
    },
  });
  await app.boot();
  app.run('confirmDialog = async () => true;');
  if (app.sandbox.I18n.getLanguage() !== lang) app.sandbox.I18n.setLanguage(lang);
  await app.sandbox.Settings.open('agents');
  await app.settle(20);
  return app;
}

const orchestratorBox = (app) => {
  const el = app.created.find((e) => e.id === 'set-orchestrator') || app.elements.get('#set-orchestrator') || null;
  assert.ok(el, 'the #set-orchestrator box is drawn');
  return String(el.innerHTML || '');
};
const warningText = (app) => {
  const el = H.findEl(orchestratorBox(app), (e) => e.attrs['data-testid'] === 'settings-codex-models-warning');
  return el ? H.visibleText(el.inner).trim() : null;
};
const codexRadio = (app) => {
  let last = null;
  for (const el of H.findAll(orchestratorBox(app), (e) => e.name === 'input' && e.attrs.name === 'orchestrator' && e.attrs.value === 'codex')) last = el;
  assert.ok(last, 'the Codex orchestrator radio');
  return last;
};

test('#111 Settings › Agents & CLIs: the Codex models warning names gpt-6-luna when the account lacks the mapped models', async () => {
  const app = await openClis(POOR);
  const shown = warningText(app);
  assert.ok(shown, 'the models warning is shown');
  assert.ok(/gpt-6-luna|GPT Luna/.test(shown), `the model used instead is named: ${shown}`);
  assert.equal('disabled' in codexRadio(app).attrs, false, 'a fallback exists: Codex can still be chosen');
});

test('#111 Settings › Agents & CLIs: the warning follows the interface language (pt-BR differs from English)', async () => {
  const en = warningText(await openClis(POOR, 'en'));
  const pt = warningText(await openClis(POOR, 'pt-BR'));
  assert.ok(en && pt, `warning in both languages (en: ${en}, pt-BR: ${pt})`);
  assert.notEqual(pt, en);
});

test('#111 Settings › Agents & CLIs: with no usable Codex model the Codex radio is disabled and the warning shown', async () => {
  const app = await openClis(NONE_USABLE);
  assert.ok(warningText(app), 'the models warning is shown');
  assert.equal('disabled' in codexRadio(app).attrs, true, 'the Codex radio is disabled');
});

test('#111 Settings › Agents & CLIs: a partial fallback (only gpt-6.2-sol offered) warns and disables the Codex radio', async () => {
  const app = await openClis(['gpt-6.2-sol']);
  const shown = warningText(app);
  assert.ok(shown && shown.includes('gpt-6.1-terra') && shown.includes('gpt-6-luna'), `the models without a substitute: ${shown}`);
  assert.equal('disabled' in codexRadio(app).attrs, true, 'the Codex radio is disabled');
});

test('#111 Settings › Agents & CLIs: the full list, or no known list, shows no warning', async () => {
  for (const models of [FULL, undefined]) {
    const app = await openClis(models);
    assert.equal(warningText(app), null, `no warning with ${JSON.stringify(models)}`);
    assert.equal('disabled' in codexRadio(app).attrs, false);
  }
});
