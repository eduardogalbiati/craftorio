// #371: the pure core of the project city, packages/shared/city-model.js (dual load: module.exports in
// Node). It takes a city plan and #356's facts (the model of packages/shared/architecture-model.js) and
// returns { model, validation }:
// - model: { zones, districts, buildings, landmarks, ports, edges }, each building
//   { path, district, lines, churn, complexity, worst, functions, lastChange }; complexity, worst and
//   functions are null ("not measured") unless a real tool measured them;
// - validation: { coverage (share 0..1 of the drawn files matched), matched, drawn, unmatched (the
//   first 30, sorted), emptyDistricts, smallDistricts (ids), unknownZones ([{ district, zone }]),
//   duplicateIds, missingPaths (landmark and port paths not tracked at the commit), schemaErrors }.
// buildCity({ plan, facts, tracked }) with plan null groups files by folder: top-level folders are
// zones, their subfolders districts (id = the folder path), a district under 3 files folds into its
// parent. CITY_PLAN_SCHEMA is the plan's JSON Schema, checked with validateSchema (#338).
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildModel } = require('@multiagent/shared/architecture-model');
const { validateSchema } = require('@multiagent/engine/domains/workspace/json-schema');

const root = path.join(__dirname, '..');
const load = () => require('@multiagent/shared/city-model');

// ---------- the fixture: #356 facts of a small repository ----------

const hash = (n) => String(n).padStart(2, '0').repeat(20);
const at = (day) => `${day}T12:00:00Z`;

const FILES = [
  { path: 'README.md', lines: 4 },
  { path: 'docs/a.md', lines: 5 },
  { path: 'docs/b.md', lines: 5 },
  { path: 'docs/c.md', lines: 5 },
  { path: 'package.json', lines: 12 },
  { path: 'scripts/build.js', lines: 20 },
  { path: 'src/engine/gates.js', lines: 30 },
  { path: 'src/engine/queue.js', lines: 40 },
  { path: 'src/engine/run.js', lines: 100 },
  { path: 'src/renderer/app.js', lines: 60 },
  { path: 'src/renderer/views/board.js', lines: 25 },
  { path: 'src/renderer/views/kanban.js', lines: 25 },
  { path: 'src/renderer/views/list.js', lines: 25 },
  { path: 'src/shared/globs.js', lines: 15 },
  { path: 'tmp/scratch.txt', lines: 1 },
];

const COMMITS = [
  [hash(1), at('2026-01-05'), FILES.map((f) => ['A', f.path])],
  [hash(2), at('2026-02-01'), [['M', 'src/engine/run.js'], ['M', 'src/engine/queue.js']]],
  [hash(3), at('2026-03-01'), [['M', 'src/engine/run.js']]],
];

const LOG = [...COMMITS].reverse()
  .map(([h, date, changes]) => `\x01${h} ${date}\n\n${changes.map((c) => c.join('\t')).join('\n')}\n`)
  .join('\n');

const COMPLEXITY = {
  tool: 'lizard',
  metric: 'cyclomatic',
  functions: [
    { file: 'src/engine/run.js', name: 'start', line: 1, complexity: 12, length: 40 },
    { file: 'src/engine/run.js', name: 'stop', line: 50, complexity: 3, length: 10 },
    { file: 'src/engine/queue.js', name: 'push', line: 1, complexity: 2, length: 8 },
  ],
};

function facts({ files = FILES, complexity = COMPLEXITY } = {}) {
  return buildModel({
    head: { commit: hash(3), date: at('2026-03-01') },
    branch: 'main',
    shallow: false,
    window: { since: null, until: null },
    files: files.map((f) => ({ ...f })),
    log: LOG,
    ignoreRevs: [],
    attributes: '',
    exclude: [],
    includeMass: true,
    complexity,
  });
}

function plan(extra = {}) {
  return {
    version: 1,
    project: 'fixture',
    summary: 'A small fixture repository.',
    ignore: ['/tmp/**'],
    zones: [
      { id: 'core', name: 'Core', kind: 'industrial', purpose: 'Runs the work.' },
      { id: 'ui', name: 'UI', kind: 'commercial', purpose: 'What people see.' },
      { id: 'books', name: 'Books', kind: 'library', purpose: 'Docs and project files.' },
    ],
    districts: [
      { id: 'engine', name: 'Engine', zone: 'core', purpose: 'The engine.', include: ['/src/engine/**'], exclude: [] },
      { id: 'views', name: 'Views', zone: 'ui', purpose: 'The views.', include: ['/src/renderer/views/**'], exclude: [] },
      { id: 'renderer', name: 'Renderer', zone: 'ui', purpose: 'The rest of the UI.', include: ['/src/renderer/**'], exclude: [] },
      { id: 'docs', name: 'Docs', zone: 'books', purpose: 'Markdown.', include: ['*.md'], exclude: [] },
      { id: 'root', name: 'Root', zone: 'books', purpose: 'Root files.', include: ['/*'], exclude: [] },
    ],
    landmarks: [{ path: 'src/engine/run.js', label: 'The run loop' }],
    ports: [{ id: 'cli', name: 'CLI', via: ['package.json'] }],
    evidence: ['README.md'],
    ...extra,
  };
}

