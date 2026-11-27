// #729: the new-project wizard's Finish (fronts/build/views/projects/project-wizard.js) saves the
// workflows picked in step 3 on the project. Acceptance tests, written before the code, on the real
// page (packages/ui-kit/test/renderer-app-harness.js), driven as project-wizard-review-642.test.js and
// project-wizard-workflows-630.test.js drive the wizard (import, clone, analysis, review, Finish).
//
// The contract assumed here:
// - step 3's selects (data-testid="wizard-workflow-select" data-workflow-kind="feature|fix|release|ci")
//   keep the owner's pick (the profile's suggestion when untouched);
// - visual-layout rework: each row also offers its choices as tiles, data-testid="wizard-workflow-tile"
//   data-kind data-value, the picked one aria-pressed="true"; a click on a tile is the same pick as the select's;
// - Finish calls api.updateProject(projectId, { workflows, defaultWorkflow }) once, workflows being the
//   bundled feature, fix and release, one entry each { name: 'feature' | 'fix' | 'release', origin,
//   category?, variant: <the select's value> } (variant: e.g. 'remote-code', 'train'), the CI pick
//   (the ci select's value, e.g. 'pr+release') saved in the same patch (on the release entry or the
//   patch itself), and defaultWorkflow 'feature' (the feature workflow: DefaultWorkflow.firstBuild's
//   development workflow).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@craftorio/front-analyser/test/project-page-helpers');

const PID = 'p-new';
const REPO = 'https://github.com/o/new.git';
const NAME = 'New one';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/new', exists: true };
// the profile suggests feature / fix 'remote-e2e', release 'milestone', ci 'release'
const PROFILE = { mode: 'remote', ci: 'release', tests: 'unit+e2e' };
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const PROFILED = {
  projectId: PID, status: 'analyzing', profile: PROFILE, cli: CLI_OK,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'running' } }),
};
const ANALYZED = {
  projectId: PID, status: 'analyzed', profile: PROFILE, cli: CLI_OK,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'done' }, ranking: { status: 'done' } }),
};

const clone = (x) => JSON.parse(JSON.stringify(x));

