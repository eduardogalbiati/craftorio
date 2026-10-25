// #371: the project city's service channels, through makeService on git fixture repositories.
// architecture:city({ projectId }) returns { state, model, validation } (model: zones, districts,
// buildings, landmarks, ports, edges), built from the project's facts at the default branch and its
// saved plan (folder districts without one). Edges are read at the facts' commit: file-level
// { from, to } paths from relative require/import in JavaScript/TypeScript, district-level
// { from, to } ids from a Cargo.toml dependency on a sibling crate in Rust, and the string
// "not read for <language>" for any other language. architecture:savePlan({ projectId, plan })
// validates the plan against its schema, writes <workspace>/architecture/<projectId>/city-plan.json
// and keeps the previous plan as history. Both declare schema.params/result.
// The channels are created by the change: each test calls them through the service (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('@multiagent/engine/test/service/helpers');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// A git repository on main with the given files in one commit (fixed date).
function repoWith(t, files) {
  const dir = tmp(t, 'city371-repo-');
  const git = (args, env = {}) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git(['init', '-q']);
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const date = '2026-01-05T12:00:00Z';
  git(['add', '-A']);
  git(['commit', '-q', '--no-verify', '-m', 'first'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return { dir, git };
}

const JS_FILES = {
  'src/engine/run.js': "const queue = require('./queue');\nconst { globs } = require('../shared/globs');\nconst fs = require('fs');\nmodule.exports = { queue, globs, fs };\n",
  'src/engine/queue.js': 'module.exports = [];\n',
  'src/engine/gates.js': "const q = require('./queue.js');\nmodule.exports = q;\n",
  'src/shared/globs.js': 'module.exports = { globs: 1 };\n',
  'src/renderer/app.js': "import board from './views/board.js';\nexport default board;\n",
  'src/renderer/views/board.js': 'export default 1;\n',
  'src/renderer/views/list.js': 'export default 2;\n',
  'src/renderer/views/kanban.js': 'export default 3;\n',
};

const RUST_FILES = {
  'Cargo.toml': '[workspace]\nmembers = ["crates/core", "crates/app"]\n',
  'crates/core/Cargo.toml': '[package]\nname = "core"\nversion = "0.1.0"\n',
  'crates/core/src/lib.rs': 'pub mod a;\n',
  'crates/core/src/a.rs': 'pub fn a() -> u32 { 1 }\n',
  'crates/app/Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\n\n[dependencies]\ncore = { path = "../core" }\nserde = "1"\n',
  'crates/app/src/main.rs': 'fn main() { core::a::a(); }\n',
  'crates/app/src/b.rs': 'pub fn b() {}\n',
};

const PY_FILES = {
  'lib/model.py': 'from .helper import help\nclass Model:\n    pass\n',
  'lib/helper.py': 'def help():\n    return 1\n',
  'lib/extra.py': 'X = 1\n',
};

function plan(districts, zones = [{ id: 'core', name: 'Core', kind: 'industrial', purpose: 'Runs the work.' }]) {
  return { version: 1, project: 'fixture', summary: 'A fixture.', ignore: [], zones, districts, landmarks: [], ports: [], evidence: [] };
}

const JS_PLAN = plan([
  { id: 'engine', name: 'Engine', zone: 'core', purpose: 'x', include: ['/src/engine/**'], exclude: [] },
  { id: 'ui', name: 'UI', zone: 'core', purpose: 'x', include: ['/src/renderer/**'], exclude: [] },
]);

const RUST_PLAN = plan([
  { id: 'app', name: 'App', zone: 'core', purpose: 'x', include: ['/crates/app/**'], exclude: [] },
  { id: 'core-crate', name: 'Core crate', zone: 'core', purpose: 'x', include: ['/crates/core/**', '/Cargo.toml'], exclude: [] },
]);

async function setup(t, files) {
  const { service, api } = makeService(t);
  const repo = repoWith(t, files);
  const project = await api['projects:create']({ name: 'city', folder: repo.dir });
  return { service, api, repo, projectId: project.id };
}

async function call(api, channel, args) {
  assert.equal(typeof api[channel], 'function', `${channel} is a channel of the service`);
  return api[channel](args);
}

const hasEdge = (edges, from, to) => Array.isArray(edges) && edges.some((e) => e.from === from && e.to === to);
const districtOf = (model, file) => { const b = model.buildings.find((x) => x.path === file); return b ? b.district : undefined; };

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

// ---------- architecture:city ----------

test('#371 architecture:city without a plan returns a folder city and its validation', async (t) => {
  const { api, projectId } = await setup(t, JS_FILES);
  const out = await call(api, 'architecture:city', { projectId });
  assert.equal(out.state, 'ok');
  assert.equal(districtOf(out.model, 'src/engine/run.js'), 'src/engine');
  assert.equal(out.model.buildings.length, Object.keys(JS_FILES).length);
  assert.equal(typeof out.validation, 'object');
  assert.equal(out.validation.drawn, Object.keys(JS_FILES).length);
});

test('#371 architecture:city reads JavaScript file edges from relative require and import', async (t) => {
  const { api, projectId } = await setup(t, JS_FILES);
  const { model } = await call(api, 'architecture:city', { projectId });
  assert.ok(Array.isArray(model.edges), `edges ${JSON.stringify(model.edges)}`);
  assert.ok(hasEdge(model.edges, 'src/engine/run.js', 'src/engine/queue.js'), 'require without extension');
  assert.ok(hasEdge(model.edges, 'src/engine/run.js', 'src/shared/globs.js'), 'require of a parent folder');
  assert.ok(hasEdge(model.edges, 'src/engine/gates.js', 'src/engine/queue.js'), 'require with extension');
  assert.ok(hasEdge(model.edges, 'src/renderer/app.js', 'src/renderer/views/board.js'), 'import');
  assert.equal(model.edges.some((e) => e.to === 'fs' || !String(e.to).includes('/')), false, 'no edge to a package');
});

test('#371 architecture:city reads Rust district edges from a Cargo.toml dependency on a sibling crate', async (t) => {
  const { api, projectId } = await setup(t, RUST_FILES);
  await call(api, 'architecture:savePlan', { projectId, plan: RUST_PLAN });
  const { model } = await call(api, 'architecture:city', { projectId });
  assert.ok(Array.isArray(model.edges), `edges ${JSON.stringify(model.edges)}`);
  assert.ok(hasEdge(model.edges, 'app', 'core-crate'), JSON.stringify(model.edges));
  assert.equal(model.edges.some((e) => e.from === 'core-crate'), false, 'core depends on no sibling');
  assert.equal(model.edges.some((e) => e.to === 'serde'), false, 'no edge to an external crate');
});

test('#371 architecture:city says edges are not read for another language, never an empty graph', async (t) => {
  const { api, projectId } = await setup(t, PY_FILES);
  const { model } = await call(api, 'architecture:city', { projectId });
  assert.equal(model.edges, 'not read for Python');
});

test('#371 architecture:city on the same commit and plan gives the same model', async (t) => {
  const { api, projectId } = await setup(t, JS_FILES);
  const a = await call(api, 'architecture:city', { projectId });
  const b = await call(api, 'architecture:city', { projectId });
  assert.equal(JSON.stringify(b), JSON.stringify(a));
});

test('#371 architecture:city on a plain folder is not-git', async (t) => {
  const { api } = makeService(t);
  const dir = tmp(t, 'city371-plain-');
  fs.writeFileSync(path.join(dir, 'a.js'), 'module.exports = 1;\n');
  const project = await api['projects:create']({ name: 'plain', folder: dir });
  const out = await call(api, 'architecture:city', { projectId: project.id });
  assert.equal(out.state, 'not-git');
});

test('#371 architecture:city in a JavaScript and Python repository gives the JS edges and says Python is not read', async (t) => {
  const { api, projectId } = await setup(t, { ...JS_FILES, ...PY_FILES });
  const { model } = await call(api, 'architecture:city', { projectId });
  assert.ok(Array.isArray(model.edges), `edges ${JSON.stringify(model.edges)}`);
  assert.ok(hasEdge(model.edges, 'src/engine/run.js', 'src/engine/queue.js'), 'the JavaScript edges are read');
  assert.equal(model.edges.some((e) => String(e.from).startsWith('lib/')), false, 'no Python edge');
  // the graph covers only part of the city: the model names what it did not read
  assert.match(JSON.stringify(model), /not read for Python/);
});

// A fake `lizard` that fails when run: installed after the first read, only a refresh sees it
function installFailingLizard(t) {
  const dir = tmp(t, 'city371-bin-');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'lizard.cmd'), '@exit /b 3\r\n');
  } else {
    fs.writeFileSync(path.join(dir, 'lizard'), '#!/bin/sh\nexit 3\n');
    fs.chmodSync(path.join(dir, 'lizard'), 0o755);
  }
  const saved = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${saved}`;
  t.after(() => { process.env.PATH = saved; });
}

test('#371 architecture:city after architecture:facts with refresh shows the refreshed facts', async (t) => {
  // Python only: JavaScript is measured inside the app (#385), Python needs lizard
  const { api, projectId } = await setup(t, PY_FILES);
  const before = await call(api, 'architecture:facts', { projectId });
  if (before.model.complexity.status === 'measured') return t.skip('a real lizard is installed: the fixture is already measured');
  await call(api, 'architecture:city', { projectId });
  installFailingLizard(t);
  const refreshed = await call(api, 'architecture:facts', { projectId, refresh: true });
  assert.notEqual(refreshed.model.complexity.reason, before.model.complexity.reason, 'the refresh read the new tool');
  const { model } = await call(api, 'architecture:city', { projectId });
  assert.equal(model.complexity.reason, refreshed.model.complexity.reason);
});

test('#371 architecture:city with an unreadable city-plan.json still draws the city and says the plan was not read', async (t) => {
  const { service, api, projectId } = await setup(t, JS_FILES);
  const folder = path.join(service.workspace().root, 'architecture', projectId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'city-plan.json'), '{ "version": 1, "zones": [');
  const out = await call(api, 'architecture:city', { projectId });
  assert.equal(out.state, 'ok');
  assert.equal(out.model.buildings.length, Object.keys(JS_FILES).length);
  assert.match(JSON.stringify(out.validation), /city-plan\.json/, `validation ${JSON.stringify(out.validation)}`);
});

// ---------- architecture:savePlan ----------

test('#371 architecture:savePlan writes the plan to <workspace>/architecture/<project>/city-plan.json', async (t) => {
  const { service, api, projectId } = await setup(t, JS_FILES);
  await call(api, 'architecture:savePlan', { projectId, plan: JS_PLAN });
  const file = path.join(service.workspace().root, 'architecture', projectId, 'city-plan.json');
  assert.ok(fs.existsSync(file), `${file} exists`);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), JS_PLAN);
});

test('#371 architecture:savePlan refuses a plan that fails its schema and writes nothing', async (t) => {
  const { service, api, projectId } = await setup(t, JS_FILES);
  const bad = plan(JS_PLAN.districts, [{ id: 'core', name: 'Core', kind: 'castle', purpose: 'x' }]);
  assert.equal(typeof api['architecture:savePlan'], 'function', 'architecture:savePlan is a channel of the service');
  await assert.rejects(() => api['architecture:savePlan']({ projectId, plan: bad }));
  const file = path.join(service.workspace().root, 'architecture', projectId, 'city-plan.json');
  assert.equal(fs.existsSync(file), false);
});

test('#371 architecture:savePlan keeps the previous plan as history', async (t) => {
  const { service, api, projectId } = await setup(t, JS_FILES);
  const first = { ...JS_PLAN, summary: 'The first plan.' };
  const second = { ...JS_PLAN, summary: 'The second plan.' };
  await call(api, 'architecture:savePlan', { projectId, plan: first });
  await call(api, 'architecture:savePlan', { projectId, plan: second });
  const folder = path.join(service.workspace().root, 'architecture', projectId);
  const current = path.join(folder, 'city-plan.json');
  assert.equal(JSON.parse(fs.readFileSync(current, 'utf8')).summary, 'The second plan.');
  const history = filesUnder(folder).filter((f) => f !== current && fs.readFileSync(f, 'utf8').includes('The first plan.'));
  assert.equal(history.length, 1, `the first plan kept once: ${filesUnder(folder).join(', ')}`);
});

test('#371 a saved plan does not show up as an architecture report', async (t) => {
  const { api, projectId } = await setup(t, JS_FILES);
  const before = await call(api, 'architecture:reports', { projectId });
  await call(api, 'architecture:savePlan', { projectId, plan: JS_PLAN });
  await call(api, 'architecture:savePlan', { projectId, plan: { ...JS_PLAN, summary: 'Again.' } });
  const after = await call(api, 'architecture:reports', { projectId });
  assert.equal(JSON.stringify(after), JSON.stringify(before));
});

test('#371 architecture:city uses the saved plan, and a new plan gives a new model on the same commit', async (t) => {
  const { api, projectId } = await setup(t, JS_FILES);
  const folders = await call(api, 'architecture:city', { projectId });
  assert.equal(districtOf(folders.model, 'src/engine/run.js'), 'src/engine');
  await call(api, 'architecture:savePlan', { projectId, plan: JS_PLAN });
  const planned = await call(api, 'architecture:city', { projectId });
  assert.equal(districtOf(planned.model, 'src/engine/run.js'), 'engine');
  assert.equal(districtOf(planned.model, 'src/renderer/views/list.js'), 'ui');
  assert.equal(districtOf(planned.model, 'src/shared/globs.js'), 'outskirts');
  assert.deepEqual(planned.validation.unmatched, ['src/shared/globs.js']);
});

test('#371 architecture:city follows the project\'s exclusions', async (t) => {
  const { api, projectId } = await setup(t, JS_FILES);
  await call(api, 'architecture:city', { projectId });
  await call(api, 'architecture:setExclude', { projectId, patterns: ['src/renderer/**'] });
  const { model } = await call(api, 'architecture:city', { projectId });
  assert.equal(model.buildings.some((b) => b.path.startsWith('src/renderer/')), false);
});

// ---------- schemas ----------

test('#371 architecture:city and architecture:savePlan declare schema.params and schema.result', (t) => {
  const { service } = makeService(t);
  const schemaOf = new Map(service.manifest.filter((e) => e.channel).map((e) => [e.channel, e.schema]));
  for (const channel of ['architecture:city', 'architecture:savePlan']) {
    assert.ok(schemaOf.has(channel), `${channel} is served`);
    const s = schemaOf.get(channel);
    assert.ok(s && s.params && s.result, `${channel} declares params and result`);
  }
});

test('#371 architecture:city and architecture:savePlan reject a projectId that is not a string', async (t) => {
  const { api } = makeService(t);
  assert.equal(typeof api['architecture:city'], 'function', 'architecture:city is a channel of the service');
  assert.equal(typeof api['architecture:savePlan'], 'function', 'architecture:savePlan is a channel of the service');
  await assert.rejects(() => api['architecture:city']({ projectId: 42 }));
  await assert.rejects(() => api['architecture:savePlan']({ projectId: 42, plan: JS_PLAN }));
});
