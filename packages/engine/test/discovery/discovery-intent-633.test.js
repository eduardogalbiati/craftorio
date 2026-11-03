// #633 (spec R9, D15): Night watch and analyze-project findings enter the Inbox (Discovery's 'inbox'
// column) as intents. Acceptance tests, written before the code.
//
// The interface assumed here:
// - packages/engine/domains/discovery/discovery.js: TYPES includes 'intent'; createCard(dir, projectId,
//   { title, text, type: 'intent' }) makes a card of type 'intent' in the 'inbox' column (the default).
// - createCard's `from` (today: the id of the committed card it was learned from, kept as links.from) also
//   takes the finding a card comes from, an object { workflow: 'analyze-project', runId, finding }: no card is
//   looked up for it and the card keeps it as links.from (read back by readCard).
// - packages/engine/service/channels/nightwatch.js: a finding the watch logs for a run of a project
//   (oracle.detected with its projectId) also files an intent card in that project's Discovery inbox
//   (<workspace>/discovery, ws.discovery), whose title or document names the finding. The seam used is the
//   service's run:event, as packages/engine/test/service/self-healing-live-278.test.js drives it: under
//   Self-healing (the standing watch) a run's workflow.started (project_id) then a process.killed is a
//   memory finding of that project. The service runs with MULTIAGENT_SIMULATION_ONLY=1; no model is asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout } = require('../../domains/workspace/workspace');

const load = () => require('../../domains/discovery/discovery');
const service = () => require('../service/helpers');
const P = 'shop';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-633-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return layout(root).discovery;
}

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await settle(25);
}

// ---- the intent card ---------------------------------------------------------------------------------

test('#633 TYPES includes intent', () => {
  assert.equal(Array.from(load().TYPES || []).includes('intent'), true, `TYPES: ${JSON.stringify(load().TYPES)}`);
});

test('#633 createCard with type intent keeps the type intent', (t) => {
  const dir = tmp(t);
  const card = load().createCard(dir, P, { title: 'Checkout times out under load', text: 'Seen by the night watch.', type: 'intent' });
  assert.equal(load().readCard(dir, P, card.id).type, 'intent');
});

test('#633 an intent card lands in the inbox column', (t) => {
  const dir = tmp(t);
  const card = load().createCard(dir, P, { title: 'Checkout times out under load', type: 'intent' });
  assert.equal(load().readCard(dir, P, card.id).column, 'inbox');
  assert.deepEqual(load().listCards(dir, P, { column: 'inbox' }).map((c) => c.id), [card.id]);
});

test('#633 an intent from an analyze-project finding keeps where it came from', (t) => {
  const dir = tmp(t);
  const from = { workflow: 'analyze-project', runId: 'r-analyze-1', finding: 'f-3' };
  const card = load().createCard(dir, P, { title: 'Split the orders module', text: 'A finding of analyze-project.', type: 'intent', from });
  const kept = load().readCard(dir, P, card.id).links?.from || {};
  assert.equal(kept.workflow ?? null, 'analyze-project');
  assert.equal(kept.runId ?? null, 'r-analyze-1');
  assert.equal(kept.finding ?? null, 'f-3');
});

// ---- the Night watch's finding becomes an intent in the project's inbox -------------------------------

const started = (runId, ts) => ({ ts, type: 'workflow.started', run_id: runId, workflow: 'Feature', project_id: P, issues: [{ number: 633, title: 'Issue 633' }], mock: false });
const killed = (runId) => ({ type: 'process.killed', run_id: runId, ts: new Date().toISOString(), pid: 4242, command_line: 'node --test test/x.test.js', bytes: 9 * 1024 ** 3, limit_bytes: 8 * 1024 ** 3, step_id: 'test', session: 's1' });

test('#633 a watch finding in a run of a project files an intent naming it in that project\'s Discovery inbox', async (t) => {
  const { makeService } = service();
  const { service: svc, api } = makeService(t);
  const ws = svc.workspace();
  const dir = ws.discovery || layout(ws.root).discovery;
  const prev = api['settings:get']().oracle;
  api['settings:set']({ oracle: { ...prev, wakeScope: 'off', selfHealing: true } });
  await settle();
  svc.events.emit('run:event', started('r-633', new Date(Date.now() - 5 * 60e3).toISOString()));
  svc.events.emit('run:event', killed('r-633'));
  const intents = () => {
    try { return load().listCards(dir, P, { column: 'inbox' }).filter((c) => c.type === 'intent'); } catch { return []; }
  };
  await waitFor(() => intents().length > 0, 3000);
  // the watch did log the finding for the project (the setup, not the behaviour under test)
  const night = require('../../domains/night/night-watch');
  const logged = night.readNightLog(ws.oracle || path.join(ws.root, 'oracle')).filter((e) => e.type === 'oracle.detected' && e.runId === 'r-633').map((e) => `${e.kind} ${e.projectId}`);
  assert.deepEqual(logged, ['memory shop'], 'the watch logged the memory finding of shop');
  const texts = intents().map((c) => `${c.title} ${c.document || ''}`);
  assert.equal(texts.length, 1, `the intents in ${P}'s inbox: ${JSON.stringify(texts)}`);
  assert.match(texts[0], /memory|r-633/i);
});
