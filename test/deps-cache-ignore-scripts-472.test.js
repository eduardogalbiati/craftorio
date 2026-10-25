// #472 (SEC-7) acceptance tests, written before the code: a run must not execute the repository's
// own install scripts when the project says so.
//
// Interface the developer implements (assumptions, documented here):
//   - src/engine/deps-cache.js ensureDeps({ ..., ignoreScripts }) : a new boolean option, default
//     false. When true, the cache install runs with `--ignore-scripts` appended to the manager's args
//     (`npm ci --no-audit --no-fund --ignore-scripts`, `yarn install --frozen-lockfile --ignore-scripts`,
//     `pnpm install --frozen-lockfile --ignore-scripts`), and a cache hit runs none of the project's
//     lifecycle scripts (runLifecycle is what executes them on a hit).
//   - The per-project setting is `ignoreInstallScripts` in <workspace>/projects/<id>.json, camelCase
//     like the existing per-project booleans (`autoPush`, `autoEpic`), set through
//     src/domains/project/projects.js updateProject(dir, id, { ignoreInstallScripts }) and read back by readProject.
//     Absent = off (the user's own projects run their scripts as today). The run gets it as the
//     WorkflowRun option `ignoreInstallScripts` and passes it to ensureDeps as `ignoreScripts`
//     (see test/run-repo-commands-log-472.test.js).
// `run` is injected (a fake installer, as test/deps-cache.test.js does): never spawns a real npm.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// A folder detect() reads as a project of `lockfile`'s manager, with optional package.json scripts
function project(dir, { lockfile = 'package-lock.json', scripts } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', ...(scripts ? { scripts } : {}) }));
  fs.writeFileSync(path.join(dir, lockfile), '{}');
}

// A fake package manager: records every call, answers --version, fills node_modules on an install
function recordingRun() {
  const calls = [];
  const run = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args: [...args], cwd: opts.cwd });
    if (args[0] === '--version') return { code: 0, output: '1.0.0', timedOut: false };
    if (args[0] === 'run') return { code: 0, output: '', timedOut: false };
    const nm = path.join(opts.cwd, 'node_modules');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, '.package-lock.json'), '{}');
    return { code: 0, output: '', timedOut: false };
  };
  const installs = () => calls.filter((c) => c.args[0] === 'ci' || c.args[0] === 'install');
  const scriptsIn = (dir) => calls.filter((c) => c.args[0] === 'run' && c.cwd === dir).map((c) => c.args[c.args.length - 1]);
  return { run, installs, scriptsIn };
}

test('#472 ensureDeps with ignoreScripts: true installs with npm ci --ignore-scripts', async (t) => {
  const depsCache = require('../src/engine/deps-cache');
  const cacheDir = tmpDir(t, 'deps-472-cache-');
  const wt = tmpDir(t, 'deps-472-wt-');
  project(wt);
  const { run, installs } = recordingRun();
  const r = await depsCache.ensureDeps({ workDir: wt, cacheDir, project: 'p', env: {}, run, ignoreScripts: true });
  assert.equal(r.status, 'miss');
  assert.equal(installs().length, 1);
  assert.equal(installs()[0].cmd, 'npm');
  assert.equal(installs()[0].args[0], 'ci');
  assert.equal(installs()[0].args.includes('--ignore-scripts'), true, `install args: ${JSON.stringify(installs()[0].args)}`);
});

test('#472 ensureDeps without the option (default) installs without --ignore-scripts', async (t) => {
  const depsCache = require('../src/engine/deps-cache');
  const cacheDir = tmpDir(t, 'deps-472-cache-');
  const wt = tmpDir(t, 'deps-472-wt-');
  project(wt);
  const { run, installs } = recordingRun();
  await depsCache.ensureDeps({ workDir: wt, cacheDir, project: 'p', env: {}, run });
  assert.equal(installs().length, 1);
  assert.equal(installs()[0].args.includes('--ignore-scripts'), false, `install args: ${JSON.stringify(installs()[0].args)}`);
});

