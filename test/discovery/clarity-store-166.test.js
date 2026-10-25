// #166 Clarity score in the discovery store: a card enters the Ready column only with a clarity
// score at or above the project's bar for its kind (85 by default), or with an owner's override
// and a reason. The score is recomputed when the card's text changes, never edits the text, and is
// not retroactive (a card already in Ready stays there).
//
// The contract these tests assume, src/domains/discovery/discovery.js (new functions called through the module object,
// so a missing one fails its test, not the file):
//   setClarityBar(dir, projectId, { bar, byKind }) → stored in board.json
//   readBoard(dir, projectId).clarity → { bar, byKind } (bar 85 when never set)
//   moveCard(dir, projectId, id, 'ready', { by, force, reason }) throws /clarity/ below the bar or
//     without a score; force: true needs a reason (else throws /reason/) and records
//     card.clarity.override = { score, reason, by, ts }
//   createCard / updateCard (document or acceptance) → card.clarity { score, gaps, ts, by }
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout } = require('../../src/workspace');
const discovery = require('../../src/domains/discovery/discovery');

const P = 'p1';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dir: layout(root).discovery };
}

const doc = (headings) => headings.map((h) => `## ${h}\n\nThis section states the ${h.toLowerCase()} in a full sentence for the team.\n`).join('\n');
const COMPLETE_PRD = doc(['Problem', 'Goal', 'Scope', 'Non-goals', 'Decisions', 'Open questions', 'Dependencies', 'Evidence', 'Users', 'Success metrics']);

// A card walked to Define (inbox → triage → shape → define), never scored by hand.
function cardInDefine(dir, { title = 'A card', type = 'prd', text = '' } = {}) {
  const card = discovery.createCard(dir, P, { title, type, text });
  for (const c of ['triage', 'shape', 'define']) discovery.moveCard(dir, P, card.id, c, { by: 'tester' });
  return card.id;
}
const scoreOf = (dir, id, score) => discovery.updateCard(dir, P, id, { clarity: { score } });

// ---- the project's bar --------------------------------------------------------------------------

test('a board never configured has a clarity bar of 85', (t) => {
  const { dir } = tmp(t);
  discovery.createCard(dir, P, { title: 'Makes the project folder' });
  assert.equal(discovery.readBoard(dir, P).clarity.bar, 85);
});

test('setClarityBar stores the project\'s bar and per-kind bars in board.json', (t) => {
  const { dir } = tmp(t);
  discovery.createCard(dir, P, { title: 'Makes the project folder' });
  discovery.setClarityBar(dir, P, { bar: 90, byKind: { hotfix: 60 } });
  const { clarity } = discovery.readBoard(dir, P);
  assert.equal(clarity.bar, 90);
  assert.equal(clarity.byKind.hotfix, 60);
  const json = JSON.parse(fs.readFileSync(path.join(dir, P, 'board.json'), 'utf8'));
  assert.equal(json.clarity.bar, 90);
});

// ---- the gate into Ready ------------------------------------------------------------------------

test('moving a card without a clarity score into Ready is refused and the card stays in its column', (t) => {
  const { dir } = tmp(t);
  const id = cardInDefine(dir);
  scoreOf(dir, id, null);
  assert.throws(() => discovery.moveCard(dir, P, id, 'ready', { by: 'tester' }), /clarity/i);
  assert.equal(discovery.readCard(dir, P, id).column, 'define');
  assert.ok(!discovery.readBoard(dir, P).order.ready.includes(id));
});

test('moving a card scored below the bar into Ready is refused and the card stays in its column', (t) => {
  const { dir } = tmp(t);
  const id = cardInDefine(dir);
  scoreOf(dir, id, 84);
  assert.throws(() => discovery.moveCard(dir, P, id, 'ready', { by: 'tester' }), /clarity/i);
  assert.equal(discovery.readCard(dir, P, id).column, 'define');
});

test('a card scored at or above the bar moves into Ready', (t) => {
  const { dir } = tmp(t);
  const id = cardInDefine(dir);
  scoreOf(dir, id, 90);
  const moved = discovery.moveCard(dir, P, id, 'ready', { by: 'tester' });
  assert.equal(moved.column, 'ready');
  const at = cardInDefine(dir, { title: 'At the bar' });
  scoreOf(dir, at, 85);
  assert.equal(discovery.moveCard(dir, P, at, 'ready', { by: 'tester' }).column, 'ready');
});

test('moves between the other columns are never blocked by the clarity score', (t) => {
  const { dir } = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Unscored', type: 'prd' });
  scoreOf(dir, card.id, null);
  for (const c of ['triage', 'shape', 'define', 'shape', 'triage', 'inbox']) {
    assert.equal(discovery.moveCard(dir, P, card.id, c, { by: 'tester' }).column, c);
  }
});

