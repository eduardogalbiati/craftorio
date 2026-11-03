// #257 Plan & Design › Discovery board, the screen (fronts/plan/views/discovery/discovery.js,
// registered with registerView, id 'discovery'). Loaded through test/discovery-board-harness.js:
// the whole page in a vm with test/mini-dom.js, window.api faked at its boundary only.
//
// The contract these tests assume. window.api methods the screen calls (channel → method (params)):
//   discovery:board           → discoveryBoard (projectId) → { columns: [{ id, title, wip }], order: { column: [ids] } }
//   discovery:list            → listDiscoveryCards (projectId, column)
//   discovery:get             → getDiscoveryCard (projectId, cardId)
//   discovery:conversation    → discoveryConversation (projectId, cardId)
//   discovery:move            → moveDiscoveryCard (projectId, cardId, column, index)
//   discovery:set-wip         → setDiscoveryWip (projectId, column, limit)
//   discovery:versions        → discoveryVersions (projectId, cardId) → [{ name, ts, reason }] newest first
//   discovery:version         → discoveryVersion (projectId, cardId, name) → text
//   discovery:restore-version → restoreDiscoveryVersion (projectId, cardId, name)
//   discovery:record-result   → recordDiscoveryResult (projectId, cardId, source, text, runId)
// data-testids: discovery-board; discovery-column[data-column] (triage, shape, define, ready; no inbox)
// with discovery-column-title, discovery-column-count (`n / limit` on a WIP column) and
// data-over-wip="true" past its limit; discovery-card[data-card][data-type] with discovery-card-title,
// -type, -age, -clarity / -estimate (only when known), -attachments, -thread; discovery-fast-lane;
// card-move ("Move to…" → role="menuitem" items named by column title); discovery-wip-edit[data-column];
// discovery-filter-type / -tag / -author, discovery-search; discovery-card-detail with
// card-document-editor, card-document-preview, card-acceptance, card-attachments, card-thread,
// card-versions > card-version (card-version-open, card-version-restore), card-write-doc
// (#648: no more card-open-write-review / card-open-arena). A move past a WIP limit asks app.js's confirmDialog (#confirm-modal,
// #btn-confirm-yes / #btn-confirm-no).
const test = require('node:test');
const assert = require('node:assert/strict');
const { card, openBoard, settle, P } = require('./discovery-board-harness');

const fullShape = () => Array.from({ length: 5 }, (_, i) => card({ title: `Shaping ${i}`, column: 'shape' }));

test('the board shows the columns Triage, Shape, Define, Ready in order with their titles, no Inbox', async () => {
  const page = await openBoard({ cards: [card({ title: 'An idea', column: 'triage' })] });
  assert.deepEqual(page.columns().map((el) => el.getAttribute('data-column')), ['triage', 'shape', 'define', 'ready']);
  assert.deepEqual(page.columns().map((el) => page.text(el.querySelector('[data-testid="discovery-column-title"]'))), ['Triage', 'Shape', 'Define', 'Ready']);
  assert.ok(page.callsTo('discoveryBoard').some((args) => args[0] === P), 'the board is read for the header\'s project');
});

test('the cards are placed in their column, in the board\'s order', async () => {
  const a = card({ title: 'First in shape', column: 'shape' });
  const b = card({ title: 'Second in shape', column: 'shape' });
  const c = card({ title: 'In define', column: 'define' });
  const page = await openBoard({ cards: [a, b, c] });
  assert.equal(page.cardColumn(a.id), 'shape');
  assert.equal(page.cardColumn(c.id), 'define');
  const inShape = page.column('shape').querySelectorAll('[data-testid="discovery-card"]').map((el) => el.getAttribute('data-card'));
  assert.deepEqual(inShape, [a.id, b.id]);
});

test('a card face shows its title, its type chip, its age and its attachment and thread counts', async () => {
  const c = card({ title: 'Export to CSV', type: 'prd', column: 'shape', attachments: ['a.png', 'b.pdf'] });
  const page = await openBoard({ cards: [c], threads: { [c.id]: [{ ts: '2026-10-02T10:00:00.000Z', kind: 'note', text: 'hi' }] } });
  const el = page.cardEl(c.id);
  assert.ok(el, 'the card is on the board');
  assert.equal(el.getAttribute('data-type'), 'prd');
  assert.equal(page.text(el.querySelector('[data-testid="discovery-card-title"]')), 'Export to CSV');
  assert.equal(page.text(el.querySelector('[data-testid="discovery-card-type"]')), 'prd');
  assert.ok(page.text(el.querySelector('[data-testid="discovery-card-age"]')), 'the age in its column is shown');
  assert.match(page.text(el.querySelector('[data-testid="discovery-card-attachments"]')), /\b2\b/);
  assert.ok(el.querySelector('[data-testid="discovery-card-thread"]'), 'the thread count is shown');
});

