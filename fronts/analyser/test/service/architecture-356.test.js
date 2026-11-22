// #356: the Architecture tab's service channels, through makeService on a git fixture repository.
// architecture:facts reads the default branch (main), not the checked-out one, and is rebuilt when
// main moves; a plain folder is 'not-git', an empty window 'no-commits'; architecture:setExclude
// saves the project's exclude list; architecture:analyze (mock) saves a report under
// <workspace>/architecture/<projectId>/ and refuses a second concurrent analysis;
// architecture:reports / architecture:report / architecture:estimate read the saved reports (runs
// since, new/gone findings, the cost estimate); architecture:createIssue (#730, in place of
// sendToRefactor) files a finding as an issue. Every new channel declares schema.params/result.
// The channels are created by the change: each test calls them through the service (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('@craftorio/engine/test/service/helpers');

const CHANNELS = [
  'architecture:analyze',
  'architecture:createIssue',
  'architecture:estimate',
  'architecture:facts',
  'architecture:report',
  'architecture:reports',
  'architecture:setExclude',
  'refactor:proposals',
];

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// A fixture repo: four commits on main (app + util together twice), fixed dates 2026-01-0N.
function fixtureRepo(t) {
  const dir = tmp(t, 'arch356-repo-');
  let day = 1;
  const git = (args, env = {}) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const write = (rel, text) => {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const commit = (message) => {
    const date = `2026-01-${String(day++).padStart(2, '0')}T12:00:00Z`;
    git(['add', '-A']);
    git(['commit', '-q', '--no-verify', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q']);
  write('src/app.js', 'const a = 1;\nmodule.exports = a;\n');
  write('src/util.js', 'module.exports = 2;\n');
  write('lib/model.py', 'class Model:\n    pass\n');
  write('package-lock.json', '{}\n');
  write('dist/out.js', 'built\n');
  commit('first');
  write('src/app.js', 'const a = 2;\nmodule.exports = a;\n');
  write('src/util.js', 'module.exports = 3;\n');
  commit('app and util');
  write('src/app.js', 'const a = 3;\nmodule.exports = a;\n');
  write('src/util.js', 'module.exports = 4;\n');
  commit('app and util again');
  write('lib/model.py', 'class Model:\n    x = 1\n');
  const main = commit('model');
  return { dir, git, write, commit, main };
}

async function setup(t) {
  const { service, api } = makeService(t);
  const repo = fixtureRepo(t);
  const project = await api['projects:create']({ name: 'arch', folder: repo.dir });
  return { service, api, repo, projectId: project.id };
}

async function call(api, channel, args) {
  assert.equal(typeof api[channel], 'function', `${channel} is a channel of the service`);
  return api[channel](args);
}

const row = (model, file) => model.files.find((f) => f.file === file);

async function analyzed(api, projectId) {
  const out = await call(api, 'architecture:analyze', { projectId, mock: true });
  assert.ok(out && out.report, 'analyze gives a saved report');
  return out.report;
}

// ---------- facts ----------

test('#356 architecture:facts of a git project: files with their commits, exclusions, languages, branch and head', async (t) => {
  const { api, repo, projectId } = await setup(t);
  const { state, model } = await call(api, 'architecture:facts', { projectId });
  assert.equal(state, 'ok');
  assert.equal(row(model, 'src/app.js').commits, 2);
  assert.equal(row(model, 'lib/model.py').commits, 1);
  assert.equal(row(model, 'package-lock.json'), undefined);
  assert.equal(row(model, 'dist/out.js'), undefined);
  const languages = model.languages.map((l) => l.language);
  assert.ok(languages.includes('JavaScript'), 'JavaScript');
  assert.ok(languages.includes('Python'), 'Python');
  assert.equal(model.branch, 'main');
  assert.equal(model.head.commit, repo.main);
});

test('#356 architecture:facts reads the default branch, not the checked-out one', async (t) => {
  const { api, repo, projectId } = await setup(t);
  repo.git(['checkout', '-q', '-b', 'feature']);
  repo.write('src/feature.js', 'module.exports = 5;\n');
  const feature = repo.commit('feature');
  assert.notEqual(feature, repo.main);
  const { model } = await call(api, 'architecture:facts', { projectId });
  assert.equal(model.head.commit, repo.main);
  assert.equal(row(model, 'src/feature.js'), undefined);
});

test('#356 architecture:facts follows a new commit on main (no stale cache)', async (t) => {
  const { api, repo, projectId } = await setup(t);
  const before = await call(api, 'architecture:facts', { projectId });
  assert.equal(before.model.head.commit, repo.main);
  repo.write('src/app.js', 'const a = 4;\nmodule.exports = a;\n');
  const next = repo.commit('app once more');
  const after = await call(api, 'architecture:facts', { projectId });
  assert.equal(after.model.head.commit, next);
  assert.equal(row(after.model, 'src/app.js').commits, 3);
});

test('#356 architecture:facts of a plain folder is not-git', async (t) => {
  const { api } = makeService(t);
  const folder = tmp(t, 'arch356-plain-');
  fs.writeFileSync(path.join(folder, 'a.txt'), 'a\n');
  const project = await api['projects:create']({ name: 'plain', folder });
  const out = await call(api, 'architecture:facts', { projectId: project.id });
  assert.equal(out.state, 'not-git');
  assert.equal(out.model, null);
});

test('#356 architecture:facts with a window holding no commit is no-commits', async (t) => {
  const { api, projectId } = await setup(t);
  const out = await call(api, 'architecture:facts', { projectId, since: '2099-01-01T00:00:00Z' });
  assert.equal(out.state, 'no-commits');
});

test('#356 architecture:setExclude saves the exclude list and facts honour it', async (t) => {
  const { api, projectId } = await setup(t);
  await call(api, 'architecture:setExclude', { projectId, patterns: ['lib/**'] });
  const { model } = await call(api, 'architecture:facts', { projectId });
  assert.equal(row(model, 'lib/model.py'), undefined);
  assert.ok(row(model, 'src/app.js'), 'src/app.js still there');
});

// ---------- analyze and the saved reports ----------

test('#356 architecture:analyze (mock) saves a simulated report under the workspace and lists it', async (t) => {
  const { service, api, projectId } = await setup(t);
  const saved = await analyzed(api, projectId);
  assert.equal(typeof saved.report.summary, 'string');
  assert.ok(saved.report.summary.trim().length > 0, 'summary not empty');
  assert.ok(Array.isArray(saved.report.findings), 'findings array');
  assert.equal(saved.simulated, true);
  const dir = path.join(service.workspace().root, 'architecture', projectId);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  assert.ok(files.length >= 1, `a .json report under ${dir}`);
  const list = await call(api, 'architecture:reports', { projectId });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, saved.id);
});

test('#356 architecture:analyze refuses a second analysis while one is running', async (t) => {
  const { api, projectId } = await setup(t);
  assert.equal(typeof api['architecture:analyze'], 'function', 'architecture:analyze is a channel');
  const results = await Promise.allSettled([
    Promise.resolve().then(() => api['architecture:analyze']({ projectId, mock: true })),
    Promise.resolve().then(() => api['architecture:analyze']({ projectId, mock: true })),
  ]);
  const reports = results.filter((r) => r.status === 'fulfilled' && r.value && r.value.report).length;
  const refused = results.filter((r) => r.status === 'rejected' || (r.value && r.value.refused)).length;
  assert.equal(reports, 1);
  assert.equal(refused, 1);
});

function writeRun(service, runId, { projectId, mock, finishedAt }) {
  const dir = path.join(service.workspace().runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  const startedAt = new Date(Date.parse(finishedAt) - 60000).toISOString();
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    { type: 'workflow.started', ts: startedAt, workflow: 'fixture-service', project_id: projectId },
    { type: 'workflow.finished', ts: finishedAt, status: 'success' },
  ].map((e) => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    workflow: 'fixture-service', status: 'success', mock, project_id: projectId,
    started_at: startedAt, finished_at: finishedAt, sessions: [],
  }));
}

test('#356 architecture:report gives the latest report with marked findings, gone ones and the real runs since', async (t) => {
  const { service, api, projectId } = await setup(t);
  await analyzed(api, projectId);
  const first = await call(api, 'architecture:report', { projectId });
  assert.ok(Array.isArray(first.findings), 'findings array');
  assert.ok(Array.isArray(first.gone), 'gone array');
  assert.equal(first.runsSince, 0);
  const later = new Date(Date.now() + 60000).toISOString();
  writeRun(service, '20991231-000000-real0001', { projectId, mock: false, finishedAt: later });
  writeRun(service, '20991231-000000-mock0001', { projectId, mock: true, finishedAt: later });
  const second = await call(api, 'architecture:report', { projectId });
  assert.equal(second.runsSince, 1);
});

test('#356 architecture:estimate is null when every saved report is simulated', async (t) => {
  const { api, projectId } = await setup(t);
  await analyzed(api, projectId);
  const out = await call(api, 'architecture:estimate', { projectId });
  assert.equal(out.estimate, null);
});

// ---------- schemas ----------

test('#356 every architecture:* and refactor:* channel declares schema.params and schema.result', (t) => {
  const { service } = makeService(t);
  const schemaOf = new Map(service.manifest.filter((e) => e.channel).map((e) => [e.channel, e.schema]));
  const missing = CHANNELS.filter((c) => !schemaOf.has(c));
  assert.deepEqual(missing, [], 'channels not served');
  const declared = [...schemaOf.keys()].filter((c) => /^(architecture|refactor):/.test(c));
  const without = declared.filter((c) => { const s = schemaOf.get(c); return !(s && s.params && s.result); }).sort();
  assert.deepEqual(without, []);
});

test('#356 an architecture channel rejects a projectId that is not a string', async (t) => {
  const { api } = makeService(t);
  assert.equal(typeof api['architecture:facts'], 'function', 'architecture:facts is a channel');
  await assert.rejects(async () => api['architecture:facts']({ projectId: 123 }));
});
