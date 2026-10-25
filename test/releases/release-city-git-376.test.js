// #376: a release on the project city, the main-process side, src/domains/releases/release-city.js (git). Exports:
// - readReleaseCity(folder, { from, to, plan = null, exclude = [] }) → Promise<{ state: 'ok', from, to,
//   base: { model, validation }, changes: [{ status, path, from?, lines }], commits: [{ commit,
//   subject, issues, files }] }>:
//   - base = the project city built from the tree and the facts AT `from` (git ls-tree at that ref),
//     with the plan's rules (CityModel.buildCity's shape: base.model.buildings[].path): a file added
//     after `from` has no building; a file removed since `from` still has one; a renamed file has a
//     building under its old path;
//   - changes = `git diff --name-status -M from..to` (renames followed: one 'renamed' entry, never a
//     removed + added pair), lines = the file's added + deleted lines (numstat);
//   - commits = the commits of from..to (not `from` itself): subject, issues = CityRelease.issuesOf
//     of the message, files = the paths the commit touched;
//   - from/to are any commit-ish (tags or SHAs: a project without tags picks two commits);
//   - a folder that is not a git repository → state 'not-git'; an unknown ref → a state other than
//     'ok'; never a throw.
// - previousTag(folder, tag) → Promise of the tag right before `tag` in semver order among the repo's
//   tags (a leading 'v' accepted), null for the first tag.
// - listTags(folder) → Promise of the repo's tags, newest (semver) first (the two-tag picker).
// A temp git repo; lizard made unavailable by stubbing src/engine/providers.js for 'lizard' only, with
// src/domains/releases/release-city.js and src/domains/project/architecture-facts.js loaded afresh. The module is created by the
// change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const plain = (x) => JSON.parse(JSON.stringify(x));
const lines = (n, word) => Array.from({ length: n }, (_, i) => `const ${word}${i} = '${word} line ${i}';`).join('\n') + '\n';

// v1.1.0: keep, old, moved, edit; 1.1.1: keep edited; 1.1.2: three commits (#12 adds new.js, #13
// removes old.js and edits edit.js by +3 -1, #12 renames src/moved.js to lib/moved.js unchanged);
// 1.1.10: keep edited again (semver, not text, order: 1.1.10 is after 1.1.2)
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel376-'));
  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  const git = (args) => String(execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'core.autocrlf=false', '-c', 'tag.gpgSign=false', '-c', 'commit.gpgSign=false', ...args], { cwd: dir, windowsHide: true, stdio: 'pipe', env })).trim();
  const write = (file, text) => {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const commit = (message) => { git(['add', '-A']); git(['commit', '-q', '-m', message]); return git(['rev-parse', 'HEAD']); };
  git(['init', '-q', '-b', 'main']);
  write('src/keep.js', lines(3, 'keep'));
  write('src/old.js', 'module.exports = function legacyHelper() {\n  return 42;\n');
  write('src/moved.js', lines(6, 'moved'));
  write('src/edit.js', lines(4, 'edit'));
  const c0 = commit('Start');
  git(['tag', 'v1.1.0']);
  write('src/keep.js', lines(4, 'keep'));
  const c1 = commit('Keep more');
  git(['tag', '1.1.1']);
  write('src/new.js', 'export const fresh = 1;\nexport const brandNew = 2;\nexport function sum(a, b) {\n  return a + b;\n}\n');
  commit('Add the new module (#12)');
  fs.rmSync(path.join(dir, 'src', 'old.js'));
  write('src/edit.js', `${lines(3, 'edit')}const extraA = 1;\nconst extraB = 2;\nconst extraC = 3;\n`);
  commit('Remove old, edit (#13)');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  git(['mv', 'src/moved.js', 'lib/moved.js']);
  const c2 = commit('Move moved.js (#12)');
  git(['tag', '1.1.2']);
  write('src/keep.js', lines(5, 'keep'));
  commit('Keep even more');
  git(['tag', '1.1.10']);
  return { dir, shas: { c0, c1, c2 } };
}

// src/domains/releases/release-city.js (and the facts it reads) loaded afresh with lizard not installed; restored afterwards
function releaseCity(t) {
  const providers = require('../../src/engine/providers');
  const { resolveCommand, resolveCommandAsync } = providers;
  providers.resolveCommand = (cmd, ...rest) => (/^lizard/i.test(String(cmd)) ? null : resolveCommand(cmd, ...rest));
  providers.resolveCommandAsync = async (cmd, ...rest) => (/^lizard/i.test(String(cmd)) ? null : resolveCommandAsync(cmd, ...rest));
  const ids = [require.resolve('../../src/domains/project/architecture-facts')];
  for (const id of ids) delete require.cache[id];
  const mod = require('../../src/domains/releases/release-city.js');
  ids.push(require.resolve('../../src/domains/releases/release-city.js'));
  t.after(() => {
    providers.resolveCommand = resolveCommand;
    providers.resolveCommandAsync = resolveCommandAsync;
    for (const id of ids) delete require.cache[id];
  });
  return mod;
}

function repo(t) {
  const r = makeRepo();
  t.after(() => fs.rmSync(r.dir, { recursive: true, force: true }));
  return r;
}

