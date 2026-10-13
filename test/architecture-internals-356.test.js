// #356 internals (the developer's own tests): the core's glob and .gitattributes rules, the
// `{a => b}` rename form, the complexity check, the monthly Danger Zone frames; lizard's CSV
// (src/architecture-facts.js parseLizard); a finding sent twice stays one Refactor proposal
// (src/refactor-proposals.js); the simulated report and the prompt (src/oracle-architecture.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../src/shared/architecture-model');
const { parseLizard } = require('../src/architecture-facts');
const proposals = require('../src/refactor-proposals');
const arch = require('../src/oracle-architecture');

test('#356 parseIgnoreRevs: hashes lowercased, comments and blanks dropped (the app and code-health.js share it)', () => {
  assert.deepEqual(core.parseIgnoreRevs('# formatting\n\nABCDEF1234\r\n  0123456789abcdef  \nnot-a-hash\n'), ['abcdef1234', '0123456789abcdef']);
  assert.deepEqual(core.parseIgnoreRevs(''), []);
});

test('#356 globRe: a hostile pattern does not backtrack (runs of * collapse, too many wildcards match nothing)', () => {
  const started = process.hrtime.bigint();
  const hostile = core.globRe(`${'**a'.repeat(30)}b`);
  assert.equal(hostile.test(`${'a'.repeat(60)}c`), false);
  assert.equal(core.globRe('***.lock').test('x/yarn.lock'), true);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 1000);
});

test('#356 globRe: a pattern without a slash matches at any depth, a directory pattern its contents, ** spans folders', () => {
  assert.equal(core.globRe('*.lock').test('a/b/yarn.lock'), true);
  assert.equal(core.globRe('dist/').test('pkg/dist/x.js'), true);
  assert.equal(core.globRe('dist/').test('distribution.js'), false);
  assert.equal(core.globRe('docs/**').test('docs/a/b.md'), true);
  assert.equal(core.globRe('docs/**').test('src/docs/a.md'), false);
  assert.equal(core.globRe('src/**/*.gen.ts').test('src/a/b/c.gen.ts'), true);
  assert.equal(core.globRe('/build/').test('build/x.js'), true);
  assert.equal(core.globRe('/build/').test('a/build/x.js'), false);
  // repeated **/ collapse: no catastrophic backtracking on a long path that does not match
  assert.equal(core.globRe(`${'**/'.repeat(40)}x`).test(`${'a/'.repeat(200)}y`), false);
});

test('#356 estimateCost leaves out a real report whose cost is unknown', () => {
  assert.deepEqual(arch.estimateCost([{ date: '2026-10-01T00:00:00Z', costUsd: null }, { date: '2026-10-02T00:00:00Z', costUsd: 0.5 }]), { usd: 0.5, basis: 1 });
});

test('#356 .gitattributes: -linguist-generated on a later line keeps a file in', () => {
  const files = [{ path: 'gen/keep.js', lines: 10 }, { path: 'gen/drop.js', lines: 10 }];
  const model = core.buildModel({ files, log: '', attributes: 'gen/** linguist-generated\ngen/keep.js -linguist-generated\n' });
  assert.deepEqual(model.files.map((f) => f.file), ['gen/keep.js']);
  assert.equal(model.excluded.generated, 1);
});

test('#356 parseLog resolves the {a => b} rename form into both paths', () => {
  const [c] = core.parseLog('\x01abc 2026-01-01T00:00:00Z\n\nR100\tsrc/{old => new}/a.js\n');
  assert.deepEqual(c.changes[0].paths, ['src/old/a.js', 'src/new/a.js']);
});

test('#356 two renames in one commit (git mv b a; git mv c b) keep each file\'s own history', () => {
  const log = [
    '\x01c3 2026-01-03T00:00:00Z\n\nR100\tb.js\ta.js\nR100\tc.js\tb.js',
    '\x01c2 2026-01-02T00:00:00Z\n\nM\tc.js',
    '\x01c1 2026-01-01T00:00:00Z\n\nA\tb.js\nA\tc.js',
  ].join('\n');
  const walked = core.walkHistory(core.parseLog(log), ['a.js', 'b.js']);
  const { commits } = core.countCommits(walked, ['a.js', 'b.js']);
  assert.deepEqual(commits, { 'a.js': 1, 'b.js': 2 });
});

