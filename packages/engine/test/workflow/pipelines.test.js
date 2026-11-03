// packages/engine/domains/workflow/pipelines.js (#135): a saved pipeline, a named chain of workflows started like a workflow.
// parsePipeline/validatePipeline (the shape and the mapping checks), pipelineThen (the phase-1 chain
// a pipeline run carries), fromChain/toYaml (a hand-made chain saved as a pipeline, and back), and
// seeding/status/restore (the same rules as the workflows, test/workflows.test.js). The service
// wiring (starting one, a pipeline run, saving, restoring over the workspace) is
// test/service/pipelines.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const pipelines = require('../../domains/workflow/pipelines');
const { loadWorkflow } = require('../../engine/workflow');

const root = path.join(__dirname, '..', '..', '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A workflow stub for validatePipeline: just enough shape (inputs/outputs/metadata) to check a mapping.
const wf = (inputs = {}, outputs = {}, category = null) => ({ inputs, outputs, metadata: category ? { category } : {} });

// ---- parsePipeline --------------------------------------------------------------------------------

test('parsePipeline: the minimal shape (name, 2+ stages, the first a workflow)', () => {
  const p = pipelines.parsePipeline({ name: 'My pipe', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml' }] }, 'p.yaml');
  assert.equal(p.file, 'p.yaml');
  assert.equal(p.name, 'My pipe');
  assert.equal(p.description, '');
  assert.equal(p.category, null);
  assert.deepEqual(p.stages, [
    { workflow: 'a.yaml', target: 'workflow', on: 'success', inputs: {} },
    { workflow: 'b.yaml', target: 'workflow', on: 'success', inputs: {} },
  ]);
});

test('parsePipeline: without a name, the file name (without .yaml) is used', () => {
  const p = pipelines.parsePipeline({ stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml' }] }, 'my-pipe.yaml');
  assert.equal(p.name, 'my-pipe');
});

test('parsePipeline: not a mapping, or fewer than 2 stages, is refused', () => {
  assert.throws(() => pipelines.parsePipeline(null, 'p.yaml'), /YAML mapping with "name" and "stages"/);
  assert.throws(() => pipelines.parsePipeline('text', 'p.yaml'), /YAML mapping with "name" and "stages"/);
  assert.throws(() => pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }] }, 'p.yaml'), /at least two, the first one a workflow/);
  assert.throws(() => pipelines.parsePipeline({ name: 'P', stages: 'nope' }, 'p.yaml'), /at least two, the first one a workflow/);
});

test('parsePipeline: an unknown category is refused', () => {
  assert.throws(() => pipelines.parsePipeline({ name: 'P', category: 'weird', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml' }] }, 'p.yaml'),
    /category must be one of build, monitor, plan/);
});

test('parsePipeline: a stage needs a workflow or a known target; an unknown target is refused', () => {
  assert.throws(() => pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, {}] }, 'p.yaml'), /"workflow" needs a workflow/);
  assert.throws(() => pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { target: 'weird' }] }, 'p.yaml'), /target must be one of/);
});

test('parsePipeline: "when" reads as "on" (#137\'s first files); only "success" is supported', () => {
  const p = pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml', when: 'success' }] }, 'p.yaml');
  assert.equal(p.stages[1].on, 'success');
  assert.throws(() => pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml', on: 'failure' }] }, 'p.yaml'),
    /only "success"/);
});

test('parsePipeline: stage 1 is a workflow with no map (nothing precedes it); a later map with no value is dropped', () => {
  assert.throws(() => pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml', map: { x: 'y' } }, { workflow: 'b.yaml' }] }, 'p.yaml'),
    /stage 1 has no previous workflow to map from/);
  const p = pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml', map: { x: 'y', empty: '' } }] }, 'p.yaml');
  assert.deepEqual(p.stages[1].map, { x: 'y' });
});

test('parsePipeline: a target stage (product_owner/queue) must be the last one', () => {
  assert.throws(() => pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { target: 'product_owner' }, { workflow: 'c.yaml' }] }, 'p.yaml'),
    /ends the pipeline: nothing can follow it/);
});

test('parsePipeline: "map"/"inputs" must be mappings', () => {
  assert.throws(() => pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml', map: 'nope' }] }, 'p.yaml'),
    /map must be \{ <input>: <output of the previous workflow> \}/);
  assert.throws(() => pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml', inputs: 'nope' }, { workflow: 'b.yaml' }] }, 'p.yaml'),
    /inputs must be \{ <input>: <value> \}/);
});

// ---- validatePipeline -----------------------------------------------------------------------------

