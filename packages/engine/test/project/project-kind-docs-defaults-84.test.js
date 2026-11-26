// #84: the docs kind of a repository with no code (packages/engine/domains/project/project-run-defaults.js
// projectFacts, runDefaultsWith) and its label (packages/shared/onboarding-model.js KIND_LABELS): what counts
// as a document, and a docs project's run defaults (no UI, no E2E, no screenshots, like a backend).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { KINDS, projectFacts, runDefaultsWith } = require('../../domains/project/project-run-defaults');
const OnboardingModel = require('@craftorio/shared/onboarding-model');
const en = require('@craftorio/shared/i18n/en.json');
const ptBR = require('@craftorio/shared/i18n/pt-BR.json');

function repo(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-kind-docs-84-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('#84 projectFacts: documents in sub-folders, images and upper-case files (NOTICE, CHANGELOG) are still docs', (t) => {
  const dir = repo(t, {
    'README.md': '# Guide\n',
    NOTICE: 'notice\n',
    CHANGELOG: 'v1\n',
    'docs/intro.rst': 'Intro\n',
    'docs/img/diagram.png': 'png',
    '.github/ISSUE_TEMPLATE.md': 'x\n',
  });
  assert.equal(projectFacts(dir).kind, 'docs');
});

test('#84 projectFacts: a Makefile next to the documents is code, not a docs repository', (t) => {
  const dir = repo(t, { 'README.md': '# Tool\n', Makefile: 'all:\n\techo hi\n' });
  assert.notEqual(projectFacts(dir).kind, 'docs');
});

test('#84 projectFacts: a source file deep in a folder makes the repository code, not docs', (t) => {
  const dir = repo(t, { 'README.md': '# Tool\n', 'src/lib/main.py': 'print(1)\n' });
  assert.notEqual(projectFacts(dir).kind, 'docs');
});

test('#84 projectFacts: an empty repository folder is docs, not a backend', (t) => {
  const dir = repo(t, { '.gitignore': '*.log\n' });
  assert.notEqual(projectFacts(dir).kind, 'backend');
});

test('#84 runDefaultsWith: a docs project gets no UI folders, no screenshots and no E2E tests', (t) => {
  const dir = repo(t, { 'README.md': '# Notes\n', LICENSE: 'MIT\n' });
  const d = runDefaultsWith({ project: { folder: dir }, profile: { tests: 'unit-e2e', e2eCommand: 'npx playwright test' } });
  assert.equal(d.kind, 'docs');
  assert.deepEqual(d.ui_folders, []);
  assert.equal(d.screenshots, 'off');
  assert.equal(d.e2e_tests, 'off');
  assert.equal(d.e2e_command, '');
});

test('#84 the docs kind is a project kind with its label in English and Portuguese', () => {
  assert.equal(KINDS.includes('docs'), true);
  assert.equal(OnboardingModel.PROJECT_KINDS.includes('docs'), true);
  const key = OnboardingModel.KIND_LABELS.docs;
  assert.equal(typeof key, 'string');
  assert.equal(typeof en[key], 'string');
  assert.equal(typeof ptBR[key], 'string');
  assert.doesNotMatch(en[key], /backend/i);
});
