// #861: in Local mode the last step, push_main, runs without an agent: the engine pushes the local
// base (no model call), in the bundled feature and fix workflows and in composed Local workflows.
// Acceptance tests, written before the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const engine = () => require('../../engine/run/load');
const compose = () => require('../../domains/workflow/workflow-compose');
const manifestParser = () => require('../../domains/project/project-manifest');
const root = path.resolve(__dirname, '..', '..', '..', '..');

const FACTS = { languages: ['javascript'], skills: ['unit-test-writer-js'] };
const profile = { team: 'solo', merge: 'local', release: 'milestone', testCommand: 'npm test', ci: 'release', tests: 'unit', languages: ['javascript'] };

// push_main runs without an agent: a machine step type, no agent, no prompt; it still ends the run
function assertEngineStep(wf, label) {
  const step = wf.steps.find((s) => s.id === 'push_main');
  assert.ok(step, `${label}: has push_main`);
  const { MACHINE_STEP_TYPES } = engine();
  assert.equal(MACHINE_STEP_TYPES.includes(step.type), true, `${label}: push_main type ${JSON.stringify(step.type)} is a step without an agent`);
  assert.equal(step.agent === undefined || step.agent === null, true, `${label}: push_main has no agent (${step.agent})`);
  assert.equal(step.agents === undefined, true, `${label}: push_main has no agents`);
  assert.equal(typeof step.prompt === 'string' && step.prompt.length > 0, false, `${label}: push_main sends no prompt`);
  assert.deepEqual((step.transitions || []).map((t) => t.goto), ['end'], `${label}: push_main still ends the run`);
}

for (const name of ['feature', 'fix']) {
  test(`#861 workflows/${name}.yaml: push_main is an engine step (no agent, no prompt)`, () => {
    assertEngineStep(engine().loadWorkflow(path.join(root, 'workflows', `${name}.yaml`)), name);
  });
}

test('#861 a composed Local workflow set: feature and fix get the same engine push_main', (t) => {
  const out = compose().composeWorkflowSet({ profile, answers: {}, facts: FACTS });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfc-861-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  for (const w of [...out.workflows, out.manifest]) {
    const file = path.join(dir, ...w.path.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, w.yaml);
  }
  const entries = manifestParser().parseManifest(out.manifest.yaml).workflows.filter((e) => ['feature', 'fix'].includes(e.category));
  assert.equal(entries.length, 2);
  for (const e of entries) {
    const wf = engine().loadWorkflow(path.join(dir, '.craftorio', ...String(e.file).split('/')));
    assertEngineStep(wf, `composed ${e.category}`);
  }
});
