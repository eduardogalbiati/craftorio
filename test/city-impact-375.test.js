// #375: an issue's impact preview on the project city, src/shared/city-impact.js. Pure, dual-loaded
// like src/shared/city-agents.js (module.exports in Node, window.CityImpact in the browser). No model
// call. Exports:
// - citedPaths(body) → the sorted, de-duplicated repository-relative paths (forward slashes, a leading
//   './' dropped) an issue body cites, in backticks or in plain text: `path:line` and `path:line:col`
//   give the path; trailing punctuation (. , ; : )) is dropped; globs (any of * ? { [) are ignored;
//   URLs (http/https, github.com links included) and issue refs (#373) are ignored; null or '' → [].
//   A path is a token with a slash whose file name has an extension, or a root file name with an
//   extension written in backticks (`README.md`); a folder (no extension) is not a path.
// - expectedFiles({ body, poFiles, changed, files, plan }) → { files: [{ path, sources }],
//   newFiles: [{ path, sources, district, note }] }. `files` = the repository's paths (the city's drawn
//   files); sources = the sorted subset of ['changed', 'cited', 'po'] (cited = citedPaths(body), po =
//   the Product Owner's group's files, changed = what a run really changed); a path from several
//   sources appears once with all of them. A path absent from `files` goes to newFiles with district =
//   the id of the first plan district whose include globs match and exclude globs do not (#371's
//   CITY_PLAN_SCHEMA, the app's glob rules) and note 'new file, expected in <district name>', or
//   district null and note 'new file' when none matches or there is no plan. Both lists sorted by path.
// - SOURCE_COLOURS { cited, po, changed }: three distinct colour strings; overlayOf(preview) →
//   { highlight: { path: colour } } for CityLayout.applyOverlay: each expected file (not the new
//   files) gets the colour of its strongest source (changed > po > cited).
// - impactHeader(layout, paths, { quadrants }) → { total, districts: [{ id, name, count }],
//   zones: [{ id, name, count }], dangerShare } over the paths that are buildings of the layout
//   (CityLayout.layoutCity of CityModel.buildCity(...).model; other paths are not counted); counts
//   sorted by count desc then id; dangerShare = the share (0..1) of those paths whose quadrants[path]
//   is 'Danger Zone' (ArchitectureModel.QUADRANTS[0]), 0 for no path.
// - stageFootprint(items [{ id, files }]) → { colours: { itemId: colour }, highlight: { path: colour },
//   conflicts: [{ path, items }] }: each item its own distinct colour; a path two items or more share
//   is CONFLICT_COLOUR (an exported red, no item's colour) in highlight and listed in conflicts
//   (sorted by path, item ids sorted); an item with no files is fine; an item listing a path twice
//   does not conflict with itself (#150: the items of one stage share no files).
// - predictedVsActual(predicted, changed) → { hit, missed, unexpected, hitRate }: hit = predicted ∩
//   changed, missed = predicted − changed, unexpected = changed − predicted (each sorted and
//   de-duplicated); hitRate = hit.length / the number of distinct predicted paths, null when nothing
//   was predicted.
// - recordHitRate(history, issue, { hitRate, ts, run }) → a new history { [issue]: [{ hitRate, ts,
//   run }] } with the entry added, the input untouched; entries kept in ts order; the same run
//   recorded again replaces its entry; other issues are kept as they are.
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildModel } = require('../src/shared/architecture-model');

const root = path.join(__dirname, '..');
const FILE = path.join(root, 'src', 'shared', 'city-impact.js');
const load = () => require('../src/shared/city-impact.js');
const loadLayout = () => require('../src/shared/city-layout.js');
const loadModel = () => require('../src/shared/city-model.js');
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---------- the module ----------

test('#375 city-impact.js loads in Node and, in the browser, defines window.CityImpact', () => {
  const api = load();
  for (const name of ['citedPaths', 'expectedFiles', 'overlayOf', 'impactHeader', 'stageFootprint', 'predictedVsActual', 'recordHitRate']) {
    assert.equal(typeof api[name], 'function', name);
  }
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'city-impact.js' });
  assert.equal(typeof sandbox.window.CityImpact?.citedPaths, 'function');
  assert.equal(typeof sandbox.window.CityImpact?.stageFootprint, 'function');
});

