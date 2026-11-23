// #30: check_environment's retry is bounded. A gate answered by its first choice (--auto-approve,
// the simulated automations) on an environment nobody fixes must not loop forever between the gate
// and rule_check: three retries, then the run ends as failed (on_exhausted: end, status: failed).
// Seam: the loaded workflows and the engine's own counter (transitions.js methods.applyCounters, called
// on a minimal host as deps-cache-shared-entry.test.js calls methods.prepareDeps); no whole run.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');
const { evalExpr } = require('../engine/run/templates');
const { methods } = require('../engine/run/transitions');

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOWS = [
  'workflows/feature.yaml',
  '.craftorio/workflows/ai-development-local-hero.yaml',
  '.craftorio/workflows/ai-development-remote-hero.yaml',
];

// the first transition whose `when` holds for this answer of the gate
function transitionFor(step, choice) {
  return (step.transitions || []).find((tr) => {
    try { return !tr.when || !!evalExpr(String(tr.when), { choice, vars: {}, inputs: {}, steps: {} }); } catch { return false; }
  });
}

// the engine's counters on a fresh run
const host = () => ({ counters: {}, loops: {}, ctx: { inputs: {}, vars: {}, steps: {} }, emitEvent() {}, recordStall() {}, noteExhausted: methods.noteExhausted });

for (const file of WORKFLOWS) {
  const gateOf = () => loadWorkflow(path.join(ROOT, ...file.split('/'))).steps.find((s) => s.id === 'check_environment');

  test(`#30 ${file}: "Try again" reruns rule_check three times, then ends the run as failed`, () => {
    const gate = gateOf();
    assert.equal(gate === undefined, false, 'check_environment exists');
    const tr = transitionFor(gate, 'retry');
    assert.equal(tr.goto, 'rule_check');
    const run = host();
    const targets = [1, 2, 3, 4].map(() => methods.applyCounters.call(run, gate, tr));
    assert.deepEqual(targets, ['rule_check', 'rule_check', 'rule_check', 'end']);
    assert.equal(tr.status, 'failed');
  });

  test(`#30 ${file}: "Stop the run as failed" ends the run at once`, () => {
    const tr = transitionFor(gateOf(), 'stop');
    assert.equal(tr.goto, 'end');
    assert.equal(tr.status, 'failed');
  });
}
