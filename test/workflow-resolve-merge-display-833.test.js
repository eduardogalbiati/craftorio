// #833: the resolve_merge step is shown as "Resolve conflicts" (its `display`) in the bundled
// feature workflow and in the repo's two hero workflows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'workflows/feature.yaml',
  '.craftorio/workflows/ai-development-local-hero.yaml',
  '.craftorio/workflows/ai-development-remote-hero.yaml',
];

for (const file of FILES) {
  test(`${file}: the resolve_merge step's display is "Resolve conflicts"`, () => {
    const wf = yaml.load(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const step = (wf.steps || []).find((s) => s && s.id === 'resolve_merge');
    assert.ok(step, 'the workflow has a resolve_merge step');
    assert.equal(step.display, 'Resolve conflicts');
  });
}