test('#375 city-impact.js is pure: no I/O, no clock, no randomness, no model call', () => {
  const src = fs.readFileSync(FILE, 'utf8');
  for (const banned of ["require('fs')", "require('child_process')", "require('net')", "require('http')", "require('https')", 'Date.now', 'new Date()', 'Math.random', 'fetch(']) {
    assert.equal(src.includes(banned), false, `city-impact.js uses ${banned}`);
  }
});

// ---------- citedPaths ----------

test('#375 citedPaths: reads the paths written in backticks', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths('Edit `src/shared/city-layout.js` and `src/renderer/views/project/project-city.js`.')), ['src/renderer/views/project/project-city.js', 'src/shared/city-layout.js']);
});

test('#375 citedPaths: file:line and file:line:col give the file', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths('The bug is at `src/a.js:12`, see also src/b.js:3:7 and `lib/c.ts:40:2`')), ['lib/c.ts', 'src/a.js', 'src/b.js']);
});

test('#375 citedPaths: reads plain-text paths and drops trailing punctuation', () => {
  const { citedPaths } = load();
  const body = 'See src/x/y.js, docs/screens/backlog.md. Also (src/z.ts); then src/w.css: done';
  assert.deepEqual(plain(citedPaths(body)), ['docs/screens/backlog.md', 'src/w.css', 'src/x/y.js', 'src/z.ts']);
});

test('#375 citedPaths: ignores globs', () => {
  const { citedPaths } = load();
  const body = 'Rules: `src/**/*.js`, src/renderer/*.css, `test/city-?.test.js`, `src/{a,b}.js`, `src/[ab].js`; the real one is `src/real.js`';
  assert.deepEqual(plain(citedPaths(body)), ['src/real.js']);
});

test('#375 citedPaths: ignores URLs, github.com links included, and issue refs', () => {
  const { citedPaths } = load();
  const body = 'From https://github.com/owner/repo/blob/main/src/x.js#L10 and http://example.com/a/b.html, after #373 and #374 (`https://github.com/o/r/pull/12`)';
  assert.deepEqual(plain(citedPaths(body)), []);
});

test('#375 citedPaths: a root file counts in backticks only', () => {
  const { citedPaths } = load();
  const body = 'Update `README.md` and `package.json`; e.g. the README.md prose and node.js are not paths';
  assert.deepEqual(plain(citedPaths(body)), ['README.md', 'package.json']);
});

test('#375 citedPaths: a folder without a file name is not a path', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths('Everything under src/renderer/ and `src/shared` moves')), []);
});

test('#375 citedPaths: drops a leading ./, de-duplicates and sorts', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths('Fix ./src/b.js then `./src/a.js`, src/b.js again and src/a.js:4')), ['src/a.js', 'src/b.js']);
});

test('#375 citedPaths: no body cites nothing', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths(null)), []);
  assert.deepEqual(plain(citedPaths(undefined)), []);
  assert.deepEqual(plain(citedPaths('')), []);
  assert.deepEqual(plain(citedPaths('Just prose, nothing to touch.')), []);
});

test('#375 citedPaths: a markdown link to a file cites the path in its text', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths('See [src/a.js](https://github.com/o/r/blob/main/src/a.js) first')), ['src/a.js']);
  assert.deepEqual(plain(citedPaths('[`src/b.js:12`](https://github.com/o/r/blob/main/src/b.js#L12), then [the docs](docs/x.md)')), ['src/b.js']);
});

test('#375 citedPaths: a markdown image cites nothing', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths('Before: ![the city](https://github.com/o/r/assets/1/shot.png)')), []);
  assert.deepEqual(plain(citedPaths('![diagram](docs/img/city.png)')), []);
});

// ---------- a small real city (#371's model, #373's layout) ----------

