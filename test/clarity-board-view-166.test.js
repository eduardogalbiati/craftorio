// #166 The clarity score on the Discovery board screen (src/renderer/views/discovery/discovery.js),
// on the page harness of the board's tests (test/discovery-board-harness.js: the whole page in
// test/mini-dom.js, window.api backed by a fake store). Internals next to the E2E scenarios of
// features/discovery.feature: the badge against the bar, the refused move with "Grill me" and
// "Move anyway", the override's dialog, the ready forecast and the panel's clarity section.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boardApi, card, openBoard, settle, P } = require('./discovery-board-harness');

const REFUSAL = 'Below the clarity bar: its clarity is 60%, the bar is 85%. Close its gaps (Grill me), or move it anyway with a reason.';
const tid = (id) => `[data-testid="${id}"]`;
// the fake store's board plus what the service adds (#166): the clarity settings, the forecast
const boardWith = (cards, extra) => { const { methods } = boardApi({ cards }); return async () => ({ ...(await methods.discoveryBoard()), ...extra() }); };

test('a card\'s badge is its score as a percentage, amber below the bar of its type', async () => {
  const low = card({ title: 'Low', column: 'define', clarity: 60 });
  const high = card({ title: 'High', column: 'define', clarity: 90 });
  const hotfix = card({ title: 'Hotfix', type: 'hotfix', column: 'define', clarity: 70 });
  const cards = [low, high, hotfix];
  const page = await openBoard({ cards, api: { discoveryBoard: boardWith(cards, () => ({ clarity: { bar: 85, byKind: { hotfix: 60 }, night: { start: '23:00', end: '08:00' } } })) } });
  const badge = (c) => page.cardEl(c.id).querySelector(tid('clarity-badge'));
  assert.equal(page.text(badge(low)), 'clarity 60%');
  assert.ok(badge(low).classList.contains('warn'));
  assert.ok(!badge(high).classList.contains('warn'));
  assert.ok(!badge(hotfix).classList.contains('warn'), 'a hotfix at 70% passes its own bar of 60%');
});

test('a move the store refuses under the bar keeps the card, says why, and offers Grill me and Move anyway; the override needs a reason', async () => {
  const c = card({ title: 'Share a run report', column: 'define', clarity: 60 });
  const forced = [];
  const page = await openBoard({
    cards: [c],
    api: {
      moveDiscoveryCard: async () => { throw new Error(REFUSAL); },
      moveDiscoveryCardAnyway: async (projectId, id, reason) => {
        forced.push([projectId, id, reason]);
        Object.assign(page.store.cards.get(id), { column: 'ready', clarity: { score: 60, gaps: [], override: { score: 60, bar: 85, reason, by: 'owner', ts: '2026-10-04T10:00:00.000Z' } } });
        page.store.order.define = [];
        page.store.order.ready = [id];
      },
    },
  });
  await page.moveTo(c.id, 'Ready');
  assert.equal(page.cardColumn(c.id), 'define');
  const refused = page.$(tid('clarity-refused'));
  assert.match(page.text(refused), /"Share a run report" stays in Define\. Below the clarity bar: .*85%/);
  assert.equal(page.text(page.cardEl(c.id).querySelector(tid('grill-me'))), 'Grill me');

  page.cardEl(c.id).querySelector(tid('clarity-move-anyway')).click();
  await settle();
  const dialog = page.$(tid('clarity-override-dialog'));
  assert.ok(page.visible(dialog));
  assert.equal(dialog.getAttribute('role'), 'dialog');
  const confirm = dialog.querySelector(tid('clarity-override-confirm'));
  assert.equal(confirm.disabled, true);
  await page.setField(dialog.querySelector(tid('clarity-override-reason')), 'The owner explained it');
  assert.equal(confirm.disabled, false);
  const { Event } = page.dom.classes;
  dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle(20);

  assert.deepEqual(forced, [[P, c.id, 'The owner explained it']]);
  assert.ok(!page.visible(dialog));
  assert.equal(page.cardColumn(c.id), 'ready');
  assert.equal(page.text(page.$(tid('clarity-refused'))), '');
  assert.ok(page.cardEl(c.id).querySelector(tid('clarity-override')), 'the card shows it was moved anyway');
  assert.equal(page.cardEl(c.id).querySelector(tid('grill-me')), null);
});

test('another error of a move is an error, not a clarity refusal', async () => {
  const c = card({ title: 'A card', column: 'define', clarity: 90 });
  const page = await openBoard({ cards: [c], api: { moveDiscoveryCard: async () => { throw new Error('Card not found: x'); } } });
  await page.moveTo(c.id, 'Ready');
  assert.equal(page.text(page.$(tid('clarity-refused'))), '');
  assert.match(page.text(page.$('#dsc-error')), /Card not found/);
  assert.equal(page.cardEl(c.id).querySelector(tid('clarity-move-anyway')), null);
});

