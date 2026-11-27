// #101: the E2E hook of features/steps/project-wizard-101-102-103.steps.js. In a simulated run
// (CRAFTORIO_SIMULATION_ONLY=1) CRAFTORIO_E2E_ONBOARDING_ANALYZE_REFUSE=1 makes onboarding:analyze refuse
// (a client error, "The simulated analysis was refused (e2e).") before starting anything; outside a simulation the
// variable is ignored. Seams: the whole service in a simulation (test/service/helpers.js makeService) and the area
// with a fake ctx and no simulation (packages/engine/service/areas/project-onboarding.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// the machine slot the paid jobs take: a folder of this file, never the machine's
process.env.CRAFTORIO_LOCKS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-refuse-101-locks-'));

const REFUSAL = 'The simulated analysis was refused (e2e).';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
}

// a local repository with one commit (cloned by path: real git, no network)
function repoWith(t) {
  const dir = tmp(t, 'analyze-refuse-101-repo-');
  const git = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git(['init', '-q']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# refuse\n');
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = 1;\n');
  git(['add', '-A']);
  git(['commit', '-q', '--no-verify', '-m', 'first']);
  return dir;
}

async function until(status, pred, what, tries = 600) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await status();
    if (pred(last)) return last;
    await pause(50);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

function withEnv(t, name, value) {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  t.after(() => { if (prev === undefined) delete process.env[name]; else process.env[name] = prev; });
}

test('#101 (service, simulated) with the refuse hook, onboarding:analyze is refused with the hook\'s message and starts nothing', { timeout: 60000 }, async (t) => {
  withEnv(t, 'CRAFTORIO_SIMULATION_ONLY', '1');
  const { makeService } = require('./service/helpers');
  const { api } = makeService(t);
  const s = await api['onboarding:start']({ name: 'Refuse', repo: repoWith(t) });
  const id = s.projectId;
  const status = () => api['onboarding:status']({ projectId: id });
  await until(status, (x) => x.status === 'ready' || x.status === 'failed', 'the clone ends');
  assert.equal((await status()).status, 'ready', 'the clone is ready');
  // the free jobs a clone runs by itself have settled: what the refusal must not change
  // (the paid projectMap job stays `waiting` for analyze)
  const idle = (x) => Object.values(x.jobs || {}).every((j) => j?.status !== 'running');
  const before = await until(status, idle, 'the clone\'s own jobs settle');
  const jobStates = (x) => JSON.stringify(Object.fromEntries(Object.entries(x.jobs || {}).map(([k, j]) => [k, j?.status ?? null])));

  withEnv(t, 'CRAFTORIO_E2E_ONBOARDING_ANALYZE_REFUSE', '1');
  await assert.rejects(() => api['onboarding:analyze']({ projectId: id }), (e) => {
    assert.equal(String(e?.message), REFUSAL);
    return true;
  });
  await pause(200);
  const after = await status();
  assert.equal(after.status, 'ready', `nothing started: ${JSON.stringify(after.status)}`);
  assert.equal(!!after.wanted, false, 'no analysis is marked wanted');
  assert.equal(jobStates(after), jobStates(before), 'no job started or changed');
  assert.equal(['running', 'done'].includes(after.jobs?.projectMap?.status), false, `the paid projectMap job did not start: ${JSON.stringify(after.jobs?.projectMap)}`);
});

test('#101 (service, simulated) while cloning, the refuse hook refuses too: the analysis is not marked wanted', { timeout: 60000 }, async (t) => {
  withEnv(t, 'CRAFTORIO_SIMULATION_ONLY', '1');
  withEnv(t, 'CRAFTORIO_E2E_ONBOARDING_HOLD', 'clone');
  const { makeService } = require('./service/helpers');
  const { api } = makeService(t);
  const s = await api['onboarding:start']({ name: 'Refuse', repo: repoWith(t) });
  const id = s.projectId;
  const status = () => api['onboarding:status']({ projectId: id });
  withEnv(t, 'CRAFTORIO_E2E_ONBOARDING_ANALYZE_REFUSE', '1');
  await assert.rejects(() => api['onboarding:analyze']({ projectId: id }), (e) => {
    assert.equal(String(e?.message), REFUSAL);
    return true;
  });
  const after = await status();
  assert.equal(!!after.wanted, false, `no analysis is marked wanted: ${JSON.stringify(after.wanted)}`);
});

test('#101 outside a simulation the refuse hook is ignored: analyze answers as it would without it', { timeout: 30000 }, async (t) => {
  withEnv(t, 'CRAFTORIO_SIMULATION_ONLY', undefined);
  withEnv(t, 'CRAFTORIO_E2E_ONBOARDING_ANALYZE_REFUSE', '1');
  const { setupWorkspace } = require('../domains/workspace/workspace');
  const { EventEmitter } = require('events');
  const ws = setupWorkspace(tmp(t, 'analyze-refuse-101-ws-'), { persist: false });
  const ctx = { ws, events: new EventEmitter(), oracleService: () => ({ budgetRefusal: () => null, oneTurn: async () => assert.fail('no model turn') }) };
  const area = require('../service/areas/project-onboarding')(ctx);
  await assert.rejects(() => area.onboardingAnalyze({ projectId: 'p-unknown' }), (e) => {
    assert.notEqual(String(e?.message), REFUSAL, 'not the e2e refusal');
    assert.match(String(e?.message), /p-unknown/, 'the usual answer for a project with no onboarding');
    return true;
  });
});
