// #73 acceptance, written before the code: a repository with no origin is not an error for the local push
// (packages/engine/domains/local/local-push.js). Seams: localStatus and pushBase, on throwaway repositories (no network).
// With an origin nothing changes: a base origin does not have is still reported (guard).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { localStatus, pushBase } = require('../../domains/local/local-push');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function fixture(t) {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'push-no-origin-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '-q', repo);
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'Add b\n\nCloses #1');
  return { tmp, repo, head: git(repo, 'rev-parse', 'HEAD') };
}

test('#73 localStatus: a repository with no origin has no error and nothing to push', async (t) => {
  const { repo } = fixture(t);
  const s = await localStatus({ repo, base: 'main' });
  assert.deepEqual([s.error, s.ahead, s.behind], [null, 0, 0]);
});

test('#73 localStatus: a repository with no origin has no error read without a fetch, its base not given', async (t) => {
  const { repo } = fixture(t);
  const s = await localStatus({ repo, fetch: false });
  assert.deepEqual([s.error, s.base, s.ahead], [null, 'main', 0]);
});

test('#73 pushBase: a repository with no origin ends not pushed, without throwing, its base untouched', async (t) => {
  const { repo, head } = fixture(t);
  const r = await pushBase({ repo, base: 'main' });
  assert.equal(r.pushed, false);
  assert.equal(!!r.rejected, false);
  assert.equal(git(repo, 'rev-parse', 'main'), head);
});

test('#73 with an origin that does not have the base, localStatus and pushBase report it as before', async (t) => {
  const { tmp, repo } = fixture(t);
  const bare = path.join(tmp, 'origin.git');
  git(tmp, 'init', '-q', '--bare', bare);
  git(repo, 'remote', 'add', 'origin', bare);
  const s = await localStatus({ repo, base: 'main' });
  assert.match(String(s.error), /origin\/main not found/);
  await assert.rejects(() => pushBase({ repo, base: 'main' }), /origin\/main not found/);
});
