// Workflow validation of the `type: test_ids` step (#246) and the agents' `fresh_after_idle` (#247),
// and the prompt lines of packages/engine/engine/test-ids.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');
const { missingTestIdLines } = require('../engine/test-ids');

function load(t, { step = {}, agent = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-ids-wf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wf = {
    agents: { dev: { provider: 'claude', ...agent } },
    steps: [
      { id: 'develop', agent: 'dev', prompt: 'x', transitions: [{ when: 'true', goto: 'check' }] },
      { id: 'check', type: 'test_ids', ...step, transitions: [{ when: 'true', goto: 'end' }] },
    ],
  };
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, JSON.stringify(wf));
  return () => loadWorkflow(file);
}

test('a test_ids step loads without an agent, with its own folders', (t) => {
  assert.equal(load(t, { step: { steps: 'e2e/steps', renderer: 'web/ui' } })().steps[1].type, 'test_ids');
});

test('a test_ids step refuses an agent and an empty folder', (t) => {
  assert.throws(load(t, { step: { agent: 'dev' } }), /test_ids step has no agent/);
  assert.throws(load(t, { step: { renderer: ' ' } }), /renderer must be a repository-relative folder/);
});

test('fresh_after_idle must be a duration', (t) => {
  assert.equal(load(t, { agent: { fresh_after_idle: '55m' } })().agents.dev.fresh_after_idle, '55m');
  assert.throws(load(t, { agent: { fresh_after_idle: 'soon' } }), /fresh_after_idle must be a duration/);
});

test('missingTestIdLines: one line per id with the files that use it', () => {
  assert.equal(missingTestIdLines([{ id: 'a', files: ['x.steps.js', 'y.steps.js'] }]), '- `a` (used in x.steps.js, y.steps.js)');
  assert.equal(missingTestIdLines([]), '');
});
