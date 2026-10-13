// #356: the pure core of the project's Architecture tab, src/shared/architecture-model.js (taken over
// from scripts/code-health.js, which then requires it). parseLog reads `git log --name-status`, median
// and sortKeys are helpers, placeQuadrants places rows on normalized log1p axes split at the medians
// (score = sqrt(u² + v²)), and buildModel turns the git facts of a project (files at head, the log,
// ignore-revs, .gitattributes, the exclude list, a window, measured complexity) into a deterministic
// model: per-file churn and hotspot rank, co-change pairs, languages, exclusions, mass changes.
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const load = () => require('../src/shared/architecture-model');

// ---------- the fixture ----------

const hash = (n) => String(n).padStart(2, '0').repeat(20); // 40 hex digits
const at = (day) => `${day}T12:00:00Z`;
const DOCS = Array.from({ length: 10 }, (_, i) => `docs/n${i + 1}.md`);

// oldest first: [hash, date, [[status, ...paths]]]
const COMMITS = [
  [hash(1), at('2026-01-05'), [
    ['A', 'src/app.js'], ['A', 'src/util.js'], ['A', 'lib/model.py'], ['A', 'lib/old_helper.py'], ['A', 'README.md'],
    ...DOCS.map((d) => ['A', d]),
    ['A', 'package-lock.json'], ['A', 'dist/bundle.js'], ['A', 'gen/parser.js'], ['A', 'third/vendor.js'],
  ]],
  [hash(2), at('2026-02-01'), [['M', 'src/app.js'], ['M', 'src/util.js'], ['M', 'lib/old_helper.py']]],
  [hash(3), at('2026-02-10'), [['M', 'src/app.js'], ['M', 'src/util.js']]],
  [hash(4), at('2026-03-01'), [['M', 'src/app.js'], ['M', 'src/util.js'], ['M', 'lib/model.py']]],
  [hash(5), at('2026-03-15'), [['M', 'src/app.js'], ['M', 'gen/parser.js'], ['M', 'third/vendor.js']]],
  [hash(6), at('2026-04-01'), [['R100', 'lib/old_helper.py', 'lib/helper.py']]],
  [hash(7), at('2026-04-05'), [['M', 'lib/helper.py']]],
  [hash(8), at('2026-04-10'), [['M', 'src/util.js']]],
  [hash(9), at('2026-04-12'), [['M', 'lib/model.py']]],
  [hash(10), at('2026-04-14'), [['M', 'lib/model.py']]],
  [hash(11), at('2026-04-20'), [['M', 'README.md'], ...DOCS.map((d) => ['M', d])]],
];

const LOG = [...COMMITS].reverse()
  .map(([h, date, changes]) => `\x01${h} ${date}\n\n${changes.map((c) => c.join('\t')).join('\n')}\n`)
  .join('\n');

const FILES = [
  { path: 'src/app.js', lines: 200 },
  { path: 'src/util.js', lines: 50 },
  { path: 'lib/model.py', lines: 120 },
  { path: 'lib/helper.py', lines: 30 },
  { path: 'README.md', lines: 10 },
  ...DOCS.map((d) => ({ path: d, lines: 5 })),
  { path: 'package-lock.json', lines: 9000 },
  { path: 'dist/bundle.js', lines: 5000 },
  { path: 'gen/parser.js', lines: 3000 },
  { path: 'third/vendor.js', lines: 2000 },
];

function sources(extra = {}) {
  return {
    head: { commit: hash(11), date: at('2026-04-20') },
    branch: 'main',
    shallow: false,
    window: { since: null, until: null },
    files: FILES.map((f) => ({ ...f })),
    log: LOG,
    ignoreRevs: [hash(8).slice(0, 8)],
    attributes: 'gen/** linguist-generated\nthird/** linguist-vendored\n',
    exclude: [],
    includeMass: true,
    ...extra,
  };
}

const build = (extra) => load().buildModel(sources(extra));
const row = (model, file) => model.files.find((f) => f.file === file);
const commitsOf = (model, file) => { const r = row(model, file); return r ? r.commits : undefined; };
const excludedSum = (model) => Object.values(model.excluded).reduce((s, n) => s + n, 0);

// ---------- parseLog, median, sortKeys ----------

test('#356 parseLog reads hashes, dates, statuses and paths, newest first, renames with both paths', () => {
  const text = `\x01${hash(2)} 2026-02-01T12:00:00Z\n\nM\tsrc/a.js\nR100\tlib/a.py\tlib/b.py\n\n\x01${hash(1)} 2026-01-01T12:00:00Z\n\nA\tsrc/a.js\nA\tlib/a.py\n`;
  const commits = load().parseLog(text);
  assert.deepEqual(commits.map((c) => c.hash), [hash(2), hash(1)]);
  assert.deepEqual(commits.map((c) => c.date), ['2026-02-01T12:00:00Z', '2026-01-01T12:00:00Z']);
  assert.deepEqual(commits[0].changes.map((c) => c.status), ['M', 'R']);
  assert.deepEqual(commits[0].changes[1].paths, ['lib/a.py', 'lib/b.py']);
  assert.deepEqual(commits[1].changes.map((c) => `${c.status}:${c.paths.join(',')}`), ['A:src/a.js', 'A:lib/a.py']);
});

