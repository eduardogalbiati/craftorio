// #41 (review): the run screen's group headings, session statuses and the repository hero workflows' stations in pt-BR.
// - Every progress group of every bundled workflow (workflows/*.yaml) and of the repository's hero workflows
//   (.craftorio/workflows/*.yaml) has its run_list.group_<name> key in both catalogs, so the next group cannot ship
//   in English ("Open PR" is translated by run_list.open_pr). RunProgress.groupName draws them.
// - StatusPill.statusLabel: a session's "Active" and "Retrying" read in Portuguese (run.js Sessions, run-list.js).
// - The hero workflows as Workflows › Definições shows them (loadWorkflow, fragments expanded, WorkflowInputs.localized):
//   every station, the secret_* ones of the secret-scan-pipeline fragment included, has a pt-BR label.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const I18n = require('@craftorio/shared/i18n');
const RunProgress = require('@craftorio/shared/run-progress-model');
const StatusPill = require('../status-pill');
const WorkflowInputs = require('../workflow-inputs');

const ROOT = path.join(__dirname, '..', '..', '..');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
const EN = catalog('en');
const PT = catalog('pt-BR');
const snake = (s) => String(s ?? '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
const yamlFiles = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => path.join(dir, f));
const FILES = [...yamlFiles('workflows'), ...yamlFiles(path.join('.craftorio', 'workflows'))];
const HEROES = ['ai-development-local-hero.yaml', 'ai-development-remote-hero.yaml'];

test.afterEach(() => I18n.setLanguage('en'));

for (const file of FILES) {
  test(`#41 ${file}: every progress group has a run_list.group_* key in en.json and pt-BR.json`, () => {
    const doc = yaml.load(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const missing = (doc.groups || []).map((g) => g.name).filter((name) => name && name !== RunProgress.OPEN_PR)
      .map((name) => `run_list.group_${snake(name)}`).filter((key) => !(key in EN) || !(key in PT));
    assert.deepEqual(missing, []);
  });
}

test('#41 pt-BR: the issue workflow\'s groups read Análise, Rascunho and Registro', () => {
  I18n.setLanguage('pt-BR');
  assert.deepEqual(['Analysis', 'Draft', 'File'].map((n) => RunProgress.groupName(n, I18n.t)), ['Análise', 'Rascunho', 'Registro']);
});

test('#41 English unchanged: the groups keep the file\'s names', () => {
  assert.deepEqual(['Analysis', 'Draft', 'File', 'Review'].map((n) => RunProgress.groupName(n, I18n.t)), ['Analysis', 'Draft', 'File', 'Review']);
});

test('#41 pt-BR: a session\'s "Active" and "Retrying" statuses are not in English', () => {
  I18n.setLanguage('pt-BR');
  const active = StatusPill.statusLabel('active');
  const retrying = StatusPill.statusLabel('retrying');
  assert.ok(active && retrying);
  assert.notEqual(active, 'Active');
  assert.notEqual(retrying, 'Retrying');
  assert.doesNotMatch(StatusPill.statusPill('active'), />Active</);
});

test('#41 English unchanged: "Active" and "Retrying"', () => {
  assert.equal(StatusPill.statusLabel('active'), 'Active');
  assert.equal(StatusPill.statusLabel('retrying'), 'Retrying');
});

function loadHero(file) {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const wf = loadWorkflow(path.join(ROOT, '.craftorio', 'workflows', file));
  return { ...wf, name: wf.metadata?.name || file, description: wf.metadata?.description, file, origin: 'repository' };
}

for (const file of HEROES) {
  test(`#41 pt-BR ${file}: every station Definições shows has a Portuguese label (secret_* included)`, () => {
    const english = WorkflowInputs.localized(loadHero(file));
    I18n.setLanguage('pt-BR');
    const shown = WorkflowInputs.localized(loadHero(file));
    assert.equal(shown.steps.length, english.steps.length);
    for (const id of ['secret_scan', 'secret_found', 'secret_scan_error']) assert.ok(shown.steps.some((s) => s.id === id), `${file} has ${id}`);
    const untranslated = shown.steps.filter((s, i) => {
      const en = english.steps[i].display || s.id;
      if (!s.display) return true;
      // a station whose pt-BR word is the English one on purpose has its own key in pt-BR.json
      return s.display === en && !(s.display_key && s.display_key in PT);
    }).map((s) => `${s.id}: ${s.display || '(none)'}`);
    assert.deepEqual(untranslated, []);
  });

  test(`#41 English unchanged ${file}: the secret_* stations keep their English labels`, () => {
    const shown = WorkflowInputs.localized(loadHero(file));
    const labels = shown.steps.filter((s) => s.id.startsWith('secret_')).map((s) => s.display);
    assert.ok(labels.length >= 3);
    for (const l of labels) assert.match(l, /^[\x20-\x7e]+$/, `"${l}" is plain English`);
  });
}
