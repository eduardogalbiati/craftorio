// #111 (acceptance tests, written before the code): Start refuses a Codex run only when the account offers no
// usable Codex model at all, with the message in the interface language; a mapped model the account lacks but that
// has a fallback (orchestrator-models codexFallback) is no longer a refusal.
//
// Contract assumed: usage.preflight(wf, budget, resolveCommand, inputs, { home }) (packages/engine/domains/usage/usage.js)
// reads the Codex model cache (<home>/.codex/models_cache.json) as in #97 and reports a model problem only for an
// agent model with no offered fallback; that problem comes from the i18n catalogs (en.json / pt-BR.json) in the
// current interface language (@craftorio/shared/i18n setLanguage) and names Codex. Only the filesystem is faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const usage = require('../../domains/usage/usage');

function fakeHome(t, models) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-111-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  if (models) {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(home, '.codex', 'models_cache.json'), JSON.stringify({
      models: models.map((slug, i) => ({ slug, display_name: slug, visibility: 'list', priority: i + 1 })),
    }));
  }
  return home;
}

// fix as it runs with Codex as orchestrator (#97 mapping), plus a Fable agent
const CODEX_WF = {
  providers: { codex: { type: 'codex-cli', command: 'codex' } },
  orchestrator: { provider: 'codex', model: 'gpt-6.1-terra' },
  agents: {
    developer: { provider: 'codex', model: 'gpt-6.2-sol' },
    reviewer: { provider: 'codex', model: 'gpt-6.2-astra' },
    verifier: { provider: 'codex', model: 'gpt-6.1-terra' },
    mapper: { provider: 'codex', model: 'gpt-6-luna' },
  },
};
const CLAUDE_WF = {
  providers: { claude: { type: 'claude-cli', command: 'claude' } },
  orchestrator: { provider: 'claude', model: 'claude-sonnet-5-5' },
  agents: { developer: { provider: 'claude', model: 'claude-opus-5-5' } },
};
const installed = () => ({ file: '/usr/bin/codex' });
const POOR = ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-reserve', 'codex-auto-review'];
const NONE_USABLE = ['gpt-reserve', 'codex-auto-review'];

let saved;
test.beforeEach(() => { saved = I18n.getLanguage(); });
test.afterEach(() => { I18n.setLanguage(saved || 'en'); });

test('#111 preflight: an account offering only gpt-6-luna and gpt-5.6-* has a fallback for every model, so no refusal', (t) => {
  const home = fakeHome(t, POOR);
  assert.deepEqual(usage.preflight(CODEX_WF, {}, installed, {}, { home }), []);
});

test('#111 preflight: the full list (the #97 mapping as is) gives no model problem', (t) => {
  const home = fakeHome(t, ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna']);
  assert.deepEqual(usage.preflight(CODEX_WF, {}, installed, {}, { home }), []);
});

test('#111 preflight: an account with no usable Codex model refuses, naming Codex', (t) => {
  const home = fakeHome(t, NONE_USABLE);
  I18n.setLanguage('en');
  const problems = usage.preflight(CODEX_WF, {}, installed, {}, { home });
  assert.equal(problems.length >= 1, true, 'Start is refused');
  assert.ok(problems.join('\n').includes('Codex'), `the cause names Codex: ${problems.join('\n')}`);
});

test('#111 preflight: the no-usable-model refusal follows the interface language (pt-BR differs from English)', (t) => {
  const home = fakeHome(t, NONE_USABLE);
  I18n.setLanguage('en');
  const en = usage.preflight(CODEX_WF, {}, installed, {}, { home }).join('\n');
  I18n.setLanguage('pt-BR');
  const pt = usage.preflight(CODEX_WF, {}, installed, {}, { home }).join('\n');
  assert.ok(en.length > 0 && pt.length > 0, 'refused in both languages');
  assert.notEqual(pt, en, 'the pt-BR message is not the English one');
  assert.ok(pt.includes('Codex'), `the pt-BR message names Codex: ${pt}`);
  assert.equal(/does not offer|not in its model list/.test(pt), false, `no English prose in the pt-BR message: ${pt}`);
});

test('#111 preflight: with Claude Code as the orchestrator a poor Codex cache changes nothing', (t) => {
  const home = fakeHome(t, NONE_USABLE);
  assert.deepEqual(usage.preflight(CLAUDE_WF, {}, () => ({ file: '/usr/bin/claude' }), {}, { home }), []);
});
