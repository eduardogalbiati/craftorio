// #725: step 3's "Suggested workflows" column state (OnboardingModel.workflowsColumnState) and the known
// failure codes of a job (FAILURE_CODES), each with its words in en and pt-BR (onboarding.job_failed_<code>,
// the code's dashes as underscores).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const M = require('@craftorio/shared/onboarding-model');

const PROFILE = { mode: 'remote', ci: 'release', tests: 'unit' };
const I18N = path.join(__dirname, '..', '..', 'shared', 'i18n');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8'));

test('#725 the column offers the two choices before the owner picks one, whatever the profile job does', () => {
  assert.equal(M.workflowsColumnState(), 'choose');
  assert.equal(M.workflowsColumnState({}), 'choose');
  assert.equal(M.workflowsColumnState({ profileJob: { status: 'running' } }), 'choose');
  assert.equal(M.workflowsColumnState({ profileJob: { status: 'done', profile: PROFILE } }), 'choose');
});

test('#725 after Analyze the column is analyzing while the profile job has not ended', () => {
  assert.equal(M.workflowsColumnState({ mode: 'analyze' }), 'analyzing');
  assert.equal(M.workflowsColumnState({ mode: 'analyze', profileJob: { status: 'waiting' } }), 'analyzing');
  assert.equal(M.workflowsColumnState({ mode: 'analyze', profileJob: { status: 'running' } }), 'analyzing');
});

test('#725 a profile job that failed, or ended without a valid profile, makes the column failed', () => {
  assert.equal(M.workflowsColumnState({ mode: 'analyze', profileJob: { status: 'failed', error: 'x' } }), 'failed');
  assert.equal(M.workflowsColumnState({ mode: 'analyze', profileJob: { status: 'done' } }), 'failed');
  assert.equal(M.workflowsColumnState({ mode: 'analyze', profileJob: { status: 'done', profile: null } }), 'failed');
  assert.equal(M.workflowsColumnState({ mode: 'analyze', profileJob: { status: 'done', profile: { mode: 'nope' } } }), 'failed');
});

test('#725 a profile job done with a valid profile makes the column analyzed', () => {
  assert.equal(M.workflowsColumnState({ mode: 'analyze', profileJob: { status: 'done', profile: PROFILE } }), 'analyzed');
});

test('#725 Define manually makes the column manual, whatever the profile job does', () => {
  assert.equal(M.workflowsColumnState({ mode: 'manual' }), 'manual');
  assert.equal(M.workflowsColumnState({ mode: 'manual', profileJob: { status: 'running' } }), 'manual');
  assert.equal(M.workflowsColumnState({ mode: 'manual', profileJob: { status: 'failed' } }), 'manual');
});

test('#725 FAILURE_CODES names the known failures the issue lists', () => {
  const codes = Array.from(M.FAILURE_CODES);
  for (const code of ['cli-missing', 'invalid-ranking', 'no-folder', 'refused', 'timeout']) {
    assert.equal(codes.includes(code), true, `FAILURE_CODES has ${code}`);
  }
  assert.equal(new Set(codes).size, codes.length, 'no code twice');
});

for (const lang of ['en', 'pt-BR']) {
  test(`#725 every failure code has its words in ${lang}`, () => {
    const words = catalog(lang);
    const missing = Array.from(M.FAILURE_CODES)
      .map((code) => `onboarding.job_failed_${code.replace(/-/g, '_')}`)
      .filter((key) => typeof words[key] !== 'string' || !words[key].trim());
    assert.deepEqual(missing, []);
    assert.equal(typeof words['onboarding.job_failed'], 'string', 'the generic failure words');
  });
}

test('#725 the CLI-missing words name the missing command in both languages', () => {
  assert.match(catalog('en')['onboarding.job_failed_cli_missing'], /\{cli\}/);
  assert.match(catalog('pt-BR')['onboarding.job_failed_cli_missing'], /\{cli\}.*não está instalado/);
});
