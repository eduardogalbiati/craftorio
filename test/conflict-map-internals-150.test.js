// Internals of the conflict map (#150): a `-U0` patch parsed into hunks, a line carried through later
// hunks to HEAD (src/conflict-map.js), and a decongest fix filed as an issue in preview
// (src/product-owner.js fileDecongest: the command only, recorded in the conversation).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { carry, parsePatch } = require('../src/conflict-map');
const productOwner = require('../src/product-owner');

test('parsePatch: a git log -p record gives each file its commit and hunks (a missing count is 1)', () => {
  const text = '\x1eabc123\n\ndiff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1,2 @@\n-x\n+y\n+z\n@@ -9,0 +11 @@\n+w\n';
  assert.deepEqual(parsePatch(text), [{ sha: 'abc123', file: 'src/a.js', hunks: [{ a: 1, b: 1, c: 1, d: 2 }, { a: 9, b: 0, c: 11, d: 1 }] }]);
});

test('carry: lines after an insertion shift, a line changed later lands in the new hunk, a deleted line is gone', () => {
  const hunks = [{ a: 2, b: 0, c: 3, d: 2 }, { a: 5, b: 1, c: 7, d: 1 }, { a: 8, b: 2, c: 10, d: 0 }];
  assert.equal(carry(1, hunks), 1);
  assert.equal(carry(3, hunks), 5);
  assert.equal(carry(5, hunks), 7);
  assert.equal(carry(8, hunks), null);
  assert.equal(carry(12, hunks), 12);
});

test('fileDecongest: a preview records the issue command without filing, and the issue names the line and its fix', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-decongest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const backlogDir = path.join(dir, 'backlog');
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(backlogDir, { recursive: true });
  const at = '2026-10-12T10:00:00.000Z';
  const answer = { summary: '', groups: [], conflicts: [], enrich: [], decongest: [{ file: 'src/index.js', line: 3, fix: 'One import per line, sorted.', runs: 7, of: 10 }] };
  fs.writeFileSync(path.join(backlogDir, 'demo.po.jsonl'), `${JSON.stringify({ ts: at, role: 'po', text: '', answer })}\n`);
  let called = false;
  const out = await productOwner.fileDecongest({ backlogDir, projectId: 'demo', runsDir, at, index: 0, preview: true, platform: 'github', repo: 'https://github.com/o/r', exec: () => { called = true; } });
  assert.equal(called, false);
  assert.equal(out.preview, true);
  assert.equal(out.message.decongestFiled.index, 0);
  assert.match(out.message.text, /Preview/);
  const issue = productOwner.decongestIssue(answer.decongest[0]);
  assert.match(issue.title, /src\/index\.js:3/);
  assert.match(issue.body, /7 of the last 10 runs/);
  assert.match(issue.body, /One import per line, sorted\./);
});
