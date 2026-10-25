// Folder trust written into each CLI's own config (Sessions screen, folders inside the workspace).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { trustFolder, foldersToTrust } = require('../../domains/cli/cli-trust');

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(repo, '.git'));
  fs.mkdirSync(path.join(repo, 'src'));
  return { home, repo, sub: path.join(repo, 'src') };
}

test('the folder and its repository root are trusted', (t) => {
  const { repo, sub } = setup(t);
  assert.deepEqual(foldersToTrust(sub), [sub, repo]);
  assert.deepEqual(foldersToTrust(repo), [repo]);
});

test('Claude Code: projects[<path with forward slashes>].hasTrustDialogAccepted, other settings kept', (t) => {
  const { home, repo, sub } = setup(t);
  const file = path.join(home, '.claude.json');
  const key = (d) => d.replace(/\\/g, '/');
  fs.writeFileSync(file, JSON.stringify({ numStartups: 3, projects: { [key(repo)]: { allowedTools: ['x'] } } }));
  assert.equal(trustFolder('claude', sub, { home }), true);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(j.numStartups, 3);
  assert.deepEqual(j.projects[key(repo)], { allowedTools: ['x'], hasTrustDialogAccepted: true });
  assert.equal(j.projects[key(sub)].hasTrustDialogAccepted, true);
  assert.equal(trustFolder('claude', sub, { home }), false); // already trusted: file untouched
});

test('Codex and Grok: TOML tables appended once; a CLI never set up is left alone', (t) => {
  const { home, repo } = setup(t);
  assert.equal(trustFolder('codex', repo, { home }), false); // no ~/.codex
  assert.equal(trustFolder('claude', repo, { home }), false); // no ~/.claude.json
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[tui]\nx = true');
  assert.equal(trustFolder('codex', repo, { home }), true);
  assert.equal(trustFolder('codex', repo, { home }), false);
  const codex = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
  assert.ok(codex.startsWith('[tui]\nx = true\n'));
  assert.ok(codex.includes(`[projects.'${repo}']\ntrust_level = "trusted"\n`));
  fs.mkdirSync(path.join(home, '.grok'));
  assert.equal(trustFolder('grok', repo, { home }), true);
  assert.match(fs.readFileSync(path.join(home, '.grok', 'trusted_folders.toml'), 'utf8'), new RegExp(`\\[folders\\.'${repo.replace(/[\\.]/g, '\\$&')}'\\]\\ntrusted = true\\ndecided_at = \\d+`));
});

// #468 (SEC-3): only the app's own folders of the workspace are trusted automatically (runs/,
// skills/, workflows/); repos/, worktrees/ and project folders hold third-party code: the CLI keeps
// its own trust prompt there. `trustWorkspaceFolder(provider, dir, { workspace, home })` → boolean.
function workspaceSetup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(workspace, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: {} }));
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '');
  const dir = (...p) => { const d = path.join(workspace, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
  return { home, workspace, dir };
}
const claudeTrusted = (home) => Object.keys(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).projects || {});

test('trustWorkspaceFolder refuses a clone under repos/ and its .git root: nothing is written to the CLI config', (t) => {
  const { trustWorkspaceFolder } = require('../../domains/cli/cli-trust');
  const { home, workspace, dir } = workspaceSetup(t);
  const clone = dir('repos', 'someone-else');
  fs.mkdirSync(path.join(clone, '.git'));
  const sub = dir('repos', 'someone-else', 'src');
  assert.equal(trustWorkspaceFolder('claude', clone, { workspace, home }), false);
  assert.equal(trustWorkspaceFolder('claude', sub, { workspace, home }), false);
  assert.equal(trustWorkspaceFolder('codex', clone, { workspace, home }), false);
  assert.deepEqual(claudeTrusted(home), []);
  assert.equal(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), '');
});

