// Internals of the conflict map (#150): a `-U0` patch parsed into hunks, a line carried through later
// hunks to HEAD (src/domains/project/conflict-map.js), and a decongest fix filed as an issue in preview
// (src/domains/po/product-owner.js fileDecongest: the command only, recorded in the conversation).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildConflictMap, carry, parsePatch } = require('../../src/domains/project/conflict-map');
const productOwner = require('../../src/domains/po/product-owner');

// Isolated identity on every call: nothing depends on the machine's git config.
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
// #492: a history of many commits ([file, text] each, one file per commit, oldest first) written by one
// `git fast-import` process, not three git processes per commit (180 of them took over 60 s on a busy
// Windows machine); the checkout then matches the last commit.
function commits(cwd, list) {
  const data = (s) => `data ${Buffer.byteLength(s)}\n${s}\n`;
  const stream = list.map(([file, text], i) => [
    'commit refs/heads/main',
    `committer t <t@t> ${1700000000 + i * 60} +0000`,
    data(`${file}: ${text.trim()}`).trimEnd(),
    `M 100644 inline ${file}`,
    data(text),
  ].join('\n')).join('');
  execFileSync('git', ['fast-import', '--quiet'], { cwd, input: stream, stdio: ['pipe', 'pipe', 'pipe'] });
  git(cwd, 'reset', '-q', '--hard', 'main');
}

// A conversation holding one plan answer with two decongest fixes, at `at`.
function decongestConversation(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-decongest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const backlogDir = path.join(dir, 'backlog');
  fs.mkdirSync(backlogDir, { recursive: true });
  const at = '2026-10-12T10:00:00.000Z';
  const answer = { summary: '', groups: [], conflicts: [], enrich: [], decongest: [
    { file: 'src/index.js', line: 3, fix: 'One import per line, sorted.', runs: 7, of: 10 },
    { file: 'src/renderer/app.js', fix: 'Split it by screen.', runs: 8, of: 10 },
  ] };
  fs.writeFileSync(path.join(backlogDir, 'demo.po.jsonl'), `${JSON.stringify({ ts: at, role: 'po', text: '', answer })}\n`);
  const file = (index, preview, exec = () => 'https://github.com/o/r/issues/9\n') => productOwner.fileDecongest({ backlogDir, projectId: 'demo', runsDir: path.join(dir, 'runs'), at, index, preview, platform: 'github', repo: 'https://github.com/o/r', exec });
  return { file };
}

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

test('fileDecongest: a fix filed for real is refused the second time; another fix of the answer can still be filed', async (t) => {
  const { file } = decongestConversation(t);
  let calls = 0;
  const out = await file(0, false, () => { calls += 1; return 'https://github.com/o/r/issues/9\n'; });
  assert.equal(calls, 1);
  assert.equal(out.message.decongestFiled.url, 'https://github.com/o/r/issues/9');
  await assert.rejects(file(0, false, () => { calls += 1; return ''; }), /already filed/);
  assert.equal(calls, 1);
  await file(1, false);
});

test('fileDecongest: a preview does not count as filed: the same fix can be filed for real after it', async (t) => {
  const { file } = decongestConversation(t);
  await file(0, true);
  await file(0, true);
  const out = await file(0, false);
  assert.equal(out.message.decongestFiled.preview, undefined);
  await assert.rejects(file(0, false), /already filed/);
});

test('fileDecongest: an index the answer does not have is refused', async (t) => {
  const { file } = decongestConversation(t);
  await assert.rejects(file(5, true), /no such fix/);
});

test('buildConflictMap (git fallback): hub lines count only the commits of the window, never older ones', async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'conflict-map-window-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }));
  git(repo, 'init', '-q');
  // five old commits change line 1 of hub.js, 53 commits touch their own file, then two more change hub.js line 1:
  // the newest 50 commits hold only the last two hub.js changes
  const history = [];
  for (let n = 1; n <= 5; n++) history.push(['hub.js', `v${n}\n`]);
  for (let n = 1; n <= 53; n++) history.push([`f${n}.txt`, `${n}\n`]);
  history.push(['hub.js', 'v6\n'], ['hub.js', 'v7\n']);
  commits(repo, history);
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '60');
  const map = await buildConflictMap({ runs: [], repo });
  assert.equal(map.source, 'git');
  assert.equal(map.runIds.length, 50);
  assert.equal(map.files.find((f) => f.file === 'hub.js').runs, 2);
  const hub = map.lines.find((l) => l.file === 'hub.js' && l.line === 1);
  assert.equal(hub?.runs, 2);
  const window = new Set(map.runIds);
  const outside = map.lines.flatMap((l) => l.runIds.filter((id) => !window.has(id)).map((id) => `${l.file}:${l.line} ${id}`));
  assert.deepEqual(outside, []);
});
