// #56: the agents' models are the current ones (Opus 5.5, Fable 5.2, Sonnet 5.5, Haiku 5.5), and a model
// the owner chose earlier is never lost. Acceptance tests written before the code.
// - No leftover: every model a bundled workflow (workflows/), a hero of this repository
//   (.craftorio/workflows/), a built-in agent or a composed workflow names is one the providers' adapters
//   (packages/shared/providers) offer.
// - Saved choices: a run, a roadmap item, a project or a workspace copy of a workflow that names an older
//   model still starts, on that model: every start, resume and roadmap start builds a WorkflowRun with the
//   saved inputs, so the constructor is the seam.
// Not here: the E2E of the resume dialog (features/resume.feature), the prices of a model with no price
// (unknown-model-pricing-369.test.js) and the arena's choices (fronts/plan/test/arena-models-56.test.js).
// The `models:` limits of a workflow are not choices: a limit kept for a model saved by an older run is fine.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const registry = require('@craftorio/shared/providers');
const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');
const wfs = require('../../domains/workflow/workflows');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const BUNDLED = path.join(ROOT, 'workflows');
const HEROES = path.join(ROOT, '.craftorio', 'workflows');
const FEATURE = path.join(BUNDLED, 'feature.yaml');
const LOCAL_HERO = path.join(HEROES, 'ai-development-local-hero.yaml');
const REMOTE_HERO = path.join(HEROES, 'ai-development-remote-hero.yaml');

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const FABLE = 'claude-fable-5-2';
const HAIKU = 'claude-haiku-5-5';
const OLD_FABLE = 'claude-fable-5-1';
const OLD_MODELS = [OLD_FABLE, 'claude-sonnet-5', 'claude-haiku-4-5'];

const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');
const filesOf = (dir) => fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => path.join(dir, f));
const offered = new Set(registry.list().flatMap((a) => a.models));
const notOffered = (ids) => [...new Set(ids)].filter((id) => !offered.has(id));

// the model ids inside a text: a plain id, or the ones a template spells out
const idsIn = (text) => String(text ?? '').match(/\b(?:claude|gpt|grok)-[a-z0-9][\w.-]*/g) || [];

// every model id a parsed workflow names: any `model:` or `fallbacks:` of an agent, a step or the
// orchestrator, and the values (default, choices) of the inputs that choose a model
function modelsNamed(wf) {
  const out = [];
  const walk = (node, where) => {
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${where}[${i}]`)); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'model' && typeof v === 'string') idsIn(v).forEach((id) => out.push({ where, id }));
      else if (k === 'fallbacks' && Array.isArray(v)) v.flatMap(idsIn).forEach((id) => out.push({ where: `${where}.fallbacks`, id }));
      else walk(v, `${where}.${k}`);
    }
  };
  for (const key of ['defaults', 'orchestrator', 'agents', 'steps']) walk(wf[key], key);
  for (const [name, def] of Object.entries(wf.inputs || {})) {
    if (!/model/.test(name)) continue;
    for (const v of [def?.default, ...(def?.enum || [])]) idsIn(v).forEach((id) => out.push({ where: `inputs.${name}`, id }));
  }
  return out;
}
const leftovers = (label, wf) => [...new Set(modelsNamed(wf).filter(({ id }) => !offered.has(id)).map(({ where, id }) => `${label}: ${where}: ${id}`))];

// a WorkflowRun of a workflow file, built and never started
function build(t, file, inputs = {}, extra = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-models-56-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  return new WorkflowRun({ file, inputs: { task: 'Add the feature', repo_path: runsDir, ...inputs }, mock: true, runsDir, ...extra });
}
const developerTimeout = (run) => run.turnTimeout({ ...(run.wf.defaults || {}), ...run.wf.agents.developer });

// --- the models offered -----------------------------------------------------------------------------

test('#56 the Claude provider offers Opus 5.5, Sonnet 5.5, Fable 5.2 and Haiku 5.5', () => {
  const models = registry.byId('claude').models;
  assert.deepEqual([OPUS, SONNET, FABLE, HAIKU].filter((m) => !models.includes(m)), []);
});

test('#56 the Claude provider no longer offers the earlier versions', () => {
  const models = registry.byId('claude').models;
  assert.deepEqual(OLD_MODELS.filter((m) => models.includes(m)), []);
});

// --- no leftover ------------------------------------------------------------------------------------

test('#56 the bundled workflows name only models their providers offer', () => {
  assert.deepEqual(filesOf(BUNDLED).flatMap((file) => leftovers(rel(file), loadWorkflow(file))), []);
});

test('#56 the heroes of this repository name only models their providers offer', () => {
  assert.deepEqual(filesOf(HEROES).flatMap((file) => leftovers(rel(file), loadWorkflow(file))), []);
});

test('#56 the built-in agents run on models the providers offer', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-models-56-agents-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const agents = require('../../domains/agents/agents');
  const models = agents.listAgents(dir).filter((a) => a.system && a.model).map((a) => a.model);
  assert.ok(models.length > 0, 'at least one built-in agent with a model');
  assert.deepEqual(notOffered(models), []);
});

test('#56 the Product Owner registers an issue on Sonnet 5.5', () => {
  const { ISSUE_AGENT } = require('../../domains/po/product-owner');
  assert.equal(ISSUE_AGENT.model, SONNET);
});

test('#56 the Product Owner\'s instructions name the model it registers an issue on', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-models-56-po-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { prompt } = require('../../domains/agents/agents').readAgent(dir, 'product-owner');
  assert.deepEqual([...new Set(idsIn(prompt))], [SONNET]);
});

test('#56 the supervisor of a run whose workflow names no model runs on Sonnet 5.5', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-models-56-sup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(require('../../domains/supervisor/supervisor').supervisorConfig(dir, dir).model, SONNET);
});

test('#56 the workflows composed for a project name only models their providers offer', () => {
  const { composeWorkflowSet } = require('../../domains/workflow/workflow-compose');
  const profile = { mode: 'remote', ci: 'pr+release', tests: 'unit+e2e', e2eCommand: 'npx playwright test', release: 'per-merge', testCommand: 'npm test', checkCommand: null, languages: ['javascript'] };
  const { workflows } = composeWorkflowSet({ profile, answers: {}, facts: { languages: ['javascript'], skills: [] } });
  assert.ok(workflows.length > 0, 'the set has workflows');
  assert.deepEqual(workflows.flatMap((w) => leftovers(w.name, yaml.load(w.yaml))), []);
});

// --- the developer's and the reviewer's models --------------------------------------------------------

for (const file of [FEATURE, LOCAL_HERO, REMOTE_HERO]) {
  const name = path.basename(file, '.yaml');

  test(`#56 ${name}: the developer's model is a choice between Opus 5.5, the default, and Fable 5.2`, () => {
    const input = loadWorkflow(file).inputs.developer_model;
    assert.deepEqual([input.default, [...input.enum]], [OPUS, [OPUS, FABLE]]);
    // an older model's label may stay beside them, to name a saved value
    assert.deepEqual([input.options?.[OPUS], input.options?.[FABLE]], ['Opus 5.5', 'Fable 5.2']);
  });

  test(`#56 ${name}: a developer on Fable 5.2 gets the longer turn timeout, one on Opus 5.5 the usual one`, (t) => {
    const fable = build(t, file, { developer_model: FABLE });
    assert.equal(fable.wf.agents.developer.model, FABLE);
    assert.deepEqual([developerTimeout(fable), developerTimeout(build(t, file))], [90 * 60e3, 30 * 60e3]);
  });
}

