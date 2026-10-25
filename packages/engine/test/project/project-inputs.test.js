// What the app knows about a project for a workflow's inputs (packages/engine/domains/project/project-inputs.js, #116): the
// language detected from its files, and its local git branches with a default one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { detectLanguage, listBranches, inputHints } = require('../../domains/project/project-inputs');

// No user git config (identity, hooks, aliases), as on CI.
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-inputs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const write = (dir, ...files) => { for (const f of files) fs.writeFileSync(path.join(dir, f), ''); };

// ---- detectLanguage -------------------------------------------------------------------------

test('detectLanguage: one marker file per language', (t) => {
  const cases = [
    ['go.mod', 'go'],
    ['pom.xml', 'java'],
    ['build.gradle', 'java'],
    ['app.csproj', 'csharp'],
    ['x.sln', 'csharp'],
    ['pyproject.toml', 'python'],
    ['requirements.txt', 'python'],
    ['setup.py', 'python'],
    ['package.json', 'js'],
    ['Cargo.toml', 'rust'],
  ];
  for (const [file, lang] of cases) {
    const dir = tmpDir(t);
    write(dir, file);
    assert.equal(detectLanguage(dir), lang, file);
  }
});

test('detectLanguage: no marker file at all gives null', (t) => {
  const dir = tmpDir(t);
  write(dir, 'README.md');
  assert.equal(detectLanguage(dir), null);
});

// #340: a mixed repository proposes every language it detects, main one first, as one
// comma-separated value of the `language` input ("go,js"); a single marker stays a single value.
test('detectLanguage: go.mod next to package.json proposes both, Go first (a JS tooling file does not hide the real language)', (t) => {
  const dir = tmpDir(t);
  write(dir, 'go.mod', 'package.json');
  assert.equal(detectLanguage(dir), 'go,js');
});

test('detectLanguage: Cargo.toml next to package.json proposes both Rust and JavaScript (#340)', (t) => {
  const dir = tmpDir(t);
  write(dir, 'Cargo.toml', 'package.json');
  const value = detectLanguage(dir);
  assert.equal(typeof value, 'string');
  assert.deepEqual(value.split(',').sort(), ['js', 'rust']);
});

test('detectLanguage: a folder that cannot be read gives null, not an error', () => {
  assert.equal(detectLanguage(path.join(os.tmpdir(), 'does-not-exist-project-inputs')), null);
});

// ---- listBranches -----------------------------------------------------------------------------

test('listBranches: the local branches of a git repository, and the current one as the default (no origin)', (t) => {
  const dir = tmpDir(t);
  git(dir, 'init', '-q', '-b', 'trunk');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'init');
  git(dir, 'branch', 'feature');

  return listBranches(dir).then(({ branches, defaultBranch }) => {
    assert.deepEqual(branches.sort(), ['feature', 'trunk']);
    assert.equal(defaultBranch, 'trunk'); // no main/master here: falls back to the checked-out branch
  });
});

test('listBranches: "main" is preferred over the checked-out branch when both exist', (t) => {
  const dir = tmpDir(t);
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'init');
  git(dir, 'checkout', '-q', '-b', 'feature');

  return listBranches(dir).then(({ branches, defaultBranch }) => {
    assert.deepEqual(branches.sort(), ['feature', 'main']);
    assert.equal(defaultBranch, 'main');
  });
});

test('listBranches: a non-git folder gives no branches and no default, not an error', (t) => {
  const dir = tmpDir(t);
  return listBranches(dir).then((r) => assert.deepEqual(r, { branches: [], defaultBranch: null }));
});

// ---- inputHints ---------------------------------------------------------------------------------

test('inputHints: combines the detected language and the branches of a real project folder', (t) => {
  const dir = tmpDir(t);
  write(dir, 'package.json');
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');

  return inputHints(dir).then((h) => {
    assert.equal(h.language, 'js');
    assert.deepEqual(h.branches, ['main']);
    assert.equal(h.defaultBranch, 'main');
  });
});

test('inputHints: a Rust workspace next to package.json hints both languages (#340)', (t) => {
  const dir = tmpDir(t);
  write(dir, 'package.json', 'Cargo.toml');
  return inputHints(dir).then((h) => {
    assert.deepEqual(String(h.language).split(',').sort(), ['js', 'rust']);
  });
});

test('inputHints: a missing folder gives nulls and an empty branch list, not an error', () => {
  return inputHints(path.join(os.tmpdir(), 'does-not-exist-project-inputs')).then((h) => {
    assert.deepEqual(h, { language: null, branches: [], defaultBranch: null });
  });
});
