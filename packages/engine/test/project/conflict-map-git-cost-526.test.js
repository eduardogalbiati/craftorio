// #526: the git fallback of the conflict map (a project with no counted run) is cheap: the git processes
// it starts do not grow with the number of commits in its window (no `git diff <sha> HEAD` per commit),
// and it still gives the same files and lines for the same commits. The git processes are counted at the
// process boundary (git-process-stub.js), installed before the module loads.
const gitStub = require('./git-process-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const load = () => require('../../domains/project/conflict-map');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmpRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cost-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  git(dir, 'init', '-q');
  return dir;
}

function commitFiles(cwd, files) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), text);
    git(cwd, 'add', file);
  }
  git(cwd, 'commit', '-q', '-m', Object.keys(files).join(' '));
  return git(cwd, 'rev-parse', 'HEAD');
}

// `n` commits, each changing the first line of the same two hub files.
function repoOf(t, n) {
  const repo = tmpRepo(t);
  for (let i = 1; i <= n; i++) commitFiles(repo, { 'list.js': `item ${i}\nkeep\n`, 'src/index.js': `import ${i}\nrest\n` });
  return repo;
}

async function gitCallsOfBuild(repo) {
  gitStub.watch(repo);
  const map = await load().buildConflictMap({ runs: [], repo });
  return { map, calls: gitStub.calls(repo).length };
}

test.afterEach(() => gitStub.reset());

test('#526 the git fallback starts no more git processes for a window of 12 commits than for 3', async (t) => {
  const small = await gitCallsOfBuild(repoOf(t, 3));
  const large = await gitCallsOfBuild(repoOf(t, 12));
  assert.equal(small.map.source, 'git');
  assert.equal(large.map.runs, 12);
  // the same two hub files in both: the work per file may stay, the work per commit may not
  assert.ok(large.calls <= small.calls, `12 commits started ${large.calls} git processes, 3 commits ${small.calls}`);
});

test('#526 the git fallback keeps the same files and lines for the same commits', async (t) => {
  const repo = tmpRepo(t);
  const c1 = commitFiles(repo, { 'list.js': 'a\nb\nc\n', 'README.md': 'r\n' });
  const c2 = commitFiles(repo, { 'list.js': 'a\nB\nc\n' });
  const c3 = commitFiles(repo, { 'list.js': 'a\nBB\nC\n' });
  const c4 = commitFiles(repo, { 'list.js': 'top\na\nBB\nC\n', 'other.txt': 'o\n' });
  const c5 = commitFiles(repo, { 'list.js': 'top\na\nBBB\nC\n' });
  const map = await load().buildConflictMap({ runs: [], repo });
  assert.equal(map.source, 'git');
  assert.equal(map.runs, 5);
  assert.deepEqual(map.runIds, [c5, c4, c3, c2, c1]);
  assert.deepEqual(map.files.map((f) => [f.file, f.runs]), [['list.js', 5], ['other.txt', 1], ['README.md', 1]]);
  // lines numbered at HEAD, each with the commits that changed it (carried over the line c4 inserted):
  // what the fallback gave before #526
  assert.deepEqual(map.lines.map((l) => ({ file: l.file, line: l.line, text: l.text, runs: l.runs, runIds: l.runIds })), [
    { file: 'list.js', line: 3, text: 'BBB', runs: 4, runIds: [c5, c3, c2, c1] },
    { file: 'list.js', line: 4, text: 'C', runs: 2, runIds: [c3, c1] },
  ]);
});