test('the clarity score and the estimate show only when they are known', async () => {
  const known = card({ title: 'Known', column: 'shape', clarity: 82, estimate: { usd: 3.5, minutes: 40 } });
  const unknown = card({ title: 'Unknown', column: 'shape' });
  const page = await openBoard({ cards: [known, unknown] });
  assert.match(page.text(page.cardEl(known.id).querySelector('[data-testid="discovery-card-clarity"]')), /82/);
  assert.ok(page.cardEl(known.id).querySelector('[data-testid="discovery-card-estimate"]'), 'a known estimate is shown');
  assert.equal(page.cardEl(unknown.id).querySelector('[data-testid="discovery-card-clarity"]') === null, true);
  assert.equal(page.cardEl(unknown.id).querySelector('[data-testid="discovery-card-estimate"]') === null, true);
});

test('a WIP column\'s header counts its cards against the limit: 2 / 5', async () => {
  const page = await openBoard({ cards: [card({ column: 'shape' }), card({ column: 'shape' }), card({ column: 'define' })] });
  assert.equal(page.text(page.column('shape').querySelector('[data-testid="discovery-column-count"]')), '2 / 5');
  assert.equal(page.text(page.column('define').querySelector('[data-testid="discovery-column-count"]')), '1 / 5');
  assert.notEqual(page.column('shape').getAttribute('data-over-wip'), 'true');
});

test('"Move to…" on a card moves it through the move channel to the chosen column', async () => {
  const c = card({ title: 'Move me', column: 'triage' });
  const page = await openBoard({ cards: [c] });
  await page.moveTo(c.id, 'Shape');
  const moves = page.callsTo('moveDiscoveryCard');
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].slice(0, 3), [P, c.id, 'shape']);
  assert.equal(page.cardColumn(c.id), 'shape', 'the board shows the card in its new column');
});

test('dropping a dragged card on a column moves it through the move channel', async () => {
  const c = card({ title: 'Drag me', column: 'shape' });
  const page = await openBoard({ cards: [c] });
  await page.dragTo(c.id, 'define');
  const moves = page.callsTo('moveDiscoveryCard');
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].slice(0, 3), [P, c.id, 'define']);
});

test('moving a card into a full Shape asks to confirm; on yes it moves and the column is marked over its limit', async () => {
  const c = card({ title: 'One too many', column: 'triage' });
  const page = await openBoard({ cards: [...fullShape(), c] });
  await page.moveTo(c.id, 'Shape');
  assert.equal(page.confirmOpen(), true, 'the confirm dialog is open');
  assert.equal(page.callsTo('moveDiscoveryCard').length, 0, 'nothing moves before the answer');
  page.$('#btn-confirm-yes').click();
  await settle(20);
  const moves = page.callsTo('moveDiscoveryCard');
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].slice(0, 3), [P, c.id, 'shape']);
  assert.equal(page.column('shape').getAttribute('data-over-wip'), 'true');
  assert.equal(page.text(page.column('shape').querySelector('[data-testid="discovery-column-count"]')), '6 / 5');
});

test('moving a card into a full Shape and answering no leaves it where it was', async () => {
  const c = card({ title: 'Stays', column: 'triage' });
  const page = await openBoard({ cards: [...fullShape(), c] });
  await page.moveTo(c.id, 'Shape');
  assert.equal(page.confirmOpen(), true, 'the confirm dialog is open');
  page.$('#btn-confirm-no').click();
  await settle(20);
  assert.equal(page.callsTo('moveDiscoveryCard').length, 0);
  assert.equal(page.cardColumn(c.id), 'triage');
  assert.notEqual(page.column('shape').getAttribute('data-over-wip'), 'true');
});

