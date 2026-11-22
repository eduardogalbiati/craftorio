// #851 acceptance, written before the code: step 3's defaults. Light is the default work model, "Where the files
// live" shows only for Standard and Full, and a "Recommended" label marks Light and "Analyze the repository". On the
// real page (packages/ui-kit/test/renderer-app-harness.js), driven as project-wizard-work-model-633.test.js and
// project-wizard-create-632.test.js.
//
// The contract assumed here:
// - OnboardingModel.DEFAULT_WORK_MODEL === 'light'; a fresh import and a fresh new project open step 3 with
//   wizard-work-model-light checked; a resumed wizard keeps its saved pick (standard); Finish with step 3 untouched
//   sends workModel 'light' in api.updateProject's patch;
// - wizard-work-model-files ("Where the files live") is not rendered with Light picked, rendered with Standard / Full;
// - the NEW key onboarding.recommended (en "Recommended", pt-BR "Recomendado") shows exactly once inside Light's
//   choice (its <label>, the smallest element around the radio with text) and inside the
//   wizard-workflows-choice-analyze button, never inside Standard, Full nor wizard-workflows-choice-manual (a new
//   project has no workflows choice: its column opens analyzed);
// - the catalogs: onboarding.work_model_standard_text loses "Recommended for features" / "Recomendado para
//   features" and names the Anthropic playbook, simplified; onboarding.work_model_full_text names the complete
//   playbook with REVIEW.md and evals.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const W = require('./project-wizard-helpers');

const ROOT = path.join(__dirname, '..', '..', '..');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
const MODEL = path.join(ROOT, 'packages', 'shared', 'onboarding-model.js');

const NAME = 'Shop';
const PROJECT = { id: W.PID, name: NAME, repo: W.REPO, folder: 'C:/ws/repos/shop', exists: true, isGit: true };
const UNFINISHED = { ...PROJECT, onboarding: { finished: false, step: 'analysis' } };
const PICKS = { source: 'import', repository: W.REPO, name: NAME, workflowsMode: 'manual' };
const atStep = (projectId, step, picks) => ({ ...W.clone(W.READY), projectId, wizard: { step, picks: W.clone(picks), finished: false } });
const GH_IN = { provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'eduardo' };
const CREATED = {
  projectId: 'field-notes', name: 'Field Notes', status: 'ready', cli: null,
  jobs: { clone: { status: 'skipped' }, facts: { status: 'waiting' }, projectMap: { status: 'waiting' }, profile: { status: 'done', profile: { mode: 'local', ci: 'release', release: 'milestone' } } },
};

function page({ projects = [W.clone(PROJECT)], status = null } = {}) {
  return loadApp({
    api: {
      getSettings: async () => ({ setupDone: true }),
      listProjects: async () => W.clone(projects),
      listProjectRuns: async (id) => ({ runs: [], project: projects.find((p) => p.id === id) || null, local: null }),
      onboardingAccounts: async () => [W.clone(GH_IN)],
      onboardingRepos: async () => [],
      architectureEstimate: async () => null,
      startOnboarding: async () => W.clone(W.CLONING),
      createOnboarding: async () => W.clone(CREATED),
      onboardingStatus: async (id) => W.clone(status || (id === CREATED.projectId ? CREATED : { ...W.CLONING, projectId: id })),
      analyzeOnboarding: async (id) => ({ ...W.clone(W.ANALYZING), projectId: id }),
      retryOnboarding: async (id) => ({ ...W.clone(W.CLONING), projectId: id }),
      saveOnboardingWizard: async (data) => atStep(data?.projectId, data?.step, data?.picks),
      finishOnboarding: async (id) => ({ ...W.clone(W.READY), projectId: id }),
      updateProject: async (id, patch) => ({ ...W.clone(PROJECT), ...JSON.parse(JSON.stringify(patch)) }),
      addRefactorToRoadmap: async () => ({}),
      createDiscoveryCard: async () => ({}),
      getBacklog: async () => ({ issues: [] }),
    },
  });
}

