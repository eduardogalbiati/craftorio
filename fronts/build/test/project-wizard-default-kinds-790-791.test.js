// #790, #791: the new-project wizard (fronts/build/views/projects/project-wizard.js) shows the manifest's
// default as chosen, lets the owner change it, and its Feature and Fix picks decide the project's kinds.
// Acceptance tests, written before the code, on the real page, driven as
// project-wizard-finish-workflows-729.test.js drives it (import, clone, analysis, review, Finish).
//
// The contract assumed here (the wizard's control had no id in the brief: this one follows step 3's rows):
// - with a manifest default, step 3 has one more row: wizard-workflow-select data-workflow-kind="default",
//   offering the manifest's workflows, on the manifest's default until the owner changes it;
// - the fakes give the manifest every way the wizard may read it: api.projectManifest (the folder's or the
//   URL's) and the record the clone saved (defaultWorkflow, workflows, workflowKinds);
// - Finish's patch is applied on that record and read by the engine's own projects.workflowForKind, so these
//   tests do not care whether the wizard writes workflowKinds or leaves its picks in `workflows`.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const load = () => require('@craftorio/engine/domains/project/projects');

const { PID, clone, jobs, CLI_OK } = W;
const PROFILE = { mode: 'remote', ci: 'release', tests: 'unit+e2e' };
const PROFILED = {
  projectId: PID, status: 'analyzing', profile: PROFILE, cli: CLI_OK,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'running' } }),
};
const ANALYZED = {
  projectId: PID, status: 'analyzed', profile: PROFILE, cli: CLI_OK,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'done' }, ranking: { status: 'done' } }),
};
const PLAIN = { id: PID, name: W.NAME, repo: W.REPO, exists: true };
const KINDS = { feature: { name: 'hero', inputs: {} }, fix: { name: 'fix', inputs: { mode: 'remote' } } };
const SET = [{ name: 'hero', category: 'solo' }, { name: 'feature', category: 'solo' }, { name: 'fix', category: 'fix' }];
const MANIFEST = { workflows: SET, default: 'hero', kinds: KINDS };
const IMPORTED = { ...PLAIN, defaultWorkflow: 'hero', workflows: SET.map((w) => ({ ...w, origin: 'manifest' })), workflowKinds: KINDS };

async function atWorkflows({ record = PLAIN, manifest = null } = {}) {
  const app = await W.atAnalysis({
    api: {
      listProjects: async () => [clone(record)],
      projectManifest: async () => clone(manifest),
      onboardingStatus: async () => clone(ANALYZED),
      analyzeOnboarding: async (id) => ({ ...clone(PROFILED), projectId: id }),
      updateProject: async (id, patch) => ({ ...clone(record), ...clone(patch) }),
      addRefactorToRoadmap: async () => ({}),
      createDiscoveryCard: async () => ({}),
    },
  });
  await W.press(app, 'wizard-workflows-choice-analyze');
  await W.emit(app, PROFILED);
  return app;
}

const selectOf = (app, kind) => H.findEl(W.wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow-select' && e.attrs['data-workflow-kind'] === kind);

// Picks `value` in step 3's select of `kind`: the wizard's delegated change, as #729's helper does
async function pick(app, kind, value) {
  const sel = selectOf(app, kind);
  assert.ok(sel, `step 3 has the ${kind} select`);
  const el = app.el(sel.attrs.id ? `#${sel.attrs.id}` : `[data-test-790-select-${kind}]`);
  el.tagName = 'SELECT';
  el.dataset.testid = 'wizard-workflow-select';
  el.dataset.workflowKind = kind;
  el.value = value;
  const root = app.el('#project-wizard');
  for (const type of ['change', 'input']) {
    for (const node of [el, root]) {
      const ev = { type, target: el, currentTarget: node, preventDefault() {}, stopPropagation() {} };
      if (node === el) await el[`on${type}`]?.(ev);
      for (const fn of node.listeners[type] || []) await fn(ev);
    }
  }
  await app.settle(5);
}

async function finish(app) {
  await W.emit(app, ANALYZED);
  await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'review', 'the review');
  await app.settle(10);
  await Promise.race([W.press(app, 'wizard-finish'), app.settle(60)]);
  await app.settle(30);
}

function savedPatch(app) {
  const calls = app.callsTo('updateProject');
  assert.equal(calls.length, 1, `one api.updateProject call at Finish (${calls.length})`);
  return clone(calls[0][1]);
}
const bare = (v) => String(v ?? '').replace(/\.ya?ml$/i, '');

test('#790 step 3 shows the manifest\'s default as chosen', { timeout: 30000 }, async () => {
  const app = await atWorkflows({ record: IMPORTED, manifest: MANIFEST });
  const sel = selectOf(app, 'default');
  assert.match(String(sel?.outer ?? ''), /<option value="hero(\.yaml)?"[^>]*\bselected\b/);
});

test('#790 step 3 offers the manifest\'s workflows as the default', { timeout: 30000 }, async () => {
  const app = await atWorkflows({ record: IMPORTED, manifest: MANIFEST });
  const values = [...String(selectOf(app, 'default')?.outer ?? '').matchAll(/<option value="([^"]+)"/g)].map((m) => bare(m[1]));
  assert.deepEqual(values.sort(), ['feature', 'fix', 'hero']);
});

test('#790 Finish keeps the manifest\'s default, with no step by the owner', { timeout: 30000 }, async () => {
  const app = await atWorkflows({ record: IMPORTED, manifest: MANIFEST });
  await finish(app);
  assert.equal(bare(savedPatch(app).defaultWorkflow), 'hero');
});

test('#790 the owner can change the default in the wizard', { timeout: 30000 }, async () => {
  const app = await atWorkflows({ record: IMPORTED, manifest: MANIFEST });
  await pick(app, 'default', 'feature');
  await finish(app);
  assert.equal(bare(savedPatch(app).defaultWorkflow), 'feature');
});

test('#791 Finish leaves the manifest\'s map in place over the wizard\'s fix pick', { timeout: 30000 }, async () => {
  const app = await atWorkflows({ record: IMPORTED, manifest: MANIFEST });
  await pick(app, 'fix', 'local-code');
  await finish(app);
  const out = load().workflowForKind({ ...clone(IMPORTED), ...savedPatch(app) }, 'fix');
  assert.deepEqual([out.name, out.inputs.mode], ['fix', 'remote']);
});

test('#791 without a manifest, the wizard\'s feature pick and its variant are the project\'s Feature', { timeout: 30000 }, async () => {
  const app = await atWorkflows();
  await pick(app, 'feature', 'remote-code');
  await finish(app);
  const out = load().workflowForKind({ ...clone(PLAIN), ...savedPatch(app) }, 'feature');
  assert.deepEqual([out.name, out.inputs.mode], ['feature', 'remote']);
});

test('#791 without a manifest, the wizard\'s fix pick and its variant are the project\'s Fix', { timeout: 30000 }, async () => {
  const app = await atWorkflows();
  await pick(app, 'fix', 'local-e2e');
  await finish(app);
  const out = load().workflowForKind({ ...clone(PLAIN), ...savedPatch(app) }, 'fix');
  assert.deepEqual([out.name, out.inputs.mode], ['fix', 'local']);
});
