// #97 (acceptance tests, written before the code): with Codex as orchestrator, a model the default workflows map
// to that this Codex account does not offer is reported before the run starts, not at its first turn.
//
// Contract assumed: usage.preflight(wf, budget, resolveCommand, inputs, { home }) (packages/engine/domains/usage/usage.js)
// also reads the models the provider's CLI caches (Codex: <home>/.codex/models_cache.json, cli-sessions.js
// providerModels) and adds one problem per agent model that is not in that list, naming the model. With no cache,
// nothing is known, so no model problem. Only the filesystem is faked: a temp home with the cache file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const usage = require('../../domains/usage/usage');

function fakeHome(t, models) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-97-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  if (models) {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(home, '.codex', 'models_cache.json'), JSON.stringify({
      models: models.map((slug, i) => ({ slug, display_name: slug, visibility: 'list', priority: i + 1 })),
    }));
  }
  return home;
}

// fix as it runs with Codex as orchestrator (opus -> gpt-6.2-sol, sonnet -> gpt-6.1-terra), plus a Fable agent
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
const installed = () => ({ file: '/usr/bin/codex' });

test('#97 preflight reports the Codex models the account does not offer (gpt-6.2-astra, gpt-6.2-sol, gpt-6.1-terra)', (t) => {
  const home = fakeHome(t, ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  const problems = usage.preflight(CODEX_WF, {}, installed, {}, { home });
  const text = problems.join('\n');
  for (const model of ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra']) {
    assert.ok(text.includes(model), `${model} is reported as unavailable in: ${text}`);
  }
  assert.equal(text.includes('gpt-6-luna'), false, `gpt-6-luna is offered, not reported: ${text}`);
});

test('#97 preflight reports no model problem when every agent model is in the Codex cache, or there is no cache', (t) => {
  const offered = fakeHome(t, ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna']);
  assert.deepEqual(usage.preflight(CODEX_WF, {}, installed, {}, { home: offered }), []);
  const noCache = fakeHome(t, null);
  assert.deepEqual(usage.preflight(CODEX_WF, {}, installed, {}, { home: noCache }), []);
});
