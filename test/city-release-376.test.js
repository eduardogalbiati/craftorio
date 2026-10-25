// #376: a release on the project city (#373), packages/shared/city-release.js. Pure (no fs, child_process,
// Date.now, new Date(), Math.random, fetch), dual-loaded like packages/shared/city-impact.js
// (module.exports in Node, window.CityRelease in the browser). No model call. Exports:
// - parseNameStatus(text): text = the output of `git diff --name-status -M <from> <to>` (tab-separated
//   lines, LF or CRLF) → [{ status, path, from? }] sorted by path: `A\tp` → 'added'; `M\tp` and `T\tp`
//   → 'changed'; `D\tp` → 'removed'; `R087\told\tnew` → { status: 'renamed', from: 'old', path: 'new' };
//   `C075\tsrc\tnew` → 'added' with path new. Backslashes become '/'. null or '' → [].
// - ADDED_COLOUR (a colour string); CHANGE_RAMP (at least 3 distinct colour strings, light to strong,
//   none equal to ADDED_COLOUR); rampColour(lines, maxLines) → always an element of CHANGE_RAMP:
//   rampColour(1, 100) is the first, rampColour(100, 100) and rampColour(500, 100) the last, the index
//   is non-decreasing as lines grow; maxLines 0 or missing does not throw and returns a ramp element.
// - releaseOverlay(changes [{ status, path, from?, lines }]) → { highlight: { path: colour }, ghosts:
//   [path] } for CityLayout.applyOverlay(layout, { highlight }): added → ADDED_COLOUR; changed →
//   rampColour(lines, the max lines over the changed and renamed entries); renamed → coloured as
//   changed but on its base building, highlight[from]; removed → in ghosts (sorted), never in
//   highlight. Unchanged paths are absent (applyOverlay greys them).
// - issuesOf(message) → the sorted unique issue numbers written `#n`.
// - filterByIssue(changes, commits [{ commit, subject, issues, files }], issue) → the changes whose path
//   (or `from` for a rename) is among the files of a commit whose issues include `issue`; issue
//   null/undefined → every change; an issue no commit names → [].
// - releaseModel(baseModel, changes, { plan }) → a new city model (the input untouched): the base model
//   plus one building per added file not in the base, in the first plan district whose rules match
//   (CityModel.applyPlan), lines = the change's lines; removed files keep their base building.
// - releaseHeader(layout, changes) → { counts: { added, changed, removed, renamed }, districts: [{ id,
//   name, count }], zones: [{ id, name, count }] }: counts over every change by status; districts and
//   zones count the changes whose drawn building (path; `from` for a rename) is a building of the
//   layout, sorted by count desc then id.
// - captionText({ project, from, to, counts }) → one line naming the project, both tags and the
//   non-zero counts as '<n> added', '<n> changed', '<n> removed', '<n> renamed'.
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildModel } = require('@multiagent/shared/architecture-model');

const root = path.join(__dirname, '..');
const FILE = path.join(root, 'packages', 'shared', 'city-release.js');
const load = () => require('@multiagent/shared/city-release.js');
const loadLayout = () => require('@multiagent/shared/city-layout.js');
const loadModel = () => require('@multiagent/shared/city-model.js');
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---------- the module ----------

test('#376 city-release.js loads in Node and, in the browser, defines window.CityRelease', () => {
  const api = load();
  for (const name of ['parseNameStatus', 'rampColour', 'releaseOverlay', 'issuesOf', 'filterByIssue', 'releaseModel', 'releaseHeader', 'captionText']) {
    assert.equal(typeof api[name], 'function', name);
  }
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-release.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  assert.equal(typeof sandbox.window.CityRelease?.releaseOverlay, 'function');
  assert.equal(typeof sandbox.window.CityRelease?.parseNameStatus, 'function');
});

test('#376 city-release.js is pure: no I/O, no clock, no randomness, no model call', () => {
  const src = fs.readFileSync(FILE, 'utf8');
  for (const banned of ["require('fs')", "require('child_process')", "require('net')", "require('http')", "require('https')", 'Date.now', 'new Date()', 'Math.random', 'fetch(']) {
    assert.equal(src.includes(banned), false, `city-release.js uses ${banned}`);
  }
});