async function importAtAnalysis({ lang = 'en' } = {}) {
  const app = page();
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  W.wizard(app).open();
  await app.settle(10);
  await W.toRepository(app);
  await W.typeInto(app, '#wizard-repo', W.REPO);
  await W.typeInto(app, '#wizard-name', NAME);
  await W.press(app, 'wizard-next');
  await W.emit(app, W.CLONING);
  await W.emit(app, W.READY);
  if (W.currentStep(app) !== 'analysis') await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'analysis', 'the import is on step 3');
  return app;
}

async function newAtAnalysis({ lang = 'en' } = {}) {
  const app = page({ projects: [] });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  W.wizard(app).open();
  await app.settle(20);
  await W.press(app, 'wizard-source-new');
  await W.press(app, 'wizard-next');
  await W.typeInto(app, '#wizard-new-name', 'Field Notes');
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'analysis', 'the new project is on step 3');
  return app;
}

const MODELS = ['light', 'standard', 'full'];
const isChecked = (e) => 'checked' in e.attrs || e.attrs['aria-checked'] === 'true';
const radio = (app, id) => W.byTestId(W.wizardMarkup(app), `wizard-work-model-${id}`);
const checkedModels = (app) => MODELS.filter((id) => { const r = radio(app, id); return !!r && isChecked(r); });
const filesPanel = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-work-model-files');

// the text of a radio's choice: the smallest element around it with some text (its <label>)
function choiceText(app, id) {
  const html = W.wizardMarkup(app);
  const el = radio(app, id);
  assert.ok(el, `data-testid="wizard-work-model-${id}"`);
  const around = H.findAll(html, (e) => e.outer !== el.outer && e.outer.includes(el.outer) && H.visibleText(e.inner))
    .sort((a, b) => a.outer.length - b.outer.length);
  return around.length ? H.visibleText(around[0].inner) : '';
}
const count = (text, word) => String(text).split(word).length - 1;

// the owner picks a work model: a click on its radio, then the change event a radio fires (as #633)
async function pick(app, id) {
  const testid = `wizard-work-model-${id}`;
  const el = radio(app, id);
  assert.ok(el, `the wizard shows data-testid="${testid}"`);
  await W.clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
  const now = radio(app, id);
  if (!now) return;
  const target = app.el(now.attrs.id ? `#${now.attrs.id}` : `[data-test-851-${id}]`);
  target.tagName = now.name.toUpperCase();
  target.dataset.testid = testid;
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

// ---- a) Light by default -----------------------------------------------------------------------------------

test('#851 OnboardingModel.DEFAULT_WORK_MODEL is light', () => {
  delete require.cache[require.resolve(MODEL)];
  assert.equal(require(MODEL).DEFAULT_WORK_MODEL, 'light');
});

test('#851 a fresh import opens step 3 with Light picked', { timeout: 30000 }, async () => {
  const app = await importAtAnalysis();
  assert.deepEqual(checkedModels(app), ['light']);
});

test('#851 a fresh new project opens step 3 with Light picked', { timeout: 30000 }, async () => {
  const app = await newAtAnalysis();
  assert.deepEqual(checkedModels(app), ['light']);
});

test('#851 a resumed wizard whose saved work model is Standard keeps Standard', { timeout: 30000 }, async () => {
  const app = page({ projects: [W.clone(UNFINISHED)], status: atStep(W.PID, 'analysis', { ...PICKS, workModel: 'standard' }) });
  await app.boot();
  W.wizard(app).open({ projectId: W.PID });
  await app.settle(10);
  assert.equal(W.currentStep(app), 'analysis', 'the wizard resumed on step 3');
  assert.deepEqual(checkedModels(app), ['standard']);
});

test('#851 Finish with step 3 untouched saves workModel light', { timeout: 30000 }, async () => {
  const app = await importAtAnalysis();
  await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'review', 'the review');
  await Promise.race([W.press(app, 'wizard-finish'), app.settle(60)]);
  await app.settle(30);
  const calls = app.callsTo('updateProject');
  assert.equal(calls.length, 1, `one api.updateProject call at Finish (${calls.length})`);
  assert.equal(JSON.parse(JSON.stringify(calls[0][1] || {})).workModel ?? null, 'light');
});

