// #526: the git fallback carries a commit of a merged branch to HEAD by its own diff, not through the
// hunks of the main line's commits (other coordinates): same lines as `git diff <sha> HEAD` gave.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildConflictMap } = require('../../domains/project/conflict-map');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function commit(cwd, text, date) {
  fs.writeFileSync(path.join(cwd, 'list.js'), text);
  git(cwd, 'add', 'list.js');
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', text.split('\n').join(' ')], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return git(cwd, 'rev-parse', 'HEAD');
}

test('#526 a commit of a merged branch keeps its line at HEAD in the git fallback', async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-merge-repo-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }));
  git(repo, 'init', '-q');
  git(repo, 'config', 'core.autocrlf', 'false');
  const c1 = commit(repo, 'a\nb\nc\n', '2026-01-01T00:00:00Z');
  git(repo, 'switch', '-q', '-c', 'side');
  const cb = commit(repo, 'a\nb\nC\n', '2026-01-03T00:00:00Z');
  git(repo, 'switch', '-q', 'main');
  const cm = commit(repo, 'x\ny\nz\na\nb\nc\n', '2026-01-02T00:00:00Z');
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '-q', '--no-edit', 'side'], { cwd: repo, env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-04T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-04T00:00:00Z' } });
  assert.equal(fs.readFileSync(path.join(repo, 'list.js'), 'utf8'), 'x\ny\nz\na\nb\nC\n');

  const map = await buildConflictMap({ runs: [], repo });
  assert.equal(map.source, 'git');
  const hub = map.lines.find((l) => l.file === 'list.js' && l.line === 6);
  assert.ok(hub, JSON.stringify(map.lines));
  assert.deepEqual(new Set(hub.runIds), new Set([cb, c1]));
  assert.equal(hub.text, 'C');
  assert.ok(!map.lines.some((l) => l.line === 3 && l.runIds.includes(cb)), JSON.stringify(map.lines));
  assert.ok(map.runIds.includes(cm));
});
