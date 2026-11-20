// Acceptance tests for #861: pushing the local <base> when origin is the user's own repository, a
// local path (a project created from a local folder). The engine pushes (pushBase, also the
// Backlog's Push):
//   - <base> not checked out there (or origin bare): a normal push, never forced, only <base>;
//   - <base> checked out, clean, behind the clone's: fetch + merge --ff-only in the user's repository;
//   - <base> checked out with uncommitted changes, or diverged: nothing changes there, the result
//     says why and gives the commands to bring the commits over.
// Throwaway repositories in os.tmpdir(); no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const load = () => require('../domains/local/local-push');

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

// user (the user's own non-bare repository, main checked out) + clone (the workspace's clone of it,
// as the new project wizard makes from a local path), with one commit merged locally on the clone's main.
function fixture(t) {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'push-local-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const user = path.join(tmp, 'finance-app');
  const clone = path.join(tmp, 'workspace', 'repos', 'finance-app');
  fs.mkdirSync(user, { recursive: true });
  git(user, 'init', '-q', '-b', 'main');
  commit(user, 'a.txt', 'a\n', 'init');
  fs.mkdirSync(path.dirname(clone), { recursive: true });
  git(tmp, 'clone', '-q', user, clone);
  const merged = commit(clone, 'b.txt', 'b\n', 'Add b\n\nCloses #861');
  return { tmp, user, clone, merged };
}

const head = (repo, ref = 'refs/heads/main') => git(repo, 'rev-parse', ref);
// Everything the result says to a person (reason, error, commands), whatever field carries it.
const said = (r) => [r.reason, r.error, r.summary, ...[].concat(r.commands || [])].filter((x) => typeof x === 'string').join('\n');

test('local origin, main not checked out there: a normal push updates the user\'s main, his checkout is untouched', async (t) => {
  const f = fixture(t);
  git(f.user, 'checkout', '-q', '-b', 'work');
  const work = head(f.user, 'refs/heads/work');
  const { pushBase } = load();
  const r = await pushBase({ repo: f.clone, base: 'main' });
  assert.equal(r.pushed, true);
  assert.equal(head(f.user), f.merged);
  assert.equal(git(f.user, 'symbolic-ref', '--short', 'HEAD'), 'work');
  assert.equal(head(f.user, 'refs/heads/work'), work);
  assert.equal(fs.existsSync(path.join(f.user, 'b.txt')), false); // his working tree is on work
});

test('local origin, main checked out and clean: the user\'s main is fast-forwarded to the clone\'s, files included', async (t) => {
  const f = fixture(t);
  const { pushBase } = load();
  const r = await pushBase({ repo: f.clone, base: 'main' });
  assert.equal(r.pushed, true);
  assert.equal(head(f.user), f.merged);
  assert.equal(git(f.user, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.equal(fs.readFileSync(path.join(f.user, 'b.txt'), 'utf8'), 'b\n');
  assert.equal(git(f.user, 'status', '--porcelain'), '');
  assert.match(git(f.user, 'log', '-1', '--format=%s'), /^Add b$/);
});

test('local origin, main checked out and clean: other branches of the user\'s repository are not touched', async (t) => {
  const f = fixture(t);
  git(f.user, 'branch', 'other');
  const other = head(f.user, 'refs/heads/other');
  const { pushBase } = load();
  await pushBase({ repo: f.clone, base: 'main' });
  assert.equal(head(f.user, 'refs/heads/other'), other);
});

test('local origin, main checked out with uncommitted changes: nothing changes there, the reason and the commands are given', async (t) => {
  const f = fixture(t);
  const before = head(f.user);
  fs.writeFileSync(path.join(f.user, 'a.txt'), 'edited by the user\n');
  const { pushBase } = load();
  const r = await pushBase({ repo: f.clone, base: 'main' });
  assert.equal(r.pushed, false);
  assert.equal(head(f.user), before);
  assert.equal(fs.readFileSync(path.join(f.user, 'a.txt'), 'utf8'), 'edited by the user\n');
  assert.equal(fs.existsSync(path.join(f.user, 'b.txt')), false);
  const text = said(r);
  assert.match(text, /uncommitted/i);
  assert.ok(text.includes(f.clone), `the commands name the clone to fetch from: ${text}`);
  assert.match(text, /git .*fetch/);
  assert.match(text, /merge --ff-only/);
});

test('local origin, main diverged (the user committed after the clone): nothing changes there, the reason and the commands are given', async (t) => {
  const f = fixture(t);
  const mine = commit(f.user, 'u.txt', 'u\n', 'user work');
  const { pushBase } = load();
  const r = await pushBase({ repo: f.clone, base: 'main' });
  assert.equal(r.pushed, false);
  assert.equal(head(f.user), mine);
  assert.equal(fs.existsSync(path.join(f.user, 'b.txt')), false);
  assert.equal(git(f.user, 'status', '--porcelain'), '');
  const text = said(r);
  assert.match(text, /diverged/i);
  assert.ok(text.includes(f.clone), `the commands name the clone to fetch from: ${text}`);
  assert.match(text, /git .*fetch/);
});

test('a bare origin (a remote-like repository): a normal push, as before', async (t) => {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'push-bare-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'checkout', '-q', '-b', 'main');
  commit(repo, 'a.txt', 'a\n', 'init');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  const merged = commit(repo, 'b.txt', 'b\n', 'Add b');
  const { pushBase } = load();
  const r = await pushBase({ repo, base: 'main' });
  assert.equal(r.pushed, true);
  assert.equal(head(origin), merged);
});
