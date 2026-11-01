// #340 through WorkflowRun (no whole run): the language skills a turn gets from the files changed
// in the run's worktree (skillNames: the git diff since the worktree's base, plus the steps'
// files_changed), the `language` input normalised by resolveInputs ("rust, js" -> "rust,js"), and
// cargo in every toolchain allowlist of the bundled workflows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../engine/workflow');

const root = path.join(__dirname, '..', '..', '..');
const NAMES = ['unit-test-writer-{{ inputs.language }}', 'build-audit-{{ inputs.language }}', 'long-commands'];

// No user git config (identity, hooks, aliases), as on CI.
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const put = (dir, rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

function newRun(t, inputs) {
  return new WorkflowRun({ file: path.join(root, 'workflows', 'feature.yaml'), inputs: { task: 'Rust skills', repo_path: root, ...inputs }, mock: true, runsDir: tmpDir(t, 'runs-340-') });
}

// A repository with a JS file on main, then a branch that changes `files`: the run's worktree.
function repoWith(t, files) {
  const dir = tmpDir(t, 'wt-340-');
  put(dir, 'src/app.js', 'module.exports = 1;\n');
  put(dir, 'Cargo.toml', '[workspace]\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  const base = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'feat');
  for (const [rel, text] of Object.entries(files.committed || {})) put(dir, rel, text);
  if (files.committed) { git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'change'); }
  for (const [rel, text] of Object.entries(files.untracked || {})) put(dir, rel, text);
  return { dir, base };
}
function onWorktree(run, { dir, base }) {
  run.worktree = { ...(run.worktree || {}), base };
  run.ctx.worktree_dir = dir;
  return run;
}

// ---- skillNames: the worktree's diff ------------------------------------------------------------

test('skillNames: a committed .rs change in the worktree names only the Rust skills for "js,rust"', (t) => {
  const run = onWorktree(newRun(t, { language: 'js,rust' }), repoWith(t, { committed: { 'crates/core/src/lib.rs': 'pub fn f() {}\n' } }));
  assert.deepEqual(run.skillNames(NAMES), ['unit-test-writer-rust', 'build-audit-rust', 'long-commands']);
});

test('skillNames: an untracked .js file next to a committed .rs one names the skills of both, in the input order', (t) => {
  const run = onWorktree(newRun(t, { language: 'rust,js' }), repoWith(t, {
    committed: { 'crates/core/src/lib.rs': 'pub fn f() {}\n' },
    untracked: { 'src/new.js': 'module.exports = 2;\n' },
  }));
  assert.deepEqual(run.skillNames(NAMES), ['unit-test-writer-rust', 'unit-test-writer-js', 'build-audit-rust', 'build-audit-js', 'long-commands']);
});

test('skillNames: only a docs file changed in the worktree names the main (first) language only', (t) => {
  const run = onWorktree(newRun(t, { language: 'rust,js' }), repoWith(t, { committed: { 'docs/notes.md': '# notes\n' } }));
  assert.deepEqual(run.skillNames(NAMES), ['unit-test-writer-rust', 'build-audit-rust', 'long-commands']);
});

test('skillNames: a worktree whose diff cannot be read warns and falls back to the steps\' files_changed', (t) => {
  const run = onWorktree(newRun(t, { language: 'js,rust' }), { dir: tmpDir(t, 'not-git-340-'), base: 'main' });
  run.ctx.steps = { ...(run.ctx.steps || {}), develop: { output: { files_changed: ['src/app.js'] } } };
  const logs = [];
  run.on('event', (ev) => { if (ev.type === 'log') logs.push(`${ev.level}: ${ev.message}`); });
  assert.deepEqual(run.skillNames(NAMES), ['unit-test-writer-js', 'build-audit-js', 'long-commands']);
  assert.ok(logs.some((l) => /^warn: Could not list the files this run changed/.test(l)), logs.join('\n'));
});

test('skillNames: a single language ignores the worktree\'s diff (as before #340)', (t) => {
  const run = onWorktree(newRun(t, { language: 'js' }), repoWith(t, { committed: { 'crates/core/src/lib.rs': 'pub fn f() {}\n' } }));
  assert.deepEqual(run.skillNames(NAMES), ['unit-test-writer-js', 'build-audit-js', 'long-commands']);
});

// ---- resolveInputs: the language value as the run keeps it -----------------------------------------

test('language input: spaces and repeated values are normalised ("rust, js, rust" -> "rust,js"), a single value kept as is', (t) => {
  assert.equal(newRun(t, { language: 'rust, js, rust' }).inputs.language, 'rust,js');
  assert.equal(newRun(t, { language: ' js ,rust' }).inputs.language, 'js,rust');
  assert.equal(newRun(t, { language: 'rust' }).inputs.language, 'rust');
  assert.equal(newRun(t, {}).inputs.language, 'js');
});

test('language input: an unknown item or a value with no language is refused with the allowed list', (t) => {
  assert.throws(() => newRun(t, { language: 'js,cobol' }), /Input "language" must be one or more of js, .*rust/);
  assert.throws(() => newRun(t, { language: ' , ' }), /Input "language"/);
});

// ---- cargo in every toolchain allowlist --------------------------------------------------------------

test('every bundled workflow whose agents may run the language toolchains may also run cargo (release, multi-model-review included)', () => {
  const dir = path.join(root, 'workflows');
  const seen = [];
  for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
    const wf = loadWorkflow(path.join(dir, f));
    for (const [id, agent] of Object.entries(wf.agents || {})) {
      const tools = (agent.capabilities?.tools || []).flat(Infinity).map(String);
      if (!tools.includes('bash:go')) continue;
      seen.push(f);
      assert.ok(tools.includes('bash:cargo'), `${f}: agent ${id} has bash:cargo`);
    }
  }
  for (const f of ['release.yaml', 'feature.yaml']) assert.ok(seen.includes(f), `${f} has a toolchain agent`);
});