const city = (input = {}) => load().buildCity({ plan: plan(), facts: facts(), ...input });
const building = (model, file) => model.buildings.find((b) => b.path === file);
const districtOf = (model, file) => { const b = building(model, file); return b ? b.district : undefined; };

// ---------- the plan's schema ----------

test('#371 CITY_PLAN_SCHEMA accepts a complete plan', () => {
  const { CITY_PLAN_SCHEMA } = load();
  assert.deepEqual(validateSchema(plan(), CITY_PLAN_SCHEMA), []);
});

test('#371 CITY_PLAN_SCHEMA rejects a zone kind outside the nine kinds', () => {
  const { CITY_PLAN_SCHEMA } = load();
  const bad = plan({ zones: [{ id: 'core', name: 'Core', kind: 'castle', purpose: 'x' }] });
  assert.ok(validateSchema(bad, CITY_PLAN_SCHEMA).length > 0);
});

test('#371 CITY_PLAN_SCHEMA accepts each of the nine zone kinds', () => {
  const { CITY_PLAN_SCHEMA } = load();
  const kinds = ['campus', 'civic', 'commercial', 'industrial', 'infrastructure', 'library', 'logistics', 'power', 'workshop'];
  const zones = kinds.map((kind) => ({ id: kind, name: kind, kind, purpose: 'x' }));
  assert.deepEqual(validateSchema(plan({ zones }), CITY_PLAN_SCHEMA), []);
});

// ---------- with a plan: the golden model ----------

test('#371 with a plan every drawn file gets the district of the first matching rule (golden model)', () => {
  const { model } = city();
  const of = Object.fromEntries(model.buildings.map((b) => [b.path, b.district]));
  assert.deepEqual(of, {
    'README.md': 'docs',
    'docs/a.md': 'docs',
    'docs/b.md': 'docs',
    'docs/c.md': 'docs',
    'package.json': 'root',
    'scripts/build.js': 'outskirts',
    'src/engine/gates.js': 'engine',
    'src/engine/queue.js': 'engine',
    'src/engine/run.js': 'engine',
    'src/renderer/app.js': 'renderer',
    'src/renderer/views/board.js': 'views',
    'src/renderer/views/kanban.js': 'views',
    'src/renderer/views/list.js': 'views',
    'src/shared/globs.js': 'outskirts',
  });
  const zoneOf = Object.fromEntries(model.districts.map((d) => [d.id, d.zone]));
  assert.equal(zoneOf.engine, 'core');
  assert.equal(zoneOf.views, 'ui');
  assert.equal(zoneOf.renderer, 'ui');
  assert.equal(zoneOf.docs, 'books');
  assert.deepEqual(model.zones.map((z) => z.id).filter((id) => ['books', 'core', 'ui'].includes(id)).sort(), ['books', 'core', 'ui']);
});

test('#371 unmatched files go to an Outskirts district', () => {
  const { model } = city();
  const outskirts = model.districts.find((d) => d.id === 'outskirts');
  assert.ok(outskirts, 'an outskirts district');
  assert.equal(outskirts.name, 'Outskirts');
});

test('#371 the plan\'s ignore drops files from the city', () => {
  const { model, validation } = city();
  assert.equal(building(model, 'tmp/scratch.txt'), undefined);
  assert.equal(validation.drawn, 14);
});

test('#371 a building carries its lines, churn, last change and measured complexity', () => {
  const f = facts();
  const { model } = load().buildCity({ plan: plan(), facts: f });
  const run = building(model, 'src/engine/run.js');
  assert.equal(run.district, 'engine');
  assert.equal(run.lines, 100);
  // created in commit 1, modified in 2 and 3: #356 does not count the creating commit
  assert.equal(run.churn, 2);
  assert.equal(run.complexity, 15);
  assert.equal(run.worst, 12);
  assert.equal(run.functions, 2);
  assert.equal(run.lastChange, f.files.find((r) => r.file === 'src/engine/run.js').last_change);
  assert.ok(String(run.lastChange).startsWith('2026-03-01'), `last change ${run.lastChange}`);
});