async function release(t, opts = { from: '1.1.1', to: '1.1.2' }) {
  const { dir } = repo(t);
  const { readReleaseCity } = releaseCity(t);
  const out = plain(await readReleaseCity(dir, opts));
  assert.equal(out.state, 'ok', JSON.stringify(out).slice(0, 300));
  return out;
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

test('#376 readReleaseCity: the changes between two tags, a rename followed, with the lines changed per file', async (t) => {
  const out = await release(t);
  assert.equal(out.from, '1.1.1');
  assert.equal(out.to, '1.1.2');
  assert.deepEqual(out.changes.slice().sort(byPath), [
    { status: 'renamed', from: 'src/moved.js', path: 'lib/moved.js', lines: 0 },
    { status: 'changed', path: 'src/edit.js', lines: 4 },
    { status: 'added', path: 'src/new.js', lines: 5 },
    { status: 'removed', path: 'src/old.js', lines: 2 },
  ]);
});

test('#376 readReleaseCity: the base city is the tree at the previous tag', async (t) => {
  const out = await release(t);
  const paths = out.base.model.buildings.map((b) => b.path).sort();
  assert.deepEqual(paths, ['src/edit.js', 'src/keep.js', 'src/moved.js', 'src/old.js']);
  const keep = out.base.model.buildings.find((b) => b.path === 'src/keep.js');
  assert.equal(keep.lines, 4, 'the lines as they were at 1.1.1, not at HEAD');
});

test('#376 readReleaseCity: the base city follows the plan\'s rules', async (t) => {
  const plan = {
    version: 1, project: 'fixture', summary: 'A fixture.', ignore: [],
    zones: [{ id: 'core', name: 'Core', kind: 'industrial', purpose: 'x' }],
    districts: [
      { id: 'legacy', name: 'Legacy', zone: 'core', purpose: 'x', include: ['/src/old.js'], exclude: [] },
      { id: 'sources', name: 'Sources', zone: 'core', purpose: 'x', include: ['/src/**', '/lib/**'], exclude: [] },
    ],
    landmarks: [], ports: [], evidence: [],
  };
  const out = await release(t, { from: '1.1.1', to: '1.1.2', plan });
  const of = Object.fromEntries(out.base.model.buildings.map((b) => [b.path, b.district]));
  assert.deepEqual(of, { 'src/edit.js': 'sources', 'src/keep.js': 'sources', 'src/moved.js': 'sources', 'src/old.js': 'legacy' });
});

test('#376 readReleaseCity: the commits of the release with their subject, issues and files', async (t) => {
  const out = await release(t);
  const commits = out.commits.slice().sort((a, b) => (a.subject < b.subject ? -1 : 1));
  assert.deepEqual(commits.map((c) => c.subject), ['Add the new module (#12)', 'Move moved.js (#12)', 'Remove old, edit (#13)']);
  for (const c of commits) assert.match(String(c.commit), /^[0-9a-f]{7,40}$/);
  assert.deepEqual(commits.map((c) => c.issues), [[12], [12], [13]]);
  assert.deepEqual(commits[0].files, ['src/new.js']);
  assert.deepEqual(commits[2].files.slice().sort(), ['src/edit.js', 'src/old.js']);
  assert.ok(commits[1].files.includes('lib/moved.js') || commits[1].files.includes('src/moved.js'), `the move commit touched moved.js: ${commits[1].files}`);
});

test('#376 readReleaseCity: a project without tags compares two commits', async (t) => {
  const { dir, shas } = repo(t);
  const { readReleaseCity } = releaseCity(t);
  const out = plain(await readReleaseCity(dir, { from: shas.c0, to: shas.c1 }));
  assert.equal(out.state, 'ok');
  assert.deepEqual(out.changes, [{ status: 'changed', path: 'src/keep.js', lines: 1 }]);
  assert.deepEqual(out.commits.map((c) => c.subject), ['Keep more']);
});

test('#376 readReleaseCity: a folder that is not a git repository is not-git', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel376-plain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { readReleaseCity } = releaseCity(t);
  const out = await readReleaseCity(dir, { from: '1.1.1', to: '1.1.2' });
  assert.equal(out.state, 'not-git');
});

test('#376 readReleaseCity: an unknown ref is a state, not a throw', async (t) => {
  const { dir } = repo(t);
  const { readReleaseCity } = releaseCity(t);
  const out = await readReleaseCity(dir, { from: '9.9.9', to: '1.1.2' });
  assert.equal(typeof out.state, 'string');
  assert.notEqual(out.state, 'ok');
});

test('#376 previousTag: the tag right before, in semver order, a leading v accepted; null for the first', async (t) => {
  const { dir } = repo(t);
  const { previousTag } = releaseCity(t);
  assert.equal(await previousTag(dir, '1.1.2'), '1.1.1');
  assert.equal(await previousTag(dir, '1.1.10'), '1.1.2');
  assert.equal(await previousTag(dir, '1.1.1'), 'v1.1.0');
  assert.equal(await previousTag(dir, 'v1.1.0'), null);
});

test('#376 listTags: the repository\'s tags, newest first in semver order', async (t) => {
  const { dir } = repo(t);
  const { listTags } = releaseCity(t);
  assert.deepEqual(plain(await listTags(dir)), ['1.1.10', '1.1.2', '1.1.1', 'v1.1.0']);
});
