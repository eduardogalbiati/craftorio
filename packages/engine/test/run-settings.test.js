// #862: a CLI run (scripts/run.js) follows Settings like an app run, memory guard included.
//
// Contract (packages/engine/engine/run-settings.js, new):
//   runOptionsFromSettings({ settings, ws, mock }) -> the WorkflowRun options the app derives from
//   Settings: { memoryGuard, idleWarnMs, models, fallbacks, accounts, accountCooldownMs, language,
//   testWorkers }. It configures the shared memory guard (packages/engine/engine/memory-guard.js) from
//   settings.memoryGuard over DEFAULT_SETTINGS.memoryGuard; `memoryGuard` is that guard for a real run,
//   null when the owner turned it off, and null for a simulation (mock) run like today.
//   `language` may be a value or a function (the app reads it at each turn from ws's settings.json).
// Both packages/engine/service/areas/runs.js and scripts/run.js use it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..', '..');
const load = () => require('../engine/run-settings');
const { configureMemoryGuard, sharedMemoryGuard } = require('../engine/memory-guard');
const { setupWorkspace } = require('../domains/workspace/workspace');

const GUARD_DEFAULTS = { enabled: true, limitPercent: 25, floorPercent: 10 };
const pct = (p) => Math.round(os.totalmem() * p / 100);

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// a scratch workspace whose settings.json holds `saved`
function workspaceWith(t, saved) {
  const ws = setupWorkspace(tmp(t, 'run-settings-ws-'), { persist: false });
  fs.writeFileSync(ws.settings, JSON.stringify(saved));
  return ws;
}

// the shared guard is process-wide: every test that configures it puts the defaults back
function restoreGuard(t) {
  t.after(() => configureMemoryGuard(GUARD_DEFAULTS));
}

const resolvedLanguage = (o) => (typeof o.language === 'function' ? o.language() : o.language);

// ---- the shared mapping --------------------------------------------------------------------------

test('#862 the guard turned off in Settings gives a real run no memory guard', (t) => {
  restoreGuard(t);
  const { runOptionsFromSettings } = load();
  const saved = { memoryGuard: { enabled: false, limitPercent: 25, floorPercent: 10 } };
  const ws = workspaceWith(t, saved);
  const o = runOptionsFromSettings({ settings: saved, ws, mock: false });
  assert.equal(o.memoryGuard === null, true, 'memoryGuard option is null');
  assert.equal(sharedMemoryGuard() === null, true, 'the shared guard is off too');
});

test('#862 custom limit and floor percents configure the guard a real run gets', (t) => {
  restoreGuard(t);
  const { runOptionsFromSettings } = load();
  const saved = { memoryGuard: { enabled: true, limitPercent: 40, floorPercent: 3 } };
  const ws = workspaceWith(t, saved);
  const o = runOptionsFromSettings({ settings: saved, ws, mock: false });
  assert.equal(o.memoryGuard !== null && o.memoryGuard !== undefined, true, 'a guard is set');
  assert.equal(o.memoryGuard.limitBytes, pct(40));
  assert.equal(o.memoryGuard.floorBytes, pct(3));
});

test('#862 a partial memoryGuard setting keeps the defaults for the keys it leaves out', (t) => {
  restoreGuard(t);
  // a previous configuration must not leak: the defaults fill what the settings omit
  configureMemoryGuard({ enabled: false, limitPercent: 70, floorPercent: 50 });
  const { runOptionsFromSettings } = load();
  const saved = { memoryGuard: { floorPercent: 5 } };
  const ws = workspaceWith(t, saved);
  const o = runOptionsFromSettings({ settings: saved, ws, mock: false });
  assert.equal(o.memoryGuard !== null && o.memoryGuard !== undefined, true, 'enabled comes from the defaults (on)');
  assert.equal(o.memoryGuard.limitBytes, pct(25));
  assert.equal(o.memoryGuard.floorBytes, pct(5));
});

