// #735: a run's inputs come from the project's configuration; a backend project gets no UI steps.
// Acceptance tests written before the code. The contract the developer implements:
// - packages/engine/domains/project/project-run-defaults.js exports
//   * `projectRunDefaults({ project, profile })` → Promise<{ mode, base_branch, e2e_tests, e2e_command,
//     test_command, check_command, ui_folders, screenshots, steps_folders, kind }>: the project's run
//     defaults built from the wizard's picks saved on the project (#729, `project.workflows[].variant`,
//     e.g. 'remote-code'), the ways-of-working profile (PROFILE_FIELDS: mode, tests, testCommand,
//     e2eCommand, checkCommand…, may be null) and the facts read from `project.folder` (its files and
//     its git default branch). `kind` is 'backend' | 'frontend' | 'full-stack'. No Node assumption: a
//     project without a Node toolchain gets no `npm …` value; e2e_command is '' and e2e_tests 'off'
//     unless an E2E suite was found. A backend project: ui_folders [], screenshots 'off', e2e_tests
//     'off', steps_folders [].
//   * `resolveRunInputs({ typed, roadmap, project, workflow })` → { values, sources }: for each input
//     of `workflow.inputs`, the typed value (dialog / CLI) > the roadmap item's > the project's run
//     defaults > the workflow's default; `sources[key]` is 'typed' | 'roadmap' | 'project' | 'workflow'.
// - packages/engine/domains/backlog/backlog.js `runInputs(item, wf, folder, projectDefaults)`: the
//   roadmap/queue run's inputs, the item's saved inputs over the project's run defaults.
// - the `projects:inputHints` channel (what the run dialog prefills) answers `runDefaults` too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const load = () => require('../../domains/project/project-run-defaults');
const backlogDomain = () => require('../../domains/backlog/backlog');

// No user git config (identity, hooks, aliases), as on CI.
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-735-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function folderWith(t, files, { branch = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-defaults-735-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  if (branch) {
    git(dir, 'init', '-q', '-b', branch);
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'init');
  }
  return dir;
}

const RUST = {
  'Cargo.toml': '[package]\nname = "svc"\nversion = "0.1.0"\nedition = "2021"\n',
  'src/main.rs': 'fn main() { println!("hi"); }\n',
};
const json = (v) => JSON.stringify(v, null, 2);
// a web app with its server: React under web/, Express under server/, a Playwright suite
const FULL_STACK = {
  'package.json': json({ name: 'shop', scripts: { test: 'node --test', 'test:e2e': 'playwright test', check: 'eslint .' }, dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', express: '^5.0.0' }, devDependencies: { '@playwright/test': '^1.50.0', vite: '^6.0.0' } }),
  'web/index.html': '<!doctype html><div id="root"></div>\n',
  'web/src/App.jsx': 'export default function App() { return <h1>Shop</h1>; }\n',
  'server/index.js': 'require("express")().listen(3000);\n',
  'playwright.config.js': 'module.exports = {};\n',
  'features/steps/shop.steps.js': '// steps\n',
};
const FRONTEND = {
  'package.json': json({ name: 'site', scripts: { test: 'vitest run', dev: 'vite' }, dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { vite: '^6.0.0' } }),
  'index.html': '<!doctype html><div id="root"></div>\n',
  'src/App.jsx': 'export default function App() { return <h1>Site</h1>; }\n',
};
const NODE_API = {
  'package.json': json({ name: 'api', scripts: { test: 'node --test' }, dependencies: { express: '^5.0.0' } }),
  'src/server.js': 'require("express")().listen(3000);\n',
};

const REMOTE_UNIT = { mode: 'remote', ci: 'pr+release', tests: 'unit', testCommand: null, checkCommand: null, e2eCommand: null, languages: ['rust'] };
const npmValues = (d) => Object.entries(d).filter(([, v]) => /\bnpm\b/.test(String(Array.isArray(v) ? v.join(' ') : v ?? ''))).map(([k]) => k);

// ---- the key test of the issue: a Rust project with a remote, unit-only profile ----------------

test('#735 a Rust project with a remote, unit-only profile: mode remote', async (t) => {
  const folder = folderWith(t, RUST, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'svc', folder }, profile: REMOTE_UNIT });
  assert.equal(d.mode, 'remote');
});

test('#735 a Rust project with a remote, unit-only profile: E2E off and no E2E command', async (t) => {
  const folder = folderWith(t, RUST, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'svc', folder }, profile: REMOTE_UNIT });
  assert.deepEqual([d.e2e_tests, d.e2e_command], ['off', '']);
});

