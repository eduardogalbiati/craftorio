// #785: an item that keeps only chosen inputs gets the project's configuration: a `fork-code` backend
// project resolves to mode fork, code first, no E2E, no screenshots, no UI folders, its language and
// its commands. An empty string saved on an old item hides nothing; the rest of an old item's saved
// values still win (they are not rewritten). Acceptance tests written before the code.
// Seams: runDefaultsWith, resolveRunInputs (packages/engine/domains/project/project-run-defaults.js),
// backlog.runInputs. Contract the developer provides (chosen here): the run defaults also carry
// `test_order` (from the variant: `*-code` is code_first), `language` (the detected one, every language
// of a mixed repository) and `variant` (the wizard's pick, what the PO's prompt names).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { resolveRunInputs, runDefaultsWith } = require('../../domains/project/project-run-defaults');
const { runInputs } = require('../../domains/backlog/backlog');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const FEATURE = yaml.load(fs.readFileSync(path.join(ROOT, 'workflows', 'feature.yaml'), 'utf8'));

function rustFolder(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-defaults-785-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = { 'Cargo.toml': '[package]\nname = "svc"\nversion = "0.1.0"\n', 'src/main.rs': 'fn main() {}\n', ...extra };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}
const forkBackend = (folder) => ({ id: 'ai-memory', folder, kind: 'backend', workflows: [{ id: 'feature', variant: 'fork-code' }] });
const defaultsOf = (t, profile = null) => runDefaultsWith({ project: forkBackend(rustFolder(t)), profile, defaultBranch: 'main' });
const PROJECT_KEYS = ['mode', 'test_order', 'e2e_tests', 'screenshots', 'ui_folders', 'language', 'test_command'];
const pick = (from) => Object.fromEntries(PROJECT_KEYS.map((k) => [k, from[k]]));

// what the owner's item carried on 2026-11-03: the workflow's defaults and three empty strings
const OLD_ITEM = {
  mode: 'local', test_order: 'e2e_first', e2e_tests: 'write_and_run', screenshots: 'all',
  ui_folders: 'src/renderer/', steps_folders: 'features/steps', test_command: '', check_command: '', e2e_command: '',
};

test('#785 a PO-planned item with no inputs, on a fork-code backend project, resolves to the project\'s values', (t) => {
  const { values } = resolveRunInputs({ roadmap: {}, project: defaultsOf(t), workflow: FEATURE });
  assert.deepEqual(pick(values), { mode: 'fork', test_order: 'code_first', e2e_tests: 'off', screenshots: 'off', ui_folders: [], language: 'rust', test_command: 'cargo test' });
});

test('#785 the sources say those values come from the project', (t) => {
  const { sources } = resolveRunInputs({ roadmap: {}, project: defaultsOf(t), workflow: FEATURE });
  assert.deepEqual(pick(sources), Object.fromEntries(PROJECT_KEYS.map((k) => [k, 'project'])));
});

test('#785 the project\'s check command reaches the item, from the project', (t) => {
  const { values, sources } = resolveRunInputs({ roadmap: {}, project: defaultsOf(t, { checkCommand: 'cargo clippy' }), workflow: FEATURE });
  assert.deepEqual([values.check_command, sources.check_command], ['cargo clippy', 'project']);
});

test('#785 a repository with several languages resolves to all of them', (t) => {
  const folder = rustFolder(t, { 'package.json': '{"name":"x"}\n' });
  const { values, sources } = resolveRunInputs({ roadmap: {}, project: runDefaultsWith({ project: forkBackend(folder) }), workflow: FEATURE });
  assert.deepEqual([String(values.language).split(',').sort(), sources.language], [['js', 'rust'], 'project']);
});

test('#785 the run defaults name the wizard\'s variant', (t) => {
  assert.equal(defaultsOf(t).variant, 'fork-code');
});

test('#785 the run of an item with no inputs starts with the project\'s values', (t) => {
  const inputs = runInputs({ title: 'T', url: 'u', inputs: {} }, FEATURE, null, defaultsOf(t));
  assert.deepEqual(pick(inputs), { mode: 'fork', test_order: 'code_first', e2e_tests: 'off', screenshots: 'off', ui_folders: [], language: 'rust', test_command: 'cargo test' });
});

test('#785 an empty string saved on an old item does not hide the project\'s value', (t) => {
  const { values, sources } = resolveRunInputs({ roadmap: { test_command: '' }, project: defaultsOf(t), workflow: FEATURE });
  assert.deepEqual([values.test_command, sources.test_command], ['cargo test', 'project']);
});

test('#785 the run of an old item takes the project\'s command over its empty string', (t) => {
  const inputs = runInputs({ title: 'T', url: 'u', inputs: { test_command: '' } }, FEATURE, null, defaultsOf(t));
  assert.equal(inputs.test_command, 'cargo test');
});

test('#785 an empty string with no project value falls to the workflow\'s default', () => {
  const { values, sources } = resolveRunInputs({ roadmap: { base_branch: '' }, project: {}, workflow: FEATURE });
  assert.deepEqual([values.base_branch, sources.base_branch], ['main', 'workflow']);
});

test('#785 an input the item chose wins over the project\'s, marked as the item\'s', (t) => {
  const { values, sources } = resolveRunInputs({ roadmap: { e2e_tests: 'write' }, project: defaultsOf(t), workflow: FEATURE });
  assert.deepEqual([values.e2e_tests, sources.e2e_tests], ['write', 'roadmap']);
});

test('#785 an old item\'s saved values still win until the owner asks otherwise: nothing is rewritten silently', (t) => {
  const { values, sources } = resolveRunInputs({ roadmap: OLD_ITEM, project: defaultsOf(t), workflow: FEATURE });
  assert.deepEqual([values.mode, sources.mode, values.e2e_tests, sources.e2e_tests], ['local', 'roadmap', 'write_and_run', 'roadmap']);
});

test('#785 the docs state that items keep only chosen inputs', () => {
  const page = (name) => fs.readFileSync(path.join(ROOT, 'docs', 'readme', name), 'utf8');
  assert.match(`${page('040-workflows.md')}\n${page('043-project-run-defaults.md')}`, /keeps?\s+only[^.]*\bchos(e|en)\b/i);
});