test('validatePipeline: a stage\'s fixed inputs must be inputs the workflow declares', () => {
  const p = pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml', inputs: { mode: 'validated' } }, { workflow: 'b.yaml' }] }, 'p.yaml');
  const wfs = { 'a.yaml': wf({}), 'b.yaml': wf({ task: {} }) };
  assert.throws(() => pipelines.validatePipeline(p, (f) => wfs[f]), /input "mode" is not an input of a\.yaml \(its inputs: none\)/);
});

test('validatePipeline: a map target input must be declared by the next workflow', () => {
  const p = pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml', map: { nope: 'issues' } }] }, 'p.yaml');
  const wfs = { 'a.yaml': wf({}, { issues: {} }), 'b.yaml': wf({ task: {} }) };
  assert.throws(() => pipelines.validatePipeline(p, (f) => wfs[f]),
    /Pipeline "P" \(p\.yaml\), stage 2 \(b\.yaml\): maps to input "nope", which b\.yaml does not declare \(its inputs: task\)\./);
});

test('validatePipeline: a map source output must be declared by the previous workflow', () => {
  const p = pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml', map: { task: 'nope' } }] }, 'p.yaml');
  const wfs = { 'a.yaml': wf({}, { issues: {} }), 'b.yaml': wf({ task: {} }) };
  assert.throws(() => pipelines.validatePipeline(p, (f) => wfs[f]),
    /input "task" maps from output "nope", which a\.yaml does not declare \(its outputs: issues\)\./);
});

test('validatePipeline: a product_owner/queue stage needs the previous workflow to declare "issues" or "issue"', () => {
  const p1 = pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { target: 'product_owner' }] }, 'p.yaml');
  assert.throws(() => pipelines.validatePipeline(p1, () => wf({}, {})), /declares no "issues" or "issue" output to place in the roadmap/);
  const p2 = pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { target: 'queue', workflow: 'b.yaml' }] }, 'p.yaml');
  assert.throws(() => pipelines.validatePipeline(p2, () => wf({}, {})), /declares no "issues" or "issue" output to plan for a workflow/); // #446: the roadmap
});

test('validatePipeline: without a map, the Start drawer\'s default mapping is used', () => {
  const p = pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml' }] }, 'p.yaml');
  const wfs = { 'a.yaml': wf({}, { issues: {} }), 'b.yaml': wf({ issues: { type: 'array' } }) };
  const out = pipelines.validatePipeline(p, (f) => wfs[f]);
  assert.deepEqual(out.stages[1].map, { issues: 'issues' });
});

test('validatePipeline: a run (@run) source is accepted without a matching output', () => {
  const p = pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml', map: { base: '@run' } }] }, 'p.yaml');
  const wfs = { 'a.yaml': wf({}, {}), 'b.yaml': wf({ base: { type: 'run' } }) };
  const out = pipelines.validatePipeline(p, (f) => wfs[f]);
  assert.deepEqual(out.stages[1].map, { base: '@run' });
});

test('validatePipeline: an explicit category wins; without one, the first workflow\'s category, else "build"', () => {
  const stages = [{ workflow: 'a.yaml' }, { workflow: 'b.yaml' }];
  const wfs = { 'a.yaml': wf({}, {}, 'plan'), 'b.yaml': wf({}) };
  assert.equal(pipelines.validatePipeline(pipelines.parsePipeline({ name: 'P', category: 'monitor', stages }, 'p.yaml'), (f) => wfs[f]).category, 'monitor');
  assert.equal(pipelines.validatePipeline(pipelines.parsePipeline({ name: 'P', stages }, 'p.yaml'), (f) => wfs[f]).category, 'plan');
  assert.equal(pipelines.validatePipeline(pipelines.parsePipeline({ name: 'P', stages }, 'p.yaml'), () => wf({})).category, 'build');
});

test('validatePipeline: a workflow that fails to load is named in the error', () => {
  const p = pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { workflow: 'gone.yaml' }] }, 'p.yaml');
  assert.throws(() => pipelines.validatePipeline(p, (f) => { if (f === 'gone.yaml') throw new Error('not found'); return wf({}); }),
    /stage 2 \(gone\.yaml\): workflow "gone\.yaml" could not be loaded: not found/);
});

// ---- pipelineThen -----------------------------------------------------------------------------------

test('pipelineThen: a 2-stage pipeline gives the first run a `then` for stage 2, its pipeline meta attached', () => {
  const p = { file: 'p.yaml', name: 'Pipe', stages: [
    { workflow: 'a.yaml', target: 'workflow', on: 'success', inputs: {} },
    { workflow: 'b.yaml', target: 'workflow', on: 'success', inputs: { mode: 'validated' }, map: { task: 'issues' } },
  ] };
  const then = pipelines.pipelineThen(p);
  assert.deepEqual(then, {
    action: 'workflow', workflow: 'b.yaml', map: { task: 'issues' }, inputs: { mode: 'validated' },
    pipeline: { file: 'p.yaml', name: 'Pipe', stage: 1, stages: 2 },
  });
});