test('#735 a Rust project: the test command is found from Cargo.toml (cargo test)', async (t) => {
  const folder = folderWith(t, RUST, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'svc', folder }, profile: REMOTE_UNIT });
  assert.equal(d.test_command, 'cargo test');
});

test('#735 a Rust project gets no npm command in any of its run defaults', async (t) => {
  const folder = folderWith(t, RUST, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'svc', folder }, profile: REMOTE_UNIT });
  assert.deepEqual(npmValues(d), []);
});

// ---- built from the wizard picks, the profile and the facts ------------------------------------

test('#735 base_branch is the repository\'s default branch', async (t) => {
  const folder = folderWith(t, RUST, { branch: 'trunk' });
  const d = await load().projectRunDefaults({ project: { id: 'svc', folder }, profile: REMOTE_UNIT });
  assert.equal(d.base_branch, 'trunk');
});

test('#735 the wizard\'s pick saved on the project (#729, variant remote-code) gives the mode, over the profile\'s', async (t) => {
  const folder = folderWith(t, RUST, { branch: 'main' });
  const project = { id: 'svc', folder, workflows: [{ name: 'feature', origin: 'bundled', variant: 'remote-code' }, { name: 'fix', origin: 'bundled', variant: 'remote-code' }] };
  const d = await load().projectRunDefaults({ project, profile: { ...REMOTE_UNIT, mode: 'local' } });
  assert.equal(d.mode, 'remote');
});

test('#735 a profile that says unit tests only turns E2E off, even when the project has an E2E suite', async (t) => {
  const folder = folderWith(t, FULL_STACK, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'shop', folder }, profile: { mode: 'local', tests: 'unit', languages: ['js'] } });
  assert.equal(d.e2e_tests, 'off');
});

test('#735 a project with an E2E suite and a unit+e2e profile keeps E2E on, with the suite\'s command', async (t) => {
  const folder = folderWith(t, FULL_STACK, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'shop', folder }, profile: { mode: 'local', tests: 'unit+e2e', languages: ['js'] } });
  assert.deepEqual([d.e2e_tests !== 'off', d.e2e_command], [true, 'npm run test:e2e']);
});

test('#735 the profile\'s test and check commands win over the ones found in the files', async (t) => {
  const folder = folderWith(t, RUST, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'svc', folder }, profile: { ...REMOTE_UNIT, testCommand: 'cargo nextest run', checkCommand: 'cargo clippy -- -D warnings' } });
  assert.deepEqual([d.test_command, d.check_command], ['cargo nextest run', 'cargo clippy -- -D warnings']);
});

test('#735 a Node project keeps its npm commands (npm test, npm run check)', async (t) => {
  const folder = folderWith(t, FULL_STACK, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'shop', folder }, profile: null });
  assert.deepEqual([d.test_command, d.check_command], ['npm test', 'npm run check']);
});

// ---- the project's kind and its UI defaults ------------------------------------------------------

test('#735 a Rust service is a backend project', async (t) => {
  const folder = folderWith(t, RUST, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'svc', folder }, profile: REMOTE_UNIT });
  assert.equal(d.kind, 'backend');
});

test('#735 a Node API without a UI is a backend project', async (t) => {
  const folder = folderWith(t, NODE_API, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'api', folder }, profile: null });
  assert.equal(d.kind, 'backend');
});

test('#735 a React app without a server is a frontend project', async (t) => {
  const folder = folderWith(t, FRONTEND, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'site', folder }, profile: null });
  assert.equal(d.kind, 'frontend');
});

test('#735 a React app with its Express server is a full-stack project', async (t) => {
  const folder = folderWith(t, FULL_STACK, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'shop', folder }, profile: null });
  assert.equal(d.kind, 'full-stack');
});

test('#735 a backend project gets no UI folders, no screenshots, no E2E and no step definition folders', async (t) => {
  const folder = folderWith(t, NODE_API, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'api', folder }, profile: null });
  assert.deepEqual({ ui_folders: Array.from(d.ui_folders || ['missing']), screenshots: d.screenshots, e2e_tests: d.e2e_tests, steps_folders: Array.from(d.steps_folders || ['missing']) },
    { ui_folders: [], screenshots: 'off', e2e_tests: 'off', steps_folders: [] });
});

