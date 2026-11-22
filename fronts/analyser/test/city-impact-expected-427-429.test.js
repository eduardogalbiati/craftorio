// #427, #429: the paths an issue predicts, packages/shared/city-impact.js (the impact preview of #375).
// #427: a path cited with a line range (`path:12-30`, `path:12–30` with an en dash, `path:12-30:4`)
// gives the path, in backticks and in plain text, like `path:12` and `path:12:4`; a root file name in
// backticks counts only when the repository has it (`files` of expectedFiles): an id or a log name is
// not an expected file; a path under a folder the repository lacks is still a new file.
// #429: issues name their expected files in a `## Expected files` section (one path per line,
// "- `src/x.js`: why", a file to create marked `(new)`). Contract:
// - expectedSection(body) → null when the body has no `## Expected files` heading; otherwise the
//   sorted, de-duplicated paths listed in that section only (ranges and `(new)` dropped).
// - expectedFiles(...) adds the source 'expected' (the section's paths); SOURCE_COLOURS.expected is
//   its own colour; overlayOf's strength is changed > expected > po > cited.
// - predictedVsActual(predicted, changed): predicted may be [{ path, sources }]; the result adds
//   bySource: { [source]: { hit, missed } } (sorted paths), saying which source predicted each hit
//   and miss.
// - recordHitRate(history, issue, { hitRate, ts, run, withSection }) keeps withSection on the entry.
// - hitRateBySection(history) → { with: { average, issues }, without: { average, issues } }: each
//   issue counted once, by its latest entry (ts order) with a hit rate; an entry without the flag is
//   "without"; average null when no issue.
// New exports are read inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('@craftorio/shared/city-impact.js');
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---------- #427: line ranges ----------

test('#427 citedPaths: a path with a line range in backticks gives the path', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths('See `src/service/areas/runs.js:242-247` for the gap.')), ['src/service/areas/runs.js']);
});

test('#427 citedPaths: a path with a line range in plain text gives the path, trailing punctuation dropped', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths('The gap is in src/service/areas/runs.js:242-247, and src/a/b.js:1-2.')), ['src/a/b.js', 'src/service/areas/runs.js']);
});

test('#427 citedPaths: a range written with an en dash gives the path', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths('In backticks `src/a/b.js:12–30` and in prose src/c/d.js:12–30 too.')), ['src/a/b.js', 'src/c/d.js']);
});

test('#427 citedPaths: a range with a column (path:12-30:4) gives the path', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths('`src/a/b.js:12-30:4` and src/c/d.js:12-30:4')), ['src/a/b.js', 'src/c/d.js']);
});

test('#427 citedPaths: a file name ending in a digit keeps its digit when a range is dropped', () => {
  const { citedPaths } = load();
  assert.deepEqual(plain(citedPaths('`src/engine/part-3.js:1-2` and src/engine/v2.js:10–12')), ['src/engine/part-3.js', 'src/engine/v2.js']);
});

test('#427 citedPaths: the #426 body gives backlog-roadmap.js', () => {
  const { citedPaths } = load();
  const body = [
    '## Context',
    '',
    'The roadmap arrows (`src/renderer/views/backlog/backlog-roadmap.js:715-716`) skip a stage only when it is visible;',
    'the move menu (`src/renderer/views/backlog/backlog-roadmap.js:942-960`) and the stage list',
    '(`src/renderer/views/backlog/backlog-roadmap.js:1291-1300`) count hidden stages, and the arrow handler',
    '(`src/renderer/views/backlog/backlog-roadmap.js:1846-1852`) moves the item one stage at a time.',
    'The history file `1792597401661-0000.json` shows the move. `test/renderer-roadmap-stage-menu-282.test.js` covers the menu.',
    '',
    'Related: #282, #217',
  ].join('\n');
  const out = plain(citedPaths(body));
  assert.equal(out.includes('src/renderer/views/backlog/backlog-roadmap.js'), true, `got ${JSON.stringify(out)}`);
  assert.equal(out.includes('test/renderer-roadmap-stage-menu-282.test.js'), true);
  assert.equal(out.some((p) => /\d-\d+$|:\d/.test(p)), false, `no path keeps its range: ${JSON.stringify(out)}`);
});

test('#427 citedPaths: globs, URLs, issue refs and folders with a range are still not paths', () => {
  const { citedPaths } = load();
  const body = '`src/*.js:1-2`, https://github.com/o/r/blob/main/src/a/b.js:1-2, #426-#427, `apps/desktop/renderer:10-20` and src/renderer/views:3-4';
  assert.deepEqual(plain(citedPaths(body)), []);
});

// ---------- #427: root files the repository has ----------

test('#427 expectedFiles: a root file name in backticks the repository lacks is not an expected file', () => {
  const { expectedFiles } = load();
  const body = 'The history file `1792597401661-0000.json` shows it; `README.md` explains it.';
  const out = plain(expectedFiles({ body, files: ['README.md', 'src/a/b.js'] }));
  assert.deepEqual(out.files.map((f) => f.path), ['README.md']);
  assert.deepEqual(out.newFiles.map((f) => f.path), []);
});

