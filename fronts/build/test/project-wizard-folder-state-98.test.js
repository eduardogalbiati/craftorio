// #98: step 2 of the new-project wizard's "Use a local repository" card (fronts/build/views/projects/project-wizard.js
// with project-wizard-folder.js) says what the engine read in the picked folder (api.inspectOnboardingFolder):
// wizard-folder-state with data-state (reading | repository | empty-repository | plain | missing | unreadable) and its
// text in the interface language; Next stays off while reading and on a missing or unreadable folder; Next says
// "create" for a folder that gets a new repository, "clone" for a repository; an answer for an older pick (before
// Change folder) is dropped; an engine without the channel shows the help line. And an import refused as too large
// shows its title. On the real page (packages/ui-kit/test/renderer-app-harness.js, through project-wizard-helpers.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const I18N_DIR = path.join(path.dirname(require.resolve('@craftorio/shared/package.json')), 'i18n');
const DICT = {
  en: JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'en.json'), 'utf8')),
  'pt-BR': JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'pt-BR.json'), 'utf8')),
};
const STATE_KEYS = {
  'empty-repository': 'onboarding.folder_state_empty_repository',
  missing: 'onboarding.folder_state_missing',
  plain: 'onboarding.folder_state_plain',
  reading: 'onboarding.folder_state_reading',
  repository: 'onboarding.folder_state_repository',
  unreadable: 'onboarding.folder_state_unreadable',
};
const FOLDER = '/home/ana/notes';
const OTHER = '/home/ana/site';

// a promise resolved from outside (an engine answer that comes later)
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// the wizard on the folder step for FOLDER; `inspect`: api.inspectOnboardingFolder (null: the engine has no channel)
async function atFolderStep({ inspect, pick = async () => FOLDER, lang = 'en', start } = {}) {
  const api = { pickFolder: pick };
  if (inspect) api.inspectOnboardingFolder = inspect;
  const app = W.page({ api, ...(start ? { start } : {}) });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  W.wizard(app).open();
  await app.settle(10);
  await W.press(app, 'wizard-source-folder');
  await W.press(app, 'wizard-next');
  await app.settle(10);
  assert.equal(W.currentStep(app), 'repository', 'the wizard is on step 2');
  return app;
}

const stateEl = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-folder-state');
const nextEl = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-next');
const nextOff = (app) => 'disabled' in (nextEl(app)?.attrs || {});

test('#98 i18n: every folder state, Next "create" and its wait text exist in en and pt-BR, translated', () => {
  for (const key of [...Object.values(STATE_KEYS), 'onboarding.next_create', 'onboarding.creating_wait', 'onboarding.import_folder_too_large']) {
    for (const lang of ['en', 'pt-BR']) assert.ok(String(DICT[lang][key] || '').trim(), `${key} in ${lang}.json`);
    assert.notEqual(DICT['pt-BR'][key], DICT.en[key], `${key}: pt-BR is translated`);
  }
  assert.doesNotMatch(DICT.en['onboarding.next_create'], /clone/i);
});

for (const state of ['repository', 'empty-repository', 'plain', 'missing', 'unreadable']) {
  for (const lang of ['en', 'pt-BR']) {
    test(`#98 wizard (${lang}): a ${state} folder shows wizard-folder-state data-state="${state}" with its text`, { timeout: 20000 }, async () => {
      const app = await atFolderStep({ inspect: async () => ({ state }), lang });
      const el = stateEl(app);
      assert.ok(el, 'the step shows data-testid="wizard-folder-state"');
      assert.equal(el.attrs['data-state'], state);
      assert.ok(H.visibleText(el.outer).includes(DICT[lang][STATE_KEYS[state]]), `the ${lang} text of ${STATE_KEYS[state]} in: ${H.visibleText(el.outer)}`);
    });
  }
}

test('#98 wizard: the engine is asked about the picked folder\'s file:// URL', { timeout: 20000 }, async () => {
  const app = await atFolderStep({ inspect: async () => ({ state: 'plain' }) });
  const calls = app.callsTo('inspectOnboardingFolder');
  assert.equal(calls.length >= 1, true, 'api.inspectOnboardingFolder was called');
  assert.match(JSON.stringify(calls[calls.length - 1]), /file:\/\/.*notes/);
});

