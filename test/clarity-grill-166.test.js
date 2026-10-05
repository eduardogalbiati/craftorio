// #166 Internals of the clarity score in the discovery store (src/discovery.js, src/clarity.js), next
// to the acceptance tests (clarity-166, clarity-store-166): the Grill me interview in a card's
// thread (grillCard, answerGrill), the checks of setClarityBar, the store's ready forecast, and when
// a card is scored again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout } = require('../src/workspace');
const discovery = require('../src/discovery');

const P = 'p1';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-grill-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return layout(root).discovery;
}

// ---- Grill me -----------------------------------------------------------------------------------

test('grillCard asks the first open point in the thread, the card waits for its owner, and asking again repeats nothing', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export runs as CSV' });
  const { question, bar } = discovery.grillCard(dir, P, card.id);
  assert.equal(bar, 85);
  assert.equal(question.kind, 'question');
  assert.equal(question.grill, 'problem');
  assert.equal(question.author, 'Grill me');
  assert.match(question.text, /^Problem: /);
  assert.deepEqual(discovery.listWaiting(dir, P).map((c) => c.id), [card.id]);
  assert.equal(discovery.grillCard(dir, P, card.id).question.ts, question.ts);
  assert.equal(discovery.readConversation(dir, P, card.id).length, 1);
});

test('the question proposes the text the card already holds for the point', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export runs as CSV', text: 'The owner copies the runs table by hand every Monday.' });
  assert.equal(discovery.grillCard(dir, P, card.id).question.proposal, 'The owner copies the runs table by hand every Monday.');
});

test('answerGrill writes the answer into the document under the point\'s heading, keeps the replaced document as a version, and asks the next point', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export runs as CSV', text: 'Notes.' });
  discovery.grillCard(dir, P, card.id);
  const next = discovery.answerGrill(dir, P, card.id, { text: 'The runs table cannot be exported.', by: 'ana' });
  assert.match(next.card.document, /^Notes\.\n\n## Problem\n\nThe runs table cannot be exported\.\n$/);
  assert.equal(next.card.clarity.score, 20); // the problem: 3 of the 15 points of an idea
  assert.ok(!next.card.clarity.gaps.some((g) => /^Problem/.test(g)));
  assert.equal(next.question.grill, 'goal');
  assert.ok(discovery.listVersions(dir, P, card.id).some((v) => v.reason === 'before-grill'));
  const thread = discovery.readConversation(dir, P, card.id);
  assert.deepEqual(thread.map((m) => [m.kind, m.author]), [['question', 'Grill me'], ['answer', 'ana'], ['question', 'Grill me']]);
});

test('an answer to the acceptance criteria goes to acceptance.md, one list item per line', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export', text: ['Problem', 'Goal', 'Scope', 'Non-goals'].map((h) => `## ${h}\n\nSaid.\n`).join('\n') });
  assert.equal(discovery.grillCard(dir, P, card.id).question.grill, 'acceptance');
  const { card: after } = discovery.answerGrill(dir, P, card.id, { text: 'The file has one row per run\n- It opens in a spreadsheet' });
  assert.equal(after.acceptance, '- The file has one row per run\n- It opens in a spreadsheet\n');
  assert.equal(after.document, card.document);
});

test('the interview ends when the card reaches its bar, and an answer without a waiting question is refused', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export' });
  discovery.setClarityBar(dir, P, { bar: 20 });
  discovery.grillCard(dir, P, card.id);
  const end = discovery.answerGrill(dir, P, card.id, { text: 'Nothing exports the runs.' });
  assert.equal(end.question, null);
  const last = discovery.readConversation(dir, P, card.id).at(-1);
  assert.equal(last.kind, 'note');
  assert.match(last.text, /at or above the bar of 20%/);
  assert.deepEqual(discovery.listWaiting(dir, P), []);
  assert.throws(() => discovery.answerGrill(dir, P, card.id, { text: 'More' }), /No Grill me question/);
});

test('an empty answer is refused and the question keeps waiting', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export' });
  discovery.grillCard(dir, P, card.id);
  assert.throws(() => discovery.answerGrill(dir, P, card.id, { text: '  ' }), /needs a text/);
  assert.equal(discovery.readCard(dir, P, card.id).document, '');
  assert.equal(discovery.listWaiting(dir, P).length, 1);
});

// ---- the bar's settings and the forecast ----------------------------------------------------------