const hash = '01'.repeat(20);
const FILES = [
  { path: 'README.md', lines: 4 }, { path: 'docs/a.md', lines: 5 }, { path: 'package.json', lines: 12 },
  { path: 'src/engine/big.js', lines: 400 }, { path: 'src/engine/small.js', lines: 20 },
  { path: 'src/renderer/app.js', lines: 60 }, { path: 'src/renderer/views/board.js', lines: 25 },
  { path: 'src/renderer/views/list.js', lines: 25 },
];
const REPO = FILES.map((f) => f.path);
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});
const PLAN = {
  version: 1, project: 'fixture', summary: 'A fixture.', ignore: [],
  zones: [{ id: 'core', name: 'Core', kind: 'industrial', purpose: 'x' }, { id: 'ui', name: 'UI', kind: 'commercial', purpose: 'x' }, { id: 'books', name: 'Books', kind: 'library', purpose: 'x' }],
  districts: [
    { id: 'engine', name: 'Engine', zone: 'core', purpose: 'x', include: ['/src/engine/**'], exclude: [] },
    { id: 'views', name: 'Views', zone: 'ui', purpose: 'x', include: ['/src/renderer/views/**'], exclude: [] },
    { id: 'renderer', name: 'Renderer', zone: 'ui', purpose: 'x', include: ['/src/renderer/**'], exclude: [] },
    { id: 'docs', name: 'Docs', zone: 'books', purpose: 'x', include: ['*.md'], exclude: [] },
    { id: 'root', name: 'Root', zone: 'books', purpose: 'x', include: ['/*'], exclude: [] },
  ],
  landmarks: [], ports: [], evidence: [],
};
const layout = () => loadLayout().layoutCity(loadModel().buildCity({ plan: plain(PLAN), facts: facts() }).model);

// ---------- expectedFiles ----------

test('#375 expectedFiles: a file from several sources appears once with all of them, sorted', () => {
  const { expectedFiles } = load();
  const out = plain(expectedFiles({
    body: 'Change `src/engine/big.js` and src/renderer/app.js:10',
    poFiles: ['src/engine/big.js', 'docs/a.md'],
    changed: ['src/engine/big.js'],
    files: REPO, plan: plain(PLAN),
  }));
  assert.deepEqual(out, {
    files: [
      { path: 'docs/a.md', sources: ['po'] },
      { path: 'src/engine/big.js', sources: ['changed', 'cited', 'po'] },
      { path: 'src/renderer/app.js', sources: ['cited'] },
    ],
    newFiles: [],
  });
});

test('#375 expectedFiles: a cited file the repository lacks is a new file expected in the first matching district', () => {
  const { expectedFiles } = load();
  const out = plain(expectedFiles({ body: 'Add `src/renderer/views/fresh.js` and docs/new.md', poFiles: [], changed: [], files: REPO, plan: plain(PLAN) }));
  assert.deepEqual(out.files, []);
  assert.deepEqual(out.newFiles, [
    { path: 'docs/new.md', sources: ['cited'], district: 'docs', note: 'new file, expected in Docs' },
    { path: 'src/renderer/views/fresh.js', sources: ['cited'], district: 'views', note: 'new file, expected in Views' },
  ]);
});

test('#375 expectedFiles: a district\'s exclude globs are respected for a new file', () => {
  const { expectedFiles } = load();
  const plan = {
    ...plain(PLAN),
    districts: [
      { id: 'engine', name: 'Engine', zone: 'core', purpose: 'x', include: ['/src/engine/**'], exclude: ['/src/engine/legacy/**'] },
      { id: 'sources', name: 'Sources', zone: 'core', purpose: 'x', include: ['/src/**'], exclude: [] },
    ],
  };
  const out = plain(expectedFiles({ body: '', poFiles: ['src/engine/legacy/old.js'], changed: [], files: REPO, plan }));
  assert.deepEqual(out.newFiles, [{ path: 'src/engine/legacy/old.js', sources: ['po'], district: 'sources', note: 'new file, expected in Sources' }]);
});

test('#375 expectedFiles: a new file no district matches, or without a plan, is just a new file', () => {
  const { expectedFiles } = load();
  const matched = plain(expectedFiles({ body: 'Add `tools/gen.py`', poFiles: [], changed: [], files: REPO, plan: plain(PLAN) }));
  assert.deepEqual(matched.newFiles, [{ path: 'tools/gen.py', sources: ['cited'], district: null, note: 'new file' }]);
  const noPlan = plain(expectedFiles({ body: 'Add `src/engine/fresh.js`', poFiles: [], changed: [], files: REPO, plan: null }));
  assert.deepEqual(noPlan.newFiles, [{ path: 'src/engine/fresh.js', sources: ['cited'], district: null, note: 'new file' }]);
});

