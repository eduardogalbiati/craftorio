// #116 internals: the writable roots reach only a writing Codex turn (Claude's flags do not change), and
// commitCount counts the run's own commits (zero at the base).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const capabilities = require('../engine/capabilities');
const { commitCount, commitRange } = require('../engine/secret-scan');

const roots = ['/r/.git/worktrees/x', '/r/.git'];
const writer = capabilities.normalize({ tools: ['read', 'edit', 'write', 'bash:git'] });

test('#116: Claude Code flags are the same with or without writable roots', () => {
  const without = capabilities.providerArgs('claude-code', { caps: writer });
  const withRoots = capabilities.providerArgs('claude-code', { caps: writer, writableRoots: roots });
  assert.deepEqual(withRoots.args, without.args);
});

test('#116: a writing Codex turn gets its writable roots as one TOML array; none without roots', () => {
  const { args } = capabilities.providerArgs('codex-cli', { caps: writer, writableRoots: roots });
  assert.ok(args.includes('sandbox_workspace_write.writable_roots=["/r/.git/worktrees/x","/r/.git"]'));
  const none = capabilities.providerArgs('codex-cli', { caps: writer }).args;
  assert.equal(none.some((a) => a.startsWith('sandbox_workspace_write')), false);
});

test('#116: commitCount is 0 at the base and 1 after a commit', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'count-116-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@e.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'base');
  git('switch', '-q', '-c', 'feat');
  assert.equal(await commitCount(dir, await commitRange(dir, { refs: ['refs/heads/main'] })), 0);
  git('-c', 'user.email=t@e.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'change');
  assert.equal(await commitCount(dir, await commitRange(dir, { refs: ['refs/heads/main'] })), 1);
});