test('a WIP limit is edited on the board through the set-wip channel', async () => {
  const page = await openBoard({ cards: [card({ column: 'shape' })] });
  const edit = page.all('[data-testid="discovery-wip-edit"]').find((el) => el.getAttribute('data-column') === 'shape');
  assert.ok(edit, 'Shape has a [data-testid="discovery-wip-edit"]');
  let input = /^(input|select)$/.test(edit.localName) ? edit : null;
  if (!input) {
    edit.click();
    await settle();
    input = page.column('shape').querySelector('input') || page.all('input[type="number"]').filter(page.visible).at(-1);
  }
  assert.ok(input, 'an input for the limit');
  await page.setField(input, '3');
  const { KeyboardEvent } = page.dom.classes;
  if (!page.callsTo('setDiscoveryWip').length) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle(20);
  }
  const calls = page.callsTo('setDiscoveryWip');
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0][0], calls[0][1], Number(calls[0][2])], [P, 'shape', 3]);
  assert.equal(page.text(page.column('shape').querySelector('[data-testid="discovery-column-count"]')), '1 / 3');
});

test('fast lane: bug and hotfix cards are in the top swimlane, an idea is not', async () => {
  const bug = card({ title: 'Crash on save', type: 'bug', column: 'triage' });
  const hotfix = card({ title: 'Prod is down', type: 'hotfix', column: 'define' });
  const idea = card({ title: 'Dark mode', type: 'idea', column: 'triage' });
  const page = await openBoard({ cards: [bug, hotfix, idea] });
  const lane = page.$('[data-testid="discovery-fast-lane"]');
  assert.ok(lane, 'the board has a fast lane');
  const inLane = lane.querySelectorAll('[data-testid="discovery-card"]').map((el) => el.getAttribute('data-card'));
  assert.ok(inLane.includes(bug.id), 'the bug is in the fast lane');
  assert.ok(inLane.includes(hotfix.id), 'the hotfix is in the fast lane');
  assert.ok(!inLane.includes(idea.id), 'the idea is not');
});

test('fast lane: a bug in Triage can be moved straight to Define', async () => {
  const bug = card({ title: 'Crash on save', type: 'bug', column: 'triage' });
  const page = await openBoard({ cards: [bug] });
  await page.moveTo(bug.id, 'Define');
  if (page.confirmOpen()) { page.$('#btn-confirm-yes').click(); await settle(20); }
  const moves = page.callsTo('moveDiscoveryCard');
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].slice(0, 3), [P, bug.id, 'define']);
});

test('the type filter hides the cards of other types', async () => {
  const bug = card({ title: 'Crash', type: 'bug', column: 'triage' });
  const idea = card({ title: 'Dark mode', type: 'idea', column: 'triage' });
  const rfc = card({ title: 'New storage', type: 'rfc', column: 'shape' });
  const page = await openBoard({ cards: [bug, idea, rfc] });
  const select = page.$('[data-testid="discovery-filter-type"]');
  assert.ok(select, 'a type filter');
  await page.setField(select, 'rfc');
  assert.deepEqual(page.visibleCardIds(), [rfc.id]);
});

test('the tag filter shows only the cards with that tag', async () => {
  const csv = card({ title: 'Export CSV', column: 'triage', tags: ['export', 'runs'] });
  const pdf = card({ title: 'Export PDF', column: 'shape', tags: ['export'] });
  const dark = card({ title: 'Dark mode', column: 'triage', tags: ['ui'] });
  const page = await openBoard({ cards: [csv, pdf, dark] });
  await page.setField(page.$('[data-testid="discovery-filter-tag"]'), 'export');
  assert.deepEqual(page.visibleCardIds().sort(), [csv.id, pdf.id].sort());
  await page.setField(page.$('[data-testid="discovery-filter-tag"]'), '');
  assert.equal(page.visibleCardIds().length, 3, 'All tags shows every card again');
});

test('the author filter shows only that author\'s cards, combined with the type filter', async () => {
  const anaBug = card({ title: 'Crash', type: 'bug', column: 'triage', author: 'ana' });
  const anaIdea = card({ title: 'Themes', column: 'shape', author: 'ana' });
  const bo = card({ title: 'Sync', column: 'triage', author: 'bo' });
  const page = await openBoard({ cards: [anaBug, anaIdea, bo] });
  await page.setField(page.$('[data-testid="discovery-filter-author"]'), 'ana');
  assert.deepEqual(page.visibleCardIds().sort(), [anaBug.id, anaIdea.id].sort());
  await page.setField(page.$('[data-testid="discovery-filter-type"]'), 'idea');
  assert.deepEqual(page.visibleCardIds(), [anaIdea.id]);
});

