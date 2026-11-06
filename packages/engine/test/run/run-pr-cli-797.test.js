// #797: the read of a PR through the CLI itself (packages/engine/domains/run/run-pr.js readJson): the other tests
// stand in for it with a reader. Here a fake gh or glab on the PATH is a real process: it gets the real arguments and
// answers on its stdout, stderr and exit code. The JSON it prints is the shape of `gh pr view --json` and of
// `glab mr view --output json`; nothing here reaches a platform, so the real CLIs' fields stay unproved.
//
// The scripts need an executable bit and #!/bin/sh: macOS and Linux only, as in cli-lookup-316.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCommand } = require('../../engine/providers');
const { fetchPrState, prCache } = require('../../domains/run/run-pr');

const POSIX = { skip: process.platform === 'win32' ? 'needs a shell script as the CLI' : false };
const SHA = '797ddd0000000000000000000000000000000004';
const PR = { number: 7, url: 'https://github.com/o/r/pull/7' };
const MR = { number: 7, url: 'https://gitlab.com/g/s/r/-/merge_requests/7' };

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-pr-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// `cli` first on the PATH for this test → reads what it was called with. The login shell's PATH is merged once per
// process and goes first (providers.js): it happens here, before the fake folder, so a real gh never wins over it.
function fakeCli(t, cli, { stdout = '', stderr = '', code = 0 }) {
  resolveCommand(cli);
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'out'), stdout);
  fs.writeFileSync(path.join(dir, 'err'), stderr);
  fs.writeFileSync(path.join(dir, cli), `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\ncat "${dir}/out"\ncat "${dir}/err" >&2\nexit ${code}\n`, { mode: 0o755 });
  const realPath = process.env.PATH;
  process.env.PATH = [dir, realPath].join(path.delimiter);
  t.after(() => { process.env.PATH = realPath; });
  return () => fs.readFileSync(path.join(dir, 'args'), 'utf8').trim().split('\n');
}

test('#797 gh: a merged PR is read through the CLI with its merge commit, asked for on the PR\'s repository', POSIX, async (t) => {
  const args = fakeCli(t, 'gh', { stdout: JSON.stringify({ state: 'MERGED', mergeCommit: { oid: SHA } }) });
  const read = await fetchPrState(PR);
  assert.deepEqual([read.state, read.mergedCommit], ['merged', SHA]);
  assert.deepEqual(args().slice(0, 5), ['pr', 'view', '7', '--repo', 'github.com/o/r']);
  assert.equal(args()[5], '--json');
  assert.ok(args()[6].split(',').includes('mergeCommit'), args()[6]);
});

test('#797 gh: a PR of a Fork + PR project is asked for on the upstream its URL names', POSIX, async (t) => {
  const args = fakeCli(t, 'gh', { stdout: JSON.stringify({ state: 'OPEN', isDraft: false, statusCheckRollup: [] }) });
  await fetchPrState({ number: 9, url: 'https://github.com/up/r/pull/9' });
  assert.deepEqual(args().slice(2, 5), ['9', '--repo', 'github.com/up/r']);
});

test('#797 glab: a squashed MR is read through the CLI with its squash commit, on its whole subgroup path', POSIX, async (t) => {
  const args = fakeCli(t, 'glab', { stdout: JSON.stringify({ state: 'merged', merge_commit_sha: null, squash_commit_sha: SHA }) });
  const read = await fetchPrState(MR);
  assert.deepEqual([read.state, read.mergedCommit], ['merged', SHA]);
  assert.deepEqual(args(), ['mr', 'view', '7', '--repo', 'https://gitlab.com/g/s/r', '--output', 'json']);
});

test('#797 a CLI output that starts with a byte order mark is read', POSIX, async (t) => {
  fakeCli(t, 'gh', { stdout: `﻿${JSON.stringify({ state: 'CLOSED' })}` });
  assert.equal((await fetchPrState(PR)).state, 'closed');
});

test('#797 a CLI that fails: the read says what it printed, and the cache keeps the PR unknown', POSIX, async (t) => {
  fakeCli(t, 'gh', { stderr: 'HTTP 401: Bad credentials\n', code: 1 });
  await assert.rejects(fetchPrState(PR), /^Error: gh: HTTP 401: Bad credentials$/);
  const read = await prCache().refresh(PR);
  assert.equal(read.state, 'unknown');
  assert.match(read.detail, /could not read the PR: gh: HTTP 401: Bad credentials/);
});

test('#797 a CLI that prints something else than JSON is a failed read, never a state', POSIX, async (t) => {
  fakeCli(t, 'glab', { stdout: 'A new version of glab is available\n' });
  await assert.rejects(fetchPrState(MR), /glab: the output is not JSON/);
  const read = await prCache().refresh(MR);
  assert.equal(read.state, 'unknown');
  assert.match(read.detail, /could not read the PR: glab: the output is not JSON/);
});

test('#797 a machine without the CLI: the cache keeps the PR unknown and says it is not installed', POSIX, async (t) => {
  resolveCommand('gh'); // the login shell's PATH merges now, not into the empty PATH below
  const [realPath, realHome] = [process.env.PATH, process.env.HOME];
  t.after(() => { process.env.PATH = realPath; process.env.HOME = realHome; });
  process.env.PATH = tmp(t);
  process.env.HOME = tmp(t);
  if (resolveCommand('gh')) return t.skip('gh sits in a known install folder of this machine');
  const read = await prCache().refresh(PR);
  assert.equal(read.state, 'unknown');
  assert.match(read.detail, /could not read the PR: gh is not installed/);
});
