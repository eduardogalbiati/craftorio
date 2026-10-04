// #257 Discovery board, what the acceptance tests leave out (the developer's own tests): a run
// started from a card (Open in Write & Review / AI Arena) is tied to it and its document comes back
// through discovery:record-result when the run finishes (window.DiscoveryRuns, views/discovery/
// discovery.js, with the hooks in views/duo/duo.js and views/arena/arena.js), also when it ended
// while nobody listened; a card outside the fast lane that skips Shape asks first; an edit with
// changes is never dropped (another card, another project); and, in the store (src/discovery.js),
// a card's threadCount, snapshots that never replace each other and what recordResult refuses.
// Loaded through test/discovery-board-harness.js; no run starts: api.startRun is faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const discovery = require('../src/discovery');
const { layout } = require('../src/workspace');
const { card, openBoard, settle, P } = require('./discovery-board-harness');

const finished = (page, ev) => { for (const fn of page.handlers.onEvent || []) fn({ type: 'workflow.finished', ...ev }); };
const startLink = (page, runId, link) => page.sandbox.DiscoveryRuns.started(runId, link);

test('a run started for a card records its document on the card when it finishes, once', async () => {
  const c = card({ title: 'Export', column: 'shape', document: 'draft' });
  const page = await openBoard({ cards: [c] });
  startLink(page, 'run-1', { projectId: P, cardId: c.id, source: 'write-review' });
  finished(page, { run_id: 'run-1', status: 'success', outputs: { document: '# Reviewed' } });
  await settle(20);
  assert.deepEqual(page.callsTo('recordDiscoveryResult'), [[P, c.id, 'write-review', '# Reviewed', 'run-1']]);
  finished(page, { run_id: 'run-1', status: 'success', outputs: { document: '# Reviewed' } });
  await settle(20);
  assert.equal(page.callsTo('recordDiscoveryResult').length, 1, 'the same run is not recorded twice');
});

test('a run that failed, was cancelled or wrote nothing records nothing, and another run\'s end is ignored', async () => {
  const c = card({ title: 'Export', column: 'shape', document: 'draft' });
  const page = await openBoard({ cards: [c] });
  startLink(page, 'run-1', { projectId: P, cardId: c.id, source: 'ai-arena' });
  startLink(page, 'run-2', { projectId: P, cardId: c.id, source: 'ai-arena' });
  finished(page, { run_id: 'someone-else', status: 'success', outputs: { document: 'x' } });
  finished(page, { run_id: 'run-1', status: 'failed', outputs: { document: 'half' } });
  finished(page, { run_id: 'run-2', status: 'success', outputs: {} });
  await settle(20);
  assert.equal(page.callsTo('recordDiscoveryResult').length, 0);
});

test('a failed or cancelled run drops its link to the card; a run still going keeps it', async () => {
  const c = card({ title: 'Export', column: 'shape', document: 'draft' });
  const page = await openBoard({ cards: [c] });
  startLink(page, 'run-f', { projectId: P, cardId: c.id, source: 'write-review' });
  startLink(page, 'run-c', { projectId: P, cardId: c.id, source: 'ai-arena' });
  startLink(page, 'run-on', { projectId: P, cardId: c.id, source: 'write-review' });
  finished(page, { run_id: 'run-f', status: 'failed', outputs: {} });
  finished(page, { run_id: 'run-c', status: 'cancelled', outputs: {} });
  await settle(40);
  assert.deepEqual(Object.keys(JSON.parse(page.sandbox.localStorage.getItem('discovery.runs') || '{}')), ['run-on']);
  assert.equal(page.callsTo('recordDiscoveryResult').length, 0);
});