test('pipelineThen: a 3-stage pipeline nests the second stage\'s then inside the first\'s', () => {
  const p = { file: 'p.yaml', name: 'Pipe', stages: [
    { workflow: 'a.yaml', target: 'workflow', on: 'success', inputs: {} },
    { workflow: 'b.yaml', target: 'workflow', on: 'success', inputs: {}, map: {} },
    { workflow: 'c.yaml', target: 'workflow', on: 'success', inputs: {}, map: { x: 'y' } },
  ] };
  const then = pipelines.pipelineThen(p);
  assert.equal(then.pipeline.stage, 1);
  assert.equal(then.then.workflow, 'c.yaml');
  assert.deepEqual(then.then.pipeline, { file: 'p.yaml', name: 'Pipe', stage: 2, stages: 3 });
  assert.equal(then.then.then, undefined);
});

test('pipelineThen: a product_owner or queue target ends the chain', () => {
  const po = { file: 'p.yaml', name: 'Pipe', stages: [{ workflow: 'a.yaml', target: 'workflow', on: 'success', inputs: {} }, { target: 'product_owner', on: 'success', inputs: {} }] };
  assert.deepEqual(pipelines.pipelineThen(po), { action: 'product_owner', pipeline: { file: 'p.yaml', name: 'Pipe', stage: 1, stages: 2 } });
  const q = { file: 'p.yaml', name: 'Pipe', stages: [{ workflow: 'a.yaml', target: 'workflow', on: 'success', inputs: {} }, { target: 'queue', workflow: 'b.yaml', on: 'success', inputs: { mode: 'x' } }] };
  assert.deepEqual(pipelines.pipelineThen(q), { action: 'queue', workflow: 'b.yaml', inputs: { mode: 'x' }, pipeline: { file: 'p.yaml', name: 'Pipe', stage: 1, stages: 2 } });
});

test('pipelineThen: an id given is stamped on the pipeline meta', () => {
  const p = { file: 'p.yaml', name: 'Pipe', stages: [{ workflow: 'a.yaml', target: 'workflow', on: 'success', inputs: {} }, { workflow: 'b.yaml', target: 'workflow', on: 'success', inputs: {}, map: {} }] };
  const then = pipelines.pipelineThen(p, 1, 'run-1');
  assert.equal(then.pipeline.id, 'run-1');
});

test('pipelineThen: past the last stage, nothing', () => {
  const p = { file: 'p.yaml', name: 'Pipe', stages: [{ workflow: 'a.yaml', target: 'workflow', on: 'success', inputs: {} }, { workflow: 'b.yaml', target: 'workflow', on: 'success', inputs: {}, map: {} }] };
  assert.equal(pipelines.pipelineThen(p, 2), null);
});

// ---- fromChain / toYaml -----------------------------------------------------------------------------

test('fromChain: a run\'s workflow, then each step of its chain, as a pipeline', () => {
  const then = { action: 'workflow', workflow: 'b.yaml', map: { task: 'issues' }, inputs: { mode: 'validated' },
    then: { action: 'queue', workflow: 'c.yaml', inputs: {} } };
  const p = pipelines.fromChain({ file: 'a.yaml', then }, { name: 'My chain', description: 'desc', category: 'build' });
  assert.equal(p.file, 'my-chain.yaml');
  assert.equal(p.name, 'My chain');
  assert.equal(p.description, 'desc');
  assert.equal(p.category, 'build');
  assert.deepEqual(p.stages, [
    { workflow: 'a.yaml', target: 'workflow', on: 'success', inputs: {} },
    { workflow: 'b.yaml', target: 'workflow', on: 'success', map: { task: 'issues' }, inputs: { mode: 'validated' } },
    { workflow: 'c.yaml', target: 'queue', on: 'success', inputs: {} },
  ]);
});

test('fromChain: a product_owner step becomes a product_owner stage', () => {
  const p = pipelines.fromChain({ file: 'a.yaml', then: { action: 'product_owner' } }, { name: 'PO chain' });
  assert.deepEqual(p.stages[1], { workflow: null, target: 'product_owner', on: 'success', inputs: {} });
});