test('#472 ensureDeps with ignoreScripts: false installs without --ignore-scripts', async (t) => {
  const depsCache = require('../src/engine/deps-cache');
  const cacheDir = tmpDir(t, 'deps-472-cache-');
  const wt = tmpDir(t, 'deps-472-wt-');
  project(wt);
  const { run, installs } = recordingRun();
  await depsCache.ensureDeps({ workDir: wt, cacheDir, project: 'p', env: {}, run, ignoreScripts: false });
  assert.equal(installs().length, 1);
  assert.equal(installs()[0].args.includes('--ignore-scripts'), false);
});

test('#472 ensureDeps with ignoreScripts: true passes --ignore-scripts to yarn install --frozen-lockfile too', async (t) => {
  const depsCache = require('../src/engine/deps-cache');
  const cacheDir = tmpDir(t, 'deps-472-cache-');
  const wt = tmpDir(t, 'deps-472-wt-');
  project(wt, { lockfile: 'yarn.lock' });
  const { run, installs } = recordingRun();
  await depsCache.ensureDeps({ workDir: wt, cacheDir, project: 'p', env: {}, run, ignoreScripts: true });
  assert.equal(installs().length, 1);
  assert.equal(installs()[0].cmd, 'yarn');
  assert.equal(installs()[0].args.includes('--frozen-lockfile'), true);
  assert.equal(installs()[0].args.includes('--ignore-scripts'), true, `install args: ${JSON.stringify(installs()[0].args)}`);
});

test('#472 a cache hit with ignoreScripts: true runs none of the project\'s lifecycle scripts', async (t) => {
  const depsCache = require('../src/engine/deps-cache');
  const cacheDir = tmpDir(t, 'deps-472-cache-');
  const scripts = { preinstall: 'x', postinstall: 'x', prepare: 'x' };
  const { run, scriptsIn } = recordingRun();
  const wtA = tmpDir(t, 'deps-472-wtA-');
  project(wtA, { scripts });
  await depsCache.ensureDeps({ workDir: wtA, cacheDir, project: 'p', env: {}, run, ignoreScripts: true });
  const wtB = tmpDir(t, 'deps-472-wtB-');
  project(wtB, { scripts });
  const r = await depsCache.ensureDeps({ workDir: wtB, cacheDir, project: 'p', env: {}, run, ignoreScripts: true });
  assert.equal(r.status, 'hit');
  assert.deepEqual(scriptsIn(wtB), []);
});

// ---- the per-project setting (src/domains/project/projects.js) --------------------------------------------------

test('#472 a new project has the "install without scripts" setting off', async (t) => {
  const projects = require('../src/domains/project/projects');
  const dir = tmpDir(t, 'projects-472-');
  const p = await projects.createProject(dir, { name: 'Mine', folder: path.join(dir, 'mine') });
  assert.equal(!!projects.readProject(dir, p.id).ignoreInstallScripts, false);
});

test('#472 updateProject stores ignoreInstallScripts: true and readProject returns it', async (t) => {
  const projects = require('../src/domains/project/projects');
  const dir = tmpDir(t, 'projects-472-');
  const p = await projects.createProject(dir, { name: 'Cloned', folder: path.join(dir, 'cloned') });
  projects.updateProject(dir, p.id, { ignoreInstallScripts: true });
  assert.equal(projects.readProject(dir, p.id).ignoreInstallScripts, true);
});

test('#472 updateProject turns ignoreInstallScripts back off', async (t) => {
  const projects = require('../src/domains/project/projects');
  const dir = tmpDir(t, 'projects-472-');
  const p = await projects.createProject(dir, { name: 'Cloned', folder: path.join(dir, 'cloned') });
  projects.updateProject(dir, p.id, { ignoreInstallScripts: true });
  projects.updateProject(dir, p.id, { ignoreInstallScripts: false });
  assert.equal(projects.readProject(dir, p.id).ignoreInstallScripts, false);
});
