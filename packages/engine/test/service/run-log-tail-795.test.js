// #795: runs:logTail (api.runLogTail), the end of a deterministic step's log for the run chat's
// orchestrator message, and the simulation's E2E hook that keeps a simulated suite round running.
// Seams: the service's api by channel (helpers.js makeService) with a run folder written by hand; simulation.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./helpers');
const { e2eSuiteDelay } = require('../../engine/simulation');

const RUN_ID = '20261113-120000-abcd1234';
function runWithLog(service, text) {
  const runDir = path.join(service.workspace().runs, RUN_ID);
  fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ type: 'workflow.started', ts: new Date().toISOString(), run_id: RUN_ID, workflow: 'fixture-service', mock: true, steps: [] })}\n`);
  fs.writeFileSync(path.join(runDir, 'logs', 'suite-1.log'), text);
  return runDir;
}

test('#795 runs:logTail: the last bytes of a step log, from a whole line; a missing log is empty; outside logs/ is refused', async (t) => {
  const { service, api } = makeService(t);
  const tailOf = async (p, bytes) => api['runs:logTail']({ runId: RUN_ID, path: p, ...(bytes ? { bytes } : {}) });
  const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`).join('\n');
  runWithLog(service, `$ npm test\n${lines}\nℹ pass 42\n`);
  const tail = await tailOf('logs/suite-1.log', 1024);
  assert.ok(tail.text.endsWith('ℹ pass 42\n'));
  assert.ok(tail.text.length <= 1024);
  assert.match(tail.text, /^line \d+\n/, 'starts at a whole line');
  assert.ok(tail.size > 1024);
  const small = await tailOf('logs/suite-1.log');
  assert.ok(small.text.length <= 8192);
  assert.deepEqual(await tailOf('logs/e2e-1.log'), { text: '', size: 0 });
  await assert.rejects(async () => tailOf('../events.jsonl'));
});

test('#795 e2eSuiteDelay: only in a simulation, for the named step, with a positive delay; stopped by the signal', async () => {
  const env = { MULTIAGENT_SIMULATION_ONLY: '1', MULTIAGENT_E2E_SUITE_DELAY_MS: '20', MULTIAGENT_E2E_SUITE_DELAY_STEP: 'suite' };
  assert.equal(e2eSuiteDelay('e2e', null, env), null);
  assert.equal(e2eSuiteDelay(null, null, env), null);
  assert.equal(e2eSuiteDelay('suite', null, { ...env, MULTIAGENT_SIMULATION_ONLY: '' }), null);
  assert.equal(e2eSuiteDelay('suite', null, { ...env, MULTIAGENT_E2E_SUITE_DELAY_MS: '0' }), null);
  const t0 = Date.now();
  await e2eSuiteDelay('suite', null, env);
  assert.ok(Date.now() - t0 >= 15);
  const ac = new AbortController();
  const long = e2eSuiteDelay('suite', ac.signal, { ...env, MULTIAGENT_E2E_SUITE_DELAY_MS: '60000' });
  ac.abort();
  await long;
});
