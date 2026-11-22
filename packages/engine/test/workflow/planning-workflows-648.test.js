// #648 (phase 2 of #636, docs/work/write-doc/spec.md R14): Arena mode and the Planning workflows as
// write-doc + issue. Acceptance tests, written before the code.
//
// The interface these tests assume (from the issue and the spec):
// - writer-reviewer and ai-arena become write-doc (writers 1–5: "Several writers", Arena mode in the
//   draft); issue-tracker becomes issue, with a "from a spec" input. The old names stay as aliases
//   (as #630 / #631: packages/engine/domains/workflow/workflows.js resolveWorkflow,
//   packages/shared/default-workflow.js aliasOf / resolve); the old files are no longer bundled.
// - Pipelines: rfc-to-issues becomes spec-to-issues, enrich-save-develop becomes enrich-issue,
//   ai-arena-write-review is absorbed (write-doc's Arena mode does what it did). The old pipeline
//   names still resolve (a chain, a roadmap or a Discovery column naming one keeps working).
// - Done when: saved pipelines, repository manifests and the roadmap run unchanged through the new
//   names: a workspace's saved copy of an old pipeline (naming ai-arena.yaml, writer-reviewer.yaml,
//   issue-tracker.yaml) still loads, and a roadmap stage / manifest naming an old workflow resolves.
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
const epics = () => require('../../domains/backlog/epics');
const defaultWorkflow = () => require('@craftorio/shared/default-workflow');
const service = () => require('../service/helpers');

const loadBundled = (name) => engine().loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`));
// a stage's workflow as the service loads it: through the aliases, then the bundled folder
const workflowOf = (file) => {
  const { resolveWorkflow, BUNDLED_WORKFLOWS_DIR } = workflows();
  return engine().loadWorkflow(resolveWorkflow(path.basename(String(file)), [BUNDLED_WORKFLOWS_DIR]).file);
};

const ALIASES = [
  ['writer-reviewer', 'write-doc.yaml'],
  ['ai-arena', 'write-doc.yaml'],
  ['issue-tracker', 'issue.yaml'],
];

// every value an input offers, as text: its enum, its options' keys, its min/max
function offered(input) {
  const out = [];
  for (const v of Array.isArray(input?.enum) ? input.enum : []) out.push(String(v));
  if (input?.options && typeof input.options === 'object' && !Array.isArray(input.options)) out.push(...Object.keys(input.options));
  return out;
}

// ---- the workflows ---------------------------------------------------------------------------------

test('#648 issue.yaml is bundled, loads and is named issue', () => {
  const wf = loadBundled('issue');
  assert.equal(wf.name, 'issue');
});

test('#648 issue.yaml keeps the issue tracker\'s issues output (the roadmap and the queue place them)', () => {
  const wf = loadBundled('issue');
  assert.equal(Boolean(wf.outputs?.issues), true, `its outputs: ${JSON.stringify(Object.keys(wf.outputs || {}))}`);
});

test('#648 issue.yaml takes a "from a spec" input', () => {
  const wf = loadBundled('issue');
  const inputs = Object.entries(wf.inputs || {});
  const found = inputs.some(([name, input]) => /spec/i.test(name) || /spec/i.test(String(input?.label || '')));
  assert.equal(found, true, `its inputs: ${JSON.stringify(inputs.map(([n]) => n))}`);
});

test('#648 write-doc.yaml has a writers input, one writer by default, up to five (Arena mode)', () => {
  const wf = loadBundled('write-doc');
  const writers = wf.inputs?.writers;
  assert.equal(Boolean(writers), true, `its inputs: ${JSON.stringify(Object.keys(wf.inputs || {}))}`);
  assert.equal(Number(writers.default), 1);
  const values = offered(writers);
  const allowsFive = values.includes('5') || Number(writers.maximum ?? writers.max) === 5;
  const allowsSix = values.includes('6') || Number(writers.maximum ?? writers.max) > 5;
  assert.equal(allowsFive, true, `writers offers ${JSON.stringify(values)} (max ${writers.maximum ?? writers.max})`);
  assert.equal(allowsSix, false, 'more than five writers is offered');
});

test('#648 the old Planning workflow files are no longer bundled (they resolve through an alias only)', () => {
  const left = ALIASES.map(([old]) => `${old}.yaml`).filter((f) => fs.existsSync(path.join(WORKFLOWS, f)));
  assert.deepEqual(left, []);
});

// ---- the old names are aliases ---------------------------------------------------------------------

for (const [old, file] of ALIASES) {
  test(`#648 the old name ${old}.yaml resolves to ${file}`, () => {
    const { resolveWorkflow, BUNDLED_WORKFLOWS_DIR } = workflows();
    const r = resolveWorkflow(`${old}.yaml`, [BUNDLED_WORKFLOWS_DIR]);
    assert.equal(path.basename(String(r.file)), file);
  });

  test(`#648 aliasOf(${old}) names ${file}`, () => {
    const alias = defaultWorkflow().aliasOf(old);
    assert.equal(path.basename(String(alias?.file)), file);
  });
}

