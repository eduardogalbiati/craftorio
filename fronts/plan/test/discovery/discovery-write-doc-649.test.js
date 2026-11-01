// #649 (write-doc phase 3, R1): a Discovery card offers "Write a document" (fronts/plan/views/discovery/
// discovery.js, the card's detail panel). The click starts the writer like the Documents screen does,
// api.startRun({ file: 'write-doc.yaml', inputs: { project_path, item, document, title, base_branch }, mock,
// projectId }), with the card's title; the run is the card's, so its outputs.document comes back through
// api.recordDiscoveryResult(projectId, cardId, 'write-doc', text, runId) when it ends.
// Loaded through test/discovery-board-harness.js; api.startRun is faked (the IPC boundary).
const test = require('node:test');
const assert = require('node:assert/strict');
const { card, openBoard, settle, P } = require('../discovery-board-harness');

const finished = (page, ev) => { for (const fn of page.handlers.onEvent || []) fn({ type: 'workflow.finished', ...ev }); };

function writeDocButton(page, detail) {
  const btn = detail.querySelector('[data-testid="card-write-doc"]');
  if (!btn) throw new Error('the card panel has no [data-testid="card-write-doc"]');
  return btn;
}

test('an opened card offers "Write a document"', async () => {
  const c = card({ title: 'Export runs', type: 'prd', column: 'shape', document: 'As CSV.' });
  const page = await openBoard({ cards: [c] });
  const detail = await page.openCard(c.id);
  const btn = detail.querySelector('[data-testid="card-write-doc"]');
  assert.ok(btn, 'a [data-testid="card-write-doc"] action in the card panel');
  assert.equal(page.text(btn), 'Write a document');
});

test('"Write a document" starts write-doc.yaml with the card\'s title', async () => {
  const c = card({ title: 'Export runs', type: 'prd', column: 'shape', document: 'As CSV.' });
  const page = await openBoard({ cards: [c], api: { startRun: async () => ({ runId: 'run-wd' }) } });
  const detail = await page.openCard(c.id);
  writeDocButton(page, detail).click();
  await settle(40);
  const starts = page.callsTo('startRun');
  assert.equal(starts.length, 1, 'one run started');
  const [req] = starts[0];
  assert.equal(req.file, 'write-doc.yaml');
  assert.equal(req.inputs?.title, 'Export runs');
});

test('the write-doc run started from the card records its document on the card as write-doc when it ends', async () => {
  const c = card({ title: 'Export runs', type: 'prd', column: 'shape', document: 'As CSV.' });
  const page = await openBoard({ cards: [c], api: { startRun: async () => ({ runId: 'run-wd' }) } });
  const detail = await page.openCard(c.id);
  writeDocButton(page, detail).click();
  await settle(40);
  finished(page, { run_id: 'run-wd', status: 'success', outputs: { document: '# Export runs\n\nThe document.' } });
  await settle(40);
  assert.deepEqual(page.callsTo('recordDiscoveryResult'), [[P, c.id, 'write-doc', '# Export runs\n\nThe document.', 'run-wd']]);
});
