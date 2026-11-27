// #98: the new-project wizard's "Use a local repository" card takes any folder on this computer (a plain folder
// gets a new git repository from its files), so its card text and its step 2 help (onboarding.folder_text,
// onboarding.folder_help in packages/shared/i18n/en.json, pt-BR.json) no longer say the folder must already be a
// git repository with a commit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${lang}.json`), 'utf8'));

for (const key of ['onboarding.folder_text', 'onboarding.folder_help']) {
  test(`#98 en: ${key} is there and no longer requires a git repository with a commit`, () => {
    const text = catalog('en')[key];
    assert.equal(typeof text, 'string');
    assert.ok(text.trim().length > 0);
    assert.doesNotMatch(text, /already a git repository|must be a git repository|at least one commit/i);
  });

  test(`#98 pt-BR: ${key} is there and no longer requires a git repository with a commit`, () => {
    const text = catalog('pt-BR')[key];
    assert.equal(typeof text, 'string');
    assert.ok(text.trim().length > 0);
    assert.doesNotMatch(text, /já é um repositório git|precisa ser um repositório git|pelo menos um commit/i);
  });
}