// ---- b) "Where the files live" only for Standard and Full -------------------------------------------------

test('#851 with Light picked, "Where the files live" is not shown', { timeout: 30000 }, async () => {
  const app = await importAtAnalysis();
  await pick(app, 'light');
  assert.deepEqual(checkedModels(app), ['light']);
  assert.equal(filesPanel(app), null, 'no data-testid="wizard-work-model-files"');
  assert.equal(H.visibleText(W.wizardMarkup(app)).includes('docs/work/'), false, 'no docs/work/ path');
});

for (const id of ['standard', 'full']) {
  test(`#851 with ${id} picked, "Where the files live" is shown with its docs/work/ path`, { timeout: 30000 }, async () => {
    const app = await importAtAnalysis();
    await pick(app, id);
    assert.deepEqual(checkedModels(app), [id]);
    const panel = filesPanel(app);
    assert.ok(panel, 'data-testid="wizard-work-model-files"');
    assert.equal(H.visibleText(panel.inner).includes('docs/work/'), true, H.visibleText(panel.inner));
  });
}

// ---- c) Recommended on Light and on Analyze the repository ------------------------------------------------

test('#851 the catalogs have onboarding.recommended: Recommended / Recomendado', () => {
  assert.equal(catalog('en')['onboarding.recommended'], 'Recommended');
  assert.equal(catalog('pt-BR')['onboarding.recommended'], 'Recomendado');
});

for (const [where, open] of [['import', importAtAnalysis], ['new project', newAtAnalysis]]) {
  for (const lang of ['en', 'pt-BR']) {
    test(`#851 ${where} (${lang}): "Recommended" shows once on Light and never on Standard or Full`, { timeout: 30000 }, async () => {
      const word = lang === 'en' ? 'Recommended' : 'Recomendado';
      const app = await open({ lang });
      assert.deepEqual(MODELS.map((id) => count(choiceText(app, id), word)), [1, 0, 0], MODELS.map((id) => choiceText(app, id)).join(' | '));
    });
  }
}

for (const lang of ['en', 'pt-BR']) {
  test(`#851 import (${lang}): "Recommended" shows once on Analyze the repository and never on Define manually`, { timeout: 30000 }, async () => {
    const word = lang === 'en' ? 'Recommended' : 'Recomendado';
    const app = await importAtAnalysis({ lang });
    const html = W.wizardMarkup(app);
    const texts = ['analyze', 'manual'].map((id) => {
      const el = W.byTestId(html, `wizard-workflows-choice-${id}`);
      assert.ok(el, `data-testid="wizard-workflows-choice-${id}"`);
      return H.visibleText(el.inner);
    });
    assert.deepEqual(texts.map((s) => count(s, word)), [1, 0], texts.join(' | '));
  });
}

// ---- d) the work models' texts -----------------------------------------------------------------------------

test('#851 work_model_standard_text no longer recommends itself and names the Anthropic playbook, simplified', () => {
  for (const [lang, old] of [['en', /Recommended for features/i], ['pt-BR', /Recomendado para features/i]]) {
    const s = String(catalog(lang)['onboarding.work_model_standard_text'] || '');
    assert.doesNotMatch(s, old, `${lang}: ${s}`);
    assert.match(s, /playbook/i, `${lang}: ${s}`);
    assert.match(s, /Anthropic/, `${lang}: ${s}`);
    assert.match(s, /simplif/i, `${lang}: ${s}`);
  }
});

test('#851 work_model_full_text names the complete playbook with REVIEW.md and evals', () => {
  for (const lang of ['en', 'pt-BR']) {
    const s = String(catalog(lang)['onboarding.work_model_full_text'] || '');
    assert.match(s, /playbook/i, `${lang}: ${s}`);
    assert.match(s, /REVIEW\.md/, `${lang}: ${s}`);
    assert.match(s, /evals/i, `${lang}: ${s}`);
  }
});