// ---------- parseNameStatus ----------

test('#376 parseNameStatus: added, changed (M and T), removed, renamed and copied, sorted by path, CRLF and backslashes', () => {
  const { parseNameStatus } = load();
  const text = 'M\tsrc/b.js\r\nA\tsrc\\new.js\r\nD\tsrc/old.js\r\nR087\tsrc/moved.js\tlib/moved.js\r\nT\tsrc/link.js\r\nC075\tsrc/b.js\tsrc/copy.js\r\n';
  assert.deepEqual(plain(parseNameStatus(text)), [
    { status: 'renamed', from: 'src/moved.js', path: 'lib/moved.js' },
    { status: 'changed', path: 'src/b.js' },
    { status: 'added', path: 'src/copy.js' },
    { status: 'changed', path: 'src/link.js' },
    { status: 'added', path: 'src/new.js' },
    { status: 'removed', path: 'src/old.js' },
  ]);
});

test('#376 parseNameStatus: no output → no change', () => {
  const { parseNameStatus } = load();
  assert.deepEqual(plain(parseNameStatus(null)), []);
  assert.deepEqual(plain(parseNameStatus('')), []);
  assert.deepEqual(plain(parseNameStatus('A\tx.js\n')), [{ status: 'added', path: 'x.js' }]);
});

// ---------- colours ----------

test('#376 ADDED_COLOUR and CHANGE_RAMP: a colour for new files and at least three distinct change colours', () => {
  const { ADDED_COLOUR, CHANGE_RAMP } = load();
  assert.equal(typeof ADDED_COLOUR, 'string');
  const ramp = Array.from(CHANGE_RAMP);
  assert.ok(ramp.length >= 3, `CHANGE_RAMP has ${ramp.length} colours`);
  for (const c of ramp) assert.equal(typeof c, 'string');
  assert.equal(new Set(ramp).size, ramp.length, 'distinct colours');
  assert.equal(ramp.includes(ADDED_COLOUR), false, 'the added colour is not a change colour');
});

test('#376 rampColour: one line is the lightest, the max and more the strongest, non-decreasing in between', () => {
  const { rampColour, CHANGE_RAMP } = load();
  const ramp = Array.from(CHANGE_RAMP);
  assert.equal(rampColour(1, 100), ramp[0]);
  assert.equal(rampColour(100, 100), ramp[ramp.length - 1]);
  assert.equal(rampColour(500, 100), ramp[ramp.length - 1]);
  let last = 0;
  for (let n = 1; n <= 100; n++) {
    const i = ramp.indexOf(rampColour(n, 100));
    assert.ok(i >= 0, `rampColour(${n}, 100) is a ramp colour`);
    assert.ok(i >= last, `rampColour(${n}, 100) does not go back down the ramp`);
    last = i;
  }
});

test('#376 rampColour: a max of 0 or none does not throw and gives a ramp colour', () => {
  const { rampColour, CHANGE_RAMP } = load();
  const ramp = Array.from(CHANGE_RAMP);
  assert.ok(ramp.includes(rampColour(0, 0)));
  assert.ok(ramp.includes(rampColour(5, 0)));
  assert.ok(ramp.includes(rampColour(5)));
});

// ---------- releaseOverlay ----------

test('#376 releaseOverlay: added green, changed and renamed on the ramp (renamed on its base building), removed as ghosts', () => {
  const { releaseOverlay, ADDED_COLOUR, CHANGE_RAMP } = load();
  const ramp = Array.from(CHANGE_RAMP);
  const out = plain(releaseOverlay([
    { status: 'added', path: 'src/fresh.js', lines: 1000 },
    { status: 'changed', path: 'src/engine/big.js', lines: 1 },
    { status: 'renamed', from: 'src/engine/small.js', path: 'lib/small.js', lines: 100 },
    { status: 'removed', path: 'src/z.js', lines: 2000 },
    { status: 'removed', path: 'docs/a.md', lines: 5 },
  ]));
  // #438: the overlay may carry more (the rename sign): highlight and ghosts are checked on their own
  assert.deepEqual(out.highlight, {
    'src/fresh.js': ADDED_COLOUR,
    'src/engine/big.js': ramp[0],
    'src/engine/small.js': ramp[ramp.length - 1],
  });
  assert.deepEqual(out.ghosts, ['docs/a.md', 'src/z.js']);
});