test('a kind\'s own bar applies: with byKind.hotfix 60 a hotfix scored 70 enters Ready, a PRD scored 70 does not', (t) => {
  const { dir } = tmp(t);
  const hotfix = cardInDefine(dir, { title: 'Hotfix', type: 'hotfix' });
  const prd = cardInDefine(dir, { title: 'PRD', type: 'prd' });
  discovery.setClarityBar(dir, P, { bar: 85, byKind: { hotfix: 60 } });
  scoreOf(dir, hotfix, 70);
  scoreOf(dir, prd, 70);
  assert.equal(discovery.moveCard(dir, P, hotfix, 'ready', { by: 'tester' }).column, 'ready');
  assert.throws(() => discovery.moveCard(dir, P, prd, 'ready', { by: 'tester' }), /clarity/i);
  assert.equal(discovery.readCard(dir, P, prd).column, 'define');
});

// ---- the override -------------------------------------------------------------------------------

test('the owner\'s override with a reason moves a card below the bar into Ready and records the override on the card', (t) => {
  const { dir } = tmp(t);
  const id = cardInDefine(dir);
  scoreOf(dir, id, 40);
  const moved = discovery.moveCard(dir, P, id, 'ready', { by: 'owner', force: true, reason: 'Needed tonight' });
  assert.equal(moved.column, 'ready');
  const { override } = discovery.readCard(dir, P, id).clarity;
  assert.equal(override.score, 40);
  assert.equal(override.reason, 'Needed tonight');
  assert.equal(override.by, 'owner');
  assert.equal(typeof override.ts, 'string');
});

test('an override without a reason is refused and the card does not move', (t) => {
  const { dir } = tmp(t);
  const id = cardInDefine(dir);
  scoreOf(dir, id, 40);
  assert.throws(() => discovery.moveCard(dir, P, id, 'ready', { by: 'owner', force: true }), /reason/i);
  assert.throws(() => discovery.moveCard(dir, P, id, 'ready', { by: 'owner', force: true, reason: '  ' }), /reason/i);
  assert.equal(discovery.readCard(dir, P, id).column, 'define');
});

// ---- the score is recomputed from the text --------------------------------------------------------

test('updating a card\'s document and acceptance recomputes its clarity score, and an emptied document lowers it', (t) => {
  const { dir } = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Weekly report', type: 'prd' });
  const full = discovery.updateCard(dir, P, card.id, { document: COMPLETE_PRD, acceptance: '- The thing works' });
  assert.equal(typeof full.clarity.score, 'number');
  assert.ok(full.clarity.score >= 85, `score ${full.clarity.score}`);
  assert.ok(Array.isArray(full.clarity.gaps));
  assert.equal(typeof full.clarity.ts, 'string');
  assert.ok(typeof full.clarity.by === 'string' && full.clarity.by.length > 0, `by: ${full.clarity.by}`);
  const empty = discovery.updateCard(dir, P, card.id, { document: '' });
  assert.ok(empty.clarity.score < full.clarity.score, `${empty.clarity.score} is not below ${full.clarity.score}`);
});

test('createCard scores the new card\'s text', (t) => {
  const { dir } = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Weekly report', text: COMPLETE_PRD, type: 'prd' });
  assert.equal(typeof card.clarity.score, 'number');
});

test('scoring never edits the card\'s text: document.md and acceptance.md keep what was written', (t) => {
  const { dir } = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Weekly report', type: 'prd' });
  const text = '# Weekly report\n\nJust one line, no headings.';
  discovery.updateCard(dir, P, card.id, { document: text, acceptance: '- The thing works' });
  const read = discovery.readCard(dir, P, card.id);
  assert.equal(read.document, text);
  assert.equal(read.acceptance, '- The thing works');
  assert.equal(fs.readFileSync(path.join(dir, P, 'cards', card.id, 'document.md'), 'utf8'), text);
});

test('the gate is not retroactive: a card already in Ready stays there when its score drops below the bar', (t) => {
  const { dir } = tmp(t);
  const id = cardInDefine(dir);
  scoreOf(dir, id, 90);
  discovery.moveCard(dir, P, id, 'ready', { by: 'tester' });
  const after = discovery.updateCard(dir, P, id, { document: '' });
  assert.ok(after.clarity.score < 85, `score ${after.clarity.score}`);
  assert.equal(discovery.readCard(dir, P, id).column, 'ready');
  assert.ok(discovery.readBoard(dir, P).order.ready.includes(id));
});