test('#56 the reviewer of the Feature workflow and of the local hero runs on Fable 5.2', () => {
  assert.deepEqual([FEATURE, LOCAL_HERO].map((f) => loadWorkflow(f).agents.reviewer.model), [FABLE, FABLE]);
});

test('#56 the reviewer of the remote hero stays on Opus 5.5', () => {
  assert.equal(loadWorkflow(REMOTE_HERO).agents.reviewer.model, OPUS);
});

// --- saved choices ------------------------------------------------------------------------------------

for (const file of [FEATURE, LOCAL_HERO, REMOTE_HERO]) {
  const name = path.basename(file, '.yaml');

  test(`#56 ${name}: a saved developer model of an earlier version still starts, on that model`, (t) => {
    assert.equal(build(t, file, { developer_model: OLD_FABLE }).wf.agents.developer.model, OLD_FABLE);
  });

  test(`#56 ${name}: a developer saved on Fable 5.1 keeps its longer turn timeout`, (t) => {
    assert.equal(developerTimeout(build(t, file, { developer_model: OLD_FABLE })), 90 * 60e3);
  });

  test(`#56 ${name}: a developer model that is no model is refused`, (t) => {
    assert.throws(() => build(t, file, { developer_model: 'no-such-model' }), /Input "developer_model" must be one of/);
  });
}

test('#56 an agent chosen on an earlier version for a run keeps it', (t) => {
  const chosen = { developer: { model: 'claude-haiku-4-5' }, reviewer: { model: 'claude-sonnet-5' } };
  const run = build(t, FEATURE, {}, { agentOverrides: chosen });
  assert.deepEqual([run.wf.agents.developer.model, run.wf.agents.reviewer.model], ['claude-haiku-4-5', 'claude-sonnet-5']);
});

test('#56 a workspace copy whose developer model default the owner set to an earlier version keeps it after the update and still starts on it', (t) => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-models-56-src-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-models-56-dest-'));
  t.after(() => { for (const d of [src, dest]) fs.rmSync(d, { recursive: true, force: true }); });
  const current = fs.readFileSync(FEATURE, 'utf8');
  // the version the owner's copy came from: the same workflow on the earlier models
  const previous = current.replace(`enum: [${OPUS}, ${FABLE}]`, `enum: [${OPUS}, ${OLD_FABLE}]`).replace(`model: ${FABLE}`, `model: ${OLD_FABLE}`);
  const copy = path.join(dest, 'feature.yaml');
  fs.writeFileSync(path.join(src, 'feature.yaml'), previous);
  wfs.seedWorkflows(src, dest);
  // the owner's only change: the input's default, as the Definitions screen writes it
  const edited = previous.replace(/(\n {2}developer_model:\n(?: {4}.*\n)*? {4}default: )claude-opus-5-5/, `$1${OLD_FABLE}`);
  assert.notEqual(edited, previous, 'the developer_model default was found');
  fs.writeFileSync(copy, edited);
  // the new version of the app
  fs.writeFileSync(path.join(src, 'feature.yaml'), current);
  wfs.seedWorkflows(src, dest);
  const updated = fs.readFileSync(copy, 'utf8');
  assert.match(updated, new RegExp(`default: ${OLD_FABLE}\\b`));
  assert.equal(build(t, copy).wf.agents.developer.model, OLD_FABLE);
});