test('#376 releaseOverlay: no change → nothing highlighted, no ghost', () => {
  const { releaseOverlay } = load();
  const out = plain(releaseOverlay([]));
  assert.deepEqual(out.highlight, {});
  assert.deepEqual(out.ghosts, []);
});

// ---------- issuesOf, filterByIssue ----------

test('#376 issuesOf: the sorted unique issue numbers a message names', () => {
  const { issuesOf } = load();
  assert.deepEqual(plain(issuesOf('Fix the gate (#12), see #7 and #12')), [7, 12]);
  assert.deepEqual(plain(issuesOf('no reference')), []);
  assert.deepEqual(plain(issuesOf('#abc')), []);
});

const CHANGES = [
  { status: 'added', path: 'src/new.js', lines: 5 },
  { status: 'changed', path: 'src/edit.js', lines: 4 },
  { status: 'removed', path: 'src/old.js', lines: 2 },
  { status: 'renamed', from: 'src/moved.js', path: 'lib/moved.js', lines: 0 },
];
const COMMITS = [
  { commit: 'a'.repeat(40), subject: 'Add the new module (#12)', issues: [12], files: ['src/new.js'] },
  { commit: 'b'.repeat(40), subject: 'Remove old, edit (#13)', issues: [13], files: ['src/edit.js', 'src/old.js'] },
  { commit: 'c'.repeat(40), subject: 'Move moved.js (#12)', issues: [12], files: ['src/moved.js'] },
];

test('#376 filterByIssue: the changes of the commits naming the issue, a rename matched by its old path', () => {
  const { filterByIssue } = load();
  assert.deepEqual(plain(filterByIssue(CHANGES, COMMITS, 12)).map((c) => c.path).sort(), ['lib/moved.js', 'src/new.js']);
  assert.deepEqual(plain(filterByIssue(CHANGES, COMMITS, 13)).map((c) => c.path).sort(), ['src/edit.js', 'src/old.js']);
});

test('#376 filterByIssue: no issue → every change; an issue no commit names → none', () => {
  const { filterByIssue } = load();
  assert.equal(filterByIssue(CHANGES, COMMITS, null).length, 4);
  assert.equal(filterByIssue(CHANGES, COMMITS, undefined).length, 4);
  assert.equal(filterByIssue(CHANGES, COMMITS, 99).length, 0);
});

// ---------- a small real city (#371's model, #373's layout) ----------

const hash = '01'.repeat(20);
const FILES = [
  { path: 'README.md', lines: 4 }, { path: 'docs/a.md', lines: 5 }, { path: 'package.json', lines: 12 },
  { path: 'src/engine/big.js', lines: 400 }, { path: 'src/engine/small.js', lines: 20 },
  { path: 'src/renderer/app.js', lines: 60 }, { path: 'src/renderer/views/board.js', lines: 25 },
  { path: 'src/renderer/views/list.js', lines: 25 },
];
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
const baseModel = () => plain(loadModel().buildCity({ plan: plain(PLAN), facts: facts() }).model);
const layout = () => loadLayout().layoutCity(baseModel());

// ---------- releaseModel ----------

test('#376 releaseModel: an added file gets a building in the first plan district that matches', () => {
  const { releaseModel } = load();
  const model = releaseModel(baseModel(), [{ status: 'added', path: 'src/renderer/views/fresh.js', lines: 30 }], { plan: plain(PLAN) });
  const b = plain(model).buildings.find((x) => x.path === 'src/renderer/views/fresh.js');
  assert.ok(b, 'a building for the added file');
  assert.equal(b.district, 'views');
  assert.equal(b.lines, 30);
  const drawn = plain(loadLayout().layoutCity(model)).buildings.find((x) => x.path === 'src/renderer/views/fresh.js');
  assert.ok(drawn, 'the layout draws it');
  assert.equal(drawn.district, 'views');
});