test('#735 a full-stack project gets its real UI folder from the facts (web/), not src/renderer/', async (t) => {
  const folder = folderWith(t, FULL_STACK, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'shop', folder }, profile: null });
  const ui = Array.from(d.ui_folders || []).map((f) => String(f).replace(/\\/g, '/'));
  assert.deepEqual([ui.some((f) => f.startsWith('web')), ui.includes('src/renderer/')], [true, false], `ui_folders: ${ui.join(', ')}`);
});

test('#735 a full-stack project keeps its screenshots on', async (t) => {
  const folder = folderWith(t, FULL_STACK, { branch: 'main' });
  const d = await load().projectRunDefaults({ project: { id: 'shop', folder }, profile: null });
  assert.notEqual(d.screenshots, 'off');
});

// ---- the precedence: typed > roadmap item > project > workflow ----------------------------------

const WORKFLOW = {
  inputs: {
    task: { type: 'string', required: true },
    mode: { type: 'string', enum: ['local', 'remote'], default: 'local' },
    e2e_tests: { type: 'string', enum: ['off', 'write', 'write_and_run'], default: 'write_and_run' },
    test_command: { type: 'string', default: '' },
    base_branch: { type: 'string', default: 'main' },
    review: { type: 'string', enum: ['single', 'multi_model'], default: 'single' },
  },
};
const PROJECT = { mode: 'remote', e2e_tests: 'off', test_command: 'cargo test', base_branch: 'trunk', kind: 'backend' };

test('#735 precedence: a value typed in the dialog wins over the roadmap item\'s, the project\'s and the workflow\'s', () => {
  const { values, sources } = load().resolveRunInputs({ typed: { mode: 'local' }, roadmap: { mode: 'remote' }, project: PROJECT, workflow: WORKFLOW });
  assert.deepEqual([values.mode, sources.mode], ['local', 'typed']);
});

test('#735 precedence: the roadmap item\'s value wins over the project\'s', () => {
  const { values, sources } = load().resolveRunInputs({ typed: {}, roadmap: { test_command: 'cargo test --workspace' }, project: PROJECT, workflow: WORKFLOW });
  assert.deepEqual([values.test_command, sources.test_command], ['cargo test --workspace', 'roadmap']);
});

test('#735 precedence: the project\'s run default wins over the workflow\'s default', () => {
  const { values, sources } = load().resolveRunInputs({ typed: {}, roadmap: {}, project: PROJECT, workflow: WORKFLOW });
  assert.deepEqual([values.e2e_tests, sources.e2e_tests], ['off', 'project']);
});

test('#735 precedence: an input the project says nothing about keeps the workflow\'s default', () => {
  const { values, sources } = load().resolveRunInputs({ typed: {}, roadmap: {}, project: PROJECT, workflow: WORKFLOW });
  assert.deepEqual([values.review, sources.review], ['single', 'workflow']);
});

test('#735 precedence: a project default the workflow has no input for is not added (kind)', () => {
  const { values } = load().resolveRunInputs({ typed: {}, roadmap: {}, project: PROJECT, workflow: WORKFLOW });
  assert.equal('kind' in values, false);
});

// ---- the Roadmap's runs: the item's saved inputs over the project's run defaults ---------------

const ITEM = { title: 'Add retries', url: 'https://github.com/o/r/issues/7', body: 'Retry the call', inputs: { mode: 'local' } };

test('#735 a Roadmap run takes the project\'s run defaults for what its item did not set', () => {
  const inputs = backlogDomain().runInputs(ITEM, WORKFLOW, '/work/svc', PROJECT);
  assert.equal(inputs.test_command, 'cargo test');
});

test('#735 a Roadmap run keeps its item\'s own value over the project\'s', () => {
  const inputs = backlogDomain().runInputs(ITEM, WORKFLOW, '/work/svc', PROJECT);
  assert.equal(inputs.mode, 'local');
});

// ---- the run dialog's prefill: projects:inputHints answers the project's run defaults ----------

test('#735 projects:inputHints answers the project\'s run defaults (a Rust project: cargo test, E2E off)', async (t) => {
  const { makeService } = require('../service/helpers');
  const { api } = makeService(t);
  const folder = folderWith(t, RUST, { branch: 'main' });
  const p = await api['projects:create']({ name: 'Rusty', folder });
  const hints = await api['projects:inputHints'](p.id);
  assert.deepEqual([hints?.runDefaults?.test_command, hints?.runDefaults?.e2e_tests], ['cargo test', 'off']);
});
