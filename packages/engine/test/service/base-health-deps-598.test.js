// #598: the base check gets its dependencies before the suite, and a check that could not run is
// visible (engine log, notification, store).
//
// Seams:
// - The service area (packages/engine/service/areas/base-health.js) built from a small ctx:
//   afterBaseMerge's promise (the result), ctx.notify (the owner's notification), the engine's log
//   lines (console, where the service's log goes).
// - The store file <workspace>/backlog/base-health/<project>.json, read as JSON.
//
// Assumptions:
// - The fixture is an npm workspaces monorepo with no registry dependency: its real `npm ci` runs
//   offline in about a second, through the shared cache or the project's own install. Its suite
//   (`node check.js`) requires a workspace package, so it is green only with the dependencies.
// - The store records the last check as `lastCheck: { commit, at, status }` (the issue names the
//   three facts, not the key); `lastGreen` keeps its shape.
// - The check's log (baseCheckLog) names the dependency step with the word "dependencies".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService, gitRepo } = require('./helpers');

const loadArea = () => require('../../service/areas/base-health');
const loadHealth = () => require('../../domains/project/base-health');

// #538, #539: the check takes the `suite` slot in MULTIAGENT_LOCKS_DIR; each test gets its own folder
let saved;
test.beforeEach(() => {
  saved = { locks: process.env.MULTIAGENT_LOCKS_DIR, inherit: process.env.MULTIAGENT_SUITE_SLOT };
  delete process.env.MULTIAGENT_SUITE_SLOT;
  saved.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh598-locks-'));
  process.env.MULTIAGENT_LOCKS_DIR = saved.dir;
});
test.afterEach(() => {
  for (const [k, v] of [['MULTIAGENT_LOCKS_DIR', saved.locks], ['MULTIAGENT_SUITE_SLOT', saved.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(saved.dir, { recursive: true, force: true, maxRetries: 3 });
});

// An npm workspaces monorepo in git (main): packages/a is `@scope/a`; `npm test` requires it.
function workspacesRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh598-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh598-gitcfg-'));
  t.after(() => fs.rmSync(cfgDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cfgDir, 'config'), '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(cfgDir, 'config'), GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  };
  const rootPkg = { name: 'wsfix', version: '1.0.0', private: true, workspaces: ['packages/*'], scripts: { test: 'node check.js' } };
  write('package.json', rootPkg);
  write('packages/a/package.json', { name: '@scope/a', version: '1.0.0', main: 'index.js' });
  write('packages/a/index.js', 'module.exports = __filename;\n');
  write('package-lock.json', {
    name: 'wsfix', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'wsfix', version: '1.0.0', workspaces: ['packages/*'] },
      'node_modules/@scope/a': { resolved: 'packages/a', link: true },
      'packages/a': { name: '@scope/a', version: '1.0.0' },
    },
  });
  write('check.js', "require('@scope/a');\nconsole.log('workspace package loaded');\n");
  write('.gitignore', 'node_modules\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  const commit = (message, files) => {
    for (const [rel, data] of Object.entries(files)) write(rel, data);
    git('add', '.');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  return { dir, head: git('rev-parse', 'HEAD'), commit, rootPkg };
}

async function setup(t, repoDir) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const project = await api['projects:create']({ name: 'bh598', folder: repoDir });
  const notices = [];
  const ctx = { ws, active: new Map(), isReleaseRun: (r) => !!r.release, notify: (n) => notices.push(n) };
  return { ws, project, notices, area: loadArea()(ctx) };
}

// the engine's log lines (console) while `fn` runs
async function captureLog(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(saved)) console[k] = (...args) => { lines.push(args.map(String).join(' ')); };
  try { return { result: await fn(), lines }; } finally { Object.assign(console, saved); }
}

const storeOf = (ws, projectId) => JSON.parse(fs.readFileSync(path.join(ws.root, 'backlog', 'base-health', `${path.basename(String(projectId)).replace(/[^\w.-]+/g, '-')}.json`), 'utf8'));
const run = (project) => ({ projectId: project.id, runId: 'run-1', mock: false });
const noticeText = (n) => `${n.title} ${n.body}`;

test('#598 a workspaces project gets its dependencies in the check\'s checkout before the suite: the base is green, the store records the check', { timeout: 180000 }, async (t) => {
  const repo = workspacesRepo(t);
  const { ws, project, notices, area } = await setup(t, repo.dir);
  const r = await area.afterBaseMerge(run(project), { base: 'main' });
  assert.equal(r.status, 'green', `the suite ran with its dependencies: ${r.error || ''}`);
  assert.equal(r.commit, repo.head);
  assert.equal(notices.length, 0, 'a green check is silent');

  const store = storeOf(ws, project.id);
  assert.equal(store.lastGreen?.commit, repo.head);
  assert.equal(store.lastCheck?.commit, repo.head);
  assert.equal(store.lastCheck?.status, 'green');
  assert.ok(!Number.isNaN(Date.parse(store.lastCheck?.at)), 'the time of the check');

  const log = fs.readFileSync(loadHealth().baseCheckLog(ws.root, project.id), 'utf8');
  assert.match(log, /dependencies/i, 'the dependency step is in the check\'s log');
  assert.match(log, /workspace package loaded/, 'the suite ran after it');
});

