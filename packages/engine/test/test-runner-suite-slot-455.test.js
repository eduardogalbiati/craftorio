// scripts/test.js and the machine-wide suite slot (#455): in agent mode, the whole suite (no file
// list) waits for the `suite` slot another run holds and says so in its human log; a focused run
// (a file list) never touches the slot. The slot folder is a temp MULTIAGENT_LOCKS_DIR holding a hold
// of this test's own (live) process; the waiting runner is stopped as soon as it says it waits, so
// the whole suite never starts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { SUITE_SLOT_ENV } = require('../engine/machine-slot');

const root = path.join(__dirname, '..', '..', '..');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-suite-slot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return dir;
}

// another run's hold of the suite slot in <dir>/suite.slot
function hold(dir) {
  const locks = path.join(dir, 'locks');
  fs.mkdirSync(locks, { recursive: true });
  const slot = path.join(locks, 'suite.slot');
  fs.writeFileSync(slot, JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'other-run-token', started: Date.now(), holder: 'run-a' }));
  return { locks, slot };
}

// agent mode, the slot folder in `locks`, no inherited suite slot (this test may run inside a suite step)
function agentEnv(dir, locks) {
  const env = { ...process.env, MULTIAGENT_AGENT_MODE: '1', MULTIAGENT_TEST_CONCURRENCY: '1', MULTIAGENT_TEST_HUMAN_LOG: path.join(dir, 'human.log'), MULTIAGENT_LOCKS_DIR: locks };
  delete env.NODE_TEST_CONTEXT;
  delete env[SUITE_SLOT_ENV];
  return env;
}

const humanLog = (dir) => { try { return fs.readFileSync(path.join(dir, 'human.log'), 'utf8'); } catch { return ''; } };

test('scripts/test.js: an agent\'s whole suite waits for the suite slot another run holds and says who holds it (#455)', { timeout: 60000 }, async (t) => {
  const dir = tmpDir(t);
  const { locks, slot } = hold(dir);
  const child = spawn(process.execPath, ['scripts/test.js'], { cwd: root, env: agentEnv(dir, locks), stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => { exited = true; });
  t.after(() => { if (!exited) child.kill(); });
  const deadline = Date.now() + 30000;
  while (!/waiting for the suite slot/.test(humanLog(dir)) && !exited && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  const text = humanLog(dir);
  assert.match(text, /waiting for the suite slot/, `human log: ${text.slice(0, 500)}`);
  assert.match(text, /run-a/);
  assert.match(text, new RegExp(`pid ${process.pid}`));
  assert.equal(exited, false, 'still waiting: the whole suite has not started');
  child.kill();
  await new Promise((r) => (exited ? r() : child.once('exit', r)));
  assert.equal(JSON.parse(fs.readFileSync(slot, 'utf8')).holder, 'run-a', 'the other run keeps its slot');
});

test('scripts/test.js: an agent\'s focused run (a file list) never waits for the suite slot (#455)', { timeout: 60000 }, (t) => {
  const dir = tmpDir(t);
  const { locks, slot } = hold(dir);
  const file = path.join(dir, 'slotfx-alpha.test.js');
  fs.writeFileSync(file, "require('node:test')('passes', () => {});\n");
  const r = spawnSync(process.execPath, ['scripts/test.js', file], { cwd: root, encoding: 'utf8', env: agentEnv(dir, locks), timeout: 45000 });
  assert.equal(r.error?.code, undefined, 'the run ends on its own');
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(humanLog(dir), /waiting for the suite slot/);
  assert.equal(JSON.parse(fs.readFileSync(slot, 'utf8')).holder, 'run-a');
});