test('#98 wizard: Next stays off on a missing or unreadable folder, on otherwise (with a name)', { timeout: 30000 }, async () => {
  for (const [state, off] of [['missing', true], ['unreadable', true], ['plain', false], ['empty-repository', false], ['repository', false]]) {
    const app = await atFolderStep({ inspect: async () => ({ state }) });
    await W.typeInto(app, '#wizard-name', 'notes');
    assert.equal(nextOff(app), off, `Next disabled on a ${state} folder`);
  }
});

test('#98 wizard: while the engine reads the folder, the state says reading and Next stays off', { timeout: 20000 }, async () => {
  const later = deferred();
  const app = await atFolderStep({ inspect: () => later.promise });
  await W.typeInto(app, '#wizard-name', 'notes');
  assert.equal(stateEl(app)?.attrs['data-state'], 'reading');
  assert.equal(nextOff(app), true, 'Next disabled while reading');
  later.resolve({ state: 'plain' });
  await app.settle(10);
  assert.equal(stateEl(app)?.attrs['data-state'], 'plain');
  assert.equal(nextOff(app), false, 'Next enabled once the folder is read');
});

test('#98 wizard: Next says "create" on a plain folder or a repository without a commit, "clone" on a repository', { timeout: 30000 }, async () => {
  const label = (s) => String(s).replace(/\s+/g, ' ').trim();
  for (const [state, key] of [['plain', 'onboarding.next_create'], ['empty-repository', 'onboarding.next_create'], ['repository', 'onboarding.next_clone']]) {
    const app = await atFolderStep({ inspect: async () => ({ state }) });
    await W.typeInto(app, '#wizard-name', 'notes');
    const text = label(H.visibleText(nextEl(app).outer));
    assert.ok(text.includes(label(DICT.en[key])), `${state}: Next reads "${DICT.en[key]}", got "${text}"`);
  }
});

test('#98 wizard: after Change folder, a late answer for the first folder is dropped', { timeout: 20000 }, async () => {
  const first = deferred();
  const second = deferred();
  const picks = [FOLDER, OTHER];
  const app = await atFolderStep({
    pick: async () => picks.shift() || OTHER,
    inspect: (url) => (/notes/.test(String(url?.folder ?? url)) ? first.promise : second.promise),
  });
  await W.press(app, 'wizard-folder-change');
  await app.settle(10);
  second.resolve({ state: 'repository' });
  await app.settle(10);
  first.resolve({ state: 'missing' });
  await app.settle(10);
  assert.equal(stateEl(app)?.attrs['data-state'], 'repository', 'the state of the folder picked last');
});

test('#98 wizard: an engine without the folder channel shows the help line, no state, and Next works with a name', { timeout: 20000 }, async () => {
  const app = await atFolderStep({ inspect: null });
  await W.typeInto(app, '#wizard-name', 'notes');
  assert.equal(stateEl(app) === null || stateEl(app) === undefined, true, 'no wizard-folder-state');
  assert.ok(H.visibleText(W.wizardMarkup(app)).includes(DICT.en['onboarding.folder_help']), 'the help line');
  assert.equal(nextOff(app), false);
});

test('#98 wizard: an import refused as folder-too-large shows its title and the engine\'s reason', { timeout: 20000 }, async () => {
  const reason = "The folder's files take more than the 500 MB limit of a folder import.";
  const start = { status: 'failed', code: 'folder-too-large', reason, jobs: W.jobs({ clone: { status: 'skipped' } }), cli: null };
  const app = await atFolderStep({ inspect: async () => ({ state: 'plain' }), start });
  await W.typeInto(app, '#wizard-name', 'notes');
  await W.press(app, 'wizard-next');
  const el = W.byTestId(W.wizardMarkup(app), 'wizard-error');
  assert.ok(el, 'the wizard shows data-testid="wizard-error"');
  assert.equal(el.attrs['data-error'], 'folder-too-large');
  const text = H.visibleText(el.outer);
  assert.ok(text.includes(DICT.en['onboarding.import_folder_too_large']), text);
  assert.ok(text.includes('500 MB'), text);
});
