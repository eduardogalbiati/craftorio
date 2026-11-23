// #25 acceptance, written before the code: the catalogs (packages/shared/i18n/en.json, pt-BR.json) hold the texts
// that tell the owner of a project created without a repository that one is needed, and how to add it.
//
// The keys assumed here:
// - onboarding.next_steps_needs_repo, onboarding.next_steps_needs_repo_text, onboarding.add_repo: the project
//   page's Next steps entry (fronts/analyser/views/project/project.js) and its action;
// - backlog_po.no_repo_notice: the Product Owner drawer's notice (fronts/build/views/backlog/backlog-po.js);
// - onboarding.no_remote_hint: the wizard's hint next to "Create a private repository too"
//   (fronts/build/views/projects/project-wizard.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${lang}.json`), 'utf8'));
const KEYS = [
  'onboarding.next_steps_needs_repo',
  'onboarding.next_steps_needs_repo_text',
  'onboarding.add_repo',
  'backlog_po.no_repo_notice',
  'onboarding.no_remote_hint',
];
const present = (lang) => KEYS.filter((k) => typeof catalog(lang)[k] === 'string' && catalog(lang)[k].trim() !== '');

test('#25 en: every new key has a text', () => {
  assert.deepEqual(present('en'), KEYS);
});

test('#25 pt-BR: every new key has a text', () => {
  assert.deepEqual(present('pt-BR'), KEYS);
});

test('#25 pt-BR: no new text is left in English', () => {
  const en = catalog('en');
  const pt = catalog('pt-BR');
  assert.deepEqual(KEYS.filter((k) => k in pt && pt[k] === en[k]), []);
});

test('#25 en: the Next steps entry, the drawer notice and the wizard hint name the repository', () => {
  const en = catalog('en');
  const keys = ['onboarding.next_steps_needs_repo', 'backlog_po.no_repo_notice', 'onboarding.no_remote_hint'];
  assert.deepEqual(keys.filter((k) => !/repositor/i.test(String(en[k] ?? ''))), []);
});

test('#25 pt-BR: the Next steps entry, the drawer notice and the wizard hint say "repositório"', () => {
  const pt = catalog('pt-BR');
  const keys = ['onboarding.next_steps_needs_repo', 'backlog_po.no_repo_notice', 'onboarding.no_remote_hint'];
  assert.deepEqual(keys.filter((k) => !/repositório/i.test(String(pt[k] ?? ''))), []);
});

test('#25 the wizard hint says the Backlog and the Roadmap are not available without a repository (both languages)', () => {
  const texts = ['en', 'pt-BR'].map((lang) => String(catalog(lang)['onboarding.no_remote_hint'] ?? ''));
  assert.deepEqual(texts.map((s) => /Backlog/.test(s) && /Roadmap/.test(s)), [true, true], JSON.stringify(texts));
});
