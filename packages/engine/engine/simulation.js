// Simulation-only guard for automated checks (npm test, scripts/smoke.js, CI, tests that create a
// service): with MULTIAGENT_SIMULATION_ONLY=1 nothing may call a real model. The service refuses
// real runs and CLI terminals, and providers.runTurn refuses any non-mock provider as the last line
// of defence for code paths that bypass the service.

const ENV = 'MULTIAGENT_SIMULATION_ONLY';

function simulationOnly(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env[ENV] || '').trim());
}

// Throws when simulation-only is on; `what` says what was refused ("a real run", "the claude CLI").
function refuseReal(what) {
  if (simulationOnly()) throw new Error(`Simulation only (${ENV}=1): refusing to start ${what}. Automated checks never call real models; start the run as a simulation (mock: true).`);
}

// #795: the E2E hook of a simulated run (fronts/build/features/steps/run-chat-orchestrator.steps.js):
// MULTIAGENT_E2E_SUITE_DELAY_MS with MULTIAGENT_E2E_SUITE_DELAY_STEP=<step id> keeps that suite step's
// simulated round running that long (suite-step.js runSuite, its log header written); null otherwise
function e2eSuiteDelay(stepId, signal, env = process.env) {
  const ms = Number(env.MULTIAGENT_E2E_SUITE_DELAY_MS);
  if (!stepId || !(ms > 0) || env.MULTIAGENT_E2E_SUITE_DELAY_STEP !== stepId || !simulationOnly(env)) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

module.exports = {
  e2eSuiteDelay,
  ENV,
  refuseReal,
  simulationOnly,
};
