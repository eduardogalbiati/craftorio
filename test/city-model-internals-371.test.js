// #371: internals of src/shared/city-model.js the acceptance tests do not reach: the relative
// specifiers of an import line, root files without a plan, a district in an unknown zone, the edges
// from the sources (JavaScript files, Cargo workspace dependencies) and without them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCity, importSpecs, ROOT } = require('../src/shared/city-model');

const row = (file, lines = 10, language = 'JavaScript') => ({ file, lines, language, commits: 1, last_change: '2026-01-05T12:00:00Z', complexity: null, worst: null, functions: null });
const facts = (rows) => ({ files: rows, head: { commit: 'abc', date: '2026-01-05T12:00:00Z' }, complexity: { status: 'missing', reason: 'no tool' } });
const plan = (districts, zones = [{ id: 'core', name: 'Core', kind: 'industrial', purpose: 'x' }]) => ({ version: 1, project: 'demo', zones, districts });

test('#371 importSpecs reads relative require, import, from and dynamic import; never a package', () => {
  assert.deepEqual(importSpecs("const a = require('./a'); import b from \"../b.js\"; import './c.css'; const d = import('./d'); require('fs');"), ['./a', '../b.js', './c.css', './d']);
});

test('#371 without a plan, root files form the root zone and district', () => {
  const { model } = buildCity({ plan: null, facts: facts([row('README.md', 3, 'Markdown'), row('src/a.js')]) });
  assert.equal(model.buildings.find((b) => b.path === 'README.md').district, ROOT);
  assert.ok(model.zones.some((z) => z.id === ROOT && z.kind === 'civic'));
  assert.equal(model.grouping, 'folders');
});

test('#371 a district in an unknown zone is drawn in the outskirts zone', () => {
  const { model, validation } = buildCity({ plan: plan([{ id: 'x', name: 'X', zone: 'nowhere', include: ['**'] }]), facts: facts([row('a.js')]) });
  assert.equal(model.districts.find((d) => d.id === 'x').zone, 'outskirts');
  assert.ok(model.zones.some((z) => z.id === 'outskirts'));
  assert.deepEqual(validation.unknownZones, [{ district: 'x', zone: 'nowhere' }]);
});

test('#371 a malformed plan is still drawn and its schema errors listed', () => {
  const bad = { version: 1, project: 'demo', zones: [null, { id: 'core', name: 'Core', kind: 'industrial' }], districts: [42, { id: 'x', name: 'X', zone: 'core', include: ['**'] }], landmarks: 'none' };
  const { model, validation } = buildCity({ plan: bad, facts: facts([row('a.js')]) });
  assert.equal(model.buildings[0].district, 'x');
  assert.ok(validation.schemaErrors.length >= 3, JSON.stringify(validation.schemaErrors));
});

test('#371 without sources the edges are not read, named by the main code language', () => {
  const { model } = buildCity({ plan: null, facts: facts([row('docs/a.md', 900, 'Markdown'), row('lib/a.py', 10, 'Python')]) });
  assert.equal(model.edges, 'not read for Python');
});

test('#371 JavaScript edges resolve index files and skip files outside the city', () => {
  const rows = [row('src/a.js'), row('src/lib/index.js'), row('src/b.ts', 5, 'TypeScript')];
  const sources = { imports: [{ from: 'src/a.js', text: "require('./lib'); require('./b'); require('../../outside')" }, { from: 'gone.js', text: "require('./src/a')" }], manifests: {} };
  const { model } = buildCity({ plan: null, facts: facts(rows), sources });
  assert.deepEqual(model.edges.map((e) => `${e.from}>${e.to}`), ['src/a.js>src/b.ts', 'src/a.js>src/lib/index.js']);
  assert.ok(model.edges.every((e) => e.kind === 'file'));
});

test('#371 Rust edges follow [workspace.dependencies] paths to the owning district', () => {
  const rows = [row('crates/app/src/main.rs', 5, 'Rust'), row('crates/engine/src/lib.rs', 5, 'Rust')];
  const manifests = {
    'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n\n[workspace.dependencies]\nengine-core = { path = "crates/engine" }\n',
    'crates/app/Cargo.toml': '[package]\nname = "app"\n\n[dependencies]\nengine-core.workspace = true\nlog = "0.4"\n',
    'crates/engine/Cargo.toml': '[package]\nname = "engine-core"\n',
  };
  const p = plan([
    { id: 'app', name: 'App', zone: 'core', include: ['/crates/app/**'] },
    { id: 'engine', name: 'Engine', zone: 'core', include: ['/crates/engine/**'] },
  ]);
  const { model } = buildCity({ plan: p, facts: facts(rows), sources: { imports: [], manifests } });
  assert.deepEqual(model.edges, [{ crates: ['engine-core'], from: 'app', kind: 'district', to: 'engine' }]);
});
