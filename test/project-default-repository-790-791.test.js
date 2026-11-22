// #790, #791: what this repository itself declares and what its sources and docs no longer hold.
// Acceptance tests, written before the code.
// - .multiagent/project.yaml names its default and its map (`fix` in Remote mode: `main` is protected);
// - no production source reads settings.defaultWorkflow but the migration (a scan of packages/, fronts/
//   and apps/, tests and Playwright features left out; comments do not count: they read nothing);
// - CONTRIBUTING.md and docs/readme/040-workflows.md: a string check each, only for what a string can tell.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = () => require('@craftorio/engine/domains/project/project-manifest').readManifest(ROOT);
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

// where the migration may read the old value
const MIGRATION = new Set(['packages/engine/domains/workspace/workspace.js', 'packages/engine/service/areas/workspace.js']);
const NOT_SOURCE = new Set(['features', 'node_modules', 'test', 'dist', 'vendor']);
const READS_SETTING = /\bsettings\)?\??\.defaultWorkflow\b|readSettings\([^)]*\)\??\.defaultWorkflow\b/;

function sources(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return NOT_SOURCE.has(e.name) ? [] : sources(rel);
    return e.name.endsWith('.js') ? [rel] : [];
  });
}
const code = (text) => text.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

test('#790 this repository declares ai-development-remote-hero as its default', () => {
  const out = manifest();
  assert.deepEqual([out.default, out.errors], ['ai-development-remote-hero', []]);
});

test('#791 this repository\'s Feature is ai-development-remote-hero', () => {
  assert.deepEqual(manifest().kinds?.feature, { name: 'ai-development-remote-hero', inputs: {} });
});

test('#791 this repository\'s Fix is fix in Remote mode', () => {
  assert.deepEqual(manifest().kinds?.fix, { name: 'fix', inputs: { mode: 'remote' } });
});

test('#790 no production source reads settings.defaultWorkflow but the migration', () => {
  const readers = ['packages', 'fronts', 'apps'].flatMap(sources)
    .filter((f) => !MIGRATION.has(f) && READS_SETTING.test(code(read(f))));
  assert.deepEqual(readers, []);
});

test('#790 CONTRIBUTING.md no longer says to make the workflow the project\'s default by hand', () => {
  assert.doesNotMatch(read('CONTRIBUTING.md'), /make it the project's default/i);
});

test('#791 CONTRIBUTING.md says a bug fix lands here through fix in Remote mode', () => {
  assert.match(read('CONTRIBUTING.md'), /`fix`[^.]*\bremote\b|\bremote\b[^.]*`fix`/i);
});

test('#790 docs/readme/040-workflows.md names the manifest\'s default', () => {
  assert.match(read('docs', 'readme', '040-workflows.md'), /`default(: [^`]*)?`/);
});

test('#791 docs/readme/040-workflows.md names the kinds and the map', () => {
  assert.match(read('docs', 'readme', '040-workflows.md'), /`kinds(:[^`]*)?`/);
});
