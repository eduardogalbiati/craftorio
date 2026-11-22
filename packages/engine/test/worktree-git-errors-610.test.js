// #610: the error a failing git command raises (git() in packages/engine/engine/worktree.js) names
// the git command past the `-c key=value` pairs in front of it (identityArgs), and keeps git's own
// stderr lines over the warnings Git for Windows' bash prints first (no /tmp); a stderr made only
// of such warnings is kept whole. Throwaway repositories from test/worktree-helpers.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { git } = require('../engine/worktree');
const { fixture, git: gitSync } = require('./worktree-helpers');

const failure = (p) => p.then(() => assert.fail('the git command should fail'), (e) => String(e.message));

function hook(repo, name, body) {
  const hooks = path.resolve(repo, gitSync(repo, 'rev-parse', '--git-path', 'hooks'));
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(hooks, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function stage(repo) {
  fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');
  gitSync(repo, 'add', 'new.txt');
}

const WARNING = 'bash.exe: warning: could not find /tmp, please create!';

test('#610 git: an error with -c pairs in front names the git command, not -c', async (t) => {
  const f = fixture(t);
  const msg = await failure(git(['-c', 'user.name=Craftorio', '-c', 'user.email=orchestrator@localhost', 'rev-parse', '--verify', 'refs/heads/no-such-branch'], f.repo));
  assert.match(msg, /^git rev-parse failed: /);
  assert.doesNotMatch(msg, /git -c failed/);
});

test('#610 git: an error without -c pairs names its first argument, as before', async (t) => {
  const f = fixture(t);
  const msg = await failure(git(['rev-parse', '--verify', 'refs/heads/no-such-branch'], f.repo));
  assert.match(msg, /^git rev-parse failed: /);
});

test('#610 git: a hook\'s shell warning before its own line is dropped; the line that says why stays', async (t) => {
  const f = fixture(t);
  hook(f.repo, 'pre-commit', `echo "${WARNING}" >&2\necho "the hook says no" >&2\nexit 1`);
  stage(f.repo);
  const msg = await failure(git(['-c', 'user.name=x', '-c', 'user.email=x@localhost', 'commit', '-q', '-m', 'blocked'], f.repo));
  assert.match(msg, /^git commit failed: the hook says no/);
  assert.doesNotMatch(msg, /could not find \/tmp/);
});

test('#610 git: a stderr made only of shell warnings is kept whole in the error', async (t) => {
  const f = fixture(t);
  hook(f.repo, 'pre-commit', `echo "${WARNING}" >&2\nexit 1`);
  stage(f.repo);
  const msg = await failure(git(['-c', 'user.name=x', '-c', 'user.email=x@localhost', 'commit', '-q', '-m', 'blocked'], f.repo));
  assert.match(msg, /^git commit failed: .*bash\.exe: warning: could not find \/tmp, please create!/);
});
