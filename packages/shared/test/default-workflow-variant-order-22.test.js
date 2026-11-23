// #22: the test order a wizard variant runs (DefaultWorkflow.variantTestOrder), the one rule shared by the
// engine's run defaults (packages/engine/domains/project/project-run-defaults.js) and the project page's
// workflow card (fronts/build/views/projects/project-workflows.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { variantTestOrder } = require('../default-workflow');

test('#22 a *-code variant runs code first', () => {
  for (const v of ['local-code', 'remote-code', 'fork-code']) assert.equal(variantTestOrder(v), 'code_first', v);
});

test('#22 a *-e2e variant runs E2E first', () => {
  for (const v of ['local-e2e', 'remote-e2e', 'fork-e2e']) assert.equal(variantTestOrder(v), 'e2e_first', v);
});

test('#22 a variant with no test order (release kinds, none) has none', () => {
  for (const v of ['train', 'milestone', '', undefined, null, 'local-code-x']) assert.equal(variantTestOrder(v), null, String(v));
});