test('#371 without a complexity tool, complexity, worst and functions are null and named "not measured"', () => {
  const out = load().buildCity({ plan: plan(), facts: facts({ complexity: null }) });
  const run = building(out.model, 'src/engine/run.js');
  assert.equal(run.complexity, null);
  assert.equal(run.worst, null);
  assert.equal(run.functions, null);
  assert.match(JSON.stringify(out), /not measured/);
});

// ---------- glob semantics ----------

test('#371 globs: "/*" matches only root files', () => {
  const { model } = city();
  assert.equal(districtOf(model, 'package.json'), 'root');
  assert.notEqual(districtOf(model, 'scripts/build.js'), 'root');
  assert.notEqual(districtOf(model, 'src/shared/globs.js'), 'root');
});

test('#371 globs: a pattern without a slash matches at any depth', () => {
  const { model } = city();
  assert.equal(districtOf(model, 'README.md'), 'docs');
  assert.equal(districtOf(model, 'docs/b.md'), 'docs');
});

test('#371 globs: "**" crosses folders and a leading "/" anchors to the root', () => {
  const p = plan({
    districts: [
      { id: 'views', name: 'Views', zone: 'ui', purpose: 'x', include: ['/renderer/**'], exclude: [] },
      { id: 'all-js', name: 'All JS', zone: 'core', purpose: 'x', include: ['/src/**/*.js'], exclude: ['/src/shared/**'] },
    ],
  });
  const { model } = load().buildCity({ plan: p, facts: facts() });
  // '/renderer/**' is anchored: it does not match src/renderer/...
  assert.equal(districtOf(model, 'src/renderer/views/board.js'), 'all-js');
  assert.equal(districtOf(model, 'src/engine/run.js'), 'all-js');
  // the district's exclude keeps a file out of it
  assert.equal(districtOf(model, 'src/shared/globs.js'), 'outskirts');
});

test('#371 globs: the first district whose rules match wins', () => {
  const p = plan({
    districts: [
      { id: 'renderer', name: 'Renderer', zone: 'ui', purpose: 'x', include: ['/src/renderer/**'], exclude: [] },
      { id: 'views', name: 'Views', zone: 'ui', purpose: 'x', include: ['/src/renderer/views/**'], exclude: [] },
    ],
  });
  const { model } = load().buildCity({ plan: p, facts: facts() });
  assert.equal(districtOf(model, 'src/renderer/views/list.js'), 'renderer');
  assert.equal(districtOf(model, 'src/renderer/app.js'), 'renderer');
});

// ---------- without a plan: folder districts ----------

test('#371 without a plan, top-level folders are zones and their subfolders districts', () => {
  const { model } = load().buildCity({ plan: null, facts: facts() });
  assert.equal(districtOf(model, 'src/engine/run.js'), 'src/engine');
  assert.equal(districtOf(model, 'src/renderer/views/board.js'), 'src/renderer');
  assert.equal(districtOf(model, 'src/renderer/app.js'), 'src/renderer');
  const engine = model.districts.find((d) => d.id === 'src/engine');
  assert.ok(engine, 'a src/engine district');
  assert.equal(engine.zone, 'src');
  assert.ok(model.zones.some((z) => z.id === 'src'), 'a src zone');
  assert.ok(model.zones.some((z) => z.id === 'docs'), 'a docs zone');
});

test('#371 without a plan, a district with fewer than 3 files folds into its parent', () => {
  const { model } = load().buildCity({ plan: null, facts: facts() });
  assert.equal(districtOf(model, 'src/shared/globs.js'), 'src');
  assert.equal(model.districts.some((d) => d.id === 'packages/shared'), false);
});

test('#371 without a plan, every drawn file is a building', () => {
  const { model } = load().buildCity({ plan: null, facts: facts() });
  assert.equal(model.buildings.length, FILES.length);
});

// ---------- validation ----------

test('#371 validation: the share of drawn files matched', () => {
  const { validation } = city();
  assert.equal(validation.drawn, 14);
  assert.equal(validation.matched, 12);
  assert.ok(Math.abs(validation.coverage - 12 / 14) < 0.001, `coverage ${validation.coverage}`);
  assert.deepEqual(validation.unmatched, ['scripts/build.js', 'src/shared/globs.js']);
});

test('#371 validation: only the first 30 unmatched files are listed', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ path: `misc/f${String(i).padStart(2, '0')}.txt`, lines: 1 }));
  const { validation } = load().buildCity({ plan: plan(), facts: facts({ files: [...FILES, ...many] }) });
  assert.equal(validation.unmatched.length, 30);
  assert.equal(validation.unmatched[0], 'misc/f00.txt');
  assert.equal(validation.matched, 12);
  assert.equal(validation.drawn, 54);
});

