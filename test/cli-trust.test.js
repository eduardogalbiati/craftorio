// Folder trust written into each CLI's own config (Sessions screen, folders inside the workspace).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { trustFolder, foldersToTrust } = require('../src/cli-trust');

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
