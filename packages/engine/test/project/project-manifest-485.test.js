// #485: a repository's `.multiagent/project.yaml` manifest (packages/engine/domains/project/project-manifest.js, new, pure).
// Acceptance tests, written before the code.
//
// Spec (the interface these tests assume):
//   const { parseManifest, readManifest, MANIFEST_FILE, CATEGORIES } = require('../../domains/project/project-manifest');
//   MANIFEST_FILE === '.multiagent/project.yaml'
//   CATEGORIES: ['intake', 'solo', 'team', 'release'] (any order)
//   parseManifest(text, { appVersion }) -> { version, requires, workflows, errors }
//     workflows: [{ name, file, category, description }] (file / category / description null when
//       not declared; file is the manifest's path, relative to .multiagent/, e.g. 'workflows/x.yaml')
//     errors: [string]; a manifest with errors declares no workflows (workflows: []): the project
//       runs on the workspace workflows as today.
//     Errors: invalid YAML; `workflows` not a list; an entry without a name; two entries with the
//       same name; a `file` outside .multiagent/workflows/ or not .yaml/.yml; a category not in
//       CATEGORIES; `requires` (a version range, e.g. '>=1.2') the app version does not satisfy.
//   readManifest(projectDir, { appVersion }) -> the same shape, read from <projectDir>/.multiagent/project.yaml;
//     no manifest -> { workflows: [], errors: [] }.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempDir } = require('../repo-workflow-fixtures-485');

const load = () => require('../../domains/project/project-manifest');
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const APP_VERSION = require('../../../../package.json').version;

const VALID = `version: 3
requires: ">=1.2"
workflows:
  - name: backlog-refresh
    category: intake
  - name: local-flow
    file: workflows/local-flow.yaml
    category: solo
    description: Our own local flow
`;

test('#485 parseManifest: a valid manifest gives its version, requires and workflows (bundled by name, or a repository file)', () => {
  const { parseManifest } = load();
  const m = parseManifest(VALID, { appVersion: '1.2.0' });
  assert.deepEqual(m.errors, []);
  assert.equal(String(m.version), '3');
  assert.equal(m.requires, '>=1.2');
  assert.equal(m.workflows.length, 2);
  const [bundled, own] = m.workflows;
  assert.equal(bundled.name, 'backlog-refresh');
  assert.equal(bundled.file ?? null, null);
  assert.equal(bundled.category, 'intake');
  assert.equal(own.name, 'local-flow');
  assert.equal(own.file, 'workflows/local-flow.yaml');
  assert.equal(own.category, 'solo');
  assert.equal(own.description, 'Our own local flow');
});

// #630: feature and fix join; solo and team stay so an old manifest still reads
test('#485 parseManifest: the categories are intake, feature, fix, release and the old solo and team', () => {
  const { CATEGORIES } = load();
  assert.deepEqual([...CATEGORIES].sort(), ['feature', 'fix', 'intake', 'release', 'solo', 'team']);
});

test('#485 parseManifest: invalid YAML is a reported error and declares no workflows', () => {
  const { parseManifest } = load();
  const m = parseManifest('workflows: [ { name: a, \n  - : :', { appVersion: APP_VERSION });
  assert.ok(m.errors.length >= 1);
  assert.deepEqual(m.workflows, []);
});

test('#485 parseManifest: workflows must be a list', () => {
  const { parseManifest } = load();
  const m = parseManifest('workflows:\n  name: a\n', { appVersion: APP_VERSION });
  assert.ok(m.errors.some((e) => /workflows/.test(e) && /list/i.test(e)), m.errors.join(' | '));
  assert.deepEqual(m.workflows, []);
});

test('#485 parseManifest: an entry without a name is an error', () => {
  const { parseManifest } = load();
  const m = parseManifest('workflows:\n  - file: workflows/a.yaml\n', { appVersion: APP_VERSION });
  assert.ok(m.errors.some((e) => /name/i.test(e)), m.errors.join(' | '));
  assert.deepEqual(m.workflows, []);
});

test('#485 parseManifest: two entries with the same name are an error', () => {
  const { parseManifest } = load();
  const m = parseManifest('workflows:\n  - name: a\n  - name: a\n', { appVersion: APP_VERSION });
  assert.ok(m.errors.some((e) => /"?a"?/.test(e) && /twice|duplicate|more than once/i.test(e)), m.errors.join(' | '));
});

test('#485 parseManifest: a file outside .multiagent/workflows/ (traversal, absolute, other folder) or not YAML is refused', () => {
  const { parseManifest } = load();
  for (const file of ['../x.yaml', 'workflows/../../x.yaml', 'other/x.yaml', '/etc/x.yaml', 'C:/x.yaml', 'workflows/x.sh']) {
    const m = parseManifest(`workflows:\n  - name: a\n    file: "${file}"\n`, { appVersion: APP_VERSION });
    assert.ok(m.errors.length >= 1, `${file} is refused`);
    assert.ok(m.errors.some((e) => e.includes(file) || /file/i.test(e)), `the error names the file: ${m.errors.join(' | ')}`);
    assert.deepEqual(m.workflows, [], `${file}: no workflows`);
  }
});

