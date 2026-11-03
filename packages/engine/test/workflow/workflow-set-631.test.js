// #631 (spec R8, phase 3 of #628): the rest of the Code & Build set. Acceptance tests, written before
// the code.
//
// Spec (the interface these tests assume, docs/first-project-onboarding-proposal-2026-10/README.md D9):
// - workflows/analyze-project.yaml merges project-map and refactor-proposals (city, architecture and
//   refactor proposals in one run); refactor-proposals becomes its "since: last tag" mode, so it takes a
//   `since` input and declares the `issues` it files.
// - test-batch is renamed test-backfill, run-retrospective is renamed retrospective (its `findings` output
//   stays).
// - The old names are aliases, as in #630 (packages/engine/domains/workflow/workflows.js resolveWorkflow,
//   packages/shared/default-workflow.js aliasOf / resolve); the old files are no longer bundled.
// - The bundled set is 11 Code & Build workflows (write-doc, a Planning tool, is not part of the count).
// - Pipelines 6 -> 5: develop-to-retrospective is removed (feature gets a "retrospective after" option);
//   release-then-refactors chains release -> analyze-project -> the roadmap.
// - The README documents each of the 11 in its own `workflows/<file>.yaml` section and no workflow that
//   is not bundled any more.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..', '..', '..');
const WORKFLOWS = path.join(root, 'workflows');
const PIPELINES = path.join(root, 'pipelines');

const engine = () => require('../../engine/run/load');
const workflows = () => require('../../domains/workflow/workflows');
const pipelines = () => require('../../domains/workflow/pipelines');
const defaultWorkflow = () => require('@multiagent/shared/default-workflow');

const loadBundled = (name) => engine().loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`));
const bundledIds = () => fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/i.test(f)).map((f) => f.replace(/\.ya?ml$/i, '')).sort();

// #648: ai-arena and writer-reviewer became write-doc (a Planning tool), issue-tracker became issue
const CODE_AND_BUILD = [
  'analyze-project', 'backlog-refresh', 'feature', 'fix', 'issue',
  'refactor', 'release', 'retrospective', 'test-backfill',
];
// #633: the SDLC flows are not Code & Build
const PLANNING_TOOLS = ['sdlc-record', 'sdlc-release', 'sdlc-test', 'write-doc'];

const ALIASES = [
  ['project-map', 'analyze-project.yaml'],
  ['refactor-proposals', 'analyze-project.yaml'],
  ['test-batch', 'test-backfill.yaml'],
  ['run-retrospective', 'retrospective.yaml'],
];
// every name #630 and #631 retired: none is bundled or documented as a workflow any more
const RETIRED = [
  ...ALIASES.map(([old]) => old),
  'software-development', 'software-development-local-hero', 'ai-development-local-hero', 'multi-model-review', 'e2e-release',
];

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

// ---- the bundled set -------------------------------------------------------------------------------

test('#631 the bundled Code & Build set is the workflows of the spec (9 since #648)', () => {
  const ids = bundledIds().filter((id) => !PLANNING_TOOLS.includes(id));
  assert.deepEqual(ids, CODE_AND_BUILD);
  assert.equal(ids.length, 9);
});

for (const name of ['analyze-project', 'test-backfill', 'retrospective']) {
  test(`#631 ${name}.yaml loads and is named ${name}`, () => {
    const wf = loadBundled(name);
    assert.equal(wf.name, name);
  });
}

test('#631 analyze-project.yaml takes a since input (the "since: last tag" mode of the old refactor proposals)', () => {
  const wf = loadBundled('analyze-project');
  assert.equal(Boolean(wf.inputs?.since), true, `its inputs: ${JSON.stringify(Object.keys(wf.inputs || {}))}`);
});

test('#631 analyze-project.yaml declares the refactor issues it files, for the roadmap', () => {
  const wf = loadBundled('analyze-project');
  assert.equal(Boolean(wf.outputs?.issues), true, `its outputs: ${JSON.stringify(Object.keys(wf.outputs || {}))}`);
});

test('#631 retrospective.yaml keeps the findings output of run-retrospective', () => {
  const wf = loadBundled('retrospective');
  assert.equal(Boolean(wf.outputs?.findings), true, `its outputs: ${JSON.stringify(Object.keys(wf.outputs || {}))}`);
});

