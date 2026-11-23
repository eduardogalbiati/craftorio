// #25, revised by #35: the catalogs (packages/shared/i18n/en.json, pt-BR.json) for a project created without a
// repository. #25 added texts telling its owner that a repository is needed (onboarding.next_steps_needs_repo,
// backlog_po.no_repo_notice, onboarding.no_remote_hint: "Without a repository the Backlog and the Roadmap are not
// available…"); #25's tests required those keys. #35's decision: "a project with no remote gets a local backlog", so
// those keys are no longer required, and no text may say the Backlog and the Roadmap are unavailable without one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${lang}.json`), 'utf8'));
const saying = (lang, re) => Object.entries(catalog(lang)).filter(([, v]) => re.test(String(v))).map(([k]) => k);

test('#35 en: no text says the Backlog and the Roadmap are not available without a repository', () => {
  assert.deepEqual(saying('en', /Without a repository the Backlog and the Roadmap are not available/i), []);
});

test('#35 pt-BR: no text says "Sem um repositório, o Backlog e o Roadmap não ficam disponíveis"', () => {
  assert.deepEqual(saying('pt-BR', /Sem um repositório, o Backlog e o Roadmap não ficam disponíveis/i), []);
});
