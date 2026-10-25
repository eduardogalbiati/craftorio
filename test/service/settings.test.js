// src/service/areas/settings.js: envDetails, the Settings › Agents & CLIs tab's data (#147 adds
// installCommand/installHint for every tool, including gh, glab and git, so a missing one always
// has something to run). resolveCommand is a PATH lookup (machine-dependent, and a no-op on
// non-Windows), so it is stubbed the way test/server.test.js stands in for electron: inject a fake
// module into require.cache for the module under test's own dependency, require it fresh, then
// restore the cache so other test files still get the real resolveCommand.
const test = require('node:test');
const assert = require('node:assert/strict');
const { installCommand, installHint } = require('../../src/domains/machine/install-commands');

function loadSettingsArea(resolveCommand) {
  const providersPath = require.resolve('../../src/engine/providers');
  const areaPath = require.resolve('../../src/service/areas/settings');
  const originalProviders = require.cache[providersPath];
  const originalArea = require.cache[areaPath];
  delete require.cache[areaPath];
  // #389: the area resolves the CLIs with resolveCommandAsync (same answer, never blocking)
  const resolveCommandAsync = async (cmd) => resolveCommand(cmd);
  require.cache[providersPath] = { id: providersPath, filename: providersPath, loaded: true, exports: { resolveCommand, resolveCommandAsync } };
  try {
    return require(areaPath)();
  } finally {
    delete require.cache[areaPath];
    if (originalProviders) require.cache[providersPath] = originalProviders; else delete require.cache[providersPath];
    if (originalArea) require.cache[areaPath] = originalArea; else delete require.cache[areaPath];
  }
}

test('envDetails: a tool not found in PATH carries an install command/hint, for every CLI including gh, glab and git', async () => {
  const area = loadSettingsArea(() => null);
  const tools = await area.envDetails();
  assert.deepEqual(tools.map((t) => t.id), ['claude', 'codex', 'grok', 'gh', 'glab', 'git']);
  for (const t of tools) {
    assert.equal(t.path, null);
    assert.equal(t.connected, false);
    assert.equal(t.installCommand, installCommand(t.id));
    assert.equal(t.installHint, installHint(t.id));
  }
  // every one of them has at least a hint to show (grok's prose, when there is no one-line command)
  assert.ok(tools.every((t) => t.installHint));
  assert.equal(tools.find((t) => t.id === 'gh').installCommand, installCommand('gh'));
  assert.equal(tools.find((t) => t.id === 'glab').installCommand, installCommand('glab'));
  assert.equal(tools.find((t) => t.id === 'git').installCommand, installCommand('git'));
});

test('envDetails: a tool found in PATH reports its path and version, not an install hint', async () => {
  const area = loadSettingsArea((cmd) => (cmd === 'git' ? { file: process.execPath, shell: false } : null));
  const tools = await area.envDetails();
  const git = tools.find((t) => t.id === 'git');
  assert.equal(git.path, process.execPath);
  assert.equal(git.connected, true);
  assert.equal(git.installCommand, undefined);
  assert.equal(git.installHint, undefined);
  const claude = tools.find((t) => t.id === 'claude');
  assert.equal(claude.path, null);
  assert.equal(claude.installCommand, installCommand('claude'));
});