// configureGuardFromSettings: the one place of the guard's Settings merge (the run service's
// low-memory refusal uses it too, so the refusal and the run's guard follow the same settings)
test('#862 configureGuardFromSettings returns null when the guard is off in Settings', (t) => {
  restoreGuard(t);
  const { configureGuardFromSettings } = load();
  const guard = configureGuardFromSettings({ memoryGuard: { enabled: false } });
  assert.equal(guard === null, true);
  assert.equal(sharedMemoryGuard() === null, true);
});

test('#862 configureGuardFromSettings turns the guard back on with the defaults when Settings have no memoryGuard', (t) => {
  restoreGuard(t);
  configureMemoryGuard({ enabled: false, limitPercent: 70, floorPercent: 50 });
  const { configureGuardFromSettings } = load();
  for (const s of [{}, null, undefined]) {
    configureMemoryGuard({ enabled: false, limitPercent: 70, floorPercent: 50 });
    const guard = configureGuardFromSettings(s);
    assert.equal(guard !== null, true, `guard on for ${JSON.stringify(s)}`);
    assert.equal(guard.limitBytes, pct(25));
    assert.equal(guard.floorBytes, pct(10));
  }
});

test('#862 configureGuardFromSettings applies the percents and a floor of 0 means no hold', (t) => {
  restoreGuard(t);
  const { configureGuardFromSettings } = load();
  const guard = configureGuardFromSettings({ memoryGuard: { limitPercent: 60, floorPercent: 0 } });
  assert.equal(guard.limitBytes, pct(60));
  assert.equal(guard.floorBytes, 0);
});

test('#862 a simulation run gets no memory guard, as today', (t) => {
  restoreGuard(t);
  const { runOptionsFromSettings } = load();
  const saved = { memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 } };
  const ws = workspaceWith(t, saved);
  const o = runOptionsFromSettings({ settings: saved, ws, mock: true });
  assert.equal(o.memoryGuard == null, true);
});

test('#862 idleWarningMinutes, models, providers, account cooldown, language and machine profile map to the run options', (t) => {
  restoreGuard(t);
  const { runOptionsFromSettings } = load();
  const saved = {
    idleWarningMinutes: 7,
    models: { 'claude-opus-5-5': { timeout_factor: 2 } },
    providers: {
      claude: {
        fallbacks: ['codex'],
        accounts: [{ name: 'work', dir: '/home/u/.claude-work' }, { name: 'no-dir' }],
      },
      codex: { fallbacks: [] },
    },
    accountCooldownMinutes: 15,
    language: 'pt-BR',
    machineProfile: { mode: 'manual', concurrentRuns: 3, testWorkers: 2 },
  };
  const ws = workspaceWith(t, saved);
  const o = runOptionsFromSettings({ settings: saved, ws, mock: true });
  assert.equal(o.idleWarnMs, 420000);
  assert.deepEqual(o.models, { 'claude-opus-5-5': { timeout_factor: 2 } });
  assert.deepEqual(o.fallbacks, { claude: ['codex'] });
  assert.deepEqual(o.accounts, { claude: [{ name: 'work', dir: '/home/u/.claude-work' }] });
  assert.equal(o.accountCooldownMs, 900000);
  assert.equal(resolvedLanguage(o), 'pt-BR');
  assert.equal(o.testWorkers, 2);
});

test('#862 settings without those keys keep the app\'s defaults (no idle warning override, empty models, 60 min cooldown)', (t) => {
  restoreGuard(t);
  const { runOptionsFromSettings } = load();
  const ws = workspaceWith(t, {});
  const o = runOptionsFromSettings({ settings: {}, ws, mock: true });
  assert.equal(o.idleWarnMs === undefined, true);
  assert.deepEqual(o.models, {});
  assert.deepEqual(o.fallbacks, {});
  assert.deepEqual(o.accounts, {});
  assert.equal(o.accountCooldownMs, 3600000);
  assert.equal(Number.isInteger(o.testWorkers) && o.testWorkers >= 1, true, `testWorkers ${o.testWorkers}`);
});

