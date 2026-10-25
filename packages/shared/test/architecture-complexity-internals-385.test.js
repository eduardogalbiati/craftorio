// #385 internals: packages/shared/architecture-model.js buildModel's complexity per language (a file
// the tool read without a function is measured, 0; the code languages none measured are named,
// with their tools and lizard's install command) and packages/shared/code-complexity.js's edges.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildModel } = require('../architecture-model');
const { measures, measureSource } = require('../code-complexity');

const FILES = [
  { path: 'src/app.js', lines: 40 },
  { path: 'src/config.js', lines: 3 },
  { path: 'tools/job.py', lines: 20 },
  { path: 'cmd/main.go', lines: 10 },
  { path: 'README.md', lines: 5 },
];
const build = (complexity) => buildModel({ head: { commit: 'a'.repeat(40), date: '2026-10-01T12:00:00Z' }, branch: 'main', files: FILES, log: '', complexity });
const row = (model, file) => {
  const r = model.files.find((f) => f.file === file);
  return { complexity: r.complexity, worst: r.worst, functions: r.functions };
};
const IN_APP = {
  tool: 'the app (JavaScript, TypeScript)',
  metric: 'cyclomatic',
  functions: [{ file: 'src/app.js', name: 'f', line: 1, complexity: 3, length: 10 }],
  files: ['src/app.js', 'src/config.js'],
  reason: 'lizard is not installed',
  install: 'pip install lizard',
};

test('#385 a file read in the app without a function is measured as 0; a file not read stays null', () => {
  const model = build(IN_APP);
  assert.deepEqual(row(model, 'src/app.js'), { complexity: 3, worst: 3, functions: 1 });
  assert.deepEqual(row(model, 'src/config.js'), { complexity: 0, worst: 0, functions: 0 });
  assert.deepEqual(row(model, 'tools/job.py'), { complexity: null, worst: null, functions: null });
});

test('#385 the code languages not measured are named with their tools and how to install lizard; prose languages are not', () => {
  const { complexity } = build(IN_APP);
  assert.equal(complexity.status, 'measured');
  assert.deepEqual(complexity.unmeasured, ['Go', 'Python']);
  assert.deepEqual(complexity.needed, ['gocyclo', 'radon or lizard']);
  assert.equal(complexity.install, 'pip install lizard');
  assert.equal(complexity.reason, 'lizard is not installed');
});

test('#385 everything measured: no language listed, no reason, no install command', () => {
  const functions = [...IN_APP.functions, { file: 'tools/job.py', name: 'g', line: 1, complexity: 2 }, { file: 'cmd/main.go', name: 'main', line: 1, complexity: 1 }];
  const { complexity } = build({ ...IN_APP, functions });
  assert.deepEqual(complexity.unmeasured, []);
  assert.equal(complexity.reason, null);
  assert.equal(complexity.install, null);
});

test('#385 nothing measured: every code language is listed, JavaScript too', () => {
  const { complexity } = build({ status: 'missing', reason: 'lizard is not installed', install: 'pip install lizard' });
  assert.equal(complexity.status, 'missing');
  assert.deepEqual(complexity.unmeasured, ['Go', 'JavaScript', 'Python']);
  assert.ok(complexity.needed.some((n) => /lizard/.test(n)));
});

test('#385 the core measures JavaScript and TypeScript by extension, not JSX', () => {
  assert.deepEqual(['a.js', 'a.mjs', 'a.cjs', 'a.ts', 'a.mts', 'a.cts', 'a.jsx', 'a.tsx', 'a.py'].filter(measures), ['a.js', 'a.mjs', 'a.cjs', 'a.ts', 'a.mts', 'a.cts']);
});

test('#385 TypeScript keeps its line numbers; syntax strip mode refuses is a parse error', () => {
  const ts = ['type Id = string;', '', 'export function find(ids: Id[], id: Id): number {', '  return ids.indexOf(id) ?? -1;', '}', ''].join('\n');
  assert.deepEqual(measureSource(ts, { file: 'src/find.ts' }).map((f) => [f.name, f.line, f.complexity]), [['find', 3, 2]]);
  assert.throws(() => measureSource('enum E { A }\n', { file: 'src/e.ts' }), /src\/e\.ts: cannot parse/);
});
