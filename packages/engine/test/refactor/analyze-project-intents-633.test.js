// #633 (spec R9): the analyze-project workflow's propose step (packages/engine/domains/refactor/
// refactor-proposals-run.js proposeFindings) files each new proposal as an `intent` card in the
// project's Discovery inbox, linked to the run and the finding; a finding already proposed files none.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const discovery = require('../../domains/discovery/discovery');
const { layout } = require('../../domains/workspace/workspace');
const { proposeFindings } = require('../../domains/refactor/refactor-proposals-run');

const PROJECT = 'proj-633';

function workspace(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-intents-633-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true, maxRetries: 5 }));
  const stores = layout(ws);
  for (const dir of [stores.refactor, stores.architecture, stores.backlog]) fs.mkdirSync(dir, { recursive: true });
  return { ws, stores };
}

const finding = (title, paths) => ({
  kind: 'oversized-unit', title, files: paths.map((p) => ({ path: p })), evidence: `${title}: evidence`, severity: 'high', refactor: `Split ${paths[0]}`,
});
const report = (findings) => ({ summary: 'Hot spots.', areas: [{ area: 'src', verdict: 'Too coupled' }], findings });

test('#633 analyze-project: each new proposal comes back as an intent in the Discovery inbox, once', (t) => {
  const { ws, stores } = workspace(t);
  const out = proposeFindings({ wsRoot: ws, projectId: PROJECT, report: report([finding('Split engine', ['src/engine.js'])]), simulated: true, runId: 'run-1' });
  assert.equal(out.added.length, 1);
  assert.equal(out.intents.length, 1);
  const cards = discovery.listCards(stores.discovery, PROJECT, { column: 'inbox' });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].type, 'intent');
  assert.match(cards[0].title, /Split engine/);
  assert.deepEqual(cards[0].links.from, { workflow: 'analyze-project', runId: 'run-1', finding: out.added[0].id });

  const again = proposeFindings({ wsRoot: ws, projectId: PROJECT, report: report([finding('Split engine', ['src/engine.js'])]), simulated: true, runId: 'run-2' });
  assert.equal(again.added.length, 0);
  assert.deepEqual(again.intents, []);
  assert.equal(discovery.listCards(stores.discovery, PROJECT, { column: 'inbox' }).length, 1);
});
