// The builder blocked a one-line text change on Next.js advisories already on the base, and the
// developer's fix round upgraded Next 13 to 16, React 19 and ESLint 9 unasked, which broke the build
// (exploratory run 20261126-093438-c0cc08cc). The build step now blocks only on what the change brings
// (a vulnerability already on the base goes in `preexisting_vulnerabilities`), and its fix round never
// upgrades a dependency across a major version unless the task asks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../packages/engine/engine/run/load');

const root = path.join(__dirname, '..');
const WORKFLOWS = ['workflows/feature.yaml', 'workflows/refactor.yaml', '.craftorio/workflows/ai-development-local-hero.yaml', '.craftorio/workflows/ai-development-remote-hero.yaml'];

for (const rel of WORKFLOWS) {
  test(`${rel}: the build blocks only on vulnerabilities the change brings, and its fix never upgrades a major version`, () => {
    const wf = loadWorkflow(path.join(root, rel));
    const build = wf.steps.find((s) => s.id === 'build');
    assert.ok(build, 'a build step');
    assert.match(build.prompt, /preexisting_vulnerabilities/, 'the prompt sends what the base already had apart');
    assert.match(build.prompt, /never blocks this run/, 'a preexisting vulnerability never blocks');
    assert.equal(build.output_schema.properties.preexisting_vulnerabilities?.type, 'string');
    for (const t of build.transitions || []) {
      if (t.delegate) assert.match(t.delegate.prompt, /Never upgrade a dependency across a major version|no dependency upgrade/, 'the fix round upgrades no major version (a refactor upgrades none)');
    }
  });
}

test('the dependency audit policy says what the change brings blocks, and fixes never cross a major version', () => {
  const text = fs.readFileSync(path.join(root, 'skills/dependency-audit-policy/SKILL.md'), 'utf8');
  assert.match(text, /already on the base[\s\S]*never blocks the run/);
  assert.match(text, /Never upgrade across a major version/);
});
