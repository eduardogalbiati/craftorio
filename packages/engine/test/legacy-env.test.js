// T2b: the old variable names (MULTIAGENT_*) still work after the rename to Craftorio: copied to
// CRAFTORIO_* when the new name is unset, never over a value the new name has, reported once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { bridgeLegacyEnv } = require('../domains/workspace/legacy-env');

test('T2b a MULTIAGENT_* set without its CRAFTORIO_* is copied to it, and the copy is reported once', () => {
  const env = { MULTIAGENT_SIMULATION_ONLY: '1', MULTIAGENT_WORKSPACE: '/w', PATH: '/bin' };
  const warnings = [];
  const copied = bridgeLegacyEnv(env, { warn: (m) => warnings.push(m) });
  assert.deepEqual(copied, ['MULTIAGENT_SIMULATION_ONLY', 'MULTIAGENT_WORKSPACE']);
  assert.equal(env.CRAFTORIO_SIMULATION_ONLY, '1');
  assert.equal(env.CRAFTORIO_WORKSPACE, '/w');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /MULTIAGENT_SIMULATION_ONLY, MULTIAGENT_WORKSPACE/);
  assert.match(warnings[0], /CRAFTORIO_\*/);
});

test('T2b the new name wins: a CRAFTORIO_* already set is never overwritten, and nothing is reported', () => {
  const env = { MULTIAGENT_WORKSPACE: '/old', CRAFTORIO_WORKSPACE: '/new' };
  const warnings = [];
  assert.deepEqual(bridgeLegacyEnv(env, { warn: (m) => warnings.push(m) }), []);
  assert.equal(env.CRAFTORIO_WORKSPACE, '/new');
  assert.deepEqual(warnings, []);
});

test('T2b the bridge runs at the top of the entry points and of providers.js, before any read of the environment', () => {
  const root = path.join(__dirname, '..', '..', '..');
  for (const file of ['packages/engine/engine/providers.js', 'packages/engine/bin/craftorio-engine.js', 'apps/desktop/host/main.js', 'scripts/test.js', 'scripts/e2e.js', 'playwright.config.js']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const at = text.indexOf('legacy-env');
    assert.ok(at >= 0, `${file} requires legacy-env`);
    assert.equal(text.slice(0, at).includes('process.env'), false, `${file} reads process.env before the bridge`);
  }
});
