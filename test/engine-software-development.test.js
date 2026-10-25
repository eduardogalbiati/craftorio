const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../src/engine/workflow');
const evidence = require('../src/domains/evidence/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { root } = require('./engine-helpers');

// ---- #98: declared gaps (output.left_out) go back to develop, then to the owner, never straight
// to the review. Both software-development and its local-hero variant. --------------------------

test('#98: develop output_schema requires left_out, so an answer cannot skip it', () => {
  for (const file of ['software-development.yaml', 'software-development-local-hero.yaml']) {
    const wf = loadWorkflow(path.join(root, 'workflows', file));
    const develop = wf.steps.find((s) => s.id === 'develop');
    const output = { branch: 'b', summary: 's', files_changed: [], test_notes: 't', committed: true };
    assert.match(validateSchema(output, develop.output_schema).join(), /left_out: required/, file);
    assert.deepEqual(validateSchema({ ...output, left_out: [] }, develop.output_schema), [], file);
  }
});