test('#427 expectedFiles: a cited path under a folder the repository lacks is still a new file', () => {
  const { expectedFiles } = load();
  const out = plain(expectedFiles({ body: 'Create `src/brand-new/thing.js:1-10`.', files: ['src/a/b.js'] }));
  assert.deepEqual(out.newFiles.map((f) => f.path), ['src/brand-new/thing.js']);
  assert.equal(out.newFiles[0].note, 'new file');
});

// ---------- #429: the Expected files section ----------

const SECTION_BODY = [
  '## Context',
  '',
  'Evidence in `test/evidence-only.test.js:4` and src/context/read-only.js:10-20.',
  '',
  '## Expected files',
  '',
  '- `src/shared/city-impact.js`: the parser',
  '- `src/renderer/views/project/project-city-impact.js:120-140`: the legend row',
  '- `src/brand-new/module.js` (new): created by the change',
  '- `src/shared/city-impact.js`: listed twice',
  '',
  '## Tasks',
  '',
  '- [ ] Touch `src/tasks/not-in-section.js` as well',
].join('\n');

test('#429 expectedSection: lists the paths of the section only, sorted, ranges and (new) dropped', () => {
  const { expectedSection } = load();
  assert.equal(typeof expectedSection, 'function');
  assert.deepEqual(plain(expectedSection(SECTION_BODY)), [
    'src/brand-new/module.js',
    'src/renderer/views/project/project-city-impact.js',
    'src/shared/city-impact.js',
  ]);
});

test('#429 expectedSection: a body with CRLF line endings (edited on the web) is read the same', () => {
  const { expectedSection } = load();
  const body = '## Context\r\n\r\nSee `src/ctx/a.js`.\r\n\r\n## Expected files\r\n\r\n- `src/a.js`: why\r\n- `src/b/new.js` (new): created\r\n\r\n## Tasks\r\n\r\n- [ ] Touch `src/c.js`\r\n';
  assert.deepEqual(plain(expectedSection(body)), ['src/a.js', 'src/b/new.js']);
});

test('#429 expectedSection: a body without the section gives null', () => {
  const { expectedSection } = load();
  assert.equal(typeof expectedSection, 'function');
  assert.equal(expectedSection('## Context\n\nTouch `src/a/b.js`.\n\n## Tasks\n\n- [ ] Tests'), null);
  assert.equal(expectedSection(''), null);
  assert.equal(expectedSection(null), null);
});

test('#429 expectedFiles: the section\'s paths get the source "expected", the other cited ones do not', () => {
  const { expectedFiles } = load();
  const files = ['src/shared/city-impact.js', 'src/renderer/views/project/project-city-impact.js', 'test/evidence-only.test.js', 'src/context/read-only.js'];
  const out = plain(expectedFiles({ body: SECTION_BODY, files }));
  const sourcesOf = (p) => (out.files.find((f) => f.path === p) || { sources: [] }).sources;
  assert.equal(sourcesOf('src/shared/city-impact.js').includes('expected'), true);
  assert.equal(sourcesOf('src/renderer/views/project/project-city-impact.js').includes('expected'), true);
  assert.equal(sourcesOf('test/evidence-only.test.js').includes('expected'), false);
  assert.equal(sourcesOf('src/context/read-only.js').includes('expected'), false);
  assert.equal(sourcesOf('test/evidence-only.test.js').includes('cited'), true, 'evidence stays cited');
});

test('#429 expectedFiles: a (new) file of the section the repository lacks is a new file with the source "expected"', () => {
  const { expectedFiles } = load();
  const out = plain(expectedFiles({ body: SECTION_BODY, files: ['src/shared/city-impact.js'] }));
  const created = out.newFiles.find((f) => f.path === 'src/brand-new/module.js');
  assert.equal(Boolean(created), true, `newFiles: ${JSON.stringify(out.newFiles.map((f) => f.path))}`);
  assert.equal(created.sources.includes('expected'), true);
});

test('#429 expectedFiles: an issue without the section has no "expected" source, as today', () => {
  const { expectedFiles } = load();
  const out = plain(expectedFiles({ body: 'Touch `src/a/b.js`.', poFiles: ['src/c/d.js'], files: ['src/a/b.js', 'src/c/d.js'] }));
  assert.deepEqual(out.files.map((f) => [f.path, [...f.sources].sort()]), [['src/a/b.js', ['cited']], ['src/c/d.js', ['po']]]);
});

test('#429 SOURCE_COLOURS: "expected" has its own colour, distinct from cited, po and changed', () => {
  const { SOURCE_COLOURS } = load();
  assert.equal(typeof SOURCE_COLOURS.expected, 'string');
  assert.equal(new Set([SOURCE_COLOURS.cited, SOURCE_COLOURS.po, SOURCE_COLOURS.changed, SOURCE_COLOURS.expected]).size, 4);
});

