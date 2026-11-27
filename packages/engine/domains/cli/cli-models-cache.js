// @ts-check
// The model list a provider's CLI caches for this account (Codex CLI: <CODEX_HOME or ~/.codex>/models_cache.json,
// refreshed whenever it runs), read through its adapter's modelsCache (packages/shared/providers/): [{ id, name,
// efforts, defaultEffort }] in the CLI's own order; [] for a CLI with no such cache or before it wrote one.
// A low-level utility (scripts/layers.js ENGINE_ROOT_UTILITIES), so the engine can read it too (#111: a run on
// Codex as the orchestrator falls back to an offered model); cli-sessions.js cachedModels builds on it.

const fs = require('fs');
const path = require('path');
const { cliConfigDirs } = require('./cli-config-dirs');
const registry = require('@craftorio/shared/providers');

/**
 * @param {string} provider
 * @param {string} [home]
 * @returns {any[]}
 */
function cachedModelList(provider, home) {
  const cache = registry.byId(provider)?.modelsCache;
  if (!cache) return [];
  let c = null;
  try { c = JSON.parse(fs.readFileSync(path.join(cliConfigDirs(home)[provider], cache.file), 'utf8')); } catch { /* no cache yet */ }
  return cache.models(c);
}

module.exports = {
  cachedModelList,
};