test('#375 expectedFiles: the files a run changed are always listed, new ones included', () => {
  const { expectedFiles } = load();
  const out = plain(expectedFiles({ body: null, poFiles: [], changed: ['src/engine/small.js', 'src/engine/made.js'], files: REPO, plan: plain(PLAN) }));
  assert.deepEqual(out.files, [{ path: 'src/engine/small.js', sources: ['changed'] }]);
  assert.deepEqual(out.newFiles, [{ path: 'src/engine/made.js', sources: ['changed'], district: 'engine', note: 'new file, expected in Engine' }]);
});

test('#375 expectedFiles: nothing cited, proposed or changed → no file', () => {
  const { expectedFiles } = load();
  assert.deepEqual(plain(expectedFiles({ body: 'Prose only.', poFiles: [], changed: [], files: REPO, plan: plain(PLAN) })), { files: [], newFiles: [] });
});

// ---------- SOURCE_COLOURS, overlayOf ----------

test('#375 SOURCE_COLOURS: cited, po and changed have three distinct colours', () => {
  const { SOURCE_COLOURS } = load();
  for (const k of ['cited', 'po', 'changed']) assert.equal(typeof SOURCE_COLOURS[k], 'string', k);
  assert.equal(new Set([SOURCE_COLOURS.cited, SOURCE_COLOURS.po, SOURCE_COLOURS.changed]).size, 3);
});

test('#375 overlayOf: each expected building gets the colour of its strongest source; new files are not drawn', () => {
  const { overlayOf, SOURCE_COLOURS } = load();
  const preview = {
    files: [
      { path: 'docs/a.md', sources: ['cited'] },
      { path: 'src/engine/big.js', sources: ['changed', 'cited', 'po'] },
      { path: 'src/engine/small.js', sources: ['cited', 'po'] },
      { path: 'src/renderer/app.js', sources: ['po'] },
    ],
    newFiles: [{ path: 'src/engine/made.js', sources: ['changed'], district: 'engine', note: 'new file, expected in Engine' }],
  };
  const C = plain(SOURCE_COLOURS);
  assert.deepEqual(plain(overlayOf(preview)), {
    highlight: {
      'docs/a.md': C.cited,
      'src/engine/big.js': C.changed,
      'src/engine/small.js': C.po,
      'src/renderer/app.js': C.po,
    },
  });
});

test('#375 overlayOf: the highlight feeds CityLayout.applyOverlay, which greys the other buildings', () => {
  const { overlayOf, SOURCE_COLOURS } = load();
  const l = layout();
  const highlight = plain(overlayOf({ files: [{ path: 'src/engine/big.js', sources: ['cited'] }], newFiles: [] })).highlight;
  const out = plain(loadLayout().applyOverlay(l, { highlight, markers: [] }));
  const big = out.buildings.find((b) => b.path === 'src/engine/big.js');
  const small = out.buildings.find((b) => b.path === 'src/engine/small.js');
  assert.equal(big.colour, SOURCE_COLOURS.cited, 'the cited building has the cited colour');
  assert.equal(big.greyed, false);
  assert.equal(small.greyed, true, 'another building is grey');
});

// ---------- impactHeader ----------

test('#375 impactHeader: counts by district and by zone, sorted by count then id, and the Danger Zone share', () => {
  const { impactHeader } = load();
  const quadrants = { 'src/engine/big.js': 'Danger Zone', 'src/engine/small.js': 'Danger Zone', 'src/renderer/app.js': 'Cowboy Code', 'docs/a.md': 'Healthy Closure' };
  const out = plain(impactHeader(layout(), ['src/renderer/app.js', 'src/engine/big.js', 'docs/a.md', 'src/engine/small.js'], { quadrants }));
  assert.deepEqual(out, {
    total: 4,
    districts: [{ id: 'engine', name: 'Engine', count: 2 }, { id: 'docs', name: 'Docs', count: 1 }, { id: 'renderer', name: 'Renderer', count: 1 }],
    zones: [{ id: 'core', name: 'Core', count: 2 }, { id: 'books', name: 'Books', count: 1 }, { id: 'ui', name: 'UI', count: 1 }],
    dangerShare: 0.5,
  });
});

