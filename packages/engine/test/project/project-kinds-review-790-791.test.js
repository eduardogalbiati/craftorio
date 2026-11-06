// #790, #791: what the review found: the manifest's map has only the kinds with an entry of their own, a
// default or a kind cannot name an entry whose file has another name, and an old workflow name (an alias)
// reaches its file with the alias's inputs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DefaultWorkflow = require('@multiagent/shared/default-workflow');
const { parseManifest } = require('../../domains/project/project-manifest');
const productOwner = require('../../domains/po/product-owner');
const projects = require('../../domains/project/projects');

const task = { task: { type: 'string' } };
const LIST = 'workflows:\n  - { name: feature, category: solo }\n  - { name: fix, category: fix }\n  - { name: hero, category: solo, file: workflows/solo.yaml }\n  - { name: own, category: solo, file: workflows/own.yaml }\n';

test('#791 kinds.refactor is a manifest error: a refactor uses the Feature entry', () => {
  const m = parseManifest(`${LIST}kinds:\n  refactor: { name: fix }\n`);
  assert.equal(m.errors.length, 1);
  assert.match(m.errors[0], /kinds\.refactor/);
  assert.deepEqual([m.workflows, m.kinds], [[], {}]);
});

test('#791 a key that is no kind of the map is a manifest error too', () => {
  assert.match(parseManifest(`${LIST}kinds:\n  bug: { name: fix }\n`).errors[0], /kinds\.bug/);
});

test('#791 a project\'s map keeps only feature and fix', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'kinds-review-'));
  try {
    fs.writeFileSync(path.join(dir, 'demo.json'), JSON.stringify({ name: 'Demo', folder: dir }));
    const saved = projects.updateProject(dir, 'demo', { workflowKinds: { refactor: { name: 'fix' }, fix: { name: 'fix', inputs: {} } } });
    assert.deepEqual(Object.keys(saved.workflowKinds), ['fix']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#790 a default naming an entry whose file has another name is a manifest error', () => {
  const m = parseManifest(`${LIST}default: hero\n`);
  assert.equal(m.errors.length, 1);
  assert.match(m.errors[0], /default names "hero", whose file is workflows\/solo\.yaml/);
  assert.equal(m.default, null);
});

test('#791 a kind naming an entry whose file has another name is a manifest error', () => {
  const m = parseManifest(`${LIST}kinds:\n  fix: { name: hero }\n`);
  assert.match(m.errors[0], /kinds\.fix names "hero"/);
  assert.deepEqual(m.kinds, {});
});

test('#790 an entry named after its file, or without one, may be the default and a kind', () => {
  const m = parseManifest(`${LIST.replace('  - { name: hero, category: solo, file: workflows/solo.yaml }\n', '')}default: own\nkinds:\n  feature: { name: own }\n  fix: { name: fix, mode: remote }\n`);
  assert.deepEqual(m.errors, []);
  assert.equal(m.default, 'own');
  assert.deepEqual(m.kinds, { feature: { name: 'own', inputs: {} }, fix: { name: 'fix', inputs: { mode: 'remote' } } });
});

test('#790 an entry with another file name stays valid when no default or kind names it', () => {
  assert.deepEqual(parseManifest(LIST).errors, []);
});

test('#791 installedFile: an old name means its alias\'s file, its own copy first', () => {
  const { installedFile } = DefaultWorkflow;
  assert.equal(installedFile('ai-development-local-hero', ['fix.yaml', 'feature.yaml']), 'feature.yaml');
  assert.equal(installedFile('ai-development-local-hero', ['feature.yaml', 'ai-development-local-hero.yaml']), 'ai-development-local-hero.yaml');
  assert.equal(installedFile('ai-development-local-hero', ['fix.yaml']), null);
});

test('#791 kindTarget: the alias\'s inputs under the entry\'s, none for a copy of that very name', () => {
  const { kindTarget } = DefaultWorkflow;
  const entry = { name: 'ai-development-local-hero', inputs: { review: 'single' } };
  assert.deepEqual(kindTarget(entry, ['feature.yaml']), { file: 'feature.yaml', inputs: { mode: 'local', review: 'single' } });
  assert.deepEqual(kindTarget({ ...entry, inputs: { mode: 'remote' } }, ['feature.yaml']).inputs, { mode: 'remote' });
  assert.deepEqual(kindTarget(entry, ['workflows/ai-development-local-hero.yaml']), { file: 'workflows/ai-development-local-hero.yaml', inputs: { review: 'single' } });
  assert.deepEqual(kindTarget({ name: 'fix', inputs: { mode: 'remote' } }, ['fix.yaml']), { file: 'fix.yaml', inputs: { mode: 'remote' } });
  assert.deepEqual(kindTarget(null, ['fix.yaml']), { file: null, inputs: {} });
});

test('#791 a migrated default with an old name: the plan runs its file, in the alias\'s mode', () => {
  const FEATURE = { file: 'feature.yaml', name: 'feature', inputs: { ...task, mode: { type: 'enum', values: ['local', 'remote'] } } };
  const FIX = { file: 'fix.yaml', name: 'fix', inputs: task };
  const workflowKinds = { feature: { name: 'ai-development-local-hero', inputs: {} }, fix: { name: 'fix', inputs: {} } };
  const out = productOwner.normalizeAnswer(
    { summary: 's', groups: [{ name: 'g', issues: [1], workflow: 'fix.yaml', reason: 'r', stage: 1 }], conflicts: [], enrich: [] },
    { issues: [{ number: 1, state: 'open', title: 'One', labels: [] }], history: [], workflows: [FIX, FEATURE], workflowKinds },
  );
  assert.equal(out.groups[0].workflow, 'feature.yaml');
  assert.equal(out.groups[0].inputs.mode, 'local');
});
