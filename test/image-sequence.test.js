// #182 Image viewer: ← / → browse every image of the same context (an original/modified pair
// counts as ONE item), Home/End, no wrap-around, a counter, neighbours preloaded, a separate key to
// switch inside a pair.
//
// Interface under test (new pure module, loaded inside each test):
//   src/renderer/image-sequence.js, UMD like image-viewer-model.js: module.exports in Node,
//   window.ImageSequence in the renderer.
//   - keyAction(key) → the action of a KeyboardEvent.key, or null:
//       'ArrowRight' → 'next', 'ArrowLeft' → 'prev', 'Home' → 'first', 'End' → 'last',
//       ' ' → 'switch' (the other image of a pair), 'o' / 'O' → 'original', 'm' / 'M' → 'modified',
//       '+' / '=' → 'zoom-in', '-' → 'zoom-out', '0' → 'fit', '1' → 'actual', 'Escape' → 'close'.
//   - createImageSequence(items, index = 0, imageIndex = 0) → a sequence:
//       items: [{ title?, images: [{ src?, file?, label?, side?: 'original'|'modified' }] }]
//         (one image: a single screenshot; two: an original/modified pair);
//       .length (number of items), .index, .imageIndex (numbers, current position);
//       .current() → { item, image, index, imageIndex };
//       .hasPrev(), .hasNext() → boolean; .navigable() → false for a context of one item (no arrows);
//       .counter() → '3 / 12' ('' when not navigable);
//       .apply(action) → { moved: boolean, zoom: 'reset' | 'keep' }: 'next'/'prev'/'first'/'last'
//         go to another item (no wrap-around: at an end nothing moves) and reset the zoom (fit) when
//         they move; 'switch'/'original'/'modified' change the image inside the current pair and
//         keep the zoom; anything that does not move keeps the zoom;
//       .preload() → the src (or file, without src) of every image of the previous and next items.
//   Opener (src/renderer/artifacts-panel.js): a click on a screenshot thumbnail calls
//   ImageViewer.open({ title, items, index, imageIndex }) with every screen of that context.
const test = require('node:test');
const assert = require('node:assert/strict');
const { closestTarget, fakeRoot, loadPanel, waitTick } = require('./artifacts-panel-helpers');

const load = () => require('../src/renderer/image-sequence');

const pair = (n) => ({ title: `Screen ${n}`, images: [
  { src: `data:${n}-original`, label: 'Original', side: 'original' },
  { src: `data:${n}-modified`, label: 'Modified', side: 'modified' },
] });
const single = (n) => ({ title: `Screen ${n}`, images: [{ src: `data:${n}`, label: '' }] });
// pair, single, pair, single
const ITEMS = [pair(1), single(2), pair(3), single(4)];

test('keyAction: arrows, Home/End, pair switch keys, zoom keys and Escape map to their actions', () => {
  const { keyAction } = load();
  assert.equal(keyAction('ArrowRight'), 'next');
  assert.equal(keyAction('ArrowLeft'), 'prev');
  assert.equal(keyAction('Home'), 'first');
  assert.equal(keyAction('End'), 'last');
  assert.equal(keyAction(' '), 'switch');
  assert.equal(keyAction('o'), 'original');
  assert.equal(keyAction('M'), 'modified');
  assert.equal(keyAction('+'), 'zoom-in');
  assert.equal(keyAction('-'), 'zoom-out');
  assert.equal(keyAction('0'), 'fit');
  assert.equal(keyAction('1'), 'actual');
  assert.equal(keyAction('Escape'), 'close');
  assert.equal(keyAction('x'), null);
});

test('a pair counts as one item: four screens (two pairs) give "1 / 4", then "2 / 4" after next', () => {
  const s = load().createImageSequence(ITEMS, 0);
  assert.equal(s.length, 4);
  assert.equal(s.counter(), '1 / 4');
  s.apply('next');
  assert.equal(s.index, 1);
  assert.equal(s.counter(), '2 / 4');
});

test('no wrap-around: at the last item next does not move and hasNext is false; at the first, prev does not move', () => {
  const s = load().createImageSequence(ITEMS, 3);
  assert.equal(s.hasNext(), false);
  assert.equal(s.hasPrev(), true);
  assert.deepEqual(s.apply('next'), { moved: false, zoom: 'keep' });
  assert.equal(s.index, 3);
  s.apply('first');
  assert.equal(s.index, 0);
  assert.equal(s.hasPrev(), false);
  assert.deepEqual(s.apply('prev'), { moved: false, zoom: 'keep' });
  assert.equal(s.index, 0);
});