test('the search matches card titles and documents', async () => {
  const byTitle = card({ title: 'Keyboard shortcuts', column: 'triage' });
  const byDoc = card({ title: 'Power users', column: 'shape', document: 'They want keyboard navigation everywhere.' });
  const other = card({ title: 'Dark mode', column: 'triage', document: 'Colours.' });
  const page = await openBoard({ cards: [byTitle, byDoc, other] });
  const search = page.$('[data-testid="discovery-search"]');
  assert.ok(search, 'a search box');
  await page.setField(search, 'keyboard');
  assert.deepEqual(page.visibleCardIds().sort(), [byTitle.id, byDoc.id].sort());
});

test('the card detail shows the document in an editor with a preview, the acceptance criteria, attachments and thread', async () => {
  const c = card({ title: 'Export', column: 'shape', document: '# Export\nAs CSV.', acceptance: '- a file is written', attachments: ['mock.png'] });
  const page = await openBoard({ cards: [c], threads: { [c.id]: [{ ts: '2026-10-02T10:00:00.000Z', kind: 'note', author: 'owner', text: 'Looks good' }] } });
  const detail = await page.openCard(c.id);
  const part = (id) => detail.querySelector(`[data-testid="${id}"]`);
  assert.equal(part('card-document-editor')?.value, '# Export\nAs CSV.');
  assert.match(page.text(part('card-document-preview')), /As CSV/);
  assert.match(page.text(part('card-acceptance')), /a file is written/);
  assert.match(page.text(part('card-attachments')), /mock\.png/);
  assert.match(page.text(part('card-thread')), /Looks good/);
  // #648: Write & Review and AI Arena left the card; a Shape card writes its document with write-doc
  assert.ok(part('card-write-doc'), 'a Shape card offers Write a document');
  assert.equal(part('card-open-write-review'), null, 'no Open in Write & Review');
  assert.equal(part('card-open-arena'), null, 'no Open in AI Arena');
});

test('a Write & Review result shows in the detail as the newest version and a thread entry', async () => {
  const c = card({ title: 'Export', column: 'shape', document: 'Reviewed PRD' });
  const versions = [
    { name: '2026-10-04T12-00-00-000Z-result-write-review.md', ts: '2026-10-04T12:00:00.000Z', reason: 'result-write-review' },
    { name: '2026-10-03T12-00-00-000Z-move-shape.md', ts: '2026-10-03T12:00:00.000Z', reason: 'move-shape' },
  ];
  const thread = [{ ts: '2026-10-04T12:00:00.000Z', kind: 'result', source: 'write-review', runId: 'run-42', text: 'Write & Review finished: a new version' }];
  const page = await openBoard({ cards: [c], versions: { [c.id]: versions }, threads: { [c.id]: thread } });
  const detail = await page.openCard(c.id);
  assert.ok(page.callsTo('discoveryVersions').some((a) => a[0] === P && a[1] === c.id), 'the versions are read');
  const items = detail.querySelectorAll('[data-testid="card-versions"] [data-testid="card-version"]');
  assert.equal(items.length, 2);
  assert.match(page.text(items[0]), /write.?review|Write & Review/i, 'the newest is the Write & Review result');
  assert.match(page.text(detail.querySelector('[data-testid="card-thread"]')), /Write & Review finished/);
});

test('a version is opened through the version channel and restored through restore-version', async () => {
  const c = card({ title: 'Export', column: 'shape', document: 'now' });
  const name = '2026-10-03T12-00-00-000Z-move-shape.md';
  const page = await openBoard({
    cards: [c],
    versions: { [c.id]: [{ name, ts: '2026-10-03T12:00:00.000Z', reason: 'move-shape' }] },
    versionText: { [`${c.id}/${name}`]: 'the older text' },
  });
  const detail = await page.openCard(c.id);
  const item = detail.querySelector('[data-testid="card-version"]');
  assert.ok(item, 'the version is listed');
  item.querySelector('[data-testid="card-version-open"]').click();
  await settle(20);
  assert.deepEqual(page.callsTo('discoveryVersion').map((a) => a.slice(0, 3)), [[P, c.id, name]]);
  assert.match(page.text(page.document.body), /the older text/, 'the opened version\'s text is shown');
  const restore = page.$('[data-testid="discovery-card-detail"] [data-testid="card-version-restore"]');
  restore.click();
  await settle(20);
  if (page.confirmOpen()) { page.$('#btn-confirm-yes').click(); await settle(20); }
  assert.deepEqual(page.callsTo('restoreDiscoveryVersion').map((a) => a.slice(0, 3)), [[P, c.id, name]]);
});
