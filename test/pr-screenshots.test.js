// skills/pr-screenshots/publish.js: a run's UI screenshots committed to the pr-screenshots branch
// and posted as one PR/MR comment. Throwaway repositories with a local bare `origin` (no network);
// gh/glab are the injected `cli` (a system boundary).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { publish, cleanup, parsePrUrl, fileUrl } = require('../skills/pr-screenshots/publish');

// No user git config (identity, hooks), as on CI: publish must bring its own identity.
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A clone with one commit on main, its bare origin, and a screenshots folder with a manifest. */
function setup(t, shots = [{ path: 'settings-after.png', caption: 'Settings > General', before: 'settings-before.png' }]) {
  const root = tmp(t, 'prshots-');
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  git(root, 'init', '-q', '--bare', origin);
  git(root, 'clone', '-q', origin, repo);
  fs.writeFileSync(path.join(repo, 'app.js'), 'console.log(1)\n');
  git(repo, 'add', 'app.js');
  git(repo, 'commit', '-q', '-m', 'app');
  git(repo, 'push', '-q', 'origin', 'HEAD:main');
  const dir = path.join(root, 'run', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of shots) for (const f of [s.path, s.before].filter(Boolean)) fs.writeFileSync(path.join(dir, f), `PNG ${f}`);
  fs.writeFileSync(path.join(dir, 'screenshots.json'), JSON.stringify(shots));
  return { origin, repo, dir };
}

/** gh/glab stand-in: answers the open PR list, records the rest. */
function fakeCli(open) {
  const calls = [];
  const cli = (cmd, args, input) => {
    calls.push({ cmd, args, input });
    if (args[1] === 'list') return JSON.stringify(open.map((n) => (cmd === 'glab' ? { iid: n } : { number: n })));
    return '';
  };
  return { cli, calls };
}

const branchFiles = (origin) => git(origin, 'ls-tree', '-r', '--name-only', 'pr-screenshots').split('\n').filter(Boolean);

test('publishes the screenshots to the PR folder of the pr-screenshots branch and comments them before/after', (t) => {
  const { origin, repo, dir } = setup(t);
  const head = git(repo, 'rev-parse', 'HEAD');
  const { cli, calls } = fakeCli([12]);

  const r = publish({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/12', dir, cwd: repo, cli });

  const files = branchFiles(origin);
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => /^12\/settings-(after|before)-[0-9a-f]{8}\.png$/.test(f)), files.join(', '));
  const after = files.find((f) => f.includes('after'));
  assert.equal(git(origin, 'show', `pr-screenshots:${after}`), 'PNG settings-after.png');
  assert.match(r.body, /\| Before \| After \|/);
  assert.ok(r.body.includes(`https://github.com/acme/app/blob/pr-screenshots/${after}?raw=true`));
  const comment = calls.find((c) => c.args[1] === 'comment');
  assert.deepEqual(comment.args, ['pr', 'comment', 'https://github.com/acme/app/pull/12', '--body-file', '-']);
  assert.equal(comment.input, r.body);
  // the checkout is untouched: same branch head, nothing staged or new
  assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
  assert.equal(git(repo, 'status', '--porcelain'), '');
});