test('the ready forecast shows nights and hours as an estimate, the cards without one, and nothing ready', async () => {
  const clarity = { bar: 85, byKind: { hotfix: 60 }, night: { start: '23:00', end: '08:00' } };
  let forecast = { count: 3, unestimated: 1, hours: 19, nights: 2, nightHours: 9 };
  const cards = [card({ title: 'A card' })];
  const page = await openBoard({ cards, api: { discoveryBoard: boardWith(cards, () => ({ clarity, forecast })) } });
  const show = async () => { page.run("showView('discovery')"); await settle(20); return page.text(page.$(`${tid('discovery-board')} ${tid('ready-forecast')}`)); };
  assert.equal(await show(), '2 nights ready (about 19 h of agent work, an estimate; 1 card not estimated)');
  assert.match(page.text(page.$(tid('clarity-bar-summary'))), /Clarity bar 85% \(hotfix 60%\) · night 23:00 to 08:00/);
  forecast = { count: 1, unestimated: 0, hours: 3, nights: 1, nightHours: 9 };
  assert.equal(await show(), '1 night ready (about 3 h of agent work, an estimate)');
  forecast = { count: 2, unestimated: 2, hours: 0, nights: 0, nightHours: 9 };
  assert.match(await show(), /^2 cards ready \(no estimate/);
  forecast = { count: 0, unestimated: 0, hours: 0, nights: 0, nightHours: 9 };
  assert.match(await show(), /^Nothing ready yet \(an estimate/);
});

test('the card\'s panel shows its score against the bar, who scored it and when, the missing points and Grill me', async () => {
  const c = card({ title: 'Export runs as CSV', column: 'shape', clarity: 72 });
  Object.assign(c.clarity, { gaps: ['Who reads the exported file', 'Which columns the file holds'], ts: '2026-10-01T09:00:00.000Z', by: 'Product Owner' });
  const clear = card({ title: 'Clear', column: 'shape', clarity: 95 });
  const page = await openBoard({ cards: [c, clear] });
  const detail = await page.openCard(c.id);
  assert.deepEqual(detail.querySelectorAll(`${tid('clarity-missing')} li`).map((li) => page.text(li)), c.clarity.gaps);
  const scored = detail.querySelector(tid('clarity-scored'));
  assert.match(page.text(scored), /Scored by Product Owner/);
  assert.equal(scored.querySelector('time').getAttribute('datetime'), '2026-10-01T09:00:00.000Z');
  assert.match(page.text(detail.querySelector('#dsc-clarity')), /72% needs grilling: the bar is 85%/);
  assert.ok(detail.querySelector(tid('card-grill-me')));
  // Esc closes the card; a card at or above the bar offers no interview
  page.run("document.querySelector('[data-detail=\"close\"]').click()");
  await settle();
  const other = await page.openCard(clear.id);
  assert.match(page.text(other.querySelector('#dsc-clarity')), /95% at or above the bar of 85%/);
  assert.equal(other.querySelector(tid('card-grill-me')), null);
  assert.equal(other.querySelector(tid('clarity-missing')), null);
});

test('Grill me in the panel asks in the thread and the note box sends the answer to the interview', async () => {
  const c = card({ title: 'Export runs as CSV', column: 'shape', clarity: 20 });
  const thread = [];
  const answers = [];
  const question = (grill, text) => ({ ts: '2026-10-04T10:00:00.000Z', kind: 'question', author: 'Grill me', grill, text });
  const page = await openBoard({
    cards: [c],
    api: {
      discoveryConversation: async () => structuredClone(thread),
      grillDiscoveryCard: async () => { thread.push(question('problem', 'Problem: What is wrong or missing today, and who feels it?')); },
      answerDiscoveryGrill: async (_p, _id, text) => {
        answers.push(text);
        thread.push({ ts: '2026-10-04T10:01:00.000Z', kind: 'answer', author: 'owner', text }, { ts: '2026-10-04T10:01:01.000Z', kind: 'note', author: 'Grill me', text: 'The interview ends here.' });
      },
    },
  });
  const detail = await page.openCard(c.id);
  assert.equal(detail.querySelector(tid('grill-interview')), null);
  detail.querySelector(tid('card-grill-me')).click();
  await settle(20);
  const open = page.$(tid('discovery-card-detail'));
  assert.ok(open.querySelector(tid('grill-interview')), 'the waiting question shows the interview box');
  assert.match(page.text(open.querySelector(tid('card-thread'))), /Problem: What is wrong or missing today/);
  assert.equal(page.text(open.querySelector('#dsc-note-send')), 'Answer');
  open.querySelector('#dsc-note').value = 'Nothing exports the runs.';
  open.querySelector('#dsc-note-send').click();
  await settle(20);
  assert.deepEqual(answers, ['Nothing exports the runs.']);
  const after = page.$(tid('discovery-card-detail'));
  assert.equal(after.querySelector(tid('grill-interview')), null);
  assert.equal(page.text(after.querySelector('#dsc-note-send')), 'Add note');
});
