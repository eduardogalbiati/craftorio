// #633 (spec R9, D15, D16): the AI-native SDLC work model's workflows. Acceptance tests, written
// before the code.
//
// The interface assumed here (workflows loaded with packages/engine/engine/run/load.js loadWorkflow, as
// workflow-set-631.test.js does, and read raw with js-yaml where the declaration itself matters):
// - workflows/write-doc.yaml's `document` input offers 'plan' next to 'intent' and 'spec' (the pre-flow
//   writes intent.md, spec.md and now plan.md at their gates);
// - the post-flow workflows workflows/sdlc-record.yaml, sdlc-test.yaml and sdlc-release.yaml exist, load,
//   are named after their file (metadata.name), are tagged 'sdlc' and take the `project_path` and `item`
//   inputs (the work item whose docs/work/<item>/ they write);
// - a Code & Build run (feature, fix) never writes docs/work/. ASSUMPTION: this is declared on the
//   developer agent of feature.yaml and fix.yaml as a `protect_files` entry naming docs/work/ (as
//   feature.yaml's developer already protects the acceptance tests with protect_files: a turn that
//   changes a protected file is refused); fix.yaml's developer gets a protect_files list too;
// - the review reads the project's REVIEW.md: the code_review step of feature.yaml and fix.yaml (its
//   prompt once its fragment is applied, or the system_prompt of the agent(s) it runs) names REVIEW.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..', '..', '..');
const WORKFLOWS = path.join(root, 'workflows');

const engine = () => require('../../engine/run/load');
const loadBundled = (name) => engine().loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`));
const raw = (name) => yaml.load(fs.readFileSync(path.join(WORKFLOWS, `${name}.yaml`), 'utf8'));

const SDLC_FLOWS = ['sdlc-record', 'sdlc-test', 'sdlc-release'];

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

// ---- the pre-flow: write-doc writes the plan too ----------------------------------------------------

test('#633 write-doc\'s document input offers plan, next to intent and spec', () => {
  const wf = loadBundled('write-doc');
  const values = offered(wf.inputs?.document);
  assert.deepEqual(['intent', 'spec', 'plan'].filter((v) => !values.includes(v)), [], `it offers: ${JSON.stringify(values)}`);
});

// ---- the post-flow workflows --------------------------------------------------------------------------

for (const name of SDLC_FLOWS) {
  test(`#633 workflows/${name}.yaml exists`, () => {
    assert.equal(fs.existsSync(path.join(WORKFLOWS, `${name}.yaml`)), true);
  });

  test(`#633 ${name}.yaml loads and is named ${name}`, () => {
    const wf = loadBundled(name);
    assert.equal(String(wf.metadata?.name ?? ''), name);
  });

  test(`#633 ${name}.yaml is tagged sdlc`, () => {
    const wf = loadBundled(name);
    const tags = Array.from(wf.metadata?.tags || [], String);
    assert.equal(tags.includes('sdlc'), true, `its tags: ${JSON.stringify(tags)}`);
  });

  test(`#633 ${name}.yaml takes the project_path and item inputs`, () => {
    const wf = loadBundled(name);
    const inputs = Object.keys(wf.inputs || {});
    assert.deepEqual(['project_path', 'item'].filter((k) => !inputs.includes(k)), [], `its inputs: ${JSON.stringify(inputs)}`);
  });
}

// ---- a Code & Build run never writes docs/work/ --------------------------------------------------------

for (const name of ['feature', 'fix']) {
  test(`#633 ${name}.yaml's developer protects docs/work/ (protect_files)`, () => {
    const files = raw(name)?.agents?.developer?.protect_files;
    const list = Array.isArray(files) ? files.map(String) : files == null ? [] : [String(files)];
    assert.equal(list.some((f) => f.includes('docs/work/')), true, `its protect_files: ${JSON.stringify(list)}`);
  });
}

// ---- the review reads the project's REVIEW.md -----------------------------------------------------------

for (const name of ['feature', 'fix']) {
  test(`#633 ${name}.yaml's code_review reads the project's REVIEW.md`, () => {
    const wf = loadBundled(name);
    const step = (wf.steps || []).find((s) => s?.id === 'code_review');
    assert.ok(step, `${name}.yaml has a code_review step`);
    const agents = [...(step.agent ? [step.agent] : []), ...(Array.isArray(step.agents) ? step.agents : [])].map(String);
    const texts = [String(step.prompt || ''), ...agents.map((a) => String(wf.agents?.[a]?.system_prompt || ''))];
    assert.equal(texts.some((s) => s.includes('REVIEW.md')), true, `code_review's prompt and its agents (${agents.join(', ')}) never name REVIEW.md`);
  });
}
