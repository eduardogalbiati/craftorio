// #757: the docs an issue expects are checked before the code review, without an agent.
// Acceptance tests written before the code, on the new module packages/engine/engine/expected-files.js:
// - parseExpectedFiles(text): the paths listed under every `## Expected files` section of the run's
//   task (one or several issue bodies): the first backticked path of each list item, `(new)` markers
//   dropped, directories kept with their trailing slash, no duplicates;
// - docsEntries(paths): only the docs among them (under docs/, README.md, any *.md, docs/readme/);
// - checkExpectedDocs({ text, changed, leftOut }): `skipped` without docs to expect, `pass` when the
//   diff touches at least one expected doc (a directory entry is satisfied by any file under it) or
//   every untouched doc is declared in left_out with a reason, `missing` otherwise, with a message
//   for the timeline ("docs expected: 2, touched: 0") and the missing paths for the developer.
// The module is loaded inside each test: it does not exist before the change.
// The step in the workflows is tested in test/docs-check-workflow-757.test.js, a whole run in
// test/slow/docs-check-757.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../engine/expected-files');

const issue = (title, expected) => [
  title,
  '',
  'Issue: https://github.com/o/r/issues/1',
  '',
  'Some context.',
  '',
  '## Expected files',
  '',
  ...expected,
  '',
  '## Tasks',
  '',
  '- [ ] do it, touching `src/not-expected.js`',
  '',
].join('\n');

test('#757 parseExpectedFiles reads the backticked paths, drops (new) markers and keeps directories', () => {
  const { parseExpectedFiles } = load();
  const text = issue('Add the guide', [
    '- `docs/agents/guide.md` (new): the guide',
    '- `packages/engine/engine/` (e.g. `expected-files.js`, new): read the section',
    '- `README.md`: a line for the feature',
  ]);
  assert.deepEqual(parseExpectedFiles(text), ['docs/agents/guide.md', 'packages/engine/engine/', 'README.md']);
});

test('#757 parseExpectedFiles reads the section of every issue of a grouped run, once per path', () => {
  const { parseExpectedFiles } = load();
  const text = [
    '## 1. #10 First',
    '',
    '## Expected files',
    '',
    '- `docs/ARCHITECTURE.md`: a paragraph',
    '- `src/a.js`: the code',
    '',
    '## 2. #11 Second',
    '',
    '## Expected files',
    '',
    '- `docs/readme/` (new): a README section',
    '- `src/a.js`: the code again',
    '',
  ].join('\n');
  assert.deepEqual(parseExpectedFiles(text).slice().sort(), ['docs/ARCHITECTURE.md', 'docs/readme/', 'src/a.js']);
});

test('#757 parseExpectedFiles returns an empty list for a task without the section', () => {
  const { parseExpectedFiles } = load();
  assert.deepEqual(parseExpectedFiles('Add the feature\n\n## Tasks\n\n- [ ] edit `docs/x.md`\n'), []);
  assert.deepEqual(parseExpectedFiles(''), []);
});

test('#757 docsEntries keeps docs/, README.md, *.md and docs/readme/ entries only', () => {
  const { docsEntries } = load();
  const paths = [
    'docs/agents/testing.md',
    'docs/readme/',
    'docs/site/assets/a.svg',
    'README.md',
    'packages/engine/README.md',
    'CHANGELOG.md',
    'packages/engine/engine/expected-files.js',
    'workflows/feature.yaml',
    'packages/engine/test/',
  ];
  assert.deepEqual(docsEntries(paths), [
    'docs/agents/testing.md',
    'docs/readme/',
    'docs/site/assets/a.svg',
    'README.md',
    'packages/engine/README.md',
    'CHANGELOG.md',
  ]);
});

