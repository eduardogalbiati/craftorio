// Simulation-only guard for automated checks (npm test, scripts/smoke.js, CI, tests that create a
// service): with CRAFTORIO_SIMULATION_ONLY=1 nothing may call a real model. The service refuses
// real runs and CLI terminals, and providers.runTurn refuses any non-mock provider as the last line
// of defence for code paths that bypass the service.

const ENV = 'CRAFTORIO_SIMULATION_ONLY';

function simulationOnly(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env[ENV] || '').trim());
}

// Throws when simulation-only is on; `what` says what was refused ("a real run", "the claude CLI").
function refuseReal(what) {
  if (simulationOnly()) throw new Error(`Simulation only (${ENV}=1): refusing to start ${what}. Automated checks never call real models; start the run as a simulation (mock: true).`);
}

// #740, #49: the CLIs the E2E hook CRAFTORIO_E2E_CLI_MISSING=<id>[,<id>] makes missing (none outside
// simulation): domains/machine/simulated-clis.js for the probes, secret-scan.js for a run's gitleaks
function missingIds(env = process.env) {
  if (!simulationOnly(env)) return [];
  return String(env.CRAFTORIO_E2E_CLI_MISSING || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// #795: the E2E hook of a simulated run (fronts/build/features/steps/run-chat-orchestrator.steps.js):
// CRAFTORIO_E2E_SUITE_DELAY_MS with CRAFTORIO_E2E_SUITE_DELAY_STEP=<step id> keeps that suite step's
// simulated round running that long (suite-step.js runSuite, its log header written); null otherwise
function e2eSuiteDelay(stepId, signal, env = process.env) {
  const ms = Number(env.CRAFTORIO_E2E_SUITE_DELAY_MS);
  if (!stepId || !(ms > 0) || env.CRAFTORIO_E2E_SUITE_DELAY_STEP !== stepId || !simulationOnly(env)) return null;
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; } // the run stopped before the step began
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

// #74: the E2E hook of a simulated onboarding (features/steps/onboarding.steps.js):
// CRAFTORIO_E2E_ONBOARDING_COSTS=<JSON { profile, projectMap }>, what each analysis is estimated at and records as
// its cost, with no model call (areas/project-onboarding.js, areas/workflow-interview.js, architecture:estimate); null otherwise
function e2eOnboardingCosts(env = process.env) {
  if (!simulationOnly(env) || !env.CRAFTORIO_E2E_ONBOARDING_COSTS) return null;
  try {
    const costs = JSON.parse(env.CRAFTORIO_E2E_ONBOARDING_COSTS);
    return costs && typeof costs === 'object' ? costs : null;
  } catch { return null; }
}

// #79: the E2E hook of a simulated run (features/steps/79-84-import-push-and-kind.steps.js):
// CRAFTORIO_E2E_CI_NO_PR=<reason> makes the CI step (fragments/pr-pipeline.yaml `ci`) answer that it opened no
// pull request, failed for an infra reason with <reason> as its log (providers.js mockAnswer); null otherwise
function e2eCiNoPr(env = process.env) {
  const reason = String(env.CRAFTORIO_E2E_CI_NO_PR || '').trim();
  if (!reason || !simulationOnly(env)) return null;
  return { pr_url: '', pr_number: 0, ci_status: 'failed', failure_class: 'infra', failure_log: reason };
}

// #79: the E2E hook of a simulated import: CRAFTORIO_E2E_GIT_PUSH=0 makes the clone's push check fail as git does
// without credentials, until the simulated `gh auth setup-git` (areas/project-onboarding.js); null otherwise
function e2eGitPush(env = process.env) {
  const hook = env.CRAFTORIO_E2E_GIT_PUSH;
  return simulationOnly(env) && (hook === '0' || hook === '1') ? hook === '1' : null;
}

module.exports = {
  e2eCiNoPr,
  e2eGitPush,
  e2eOnboardingCosts,
  e2eSuiteDelay,
  ENV,
  missingIds,
  refuseReal,
  simulationOnly,
};
