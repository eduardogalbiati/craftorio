// #738: the "Fork + PR" way of working in the onboarding's pure model (packages/shared/onboarding-model.js)
// and its texts (packages/shared/i18n/en.json, pt-BR.json). Acceptance tests, written before the code.
//
// The interface these tests assume:
// - PROFILE.mode gains 'fork' (after local and remote); PROFILE_LABELS.mode.fork is an i18n key
//   (onboarding.profile_mode_fork) whose English text names the fork and the pull request ("Fork + PR").
// - suggestWorkflows({ mode: 'fork', ... }) is a valid profile (not defaulted); the feature reason says the
//   change lands through a pull request from the fork to the original repository (a fork-specific key).
// - forkSuggestion({ repo, push }) → null unless push === false; else
//   { repo: '<owner>/<name>', text: { key, params: { repo } }, choices: [{ id: 'fork', label }, { id: 'local', label }] }
//   (labels i18n keys): the wizard's notice "You can't push to <owner>/<name>. Create a fork in your account
//   to contribute?" with "Create a fork" and "Work locally".
// The model is read inside each test: before the code exists each test fails on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const load = () => require('../onboarding-model');
const I18n = require('../i18n');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${lang}.json`), 'utf8'));
const EN = catalog('en');
const PT = catalog('pt-BR');

// a model text ({ key, params } or a key) in a language, its params resolved when they are keys too
function resolve(x, lang) {
  if (x && typeof x === 'object' && typeof x.key === 'string') {
    const params = Object.fromEntries(Object.entries(x.params || {}).map(([k, v]) => [k, typeof v === 'object' || (typeof v === 'string' && /^onboarding\./.test(v)) ? resolve(v, lang) : v]));
    return I18n.t(x.key, params, lang);
  }
  return /^onboarding\./.test(String(x)) ? I18n.t(String(x), undefined, lang) : String(x ?? '');
}

const FORK = { mode: 'fork', ci: 'pr+release', tests: 'unit' };
const REPO = 'https://github.com/akitaonrails/ai-memory.git';

test('#738 PROFILE.mode offers fork, besides local and remote', () => {
  assert.deepEqual(load().PROFILE.mode, ['local', 'remote', 'fork']);
});

test('#738 PROFILE_LABELS.mode.fork is an i18n key in en.json and pt-BR.json, read "Fork + PR"', () => {
  const key = load().PROFILE_LABELS.mode.fork;
  assert.equal(typeof key, 'string');
  assert.equal(key in EN, true, `${key} is in en.json`);
  assert.equal(key in PT, true, `${key} is in pt-BR.json`);
  assert.match(EN[key], /fork/i);
  assert.match(EN[key], /\bPR\b|pull request/i);
  assert.notEqual(PT[key], EN[key], 'the pt-BR text is its own');
});

test('#738 a fork profile is valid: its suggestions are not defaulted and profileLine names the fork', () => {
  const M = load();
  assert.equal(M.suggestWorkflows(FORK).defaulted, false);
  const line = M.profileLine(FORK);
  assert.equal(Array.isArray(line) ? line[0] : line, M.PROFILE_LABELS.mode.fork);
});

test('#738 the fork profile\'s feature reason says the change goes from the fork to the original repository', () => {
  const feature = load().suggestWorkflows(FORK).suggestions.find((s) => s.id === 'feature');
  const en = resolve(feature.reason, 'en');
  assert.match(en, /fork/i, `the English reason: "${en}"`);
  const remote = resolve(load().suggestWorkflows({ ...FORK, mode: 'remote' }).suggestions.find((s) => s.id === 'feature').reason, 'pt-BR');
  assert.notEqual(resolve(feature.reason, 'pt-BR'), remote, 'the pt-BR reason differs from the Remote one');
});

test('#738 forkSuggestion: no push permission → the notice naming owner/repo, with Create a fork and Work locally', () => {
  const s = load().forkSuggestion({ repo: REPO, push: false });
  assert.equal(s.repo, 'akitaonrails/ai-memory');
  assert.equal(resolve(s.text, 'en'), 'You can\'t push to akitaonrails/ai-memory. Create a fork in your account to contribute?');
  assert.deepEqual(s.choices.map((c) => c.id), ['fork', 'local']);
  assert.deepEqual(s.choices.map((c) => resolve(c.label, 'en')), ['Create a fork', 'Work locally']);
});

test('#738 forkSuggestion: every key it uses is in en.json and pt-BR.json, the pt-BR texts translated', () => {
  const s = load().forkSuggestion({ repo: REPO, push: false });
  for (const key of [s.text.key, ...s.choices.map((c) => c.label)]) {
    assert.equal(key in EN, true, `${key} is in en.json`);
    assert.equal(key in PT, true, `${key} is in pt-BR.json`);
    assert.notEqual(PT[key], EN[key], `${key}: the pt-BR text is its own`);
  }
  assert.match(resolve(s.text, 'pt-BR'), /akitaonrails\/ai-memory/);
});

test('#738 forkSuggestion: with push permission (or none read) there is no notice', () => {
  const M = load();
  assert.equal(M.forkSuggestion({ repo: REPO, push: true }), null);
  assert.equal(M.forkSuggestion({ repo: REPO }), null);
});
