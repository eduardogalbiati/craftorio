// #526: the cheaper git fallback keeps the same files and lines for the same commits as before, where each
// commit's lines were carried to HEAD by `git diff <sha> HEAD`: a HEAD that is a merge commit with its own
// change, a hub file deleted and recreated inside the window, and a window whose commits reach past the
// first-parent log of the hub files (many merges). Expected values are what the fallback gave before #526.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const load = () => require('../../domains/project/conflict-map');

// one minute later on every call: the window's order does not depend on the machine's clock
function gitIn() {
  let tick = 0;
  return (cwd, ...args) => {
    tick++;
    const date = new Date(Date.UTC(2026, 0, 1) + tick * 60000).toISOString();
    return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  };
}

function tmpRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-carry-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const git = gitIn();
  git(dir, 'init', '-q');
  const names = new Map();
  // one commit of `files` ({ path: content, or null to delete }), named `label` in the assertions
  const commit = (label, files) => {
    for (const [file, text] of Object.entries(files)) {
      if (text === null) git(dir, 'rm', '-q', file);
      else { fs.writeFileSync(path.join(dir, file), text); git(dir, 'add', file); }
    }
    git(dir, 'commit', '-q', '-m', label);
    names.set(git(dir, 'rev-parse', 'HEAD'), label);
  };
  const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
  return { dir, git, commit, read, label: (sha) => names.get(sha) || sha };
}

async function linesOf(repo) {
  const map = await load().buildConflictMap({ runs: [], repo: repo.dir });
  assert.equal(map.source, 'git');
  return { map, lines: map.lines.map((l) => [l.file, l.line, l.text, l.runIds.map(repo.label)]) };
}

test('#526 the git fallback gives the same lines when HEAD is a merge commit that changes the hub file itself', async (t) => {
  const repo = tmpRepo(t);
  repo.commit('c1', { 'list.js': 'a\nb\nc\n' });
  repo.git(repo.dir, 'switch', '-q', '-c', 'side');
  repo.commit('cb', { 'list.js': 'a\nb\nC\n' });
  repo.git(repo.dir, 'switch', '-q', 'main');
  repo.commit('cm', { 'list.js': 'A\nb\nc\n' });
  repo.git(repo.dir, 'merge', '-q', '--no-commit', '--no-ff', 'side');
  fs.writeFileSync(path.join(repo.dir, 'list.js'), 'top\nA\nb\nC\n');
  repo.git(repo.dir, 'add', 'list.js');
  repo.git(repo.dir, 'commit', '-q', '-m', 'merge');
  const { map, lines } = await linesOf(repo);
  assert.deepEqual(map.files.map((f) => [f.file, f.runs]), [['list.js', 3]]);
  // c1's "a" was rewritten into two lines by the merge: it no longer counts at HEAD
  assert.deepEqual(lines, [['list.js', 4, 'C', ['cb', 'c1']]]);
});

test('#526 the git fallback gives the same lines when a hub file is deleted and recreated in the window', async (t) => {
  const repo = tmpRepo(t);
  repo.commit('c1', { 'list.js': 'a\nb\nc\n' });
  repo.commit('c2', { 'list.js': 'a\nB\nc\n' });
  repo.commit('c3', { 'list.js': null, 'other.txt': 'o\n' });
  repo.commit('c4', { 'list.js': 'a\nB\nc\n' });
  repo.commit('c5', { 'list.js': 'a\nB\nC\n' });
  const { map, lines } = await linesOf(repo);
  assert.deepEqual(map.files.map((f) => [f.file, f.runs]), [['list.js', 5], ['other.txt', 1]]);
  assert.deepEqual(lines, [
    ['list.js', 2, 'B', ['c4', 'c2', 'c1']],
    ['list.js', 3, 'C', ['c5', 'c4', 'c1']],
    ['list.js', 1, 'a', ['c4', 'c1']],
  ]);
  // every line is a line of the file at HEAD, with its text
  const head = repo.read('list.js').split('\n');
  for (const [, line, text] of lines) assert.equal(head[line - 1], text);
});

test('#526 the git fallback gives the same lines when the window reaches past the first-parent log of the hub files', { timeout: 240000 }, async (t) => {
  // about 150 git commands build the repository: under the loaded suite this took 108 s
  const repo = tmpRepo(t);
  repo.commit('c0', { 'list.js': 'm0\nmid\ns0\n' });
  // 30 merged branches: 60 commits (the window keeps the newest 50) and 30 merges on the main line
  for (let i = 1; i <= 30; i++) {
    repo.git(repo.dir, 'switch', '-q', '-c', `s${i}`);
    const [m, mid] = repo.read('list.js').split('\n');
    repo.commit(`s${i}`, { 'list.js': `${m}\n${mid}\ns${i}\n` });
    repo.git(repo.dir, 'switch', '-q', 'main');
    const [, mid2, s] = repo.read('list.js').split('\n');
    repo.commit(`m${i}`, { 'list.js': `m${i}\n${mid2}\n${s}\n` });
    repo.git(repo.dir, 'merge', '-q', '--no-edit', `s${i}`);
  }
  const { map, lines } = await linesOf(repo);
  assert.deepEqual(map.files.map((f) => [f.file, f.runs]), [['list.js', 50]]);
  const from = (prefix) => Array.from({ length: 25 }, (_, n) => `${prefix}${30 - n}`);
  assert.deepEqual(lines, [
    ['list.js', 1, 'm30', from('m')],
    ['list.js', 3, 's30', from('s')],
  ]);
});