test('Home and End go to the first and the last item', () => {
  const { createImageSequence, keyAction } = load();
  const s = createImageSequence(ITEMS, 1);
  s.apply(keyAction('End'));
  assert.equal(s.counter(), '4 / 4');
  s.apply(keyAction('Home'));
  assert.equal(s.counter(), '1 / 4');
});

test('going to another item resets the zoom; switching inside a pair keeps it and stays on the same item', () => {
  const s = load().createImageSequence(ITEMS, 0, 0);
  assert.deepEqual(s.apply('switch'), { moved: true, zoom: 'keep' });
  assert.equal(s.index, 0);
  assert.equal(s.current().image.side, 'modified');
  assert.deepEqual(s.apply('original'), { moved: true, zoom: 'keep' });
  assert.equal(s.current().image.side, 'original');
  assert.deepEqual(s.apply('next'), { moved: true, zoom: 'reset' });
  assert.equal(s.index, 1);
});

test('arrows never switch inside a pair: from a pair\'s original, next goes to the next screen', () => {
  const s = load().createImageSequence(ITEMS, 0, 0);
  s.apply('next');
  assert.equal(s.current().item.title, 'Screen 2');
});

test('preload lists the images of the previous and next items, not the current one', () => {
  const s = load().createImageSequence(ITEMS, 1);
  assert.deepEqual([...s.preload()].sort(), ['data:1-modified', 'data:1-original', 'data:3-modified', 'data:3-original']);
});

test('a context of one image is not navigable: no counter, no arrows, nothing moves', () => {
  const s = load().createImageSequence([single(1)], 0);
  assert.equal(s.navigable(), false);
  assert.equal(s.counter(), '');
  assert.equal(s.hasNext(), false);
  assert.equal(s.hasPrev(), false);
  assert.deepEqual(s.apply('switch'), { moved: false, zoom: 'keep' });
  assert.deepEqual(s.apply('next'), { moved: false, zoom: 'keep' });
});

// ---- the opener: the Artifacts panel passes every screen of the context ----------------------

function twoScreens() {
  const f = (key, side) => `/r/evidence/evidence/round-1/${key}.${side}.png`;
  const img = (key, side, caption) => ({
    path: f(key, side).replace('/r/', ''), file: f(key, side),
    pair: f(key, side === 'original' ? 'modified' : 'original').replace('/r/', ''), pair_file: f(key, side === 'original' ? 'modified' : 'original'),
    side, key, issue: '182', caption, commit: side === 'modified' ? 'abc1234' : null, step: 'evidence', round: 1, final: true,
  });
  return {
    version: 1, base: 'main', branch: 'feat/182', final: { step: 'evidence', round: 1 },
    rounds: [{ step: 'evidence', round: 1, captured_at: '2026-10-03T00:00:00Z', final: true }],
    images: [
      img('182-viewer-first', 'modified', 'First screen'), img('182-viewer-first', 'original', 'First screen'),
      img('182-viewer-second', 'modified', 'Second screen'), img('182-viewer-second', 'original', 'Second screen'),
    ],
  };
}

test('artifacts panel: clicking a screenshot opens the viewer with every screen of the set as items, at the clicked one', async () => {
  const ev = twoScreens();
  const files = ev.images.map((x) => ({ path: x.file, name: x.file.split('/').pop(), rel: x.path, kind: 'image', category: 'screenshots', size: 1, mtime: '2026-10-03T00:00:00Z' }));
  const { ArtifactsPanel, calls } = loadPanel({ listArtifacts: async () => [{ artifacts: files }], runEvidence: async () => ev });
  const { root, listeners } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();
  const second = '/r/evidence/evidence/round-1/182-viewer-second.modified.png';
  listeners.click({ target: closestTarget('[data-iv-thumb]', { apImg: second }, { alt: 'Second screen: Modified' }) });
  assert.equal(calls.imageViewerOpen.length, 1);
  const opened = calls.imageViewerOpen[0];
  assert.equal(opened.items?.length, 2, 'both screens of the set, each pair one item');
  assert.equal(opened.index, 1);
  assert.equal(opened.items[1].images.length, 2);
});