test('the result shows in the open card: the new document, without closing the panel', async () => {
  const c = card({ title: 'Export', column: 'shape', document: 'draft' });
  const page = await openBoard({ cards: [c] });
  const detail = await page.openCard(c.id);
  startLink(page, 'run-1', { projectId: P, cardId: c.id, source: 'write-review' });
  finished(page, { run_id: 'run-1', status: 'success', outputs: { document: 'The reviewed text' } });
  await settle(40);
  assert.ok(page.$('[data-testid="discovery-card-detail"]'), 'the panel stays open');
  assert.equal(page.$('[data-testid="card-document-editor"]').value, 'The reviewed text');
  assert.ok(detail, 'the card was open');
});

test('a run that ended while nobody listened is caught up when the board opens', async () => {
  const c = card({ title: 'Export', column: 'shape', document: 'draft' });
  const events = { 'run-9': [{ type: 'workflow.started' }, { type: 'workflow.finished', run_id: 'run-9', status: 'success', outputs: { document: 'Arena answer' } }], 'run-live': [{ type: 'workflow.started' }] };
  const runEvents = async (runId) => {
    if (runId === 'run-unread') throw new Error('The service did not answer');
    if (!events[runId]) throw new Error(`Run not found: ${runId}`); // the service's answer for a deleted run
    return events[runId];
  };
  const page = await openBoard({ cards: [c], api: { runEvents } });
  startLink(page, 'run-9', { projectId: P, cardId: c.id, source: 'ai-arena' });
  startLink(page, 'run-live', { projectId: P, cardId: c.id, source: 'write-review' });
  startLink(page, 'run-gone', { projectId: P, cardId: c.id, source: 'write-review' });
  startLink(page, 'run-unread', { projectId: P, cardId: c.id, source: 'write-review' });
  page.run("showView('discovery')");
  await settle(40);
  assert.deepEqual(page.callsTo('recordDiscoveryResult'), [[P, c.id, 'ai-arena', 'Arena answer', 'run-9']]);
  // the running run is still awaited and so is the one that could not be read; the deleted run's link is dropped
  assert.deepEqual(Object.keys(JSON.parse(page.sandbox.localStorage.getItem('discovery.runs'))), ['run-live', 'run-unread']);
});

test('Open in Write & Review fills the setup with the card\'s document; the run started there is the card\'s', async () => {
  const c = card({ title: 'Export runs', type: 'prd', column: 'shape', document: 'As CSV, per night.', acceptance: '- a file is written' });
  const page = await openBoard({ cards: [c], api: { startRun: async () => ({ runId: 'run-wr' }) } });
  const detail = await page.openCard(c.id);
  detail.querySelector('[data-testid="card-open-write-review"]').click();
  await settle(20);
  assert.equal(page.run('state.view'), 'duo');
  const prompt = page.$('#duo-prompt').value;
  assert.match(prompt, /Export runs/);
  assert.match(prompt, /As CSV, per night\./);
  assert.match(prompt, /a file is written/);
  assert.ok(page.$('#duo-goal').value, 'a goal is prefilled');
  assert.equal(page.$('#duo-skill').value, 'prd-writing', 'a PRD card asks for a PRD');
  assert.match(page.$('#duo-issue').textContent, /Export runs/, 'the banner names the card');
  page.$('#duo-mock').checked = false;
  page.$('#duo-run').click();
  await settle(40);
  assert.equal(page.callsTo('startRun').length, 1);
  finished(page, { run_id: 'run-wr', status: 'success', outputs: { document: '# PRD' } });
  await settle(20);
  assert.deepEqual(page.callsTo('recordDiscoveryResult'), [[P, c.id, 'write-review', '# PRD', 'run-wr']]);
});

test('"not about this card" unties Write & Review from the card: its run records nothing', async () => {
  const c = card({ title: 'Export runs', column: 'shape', document: 'As CSV.' });
  const page = await openBoard({ cards: [c], api: { startRun: async () => ({ runId: 'run-free' }) } });
  const detail = await page.openCard(c.id);
  detail.querySelector('[data-testid="card-open-write-review"]').click();
  await settle(20);
  page.$('#duo-card-clear').click();
  page.$('#duo-mock').checked = false;
  page.$('#duo-run').click();
  await settle(40);
  finished(page, { run_id: 'run-free', status: 'success', outputs: { document: '# Doc' } });
  await settle(20);
  assert.equal(page.callsTo('recordDiscoveryResult').length, 0);
});

