// #633 (spec R9, D15, D16; mock-5): the new-project wizard's step 3 "Analysis & workflows"
// (fronts/build/views/projects/project-wizard.js) lets the owner pick how work on the project is
// documented: the work model. Acceptance tests, written before the code, on the real page
// (packages/ui-kit/test/renderer-app-harness.js), driven as project-wizard-helpers.js,
// project-wizard-finish-workflows-729.test.js and projects-resume-741.test.js drive the wizard.
//
// The interface assumed here (the developer implements these names):
// - step 3 has a section data-testid="wizard-work-model": a heading "How work on <project name> is
//   documented", the subtitle "Each step leaves a file the next step reads, and a person approves it.",
//   and three radios (input type="radio" or role="radio") data-testid="wizard-work-model-light",
//   "wizard-work-model-standard", "wizard-work-model-full", in that order, labelled Light, Standard, Full
//   with mock-5's descriptions; Standard is checked by default (`checked` or aria-checked="true");
// - next to it, data-testid="wizard-work-model-files", "Where the files live": "In the repository", the
//   path "docs/work/<item>/" with intent.md, spec.md, plan.md (no .html: D16, no HTML is committed), and
//   the chips "fix: issue only", "feature: Standard", "release: notes";
// - a click (or a change event) on a radio picks it; Finish's api.updateProject patch carries
//   workModel: 'light' | 'standard' | 'full';
// - the pick is one of the wizard's saved picks (api.saveOnboardingWizard({ projectId, step, picks }),
//   picks.workModel), and a resumed wizard (the onboarding state's wizard.picks.workModel) shows it checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@multiagent/ui-kit/test/page-pieces');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const W = require('./project-wizard-helpers');

const NAME = 'Shop';
const PROJECT = { id: W.PID, name: NAME, repo: W.REPO, folder: 'C:/ws/repos/shop', exists: true, isGit: true };
const UNFINISHED = { ...PROJECT, onboarding: { finished: false, step: 'analysis' } };
const PICKS = { source: 'import', repository: W.REPO, name: NAME, workflowsMode: 'manual' };
const atStep = (projectId, step, picks) => ({ ...W.clone(W.READY), projectId, wizard: { step, picks: W.clone(picks), finished: false } });

const MODELS = [
  { id: 'light', label: 'Light', text: 'An issue, then feature or fix. Nothing else is written.' },
  { id: 'standard', label: 'Standard', text: 'intent.md → spec.md → plan.md → code. Recommended for features.' },
  { id: 'full', label: 'Full', text: 'Standard + REVIEW.md + evals of the project\'s skills and workflows.' },
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

// the import of Shop started and its clone ready: the wizard on step 3
async function atAnalysis(opts) {
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
  return app;
}

const section = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-work-model');
const sectionText = (app) => { const s = section(app); return s ? H.visibleText(s.inner) : ''; };
const isRadio = (e) => (e.name === 'input' && String(e.attrs.type).toLowerCase() === 'radio') || e.attrs.role === 'radio';
const isChecked = (e) => 'checked' in e.attrs || e.attrs['aria-checked'] === 'true';
const radio = (app, id) => W.byTestId(W.wizardMarkup(app), `wizard-work-model-${id}`);
const checkedModels = (app) => MODELS.map((m) => m.id).filter((id) => { const r = radio(app, id); return !!r && isChecked(r); });

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

test('#633 step 3 has the work model section, headed "How work on <project> is documented", with its subtitle', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  const s = section(app);
  assert.ok(s, 'step 3 shows data-testid="wizard-work-model"');
  const heading = H.findEl(s.inner, (e) => /^h[1-6]$/.test(e.name) || e.attrs.role === 'heading');
  assert.equal(heading ? H.visibleText(heading.inner) : null, `How work on ${NAME} is documented`);
  assert.equal(sectionText(app).includes('Each step leaves a file the next step reads, and a person approves it.'), true, sectionText(app));
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

test('#633 Standard is the work model checked by default', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  assert.deepEqual(checkedModels(app), ['standard']);
});

test('#633 picking Light checks Light only', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await pick(app, 'light');
  assert.deepEqual(checkedModels(app), ['light']);
});

// ---- where the files live ---------------------------------------------------------------------------

test('#633 "Where the files live" shows docs/work/<item>/ with intent.md, spec.md and plan.md in the repository', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  const panel = W.byTestId(W.wizardMarkup(app), 'wizard-work-model-files');
  assert.ok(panel, 'step 3 shows data-testid="wizard-work-model-files"');
  const text = H.visibleText(panel.inner);
  const missing = ['Where the files live', 'In the repository', 'docs/work/<item>/', 'intent.md', 'spec.md', 'plan.md'].filter((s) => !text.includes(s));
  assert.deepEqual(missing, [], text);
});

test('#633 "Where the files live" has the chips fix: issue only, feature: Standard, release: notes', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  const panel = W.byTestId(W.wizardMarkup(app), 'wizard-work-model-files');
  assert.ok(panel, 'step 3 shows data-testid="wizard-work-model-files"');
  const text = H.visibleText(panel.inner);
  assert.deepEqual(['fix: issue only', 'feature: Standard', 'release: notes'].filter((s) => !text.includes(s)), [], text);
});

// ---- Finish saves the pick ----------------------------------------------------------------------------

test('#633 Finish with the work model untouched saves workModel standard on the project', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await finish(app);
  assert.equal(savedWorkModel(app), 'standard');
});

test('#633 Finish after picking Light saves workModel light on the project', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await pick(app, 'light');
  await finish(app);
  assert.equal(savedWorkModel(app), 'light');
});

test('#633 Finish after picking Full saves workModel full on the project', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await pick(app, 'full');
  await finish(app);
  assert.equal(savedWorkModel(app), 'full');
});

// ---- the pick is saved with the wizard and resumed ------------------------------------------------------

test('#633 picking Light is saved with the wizard (saveOnboardingWizard picks.workModel)', { timeout: 30000 }, async () => {
  const app = await atAnalysis();
  await pick(app, 'light');
  const last = app.callsTo('saveOnboardingWizard').at(-1)?.[0] || null;
  assert.equal(last?.picks?.workModel ?? null, 'light', `the last save: ${JSON.stringify(last)}`);
});

test('#633 a resumed wizard whose saved work model is Full shows Full checked', { timeout: 30000 }, async () => {
  const app = page({ projects: [W.clone(UNFINISHED)], status: atStep(W.PID, 'analysis', { ...PICKS, workModel: 'full' }) });
  await app.boot();
  W.wizard(app).open({ projectId: W.PID });
  await app.settle(10);
  assert.equal(W.currentStep(app), 'analysis', 'the wizard resumed on step 3');
  assert.deepEqual(checkedModels(app), ['full']);
});
