// #108: a new project's name in the new-project wizard (fronts/build/views/projects/project-wizard.js), step 2 of
// "Create new project". Acceptance tests, written before the code, on the real page
// (packages/ui-kit/test/renderer-app-harness.js), driven as project-wizard-create-632.test.js.
//
// The contract assumed here:
// - empty name: a line under the name, data-testid="wizard-name-required", reads onboarding.name_required in the
//   interface language (packages/shared/i18n/en.json, pt-BR.json; non-empty, pt-BR translated) while the name is
//   empty or blank; once a name is typed it is gone (removed, `hidden`, or empty). Next stays disabled meanwhile.
// - repeated name: the folder line data-testid="wizard-new-folder" ends with the folder the project will get,
//   OnboardingModel.newProjectFolderName(name, <the ids of api.listProjects>): with a project "lista-tarefas"
//   already there, "Lista Tarefas" reads …/projects/lista-tarefas-2, before Next.
// - slug: "Lista de Tarefas!" reads …/projects/lista-de-tarefas (the folder name, never the name typed).
// The folder line may be updated in place (its #id's textContent) or drawn again: both are read.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@craftorio/front-analyser/test/project-page-helpers');

const I18N_DIR = path.join(path.dirname(require.resolve('@craftorio/shared/package.json')), 'i18n');
const DICT = {
  en: JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'en.json'), 'utf8')),
  'pt-BR': JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'pt-BR.json'), 'utf8')),
};
const REQUIRED_KEY = 'onboarding.name_required';
const GH_IN = { provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'eduardo' };
const EXISTING = { id: 'lista-tarefas', name: 'Lista Tarefas', folder: '/ws/projects/lista-tarefas', repo: null, status: 'ready', exists: true };
const clone = (x) => JSON.parse(JSON.stringify(x));

// the markup of an element by id, with what was written into the ids inside it (as in the #632 test)
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
const textOf = (el) => (el ? H.visibleText(el.inner) : '');

// a line the wizard may update in place (its #id's live element), else its markup's text
function liveText(app, testid) {
  const el = byTestId(wizardMarkup(app), testid);
  const live = el?.attrs.id ? existing(app, el.attrs.id) : null;
  return String(live?.textContent || '').trim() || textOf(el);
}

// the required line's visible text, '' when it is not shown (missing, hidden in the markup or in place)
function requiredLine(app) {
  const el = byTestId(wizardMarkup(app), 'wizard-name-required');
  if (!el || 'hidden' in el.attrs) return '';
  const live = el.attrs.id ? existing(app, el.attrs.id) : null;
  if (live && (live.hidden === true || 'hidden' in (live.attrs || {}))) return '';
  return liveText(app, 'wizard-name-required');
}

// whether the required line is gone: not in the markup, hidden, or emptied in place (its live element's text)
function requiredGone(app) {
  const el = byTestId(wizardMarkup(app), 'wizard-name-required');
  if (!el || 'hidden' in el.attrs) return true;
  const live = el.attrs.id ? existing(app, el.attrs.id) : null;
  if (!live) return false;
  return live.hidden === true || 'hidden' in (live.attrs || {}) || String(live.textContent ?? '').trim() === '';
}