test('#429 overlayOf: "expected" is stronger than po and cited, "changed" stays the strongest', () => {
  const { overlayOf, SOURCE_COLOURS } = load();
  const C = plain(SOURCE_COLOURS);
  const out = plain(overlayOf({ files: [
    { path: 'a/x.js', sources: ['cited', 'expected', 'po'] },
    { path: 'a/y.js', sources: ['changed', 'expected'] },
    { path: 'a/z.js', sources: ['expected'] },
    { path: 'a/w.js', sources: ['cited', 'po'] },
  ] }));
  assert.equal(typeof C.expected, 'string');
  assert.deepEqual(out.highlight, { 'a/x.js': C.expected, 'a/y.js': C.changed, 'a/z.js': C.expected, 'a/w.js': C.po });
});

// ---------- #429: the hit rate measures the section ----------

test('#429 predictedVsActual: says which source predicted each hit and miss', () => {
  const { predictedVsActual } = load();
  const predicted = [
    { path: 'src/a.js', sources: ['cited', 'expected'] },
    { path: 'src/b.js', sources: ['expected'] },
    { path: 'src/c.js', sources: ['cited'] },
    { path: 'src/d.js', sources: ['po'] },
  ];
  const out = plain(predictedVsActual(predicted, ['src/a.js', 'src/d.js', 'src/e.js']));
  assert.deepEqual(out.hit, ['src/a.js', 'src/d.js']);
  assert.deepEqual(out.missed, ['src/b.js', 'src/c.js']);
  assert.deepEqual(out.unexpected, ['src/e.js']);
  assert.equal(out.hitRate, 0.5);
  assert.deepEqual(out.bySource, {
    cited: { hit: ['src/a.js'], missed: ['src/c.js'] },
    expected: { hit: ['src/a.js'], missed: ['src/b.js'] },
    po: { hit: ['src/d.js'], missed: [] },
  });
});

test('#429 recordHitRate: keeps whether the issue had the Expected files section', () => {
  const { recordHitRate } = load();
  let h = recordHitRate({}, 426, { hitRate: 1, ts: '2026-10-21T10:00:00.000Z', run: 'r-1', withSection: true });
  h = recordHitRate(h, 422, { hitRate: 0.25, ts: '2026-10-21T11:00:00.000Z', run: 'r-2', withSection: false });
  const out = plain(h);
  assert.deepEqual(out['426'], [{ hitRate: 1, ts: '2026-10-21T10:00:00.000Z', run: 'r-1', withSection: true }]);
  assert.deepEqual(out['422'], [{ hitRate: 0.25, ts: '2026-10-21T11:00:00.000Z', run: 'r-2', withSection: false }]);
});

test('#429 hitRateBySection: the average hit rate of issues with the section against those without', () => {
  const { hitRateBySection } = load();
  assert.equal(typeof hitRateBySection, 'function');
  const history = {
    426: [{ hitRate: 1, ts: '2026-10-21T10:00:00.000Z', run: 'r-1', withSection: true }],
    427: [{ hitRate: 0.5, ts: '2026-10-21T11:00:00.000Z', run: 'r-2', withSection: true }],
    422: [{ hitRate: 0.25, ts: '2026-10-21T12:00:00.000Z', run: 'r-3', withSection: false }],
    375: [{ hitRate: 0.75, ts: '2026-10-15T10:00:00.000Z', run: 'r-0' }],
  };
  assert.deepEqual(plain(hitRateBySection(history)), { with: { average: 0.75, issues: 2 }, without: { average: 0.5, issues: 2 } });
});

test('#429 hitRateBySection: an issue counts once, by its latest entry; no issue gives a null average', () => {
  const { hitRateBySection } = load();
  assert.equal(typeof hitRateBySection, 'function');
  const history = {
    426: [
      { hitRate: 0, ts: '2026-10-20T10:00:00.000Z', run: 'r-1', withSection: false },
      { hitRate: 1, ts: '2026-10-21T10:00:00.000Z', run: 'r-2', withSection: true },
    ],
  };
  assert.deepEqual(plain(hitRateBySection(history)), { with: { average: 1, issues: 1 }, without: { average: null, issues: 0 } });
  assert.deepEqual(plain(hitRateBySection({})), { with: { average: null, issues: 0 }, without: { average: null, issues: 0 } });
});

test('#429 hitRateBySection: withSection null counts as without; an entry with no hit rate is left out', () => {
  const { hitRateBySection } = load();
  const history = {
    10: [{ hitRate: 0.4, ts: '2026-10-21T10:00:00.000Z', run: 'r-1', withSection: null }],
    11: [{ hitRate: null, ts: '2026-10-21T11:00:00.000Z', run: 'r-2', withSection: true }],
  };
  assert.deepEqual(plain(hitRateBySection(history)), { with: { average: null, issues: 0 }, without: { average: 0.4, issues: 1 } });
});

test('#429 recordHitRate: an entry recorded without the flag keeps today\'s shape', () => {
  const { recordHitRate } = load();
  const out = plain(recordHitRate({}, 375, { hitRate: 0.5, ts: '2026-10-21T10:00:00.000Z', run: 'r-1' }));
  assert.deepEqual(out['375'], [{ hitRate: 0.5, ts: '2026-10-21T10:00:00.000Z', run: 'r-1' }]);
});
