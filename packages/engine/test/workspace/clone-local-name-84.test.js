// #84 A local-path import clones into a folder named after the repository (<reposDir>/eslint-js), not
// repos-eslint-js; a suffix only when that folder is already taken (non-git and non-empty, or a different
// repository). GitHub/GitLab URLs keep owner-name. Acceptance tests written before the code.
//
// Assumed interface: cloneRepo(url, reposDir, { run }) as today; a taken folder no longer rejects, the clone
// goes to a sibling folder whose name starts with the repository name (e.g. eslint-js-2).
// The "different repository" case uses real local git repos (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const load = () => require('../../domains/workspace/workspace');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-clone-84-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function recorder() {
  const calls = [];
  const run = async (args, cwd) => { calls.push({ args: [...args], cwd }); return ''; };
  return { calls, run };
}

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString();

test('#84 cloneRepo: a local path clones into <reposDir>/eslint-js', async (t) => {
  const { cloneRepo } = load();
  const reposDir = path.join(tmpDir(t), 'repos');
  const { run } = recorder();
  const res = await cloneRepo('/any/path/eslint-js', reposDir, { run });
  assert.equal(res.dir, path.join(reposDir, 'eslint-js'));
});

test('#84 cloneRepo: GitHub and GitLab URLs keep owner-name', async (t) => {
  const { cloneRepo } = load();
  const reposDir = path.join(tmpDir(t), 'repos');
  const { run } = recorder();
  const gh = await cloneRepo('https://github.com/acme/tool.git', reposDir, { run });
  const gl = await cloneRepo('git@gitlab.com:grp/tool.git', reposDir, { run });
  assert.equal(path.basename(gh.dir), 'acme-tool');
  assert.equal(path.basename(gl.dir), 'grp-tool');
});

test('#84 cloneRepo: a non-git, non-empty eslint-js folder gets a suffixed sibling instead of an error', async (t) => {
  const { cloneRepo } = load();
  const reposDir = path.join(tmpDir(t), 'repos');
  fs.mkdirSync(path.join(reposDir, 'eslint-js'), { recursive: true });
  fs.writeFileSync(path.join(reposDir, 'eslint-js', 'notes.txt'), 'mine');
  const { calls, run } = recorder();
  const res = await cloneRepo('/any/path/eslint-js', reposDir, { run });
  const name = path.basename(res.dir);
  assert.equal(name.startsWith('eslint-js'), true, name);
  assert.notEqual(name, 'eslint-js');
  assert.equal(path.dirname(res.dir), reposDir);
  assert.equal(calls.some((c) => c.args.includes('clone')), true);
  assert.equal(fs.readFileSync(path.join(reposDir, 'eslint-js', 'notes.txt'), 'utf8'), 'mine');
});

test('#84 cloneRepo: an eslint-js folder holding a different repository gets a suffixed sibling', async (t) => {
  const { cloneRepo } = load();
  const root = tmpDir(t);
  const source = path.join(root, 'src', 'eslint-js');
  const other = path.join(root, 'other', 'eslint-js');
  for (const dir of [source, other]) {
    fs.mkdirSync(dir, { recursive: true });
    git(['init', '-q'], dir);
    fs.writeFileSync(path.join(dir, 'README.md'), path.basename(path.dirname(dir)));
    git(['add', '.'], dir);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], dir);
  }
  const reposDir = path.join(root, 'repos');
  fs.mkdirSync(reposDir, { recursive: true });
  git(['clone', '-q', other, path.join(reposDir, 'eslint-js')], reposDir);

  const res = await cloneRepo(source, reposDir);
  const name = path.basename(res.dir);
  assert.equal(name.startsWith('eslint-js'), true, name);
  assert.notEqual(name, 'eslint-js');
  assert.equal(fs.readFileSync(path.join(res.dir, 'README.md'), 'utf8'), 'src');
  assert.equal(fs.readFileSync(path.join(reposDir, 'eslint-js', 'README.md'), 'utf8'), 'other');
});
