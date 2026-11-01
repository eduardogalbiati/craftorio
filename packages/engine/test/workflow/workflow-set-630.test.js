// #630 (spec R6, R7): the bundled workflow set renamed to feature, fix and release. Acceptance tests,
// written before the code.
//
// Spec (the interface these tests assume):
// - workflows/feature.yaml: input `mode` (local | remote), an input choosing E2E first or code first, and a
//   review choice single or multi-model; Local mode ends with a "push main" step (an id with push and main).
// - workflows/fix.yaml: includes the fragment fragments/fix-pipeline.yaml, offers a hotfix mode, and ends its
//   Local mode with a "push main" step too.
// - workflows/release.yaml: E2E is a step, and a step waits for the release CI (an id naming ci).
// - The old names are aliases (packages/engine/domains/workflow/workflows.js resolveWorkflow): the result's
//   file is the new workflow and its `inputs` carry the old variant (e.g. software-development ->
//   feature.yaml with { mode: 'remote' }); the old files are no longer bundled.
// - packages/shared/default-workflow.js resolve(): a saved old name resolves to the new workflow, not missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..', '..', '..');
const WORKFLOWS = path.join(root, 'workflows');
const FRAGMENTS = path.join(root, 'fragments');

const engine = () => require('../../engine/run/load');
const workflows = () => require('../../domains/workflow/workflows');
const defaultWorkflow = () => require('@multiagent/shared/default-workflow');

const loadBundled = (name) => engine().loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`));

// every value an input offers, as text: its enum, its options' keys and labels, its choices
function offered(input) {
  const out = [];
  const add = (v) => { if (v != null && typeof v !== 'object') out.push(String(v)); };
  for (const v of Array.isArray(input?.enum) ? input.enum : []) add(v);
  for (const list of [input?.options, input?.choices]) {
    if (Array.isArray(list)) {
      for (const o of list) {
        if (o && typeof o === 'object') { add(o.value); add(o.label); add(o.id); } else add(o);
      }
    } else if (list && typeof list === 'object') {
      for (const [k, v] of Object.entries(list)) { add(k); add(v); }
    }
  }
  return out;
}
const inputsOf = (wf) => Object.entries(wf.inputs || {}).map(([name, input]) => ({ name, values: offered(input) }));
const anyOption = (wf, re) => inputsOf(wf).some((i) => i.values.some((v) => re.test(v)));
const stepIds = (wf) => (wf.steps || []).map((s) => String(s.id));

test('#630 feature.yaml loads and has a mode input offering local and remote', () => {
  const wf = loadBundled('feature');
  const mode = offered(wf.inputs?.mode);
  assert.equal(mode.includes('local'), true, `mode offers local: ${JSON.stringify(mode)}`);
  assert.equal(mode.includes('remote'), true, `mode offers remote: ${JSON.stringify(mode)}`);
});

test('#630 feature.yaml lets the user pick E2E first or code first', () => {
  const wf = loadBundled('feature');
  assert.equal(anyOption(wf, /e2e/i), true, `an input option names E2E: ${JSON.stringify(inputsOf(wf))}`);
  assert.equal(anyOption(wf, /code/i), true, `an input option names code first: ${JSON.stringify(inputsOf(wf))}`);
});

test('#630 feature.yaml offers a single or multi-model review', () => {
  const wf = loadBundled('feature');
  assert.equal(anyOption(wf, /multi/i), true, `an input option names a multi-model review: ${JSON.stringify(inputsOf(wf))}`);
});

test('#630 fix.yaml loads and includes the fix-pipeline fragment', () => {
  assert.equal(fs.existsSync(path.join(FRAGMENTS, 'fix-pipeline.yaml')), true, 'fragments/fix-pipeline.yaml exists');
  loadBundled('fix');
  const parsed = yaml.load(fs.readFileSync(path.join(WORKFLOWS, 'fix.yaml'), 'utf8'));
  const names = engine().fragmentSources(parsed).map((f) => f.name);
  assert.equal(names.includes('fix-pipeline'), true, `the fragments: ${JSON.stringify(names)}`);
});

test('#630 fix.yaml offers a hotfix mode', () => {
  const wf = loadBundled('fix');
  const named = Object.keys(wf.inputs || {}).some((n) => /hotfix/i.test(n));
  assert.equal(named || anyOption(wf, /hotfix/i), true, `an input or option names hotfix: ${JSON.stringify(inputsOf(wf))}`);
});

for (const name of ['feature', 'fix']) {
  test(`#630 ${name}.yaml ends Local mode with a "push main" step`, () => {
    const ids = stepIds(loadBundled(name));
    assert.equal(ids.some((id) => /push/i.test(id) && /main/i.test(id)), true, `the steps: ${JSON.stringify(ids)}`);
  });
}

test('#630 release.yaml runs E2E as a step', () => {
  const ids = stepIds(loadBundled('release'));
  assert.equal(ids.some((id) => /e2e/i.test(id)), true, `the steps: ${JSON.stringify(ids)}`);
});

test('#630 release.yaml has a step that waits for the release CI', () => {
  const ids = stepIds(loadBundled('release'));
  assert.equal(ids.some((id) => /(^|[^a-z])ci([^a-z]|$)/i.test(id)), true, `the steps: ${JSON.stringify(ids)}`);
});

const ALIASES = [
  ['software-development', 'feature.yaml', { mode: 'remote' }],
  ['software-development-local-hero', 'feature.yaml', { mode: 'local' }],
  ['ai-development-local-hero', 'feature.yaml', { mode: 'local' }],
  ['multi-model-review', 'feature.yaml', null],
  ['e2e-release', 'release.yaml', null],
];

for (const [old, file, inputs] of ALIASES) {
  test(`#630 the old name ${old}.yaml resolves to ${file}${inputs ? ` with mode ${inputs.mode}` : ''}`, () => {
    const { resolveWorkflow, BUNDLED_WORKFLOWS_DIR } = workflows();
    const r = resolveWorkflow(`${old}.yaml`, [BUNDLED_WORKFLOWS_DIR]);
    assert.equal(path.basename(String(r.file)), file);
    if (inputs) assert.equal(r.inputs?.mode, inputs.mode, `the alias's inputs: ${JSON.stringify(r.inputs ?? null)}`);
  });
}

test('#630 the old workflow files are no longer bundled (they resolve through an alias only)', () => {
  const left = ALIASES.map(([old]) => `${old}.yaml`).filter((f) => fs.existsSync(path.join(WORKFLOWS, f)));
  assert.deepEqual(left, []);
});

test('#630 a default workflow saved under an old name resolves to feature.yaml, not missing', () => {
  const r = defaultWorkflow().resolve('software-development.yaml', ['feature.yaml', 'fix.yaml', 'release.yaml']);
  assert.equal(r.file, 'feature.yaml');
  assert.equal(Boolean(r.missing), false, `missing: ${JSON.stringify(r.missing)}`);
});