test('#375 impactHeader: a path that is not a building of the city is not counted', () => {
  const { impactHeader } = load();
  const out = plain(impactHeader(layout(), ['src/engine/big.js', 'src/engine/made.js'], { quadrants: { 'src/engine/big.js': 'Danger Zone', 'src/engine/made.js': 'Danger Zone' } }));
  assert.equal(out.total, 1);
  assert.deepEqual(out.districts, [{ id: 'engine', name: 'Engine', count: 1 }]);
  assert.equal(out.dangerShare, 1);
});

test('#375 impactHeader: no path → zero counts and a Danger Zone share of 0', () => {
  const { impactHeader } = load();
  assert.deepEqual(plain(impactHeader(layout(), [], { quadrants: {} })), { total: 0, districts: [], zones: [], dangerShare: 0 });
});

// ---------- stageFootprint ----------

test('#375 stageFootprint: items sharing no file each get their own colour, and no conflict', () => {
  const { stageFootprint, CONFLICT_COLOUR } = load();
  const out = plain(stageFootprint([{ id: 'it-a', files: ['src/a.js', 'src/b.js'] }, { id: 'it-b', files: ['src/c.js'] }]));
  assert.equal(typeof out.colours['it-a'], 'string');
  assert.equal(typeof out.colours['it-b'], 'string');
  assert.notEqual(out.colours['it-a'], out.colours['it-b']);
  assert.notEqual(out.colours['it-a'], CONFLICT_COLOUR);
  assert.notEqual(out.colours['it-b'], CONFLICT_COLOUR);
  assert.deepEqual(out.highlight, { 'src/a.js': out.colours['it-a'], 'src/b.js': out.colours['it-a'], 'src/c.js': out.colours['it-b'] });
  assert.deepEqual(out.conflicts, []);
});

test('#375 stageFootprint: a file two items or more would change is red and listed as a conflict', () => {
  const { stageFootprint, CONFLICT_COLOUR } = load();
  const out = plain(stageFootprint([
    { id: 'it-c', files: ['src/y.js', 'src/z.js'] },
    { id: 'it-a', files: ['src/x.js', 'src/y.js', 'src/w.js'] },
    { id: 'it-b', files: ['src/y.js', 'src/w.js'] },
  ]));
  assert.equal(out.highlight['src/y.js'], CONFLICT_COLOUR);
  assert.equal(out.highlight['src/w.js'], CONFLICT_COLOUR);
  assert.equal(out.highlight['src/x.js'], out.colours['it-a']);
  assert.equal(out.highlight['src/z.js'], out.colours['it-c']);
  assert.deepEqual(out.conflicts, [
    { path: 'src/w.js', items: ['it-a', 'it-b'] },
    { path: 'src/y.js', items: ['it-a', 'it-b', 'it-c'] },
  ]);
});

test('#375 stageFootprint: CONFLICT_COLOUR is a red', () => {
  const { CONFLICT_COLOUR } = load();
  assert.equal(typeof CONFLICT_COLOUR, 'string');
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(CONFLICT_COLOUR);
  assert.ok(m, `CONFLICT_COLOUR is a #rrggbb colour: ${CONFLICT_COLOUR}`);
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  assert.ok(r > 150 && r > g * 1.5 && r > b * 1.5, `${CONFLICT_COLOUR} is red`);
});

test('#375 stageFootprint: one item, an item with no files, or a file listed twice by one item → no conflict', () => {
  const { stageFootprint } = load();
  const one = plain(stageFootprint([{ id: 'only', files: ['src/a.js', 'src/a.js'] }]));
  assert.deepEqual(one.conflicts, []);
  assert.deepEqual(one.highlight, { 'src/a.js': one.colours.only });
  const empty = plain(stageFootprint([{ id: 'e', files: [] }, { id: 'f', files: ['src/b.js'] }]));
  assert.deepEqual(empty.conflicts, []);
  assert.equal(typeof empty.colours.e, 'string');
  assert.deepEqual(empty.highlight, { 'src/b.js': empty.colours.f });
  assert.deepEqual(plain(stageFootprint([])), { colours: {}, highlight: {}, conflicts: [] });
});

