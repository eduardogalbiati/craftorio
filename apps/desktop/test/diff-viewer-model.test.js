// apps/desktop/renderer/diff-viewer-model.js (#118): the diff viewer's pure part (no DOM) - parsing a unified
// patch into numbered hunks, the unified and split rows (with collapsed unchanged "gaps" and their
// expansion), word-level highlights and the left list's folder grouping.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../renderer/diff-viewer-model');

// ---- parsePatch -----------------------------------------------------------------------------

test('parsePatch: numbers each line on the old and new side from the hunk header', () => {
  const patch = `diff --git a/f.txt b/f.txt
index abc..def 100644
--- a/f.txt
+++ b/f.txt
@@ -5,3 +5,4 @@ section title
 ctx5
-old6
+new6
+new7
 ctx7
`;
  const { hunks, binary } = M.parsePatch(patch);
  assert.equal(binary, false);
  assert.equal(hunks.length, 1);
  const h = hunks[0];
  assert.equal(h.section, 'section title');
  assert.equal(h.oldStart, 5);
  assert.equal(h.newStart, 5);
  assert.deepEqual(h.lines, [
    { type: ' ', text: 'ctx5', oldNo: 5, newNo: 5 },
    { type: '-', text: 'old6', oldNo: 6, newNo: null },
    { type: '+', text: 'new6', oldNo: null, newNo: 6 },
    { type: '+', text: 'new7', oldNo: null, newNo: 7 },
    { type: ' ', text: 'ctx7', oldNo: 7, newNo: 8 },
  ]);
});