test('#757 checkExpectedDocs: a diff that touches none of the expected docs is missing, with the paths and the counts', () => {
  const { checkExpectedDocs } = load();
  const text = issue('Add the guide', [
    '- `docs/agents/guide.md` (new): the guide',
    '- `docs/readme/` : a README section',
    '- `src/app.js`: the code',
  ]);
  const r = checkExpectedDocs({ text, changed: ['src/app.js', 'packages/x/test/app.test.js'], leftOut: [] });
  assert.equal(r.status, 'missing');
  assert.deepEqual(r.missing.slice().sort(), ['docs/agents/guide.md', 'docs/readme/']);
  assert.match(r.message, /docs expected: 2, touched: 0/);
  assert.match(r.message, /docs\/agents\/guide\.md/);
  assert.match(r.message, /docs\/readme\//);
});

test('#757 checkExpectedDocs: one expected doc touched is enough to pass', () => {
  const { checkExpectedDocs } = load();
  const text = issue('Add the guide', ['- `docs/agents/guide.md` (new): the guide', '- `README.md`: a line']);
  const r = checkExpectedDocs({ text, changed: ['src/app.js', 'docs/agents/guide.md'], leftOut: [] });
  assert.equal(r.status, 'pass');
  assert.match(r.message, /docs expected: 2, touched: 1/);
});

test('#757 checkExpectedDocs: a directory entry is satisfied by any file under it', () => {
  const { checkExpectedDocs } = load();
  const text = issue('Add the guide', ['- `docs/agents/`: the agents docs']);
  assert.equal(checkExpectedDocs({ text, changed: ['docs/agents/engine/machine-steps.md'], leftOut: [] }).status, 'pass');
  assert.equal(checkExpectedDocs({ text, changed: ['docs/agentsx/other.md', 'docs/other.md'], leftOut: [] }).status, 'missing');
});

test('#757 checkExpectedDocs: a docs entry declared in left_out with a reason is not reported again', () => {
  const { checkExpectedDocs } = load();
  const text = issue('Add the guide', ['- `docs/agents/guide.md` (new): the guide', '- `src/app.js`: the code']);
  const leftOut = [{ requirement: 'Write docs/agents/guide.md', reason: 'the owner writes the guide after the release' }];
  const r = checkExpectedDocs({ text, changed: ['src/app.js'], leftOut });
  assert.equal(r.status, 'pass');
});

test('#757 checkExpectedDocs: only the declared entry is excused; a left_out without a reason excuses nothing', () => {
  const { checkExpectedDocs } = load();
  const text = issue('Add the guide', ['- `docs/agents/guide.md` (new): the guide', '- `docs/ARCHITECTURE.md`: a paragraph']);
  const partly = checkExpectedDocs({
    text,
    changed: ['src/app.js'],
    leftOut: [{ requirement: 'docs/agents/guide.md', reason: 'written in #800' }],
  });
  assert.equal(partly.status, 'missing');
  assert.deepEqual(partly.missing, ['docs/ARCHITECTURE.md']);
  const noReason = checkExpectedDocs({
    text,
    changed: ['src/app.js'],
    leftOut: [{ requirement: 'docs/agents/guide.md', reason: '' }, { requirement: 'docs/ARCHITECTURE.md', reason: '  ' }],
  });
  assert.equal(noReason.status, 'missing');
  assert.deepEqual(noReason.missing.slice().sort(), ['docs/ARCHITECTURE.md', 'docs/agents/guide.md']);
});

test('#757 checkExpectedDocs: an issue without the section, or with no docs in it, skips the check', () => {
  const { checkExpectedDocs } = load();
  const without = checkExpectedDocs({ text: 'Add the feature\n\n## Tasks\n\n- [ ] update `docs/x.md`\n', changed: [], leftOut: [] });
  assert.equal(without.status, 'skipped');
  const codeOnly = issue('Docs check', [
    '- `packages/engine/engine/` (e.g. `expected-files.js`, new): read the section',
    '- `workflows/feature.yaml` (and the other workflows with `rule_check`): the step',
    '- `packages/engine/test/`: tests',
  ]);
  assert.equal(checkExpectedDocs({ text: codeOnly, changed: ['src/app.js'], leftOut: [] }).status, 'skipped');
});

test('#757 checkExpectedDocs: a left_out that names a more specific file does not excuse the expected one', () => {
  const { checkExpectedDocs } = load();
  const text = issue('Add the guide', ['- `README.md`: a line for the feature']);
  const r = checkExpectedDocs({
    text,
    changed: ['src/app.js'],
    leftOut: [{ requirement: 'Update packages/engine/README.md', reason: 'the package README is generated later' }],
  });
  assert.equal(r.status, 'missing', 'packages/engine/README.md is another file than the root README.md');
  assert.deepEqual(r.missing, ['README.md']);
});

test('#757 the expected_docs template filter lists the docs a task expects, empty without them', () => {
  const { render, evalExpr } = require('../engine/run/templates');
  const withDocs = issue('Add the guide', ['- `docs/agents/guide.md` (new): the guide', '- `src/app.js`: the code']);
  const codeOnly = issue('Add the code', ['- `src/app.js`: the code']);
  assert.equal(render('{{ inputs.task | expected_docs | join(",") }}', { inputs: { task: withDocs } }), 'docs/agents/guide.md');
  assert.equal(evalExpr('inputs.task | expected_docs | length', { inputs: { task: withDocs } }), true);
  assert.equal(evalExpr('inputs.task | expected_docs | length', { inputs: { task: codeOnly } }), false);
  assert.equal(evalExpr('inputs.task | expected_docs | length', { inputs: { task: 'Add the feature' } }), false);
  assert.equal(evalExpr('inputs.task | expected_docs | length', { inputs: {} }), false);
});

test('#757 checkExpectedDocs tolerates a missing left_out and changed list', () => {
  const { checkExpectedDocs } = load();
  const text = issue('Add the guide', ['- `docs/agents/guide.md` (new): the guide']);
  const r = checkExpectedDocs({ text });
  assert.equal(r.status, 'missing');
  assert.deepEqual(r.missing, ['docs/agents/guide.md']);
});
