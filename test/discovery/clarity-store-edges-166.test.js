// #166 Edge cases of the clarity score in the discovery store (src/domains/discovery/discovery.js, src/domains/discovery/clarity.js), next
// to clarity-store-166 (acceptance) and clarity-grill-166: the date of a score given by another
// scorer, Grill me answers with markdown of their own, ending an interview, and the forecast with a
// bar per kind and a card whose score dropped after it entered Ready.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout } = require('../../src/workspace');
const discovery = require('../../src/domains/discovery/discovery');

const P = 'p1';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-edges-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return layout(root).discovery;
}

test('a score another scorer records without the text is dated now and keeps who gave it', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export runs as CSV' });
  discovery.updateCard(dir, P, card.id, { clarity: { ts: '2020-01-01T00:00:00.000Z' } });
  const before = Date.now();
  const given = discovery.updateCard(dir, P, card.id, { clarity: { score: 90, gaps: [], by: 'Product Owner' } });
  assert.equal(given.clarity.score, 90);
  assert.equal(given.clarity.by, 'Product Owner');
  assert.notEqual(given.clarity.ts, '2020-01-01T00:00:00.000Z', 'the score is dated when it was recorded, not with the previous score\'s date');
  assert.ok(Date.parse(given.clarity.ts) >= before - 1000, `ts ${given.clarity.ts}`);
});

test('a Grill me answer that starts with a heading of its own still covers the point and the next point is asked', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export runs as CSV' });
  assert.equal(discovery.grillCard(dir, P, card.id).question.grill, 'problem');
  const next = discovery.answerGrill(dir, P, card.id, { text: '# Today\n\nThe runs table cannot be exported.' });
  assert.ok(!next.card.clarity.gaps.some((g) => /^Problem/.test(g)), `gaps: ${next.card.clarity.gaps.join('; ')}`);
  assert.equal(next.question.grill, 'goal');
});

test('a Grill me answer with an unclosed code fence does not hide the answers that follow it', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export runs as CSV' });
  discovery.grillCard(dir, P, card.id);
  const goal = discovery.answerGrill(dir, P, card.id, { text: 'The export fails with:\n```\nError: no exporter' });
  assert.equal(goal.question.grill, 'goal');
  const after = discovery.answerGrill(dir, P, card.id, { text: 'The owner downloads a CSV of the runs from the Runs screen.' });
  assert.ok(!after.card.clarity.gaps.some((g) => /^Goal/.test(g)), `gaps: ${after.card.clarity.gaps.join('; ')}`);
  assert.notEqual(after.question.grill, 'goal', 'the goal is not asked again');
  assert.ok(after.card.clarity.score > goal.card.clarity.score, `${after.card.clarity.score} is not above ${goal.card.clarity.score}`);
});

test('an ended interview leaves the card no longer waiting, and Grill me later asks the point still open', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export runs as CSV' });
  discovery.grillCard(dir, P, card.id);
  discovery.answerGrill(dir, P, card.id, { text: 'The runs table cannot be exported.' });
  discovery.appendConversation(dir, P, card.id, { text: 'Ended the Grill me interview.' });
  assert.deepEqual(discovery.listWaiting(dir, P).map((c) => c.id), []);
  assert.throws(() => discovery.answerGrill(dir, P, card.id, { text: 'Too late.' }), /No Grill me question/);
  assert.equal(discovery.grillCard(dir, P, card.id).question.grill, 'goal');
});

test('the store\'s forecast uses the bar of each kind and leaves out a Ready card whose score dropped below it', (t) => {
  const dir = tmp(t);
  discovery.setClarityBar(dir, P, { byKind: { hotfix: 60 }, night: { start: '22:00', end: '06:00' } });
  const hotfix = discovery.createCard(dir, P, { title: 'Hotfix', type: 'hotfix' });
  discovery.updateCard(dir, P, hotfix.id, { clarity: { score: 65 }, estimate: { minutes: 240 } });
  discovery.moveCard(dir, P, hotfix.id, 'ready');
  const idea = discovery.createCard(dir, P, { title: 'Idea' });
  discovery.updateCard(dir, P, idea.id, { clarity: { score: 90 }, estimate: { minutes: 600 } });
  discovery.moveCard(dir, P, idea.id, 'ready');
  discovery.updateCard(dir, P, idea.id, { clarity: { score: 65 } });
  assert.equal(discovery.readCard(dir, P, idea.id).column, 'ready', 'the gate is not retroactive');
  const f = discovery.readyForecast(dir, P);
  assert.deepEqual({ count: f.count, hours: f.hours, nightHours: f.nightHours }, { count: 1, hours: 4, nightHours: 8 });
});
