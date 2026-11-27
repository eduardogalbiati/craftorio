// #111 (acceptance tests, written before the code): Settings' environment details (env:details,
// packages/engine/service/areas/settings.js envDetails) give the Codex entry the models the account offers, so the
// Setup's Codex card and Settings › Agents & CLIs can warn when the mapped models are missing.
//
// Contract assumed: the codex entry of envDetails() has `models`: the slugs of the account's Codex model cache
// (CODEX_HOME/models_cache.json, else ~/.codex; as cli-sessions.js cachedModels reads it), in its order; no `models`
// (undefined) when there is no cache (nothing known). Codex is made ready through the E2E hook (simulation only), the
// other CLIs missing, so no real CLI is run; only the filesystem is faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withEnv(t, vars) {
  const before = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
}

function codexHome(t, models) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-111-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (models) {
    fs.writeFileSync(path.join(dir, 'models_cache.json'), JSON.stringify({
      models: models.map((slug, i) => ({ slug, display_name: slug, visibility: 'list', priority: i + 1 })),
    }));
  }
  return dir;
}

async function codexEntry(t, models) {
  withEnv(t, {
    CRAFTORIO_SIMULATION_ONLY: '1',
    CRAFTORIO_E2E_CLI_READY: 'codex',
    CRAFTORIO_E2E_CLI_MISSING: 'claude,grok,gh,glab,git,gitleaks',
    CODEX_HOME: codexHome(t, models),
  });
  const area = require('../../service/areas/settings')();
  const list = await area.envDetails();
  const codex = list.find((x) => x.id === 'codex');
  assert.ok(codex, 'a codex entry');
  assert.equal(codex.connected, true, 'Codex is ready (E2E hook)');
  return codex;
}

test('#111 envDetails: the Codex entry lists the models the account offers', { timeout: 30000 }, async (t) => {
  const codex = await codexEntry(t, ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  assert.deepEqual(Array.isArray(codex.models) ? [...codex.models] : codex.models, ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna']);
});

test('#111 envDetails: with no Codex model cache the entry has no models (nothing known)', { timeout: 30000 }, async (t) => {
  const codex = await codexEntry(t, null);
  assert.equal(codex.models, undefined);
});