test('#631 feature.yaml offers a "retrospective after" option (what develop-to-retrospective did)', () => {
  const wf = loadBundled('feature');
  const inputs = Object.entries(wf.inputs || {});
  const found = inputs.some(([name, input]) => /retro/i.test(name) || offered(input).some((v) => /retro/i.test(v)));
  assert.equal(found, true, `its inputs: ${JSON.stringify(inputs.map(([n]) => n))}`);
});

// ---- the old names are aliases ---------------------------------------------------------------------

for (const [old, file] of ALIASES) {
  test(`#631 the old name ${old}.yaml resolves to ${file}`, () => {
    const { resolveWorkflow, BUNDLED_WORKFLOWS_DIR } = workflows();
    const r = resolveWorkflow(`${old}.yaml`, [BUNDLED_WORKFLOWS_DIR]);
    assert.equal(path.basename(String(r.file)), file);
  });

  test(`#631 aliasOf(${old}) names ${file}`, () => {
    const alias = defaultWorkflow().aliasOf(`${old}.yaml`);
    assert.equal(path.basename(String(alias?.file)), file);
  });
}

test('#631 the old workflow files are no longer bundled (they resolve through an alias only)', () => {
  const left = ALIASES.map(([old]) => `${old}.yaml`).filter((f) => fs.existsSync(path.join(WORKFLOWS, f)));
  assert.deepEqual(left, []);
});

test('#631 a default workflow saved as run-retrospective.yaml resolves to retrospective.yaml, not missing', () => {
  const r = defaultWorkflow().resolve('run-retrospective.yaml', ['feature.yaml', 'retrospective.yaml', 'analyze-project.yaml']);
  assert.equal(r.file, 'retrospective.yaml');
  assert.equal(Boolean(r.missing), false, `missing: ${JSON.stringify(r.missing)}`);
});

// ---- pipelines, 6 -> 5 -----------------------------------------------------------------------------

const pipelineFiles = () => fs.readdirSync(PIPELINES).filter((f) => pipelines().isPipelineFile(f)).sort();
const stagesOf = (file) => (yaml.load(fs.readFileSync(path.join(PIPELINES, file), 'utf8')).stages || []);

// #648: rfc-to-issues -> spec-to-issues, enrich-save-develop -> enrich-issue, ai-arena-write-review absorbed
test('#631 the bundled pipelines, without develop-to-retrospective', () => {
  const files = pipelineFiles();
  assert.deepEqual(files, [
    'enrich-issue.yaml', 'issue-to-roadmap.yaml', 'release-then-refactors.yaml', 'spec-to-issues.yaml',
  ]);
});

test('#631 release-then-refactors chains release, then analyze-project, then the roadmap', () => {
  const stages = stagesOf('release-then-refactors.yaml');
  assert.deepEqual(stages.map((s) => s.workflow ? path.basename(String(s.workflow)) : s.target), ['release.yaml', 'analyze-project.yaml', 'product_owner']);
});

test('#631 release-then-refactors loads against the bundled workflows (analyze-project takes the release\'s version as since)', () => {
  const file = 'release-then-refactors.yaml';
  const workflowOf = (f) => engine().loadWorkflow(path.join(WORKFLOWS, f));
  const p = pipelines().loadPipelineText(fs.readFileSync(path.join(PIPELINES, file), 'utf8'), file, workflowOf);
  assert.equal(p.stages.length, 3);
  assert.equal(Object.keys(p.stages[1].map || {}).includes('since'), true, `stage 2's map: ${JSON.stringify(p.stages[1].map)}`);
});

test('#631 no bundled pipeline names a retired workflow file', () => {
  const used = pipelineFiles().flatMap((f) => stagesOf(f).filter((s) => s.workflow).map((s) => `${f}: ${path.basename(String(s.workflow), '.yaml')}`));
  assert.deepEqual(used.filter((u) => RETIRED.includes(u.split(': ')[1])), []);
});

// ---- the README --------------------------------------------------------------------------------------

const readmeSections = () => [...fs.readFileSync(path.join(root, 'README.md'), 'utf8').matchAll(/^#+ .*\(`workflows\/([a-z0-9-]+)\.yaml`\)/gm)].map((m) => m[1]);

test('#631 the README has a section for each of the Code & Build workflows', () => {
  const sections = readmeSections();
  assert.deepEqual(CODE_AND_BUILD.filter((id) => !sections.includes(id)), []);
});

test('#631 the README documents no workflow that is not bundled any more', () => {
  const sections = readmeSections();
  assert.deepEqual(sections.filter((id) => !fs.existsSync(path.join(WORKFLOWS, `${id}.yaml`))), []);
});