test('#371 validation: districts with no files and with fewer than 3', () => {
  const p = plan();
  p.districts.push({ id: 'ghost', name: 'Ghost', zone: 'core', purpose: 'x', include: ['/nothing/**'], exclude: [] });
  const { validation } = load().buildCity({ plan: p, facts: facts() });
  assert.ok(validation.emptyDistricts.includes('ghost'), 'ghost is empty');
  assert.ok(validation.smallDistricts.includes('root'), 'root has 1 file');
  assert.ok(validation.smallDistricts.includes('renderer'), 'renderer has 1 file');
  assert.equal(validation.smallDistricts.includes('engine'), false);
  assert.equal(validation.emptyDistricts.includes('engine'), false);
});

test('#371 validation: a district in an unknown zone', () => {
  const p = plan();
  p.districts[0] = { ...p.districts[0], zone: 'nowhere' };
  const { validation } = load().buildCity({ plan: p, facts: facts() });
  assert.ok(validation.unknownZones.some((u) => u.district === 'engine' && u.zone === 'nowhere'), JSON.stringify(validation.unknownZones));
});

test('#371 validation: duplicate zone and district ids', () => {
  const p = plan();
  p.zones.push({ id: 'core', name: 'Core again', kind: 'power', purpose: 'x' });
  p.districts.push({ id: 'docs', name: 'Docs again', zone: 'books', purpose: 'x', include: ['/docs/**'], exclude: [] });
  const { validation } = load().buildCity({ plan: p, facts: facts() });
  assert.ok(validation.duplicateIds.includes('core'), JSON.stringify(validation.duplicateIds));
  assert.ok(validation.duplicateIds.includes('docs'), JSON.stringify(validation.duplicateIds));
});

test('#371 validation: landmark and port paths missing at the commit', () => {
  const p = plan({
    landmarks: [{ path: 'src/engine/run.js', label: 'ok' }, { path: 'src/gone.js', label: 'gone' }],
    ports: [{ id: 'cli', name: 'CLI', via: ['package.json', 'bin/missing.js'] }],
  });
  const tracked = FILES.map((f) => f.path);
  const { validation } = load().buildCity({ plan: p, facts: facts(), tracked });
  assert.ok(validation.missingPaths.includes('src/gone.js'), JSON.stringify(validation.missingPaths));
  assert.ok(validation.missingPaths.includes('bin/missing.js'), JSON.stringify(validation.missingPaths));
  assert.equal(validation.missingPaths.includes('src/engine/run.js'), false);
  assert.equal(validation.missingPaths.includes('package.json'), false);
});

test('#371 validation: schema errors of the plan', () => {
  const p = plan({ zones: [{ id: 'core', name: 'Core', kind: 'castle', purpose: 'x' }] });
  const { validation } = load().buildCity({ plan: p, facts: facts() });
  assert.ok(Array.isArray(validation.schemaErrors) && validation.schemaErrors.length > 0, JSON.stringify(validation.schemaErrors));
});

test('#371 validation: a clean plan has no schema errors, unknown zones or duplicates', () => {
  const { validation } = city();
  assert.deepEqual(validation.schemaErrors, []);
  assert.deepEqual(validation.unknownZones, []);
  assert.deepEqual(validation.duplicateIds, []);
  assert.deepEqual(validation.missingPaths, []);
});

test('#371 landmarks and ports of the plan are in the model', () => {
  const { model } = city();
  assert.deepEqual(model.landmarks.map((l) => l.path), ['src/engine/run.js']);
  assert.deepEqual(model.ports.map((p) => p.id), ['cli']);
});

// ---------- determinism ----------

test('#371 the same facts and plan give the same model, with sorted keys', () => {
  const a = JSON.stringify(city());
  const b = JSON.stringify(city());
  assert.equal(a, b);
  const out = city();
  const keys = Object.keys(out.model);
  assert.deepEqual(keys, [...keys].sort());
  const bkeys = Object.keys(out.model.buildings[0]);
  assert.deepEqual(bkeys, [...bkeys].sort());
  const vkeys = Object.keys(out.validation);
  assert.deepEqual(vkeys, [...vkeys].sort());
});

test('#371 the order of the facts\' files does not change the model', () => {
  const f = facts();
  const reversed = { ...f, files: [...f.files].reverse() };
  const a = JSON.stringify(load().buildCity({ plan: plan(), facts: f }));
  const b = JSON.stringify(load().buildCity({ plan: plan(), facts: reversed }));
  assert.equal(a, b);
});

test('#371 city-model.js is pure: no I/O, no clock, no randomness', () => {
  const src = fs.readFileSync(path.join(root, 'packages', 'shared', 'city-model.js'), 'utf8');
  for (const banned of ["require('fs')", "require('child_process')", "require('net')", "require('http')", "require('https')", 'Date.now', 'new Date(', 'Math.random']) {
    assert.equal(src.includes(banned), false, `city-model.js uses ${banned}`);
  }
});
