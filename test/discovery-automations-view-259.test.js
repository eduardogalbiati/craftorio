// #259 Column automations on the Discovery board (src/renderer/views/discovery/discovery.js), loaded
// through test/discovery-board-harness.js. The contract these tests assume:
//   a column whose board entry has on_enter shows data-testid="discovery-column-automation", its
//   text or an attribute naming the mode (on / off / ask); a column without on_enter has none.
//   a card with automation.state 'running' shows data-testid="discovery-card-automation" ("Running…").
//   moveDiscoveryCard's result with automation.status 'proposed' shows
//   data-testid="discovery-automation-proposal" with a button data-testid="discovery-automation-run",
//   which calls runDiscoveryAutomation (projectId, cardId, column).
// The harness's in-memory api is extended here only: the board's columns gain on_enter, the move
// answers with the automation the column's mode gives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { card, boardApi, openBoard, P } = require('./discovery-board-harness');

const ON_ENTER = {
  shape: { pipeline: 'ai-arena-write-review', mode: 'ask', inputs: { document: '{{ card.document }}' } },
  ready: { workflow: 'clarity-check.yaml', mode: 'ask', inputs: { document: '{{ card.document }}' } },
};

// the harness's store with on_enter on the columns, and a move answering with the automation
function open({ cards = [], modes = {} } = {}) {
  const { store, methods } = boardApi({ cards });
  const onEnter = (id) => (ON_ENTER[id] ? { ...ON_ENTER[id], mode: modes[id] || ON_ENTER[id].mode } : undefined);
  const api = {
    ...methods,
    discoveryBoard: async (...a) => {
      const board = await methods.discoveryBoard(...a);
      board.columns = board.columns.map((c) => (onEnter(c.id) ? { ...c, on_enter: onEnter(c.id) } : c));
      return board;
    },
    moveDiscoveryCard: async (projectId, id, column, index) => {
      const moved = await methods.moveDiscoveryCard(projectId, id, column, index);
      const mode = onEnter(column)?.mode;
      if (mode === 'ask') return { ...moved, automation: { status: 'proposed', column, estimate: { usd: 0.42, runs: 3 } } };
      if (mode === 'on') return { ...moved, automation: { status: 'running', runId: 'run-1' } };
      return moved;
    },
    runDiscoveryAutomation: async () => ({ runId: 'run-1' }),
  };
  return openBoard({ cards, api }).then((page) => Object.assign(page, { store }));
}

const modeOf = (page, el) => [page.text(el), el.getAttribute('data-mode'), el.getAttribute('title'), el.getAttribute('aria-label'), el.value].filter(Boolean).join(' ');

test('a column with on_enter shows its automation control with the mode, a column without has none', async () => {
  const page = await open({ modes: { shape: 'off' } });
  const shape = page.column('shape').querySelector('[data-testid="discovery-column-automation"]');
  assert.ok(shape, 'Shape shows its automation');
  assert.match(modeOf(page, shape), /\boff\b/i);
  const ready = page.column('ready').querySelector('[data-testid="discovery-column-automation"]');
  assert.ok(ready, 'Ready shows its automation');
  assert.match(modeOf(page, ready), /\bask\b/i);
  assert.equal(page.column('triage').querySelector('[data-testid="discovery-column-automation"]'), null);
});

test('a card whose automation is running says so on its face; a card without automation does not', async () => {
  const busy = card({ title: 'Being written', column: 'shape' });
  busy.automation = { state: 'running', runId: 'run-7' };
  const calm = card({ title: 'Quiet', column: 'shape' });
  const page = await open({ cards: [busy, calm] });
  const badge = page.cardEl(busy.id).querySelector('[data-testid="discovery-card-automation"]');
  assert.ok(badge, 'the running card shows its automation');
  assert.match(page.text(badge), /running/i);
  assert.equal(page.cardEl(calm.id).querySelector('[data-testid="discovery-card-automation"]'), null);
});

test('a move into an ask column shows the proposal, and Run starts the automation for that card and column', async () => {
  const c = card({ title: 'Export to CSV', column: 'triage' });
  const page = await open({ cards: [c] });
  await page.moveTo(c.id, 'Shape');
  const proposal = page.$('[data-testid="discovery-automation-proposal"]');
  assert.ok(proposal && page.visible(proposal), 'the proposal is shown');
  const run = proposal.querySelector('[data-testid="discovery-automation-run"]');
  assert.ok(run, 'the proposal has a Run button');
  run.click();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(page.callsTo('runDiscoveryAutomation').map((a) => [...a]), [[P, c.id, 'shape']]);
});

test('a move into an off column shows no proposal and runs nothing', async () => {
  const c = card({ title: 'Export to CSV', column: 'triage' });
  const page = await open({ cards: [c], modes: { shape: 'off' } });
  await page.moveTo(c.id, 'Shape');
  assert.equal(page.cardColumn(c.id), 'shape');
  const proposal = page.$('[data-testid="discovery-automation-proposal"]');
  assert.equal(!!proposal && page.visible(proposal), false);
  assert.equal(page.callsTo('runDiscoveryAutomation').length, 0);
});
