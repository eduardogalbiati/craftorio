// #528 (and #529-#540, #495): an agent's whole `npm test` (scripts/test.js, #455) takes the
// machine-wide `suite` slot; the test files it runs must inherit it (SUITE_SLOT_ENV, as the suite
// step's child does), or a test that takes the slot itself (the base check's runBaseCheck, #527)
// waits for its own runner until it times out. Acceptance test written before the fix.
//
// Seam: scripts/test.js run as a whole suite (no file list) in agent mode, on a copy of the runner
// in a temp root whose test/ folder holds one probe file: the probe takes the suite slot (a short
// wait) and writes whether it got it. The copy's full flow (scripts/run.js) is absent and fails:
// only the probe's result is checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SUITE_SLOT_ENV } = require('../engine/machine-slot');

const root = path.join(__dirname, '..', '..', '..');
const RUNNER = [
  'scripts/test.js', 'scripts/test-exit.js', 'scripts/test-reporter-agent.js', 'scripts/test-reporter-slowest.js',
  'scripts/source-tree.js', 'package.json', // the workspaces' test folders (phase 2 of the reorganisation study)
  'packages/engine/engine/agent-test-report.js', 'packages/engine/engine/machine-slot.js', 'packages/engine/engine/test-timeouts.js', 'packages/engine/engine/affected-tests.js',
  // #553: the name of the list file's variable (TEST_FILES_ENV)
  'packages/engine/engine/suite-command-line.js',
];

const PROBE = `const test = require('node:test');
const fs = require('fs');
const slot = require('@multiagent/engine/engine/machine-slot');
test('takes the suite slot', async () => {
  const out = { inheritEnv: process.env[slot.SUITE_SLOT_ENV] || null };
  try {
    const held = await slot.acquireSlot(slot.SUITE_SLOT, { waitMs: 3000, pollMs: 100, holder: 'probe' });
    out.got = true;
    out.inherited = !!held.inherited;
    held.release();
  } catch (e) {
    out.got = false;
    out.error = e.message;
  }
  fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify(out));
});
`;

function copyRunner(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-slot-528-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  for (const f of RUNNER) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(root, f), path.join(dir, f));
  }
  // the runner requires the engine package by name: link it as npm's workspace install does
  fs.mkdirSync(path.join(dir, 'node_modules', '@multiagent'), { recursive: true });
  fs.symlinkSync(path.join(dir, 'packages', 'engine'), path.join(dir, 'node_modules', '@multiagent', 'engine'), 'junction');
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'test', 'probe.test.js'), PROBE);
  fs.mkdirSync(path.join(dir, 'locks'), { recursive: true });
  return dir;
}

test('#528 an agent\'s whole npm test lends its suite slot to the test files it runs: a test taking the slot gets it at once', { timeout: 120000 }, (t) => {
  const dir = copyRunner(t);
  const out = path.join(dir, 'probe.json');
  const locks = path.join(dir, 'locks');
  const env = {
    ...process.env,
    MULTIAGENT_AGENT_MODE: '1', MULTIAGENT_TEST_CONCURRENCY: '1', MULTIAGENT_TEST_TIMEOUT_MS: '30000',
    MULTIAGENT_TEST_HUMAN_LOG: path.join(dir, 'human.log'), MULTIAGENT_LOCKS_DIR: locks, PROBE_OUT: out,
  };
  delete env.NODE_TEST_CONTEXT;
  delete env[SUITE_SLOT_ENV]; // this test may itself run inside a suite step or a base check
  const r = spawnSync(process.execPath, ['scripts/test.js'], { cwd: dir, encoding: 'utf8', env, timeout: 100000 });
  assert.equal(r.error?.code, undefined, 'the runner ends on its own');
  assert.equal(fs.existsSync(out), true, `the probe ran; human log: ${(() => { try { return fs.readFileSync(path.join(dir, 'human.log'), 'utf8').slice(0, 800); } catch { return ''; } })()}`);
  const probe = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(typeof probe.inheritEnv, 'string', 'the test process carries the runner\'s suite slot token');
  assert.equal(probe.got, true, `the probe got the slot without waiting for its own runner: ${probe.error || ''}`);
  assert.equal(probe.inherited, true, 'it got the runner\'s slot (inherited), not a second one');
  assert.equal(fs.existsSync(path.join(locks, 'suite.slot')), false, 'the runner frees the slot when it ends');
});
