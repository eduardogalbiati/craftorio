// #79 "An imported repository can push": the clone URL follows what can push, and a clone that cannot push
// says so with the fix instead of cloning silently over HTTPS. Acceptance tests written before the code.
//
// The interface these tests assume (packages/engine/domains/workspace/workspace.js):
// - cloneRepo(url, reposDir, { run, ghProtocol, credentialHelper }):
//   - ghProtocol: gh's git_protocol ('ssh' | 'https'), injected instead of reading `gh config get git_protocol`.
//   - credentialHelper: the credential helper git would use for the host (a string, e.g. gh's
//     `auth git-credential`), or null when there is none; injected instead of reading git/gh.
//   - ghProtocol 'ssh' + a github.com HTTPS URL → git is asked to clone git@github.com:<owner>/<repo>.git.
//   - ghProtocol 'https' + no credential helper → never a silent HTTPS clone that cannot push: either the
//     promise rejects with a message naming `gh auth setup-git`, or it resolves with push === false and a
//     `fix` naming `gh auth setup-git`.
//   - ghProtocol 'https' + a credential helper → clones the HTTPS URL, push is not false.
// - checkPushAccess(dir, { run }) → Promise<{ ok: boolean, fix?: string }>: runs `git push --dry-run` (through
//   `run(args, cwd)`), used by the import wizard before it ends and by a Remote/Fork run before its first
//   agent turn. A "could not read Username" failure → ok false, fix names `gh auth setup-git`; an SSH
//   "Permission denied (publickey)" → ok false with a fix naming ssh; success → ok true.
// New symbols are read inside each test so a missing one fails that test, not the file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/workspace/workspace');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-clone-79-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function recorder() {
  const calls = [];
  const run = async (args, cwd) => { calls.push({ args: [...args], cwd }); return ''; };
  return { calls, run };
}

const cloneCall = (calls) => calls.find((c) => c.args.includes('clone'));

test('#79 cloneRepo: gh git_protocol ssh clones a github.com HTTPS URL over SSH (git@github.com:owner/repo.git)', async (t) => {
  const { cloneRepo } = load();
  const { calls, run } = recorder();
  await cloneRepo('https://github.com/acme/tool.git', path.join(tmpDir(t), 'repos'), { run, ghProtocol: 'ssh', credentialHelper: null });
  const c = cloneCall(calls);
  assert.ok(c, 'git clone was run');
  assert.equal(c.args.includes('git@github.com:acme/tool.git'), true, `clone args: ${c.args.join(' ')}`);
  assert.equal(c.args.includes('https://github.com/acme/tool.git'), false);
});

test('#79 cloneRepo: an SSH URL with gh git_protocol ssh is cloned as given', async (t) => {
  const { cloneRepo } = load();
  const { calls, run } = recorder();
  const res = await cloneRepo('git@github.com:acme/tool.git', path.join(tmpDir(t), 'repos'), { run, ghProtocol: 'ssh', credentialHelper: null });
  const c = cloneCall(calls);
  assert.equal(c.args.includes('git@github.com:acme/tool.git'), true, `clone args: ${c.args.join(' ')}`);
  assert.notEqual(res.push, false);
});

test('#79 cloneRepo: an HTTPS clone without a credential helper is not silent: it names `gh auth setup-git`', async (t) => {
  const { cloneRepo } = load();
  const { run } = recorder();
  let outcome;
  try {
    const res = await cloneRepo('https://github.com/acme/tool.git', path.join(tmpDir(t), 'repos'), { run, ghProtocol: 'https', credentialHelper: null });
    outcome = { rejected: false, push: res.push, text: String(res.fix || '') };
  } catch (e) {
    outcome = { rejected: true, push: false, text: String(e?.message || e) };
  }
  assert.equal(outcome.push, false, 'the clone reports it cannot push (push === false or a rejection)');
  assert.match(outcome.text, /gh auth setup-git/);
});

test('#79 cloneRepo: an HTTPS clone with gh as credential helper clones the HTTPS URL and can push', async (t) => {
  const { cloneRepo } = load();
  const { calls, run } = recorder();
  const res = await cloneRepo('https://github.com/acme/tool.git', path.join(tmpDir(t), 'repos'), {
    run, ghProtocol: 'https', credentialHelper: "!'gh' auth git-credential",
  });
  const c = cloneCall(calls);
  assert.equal(c.args.includes('https://github.com/acme/tool.git'), true, `clone args: ${c.args.join(' ')}`);
  assert.notEqual(res.push, false);
});

test('#79 checkPushAccess: runs git push --dry-run in the clone and reports ok on success', async (t) => {
  const { checkPushAccess } = load();
  assert.equal(typeof checkPushAccess, 'function', 'workspace.checkPushAccess is exported');
  const dir = tmpDir(t);
  const { calls, run } = recorder();
  const res = await checkPushAccess(dir, { run });
  const push = calls.find((c) => c.args.includes('push'));
  assert.ok(push, 'git push was run');
  assert.equal(push.args.includes('--dry-run'), true, `push args: ${push.args.join(' ')}`);
  assert.equal(push.cwd, dir);
  assert.equal(res.ok, true);
});

test('#79 checkPushAccess: "could not read Username" fails fast with the fix `gh auth setup-git`', async (t) => {
  const { checkPushAccess } = load();
  assert.equal(typeof checkPushAccess, 'function', 'workspace.checkPushAccess is exported');
  const run = async (args) => {
    if (args.includes('push')) throw new Error("git push failed: fatal: could not read Username for 'https://github.com': terminal prompts disabled");
    return '';
  };
  const res = await checkPushAccess(tmpDir(t), { run });
  assert.equal(res.ok, false);
  assert.match(String(res.fix || ''), /gh auth setup-git/);
});

test('#79 checkPushAccess: an SSH "Permission denied (publickey)" fails with a fix about SSH keys', async (t) => {
  const { checkPushAccess } = load();
  assert.equal(typeof checkPushAccess, 'function', 'workspace.checkPushAccess is exported');
  const run = async (args) => {
    if (args.includes('push')) throw new Error('git push failed: git@github.com: Permission denied (publickey).');
    return '';
  };
  const res = await checkPushAccess(tmpDir(t), { run });
  assert.equal(res.ok, false);
  assert.match(String(res.fix || ''), /ssh/i);
});
