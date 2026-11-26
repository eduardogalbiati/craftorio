// The inputs every simulated run on this repository starts with: a trivial rule check and no secret scan.
// A mock run on the repository itself (`repo_path: root`) would otherwise run its real `npm run check`
// (about 9 s, after every simulated developer commit: #705, #826) and gitleaks over this checkout's own
// commits (#49: a finding there would change the route). The steps stay on the route: rule_check runs
// `node --version` and passes, secret_scan is visited and says "secrets not scanned".
//   new WorkflowRun({ file, inputs: simInputs({ task: 'x', repo_path: root }), mock: true, runsDir })
// The caller's inputs win, so a test about the check or the scan names its own check_command or secret_scan.
// Inputs a workflow does not declare are dropped when the run starts (engine/run/setup.js resolveInputs),
// so the defaults are harmless for any workflow. test/simulation-trivial-checks.test.js keeps new
// simulations on the repository using it.

const TRIVIAL_CHECKS = Object.freeze({ check_command: 'node --version', secret_scan: 'off' });

const simInputs = (inputs = {}) => ({ ...TRIVIAL_CHECKS, ...inputs });

module.exports = { simInputs, TRIVIAL_CHECKS };
