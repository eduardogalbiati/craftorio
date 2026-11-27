// A simulated machine without a CLI (#740, the E2E scenarios of features/740-settings-clis.feature): with
// CRAFTORIO_SIMULATION_ONLY=1 and CRAFTORIO_E2E_CLI_MISSING=<id>[,<id>] the engine's probes
// (packages/engine/service/areas/settings.js envDetails / toolSignIn) find no such CLI until a simulated
// Install of it (packages/engine/service/areas/cli-setup.js), which installs nothing and leaves the CLI
// "installed, not signed in" for the re-check that follows. Outside simulation the hook does nothing.
// #97 (features/97-orchestrator-ai-choice.feature): CRAFTORIO_E2E_CLI_READY=<id>[,<id>] makes a CLI
// installed and signed in, CRAFTORIO_E2E_CLI_SIGNED_OUT=<id>[,<id>] installed but not signed in.

const { missingIds, readyIds, signedOutIds } = require('../../engine/simulation');

const installed = new Set();

// 'missing' | 'installed' | 'ready' for a CLI the hooks cover, else null (the real probes answer); #97:
// CRAFTORIO_E2E_CLI_READY makes one installed and signed in, CRAFTORIO_E2E_CLI_SIGNED_OUT installed only
function simulatedState(id, env = process.env) {
  if (readyIds(env).includes(id)) return 'ready';
  if (signedOutIds(env).includes(id)) return 'installed';
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