test('Open in AI Arena fills the request with the card\'s document; the run started there is the card\'s', async () => {
  const c = card({ title: 'Plugin API', type: 'rfc', column: 'shape', document: 'Steps from plugins.' });
  const page = await openBoard({ cards: [c], api: { startRun: async () => ({ runId: 'run-ar' }) } });
  const detail = await page.openCard(c.id);
  detail.querySelector('[data-testid="card-open-arena"]').click();
  await settle(20);
  assert.equal(page.run('state.view'), 'arena');
  assert.match(page.$('#arena-task').value, /Steps from plugins\./);
  assert.match(page.$('#arena-card').textContent, /Plugin API/, 'the banner names the card');
  page.$('#arena-mock').checked = false;
  page.$('#arena-run').click();
  await settle(40);
  assert.equal(page.callsTo('startRun').length, 1);
  finished(page, { run_id: 'run-ar', status: 'success', outputs: { document: '# RFC' } });
  await settle(20);
  assert.deepEqual(page.callsTo('recordDiscoveryResult'), [[P, c.id, 'ai-arena', '# RFC', 'run-ar']]);
});

test('an idea moved from Triage straight to Define asks first (it skips Shape); on no it stays', async () => {
  const c = card({ title: 'Too fast', type: 'idea', column: 'triage' });
  const page = await openBoard({ cards: [c] });
  await page.moveTo(c.id, 'Define');
  assert.equal(page.confirmOpen(), true, 'the confirm dialog is open');
  assert.match(page.text(page.$('#confirm-message')), /skips Shape/);
  page.$('#btn-confirm-no').click();
  await settle(20);
  assert.equal(page.callsTo('moveDiscoveryCard').length, 0);
  assert.equal(page.cardColumn(c.id), 'triage');
});

test('a card\'s document with unsaved changes is not dropped: Esc and another card are held back', async () => {
  const a = card({ title: 'First', column: 'shape', document: 'saved' });
  const b = card({ title: 'Second', column: 'shape', document: 'other' });
  const page = await openBoard({ cards: [a, b] });
  await page.openCard(a.id);
  page.$('[data-testid="card-document-editor"]').value = 'being written';
  page.cardEl(b.id).querySelector('[data-testid="discovery-card-title"]').click();
  await settle(20);
  assert.equal(page.$('[data-testid="card-document-editor"]').value, 'being written', 'the first card stays open with its text');
  assert.match(page.text(page.$('#dsc-detail-error')), /Save or cancel/);
});

test('a result that could not be recorded keeps its link for the next visit; a card that is gone drops it', async () => {
  const c = card({ title: 'Export', column: 'shape', document: 'draft' });
  const links = (page) => Object.keys(JSON.parse(page.sandbox.localStorage.getItem('discovery.runs') || '{}'));
  const failing = await openBoard({ cards: [c], api: { recordDiscoveryResult: async () => { throw new Error('The disk is full'); } } });
  startLink(failing, 'run-1', { projectId: P, cardId: c.id, source: 'write-review' });
  finished(failing, { run_id: 'run-1', status: 'success', outputs: { document: '# Doc' } });
  await settle(40);
  assert.deepEqual(links(failing), ['run-1'], 'the link stays: the result is tried again');
  assert.match(failing.text(failing.$('#dsc-error')), /run-1.*The disk is full/);

  const gone = await openBoard({ cards: [c], api: { recordDiscoveryResult: async () => { throw new Error(`Card not found: ${c.id}`); } } });
  startLink(gone, 'run-2', { projectId: P, cardId: c.id, source: 'write-review' });
  finished(gone, { run_id: 'run-2', status: 'success', outputs: { document: '# Doc' } });
  await settle(40);
  assert.deepEqual(links(gone), [], 'nothing to come back to');
});