test('parsePatch: "\\ No newline at end of file" is ignored, numbering unaffected', () => {
  const patch = `@@ -1,1 +1,1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;
  const { hunks } = M.parsePatch(patch);
  assert.equal(hunks.length, 1);
  assert.deepEqual(hunks[0].lines, [
    { type: '-', text: 'old', oldNo: 1, newNo: null },
    { type: '+', text: 'new', oldNo: null, newNo: 1 },
  ]);
});

test('parsePatch: detects a binary file (both forms), no hunks', () => {
  assert.deepEqual(M.parsePatch('Binary files a/x.png and b/x.png differ'), { hunks: [], binary: true });
  assert.equal(M.parsePatch('GIT binary patch\nliteral 10\n...').binary, true);
});

// ---- rows: gaps before/between/after hunks ---------------------------------------------------

// Two hunks (old lines 3-7 and 9-11 change); a 12-line file on both sides, line 5 and line 10 changed.
const TWO_HUNK_PATCH = `@@ -3,5 +3,5 @@
 a3
 a4
-a5
+X
 a6
 a7
@@ -9,3 +9,3 @@
 a9
-a10
+Y
 a11
`;
const BEFORE_12 = Array.from({ length: 12 }, (_, i) => `a${i + 1}`).join('\n');
const AFTER_12 = BEFORE_12.split('\n').map((l, i) => (i === 4 ? 'X' : i === 9 ? 'Y' : l)).join('\n');

test('rows: with both sides\' contents, the gap before/between/after the hunks has the right hidden count', () => {
  const parsed = M.parsePatch(TWO_HUNK_PATCH);
  const rows = M.rows(parsed, { before: BEFORE_12, after: AFTER_12 });
  const gaps = rows.filter((r) => r.kind === 'gap');
  assert.equal(gaps.length, 3);
  assert.deepEqual([gaps[0].index, gaps[0].hidden, gaps[0].up, gaps[0].down], [0, 2, true, false], 'before the first hunk: only "up" (reveals from the bottom)');
  assert.deepEqual([gaps[1].index, gaps[1].hidden, gaps[1].up, gaps[1].down], [1, 1, true, true], 'between the two hunks: both directions');
  assert.deepEqual([gaps[2].index, gaps[2].hidden, gaps[2].up, gaps[2].down], [2, 1, false, true], 'after the last hunk: only "down" (reveals from the top)');
  assert.equal(rows.some((r) => r.unknown), false);
});

test('rows: without contents, a gap between/before hunks is still sized from the hunk headers; the trailing gap (after the last hunk) is unknown', () => {
  const parsed = M.parsePatch(TWO_HUNK_PATCH);
  const rows = M.rows(parsed, null);
  const gaps = rows.filter((r) => r.kind === 'gap');
  assert.equal(gaps.length, 3);
  assert.equal(gaps[0].hidden, 2);
  assert.equal(gaps[0].unknown, true, 'sized, but no contents to show: still marked unknown');
  assert.equal(gaps[1].hidden, 1);
  assert.equal(gaps[2].hidden, null, 'nothing past the last hunk bounds it: truly unknown size');
  assert.equal(gaps[2].unknown, true);
});

// ---- expand ------------------------------------------------------------------------------------

test('expand: "down" grows the top of the gap (lines below the previous hunk), "up" grows its bottom (lines above the next hunk)', () => {
  assert.deepEqual(M.expand({}, 1, 'down'), { 1: { top: M.EXPAND_STEP } });
  assert.deepEqual(M.expand({}, 1, 'up'), { 1: { bottom: M.EXPAND_STEP } });
  const twice = M.expand(M.expand({}, 1, 'down'), 1, 'down');
  assert.equal(twice[1].top, M.EXPAND_STEP * 2);
});

test('expand: "all" reveals a gap fully; the region before the first hunk only has a bottom to reveal from', () => {
  const parsed = M.parsePatch(TWO_HUNK_PATCH);
  const expandedFirst = M.expand({}, 0, 'all');
  const rowsFirst = M.rows(parsed, { before: BEFORE_12, after: AFTER_12 }, expandedFirst);
  assert.equal(rowsFirst.some((r) => r.kind === 'gap' && r.index === 0), false, 'gap 0 is fully revealed');
  // the expanded lines above hunk 0 show the real content
  assert.ok(rowsFirst.some((r) => r.kind === 'line' && r.text === 'a1' && r.expanded));

  const expandedLast = M.expand({}, 2, 'all');
  const rowsLast = M.rows(parsed, { before: BEFORE_12, after: AFTER_12 }, expandedLast);
  assert.equal(rowsLast.some((r) => r.kind === 'gap' && r.index === 2), false, 'gap 2 is fully revealed too');
  assert.ok(rowsLast.some((r) => r.kind === 'line' && r.text === 'a12' && r.expanded));
});

// ---- splitRows: same hunks and changed lines as the unified rows ------------------------------

test('splitRows: the same hunk headers and the same changed/context lines as the unified rows', () => {
  const patch = `@@ -1,3 +1,3 @@
 ctx
-const x = 1;
+const x = 2;
 after
`;
  const parsed = M.parsePatch(patch);
  const unified = M.rows(parsed);
  const split = M.splitRows(unified);

  assert.deepEqual(unified.filter((r) => r.kind === 'hunk'), split.filter((r) => r.kind === 'hunk'));

  const unifiedLines = unified.filter((r) => r.kind === 'line').map((r) => `${r.type}:${r.text}`).sort();
  const splitLines = [];
  for (const r of split) {
    if (r.kind !== 'pair') continue;
    if (r.left) splitLines.push(`${r.left.type}:${r.left.text}`);
    if (r.right && r.right !== r.left) splitLines.push(`${r.right.type}:${r.right.text}`);
  }
  assert.deepEqual(splitLines.sort(), unifiedLines);
});

// ---- pairBlock ---------------------------------------------------------------------------------

// pairBlock itself is not exported; splitRows (exported) calls it for every removed/added run, so a
// block of just one removed and one added line exercises it directly.
test('pairBlock (via splitRows): a removed line next to the added line it resembles (wordDiff finds a shared part)', () => {
  const del = { kind: 'line', type: '-', text: 'const x = 1;' };
  const add = { kind: 'line', type: '+', text: 'const x = 2;' };
  const pairs = M.splitRows([del, add]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].left.text, 'const x = 1;');
  assert.equal(pairs[0].right.text, 'const x = 2;');
});

test('pairBlock (via splitRows): a lone removed line next to a lone unrelated added line, paired by position', () => {
  const del = { kind: 'line', type: '-', text: 'foo' };
  const add = { kind: 'line', type: '+', text: 'completely different' };
  const pairs = M.splitRows([del, add]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].left.text, 'foo');
  assert.equal(pairs[0].right.text, 'completely different');
});

// ---- wordDiff ------------------------------------------------------------------------------------

test('wordDiff: "const x = 1;" vs "const x = 2;" points only at the "1"/"2"', () => {
  const { a, b } = M.wordDiff('const x = 1;', 'const x = 2;');
  assert.deepEqual(a, [[10, 11]]);
  assert.deepEqual(b, [[10, 11]]);
  assert.equal('const x = 1;'.slice(...a[0]), '1');
  assert.equal('const x = 2;'.slice(...b[0]), '2');
});

test('wordDiff: unrelated lines have nothing worth pointing at', () => {
  assert.deepEqual(M.wordDiff('foo bar', 'baz qux'), { a: [], b: [] });
});

// ---- highlightHtml -------------------------------------------------------------------------------

test('highlightHtml: escapes HTML and wraps the changed range in mark.dv-word', () => {
  const html = M.highlightHtml('a<b>c', null, [[1, 3]]);
  assert.equal(html, 'a<mark class="dv-word">&lt;b</mark>&gt;c');
});

// ---- groupByFolder -------------------------------------------------------------------------------

test('groupByFolder: groups by folder (root is \'\'), each sorted by its full path, folders sorted by name', () => {
  const files = [{ file: 'b/x.js' }, { file: 'a.js' }, { file: 'b/a.js' }, { file: 'README.md' }];
  const groups = M.groupByFolder(files);
  assert.deepEqual(groups.map((g) => g.folder), ['', 'b']);
  assert.deepEqual(groups[0].files.map((f) => f.file), ['a.js', 'README.md']);
  assert.deepEqual(groups[1].files.map((f) => f.file), ['b/a.js', 'b/x.js']);
});
