// Simulation-only guard for automated checks (npm test, scripts/smoke.js, CI, tests that create a
// service): with MULTIAGENT_SIMULATION_ONLY=1 nothing may call a real model. The service refuses
// real runs and CLI terminals, and providers.runTurn refuses any non-mock provider as the last line
// of defence for code paths that bypass the service.

const ENV = 'MULTIAGENT_SIMULATION_ONLY';

function simulationOnly() {
  return /^(1|true|yes|on)$/i.test(String(process.env[ENV] || '').trim());
}

// Throws when simulation-only is on; `what` says what was refused ("a real run", "the claude CLI").
function refuseReal(what) {
  if (simulationOnly()) throw new Error(`Simulation only (${ENV}=1): refusing to start ${what}. Automated checks never call real models; start the run as a simulation (mock: true).`);
}

module.exports = { ENV, simulationOnly, refuseReal };