test('setClarityBar refuses a bar outside 0-100, an unknown kind and a night that is not HH:MM; null takes a kind\'s bar away', (t) => {
  const dir = tmp(t);
  discovery.createCard(dir, P, { title: 'Makes the project folder' });
  assert.throws(() => discovery.setClarityBar(dir, P, { bar: 101 }), /0 to 100/);
  assert.throws(() => discovery.setClarityBar(dir, P, { bar: 85.5 }), /whole number/);
  assert.throws(() => discovery.setClarityBar(dir, P, { byKind: { epic: 50 } }), /Unknown kind/);
  assert.throws(() => discovery.setClarityBar(dir, P, { night: { start: '23h', end: '08:00' } }), /HH:MM/);
  discovery.setClarityBar(dir, P, { byKind: { hotfix: 60, bug: 70 } });
  const board = discovery.setClarityBar(dir, P, { byKind: { bug: null }, night: { start: '22:00', end: '06:00' } });
  assert.deepEqual(board.clarity, { bar: 85, byKind: { hotfix: 60 }, night: { start: '22:00', end: '06:00' } });
  // the columns, their limits and the order are kept
  assert.deepEqual(board.columns.map((c) => c.id), ['inbox', 'triage', 'shape', 'define', 'ready']);
});

test('readyForecast counts the Ready cards at or above the bar in the project\'s night, not a card moved there with an override', (t) => {
  const dir = tmp(t);
  const ready = (title, score, minutes, force) => {
    const card = discovery.createCard(dir, P, { title });
    discovery.updateCard(dir, P, card.id, { clarity: { score }, estimate: { minutes } });
    discovery.moveCard(dir, P, card.id, 'ready', force ? { force: true, reason: 'Needed now' } : {});
  };
  ready('Clear', 90, 600);
  ready('Clear too', 85, 480);
  ready('Forced', 40, 3000, true);
  discovery.setClarityBar(dir, P, { night: { start: '22:00', end: '06:00' } });
  assert.deepEqual(discovery.readyForecast(dir, P), { count: 2, unestimated: 0, hours: 18, nights: 2, nightHours: 8 });
});

// ---- when a card is scored again ------------------------------------------------------------------

test('a new type scores the card with that kind\'s rubric; a clarity given with the text is the one kept', (t) => {
  const dir = tmp(t);
  const text = ['Problem', 'Goal', 'Scope', 'Non-goals', 'Decisions', 'Open questions', 'Dependencies', 'Evidence'].map((h) => `## ${h}\n\nSaid.\n`).join('\n');
  const card = discovery.createCard(dir, P, { title: 'Export', text });
  const idea = discovery.updateCard(dir, P, card.id, { acceptance: '- It exports' });
  assert.equal(idea.clarity.score, 100);
  assert.equal(idea.clarity.by, 'Clarity rubric');
  const prd = discovery.updateCard(dir, P, card.id, { type: 'prd' });
  assert.equal(prd.clarity.score, 79); // users and success metrics are missing: 15 of 19
  assert.deepEqual(prd.clarity.gaps.map((g) => g.split(':')[0]), ['Users', 'Success metrics']);
  const given = discovery.updateCard(dir, P, card.id, { document: `${text}\nMore.`, clarity: { score: 91, gaps: [], by: 'Product Owner' } });
  assert.equal(given.clarity.score, 91);
  assert.equal(given.clarity.by, 'Product Owner');
  // a title or tags alone score nothing again
  assert.equal(discovery.updateCard(dir, P, card.id, { title: 'Export runs', tags: ['x'] }).clarity.score, 91);
});

test('a run\'s result and a restored version score the card again', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export', text: 'Notes.' });
  discovery.updateCard(dir, P, card.id, { clarity: { score: 99, by: 'someone' } });
  const result = discovery.recordResult(dir, P, card.id, { source: 'write-review', text: '## Problem\n\nNothing exports the runs.\n' });
  assert.equal(result.clarity.score, 20);
  assert.equal(result.clarity.by, 'Clarity rubric');
  const first = discovery.listVersions(dir, P, card.id).find((v) => v.reason === 'before-result');
  assert.equal(discovery.restoreVersion(dir, P, card.id, first.name).clarity.score, 0);
});

test('a forced move of a card at or above the bar records no override; the override keeps the bar of that moment', (t) => {
  const dir = tmp(t);
  const clear = discovery.createCard(dir, P, { title: 'Clear' });
  discovery.updateCard(dir, P, clear.id, { clarity: { score: 90 } });
  assert.equal(discovery.moveCard(dir, P, clear.id, 'ready', { force: true, reason: 'x' }).clarity.override, undefined);
  const vague = discovery.createCard(dir, P, { title: 'Vague' });
  discovery.updateCard(dir, P, vague.id, { clarity: { score: null } });
  const { override } = discovery.moveCard(dir, P, vague.id, 'ready', { by: 'ana', force: true, reason: ' Needed now ' }).clarity;
  assert.deepEqual({ score: override.score, bar: override.bar, reason: override.reason, by: override.by }, { score: null, bar: 85, reason: 'Needed now', by: 'ana' });
});