test('trustWorkspaceFolder refuses a run\'s worktree under worktrees/ and a project folder', (t) => {
  const { trustWorkspaceFolder } = require('../../domains/cli/cli-trust');
  const { home, workspace, dir } = workspaceSetup(t);
  const wt = dir('worktrees', '20261022-201530-abcdef12');
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: elsewhere');
  assert.equal(trustWorkspaceFolder('claude', wt, { workspace, home }), false);
  assert.equal(trustWorkspaceFolder('claude', dir('projects', 'my-app'), { workspace, home }), false);
  assert.equal(trustWorkspaceFolder('codex', wt, { workspace, home }), false);
  assert.deepEqual(claudeTrusted(home), []);
});

test('trustWorkspaceFolder refuses a folder outside the workspace', (t) => {
  const { trustWorkspaceFolder } = require('../../domains/cli/cli-trust');
  const { home, workspace } = workspaceSetup(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  assert.equal(trustWorkspaceFolder('claude', outside, { workspace, home }), false);
  assert.deepEqual(claudeTrusted(home), []);
});

test('trustWorkspaceFolder refuses a sibling folder whose name starts like an app folder (runs-old/, skills2/)', (t) => {
  const { trustWorkspaceFolder } = require('../../domains/cli/cli-trust');
  const { home, workspace, dir } = workspaceSetup(t);
  assert.equal(trustWorkspaceFolder('claude', dir('runs-old', 'x'), { workspace, home }), false);
  assert.equal(trustWorkspaceFolder('claude', dir('skills2'), { workspace, home }), false);
  assert.deepEqual(claudeTrusted(home), []);
});

test('trustWorkspaceFolder never trusts the git root above an app folder (a workspace kept in a repository)', (t) => {
  const { trustWorkspaceFolder } = require('../../domains/cli/cli-trust');
  const { home, workspace, dir } = workspaceSetup(t);
  fs.mkdirSync(path.join(workspace, '.git'));
  const key = (d) => d.replace(/\\/g, '/');
  const run = dir('runs', '20261022-201530-abcdef12');
  assert.equal(trustWorkspaceFolder('claude', run, { workspace, home }), true);
  assert.deepEqual(claudeTrusted(home), [key(run)]);
  assert.equal(trustWorkspaceFolder('codex', run, { workspace, home }), true);
  const codex = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
  assert.ok(codex.includes(`[projects.'${run}']`), codex);
  assert.ok(!codex.includes(`[projects.'${workspace}']`), codex);
});

test('trustWorkspaceFolder recognises an app folder spelled with another case where the file system ignores case', { skip: !['win32', 'darwin'].includes(process.platform) }, (t) => {
  const { trustWorkspaceFolder } = require('../../domains/cli/cli-trust');
  const { home, workspace, dir } = workspaceSetup(t);
  const run = dir('runs', 'abc');
  assert.equal(trustWorkspaceFolder('claude', run.toUpperCase(), { workspace, home }), true);
  assert.equal(trustWorkspaceFolder('claude', dir('repos', 'x').replace(/repos/, 'REPOS'), { workspace, home }), false);
});

test('trustWorkspaceFolder without a workspace trusts nothing', (t) => {
  const { trustWorkspaceFolder } = require('../../domains/cli/cli-trust');
  const { home, dir } = workspaceSetup(t);
  assert.equal(trustWorkspaceFolder('claude', dir('runs', 'x'), { home }), false);
  assert.deepEqual(claudeTrusted(home), []);
});

test('trustWorkspaceFolder still trusts the app-owned folders: runs/, skills/, workflows/', (t) => {
  const { trustWorkspaceFolder } = require('../../domains/cli/cli-trust');
  const { home, workspace, dir } = workspaceSetup(t);
  const key = (d) => d.replace(/\\/g, '/');
  const owned = [dir('runs', '20261022-201530-abcdef12'), dir('skills', 'code-review'), dir('workflows')];
  for (const d of owned) assert.equal(trustWorkspaceFolder('claude', d, { workspace, home }), true, d);
  const trusted = claudeTrusted(home);
  for (const d of owned) assert.ok(trusted.includes(key(d)), `${d} in ${trusted.join(', ')}`);
});
