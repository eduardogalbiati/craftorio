// #107 (review rounds 2 and 3): what the wizard (fronts/build/views/projects/project-wizard.js) does with an import
// refused before anything was made (api.startOnboarding answers { status: 'failed', code, reason, cli } with no
// projectId): the gh / glab warning next to the error, Back and typing clear the refusal (Next works again), its
// Retry starts the import again, a refusal that comes back after the wizard closed is a toast with its cause; and
// (#108) a created project's own folder on its create step. On the real page (renderer-app-harness via
// project-wizard-helpers.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const I18N_DIR = path.join(path.dirname(require.resolve('@craftorio/shared/package.json')), 'i18n');
const EN = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'en.json'), 'utf8'));

const REPO = 'https://github.com/acme/nao-existe-xyz.git';
const refused = (cli = null) => ({
  status: 'failed',
  code: 'repo-not-found',
  reason: "fatal: repository 'https://github.com/acme/nao-existe-xyz.git/' not found",
  jobs: W.jobs({ clone: { status: 'skipped' } }),
  cli,
});

// step 2 of an import, the URL and the name typed, Next pressed: answered `start`
async function refusedImport({ start = refused(), api = {} } = {}) {
  const app = W.page({ start, api });
  await app.boot();
  W.wizard(app).open();
  await app.settle(10);
  await W.toRepository(app);
  await W.typeInto(app, '#wizard-repo', REPO);
  await W.typeInto(app, '#wizard-name', 'Nao Existe Xyz');
  await W.press(app, 'wizard-next');
  return app;
}

const errorEl = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-error');

// Next's disabled state: its live element when set in place, else its markup
function nextDisabled(app) {
  const live = W.existing(app, 'wizard-next');
  if (typeof live?.disabled === 'boolean') return live.disabled;
  return 'disabled' in (W.byTestId(W.wizardMarkup(app), 'wizard-next')?.attrs || {});
}

// the refusal's error is gone: not in the markup, or removed in place
function errorGone(app) {
  if (!errorEl(app)) return true;
  return !String(W.existing(app, 'project-wizard')?.innerHTML || '').includes('data-testid="wizard-error"');
}

test('#107 a refused import with gh missing shows wizard-cli-warning next to wizard-error', { timeout: 20000 }, async () => {
  const app = await refusedImport({ start: refused({ provider: 'github', status: 'missing', reason: 'The GitHub CLI (gh) is not installed.' }) });
  assert.equal(W.currentStep(app), 'repository');
  assert.equal(errorEl(app)?.attrs['data-error'], 'repo-not-found');
  const warn = W.byTestId(W.wizardMarkup(app), 'wizard-cli-warning');
  assert.ok(warn, 'the gh warning shows with the refusal');
  assert.equal(warn.attrs['data-error'], 'cli-missing');
});

test('#107 a refused import with gh signed out shows wizard-cli-warning cli-signed-out', { timeout: 20000 }, async () => {
  const app = await refusedImport({ start: refused({ provider: 'github', status: 'signed-out', reason: 'not signed in' }) });
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-cli-warning')?.attrs['data-error'], 'cli-signed-out');
});

test('#107 a refused import keeps Next disabled until something changes', { timeout: 20000 }, async () => {
  const app = await refusedImport();
  assert.equal(nextDisabled(app), true);
});

test('#107 Back after a refused import, then Next again: no error, Next enabled', { timeout: 20000 }, async () => {
  const app = await refusedImport();
  await W.press(app, 'wizard-back');
  assert.notEqual(W.currentStep(app), 'repository', 'Back leaves step 2');
  await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'repository');
  assert.equal(errorGone(app), true, 'the refusal is cleared by Back');
  assert.equal(nextDisabled(app), false, 'Next works again');
});

// (the error is removed in place, which the harness's fake DOM does not reflect in the markup: Next is what is read)
test('#107 typing another URL after a refused import enables Next, which starts the import again', { timeout: 20000 }, async () => {
  const app = await refusedImport();
  await W.typeInto(app, '#wizard-repo', 'https://github.com/acme/existe.git');
  assert.equal(nextDisabled(app), false);
  await W.press(app, 'wizard-next');
  assert.equal(app.callsTo('startOnboarding').length, 2);
});

test('#107 Retry of a refused import calls api.startOnboarding again', { timeout: 20000 }, async () => {
  const app = await refusedImport();
  assert.equal(app.callsTo('startOnboarding').length, 1);
  const retry = H.findEl(errorEl(app)?.outer || '', (e) => e.attrs['data-act'] === 'retry');
  assert.ok(retry, 'the error offers Retry');
  await W.clickRendered(app, retry, ['#project-wizard']);
  await app.settle(10);
  assert.equal(app.callsTo('startOnboarding').length, 2, 'Retry starts the import again');
});

test('#107 the wizard closed while the import is checked: the refusal comes back as a toast with its cause', { timeout: 20000 }, async () => {
  let answer;
  const app = await refusedImport({ api: { startOnboarding: () => new Promise((r) => { answer = r; }) } });
  W.wizard(app).close();
  await app.settle(10);
  answer(refused());
  await app.settle(20);
  const toast = String(W.existing(app, 'toast')?.innerHTML || W.existing(app, 'toast')?.textContent || '');
  assert.ok(toast.includes(EN['onboarding.import_repo_not_found'].split('{')[0].trim()), `the toast: ${toast}`);
});

// ---- #108: a created project's own folder ---------------------------------------------------------------------

test('#108 Back to the create step after creating shows the project\'s own folder, not the next free one', { timeout: 20000 }, async () => {
  const projects = [{ id: 'lista-tarefas', name: 'Lista Tarefas', folder: '/ws/projects/lista-tarefas', repo: null, status: 'ready' }];
  const app = W.page({
    api: {
      listProjects: async () => W.clone(projects),
      onboardingAccounts: async () => [],
      createOnboarding: async () => ({ projectId: 'lista-tarefas-2', status: 'ready', jobs: W.jobs({ clone: { status: 'skipped' } }), cli: null }),
      onboardingStatus: async () => ({ projectId: 'lista-tarefas-2', status: 'ready', jobs: W.jobs({ clone: { status: 'skipped' } }), cli: null }),
    },
  });
  await app.boot();
  W.wizard(app).open();
  await app.settle(20);
  await W.press(app, 'wizard-source-new');
  await W.press(app, 'wizard-next');
  const field = W.byTestId(W.wizardMarkup(app), 'wizard-new-name');
  const input = app.el(`#${field.attrs.id}`);
  input.tagName = 'INPUT';
  input.dataset.testid = 'wizard-new-name';
  await W.typeInto(app, `#${field.attrs.id}`, 'Lista Tarefas');
  await W.press(app, 'wizard-next');
  assert.notEqual(W.currentStep(app), 'repository', 'the project was created');
  projects.push({ id: 'lista-tarefas-2', name: 'Lista Tarefas', folder: '/ws/projects/lista-tarefas-2', repo: null, status: 'ready' });
  await W.press(app, 'wizard-back');
  const folder = W.byTestId(W.wizardMarkup(app), 'wizard-new-folder');
  const shown = String(W.existing(app, 'wizard-new-folder')?.textContent || '').trim() || H.visibleText(folder?.inner || '');
  assert.match(shown, /projects[\\/]lista-tarefas-2$/, `the folder line: ${shown}`);
});