test('#376 releaseModel: the base model is untouched and a removed file keeps its building', () => {
  const { releaseModel } = load();
  const base = baseModel();
  const before = JSON.stringify(base);
  const model = plain(releaseModel(base, [
    { status: 'added', path: 'src/engine/made.js', lines: 8 },
    { status: 'removed', path: 'docs/a.md', lines: 5 },
  ], { plan: plain(PLAN) }));
  assert.equal(JSON.stringify(base), before, 'the input is not mutated');
  assert.equal(model.buildings.length, FILES.length + 1);
  assert.ok(model.buildings.some((x) => x.path === 'docs/a.md'), 'the removed file is still drawn (as a ghost)');
});

test('#376 releaseModel: an added file already in the base is not drawn twice', () => {
  const { releaseModel } = load();
  const model = plain(releaseModel(baseModel(), [{ status: 'added', path: 'src/engine/big.js', lines: 400 }], { plan: plain(PLAN) }));
  assert.equal(model.buildings.filter((x) => x.path === 'src/engine/big.js').length, 1);
});

// ---------- releaseHeader ----------

test('#376 releaseHeader: counts by status, and by district and zone over the drawn buildings (a rename on its old path)', () => {
  const { releaseHeader } = load();
  const out = plain(releaseHeader(layout(), [
    { status: 'changed', path: 'src/engine/big.js', lines: 40 },
    { status: 'changed', path: 'src/renderer/app.js', lines: 4 },
    { status: 'removed', path: 'docs/a.md', lines: 5 },
    { status: 'renamed', from: 'src/engine/small.js', path: 'lib/small.js', lines: 0 },
    { status: 'added', path: 'tools/gen.py', lines: 3 },
  ]));
  assert.deepEqual(out, {
    counts: { added: 1, changed: 2, removed: 1, renamed: 1 },
    districts: [{ id: 'engine', name: 'Engine', count: 2 }, { id: 'docs', name: 'Docs', count: 1 }, { id: 'renderer', name: 'Renderer', count: 1 }],
    zones: [{ id: 'core', name: 'Core', count: 2 }, { id: 'books', name: 'Books', count: 1 }, { id: 'ui', name: 'UI', count: 1 }],
  });
});

test('#376 releaseHeader: no change → zero counts', () => {
  const { releaseHeader } = load();
  assert.deepEqual(plain(releaseHeader(layout(), [])), { counts: { added: 0, changed: 0, removed: 0, renamed: 0 }, districts: [], zones: [] });
});

// ---------- the overlay on the city ----------

test('#376 releaseOverlay feeds CityLayout.applyOverlay: changed buildings coloured, the rest grey', () => {
  const { releaseOverlay } = load();
  const { highlight } = plain(releaseOverlay([{ status: 'changed', path: 'src/engine/big.js', lines: 10 }]));
  const out = plain(loadLayout().applyOverlay(layout(), { highlight }));
  const big = out.buildings.find((b) => b.path === 'src/engine/big.js');
  const small = out.buildings.find((b) => b.path === 'src/engine/small.js');
  assert.equal(big.colour, highlight['src/engine/big.js']);
  assert.equal(big.greyed, false);
  assert.equal(small.greyed, true);
});

// ---------- captionText ----------

test('#376 captionText: one line with the project, both tags and the non-zero counts', () => {
  const { captionText } = load();
  const line = captionText({ project: 'shop-api', from: '1.1.1', to: '1.1.2', counts: { added: 1, changed: 2, removed: 1, renamed: 0 } });
  assert.equal(typeof line, 'string');
  assert.equal(/\n/.test(line), false, 'a single line');
  for (const part of ['shop-api', '1.1.1', '1.1.2', '1 added', '2 changed', '1 removed']) assert.ok(line.includes(part), `"${line}" names ${part}`);
  assert.equal(line.includes('renamed'), false, 'a zero count is left out');
});