test('a new publish replaces the PR folder and drops folders of PRs that are no longer open', (t) => {
  const { origin, repo, dir } = setup(t, [{ path: 'backlog.png', caption: 'Backlog' }]);
  publish({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/7', dir, cwd: repo, cli: fakeCli([7]).cli });
  publish({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/9', dir, cwd: repo, cli: fakeCli([7, 9]).cli });
  fs.writeFileSync(path.join(dir, 'backlog.png'), 'PNG changed');
  // PR 7 was merged meanwhile; PR 9 is published again with a new capture
  publish({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/9', dir, cwd: repo, cli: fakeCli([9]).cli });

  const files = branchFiles(origin);
  assert.equal(files.length, 1, files.join(', '));
  assert.match(files[0], /^9\/backlog-[0-9a-f]{8}\.png$/);
  assert.equal(git(origin, 'show', `pr-screenshots:${files[0]}`), 'PNG changed');
  assert.equal(git(origin, 'rev-list', '--count', 'pr-screenshots'), '3');
});

test('prunes nothing when the open PRs cannot be listed', (t) => {
  const { origin, repo, dir } = setup(t, [{ path: 'a.png', caption: 'A' }]);
  publish({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/1', dir, cwd: repo, cli: fakeCli([1]).cli });
  const failingList = (cmd, args) => { if (args[1] === 'list') throw new Error('gh: not logged in'); return ''; };
  publish({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/2', dir, cwd: repo, cli: failingList });
  assert.deepEqual(branchFiles(origin).map((f) => f.split('/')[0]).sort(), ['1', '2']);
});

test('cleanup after a merge removes the PR folder and those of closed PRs, keeping open ones', (t) => {
  const { origin, repo, dir } = setup(t, [{ path: 'a.png', caption: 'A' }]);
  for (const n of [3, 4, 5]) publish({ platform: 'gh', prUrl: `https://github.com/acme/app/pull/${n}`, dir, cwd: repo, cli: fakeCli([3, 4, 5]).cli });
  const head = git(repo, 'rev-parse', 'HEAD');

  // PR 4 was just merged, PR 3 was closed meanwhile, PR 5 is still open
  const r = cleanup({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/4', cwd: repo, cli: fakeCli([5]).cli });

  assert.deepEqual(r.removed.sort(), ['3', '4']);
  assert.equal(git(origin, 'rev-parse', 'pr-screenshots'), r.commit);
  assert.deepEqual(branchFiles(origin).map((f) => f.split('/')[0]), ['5']);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
  assert.equal(git(repo, 'status', '--porcelain'), '');
});

test('cleanup removes the merged PR folder even when the open PRs cannot be listed', (t) => {
  const { origin, repo, dir } = setup(t, [{ path: 'a.png', caption: 'A' }]);
  for (const n of [1, 2]) publish({ platform: 'gl', prUrl: `https://gitlab.com/g/app/-/merge_requests/${n}`, dir, cwd: repo, cli: fakeCli([1, 2]).cli });
  const failingList = () => { throw new Error('glab: not logged in'); };
  const r = cleanup({ platform: 'gl', prUrl: 'https://gitlab.com/g/app/-/merge_requests/2', cwd: repo, cli: failingList });
  assert.deepEqual(r.removed, ['2']);
  assert.deepEqual(branchFiles(origin).map((f) => f.split('/')[0]), ['1']);
});

test('cleanup commits nothing when there is nothing to remove, and never creates the branch', (t) => {
  const { origin, repo, dir } = setup(t, [{ path: 'a.png', caption: 'A' }]);
  assert.deepEqual(cleanup({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/8', cwd: repo, cli: fakeCli([]).cli }), { commit: null, removed: [] });
  assert.throws(() => git(origin, 'rev-parse', '--verify', 'pr-screenshots'));

  publish({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/1', dir, cwd: repo, cli: fakeCli([1]).cli });
  const before = git(origin, 'rev-parse', 'pr-screenshots');
  assert.deepEqual(cleanup({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/8', cwd: repo, cli: fakeCli([1]).cli }), { commit: null, removed: [] });
  assert.equal(git(origin, 'rev-parse', 'pr-screenshots'), before);
});

test('the --cleanup command exits 0 even when it cannot clean up (it runs right after a merge)', (t) => {
  const cwd = tmp(t, 'prshots-norepo-');
  const script = path.join(__dirname, '..', 'skills', 'pr-screenshots', 'publish.js');
  const out = execFileSync(process.execPath, [script, '--cleanup', '--platform', 'gh', '--pr-url', 'https://github.com/acme/app/issues/1'], { cwd, encoding: 'utf8' });
  assert.match(out, /cleanup skipped: not a GitHub pull request URL/);
});

test('GitLab: raw URLs under the project path and a note on the MR', (t) => {
  const { repo, dir } = setup(t, [{ path: 'run-chat.png', caption: 'Run chat' }]);
  const { cli, calls } = fakeCli([5]);
  const r = publish({ platform: 'gl', prUrl: 'https://gitlab.example.com/group/sub/app/-/merge_requests/5', dir, cwd: repo, cli });
  assert.match(r.body, /https:\/\/gitlab\.example\.com\/group\/sub\/app\/-\/raw\/pr-screenshots\/5\/run-chat-[0-9a-f]{8}\.png/);
  const note = calls.find((c) => c.args[1] === 'note');
  assert.deepEqual(note.args.slice(0, 5), ['mr', 'note', '5', '--repo', 'https://gitlab.example.com/group/sub/app']);
  assert.equal(note.args.at(-1), r.body);
});

test('refuses a manifest pointing to a missing file or a non-image, before pushing anything', (t) => {
  const { origin, repo, dir } = setup(t, [{ path: 'a.png', caption: 'A' }]);
  fs.writeFileSync(path.join(dir, 'screenshots.json'), JSON.stringify([{ path: 'gone.png', caption: 'x' }]));
  assert.throws(() => publish({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/1', dir, cwd: repo, cli: fakeCli([1]).cli }), /missing screenshot: gone\.png/);
  fs.writeFileSync(path.join(dir, 'screenshots.json'), JSON.stringify([{ path: '../../repo/app.js', caption: 'x' }]));
  assert.throws(() => publish({ platform: 'gh', prUrl: 'https://github.com/acme/app/pull/1', dir, cwd: repo, cli: fakeCli([1]).cli }), /not an image/);
  assert.throws(() => git(origin, 'rev-parse', '--verify', 'pr-screenshots'));
});

test('parsePrUrl accepts PR/MR URLs of its platform only', () => {
  assert.deepEqual(parsePrUrl('gh', 'https://github.com/acme/app/pull/42'), { host: 'github.com', project: 'acme/app', number: 42 });
  assert.deepEqual(parsePrUrl('gl', 'https://gitlab.com/a/b/c/-/merge_requests/3'), { host: 'gitlab.com', project: 'a/b/c', number: 3 });
  assert.throws(() => parsePrUrl('gh', 'https://gitlab.com/a/b/-/merge_requests/3'), /not a GitHub pull request URL/);
  assert.throws(() => parsePrUrl('gh', 'https://github.com/acme/app/issues/42'), /not a GitHub pull request URL/);
  assert.equal(fileUrl('gh', { host: 'github.com', project: 'acme/app' }, 'pr-screenshots', '4/x.png'), 'https://github.com/acme/app/blob/pr-screenshots/4/x.png?raw=true');
});
