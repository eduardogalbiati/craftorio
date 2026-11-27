// #633 (spec R9, D15, D16; mock-5): the new-project wizard's step 3 "Analysis & workflows"
// (fronts/build/views/projects/project-wizard.js) lets the owner pick how work on the project is
// documented: the work model. Acceptance tests, written before the code, on the real page
// (packages/ui-kit/test/renderer-app-harness.js), driven as project-wizard-helpers.js,
// project-wizard-finish-workflows-729.test.js and projects-resume-741.test.js drive the wizard.
//
// Updated for the visual-layout rework (the owner's decisions, 2026-11-26): the section shows with the workflow
// rows only (an import: after Define manually or the analysis), its texts were reworded, and Standard and Full are
// not ready yet: disabled, each marked "Coming soon" (data-testid="wizard-work-model-soon").
//
// The interface assumed here (the developer implements these names):
// - step 3, once the workflow rows show, has a section data-testid="wizard-work-model": a heading "How the work is
//   documented", the subtitle "How much each step writes down for the next one to read and a person to approve.",
//   and three radios (input type="radio" or role="radio") data-testid="wizard-work-model-light",
//   "wizard-work-model-standard", "wizard-work-model-full", in that order, labelled Light, Standard, Full
//   with their descriptions; Light is checked by default (#851) (`checked` or aria-checked="true"); Standard and
//   Full are disabled with wizard-work-model-soon; no section while the two choices show;
// - data-testid="wizard-work-model-files", "Where the files live" (docs/work/<item>/, the chips), showed for
//   Standard and Full only (#851): with both disabled it never shows;
// - a click (or a change event) on Light picks it; one on Standard or Full changes nothing; Finish's
//   api.updateProject patch carries workModel: 'light';
// - the pick is one of the wizard's saved picks (api.saveOnboardingWizard({ projectId, step, picks }),
//   picks.workModel); a resumed wizard whose saved pick is Standard or Full shows Light checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const W = require('./project-wizard-helpers');

const NAME = 'Shop';
const PROJECT = { id: W.PID, name: NAME, repo: W.REPO, folder: 'C:/ws/repos/shop', exists: true, isGit: true };
const UNFINISHED = { ...PROJECT, onboarding: { finished: false, step: 'analysis' } };
const PICKS = { source: 'import', repository: W.REPO, name: NAME, workflowsMode: 'manual' };
const atStep = (projectId, step, picks) => ({ ...W.clone(W.READY), projectId, wizard: { step, picks: W.clone(picks), finished: false } });

const MODELS = [
  { id: 'light', label: 'Light', text: 'An issue, then feature or fix. Nothing else is written.' },
  // #851: Standard and Full now name the Anthropic playbook; only their stable start is checked here
  { id: 'standard', label: 'Standard', text: 'intent.md → spec.md → plan.md' },
  { id: 'full', label: 'Full', text: 'REVIEW.md' },
];

// the page with a fake engine that saves what the wizard sends
function page({ projects = [W.clone(PROJECT)], status = null } = {}) {
  return loadApp({
    api: {
      getSettings: async () => ({ setupDone: true }),
      listProjects: async () => W.clone(projects),
      listProjectRuns: async (id) => ({ runs: [], project: projects.find((p) => p.id === id) || null, local: null }),
      onboardingAccounts: async () => [],
      onboardingRepos: async () => [],
      architectureEstimate: async () => null,
      startOnboarding: async () => W.clone(W.CLONING),
      onboardingStatus: async (id) => W.clone(status || { ...W.CLONING, projectId: id }),
      analyzeOnboarding: async (id) => ({ ...W.clone(W.ANALYZING), projectId: id }),
      retryOnboarding: async (id) => ({ ...W.clone(W.CLONING), projectId: id }),
      saveOnboardingWizard: async (data) => atStep(data?.projectId, data?.step, data?.picks),
      finishOnboarding: async (id) => ({ ...W.clone(W.READY), projectId: id }),
      updateProject: async (id, patch) => ({ ...W.clone(PROJECT), ...JSON.parse(JSON.stringify(patch)) }),
      addRefactorToRoadmap: async () => ({}),
      createDiscoveryCard: async () => ({}),
    },
  });
}

// the import of Shop started and its clone ready: the wizard on step 3; define: its workflows defined by hand
// (Define manually: nothing runs), so the rows and the work model section show; false leaves the two choices
async function atAnalysis({ define = true, ...opts } = {}) {
  const app = page(opts);
  await app.boot();
  W.wizard(app).open();
  await app.settle(10);
  await W.toRepository(app);
  await W.typeInto(app, '#wizard-repo', W.REPO);
  await W.typeInto(app, '#wizard-name', NAME);
  await W.press(app, 'wizard-next');
  await W.emit(app, W.CLONING);
  await W.emit(app, W.READY);
  if (W.currentStep(app) !== 'analysis') await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'analysis', 'the wizard is on the analysis step');
  if (define) await W.defineWorkflows(app, 'manual');
  return app;
}

