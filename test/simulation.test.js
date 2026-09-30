const test = require('node:test');
const assert = require('node:assert/strict');
const { runTurn } = require('../src/engine/providers');

// Sets MULTIAGENT_SIMULATION_ONLY for one test and restores it after.
function simulationOnly(t, value) {
  const before = process.env.MULTIAGENT_SIMULATION_ONLY;
  if (value === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY;
  else process.env.MULTIAGENT_SIMULATION_ONLY = value;
  t.after(() => {
    if (before === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY;
    else process.env.MULTIAGENT_SIMULATION_ONLY = before;
  });
}

for (const type of ['claude-code', 'codex-cli', 'grok-cli']) {
  test(`with simulation only, a ${type} turn is refused before any CLI starts`, async (t) => {
    simulationOnly(t, '1');
    const items = [];
    // a command that would fail differently if it were started
    await assert.rejects(
      runTurn({ provider: { type, command: 'definitely-not-installed-cli' }, model: 'm', prompt: 'hi', cwd: process.cwd(), onItem: (i) => items.push(i) }),
      new RegExp(`Simulation only \\(MULTIAGENT_SIMULATION_ONLY=1\\): refusing to start the ${type} provider`),
    );
    assert.deepEqual(items, []);
  });
}

test('with simulation only, mock turns still run', async (t) => {
  simulationOnly(t, 'true');
  process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0';
  const r = await runTurn({ provider: { type: 'mock' }, model: 'simulated', prompt: 'hi', hint: {}, onItem: () => {} });
  assert.equal(typeof r.text, 'string');
});

test('without the variable (or with 0) a real provider is not refused by the guard', async (t) => {
  for (const value of [undefined, '0', '']) {
    simulationOnly(t, value);
    await assert.rejects(
      runTurn({ provider: { type: 'claude-code', command: 'definitely-not-installed-cli' }, model: 'm', prompt: 'hi', cwd: process.cwd(), onItem: () => {} }),
      (e) => !/Simulation only/.test(e.message),
    );
  }
});