test('#598 a project the cache refuses (a file: dependency) gets the project\'s own install in the checkout, in the check\'s log, and its suite runs green', { timeout: 180000 }, async (t) => {
  const repo = workspacesRepo(t);
  const head = repo.commit('a local file: dependency', {
    'package.json': { ...repo.rootPkg, dependencies: { local: 'file:vendor/local' } },
    'vendor/local/package.json': { name: 'local', version: '1.0.0', main: 'index.js' },
    'vendor/local/index.js': 'module.exports = 1;\n',
    'package-lock.json': {
      name: 'wsfix', version: '1.0.0', lockfileVersion: 3, requires: true,
      packages: {
        '': { name: 'wsfix', version: '1.0.0', workspaces: ['packages/*'], dependencies: { local: 'file:vendor/local' } },
        'node_modules/@scope/a': { resolved: 'packages/a', link: true },
        'node_modules/local': { resolved: 'vendor/local', link: true },
        'packages/a': { name: '@scope/a', version: '1.0.0' },
        'vendor/local': { version: '1.0.0' },
      },
    },
    'check.js': "require('@scope/a');\nrequire('local');\nconsole.log('workspace package loaded');\n",
  });
  const { ws, project, notices, area } = await setup(t, repo.dir);
  const r = await area.afterBaseMerge(run(project), { base: 'main' });
  assert.equal(r.status, 'green', `the suite ran with its dependencies: ${r.error || ''}`);
  assert.equal(r.commit, head);
  assert.equal(notices.length, 0);
  const log = fs.readFileSync(loadHealth().baseCheckLog(ws.root, project.id), 'utf8');
  assert.match(log, /not cached/, 'the log says the cache does not serve it');
  assert.match(log, /npm ci --no-audit --no-fund/, 'the project\'s own install command');
  assert.match(log, /dependencies: installed in the checkout in \d+\.\d s/, 'with its time');
  assert.ok(log.indexOf('npm ci') < log.indexOf('workspace package loaded'), 'the install before the suite');
  const projectCache = path.join(ws.cache, 'deps', require('../../engine/deps-cache').projectSlug(project.id));
  assert.equal(fs.existsSync(projectCache) && fs.readdirSync(projectCache).length > 0, false, 'nothing went into the shared cache');
});

test('#598 a check that could not run (no test command) is announced: one engine log line with the reason and the log file, a notification, no issue and no fix item', async (t) => {
  const repo = gitRepo(t);
  const { ws, project, notices, area } = await setup(t, repo.dir);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir }).toString().trim();
  const { result: r, lines } = await captureLog(() => area.afterBaseMerge(run(project), { base: 'main' }));
  assert.equal(r.status, 'error');
  assert.deepEqual(r.issues || [], [], 'no "Red on the base" issue');
  assert.equal(r.fixItem || null, null, 'no "Fix the base" item');

  const logFile = loadHealth().baseCheckLog(ws.root, project.id);
  const logged = lines.filter((l) => l.includes('no test command found') && l.includes(logFile));
  assert.equal(logged.length, 1, `one engine log line names the reason and the log file: ${JSON.stringify(lines)}`);

  assert.equal(notices.length, 1, 'the owner is notified');
  assert.match(noticeText(notices[0]), /Base check could not run/);
  assert.match(noticeText(notices[0]), /no test command found/);

  const store = storeOf(ws, project.id);
  assert.equal(store.lastCheck?.status, 'error');
  assert.equal(store.lastCheck?.commit, head);
  assert.equal(store.lastGreen || null, null, 'lastGreen is only a green check');
  assert.deepEqual(store.failures, [], 'nothing is known about the tests');
});

test('#598 an install that fails ends the check in error before the suite; lastGreen stays the last green commit', { timeout: 240000 }, async (t) => {
  const repo = workspacesRepo(t);
  const { ws, project, notices, area } = await setup(t, repo.dir);
  assert.equal((await area.afterBaseMerge(run(project), { base: 'main' })).status, 'green');

  // package.json asks for a package the lockfile lacks: `npm ci` refuses before any download
  const broken = repo.commit('out of sync', {
    'package.json': { ...repo.rootPkg, dependencies: { 'left-pad': '1.3.0' } },
    'check.js': "console.log('the suite ran');\n",
  });
  const { result: r } = await captureLog(() => area.afterBaseMerge(run(project), { base: 'main' }));
  assert.equal(r.status, 'error');
  assert.equal(r.commit, broken);
  assert.match(String(r.error), /install|dependenc/i, `the reason names the install: ${r.error}`);
  let log = '';
  try { log = fs.readFileSync(loadHealth().baseCheckLog(ws.root, project.id), 'utf8'); } catch { /* no log */ }
  assert.doesNotMatch(log, /the suite ran/, 'the suite did not run');

  assert.equal(notices.length, 1);
  assert.match(noticeText(notices[0]), /Base check could not run/);

  const store = storeOf(ws, project.id);
  assert.equal(store.lastCheck?.status, 'error');
  assert.equal(store.lastCheck?.commit, broken);
  assert.equal(store.lastGreen?.commit, repo.head, 'lastGreen stays the last green commit');
});