const section = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-work-model');
const sectionText = (app) => { const s = section(app); return s ? H.visibleText(s.inner) : ''; };
const isRadio = (e) => (e.name === 'input' && String(e.attrs.type).toLowerCase() === 'radio') || e.attrs.role === 'radio';
const isChecked = (e) => 'checked' in e.attrs || e.attrs['aria-checked'] === 'true';
const radio = (app, id) => W.byTestId(W.wizardMarkup(app), `wizard-work-model-${id}`);
const checkedModels = (app) => MODELS.map((m) => m.id).filter((id) => { const r = radio(app, id); return !!r && isChecked(r); });
const disabledModels = (app) => MODELS.map((m) => m.id).filter((id) => 'disabled' in (radio(app, id)?.attrs || {}));
const filesPanel = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-work-model-files');

// the text that names a radio: its aria-label, else the smallest element around it with some text
function labelOf(html, el) {
  if (el.attrs['aria-label']) return el.attrs['aria-label'];
  const own = H.visibleText(el.inner);
  if (own) return own;
  const around = H.findAll(html, (e) => e.outer !== el.outer && e.outer.includes(el.outer) && H.visibleText(e.inner))
    .sort((a, b) => a.outer.length - b.outer.length);
  return around.length ? H.visibleText(around[0].inner) : '';
}

// the owner picks a work model: a click on its radio, then the change event a radio fires
async function pick(app, id) {
  const testid = `wizard-work-model-${id}`;
  const el = radio(app, id);
  assert.ok(el, `the wizard shows data-testid="${testid}"`);
  await W.clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
  const now = radio(app, id);
  if (!now) return;
  const target = app.el(now.attrs.id ? `#${now.attrs.id}` : `[data-test-633-${id}]`);
  target.tagName = now.name.toUpperCase();
  target.dataset.testid = testid;
  for (const [k, v] of Object.entries(now.attrs)) if (k.startsWith('data-')) target.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  target.type = now.attrs.type || 'radio';
  target.name = now.attrs.name || 'work-model';
  target.value = now.attrs.value || id;
  target.checked = true;
  const root = app.el('#project-wizard');
  for (const type of ['change', 'input']) {
    for (const node of [target, root]) {
      const ev = { type, target, currentTarget: node, preventDefault() {}, stopPropagation() {} };
      if (node === target) await target[`on${type}`]?.(ev);
      for (const fn of node.listeners[type] || []) await fn(ev);
    }
  }
  await app.settle(10);
}

// analyze later: on to the review, then Finish
async function finish(app) {
  await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'review', 'the review');
  await Promise.race([W.press(app, 'wizard-finish'), app.settle(60)]);
  await app.settle(30);
}

function savedWorkModel(app) {
  const calls = app.callsTo('updateProject');
  assert.equal(calls.length, 1, `one api.updateProject call at Finish (${calls.length})`);
  assert.equal(String(calls[0][0]), W.PID, 'on the new project');
  return JSON.parse(JSON.stringify(calls[0][1] || {})).workModel ?? null;
}

// ---- the section ------------------------------------------------------------------------------------

test('#633 step 3 has the work model section, headed "How the work is documented", with its subtitle', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  const s = section(app);
  assert.ok(s, 'step 3 shows data-testid="wizard-work-model"');
  const heading = H.findEl(s.inner, (e) => /^h[1-6]$/.test(e.name) || e.attrs.role === 'heading');
  assert.equal(heading ? H.visibleText(heading.inner) : null, 'How the work is documented');
  assert.equal(sectionText(app).includes('How much each step writes down for the next one to read and a person to approve.'), true, sectionText(app));
});

test('#633 the work model section comes with the workflow rows: not while the two choices show, then after Define manually and after the analysis', { timeout: 30000 }, async () => {
  const app = await atAnalysis({ define: false });
  assert.equal(section(app), null, 'no data-testid="wizard-work-model" while the two choices show');
  await W.press(app, 'wizard-workflows-choice-manual');
  assert.ok(section(app), 'the section under the rows defined by hand');
  const analysed = await atAnalysis({ define: false });
  await W.press(analysed, 'wizard-workflows-choice-analyze');
  assert.equal(section(analysed), null, 'no section while the analysis runs (the rows are not shown yet)');
  await W.emit(analysed, { ...W.ANALYZING, jobs: W.jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: { mode: 'remote', ci: 'release', tests: 'unit' } }, projectMap: { status: 'running' } }) });
  assert.ok(section(analysed), 'the section under the analysed rows');
});

test('#633 the work model section offers three radios, Light, Standard and Full, in that order', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  const s = section(app);
  assert.ok(s, 'step 3 shows data-testid="wizard-work-model"');
  const radios = H.findAll(s.inner, (e) => isRadio(e) && String(e.attrs['data-testid'] || '').startsWith('wizard-work-model-'));
  assert.deepEqual(radios.map((r) => r.attrs['data-testid']), MODELS.map((m) => `wizard-work-model-${m.id}`));
  assert.deepEqual(radios.map((r) => labelOf(s.inner, r).includes(MODELS.find((m) => r.attrs['data-testid'].endsWith(m.id)).label)), [true, true, true],
    `labels: ${JSON.stringify(radios.map((r) => labelOf(s.inner, r)))}`);
});

