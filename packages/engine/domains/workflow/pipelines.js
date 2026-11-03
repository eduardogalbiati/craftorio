// Saved pipelines (#135): a named chain of workflows (#134) started like a workflow. One YAML file per
// pipeline in <workspace>/pipelines; the app folder only holds the bundled defaults (pipelines/*.yaml),
// seeded like the workflows (packages/engine/domains/seed/seed.js: copied once, untouched copies updated, edited copies kept,
// restorable). A pipeline is
//   name, description, category (plan / build / monitor, like workflows)
//   stages: the first one a workflow (its `inputs` are fixed values, the rest asked when it starts);
//     each next one { workflow, map: { <input>: <output of the previous workflow> | '@run' }, inputs, on }
//     or a target that ends it: { target: product_owner } (the PO places the produced issues in the
//     roadmap) or { target: queue, workflow, inputs } (the produced issues are planned for a workflow in a new roadmap stage, #446).
//     Without `map`, the mapping is the one the Start drawer proposes (chain-model defaultMap).
//     `on: success` (the default, the only one): a stage that fails or stops pauses the pipeline.
// It runs as a phase-1 chain: the first stage's run gets a `then` for the second stage with the rest
// nested in it (`then.then`), each with `pipeline: { id, file, name, stage, stages }`; the pipeline
// run's id is its first run's id (packages/engine/service/areas/pipelines.js starts it, areas/chain.js goes on).
// Loading checks every mapping against the outputs the previous workflow declares and refuses the
// pipeline with the workflow and the missing output named.

const path = require('path');
const yaml = require('js-yaml');
const chain = require('@multiagent/shared/chain-model');
const { aliasOf } = require('@multiagent/shared/default-workflow');
const { seedBundle, bundleStatus, restoreBundled } = require('../seed/seed');
const { WORKFLOW_KIND } = require('./workflows');
const { WORKFLOW_CATEGORIES } = require('./workflow-categories');
const { bundledDir } = require('../workspace/app-root');

const BUNDLED_PIPELINES_DIR = bundledDir('pipelines');
// one YAML file per pipeline, like the workflows
const PIPELINE_KIND = WORKFLOW_KIND;
const TARGETS = ['product_owner', 'queue', 'workflow'];
const CONDITIONS = ['success'];
const CATEGORIES = WORKFLOW_CATEGORIES;
const TARGET_LABELS = { product_owner: 'Product Owner (roadmap)', queue: 'Plan (Roadmap)' };
// #648: renamed bundled pipelines. An old name (a saved Assign, a discovery automation) resolves to the
// new file when the workspace no longer has the old one (service/areas/pipelines.js readPipeline).
const PIPELINE_ALIASES = {
  'enrich-save-develop.yaml': 'enrich-issue.yaml',
  'rfc-to-issues.yaml': 'spec-to-issues.yaml',
};

/** The new file an old pipeline name stands for, or null. */
const pipelineAliasOf = (file) => PIPELINE_ALIASES[String(file || '').split(/[\\/]/).pop()] || null;

const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
const fileOf = (w) => String(w || '').split(/[\\/]/).pop();
const isPipelineFile = (f) => /\.ya?ml$/i.test(f);

/** Copies/updates the bundled pipelines into the workspace folder. Returns the files copied or updated. */
const seedPipelines = (srcDir, destDir) => seedBundle(srcDir, destDir, PIPELINE_KIND);

/** { [file]: { origin: 'default'|'modified'|'custom', updateAvailable, restorable } } for the workspace folder. */
const pipelineStatus = (srcDir, destDir) => bundleStatus(srcDir, destDir, PIPELINE_KIND);

/** Replaces the user's copy of a bundled pipeline with the default. */
const restorePipeline = (srcDir, destDir, file) => restoreBundled(srcDir, destDir, PIPELINE_KIND, path.basename(String(file || '')));