test('#356 median: 0 for an empty list, the middle value, the mean of the two middle values', () => {
  const { median } = load();
  assert.equal(median([]), 0);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('#356 sortKeys sorts object keys deeply and keeps array order', () => {
  const sorted = load().sortKeys({ b: 1, a: { d: [{ z: 1, y: 2 }, 3], c: 2 } });
  assert.equal(JSON.stringify(sorted), '{"a":{"c":2,"d":[{"y":2,"z":1},3]},"b":1}');
});

// ---------- placeQuadrants ----------

test('#356 placeQuadrants: the worked example, normalized scores (b outranks a)', () => {
  const rows = [
    { file: 'a', complexity: 100, commits: 2 },
    { file: 'b', complexity: 10, commits: 20 },
    { file: 'c', complexity: 1, commits: 1 },
    { file: 'd', complexity: 2, commits: 1 },
  ];
  load().placeQuadrants(rows);
  assert.deepEqual(rows.map((r) => r.quadrant), ['Danger Zone', 'Danger Zone', 'Healthy Closure', 'Healthy Closure']);
  assert.deepEqual(rows.map((r) => r.score), [1.063, 1.127, 0.273, 0.329]);
  assert.ok(rows[1].score > rows[0].score, 'b ranks above a');
});

test('#356 placeQuadrants names the four quadrants: Cowboy Code is complex and rarely changed, Fertile Ground simple and changing', () => {
  const rows = [
    { file: 'danger', complexity: 200, commits: 50 },
    { file: 'cowboy', complexity: 200, commits: 1 },
    { file: 'fertile', complexity: 1, commits: 50 },
    { file: 'healthy', complexity: 1, commits: 1 },
  ];
  const { placeQuadrants, QUADRANTS } = load();
  placeQuadrants(rows);
  assert.deepEqual(QUADRANTS, ['Danger Zone', 'Cowboy Code', 'Fertile Ground', 'Healthy Closure']);
  assert.deepEqual(rows.map((r) => r.quadrant), ['Danger Zone', 'Cowboy Code', 'Fertile Ground', 'Healthy Closure']);
});

test('#356 placeQuadrants leaves a row with unknown commits without a quadrant', () => {
  const rows = [{ file: 'a', complexity: 5, commits: 3 }, { file: 'b', complexity: 2, commits: null }];
  load().placeQuadrants(rows);
  assert.equal(rows[1].quadrant, null);
});

// ---------- buildModel: churn ----------

test('#356 buildModel counts commits per file: creation not counted, ignore-revs skipped', () => {
  const model = build();
  assert.equal(commitsOf(model, 'src/app.js'), 4);
  assert.equal(commitsOf(model, 'src/util.js'), 3);
  assert.equal(commitsOf(model, 'lib/model.py'), 3);
  assert.equal(commitsOf(model, 'README.md'), 1);
  assert.deepEqual(DOCS.map((d) => commitsOf(model, d)), DOCS.map(() => 1));
});

test('#356 buildModel follows renames: the renamed file keeps its history and the old path has no row', () => {
  const model = build();
  assert.equal(commitsOf(model, 'lib/helper.py'), 3);
  assert.equal(row(model, 'lib/old_helper.py'), undefined);
});

test('#356 buildModel excludes lock files, dist/, linguist-generated and linguist-vendored files', () => {
  const model = build();
  for (const file of ['package-lock.json', 'dist/bundle.js', 'gen/parser.js', 'third/vendor.js']) {
    assert.equal(row(model, file), undefined, `${file} excluded`);
  }
  assert.equal(model.excluded.generated, 1);
  assert.equal(model.excluded.vendored, 1);
  assert.equal(excludedSum(model), 4);
});

test('#356 buildModel ranks hotspots by lines x commits', () => {
  const model = build();
  assert.equal(row(model, 'src/app.js').hotspot, 800);
  assert.equal(row(model, 'src/app.js').rank, 1);
  assert.equal(row(model, 'lib/model.py').hotspot, 360);
  assert.equal(row(model, 'lib/model.py').rank, 2);
  assert.equal(model.files[0].file, 'src/app.js');
});

test('#356 buildModel lists co-change pairs with share >= 0.6 and the top co-changing file per row', () => {
  const model = build();
  const pair = model.pairs.find((p) => p.a === 'src/app.js' && p.b === 'src/util.js');
  assert.ok(pair, 'src/app.js + src/util.js listed');
  assert.deepEqual({ together: pair.together, share: pair.share }, { together: 3, share: 1 });
  const loose = model.pairs.filter((p) => [p.a, p.b].includes('src/app.js') && [p.a, p.b].includes('lib/model.py'));
  assert.equal(loose.length, 0);
  assert.deepEqual(row(model, 'src/app.js').co_change, { file: 'src/util.js', share: 1 });
});

test('#356 buildModel counts lines per language, excluded files left out', () => {
  const model = build();
  assert.deepEqual(model.languages.slice(0, 2).map((l) => `${l.language}:${l.lines}`), ['JavaScript:250', 'Python:150']);
});

test('#356 buildModel lists mass changes (a commit touching more than 25% of the files)', () => {
  const model = build();
  assert.ok(model.mass_changes.some((m) => m.commit === hash(11)), 'c11 listed');
  assert.equal(model.mass_changes.some((m) => m.commit === hash(2)), false);
});

test('#356 buildModel with includeMass false skips mass changes in the counts', () => {
  const model = build({ includeMass: false });
  assert.equal(commitsOf(model, 'README.md'), 0);
  assert.deepEqual(DOCS.map((d) => commitsOf(model, d)), DOCS.map(() => 0));
  assert.equal(commitsOf(model, 'src/app.js'), 4);
});

test('#356 buildModel with a window counts only the commits inside it and echoes it', () => {
  const window = { since: '2026-03-01T00:00:00Z', until: null };
  const model = build({ window });
  assert.equal(commitsOf(model, 'src/app.js'), 2);
  assert.equal(commitsOf(model, 'src/util.js'), 1);
  assert.equal(model.window.since, '2026-03-01T00:00:00Z');
});

test('#356 buildModel honours the project exclude list', () => {
  const model = build({ exclude: ['docs/**'] });
  assert.equal(model.files.filter((f) => f.file.startsWith('docs/')).length, 0);
  assert.equal(excludedSum(model), 14);
});

test('#356 buildModel echoes head, branch and shallow', () => {
  const model = build({ shallow: true });
  assert.equal(model.shallow, true);
  assert.equal(model.head.commit, hash(11));
  assert.equal(model.branch, 'main');
  assert.equal(build().shallow, false);
});

// ---------- buildModel: determinism ----------

test('#356 buildModel is deterministic: two calls give the same JSON', () => {
  assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});

test('#356 buildModel returns sorted keys', () => {
  const model = build();
  assert.equal(JSON.stringify(model) === JSON.stringify(load().sortKeys(model)), true);
});

test('#356 buildModel holds no wall-clock timestamp', () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(JSON.stringify(build()).includes(today), false);
});

// ---------- buildModel: complexity ----------

test('#356 buildModel without complexity says it is missing and names the tools needed', () => {
  const model = build();
  assert.equal(model.complexity.status, 'missing');
  assert.ok(Array.isArray(model.complexity.needed) && model.complexity.needed.length > 0, 'needed is a non-empty list');
  assert.ok(model.complexity.needed.some((n) => /radon|lizard/.test(n)), 'a Python tool named');
});

test('#356 buildModel with measured complexity gives each file its sum, worst function and quadrant', () => {
  const complexity = {
    tool: 'lizard',
    metric: 'cyclomatic',
    functions: [
      { file: 'src/app.js', name: 'f1', line: 1, complexity: 3 },
      { file: 'src/app.js', name: 'f2', line: 20, complexity: 12 },
      { file: 'src/util.js', name: 'g', line: 1, complexity: 2 },
    ],
  };
  const model = build({ complexity });
  const { QUADRANTS } = load();
  assert.equal(model.complexity.status, 'measured');
  assert.equal(model.complexity.tool, 'lizard');
  const app = row(model, 'src/app.js');
  const util = row(model, 'src/util.js');
  assert.deepEqual({ complexity: app.complexity, worst: app.worst }, { complexity: 15, worst: 12 });
  assert.deepEqual({ complexity: util.complexity, worst: util.worst }, { complexity: 2, worst: 2 });
  assert.ok(QUADRANTS.includes(app.quadrant), `app quadrant ${app.quadrant}`);
  assert.ok(QUADRANTS.includes(util.quadrant), `util quadrant ${util.quadrant}`);
});

// ---------- purity and no copy ----------

test('#356 the core is pure: no fs, child_process, net or http, no clock, no random', () => {
  const text = fs.readFileSync(path.join(root, 'src', 'shared', 'architecture-model.js'), 'utf8');
  for (const mod of ['fs', 'child_process', 'net', 'http', 'https']) {
    const re = new RegExp(`require\\(\\s*['"](node:)?${mod}['"]\\s*\\)`);
    assert.equal(re.test(text), false, `requires ${mod}`);
  }
  assert.equal(text.includes('Date.now'), false, 'Date.now');
  assert.equal(text.includes('new Date('), false, 'new Date(');
  assert.equal(text.includes('Math.random'), false, 'Math.random');
});

test('#356 scripts/code-health.js requires the core instead of keeping its own copy', () => {
  const text = fs.readFileSync(path.join(root, 'scripts', 'code-health.js'), 'utf8');
  assert.equal(/require\(\s*['"]\.\.\/src\/shared\/architecture-model(\.js)?['"]\s*\)/.test(text), true, 'requires ../src/shared/architecture-model');
  for (const name of ['parseLog', 'median', 'placeQuadrants', 'sortKeys']) {
    assert.equal(text.includes(`function ${name}(`), false, `code-health.js still defines ${name}`);
  }
});