test('#648 a run of the issue workflow places its filed issues in the epic, like the issue tracker\'s', () => {
  const steps = {
    analyze: { output: { epic: { id: '#5', title: 'Run safety', match: 'clear', reason: 'same theme' } } },
    review: { output: { choice: 'create' } },
    file: { output: { filed: [{ action: 'created', number: 10, url: 'u', title: 't' }] } },
  };
  assert.deepEqual(epics().filedToEpic({ workflow: 'issue', status: 'success', steps }), { epic: '#5', numbers: [10] });
});

// ---- the bundled pipelines -------------------------------------------------------------------------

const pipelineFiles = () => fs.readdirSync(PIPELINES).filter((f) => pipelines().isPipelineFile(f)).sort();
const stagesOf = (file) => (yaml.load(fs.readFileSync(path.join(PIPELINES, file), 'utf8')).stages || []);
const stageNames = (file) => stagesOf(file).map((s) => (s.workflow ? path.basename(String(s.workflow)) : s.target));

test('#648 the bundled pipelines: spec-to-issues and enrich-issue replace rfc-to-issues and enrich-save-develop; ai-arena-write-review is gone', () => {
  assert.deepEqual(pipelineFiles(), ['enrich-issue.yaml', 'issue-to-roadmap.yaml', 'release-then-refactors.yaml', 'spec-to-issues.yaml']);
});

test('#648 spec-to-issues writes the document with write-doc, then files its issues with issue', () => {
  assert.deepEqual(stageNames('spec-to-issues.yaml'), ['write-doc.yaml', 'issue.yaml']);
});

test('#648 enrich-issue enriches with write-doc, then feature implements it', () => {
  assert.deepEqual(stageNames('enrich-issue.yaml'), ['write-doc.yaml', 'feature.yaml']);
});

test('#648 issue-to-roadmap files with issue, then the Product Owner places the issues', () => {
  assert.deepEqual(stageNames('issue-to-roadmap.yaml'), ['issue.yaml', 'product_owner']);
});

test('#648 no bundled pipeline names an old Planning workflow', () => {
  const old = ALIASES.map(([o]) => `${o}.yaml`);
  const used = pipelineFiles().flatMap((f) => stageNames(f).filter((s) => old.includes(s)).map((s) => `${f}: ${s}`));
  assert.deepEqual(used, []);
});

for (const file of ['spec-to-issues.yaml', 'enrich-issue.yaml', 'issue-to-roadmap.yaml']) {
  test(`#648 ${file} loads against the bundled workflows (every input and mapped output exists)`, () => {
    const p = pipelines().loadPipelineText(fs.readFileSync(path.join(PIPELINES, file), 'utf8'), file, workflowOf);
    assert.equal(p.stages.length, stagesOf(file).length);
  });
}

// ---- saved pipelines and old pipeline names keep working (the "Done when") ---------------------------