test('#485 parseManifest: an unknown category (neither one of the four nor a bundled one) is an error', () => {
  const { parseManifest } = load();
  const m = parseManifest('workflows:\n  - name: a\n    category: weird\n', { appVersion: APP_VERSION });
  assert.ok(m.errors.some((e) => /weird/.test(e)), m.errors.join(' | '));
  const none = parseManifest('workflows:\n  - name: a\n', { appVersion: APP_VERSION });
  assert.deepEqual(none.errors, []);
  assert.equal(none.workflows[0].category ?? null, null);
});

test('#485 parseManifest: requires an app version the app does not have is an error naming both', () => {
  const { parseManifest } = load();
  const old = parseManifest(VALID, { appVersion: '1.1.2' });
  assert.ok(old.errors.some((e) => /requires|>=1\.2/.test(e) && e.includes('1.1.2')), old.errors.join(' | '));
  assert.deepEqual(old.workflows, []);
  assert.deepEqual(parseManifest(VALID, { appVersion: '1.10.0' }).errors, [], '1.10.0 satisfies >=1.2 (numeric, not text, comparison)');
  assert.deepEqual(parseManifest(VALID.replace('>=1.2', '>=1.2.0'), { appVersion: '1.2.0' }).errors, []);
});

test('#485 readManifest: a project without .multiagent/project.yaml declares nothing and reports no error', (t) => {
  const { readManifest } = load();
  const dir = tempDir(t, 'manifest-none-485-');
  const m = readManifest(dir, { appVersion: APP_VERSION });
  assert.deepEqual(m.workflows, []);
  assert.deepEqual(m.errors, []);
});

test('#485 readManifest: reads .multiagent/project.yaml of the folder; a malformed one is reported', (t) => {
  const { readManifest, MANIFEST_FILE } = load();
  assert.equal(MANIFEST_FILE, '.craftorio/project.yaml'); // T2c: .multiagent/ (below) is still read
  const dir = tempDir(t, 'manifest-read-485-');
  fs.mkdirSync(path.join(dir, '.multiagent'));
  fs.writeFileSync(path.join(dir, '.multiagent', 'project.yaml'), VALID.replace('>=1.2', `>=${APP_VERSION}`));
  const m = readManifest(dir, { appVersion: APP_VERSION });
  assert.deepEqual(m.errors, []);
  assert.deepEqual(m.workflows.map((w) => w.name), ['backlog-refresh', 'local-flow']);
  fs.writeFileSync(path.join(dir, '.multiagent', 'project.yaml'), 'workflows: 3\n');
  const bad = readManifest(dir, { appVersion: APP_VERSION });
  assert.ok(bad.errors.length >= 1);
  assert.deepEqual(bad.workflows, []);
});

// ---- this repository's own manifest -------------------------------------------------------------

const OWN = path.join(ROOT, '.craftorio', 'project.yaml');

test('#485 this repository\'s .multiagent/project.yaml declares the four flows with their categories, valid for this app version', () => {
  const { parseManifest } = load();
  assert.ok(fs.existsSync(OWN), '.multiagent/project.yaml exists');
  const m = parseManifest(fs.readFileSync(OWN, 'utf8'), { appVersion: APP_VERSION });
  assert.deepEqual(m.errors, []);
  const byName = Object.fromEntries(m.workflows.map((w) => [w.name, w]));
  assert.equal(byName['backlog-refresh']?.category, 'intake');
  // #630: the bundled set is feature, fix and release
  assert.equal(byName.feature?.category, 'solo');
  assert.equal(byName.fix?.category, 'fix');
  assert.equal(byName.release?.category, 'release');
  for (const name of ['backlog-refresh', 'feature', 'fix', 'release']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'workflows', `${name}.yaml`)), `${name} is a bundled workflow`);
    assert.equal(byName[name].file ?? null, null, `${name} is the bundled one, by name`);
  }
});

test('#485 this repository keeps its own ai-development-local-hero copy, without owner model overrides', () => {
  const { parseManifest } = load();
  const { loadWorkflow } = require('../../engine/workflow');
  const m = parseManifest(fs.readFileSync(OWN, 'utf8'), { appVersion: APP_VERSION });
  const own = m.workflows.find((w) => w.name === 'ai-development-local-hero');
  assert.ok(own, 'ai-development-local-hero is declared');
  assert.equal(own.file, 'workflows/ai-development-local-hero.yaml');
  const copy = path.join(ROOT, '.craftorio', 'workflows', 'ai-development-local-hero.yaml');
  assert.ok(fs.existsSync(copy), '.craftorio/workflows/ai-development-local-hero.yaml exists');
  const wf = loadWorkflow(copy);
  // #630: the bundled copy is feature.yaml now, which added agents (second_reviewer, ci_pusher): the
  // copy's own agents run on the bundled provider / model / effort
  const bundled = loadWorkflow(path.join(ROOT, 'workflows', 'feature.yaml'));
  const runsOn = (w, names) => Object.fromEntries(names.map((k) => [k, `${w.agents[k]?.provider} ${w.agents[k]?.model} ${w.agents[k]?.effort ?? ''}`]));
  const names = Object.keys(wf.agents);
  assert.deepEqual(runsOn(wf, names), runsOn(bundled, names), 'every agent runs on the bundled provider / model / effort');
  assert.equal(String(wf.orchestrator?.model), String(bundled.orchestrator?.model));
  assert.deepEqual(wf.inputs?.developer_model, bundled.inputs?.developer_model);
});
