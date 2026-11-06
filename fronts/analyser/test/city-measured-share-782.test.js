// #782: how much of the city a tool measured, and the colour it opens in (packages/shared/city-layout.js measuredShare
// and defaultColourBy). Acceptance tests, written before the code, on the real buildModel and buildCity.
//
// The contract these tests assume:
// measuredShare(model) → { files, measured, unmeasured, share, languages: [{ language, files, share, tool }] }, `model`
// being buildCity's model. Test files are left out (they have their own legend row "Tests"); share = unmeasured / files,
// 0..1; languages: the unmeasured ones, most files first; their share = their files / files; tool from COMPLEXITY_TOOLS
// (exported by architecture-model.js), null for a language without one (Markdown…). No files: share 0, languages [].
// defaultColourBy(model): 'churn' when share > 0.5; else 'quadrant' when measured; else 'zone' (today).
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildModel } = require('@multiagent/shared/architecture-model');
const { buildCity } = require('@multiagent/shared/city-model');

const load = () => require('@multiagent/shared/city-layout.js');

const hash = '11'.repeat(20);
const numbered = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const rust = (n) => numbered(n, (i) => `crates/core/src/f${i}.rs`);
const js = (n) => numbered(n, (i) => `src/f${i}.js`);
const jsTests = (n) => numbered(n, (i) => `src/f${i}.test.js`);

const complexityOf = (measured) => ({
  tool: 'code-health', metric: 'cyclomatic', functions: measured.map((file) => ({ file, name: 'f', line: 1, complexity: 3, length: 10 })),
});

// buildCity's model of `paths`, the test files kept; measured: the files a tool read (null: no tool at all)
function cityOf(paths, measured) {
  const facts = buildModel({
    head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
    files: paths.map((path) => ({ path, lines: 10 })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${paths.map((p) => `A\t${p}`).join('\n')}\n`,
    ignoreRevs: [], attributes: '', exclude: [], includeMass: true, includeTests: true, complexity: measured ? complexityOf(measured) : null,
  });
  return buildCity({ plan: null, facts }).model;
}

// eight Rust files, a README and a JavaScript file a tool measured, and two test files
const RUST_HEAVY = cityOf([...rust(8), 'README.md', 'scripts/build.js', 'crates/core/tests/it.rs', 'scripts/build.test.js'], ['scripts/build.js']);

test('#782 measuredShare counts the files, what was measured and what was not, without the tests', () => {
  const { files, measured, unmeasured, share } = load().measuredShare(RUST_HEAVY);
  assert.deepEqual({ files, measured, unmeasured, share }, { files: 10, measured: 1, unmeasured: 9, share: 0.9 });
});

test('#782 measuredShare lists the unmeasured languages, most files first, each with its share and its tool', () => {
  assert.deepEqual(load().measuredShare(RUST_HEAVY).languages, [
    { language: 'Rust', files: 8, share: 0.8, tool: 'clippy or rust-code-analysis' },
    { language: 'Markdown', files: 1, share: 0.1, tool: null },
  ]);
});

test('#782 a project all measured has share 0 and no language', () => {
  const paths = js(3);
  const { share, unmeasured, languages } = load().measuredShare(cityOf(paths, paths));
  assert.deepEqual({ share, unmeasured, languages }, { share: 0, unmeasured: 0, languages: [] });
});

test('#782 no tool at all: every file is unmeasured', () => {
  const { files, measured, share } = load().measuredShare(cityOf(rust(3), null));
  assert.deepEqual({ files, measured, share }, { files: 3, measured: 0, share: 1 });
});

test('#782 a city with no file has share 0 and no language', () => {
  assert.deepEqual(load().measuredShare(cityOf([], null)), { files: 0, measured: 0, unmeasured: 0, share: 0, languages: [] });
});

test('#782 architecture-model.js exports the tools of the languages', () => {
  const { COMPLEXITY_TOOLS } = require('@multiagent/shared/architecture-model');
  assert.equal(COMPLEXITY_TOOLS?.Rust, 'clippy or rust-code-analysis');
  assert.equal(COMPLEXITY_TOOLS?.Go, 'gocyclo');
});

test('#782 a Rust-heavy project opens in Churn', () => {
  assert.equal(load().defaultColourBy(RUST_HEAVY), 'churn');
});

test('#782 a project with no tool at all opens in Churn', () => {
  assert.equal(load().defaultColourBy(cityOf(rust(3), null)), 'churn');
});

test('#782 a JavaScript project whose files are mostly tests stays in Quadrant', () => {
  const sources = js(3);
  assert.equal(load().defaultColourBy(cityOf([...sources, ...jsTests(8)], sources)), 'quadrant');
});

test('#782 exactly half unmeasured stays in Quadrant', () => {
  const sources = js(2);
  const model = cityOf([...sources, ...rust(2)], sources);
  assert.equal(load().measuredShare(model).share, 0.5);
  assert.equal(load().defaultColourBy(model), 'quadrant');
});

test('#782 a city with no file stays in Zone', () => {
  assert.equal(load().defaultColourBy(cityOf([], null)), 'zone');
});