// the bundled pipelines as they were before #648 (the workspace's saved copies of them)
const OLD_PIPELINES = {
  'rfc-to-issues.yaml': `name: RFC → Issues
category: plan
stages:
  - workflow: ai-arena.yaml
    inputs:
      document_skill: rfc-writing
  - workflow: issue-tracker.yaml
    map:
      request: document
    inputs:
      mode: validated
`,
  'enrich-save-develop.yaml': `name: Enrich → Save → Develop
category: build
stages:
  - workflow: writer-reviewer.yaml
  - workflow: feature.yaml
    map:
      task: document
      issues: issue
    inputs:
      mode: local
`,
  'ai-arena-write-review.yaml': `name: AI Arena → Write & Review
category: plan
stages:
  - workflow: ai-arena.yaml
    inputs:
      document_skill: prd-writing
  - workflow: writer-reviewer.yaml
    map:
      prompt: document
    inputs:
      goal: "A document clear enough to commit to."
`,
  'issue-to-roadmap.yaml': `name: Issue → Roadmap
category: plan
stages:
  - workflow: issue-tracker.yaml
    inputs:
      mode: validated
  - target: product_owner
`,
};

test('#648 a workspace\'s saved copies of the old pipelines still load through the new names (no error in the Pipelines list)', (t) => {
  const { makeService } = service();
  const { service: svc, api } = makeService(t);
  const dir = svc.workspace().pipelines;
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(OLD_PIPELINES)) fs.writeFileSync(path.join(dir, `saved-${file}`), text);
  const list = api['workflows:pipelines']();
  const errors = list.filter((p) => p.file.startsWith('saved-') && p.error).map((p) => `${p.file}: ${p.error}`);
  assert.deepEqual(errors, []);
  assert.equal(list.filter((p) => p.file.startsWith('saved-')).length, 4);
});

for (const old of ['rfc-to-issues.yaml', 'enrich-save-develop.yaml']) {
  test(`#648 the old pipeline name ${old} still resolves in a workspace seeded with the new pipelines`, (t) => {
    const { makeService } = service();
    const { service: svc, api } = makeService(t);
    assert.equal(fs.existsSync(path.join(svc.workspace().pipelines, old)), false, `${old} is still seeded`);
    const est = api['pipelines:estimate']({ file: old });
    assert.equal(typeof est?.text, 'string');
  });
}

// ---- issue: a request or a spec (required_unless) --------------------------------------------------

function issueRun(t, inputs) {
  const { WorkflowRun } = require('../../engine/workflow');
  const runsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'runs-648-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  return new WorkflowRun({ file: path.join(WORKFLOWS, 'issue.yaml'), inputs: { project_path: root, ...inputs }, mock: true, runsDir });
}

test('#648 issue.yaml without a request nor a spec is refused: one of the two is needed', (t) => {
  assert.throws(() => issueRun(t, {}), /Required input not provided: request \(or spec\)/);
  assert.throws(() => issueRun(t, { request: '   ', spec: '' }), /Required input not provided: request \(or spec\)/, 'blank text counts as not given');
});

test('#648 issue.yaml starts with only a spec, or with only a request', (t) => {
  const fromSpec = issueRun(t, { spec: 'docs/work/export-csv/spec.md' });
  assert.equal(fromSpec.inputs.spec, 'docs/work/export-csv/spec.md');
  assert.equal(fromSpec.inputs.request, '');
  const fromRequest = issueRun(t, { request: 'Export runs as CSV' });
  assert.equal(fromRequest.inputs.request, 'Export runs as CSV');
});

// ---- feature: a task that is an accepted document's path (enrich-issue) ----------------------------

const PATH_PHRASE = /The task is an accepted document's path[^\n]*read it, it is the task; the images and HTML files of its folder are the mockups/;

for (const id of ['acceptance_tests', 'warm_up', 'develop']) {
  test(`#648 feature.yaml ${id}: a task naming docs/work/<item>/plan.md tells the agent to read the path and use its folder's mockups`, () => {
    const templates = require('../../engine/run/templates');
    const step = (loadBundled('feature').steps || []).find((s) => String(s.id) === id);
    assert.ok(step, `step ${id} exists`);
    const render = (task) => templates.render(String(step.prompt || ''), { inputs: { mode: 'local', task, base_branch: 'main' }, steps: {}, run: {} });
    assert.match(render('docs/work/export-csv/plan.md'), PATH_PHRASE);
    assert.doesNotMatch(render('Add a CSV export to the runs list'), PATH_PHRASE, 'a plain task gets no path phrase');
  });
}
