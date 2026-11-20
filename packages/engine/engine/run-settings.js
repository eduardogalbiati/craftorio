// The WorkflowRun options a run derives from the workspace's Settings (#862), shared by the app's run
// service (packages/engine/service/areas/runs.js) and the CLI (scripts/run.js), so a CLI run follows
// Settings like an app run and a new setting cannot reach only one of them. App-only options (UI
// callbacks, child runs, the PR probe, peer sessions) stay in runs.js.
//
//   runOptionsFromSettings({ settings, ws, mock }) -> { memoryGuard, idleWarnMs, models, fallbacks,
//     accounts, accountCooldownMs, language, testWorkers }
//
// It also configures the process's shared memory guard (#276) from settings.memoryGuard over
// DEFAULT_SETTINGS.memoryGuard: always with the full defaults, since configureMemoryGuard merges over
// the previous configuration.

const {
  configureMemoryGuard,
  sharedMemoryGuard,
} = require('./memory-guard');
const {
  DEFAULT_SETTINGS,
  readSettings,
} = require('../domains/workspace/workspace');
const {
  readMachine,
  resolveLimits,
} = require('../domains/machine/machine-profile');

// #262: Settings' providers.<name>.fallbacks as the WorkflowRun `fallbacks` option ({ <provider>: [entries] })
const settingsFallbacks = (settings) => Object.fromEntries(Object.entries(settings.providers || {})
  .filter(([, p]) => Array.isArray(p?.fallbacks) && p.fallbacks.length)
  .map(([name, p]) => [name, p.fallbacks.map(String)]));

// #312: Settings' providers.<name>.accounts (those with a folder) as the WorkflowRun `accounts` option
const settingsAccounts = (settings) => Object.fromEntries(Object.entries(settings.providers || {})
  .map(([name, p]) => [name, (Array.isArray(p?.accounts) ? p.accounts : []).filter((a) => a?.name && a?.dir)])
  .filter(([, list]) => list.length));
// #312: Settings' accountCooldownMinutes (60 by default) as the WorkflowRun `accountCooldownMs` option
const settingsAccountCooldownMs = (settings) => (settings.accountCooldownMinutes ?? 60) * 60e3;

function runOptionsFromSettings({ settings, ws, mock }) {
  // #276: Settings › Execution › Memory guard configures the shared guard real runs use
  configureMemoryGuard({ ...DEFAULT_SETTINGS.memoryGuard, ...(settings.memoryGuard || {}) });
  return {
    // null when the owner turned the guard off, and for a simulation run
    memoryGuard: mock ? null : sharedMemoryGuard(),
    // Settings' idleWarningMinutes; the engine's own default when unset
    idleWarnMs: settings.idleWarningMinutes != null && Number.isFinite(+settings.idleWarningMinutes) ? +settings.idleWarningMinutes * 60e3 : undefined,
    // #262: limits per model and fallback chains per provider
    models: settings.models || {},
    fallbacks: settingsFallbacks(settings),
    // #312: provider accounts and their cooldown
    accounts: settingsAccounts(settings),
    accountCooldownMs: settingsAccountCooldownMs(settings),
    // #327: Settings › Language, read at each turn (a change reaches the run at its next turn)
    language: () => readSettings(ws).language,
    // #367: the machine profile's test workers per run (auto from this machine, or the owner's)
    testWorkers: resolveLimits(settings, readMachine()).testWorkers,
  };
}

module.exports = {
  runOptionsFromSettings,
};