test('another project chosen in the header: a card with unsaved changes stays open and is saved to its own project', async () => {
  const c = card({ title: 'Export', column: 'shape', document: 'saved' });
  const page = await openBoard({ cards: [c] });
  await page.openCard(c.id);
  page.$('[data-testid="card-document-editor"]').value = 'being written';
  page.sandbox.CurrentProject.get = () => 'p2';
  page.run("showView('discovery')");
  await settle(40);
  assert.ok(page.$('[data-testid="discovery-card-detail"]'), 'the panel stays open');
  assert.match(page.text(page.$('#dsc-detail-error')), /save or cancel/i);
  page.$('[data-detail="save-doc"]').click();
  await settle(40);
  const saves = page.callsTo('updateDiscoveryCard');
  assert.equal(saves.length, 1);
  assert.deepEqual([saves[0][0], saves[0][1], saves[0][2].document], [P, c.id, 'being written']);
});

test('another project chosen in the header closes a card without unsaved changes', async () => {
  const c = card({ title: 'Export', column: 'shape', document: 'saved' });
  const page = await openBoard({ cards: [c] });
  await page.openCard(c.id);
  page.sandbox.CurrentProject.get = () => 'p2';
  page.run("showView('discovery')");
  await settle(40);
  assert.equal(page.$('[data-testid="discovery-card-detail"]'), null);
});

// ---- the store (src/discovery.js) -----------------------------------------------------------------

function tmpStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-board-own-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return layout(root).discovery;
}

test('store: a card carries the number of its thread entries, and card.json does not', (t) => {
  const dir = tmpStore(t);
  const c = discovery.createCard(dir, P, { title: 'A' });
  assert.equal(c.threadCount, 0);
  discovery.appendConversation(dir, P, c.id, { kind: 'note', text: 'one' });
  discovery.appendConversation(dir, P, c.id, { kind: 'note', text: 'two' });
  assert.equal(discovery.readCard(dir, P, c.id).threadCount, 2);
  assert.equal(discovery.listCards(dir, P)[0].threadCount, 2);
  discovery.updateCard(dir, P, c.id, { title: 'B' });
  assert.equal('threadCount' in JSON.parse(fs.readFileSync(path.join(dir, P, 'cards', c.id, 'card.json'), 'utf8')), false);
});

test('store: two snapshots for the same reason in the same millisecond are both kept', (t) => {
  const dir = tmpStore(t);
  const c = discovery.createCard(dir, P, { title: 'A', text: 'first' });
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T12:00:00.000Z') });
  const one = discovery.snapshotVersion(dir, P, c.id, 'before-restore');
  discovery.updateCard(dir, P, c.id, { document: 'second' });
  const two = discovery.snapshotVersion(dir, P, c.id, 'before-restore');
  assert.notEqual(one, two);
  assert.deepEqual(discovery.listVersions(dir, P, c.id).map((v) => discovery.readVersion(dir, P, c.id, v.name)).sort(), ['first', 'second']);
});

test('store: recordResult refuses an unknown source and an empty text, and changes nothing', (t) => {
  const dir = tmpStore(t);
  const c = discovery.createCard(dir, P, { title: 'A', text: 'draft' });
  assert.throws(() => discovery.recordResult(dir, P, c.id, { source: 'somewhere', text: 'x' }), /Unknown result source/);
  assert.throws(() => discovery.recordResult(dir, P, c.id, { source: 'write-review', text: '  ' }), /needs a text/);
  assert.equal(discovery.readCard(dir, P, c.id).document, 'draft');
  assert.deepEqual(discovery.listVersions(dir, P, c.id), []);
});
