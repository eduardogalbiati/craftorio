// #777: the workflows the E2E scenarios choose, named once. Since #630 and #648 the old bundled names
// (software-development, the local heroes, ...) are only aliases (packages/shared/default-workflow.js
// ALIASES): a seeded past run or roadmap item may still carry one, but the Start panel, the Product
// Owner's plan, the Workflows screen, the agent cards and the Settings default offer only the files
// of workflows/ and their display titles. A step that chooses a workflow takes its file or title from
// here; packages/shared/test/e2e-workflow-names.test.js fails on a retired name in a choosing step.
// A run that must reach a gate card starts FEATURE with VALIDATED ("Validated" for "Validation"):
// a feature run validates automatically by default and ends without a gate.

// feature.yaml: the default development workflow, tests first (no Cost chip in the plan)
const FEATURE = {
  file: 'feature.yaml',
  name: 'feature',
  title: 'Feature',
};

// test-backfill.yaml: in the plan, the workflow whose Cost chip shows (not tests first)
const TEST_BACKFILL = {
  file: 'test-backfill.yaml',
  name: 'test-backfill',
  title: 'Test backfill',
};

// feature.yaml's inputs: mode local | remote | fork, validation auto | validated
const LOCAL = { mode: 'local' };
const REMOTE = { mode: 'remote' };
const FORK = { mode: 'fork' };
const VALIDATED = { validation: 'validated' };

// #29: the Feature variants of the wizard's step 3 by their label (packages/shared/onboarding-model.js
// VARIANTS), named once for every step that records one on a project
const FEATURE_VARIANTS = {
  'Local merge · code first': 'local-code',
  'Local merge · E2E first': 'local-e2e',
  'Remote · code first': 'remote-code',
  'Remote · E2E first': 'remote-e2e',
};

// the workflow file of a name, a display title or a file: "feature", "Feature", "feature.yaml",
// "Test backfill" -> "feature.yaml" / "test-backfill.yaml"
function fileOf(name) {
  const base = String(name || '').trim().replace(/\.ya?ml$/i, '');
  return `${base.toLowerCase().replace(/[\s_]+/g, '-')}.yaml`;
}

module.exports = {
  FEATURE,
  FEATURE_VARIANTS,
  FORK,
  LOCAL,
  REMOTE,
  TEST_BACKFILL,
  VALIDATED,
  fileOf,
};