test('fromChain: without a name, or without a chain to save, it is refused', () => {
  assert.throws(() => pipelines.fromChain({ file: 'a.yaml', then: { action: 'workflow', workflow: 'b.yaml' } }, { name: '  ' }), /Give the pipeline a name/);
  assert.throws(() => pipelines.fromChain({ file: 'a.yaml', then: null }, { name: 'X' }), /no chain to save/);
});

test('toYaml round-trips through parsePipeline: the same stages and maps come back', () => {
  const p = pipelines.parsePipeline({
    name: 'Round trip', description: 'desc', category: 'monitor',
    stages: [
      { workflow: 'a.yaml', inputs: { mode: 'validated' } },
      { workflow: 'b.yaml', map: { task: 'issues' }, inputs: { lang: 'go' } },
      { target: 'product_owner' },
    ],
  }, 'round-trip.yaml');
  const text = pipelines.toYaml(p);
  const back = pipelines.parsePipeline(yaml.load(text), 'round-trip.yaml');
  assert.deepEqual(back, p);
});

test('toYaml: defaults (target workflow, on success, empty maps/inputs) are left out of the file', () => {
  const p = pipelines.parsePipeline({ name: 'P', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml' }] }, 'p.yaml');
  const text = pipelines.toYaml(p);
  assert.doesNotMatch(text, /target:/);
  assert.doesNotMatch(text, /on:/);
  assert.doesNotMatch(text, /map:/);
  assert.doesNotMatch(text, /inputs:/);
});

// ---- seeding / status / restore (same rules as workflows, test/workflows.test.js) --------------------

const pipeYaml = (name, stage2Workflow = 'b.yaml') =>
  `name: ${name}\nstages:\n  - workflow: a.yaml\n  - workflow: ${stage2Workflow}\n`;
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

test('seedPipelines copies the bundled pipelines once and never touches user files', (t) => {
  const src = tmp(t);
  const dest = path.join(tmp(t), 'pipelines');
  write(src, 'p1.yaml', pipeYaml('P1'));
  write(src, 'p2.yaml', pipeYaml('P2'));
  assert.deepEqual(pipelines.seedPipelines(src, dest), ['p1.yaml', 'p2.yaml']);
  assert.equal(read(dest, 'p1.yaml'), read(src, 'p1.yaml'));
  assert.deepEqual(pipelines.seedPipelines(src, dest), []); // idempotent

  write(dest, 'mine.yaml', pipeYaml('Mine'));
  fs.rmSync(path.join(dest, 'p2.yaml')); // deleted by the user: does not come back
  assert.deepEqual(pipelines.seedPipelines(src, dest), []);
  assert.equal(fs.existsSync(path.join(dest, 'p2.yaml')), false);
  assert.equal(pipelines.pipelineStatus(src, dest)['mine.yaml'].origin, 'custom');
});

test('a bundled pipeline update reaches untouched copies; an edited copy is kept, flagged and restorable', (t) => {
  const src = tmp(t);
  const dest = path.join(tmp(t), 'pipelines');
  write(src, 'p1.yaml', pipeYaml('P1'));
  pipelines.seedPipelines(src, dest);
  write(dest, 'p1.yaml', pipeYaml('P1 edited', 'c.yaml')); // user edit
  assert.deepEqual(pipelines.pipelineStatus(src, dest)['p1.yaml'], { origin: 'modified', updateAvailable: false, restorable: true });

  write(src, 'p1.yaml', pipeYaml('P1 v2'));
  assert.deepEqual(pipelines.seedPipelines(src, dest), []); // edited: not overwritten
  assert.deepEqual(pipelines.pipelineStatus(src, dest)['p1.yaml'], { origin: 'modified', updateAvailable: true, restorable: true });

  pipelines.restorePipeline(src, dest, 'p1.yaml');
  assert.equal(read(dest, 'p1.yaml'), read(src, 'p1.yaml'));
  assert.deepEqual(pipelines.pipelineStatus(src, dest)['p1.yaml'], { origin: 'default', updateAvailable: false, restorable: false });
  assert.throws(() => pipelines.restorePipeline(src, dest, 'mine.yaml'), /not a bundled default/);
});

// ---- every bundled pipeline loads against the bundled workflows --------------------------------------

test('every bundled pipeline (pipelines/*.yaml) loads and validates against the bundled workflows', () => {
  const dir = pipelines.BUNDLED_PIPELINES_DIR;
  const files = fs.readdirSync(dir).filter(pipelines.isPipelineFile);
  assert.ok(files.length >= 4, 'at least the 4 bundled pipelines are present');
  const workflowOf = (file) => loadWorkflow(path.join(root, 'workflows', file));
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const p = pipelines.loadPipelineText(text, file, workflowOf);
    assert.ok(p.stages.length >= 2, file);
    assert.ok(p.name, file);
  }
});