test('#633 each work model has the mockup\'s description, in the radios\' order', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  const text = sectionText(app);
  let at = 0;
  const missing = [];
  for (const m of MODELS) {
    for (const part of [m.label, m.text]) {
      const i = text.indexOf(part, at);
      if (i < 0) missing.push(part); else at = i + part.length;
    }
  }
  assert.deepEqual(missing, [], text);
});

test('#633 #851 Light is the work model checked by default', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  assert.deepEqual(checkedModels(app), ['light']);
});

// Standard and Full are not ready yet (the owner's call): shown, disabled, marked "Coming soon"
test('#633 Standard and Full are disabled, each marked "Coming soon" (wizard-work-model-soon); Light is not', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  assert.deepEqual(disabledModels(app), ['standard', 'full']);
  const s = section(app);
  const soon = H.findAll(s.inner, (e) => e.attrs['data-testid'] === 'wizard-work-model-soon');
  assert.deepEqual(soon.map((e) => H.visibleText(e.inner)), ['Coming soon', 'Coming soon']);
  assert.deepEqual(MODELS.map((m) => labelOf(s.inner, radio(app, m.id)).includes('Coming soon')), [false, true, true], 'on Standard\'s and Full\'s choices only');
});

test('#633 picking Standard changes nothing: Light stays the only one checked', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await pick(app, 'standard');
  assert.deepEqual(checkedModels(app), ['light']);
  assert.deepEqual(disabledModels(app), ['standard', 'full']);
});

// ---- where the files live ---------------------------------------------------------------------------

// the panel showed for Standard and Full only (#851: Light writes nothing to docs/work/): with both disabled it
// never shows, whatever is tried
test('#633 "Where the files live" (docs/work/<item>/ in the repository) never shows: not with Light, not after a pick of Standard', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  assert.equal(filesPanel(app), null, 'no data-testid="wizard-work-model-files" with Light');
  await pick(app, 'standard');
  assert.equal(filesPanel(app), null, 'nor after a pick of Standard (disabled)');
  const text = sectionText(app);
  assert.deepEqual(['Where the files live', 'In the repository', 'docs/work/<item>/'].filter((s) => text.includes(s)), [], text);
});

test('#633 the chips of "Where the files live" (fix: issue only, feature: Standard, release: notes) never show: not after a pick of Full', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await pick(app, 'full');
  assert.equal(filesPanel(app), null, 'no data-testid="wizard-work-model-files" after a pick of Full (disabled)');
  const text = sectionText(app);
  assert.deepEqual(['fix: issue only', 'feature: Standard', 'release: notes'].filter((s) => text.includes(s)), [], text);
});

// ---- Finish saves the pick ----------------------------------------------------------------------------

test('#633 #851 Finish with the work model untouched saves workModel light on the project', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await finish(app);
  assert.equal(savedWorkModel(app), 'light');
});

test('#633 Finish after a pick of Standard (disabled, "Coming soon") saves workModel light on the project', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await pick(app, 'standard');
  await finish(app);
  assert.equal(savedWorkModel(app), 'light');
});

test('#633 Finish after a pick of Full (disabled, "Coming soon") saves workModel light on the project', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await pick(app, 'full');
  await finish(app);
  assert.equal(savedWorkModel(app), 'light');
});

// ---- the pick is saved with the wizard and resumed ------------------------------------------------------

test('#633 picking Light is saved with the wizard (saveOnboardingWizard picks.workModel)', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await pick(app, 'light');
  const last = app.callsTo('saveOnboardingWizard').at(-1)?.[0] || null;
  assert.equal(last?.picks?.workModel ?? null, 'light', `the last save: ${JSON.stringify(last)}`);
});

// Full is not ready yet: a pick of it saved earlier falls back to Light, on the screen and at Finish
test('#633 a resumed wizard whose saved work model is Full shows Light checked, and Finish saves light', { timeout: 30000 }, async () => {
  const app = page({ projects: [W.clone(UNFINISHED)], status: atStep(W.PID, 'analysis', { ...PICKS, workModel: 'full' }) });
  await app.boot();
  W.wizard(app).open({ projectId: W.PID });
  await app.settle(10);
  assert.equal(W.currentStep(app), 'analysis', 'the wizard resumed on step 3');
  assert.deepEqual(checkedModels(app), ['light']);
  assert.deepEqual(disabledModels(app), ['standard', 'full']);
  await finish(app);
  assert.equal(savedWorkModel(app), 'light');
});

test('#633 a resumed wizard whose saved work model is Light shows Light checked', { timeout: 30000 }, async () => {
  const app = page({ projects: [W.clone(UNFINISHED)], status: atStep(W.PID, 'analysis', { ...PICKS, workModel: 'light' }) });
  await app.boot();
  W.wizard(app).open({ projectId: W.PID });
  await app.settle(10);
  assert.equal(W.currentStep(app), 'analysis', 'the wizard resumed on step 3');
  assert.deepEqual(checkedModels(app), ['light']);
});
