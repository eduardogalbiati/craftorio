// A simulated machine without a CLI (#740, the E2E scenarios of features/740-settings-clis.feature): with
// MULTIAGENT_SIMULATION_ONLY=1 and MULTIAGENT_E2E_CLI_MISSING=<id>[,<id>] the engine's probes
// (packages/engine/service/areas/settings.js envDetails / toolSignIn) find no such CLI until a simulated
// Install of it (packages/engine/service/areas/cli-setup.js), which installs nothing and leaves the CLI
// "installed, not signed in" for the re-check that follows. Outside simulation the hook does nothing.

const simulation = require('../../engine/simulation');

const installed = new Set();

// the ids the hook makes missing (none outside simulation)
function missingIds(env = process.env) {
  if (!simulation.simulationOnly(env)) return [];
  return String(env.MULTIAGENT_E2E_CLI_MISSING || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// 'missing' | 'installed' for a CLI the hook covers, else null (the real probes answer)
function simulatedState(id, env = process.env) {
  if (!missingIds(env).includes(id)) return null;
  return installed.has(id) ? 'installed' : 'missing';
}

// a simulated Install ended: the CLI is found from now on (not signed in)
function markInstalled(id, env = process.env) {
  if (missingIds(env).includes(id)) installed.add(id);
}

// the command a simulated Install shows when the platform has none (Linux has no one-line gh / glab installer)
const simulatedInstallCommand = (id) => `simulated install of ${id}`;

module.exports = {
  markInstalled,
  missingIds,
  simulatedInstallCommand,
  simulatedState,
};
