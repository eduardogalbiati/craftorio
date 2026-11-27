// #107: the new-project wizard (fronts/build/views/projects/project-wizard.js), step 2 "Import a repository",
// says in the interface language why an import failed, naming its cause. Acceptance tests, written before the
// code, on the real page (packages/ui-kit/test/renderer-app-harness.js, through project-wizard-helpers.js).
//
// The contract assumed here (the engine's side: packages/engine/test/project/import-failure-107.test.js):
// - api.startOnboarding({ name, repo }) resolves, for an import that cannot be done, to
//   { status: 'failed', code, reason } with no projectId (nothing was created), code one of
//   'repo-not-found' | 'repo-no-access' | 'not-a-git-repo'; `reason` is git's own text, in English;
// - the wizard stays on step 2 and shows data-testid="wizard-error" with data-error="<code>", whose visible
//   text holds the cause's message in the interface language, from the i18n keys
//     onboarding.import_repo_not_found, onboarding.import_repo_no_access, onboarding.import_not_a_git_repo
//   (packages/shared/i18n/en.json and pt-BR.json; a message may take {params}: its literal parts are checked);
//   it never shows another cause's message (a folder without git never reads "No access to the repository").
// - the three keys exist in both files, non-empty, distinct from each other, and pt-BR differs from en.
// The URL cases go through the URL field; the folder case through the "Use a local repository" card
// (api.pickFolder, then the folder's file:// URL).
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
const KEYS = {
  'repo-not-found': 'onboarding.import_repo_not_found',
  'repo-no-access': 'onboarding.import_repo_no_access',
  'not-a-git-repo': 'onboarding.import_not_a_git_repo',
};
const LANGS = ['en', 'pt-BR'];
const FOLDER = '/home/ana/notes';

const failed = (code, reason) => ({ status: 'failed', code, reason, jobs: W.jobs({ clone: { status: 'skipped' } }), cli: null });
const CASES = {
  'repo-not-found': { repo: 'https://github.com/acme/nao-existe-xyz.git', name: 'Nao Existe Xyz', reason: "git ls-remote failed: remote: Repository not found.\nfatal: repository 'https://github.com/acme/nao-existe-xyz.git/' not found" },
  'repo-no-access': { repo: 'https://github.com/acme/private-tool.git', name: 'Private Tool', reason: "git ls-remote failed: fatal: Authentication failed for 'https://github.com/acme/private-tool.git/'" },
  'not-a-git-repo': { folder: FOLDER, name: 'notes', reason: "git ls-remote failed: fatal: '/home/ana/notes' does not appear to be a git repository" },
};

// a message's literal parts (around its {params}), the ones long enough to tell it apart
const literals = (msg) => String(msg).split(/\{[^}]*\}/).map((s) => s.trim()).filter((s) => s.length >= 4);
const message = (lang, code) => DICT[lang][KEYS[code]];
const holds = (text, msg) => literals(msg).length > 0 && literals(msg).every((part) => text.includes(part));

// the wizard in `lang`, an import of the case's repository (or folder) answered failed with `code`
async function failedImport(lang, code) {
  const c = CASES[code];
  const app = W.page({ start: failed(code, c.reason), api: { pickFolder: async () => c.folder || null } });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  W.wizard(app).open();
  await app.settle(10);
  if (c.folder) {
    await W.press(app, 'wizard-source-folder');
    await W.press(app, 'wizard-next');
  } else {
    await W.toRepository(app);
    await W.typeInto(app, '#wizard-repo', c.repo);
    await W.typeInto(app, '#wizard-name', c.name);
  }
  await W.press(app, 'wizard-next');
  assert.equal(app.callsTo('startOnboarding').length, 1, 'one api.startOnboarding call');
  return app;
}

const errorOf = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-error');

for (const code of Object.keys(KEYS)) {
  test(`#107 i18n: ${KEYS[code]} exists in en and pt-BR, and pt-BR is not the English text`, () => {
    for (const lang of LANGS) {
      assert.equal(typeof message(lang, code), 'string', `${KEYS[code]} in ${lang}.json`);
      assert.ok(message(lang, code).trim().length > 0, `${KEYS[code]} in ${lang}.json is not empty`);
    }
    assert.notEqual(message('pt-BR', code), message('en', code), `${KEYS[code]}: pt-BR is translated`);
  });

  for (const lang of LANGS) {
    test(`#107 wizard (${lang}): ${code} shows wizard-error data-error="${code}" with its own message in ${lang}`, { timeout: 20000 }, async () => {
      const app = await failedImport(lang, code);
      assert.equal(W.currentStep(app), 'repository', 'the wizard stays on step 2');
      const el = errorOf(app);
      assert.ok(el, 'the wizard shows data-testid="wizard-error"');
      assert.equal(el.attrs['data-error'], code);
      const text = H.visibleText(el.outer);
      assert.ok(holds(text, message(lang, code)), `the ${lang} message of ${KEYS[code]} ("${message(lang, code)}") in: ${text}`);
      for (const other of Object.keys(KEYS).filter((k) => k !== code)) {
        assert.equal(holds(text, message(lang, other)), false, `another cause's message (${KEYS[other]}) in: ${text}`);
      }
      if (code !== 'repo-no-access') assert.equal(text.includes(DICT[lang]['onboarding.no_access']), false, `"${DICT[lang]['onboarding.no_access']}" is not the cause: ${text}`);
      if (lang !== 'en') assert.equal(holds(text, message('en', code)), false, `the English message in pt-BR: ${text}`);
    });
  }
}

test('#107 i18n: the three causes read three different messages, in en and in pt-BR', () => {
  for (const lang of LANGS) {
    const texts = Object.keys(KEYS).map((code) => message(lang, code));
    assert.equal(new Set(texts).size, 3, `${lang}: ${JSON.stringify(texts)}`);
  }
});