/** The file a new pipeline gets from its name. */
function fileNameFor(name) {
  const slug = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'pipeline'}.yaml`;
}

// #648: a stage naming an old workflow (an alias) keeps only the inputs and mappings the new workflow
// declares: a saved copy's `document_skill` or `goal` has no place there (the run ignores it anyway).
function dropUnknownInputs(s, defs) {
  const known = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => defs[k]));
  return { ...s, inputs: known(s.inputs), ...(s.map ? { map: known(s.map) } : {}) };
}

const stageName = (s, i) => `stage ${i + 1} (${s.target === 'workflow' ? s.workflow : TARGET_LABELS[s.target]})`;

/**
 * A pipeline document (parsed YAML) → { file, name, description, category, stages }. Throws on a bad
 * shape; the mappings are checked by validatePipeline. `when:` (#137's first files) reads as `on:`.
 */
function parsePipeline(doc, file) {
  if (!plain(doc)) throw new Error('A pipeline is a YAML mapping with "name" and "stages".');
  const name = String(doc.name || fileOf(file).replace(/\.ya?ml$/i, ''));
  const category = doc.category ? String(doc.category) : null;
  if (category && !CATEGORIES.includes(category)) throw new Error(`category must be one of ${CATEGORIES.join(', ')} (got "${category}").`);
  if (!Array.isArray(doc.stages) || doc.stages.length < 2) throw new Error('A pipeline needs "stages": at least two, the first one a workflow.');
  const stages = doc.stages.map((s, i) => {
    if (!plain(s)) throw new Error(`stage ${i + 1} must be a mapping with a "workflow" or a "target".`);
    const target = String(s.target || 'workflow');
    if (!TARGETS.includes(target)) throw new Error(`stage ${i + 1}: target must be one of ${TARGETS.join(', ')} (got "${target}").`);
    const workflow = target === 'product_owner' ? null : fileOf(s.workflow);
    if (target !== 'product_owner' && !workflow) throw new Error(`stage ${i + 1}: "${target}" needs a workflow.`);
    const on = String(s.on ?? s.when ?? 'success');
    if (!CONDITIONS.includes(on)) throw new Error(`stage ${i + 1}: "on: ${on}" is not supported: only "success" (a stage that fails or stops pauses the pipeline).`);
    if (s.map != null && !plain(s.map)) throw new Error(`stage ${i + 1}: map must be { <input>: <output of the previous workflow> }.`);
    if (s.inputs != null && !plain(s.inputs)) throw new Error(`stage ${i + 1}: inputs must be { <input>: <value> }.`);
    const stage = { workflow, target, on, inputs: plain(s.inputs) ? { ...s.inputs } : {} };
    if (plain(s.map)) stage.map = Object.fromEntries(Object.entries(s.map).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
    return stage;
  });
  if (stages[0].target !== 'workflow') throw new Error('stage 1 must be a workflow: a pipeline starts like one.');
  if (stages[0].map && Object.keys(stages[0].map).length) throw new Error('stage 1 has no previous workflow to map from: give its values as "inputs".');
  const end = stages.findIndex((s) => s.target !== 'workflow');
  if (end >= 0 && end < stages.length - 1) throw new Error(`${stageName(stages[end], end)} ends the pipeline: nothing can follow it.`);
  return { file: fileOf(file), name, description: doc.description ? String(doc.description) : '', category, stages };
}

/**
 * Checks a parsed pipeline against its workflows and fills each stage's default mapping. Throws a
 * clear message naming the pipeline, the stage, the workflow and the missing output or input.
 * @param {object} p parsePipeline's result
 * @param {(file: string) => object} workflowOf the loaded workflow of a file (throws when it is missing)
 * @returns {object} the pipeline, each stage with its `map` and the first stage's `category` fallback
 */
function validatePipeline(p, workflowOf) {
  const where = (s, i) => `Pipeline "${p.name}" (${p.file}), ${stageName(s, i)}`;
  const wfs = p.stages.map((s, i) => {
    if (!s.workflow) return null;
    try { return workflowOf(s.workflow); } catch (e) { throw new Error(`${where(s, i)}: workflow "${s.workflow}" could not be loaded: ${e.message}`); }
  });
  const stages = p.stages.map((s0, i) => {
    const wf = wfs[i];
    const defs = wf?.inputs || {};
    const s = s0.workflow && aliasOf(s0.workflow) ? dropUnknownInputs(s0, defs) : s0;
    for (const k of Object.keys(s.inputs)) {
      if (!defs[k]) throw new Error(`${where(s, i)}: input "${k}" is not an input of ${s.workflow} (its inputs: ${Object.keys(defs).join(', ') || 'none'}).`);
    }
    if (!i) return { ...s, map: {} };
    const prev = p.stages[i - 1];
    const outs = wfs[i - 1]?.outputs || {};
    const declared = Object.keys(outs).join(', ') || 'none';
    if (s.target === 'product_owner' || s.target === 'queue') {
      if (!outs.issues && !outs.issue) throw new Error(`${where(s, i)}: ${prev.workflow} declares no "issues" or "issue" output to ${s.target === 'queue' ? 'plan for a workflow' : 'place in the roadmap'} (its outputs: ${declared}).`);
      return { ...s, map: {} };
    }
    const map = s.map || chain.defaultMap(outs, defs);
    for (const [input, output] of Object.entries(map)) {
      if (!defs[input]) throw new Error(`${where(s, i)}: maps to input "${input}", which ${s.workflow} does not declare (its inputs: ${Object.keys(defs).join(', ') || 'none'}).`);
      if (output !== chain.RUN_SOURCE && !outs[output]) throw new Error(`${where(s, i)}: input "${input}" maps from output "${output}", which ${prev.workflow} does not declare (its outputs: ${declared}).`);
    }
    return { ...s, map };
  });
  return { ...p, category: p.category || wfs[0]?.metadata?.category || 'build', stages };
}

/** Reads, parses and validates a pipeline file's text. */
function loadPipelineText(text, file, workflowOf) {
  return validatePipeline(parsePipeline(yaml.load(text), file), workflowOf);
}

/**
 * The `then` the run of stage `index - 1` gets: stage `index` with the rest nested in it, each with the
 * pipeline it belongs to. `id` is the pipeline run's id (its first run's), unknown before it starts.
 */
function pipelineThen(p, index = 1, id = null) {
  const s = p.stages[index];
  if (!s) return null;
  const pipeline = { ...(id ? { id } : {}), file: p.file, name: p.name, stage: index, stages: p.stages.length };
  if (s.target === 'product_owner') return { action: 'product_owner', pipeline };
  if (s.target === 'queue') return { action: 'queue', workflow: s.workflow, inputs: { ...s.inputs }, pipeline };
  const then = pipelineThen(p, index + 1, id);
  return { action: 'workflow', workflow: s.workflow, map: { ...s.map }, inputs: { ...s.inputs }, pipeline, ...(then ? { then } : {}) };
}

/**
 * A chain set up by hand (phase 1) as a pipeline: the run's workflow, then each `then` in turn.
 * @param {{ file: string, inputs?: object, then: object }} first the run's workflow and its chain
 * @param {{ name: string, description?: string, category?: string }} meta
 */
function fromChain({ file, then }, { name, description = '', category = null } = {}) {
  if (!String(name || '').trim()) throw new Error('Give the pipeline a name.');
  const stages = [{ workflow: fileOf(file), target: 'workflow', on: 'success', inputs: {} }];
  let t = chain.normalizeThen(then);
  if (!t) throw new Error('This run has no chain to save: add one with "When it finishes" first.');
  for (let n = 0; t && n < chain.MAX_DEPTH; n++, t = t.then || null) {
    if (t.action === 'product_owner') stages.push({ workflow: null, target: 'product_owner', on: 'success', inputs: {} });
    else if (t.action === 'queue') stages.push({ workflow: t.workflow, target: 'queue', on: 'success', inputs: { ...t.inputs } });
    else stages.push({ workflow: t.workflow, target: 'workflow', on: 'success', map: { ...t.map }, inputs: { ...t.inputs } });
  }
  return { file: fileNameFor(name), name: String(name).trim(), description: String(description || '').trim(), category: category || null, stages };
}

/** A pipeline as the YAML its file holds (defaults left out: target workflow, on success, empty maps). */
function toYaml(p) {
  const doc = { name: p.name };
  if (p.description) doc.description = p.description;
  if (p.category) doc.category = p.category;
  doc.stages = p.stages.map((s, i) => {
    const out = s.target === 'workflow' ? { workflow: s.workflow } : { target: s.target, ...(s.workflow ? { workflow: s.workflow } : {}) };
    if (i && s.map && Object.keys(s.map).length) out.map = s.map;
    if (Object.keys(s.inputs || {}).length) out.inputs = s.inputs;
    if (s.on && s.on !== 'success') out.on = s.on;
    return out;
  });
  return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}

/** The workflows a pipeline runs (file names), in order; a Product Owner stage starts none. */
const pipelineWorkflows = (p) => p.stages.filter((s) => s.target !== 'product_owner').map((s) => s.workflow);

module.exports = {
  BUNDLED_PIPELINES_DIR,
  CATEGORIES,
  fileNameFor,
  fromChain,
  isPipelineFile,
  loadPipelineText,
  parsePipeline,
  PIPELINE_ALIASES,
  PIPELINE_KIND,
  pipelineAliasOf,
  pipelineStatus,
  pipelineThen,
  pipelineWorkflows,
  restorePipeline,
  seedPipelines,
  TARGETS,
  toYaml,
  validatePipeline,
};