function page(over = {}) {
  return loadApp({
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async () => clone(ANALYZED),
      analyzeOnboarding: async (id) => ({ ...clone(PROFILED), projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      architectureEstimate: async () => ({ estimate: null }),
      updateProject: async (id, patch) => ({ ...clone(PROJECT), ...JSON.parse(JSON.stringify(patch)) }),
      addRefactorToRoadmap: async () => ({}),
      createDiscoveryCard: async () => ({}),
      ...over,
    },
  });
}

function markupOf(app, id) {
  const parts = [];
  const seen = new Set([id]);
  const follow = (el, depth) => {
    const html = String(el?.innerHTML || '');
    parts.push(html || String(el?.textContent || ''));
    if (depth > 3) return;
    for (const m of html.matchAll(/\bid="([\w-]+)"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const inner = existing(app, m[1]);
      if (inner && (inner.innerHTML || inner.textContent)) follow(inner, depth + 1);
    }
  };
  follow(existing(app, id), 0);
  return parts.join('\n');
}
const wizardMarkup = (app) => markupOf(app, 'project-wizard');
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);

function currentStep(app) {
  const el = H.findEl(wizardMarkup(app), (e) => e.attrs['data-step'] && e.attrs['aria-current'] === 'step');
  return el ? el.attrs['data-step'] : null;
}

async function press(app, testid) {
  const el = byTestId(wizardMarkup(app), testid);
  assert.ok(el, `the wizard shows data-testid="${testid}"`);
  await clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

// Fires `types` on a fake element (its own handlers, then the wizard root's delegated ones)
async function fire(app, el, types) {
  const root = app.el('#project-wizard');
  for (const type of types) {
    for (const node of [el, root]) {
      const ev = { type, target: el, currentTarget: node, preventDefault() {}, stopPropagation() {} };
      if (node === el) await el[`on${type}`]?.(ev);
      for (const fn of node.listeners[type] || []) await fn(ev);
    }
  }
  await app.settle(5);
}

async function typeInto(app, sel, value) {
  const el = app.el(sel);
  el.value = value;
  el.tagName = 'INPUT';
  el.dataset.testid = sel.slice(1);
  await fire(app, el, ['input', 'change', 'blur']);
}

// Picks `value` in step 3's select of `kind`
async function pickVariant(app, kind, value) {
  const sel = H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow-select' && e.attrs['data-workflow-kind'] === kind);
  assert.ok(sel, `step 3 has the ${kind} select`);
  const el = app.el(sel.attrs.id ? `#${sel.attrs.id}` : `[data-test-729-select-${kind}]`);
  el.tagName = 'SELECT';
  el.dataset.testid = 'wizard-workflow-select';
  el.dataset.workflowKind = kind;
  el.value = value;
  await fire(app, el, ['change', 'input']);
}

async function emit(app, state) {
  for (const fn of app.apiHandlers.onOnboardingChanged || []) fn(clone(state));
  await app.settle(10);
}

// The wizard at step 3 with the profile known
async function atWorkflows(api) {
  const app = page(api);
  await app.boot();
  assert.equal(typeof app.sandbox.ProjectWizard?.open, 'function', 'window.ProjectWizard.open()');
  app.sandbox.ProjectWizard.open();
  await app.settle(10);
  await press(app, 'wizard-source-import');
  await press(app, 'wizard-next');
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  await press(app, 'wizard-next');
  await emit(app, CLONING);
  await emit(app, READY);
  assert.equal(currentStep(app), 'analysis', 'the wizard went on to step 3 once the clone was ready');
  // #725: the rows show once a way in is chosen: Analyze the repository, then the profile job's answer
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILED);
  return app;
}

// On to the review, then Finish
async function finish(app) {
  await emit(app, ANALYZED);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review', 'the review');
  await app.settle(10);
  await Promise.race([press(app, 'wizard-finish'), app.settle(60)]);
  await app.settle(30);
}

function savedPatch(app) {
  const calls = app.callsTo('updateProject');
  assert.equal(calls.length, 1, `one api.updateProject call at Finish (${calls.length})`);
  assert.equal(String(calls[0][0]), PID, 'on the new project');
  return JSON.parse(JSON.stringify(calls[0][1]));
}
const entry = (patch, name) => (patch.workflows || []).find((w) => w?.name === name) || null;

test('#729 Finish saves the workflows picked in step 3 with their variants, the CI choice, and feature as the default', { timeout: 30000 }, async () => {
  const app = await atWorkflows();
  await pickVariant(app, 'feature', 'remote-code');
  await pickVariant(app, 'fix', 'local-e2e');
  await pickVariant(app, 'release', 'train');
  await pickVariant(app, 'ci', 'pr+release');
  await finish(app);
  const patch = savedPatch(app);
  assert.deepEqual((patch.workflows || []).map((w) => w?.name), ['feature', 'fix', 'release'], 'feature, fix and release');
  assert.equal(entry(patch, 'feature')?.variant, 'remote-code', 'feature\'s variant');
  assert.equal(entry(patch, 'fix')?.variant, 'local-e2e', 'fix\'s variant');
  assert.equal(entry(patch, 'release')?.variant, 'train', 'release\'s variant');
  assert.equal(JSON.stringify(patch).includes('"pr+release"'), true, `the CI choice is saved: ${JSON.stringify(patch)}`);
  assert.equal(patch.defaultWorkflow, 'feature', 'the feature workflow is the default');
});

// ---- the tiles (visual-layout rework): the same pick as the select's ---------------------------------------

const KINDS = ['feature', 'fix', 'release', 'ci'];
const isTile = (e, kind) => e.attrs['data-testid'] === 'wizard-workflow-tile' && e.attrs['data-kind'] === kind;
const tilesOf = (app, kind) => H.findAll(wizardMarkup(app), (e) => isTile(e, kind));
const pressedOf = (app, kind) => tilesOf(app, kind).filter((e) => e.attrs['aria-pressed'] === 'true').map((e) => e.attrs['data-value']);
const selectOf = (app, kind) => H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow-select' && e.attrs['data-workflow-kind'] === kind);
const optionsOf = (app, kind) => H.findAll(selectOf(app, kind)?.inner || '', (e) => e.name === 'option');
const selectedOf = (app, kind) => optionsOf(app, kind).find((o) => 'selected' in o.attrs)?.attrs.value ?? null;
async function pressTile(app, kind, value) {
  const tile = tilesOf(app, kind).find((e) => e.attrs['data-value'] === value);
  assert.ok(tile, `step 3 has the ${kind} tile ${value}`);
  await clickRendered(app, tile, ['#project-wizard']);
  await app.settle(10);
}

test('#729 each row offers its select\'s choices as tiles, the profile\'s suggestion pressed', { timeout: 30000 }, async () => {
  const app = await atWorkflows();
  for (const kind of KINDS) {
    assert.deepEqual(tilesOf(app, kind).map((e) => e.attrs['data-value']), optionsOf(app, kind).map((o) => o.attrs.value), `the ${kind} tiles are the select's options`);
    assert.equal(tilesOf(app, kind).length >= 2, true, `${kind}: at least two tiles`);
    assert.deepEqual(pressedOf(app, kind), [selectedOf(app, kind)], `${kind}: one tile pressed, the select's value`);
    assert.equal(tilesOf(app, kind).every((e) => e.name === 'button' && !('disabled' in e.attrs)), true, `${kind}: enabled buttons`);
  }
  assert.deepEqual(KINDS.map((kind) => pressedOf(app, kind)[0]), ['remote-e2e', 'remote-e2e', 'milestone', 'release']);
});

test('#729 a click on a wizard-workflow-tile picks the variant: aria-pressed, the select\'s value, and what Finish saves', { timeout: 30000 }, async () => {
  const app = await atWorkflows();
  await pressTile(app, 'feature', 'remote-code');
  assert.deepEqual(pressedOf(app, 'feature'), ['remote-code'], 'the clicked tile is the only one pressed');
  assert.equal(selectedOf(app, 'feature'), 'remote-code', 'the feature select follows');
  assert.deepEqual(pressedOf(app, 'fix'), ['remote-e2e'], 'the other rows keep their pick');
  await pressTile(app, 'fix', 'local-e2e');
  await pressTile(app, 'release', 'train');
  await pressTile(app, 'ci', 'pr+release');
  assert.deepEqual(KINDS.map((kind) => pressedOf(app, kind)), [['remote-code'], ['local-e2e'], ['train'], ['pr+release']]);
  assert.deepEqual(KINDS.map((kind) => selectedOf(app, kind)), ['remote-code', 'local-e2e', 'train', 'pr+release']);
  await finish(app);
  const patch = savedPatch(app);
  assert.deepEqual((patch.workflows || []).map((w) => w?.name), ['feature', 'fix', 'release'], 'feature, fix and release');
  assert.equal(entry(patch, 'feature')?.variant, 'remote-code', 'feature\'s variant');
  assert.equal(entry(patch, 'fix')?.variant, 'local-e2e', 'fix\'s variant');
  assert.equal(entry(patch, 'release')?.variant, 'train', 'release\'s variant');
  assert.equal(entry(patch, 'release')?.ci, 'pr+release', `the CI choice is saved: ${JSON.stringify(patch)}`);
  assert.equal(patch.defaultWorkflow, 'feature', 'the feature workflow is the default');
});

test('#729 a tile click after a select pick (and the reverse): the last one wins, on the tiles, the select and at Finish', { timeout: 30000 }, async () => {
  const app = await atWorkflows();
  await pickVariant(app, 'feature', 'local-code');
  await pressTile(app, 'feature', 'local-e2e');
  await pressTile(app, 'release', 'train');
  await pickVariant(app, 'release', 'per-merge');
  await pressTile(app, 'fix', 'remote-code'); // a render: the select's pick of release shows on its tiles
  assert.deepEqual(pressedOf(app, 'feature'), ['local-e2e']);
  assert.deepEqual(pressedOf(app, 'release'), ['per-merge']);
  assert.equal(selectedOf(app, 'release'), 'per-merge');
  await finish(app);
  const patch = savedPatch(app);
  assert.equal(entry(patch, 'feature')?.variant, 'local-e2e');
  assert.equal(entry(patch, 'fix')?.variant, 'remote-code');
  assert.equal(entry(patch, 'release')?.variant, 'per-merge');
});

test('#729 Finish with step 3 untouched saves the profile\'s suggestions', { timeout: 30000 }, async () => {
  const app = await atWorkflows();
  await finish(app);
  const patch = savedPatch(app);
  assert.deepEqual((patch.workflows || []).map((w) => w?.name), ['feature', 'fix', 'release']);
  assert.equal(entry(patch, 'feature')?.variant, 'remote-e2e');
  assert.equal(entry(patch, 'fix')?.variant, 'remote-e2e');
  assert.equal(entry(patch, 'release')?.variant, 'milestone');
  assert.equal(patch.defaultWorkflow, 'feature');
});

test('#729 Finish still closes the wizard on the project page when saving the workflows fails', { timeout: 30000 }, async () => {
  const app = await atWorkflows({ updateProject: async () => { throw new Error('disk full'); } });
  await finish(app);
  assert.equal(app.callsTo('updateProject').length, 1, 'the save was tried');
  assert.equal(String(app.state().view), 'project', 'the project page is open');
  assert.equal(String(app.state().pv?.id), PID, 'on the new project');
});

// ---- after the review of #729 ----------------------------------------------------------------------

// The service as the app sees it: projects:update writes the record that projects:list then answers
function persisted(over = {}) {
  let record = clone(PROJECT);
  return {
    listProjects: async () => [clone(record)],
    listProjectRuns: async () => ({ runs: [], project: clone(record), local: null }),
    updateProject: async (id, patch) => { record = { ...record, ...JSON.parse(JSON.stringify(patch)) }; return clone(record); },
    ...over,
  };
}
const cardsOn = (app) => H.findAll(String(app.el('#project-workflows').innerHTML || ''), (e) => e.attrs['data-testid'] === 'pj-wf-card')
  .map((c) => ({ id: String(c.attrs['data-workflow-id'] ?? ''), text: H.visibleText(c.inner) }));

test('#729 after Finish, the app\'s project list (the Backlog\'s pickers) has the saved workflows and default, with no onboarding event', { timeout: 30000 }, async () => {
  const app = await atWorkflows(persisted());
  await pickVariant(app, 'feature', 'remote-code');
  await finish(app);
  const record = (app.state().projects || []).find((p) => p.id === PID);
  assert.ok(record, 'the new project is in state.projects');
  assert.deepEqual(Array.from(record.workflows || [], (w) => String(w?.name)), ['feature', 'fix', 'release'], 'its workflows');
  assert.equal(String(record.defaultWorkflow), 'feature', 'its default');
});

test('#729 after Finish, the project page shows the three cards with the variants and the CI pick', { timeout: 30000 }, async () => {
  const app = await atWorkflows(persisted());
  await pickVariant(app, 'feature', 'remote-code');
  await pickVariant(app, 'release', 'train');
  await pickVariant(app, 'ci', 'pr+release');
  await finish(app);
  await app.settle(30);
  const cards = cardsOn(app);
  assert.deepEqual(cards.map((c) => c.id), ['feature', 'fix', 'release'], 'one card per workflow picked');
  const feature = cards.find((c) => c.id === 'feature').text;
  assert.equal(feature.includes('Remote PR · code first'), true, `feature's variant: ${feature}`); // onboarding.choice_feature_remote_code, reworded (singular)
  const release = cards.find((c) => c.id === 'release').text;
  assert.equal(release.includes('CI: On pull requests and releases'), true, `release's CI pick: ${release}`);
});

test('#729 Finish saves each workflow\'s category as its installed YAML declares it', { timeout: 30000 }, async () => {
  const INSTALLED = [
    { file: 'feature.yaml', name: 'feature', category: 'build', origin: 'bundled', inputs: { task: {} } },
    { file: 'fix.yaml', name: 'fix', category: 'plan', origin: 'bundled', inputs: { task: {} } },
    { file: 'release.yaml', name: 'Release', category: 'monitor', origin: 'bundled', inputs: {} },
  ];
  const app = await atWorkflows(persisted({ listWorkflows: async () => clone(INSTALLED) }));
  await finish(app);
  const patch = savedPatch(app);
  assert.equal(entry(patch, 'feature')?.category, 'build');
  assert.equal(entry(patch, 'fix')?.category, 'plan', 'fix\'s category from fix.yaml');
  assert.equal(entry(patch, 'release')?.category, 'monitor', 'release\'s category from release.yaml');
});
