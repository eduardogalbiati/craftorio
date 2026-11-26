// #41 (review, iteration 3): a manifest entry's optional `description_key`, the catalog key of its
// `description` (the Workflows screen and the assign dialog show it in the interface language).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseManifest } = require('../../domains/project/project-manifest');

test('#41 a manifest entry keeps its description_key', () => {
  const m = parseManifest('workflows:\n  - name: hero\n    file: workflows/hero.yaml\n    description: Mine\n    description_key: workflow_texts.hero_manifest_description\n');
  assert.deepEqual(m.errors, []);
  assert.equal(m.workflows[0].description_key, 'workflow_texts.hero_manifest_description');
});

test('#41 an entry without description_key has none', () => {
  const m = parseManifest('workflows:\n  - name: fix\n    description: Mine\n');
  assert.equal('description_key' in m.workflows[0], false);
});

test("#41 this repository's hero entries name catalog keys that exist in both languages", () => {
  const root = path.join(__dirname, '..', '..', '..', '..');
  const m = parseManifest(fs.readFileSync(path.join(root, '.craftorio', 'project.yaml'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'shared', 'i18n', 'en.json'), 'utf8'));
  const pt = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'shared', 'i18n', 'pt-BR.json'), 'utf8'));
  const heroes = m.workflows.filter((w) => /hero/.test(w.name));
  assert.equal(heroes.length, 2);
  for (const w of heroes) {
    assert.equal(en[w.description_key], w.description);
    assert.ok(pt[w.description_key] && pt[w.description_key] !== w.description);
  }
});
