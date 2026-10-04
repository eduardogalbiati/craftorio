// #257 Discovery board, what the acceptance tests leave out (the developer's own tests): a run
// started from a card (Open in Write & Review / AI Arena) is tied to it and its document comes back
// through discovery:record-result when the run finishes (window.DiscoveryRuns, views/discovery/
// discovery.js, with the hooks in views/duo/duo.js and views/arena/arena.js), also when it ended
// while nobody listened; and a card outside the fast lane that skips Shape asks first.
// Loaded through test/discovery-board-harness.js; no run starts: api.startRun is faked.
const test = require('node:test');
const assert = require('node:assert/strict');
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
  const page = await openBoard({ cards: [c], api: { runEvents: async (runId) => { if (!events[runId]) throw new Error('no such run'); return events[runId]; } } });
  startLink(page, 'run-9', { projectId: P, cardId: c.id, source: 'ai-arena' });
  startLink(page, 'run-live', { projectId: P, cardId: c.id, source: 'write-review' });
  startLink(page, 'run-gone', { projectId: P, cardId: c.id, source: 'write-review' });
  page.run("showView('discovery')");
  await settle(40);
  assert.deepEqual(page.callsTo('recordDiscoveryResult'), [[P, c.id, 'ai-arena', 'Arena answer', 'run-9']]);
  // the running run is still awaited, the deleted run's link is dropped
  assert.deepEqual(Object.keys(JSON.parse(page.sandbox.localStorage.getItem('discovery.runs'))), ['run-live']);
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