test('#862 the language follows a change to settings.json, read at each turn like the app', (t) => {
  restoreGuard(t);
  const { runOptionsFromSettings } = load();
  const saved = { language: 'pt-BR' };
  const ws = workspaceWith(t, saved);
  const o = runOptionsFromSettings({ settings: saved, ws, mock: true });
  assert.equal(typeof o.language, 'function');
  fs.writeFileSync(ws.settings, JSON.stringify({ language: 'es' }));
  assert.equal(o.language(), 'es');
});

test('#862 the app\'s run service and the CLI both take their Settings options from the shared function', () => {
  const service = fs.readFileSync(path.join(repoRoot, 'packages', 'engine', 'service', 'areas', 'runs.js'), 'utf8');
  const cli = fs.readFileSync(path.join(repoRoot, 'scripts', 'run.js'), 'utf8');
  assert.match(service, /run-settings/);
  assert.match(cli, /run-settings/);
  assert.match(service, /runOptionsFromSettings/);
  assert.match(cli, /runOptionsFromSettings/);
});

// ---- the CLI (scripts/run.js), simulation only ------------------------------------------------------

// Starts scripts/run.js as a real (not --mock) run in a scratch workspace whose settings.json holds
// `saved`, with the probe preloaded: it reports what the CLI handed to WorkflowRun and exits before
// any step runs (MULTIAGENT_SIMULATION_ONLY=1: no real model can be called anyway).
function cliRun(t, saved) {
  const scratch = tmp(t, 'run-settings-cli-');
  fs.writeFileSync(path.join(scratch, 'settings.json'), JSON.stringify(saved));
  const repo = tmp(t, 'run-settings-repo-');
  const out = execFileSync(process.execPath, [
    '--require', path.join(__dirname, 'fixtures', 'run-settings-probe.js'),
    path.join(repoRoot, 'scripts', 'run.js'),
    '--auto-approve',
    '--file', path.join(__dirname, 'fixtures', 'run-script.yaml'),
    '--repo', repo,
    '--task', 'probe the settings',
  ], {
    cwd: repoRoot,
    env: { ...process.env, MULTIAGENT_SIMULATION_ONLY: '1', MULTIAGENT_WORKSPACE: scratch },
    encoding: 'utf8',
    timeout: 120000,
  });
  const line = out.split('\n').find((l) => l.startsWith('RUN-SETTINGS-PROBE '));
  assert.equal(typeof line, 'string', `the CLI built its run (output: ${out.slice(0, 500)})`);
  return JSON.parse(line.slice('RUN-SETTINGS-PROBE '.length));
}

test('#862 a CLI run with the memory guard off in Settings builds a run without a memory guard', (t) => {
  const r = cliRun(t, { memoryGuard: { enabled: false, limitPercent: 25, floorPercent: 10 } });
  assert.equal(r.memoryGuard, null);
});

test('#862 a CLI run uses the limit and floor percents of Settings', (t) => {
  const r = cliRun(t, { memoryGuard: { enabled: true, limitPercent: 40, floorPercent: 3 } });
  assert.equal(r.memoryGuard !== null, true, 'the guard is on');
  assert.equal(r.memoryGuard.limitBytes, pct(40));
  assert.equal(r.memoryGuard.floorBytes, pct(3));
});

test('#862 a CLI run gets the other Settings options the app passes', (t) => {
  const r = cliRun(t, {
    idleWarningMinutes: 9,
    models: { 'claude-sonnet-5-5': { timeout_factor: 3 } },
    providers: { claude: { fallbacks: ['codex'], accounts: [{ name: 'home', dir: '/home/u/.claude-home' }] } },
    accountCooldownMinutes: 30,
    language: 'pt-BR',
    machineProfile: { mode: 'manual', concurrentRuns: 2, testWorkers: 3 },
  });
  assert.equal(r.idleWarnMs, 540000);
  assert.deepEqual(r.models, { 'claude-sonnet-5-5': { timeout_factor: 3 } });
  assert.deepEqual(r.fallbacks, { claude: ['codex'] });
  assert.deepEqual(r.accounts, { claude: [{ name: 'home', dir: '/home/u/.claude-home' }] });
  assert.equal(r.accountCooldownMs, 1800000);
  assert.equal(r.language, 'pt-BR');
  assert.equal(r.testWorkers, 3);
});
