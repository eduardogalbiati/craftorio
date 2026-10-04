// #244 review round: under the Night watch a failed or interrupted run still wakes the model (it may
// repair it); refused wake-ups fold into one digest across the code-only notices between them.
// Seams: createWake (src/oracle-wake.js) with a stub onWake; createOracle's wake / history, simulated.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const oracle = require('../src/oracle');
const { createWake } = require('../src/oracle-wake');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-night-244-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function batchOf(t, ev, nightOn) {
  const dir = tmpDir(t);
  const events = new EventEmitter();
  let got = null;
  const wake = createWake({ events, settings: () => ({}), file: () => path.join(dir, 'wake.json'), nightWatch: () => nightOn, onWake: (b) => { got = b; return {}; }, batchMs: 60e3 });
  t.after(() => wake.stop());
  events.emit('run:event', { ts: '2026-10-03T10:00:00Z', ...ev });
  await wake.flush();
  return got;
}

const FAILED = { type: 'workflow.finished', run_id: 'r-fail', status: 'failed', error: 'tests failed' };
const INTERRUPTED = { type: 'run.interrupted', run_id: 'r-int' };

for (const [label, ev] of [['a failed run', FAILED], ['an interrupted run', INTERRUPTED]]) {
  test(`#244 wake: under the Night watch, ${label} wakes the model instead of a notice`, async (t) => {
    const b = await batchOf(t, ev, true);
    assert.equal(b.lines.length, 1);
    assert.equal(b.notices.length, 0);
  });

  test(`#244 wake: without the Night watch, ${label} is a code-only notice`, async (t) => {
    const b = await batchOf(t, ev, false);
    assert.equal(b.lines.length, 0);
    assert.equal(b.notices.length, 1);
  });
}

test('#244 wake: under the Night watch, a succeeded run stays a code-only notice', async (t) => {
  const b = await batchOf(t, { type: 'workflow.finished', run_id: 'r-ok', status: 'succeeded' }, true);
  assert.equal(b.lines.length, 0);
  assert.equal(b.notices.length, 1);
});

test('#244 refusals: refused wake-ups fold into one digest across the notices posted between them', async (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), provider: 'claude', costUsd: 5 })}\n`);
  const o = oracle.createOracle({
    dir: () => dir,
    tools: () => [],
    bridge: { start: async () => { throw new Error('not needed'); } },
    mcpCommand: () => { throw new Error('not needed'); },
    skillsDirs: () => [],
    resolveCommand: () => { throw new Error('not needed'); },
    refuseReal: () => { throw new Error('Simulation only: no real model in tests.'); },
    agent: () => ({ model: 'claude-opus-5-5', effort: 'high' }),
    settings: () => ({ oracle: { dailyBudgetUsd: 1 } }),
  });
  t.after(() => o.release());
  for (const id of ['r-1', 'r-2', 'r-3']) {
    const res = await o.wake({
      lines: [`10:00:00 ${id}: gate review waits for the owner`], runIds: [id], kinds: ['gate'], mock: true,
      notices: [{ runId: `${id}-done`, status: 'succeeded', text: `Run ${id}-done finished succeeded.` }],
    });
    assert.ok(res.refused);
  }
  const msgs = o.history();
  const digests = msgs.filter((m) => m.kind === 'wake-refused');
  assert.equal(digests.length, 1, JSON.stringify(msgs.map((m) => m.text)));
  assert.equal(digests[0].count, 3);
  assert.equal(msgs.filter((m) => m.kind === 'notice').length, 3);
});