test('#356 the tests group uses the engine\'s test patterns (a Java test class is excluded)', () => {
  const model = core.buildModel({ files: [{ path: 'src/main/App.java', lines: 5 }, { path: 'src/main/AppTest.java', lines: 5 }], log: '' });
  assert.deepEqual(model.files.map((f) => f.file), ['src/main/App.java']);
  assert.equal(model.excluded.tests, 1);
});

test('#356 checkComplexity lists the three longest functions and flags an output where they all score 1', () => {
  const fns = [1, 2, 3, 4].map((n) => ({ file: 'a.js', name: `f${n}`, line: n, complexity: 1, length: 50 + n }));
  const out = core.checkComplexity(fns);
  assert.deepEqual(out.longest.map((f) => f.name), ['f4', 'f3', 'f2']);
  assert.equal(out.ok, false);
  assert.equal(core.checkComplexity([]).ok, false);
});

test('#356 the monthly frames list the files that entered the Danger Zone', () => {
  const log = [
    '\x01c3 2026-02-10T00:00:00Z\n\nM\tbig.js\nM\tsmall.js',
    '\x01c2 2026-01-10T00:00:00Z\n\nM\tbig.js',
    '\x01c1 2026-01-01T00:00:00Z\n\nA\tbig.js\nA\tsmall.js\nA\tquiet.js',
  ].join('\n');
  const complexity = { tool: 'lizard', metric: 'cyclomatic', functions: [{ file: 'big.js', name: 'f', line: 1, complexity: 30 }, { file: 'small.js', name: 'g', line: 1, complexity: 2 }, { file: 'quiet.js', name: 'h', line: 1, complexity: 1 }] };
  const model = core.buildModel({ files: ['big.js', 'small.js', 'quiet.js'].map((p) => ({ path: p, lines: 10 })), log, complexity });
  assert.deepEqual(model.frames[0], { danger: 1, entered: ['big.js'], left: [], month: '2026-01' });
  assert.deepEqual(model.danger_zone.map((d) => d.file), ['big.js']);
});

test('#356 parseLizard reads lizard --csv rows (quoted names, ./ and backslash paths)', () => {
  const csv = '12,4,80,2,15,"run@3-17@.\\src\\a.js",".\\src\\a.js","run","run( x , y )",3,17\n5,1,20,0,6,"f@1-6@./b.py","./b.py","f","f( )",1,6\n';
  assert.deepEqual(parseLizard(csv), [
    { file: 'src/a.js', name: 'run', line: 3, complexity: 4, length: 15 },
    { file: 'b.py', name: 'f', line: 1, complexity: 1, length: 6 },
  ]);
});

test('#356 a finding sent twice stays one Refactor proposal', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch356-proposals-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = { source: 'architecture', key: 'test-gap:a.js', title: 'No test pins a.js' };
  const first = proposals.addProposal(root, 'proj', p);
  const again = proposals.addProposal(root, 'proj', p);
  assert.equal(again.id, first.id);
  assert.equal(proposals.listProposals(root, 'proj').length, 1);
});

test('#356 the simulated report is a valid report, and the prompt names the project and the schema', () => {
  const model = core.buildModel({ files: [{ path: 'src/a.js', lines: 10 }], log: '\x01c2 2026-01-02T00:00:00Z\n\nM\tsrc/a.js\n\x01c1 2026-01-01T00:00:00Z\n\nA\tsrc/a.js\n', branch: 'main', head: { commit: 'c2', date: '2026-01-02T00:00:00Z' } });
  assert.equal(arch.validateReport(arch.mockReport(model)).error, undefined);
  const prompt = arch.analysisPrompt({ project: { id: 'p1', name: 'Demo' }, model });
  assert.match(prompt, /projectId "p1"/);
  assert.match(prompt, /src\/a\.js: 10 lines, 1 commits/);
  assert.match(prompt, /"required":\["summary","areas","findings"\]/);
});
