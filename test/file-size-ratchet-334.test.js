// #334: file size ratchet. Every .js file under src/ and scripts/ has at most 1,000 lines; the files
// above it are listed with their line count when they were listed, and may only shrink: a listed
// file that grows past its count fails (the message says to split it and where the how-to is), a
// listed file at 1,000 lines or fewer fails until it leaves the list. Lines are counted the same
// way on every OS (CRLF normalized). The former caps on src/engine/workflow.js
// (engine-run-split-250) and src/renderer/app.js (view-folders) fold into this rule.
// Seam: scripts/file-size-ratchet.js { MAX_LINES, EXCEPTIONS, countLines, checkFileSizes }.
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const load = () => require('../scripts/file-size-ratchet.js');

// A scratch tree: { 'src/a.js': lineCount, ... } written as files of that many lines.
function tree(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-334-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, lines] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Array.from({ length: lines }, (_, i) => `// line ${i + 1}`).join('\n') + '\n');
  }
  return dir;
}

// What the check reports, as primitives: [{ file, kind }] sorted by file.
const found = (problems) => problems.map((p) => ({ file: p.file, kind: p.kind })).sort((a, b) => a.file.localeCompare(b.file));

test('#334 the cap is 1,000 lines', () => {
  assert.equal(load().MAX_LINES, 1000);
});

test('#334 lines are counted the same with LF and CRLF line endings', () => {
  const { countLines } = load();
  assert.equal(countLines('a\nb\nc\n'), 3);
  assert.equal(countLines('a\r\nb\r\nc\r\n'), 3);
  assert.equal(countLines('a\r\nb\r\nc\r\n'), countLines('a\nb\nc\n'));
  assert.equal(countLines('é\r\nü\r\n'), 2);
});

test('#334 every .js file under src/ and scripts/ of this repository is within the cap or a listed exception that has not grown', () => {
  const { checkFileSizes } = load();
  const problems = checkFileSizes({ root });
  assert.deepEqual(problems.map((p) => p.message), []);
});

test('#334 the exceptions list starts at the files over 1,000 lines, each with a count above the cap and no higher than at 383469a', () => {
  const { EXCEPTIONS } = load();
  const atIssue = {
    'src/renderer/views/backlog/backlog-roadmap.js': 2072,
    'src/renderer/views/backlog/backlog.js': 1779,
    'src/domains/po/product-owner.js': 1732,
    'src/renderer/views/discovery/discovery.js': 1560,
    'src/domains/discovery/discovery.js': 1164,
    'src/renderer/views/backlog/backlog-po.js': 1102,
    'src/renderer/views/arena/arena.js': 1048,
  };
  assert.deepEqual(Object.keys(EXCEPTIONS).sort(), Object.keys(atIssue).sort());
  for (const [file, max] of Object.entries(atIssue)) {
    assert.equal(Number.isInteger(EXCEPTIONS[file]), true, `${file}: a whole line count`);
    assert.ok(EXCEPTIONS[file] > 1000 && EXCEPTIONS[file] <= max, `${file}: recorded ${EXCEPTIONS[file]}, expected 1001..${max}`);
  }
  assert.equal('src/engine/workflow.js' in EXCEPTIONS, false, 'the former #250 cap is not an exception');
  assert.equal('src/renderer/app.js' in EXCEPTIONS, false, 'the former view-folders cap is not an exception');
});

test('#334 a file over the cap that is not listed fails, naming the file and its count', (t) => {
  const { checkFileSizes } = load();
  const dir = tree(t, { 'src/big.js': 1001, 'src/ok.js': 1000, 'scripts/tool.js': 1200, 'src/deep/er/x.js': 10 });
  const problems = checkFileSizes({ root: dir, exceptions: {} });
  assert.deepEqual(found(problems), [{ file: 'scripts/tool.js', kind: 'over' }, { file: 'src/big.js', kind: 'over' }]);
  const big = problems.find((p) => p.file === 'src/big.js');
  assert.equal(big.lines, 1001);
  assert.match(big.message, /src\/big\.js/);
  assert.match(big.message, /1,?001/);
});

test('#334 only .js files under src/ and scripts/ are checked', (t) => {
  const { checkFileSizes } = load();
  const dir = tree(t, { 'test/huge.test.js': 3000, 'docs/long.md': 3000, 'src/data.json': 3000, 'src/notes.md': 3000, 'other/big.js': 3000 });
  assert.deepEqual(found(checkFileSizes({ root: dir, exceptions: {} })), []);
});

test('#334 a listed file that grew past its recorded count fails; the message says to split it and where the how-to is', (t) => {
  const { checkFileSizes } = load();
  const dir = tree(t, { 'src/listed.js': 1301 });
  const problems = checkFileSizes({ root: dir, exceptions: { 'src/listed.js': 1300 } });
  assert.deepEqual(found(problems), [{ file: 'src/listed.js', kind: 'grew' }]);
  assert.match(problems[0].message, /split/i);
  assert.match(problems[0].message, /docs\/agents\/testing\.md/);
  assert.match(problems[0].message, /1,?300/, 'the recorded count');
  assert.match(problems[0].message, /1,?301/, 'the current count');
});

test('#334 a listed file at or below its recorded count but still over the cap passes (a lower count may replace the recorded one)', (t) => {
  const { checkFileSizes } = load();
  const dir = tree(t, { 'src/same.js': 1300, 'src/smaller.js': 1100 });
  assert.deepEqual(found(checkFileSizes({ root: dir, exceptions: { 'src/same.js': 1300, 'src/smaller.js': 1300 } })), []);
});

test('#334 a listed file now at 1,000 lines or fewer fails until it leaves the list', (t) => {
  const { checkFileSizes } = load();
  const dir = tree(t, { 'src/shrunk.js': 1000, 'src/tiny.js': 40 });
  const problems = checkFileSizes({ root: dir, exceptions: { 'src/shrunk.js': 1500, 'src/tiny.js': 1200 } });
  assert.deepEqual(found(problems), [{ file: 'src/shrunk.js', kind: 'leave-list' }, { file: 'src/tiny.js', kind: 'leave-list' }]);
  assert.match(problems[0].message, /src\/shrunk\.js/);
  assert.match(problems[0].message, /exception|list/i);
});

test('#334 a listed file that no longer exists fails until it leaves the list', (t) => {
  const { checkFileSizes } = load();
  const dir = tree(t, { 'src/kept.js': 5 });
  assert.deepEqual(found(checkFileSizes({ root: dir, exceptions: { 'src/gone.js': 1400 } })), [{ file: 'src/gone.js', kind: 'leave-list' }]);
});

test('#334 a CRLF file of exactly 1,000 lines is within the cap', (t) => {
  const { checkFileSizes } = load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-334-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'crlf.js'), Array.from({ length: 1000 }, () => 'x;').join('\r\n') + '\r\n');
  assert.deepEqual(found(checkFileSizes({ root: dir, exceptions: {} })), []);
});

test('#334 docs/agents/testing.md states the rule, that a new exception needs the owner\'s ok in its issue, and the usual ways to split', () => {
  const doc = fs.readFileSync(path.join(root, 'docs', 'agents', 'testing.md'), 'utf8');
  assert.match(doc, /1,000 lines/);
  assert.match(doc, /file-size-ratchet/);
  assert.match(doc, /owner/i);
  for (const issue of ['#154', '#155', '#250']) assert.ok(doc.includes(issue), `testing.md names the ${issue} way to split`);
});
