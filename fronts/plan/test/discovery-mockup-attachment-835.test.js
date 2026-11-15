// #835 Mockups phase 2, a mockup version attached to a Discovery card: the card detail
// (fronts/plan/views/discovery/discovery.js) asks discovery:attachment (api.discoveryAttachment) for an
// attachment named <slug>@<sha7>.mockup.json, like for an image, and shows the frozen thumbnail it answers
// (dataUrl) in the card's attachments; a plain file (not an image, not a mockup) is not asked for.
// Loaded through test/discovery-board-harness.js (the whole page in a vm, window.api faked at its boundary).
const test = require('node:test');
const assert = require('node:assert/strict');
const { card, openBoard } = require('./discovery-board-harness');

const THUMB = 'data:image/svg+xml;base64,PHN2Zy8+';
const MOCKUP = 'orders-dashboard@c41e2a9.mockup.json';

async function openWith(attachments) {
  const c = card({ title: 'Export', column: 'shape', attachments });
  const asked = [];
  const page = await openBoard({
    cards: [c],
    api: { discoveryAttachment: async (_p, id, name) => { asked.push(name); return { name, dataUrl: THUMB }; } },
  });
  const detail = await page.openCard(c.id);
  await page.settle?.();
  return { page, detail, asked };
}

test('#835 the card detail asks for the attached mockup version\'s frozen thumbnail', async () => {
  const { asked } = await openWith([MOCKUP]);
  assert.deepEqual(asked, [MOCKUP]);
});

test('#835 the card detail shows the attached mockup version with the thumbnail it got', async () => {
  const { detail } = await openWith([MOCKUP]);
  const img = detail.querySelector('[data-testid="card-attachments"] img');
  assert.deepEqual([img === null, img?.getAttribute('src') ?? null], [false, THUMB]);
});

test('#835 a plain file attachment is not asked for a thumbnail', async () => {
  const { asked } = await openWith(['notes.txt', MOCKUP]);
  assert.deepEqual(asked, [MOCKUP]);
});
