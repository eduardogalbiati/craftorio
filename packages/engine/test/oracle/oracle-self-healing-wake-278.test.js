// #278 Self-healing: the Oracle woken with findings (createOracle's wake({ findings }), packages/engine/domains/oracle/oracle.js):
// the findings are the wake-up's events, answered in one turn (simulated here); a budget that pauses
// the Oracle refuses the wake-up and keeps the findings in its digest. No real model is asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const oracle = require('../../domains/oracle/oracle');

function makeOracle(t, { spentUsd = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-findings-278-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (spentUsd) fs.writeFileSync(path.join(dir, 'usage.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), provider: 'claude', costUsd: spentUsd })}\n`);
  const o = oracle.createOracle({
    dir: () => dir,
    tools: () => [],
    bridge: { start: async () => { throw new Error('not needed'); } },
    mcpCommand: () => { throw new Error('not needed'); },
    skillsDirs: () => [],
    resolveCommand: () => { throw new Error('not needed'); },
    refuseReal: () => { throw new Error('Simulation only: no real model in tests.'); },
    agent: () => ({ model: 'claude-opus-5-5', effort: 'high' }),
    settings: () => ({ oracle: { dailyBudgetUsd: 1, selfHealing: true } }),
  });
  t.after(() => o.release());
  return o;
}

const FINDING = 'Self-healing finding (cost-gap: a turn recorded below its cost) in run r-277 of project orchestrator, step implement, since 2026-10-04T10:03:00.000Z. Evidence: {"turn":1,"costUsd":0}';

test('#278 wake: findings alone wake the Oracle for one turn whose events are the findings', async (t) => {
  const o = makeOracle(t);
  const out = await o.wake({ findings: [FINDING], runIds: ['r-277'], mock: true });
  assert.equal(!!out.refused, false, JSON.stringify(out.refused));
  const woken = o.history().filter((m) => m.kind === 'wake');
  assert.equal(woken.length, 1);
  assert.deepEqual(Array.from(woken[0].events), [FINDING]);
});

test('#278 wake: under a paused budget the findings are refused and kept in the refused wake-ups\' digest', async (t) => {
  const o = makeOracle(t, { spentUsd: 5 });
  const out = await o.wake({ findings: [FINDING], runIds: ['r-277'], mock: true });
  assert.ok(out.refused, 'not refused');
  const refused = o.history().filter((m) => m.kind === 'wake-refused');
  assert.equal(refused.length, 1);
  assert.ok(Array.from(refused[0].events).includes(FINDING), 'the finding is in the digest');
  assert.equal(o.history().some((m) => m.kind === 'wake'), false);
});

test('#278 wake: no findings and no lines is skipped (nothing to answer)', async (t) => {
  const o = makeOracle(t);
  const out = await o.wake({ findings: [], mock: true });
  assert.equal(out.skipped, 'no-events');
});