test('#375 stageFootprint: the conflict red is the agents overlay\'s collision red (#374)', () => {
  const { CONFLICT_COLOUR } = load();
  assert.equal(CONFLICT_COLOUR, require('../src/shared/city-agents.js').COLLISION_COLOUR);
});

test('#375 stageFootprint: works in the browser, loaded after city-agents.js', () => {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['city-agents.js', 'city-impact.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'src', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  const out = plain(sandbox.window.CityImpact.stageFootprint([
    { id: 'it-b', files: ['src/y.js'] },
    { id: 'it-a', files: ['src/x.js', 'src/y.js'] },
  ]));
  assert.deepEqual(out.conflicts, [{ path: 'src/y.js', items: ['it-a', 'it-b'] }]);
  assert.equal(out.highlight['src/y.js'], sandbox.window.CityAgents.COLLISION_COLOUR);
  assert.equal(out.highlight['src/x.js'], out.colours['it-a']);
  assert.equal(sandbox.window.CityImpact.CONFLICT_COLOUR, '#d7263d');
});

// ---------- predictedVsActual ----------

test('#375 predictedVsActual: changed as predicted, predicted but untouched, changed but not predicted, and the hit rate', () => {
  const { predictedVsActual } = load();
  assert.deepEqual(plain(predictedVsActual(['src/d.js', 'src/a.js', 'src/c.js', 'src/b.js'], ['src/e.js', 'src/d.js', 'src/b.js', 'src/e.js'])), {
    hit: ['src/b.js', 'src/d.js'],
    missed: ['src/a.js', 'src/c.js'],
    unexpected: ['src/e.js'],
    hitRate: 0.5,
  });
});

test('#375 predictedVsActual: nothing predicted → a null hit rate, every change unexpected', () => {
  const { predictedVsActual } = load();
  assert.deepEqual(plain(predictedVsActual([], ['src/b.js', 'src/a.js'])), { hit: [], missed: [], unexpected: ['src/a.js', 'src/b.js'], hitRate: null });
});

test('#375 predictedVsActual: a path predicted twice counts once; all hit → 1, none hit → 0', () => {
  const { predictedVsActual } = load();
  assert.equal(predictedVsActual(['src/a.js', 'src/a.js'], ['src/a.js']).hitRate, 1);
  const none = plain(predictedVsActual(['src/a.js'], []));
  assert.deepEqual(none, { hit: [], missed: ['src/a.js'], unexpected: [], hitRate: 0 });
});

// ---------- recordHitRate ----------

test('#375 recordHitRate: adds an entry for the issue without touching the input', () => {
  const { recordHitRate } = load();
  const history = { 12: [{ hitRate: 1, ts: '2026-10-01T10:00:00.000Z', run: 'r-12' }] };
  const before = JSON.stringify(history);
  const out = plain(recordHitRate(history, 375, { hitRate: 0.5, ts: '2026-10-15T10:00:00.000Z', run: 'r-1' }));
  assert.equal(JSON.stringify(history), before, 'the input is not mutated');
  assert.deepEqual(out, {
    12: [{ hitRate: 1, ts: '2026-10-01T10:00:00.000Z', run: 'r-12' }],
    375: [{ hitRate: 0.5, ts: '2026-10-15T10:00:00.000Z', run: 'r-1' }],
  });
});

test('#375 recordHitRate: keeps an issue\'s entries in ts order', () => {
  const { recordHitRate } = load();
  let h = recordHitRate({}, 375, { hitRate: 0.5, ts: '2026-10-15T10:00:00.000Z', run: 'r-2' });
  h = recordHitRate(h, 375, { hitRate: 0.25, ts: '2026-10-14T10:00:00.000Z', run: 'r-1' });
  assert.deepEqual(plain(h)[375].map((e) => e.run), ['r-1', 'r-2']);
});

test('#375 recordHitRate: the same run recorded again replaces its entry', () => {
  const { recordHitRate } = load();
  let h = recordHitRate({}, 375, { hitRate: 0.5, ts: '2026-10-15T10:00:00.000Z', run: 'r-1' });
  h = recordHitRate(h, 375, { hitRate: 0.75, ts: '2026-10-15T11:00:00.000Z', run: 'r-1' });
  assert.deepEqual(plain(h), { 375: [{ hitRate: 0.75, ts: '2026-10-15T11:00:00.000Z', run: 'r-1' }] });
});
