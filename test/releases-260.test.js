// Releases (#260), src/releases.js: release notes generated from the release's issues and runs
// (`releaseNotes`), shipping marks the release's issues and their linked discovery cards Released
// (`markReleased`, pure), and Ship pushes the local base branch and a tag (`shipRelease`). Nothing
// pushes without Ship: building the notes or marking never touches origin. Throwaway repositories
// in os.tmpdir() with a local bare repository as `origin` (no network), as in test/local-push.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const load = () => {
  delete require.cache[require.resolve('../src/releases')];
  return require('../src/releases');
};

// No user git config (identity, hooks, aliases), as on CI.
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function commit(cwd, file, text, msg = file) {
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

// origin (bare) + repo (the workspace clone, main checked out) with one local commit not pushed
function fixture(t) {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'release-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '-q', '--bare', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'checkout', '-q', '-b', 'main');
  commit(repo, 'a.txt', 'a\n', 'init');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  const local = commit(repo, 'b.txt', 'b\n', 'Add a /health endpoint (#12)');
  return { tmp, origin, repo, local };
}

const originHead = (f) => git(f.origin, 'rev-parse', 'refs/heads/main');

const RELEASE = {
  version: 'v1.2.0',
  issues: [{ number: 12, title: 'Add a /health endpoint' }, { number: 14, title: 'Show the queue size' }],
  runs: [{ runId: 'r1', workflow: 'ai-development', cost: 1.5 }, { runId: 'r2', workflow: 'ai-development', cost: 2 }, { runId: 'r3', workflow: 'release', cost: 1 }],
};

// ---- releaseNotes -------------------------------------------------------------------------------

test('releaseNotes: Markdown with the version, each issue as #<number> with its title, and the number of runs (#260)', () => {
  const { releaseNotes } = load();
  const notes = releaseNotes(RELEASE);
  assert.equal(typeof notes, 'string');
  assert.ok(notes.includes('v1.2.0'), 'the version');
  assert.ok(notes.includes('#12') && notes.includes('Add a /health endpoint'), 'issue #12 with its title');
  assert.ok(notes.includes('#14') && notes.includes('Show the queue size'), 'issue #14 with its title');
  assert.match(notes, /\b3\b/, 'the number of runs');
});

test('releaseNotes: a release without issues still names its version (#260)', () => {
  const { releaseNotes } = load();
  const notes = releaseNotes({ version: 'v0.9', issues: [], runs: [] });
  assert.equal(typeof notes, 'string');
  assert.ok(notes.includes('v0.9'));
});

// ---- markReleased ---------------------------------------------------------------------------------

test('markReleased: the release\'s issues and their linked discovery cards become Released; the rest and the inputs stay (#260)', () => {
  const { markReleased } = load();
  const issues = [{ number: 12, title: 'A', status: 'done' }, { number: 13, title: 'B', status: 'open' }, { number: 14, title: 'C', status: 'done' }];
  const cards = [
    { id: 'c1', title: 'Health checks', issues: [12, 20], status: 'delivery' },
    { id: 'c2', title: 'Refunds', issues: [13], status: 'delivery' },
    { id: 'c3', title: 'Queue', issues: [14], status: 'delivery' },
    { id: 'c4', title: 'Idea', issues: [], status: 'idea' },
  ];
  const before = JSON.stringify({ issues, cards });
  const out = markReleased({ issues, cards }, { version: 'v1.2.0', issues: [12, 14] });

  assert.deepEqual(out.issues, [
    { number: 12, title: 'A', status: 'released', released: 'v1.2.0' },
    { number: 13, title: 'B', status: 'open' },
    { number: 14, title: 'C', status: 'released', released: 'v1.2.0' },
  ]);
  assert.deepEqual(out.cards, [
    { id: 'c1', title: 'Health checks', issues: [12, 20], status: 'released', released: 'v1.2.0' },
    { id: 'c2', title: 'Refunds', issues: [13], status: 'delivery' },
    { id: 'c3', title: 'Queue', issues: [14], status: 'released', released: 'v1.2.0' },
    { id: 'c4', title: 'Idea', issues: [], status: 'idea' },
  ]);
  assert.equal(JSON.stringify({ issues, cards }), before, 'the inputs are unchanged');
});

// ---- shipRelease / nothing pushes without Ship -----------------------------------------------------

test('shipRelease: pushes the local base to origin and a tag at it (#260)', async (t) => {
  const { shipRelease } = load();
  const f = fixture(t);
  assert.notEqual(originHead(f), f.local);
  const result = await shipRelease({ repo: f.repo, base: 'main', tag: 'v1.2.0' });
  assert.equal(result.tag, 'v1.2.0');
  assert.equal(originHead(f), f.local, 'origin/main is the local main');
  assert.equal(git(f.origin, 'rev-parse', 'refs/tags/v1.2.0^{commit}'), f.local, 'origin has the tag at that commit');
});

test('building the notes and marking the release push nothing: origin stays behind until Ship (#260)', async (t) => {
  const { releaseNotes, markReleased } = load();
  const f = fixture(t);
  const pushedBefore = originHead(f);
  const notes = releaseNotes(RELEASE);
  markReleased({ issues: [{ number: 12, title: 'A' }], cards: [] }, { version: 'v1.2.0', issues: [12] });
  assert.ok(notes.includes('v1.2.0'));
  assert.equal(originHead(f), pushedBefore, 'origin/main has not moved');
  assert.notEqual(originHead(f), f.local, 'the local commit is not on origin');
  assert.equal(git(f.origin, 'tag', '--list'), '', 'no tag on origin');
});