async function press(app, testid) {
  const el = byTestId(wizardMarkup(app), testid);
  assert.ok(el, `the wizard shows data-testid="${testid}"`);
  await clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// types into the name field as project-wizard-create-632.test.js's drive does
async function typeName(app, value) {
  const el = byTestId(wizardMarkup(app), 'wizard-new-name');
  assert.ok(el, 'the name field data-testid="wizard-new-name"');
  const target = app.el(`#${el.attrs.id}`);
  for (const [k, v] of Object.entries(el.attrs)) if (k.startsWith('data-')) target.dataset[camel(k.slice(5))] = v;
  target.tagName = 'INPUT';
  target.type = 'text';
  target.value = value;
  const root = app.el('#project-wizard');
  for (const type of ['input', 'change', 'blur']) {
    for (const node of [target, root]) {
      const ev = { type, target, currentTarget: node, preventDefault() {}, stopPropagation() {} };
      if (node === target) await target[`on${type}`]?.(ev);
      for (const fn of node.listeners[type] || []) await fn(ev);
    }
  }
  await app.settle(10);
}

async function atCreate({ lang = 'en', projects = [] } = {}) {
  const app = loadApp({
    api: {
      listProjects: async () => clone(projects),
      onboardingAccounts: async () => clone([GH_IN]),
      onboardingRepos: async () => [],
      createOnboarding: async () => ({ projectId: 'x', status: 'ready', jobs: {}, cli: null }),
      onboardingStatus: async () => null,
      architectureEstimate: async () => null,
    },
  });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  app.sandbox.ProjectWizard.open();
  await app.settle(20);
  await press(app, 'wizard-source-new');
  await press(app, 'wizard-next');
  assert.ok(byTestId(wizardMarkup(app), 'wizard-new-name'), 'the create step with its name field');
  return app;
}

// Next's disabled state: set in place as the name is typed (#wizard-next's live element), else its markup
function nextDisabled(app) {
  const live = existing(app, 'wizard-next');
  if (typeof live?.disabled === 'boolean') return live.disabled;
  return 'disabled' in (byTestId(wizardMarkup(app), 'wizard-next')?.attrs || {});
}

// ---- (a) empty: the name is required -----------------------------------------------------------------

test(`#108 i18n: ${REQUIRED_KEY} exists in en and pt-BR, and pt-BR is not the English text`, () => {
  for (const lang of ['en', 'pt-BR']) {
    assert.equal(typeof DICT[lang][REQUIRED_KEY], 'string', `${REQUIRED_KEY} in ${lang}.json`);
    assert.ok(DICT[lang][REQUIRED_KEY].trim().length > 0, `${REQUIRED_KEY} in ${lang}.json is not empty`);
  }
  assert.notEqual(DICT['pt-BR'][REQUIRED_KEY], DICT.en[REQUIRED_KEY]);
});

for (const lang of ['en', 'pt-BR']) {
  test(`#108 create step (${lang}): an empty name shows the line wizard-name-required, Next disabled`, { timeout: 20000 }, async () => {
    const app = await atCreate({ lang });
    assert.equal(requiredLine(app), DICT[lang][REQUIRED_KEY] || `<${REQUIRED_KEY} in ${lang}.json>`);
    assert.equal(nextDisabled(app), true, 'Next is disabled while the name is empty');
  });
}

test('#108 create step: a blank name (spaces) still shows the required line', { timeout: 20000 }, async () => {
  const app = await atCreate();
  await typeName(app, '   ');
  assert.equal(requiredLine(app), DICT.en[REQUIRED_KEY] || `<${REQUIRED_KEY} in en.json>`);
});

test('#108 create step: once a name is typed the required line is gone and Next is enabled', { timeout: 20000 }, async () => {
  const app = await atCreate();
  await typeName(app, 'Lista Tarefas');
  assert.equal(requiredGone(app), true, `no required line with a name: ${requiredLine(app)}`);
  assert.equal(nextDisabled(app), false, 'Next is enabled');
});

// ---- (b) repeated: the folder the project will get ----------------------------------------------------

test('#108 create step: a repeated name shows the folder it will get, …/projects/lista-tarefas-2', { timeout: 20000 }, async () => {
  const app = await atCreate({ projects: [EXISTING] });
  await typeName(app, 'Lista Tarefas');
  const shown = liveText(app, 'wizard-new-folder');
  assert.match(shown, /projects[\\/]lista-tarefas-2$/, `the folder line: ${shown}`);
});

test('#108 create step: a free name shows its own folder, …/projects/lista-tarefas', { timeout: 20000 }, async () => {
  const app = await atCreate({ projects: [] });
  await typeName(app, 'Lista Tarefas');
  const shown = liveText(app, 'wizard-new-folder');
  assert.match(shown, /projects[\\/]lista-tarefas$/, `the folder line: ${shown}`);
});

// ---- (c) slug: the folder name, not the name typed -----------------------------------------------------

test('#108 create step: "Lista de Tarefas!" shows the folder name lista-de-tarefas', { timeout: 20000 }, async () => {
  const app = await atCreate();
  await typeName(app, 'Lista de Tarefas!');
  const shown = liveText(app, 'wizard-new-folder');
  assert.match(shown, /projects[\\/]lista-de-tarefas$/, `the folder line: ${shown}`);
  assert.equal(shown.includes('Lista de Tarefas!'), false, `the name typed is not the folder: ${shown}`);
});
