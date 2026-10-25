// The browsing model of the image viewer (image-viewer.js, #182), without the DOM: the images of
// the context the viewer was opened from (a run's screenshots, a folder, a chat), in the order they
// are shown. An item is one screen: a single image, or an original/modified pair (#146) that counts
// as ONE item. ← / → (and the arrows) go to the previous / next item, Home / End to the first /
// last, never wrapping around; Space, O and M switch inside a pair. Going to another item resets
// the zoom (fit); switching inside a pair keeps it, to compare the two sides.
// - keyAction(key): the action of a KeyboardEvent.key, or null;
// - createImageSequence(items, index, imageIndex): { length, index, imageIndex, current, hasPrev,
//   hasNext, navigable, counter, apply(action) → { moved, zoom: 'reset' | 'keep' }, preload }.
// Browser: window.ImageSequence; Node: module.exports.
(function (root) {
  const KEYS = {
    ArrowRight: 'next',
    ArrowLeft: 'prev',
    Home: 'first',
    End: 'last',
    ' ': 'switch',
    o: 'original',
    O: 'original',
    m: 'modified',
    M: 'modified',
    '+': 'zoom-in',
    '=': 'zoom-in',
    '-': 'zoom-out',
    0: 'fit',
    1: 'actual',
    Escape: 'close',
  };
  const keyAction = (key) => KEYS[key] || null;

  const clampIndex = (i, n) => Math.min(Math.max(0, Number(i) || 0), Math.max(0, n - 1));

  function createImageSequence(items = [], index = 0, imageIndex = 0) {
    const list = (items || []).filter((it) => it && it.images && it.images.length);
    const s = {
      items: list,
      length: list.length,
      index: clampIndex(index, list.length),
      imageIndex: 0,
      current() {
        const item = list[s.index] || null;
        return { item, image: item ? item.images[s.imageIndex] : null, index: s.index, imageIndex: s.imageIndex };
      },
      hasPrev: () => s.index > 0,
      hasNext: () => s.index < list.length - 1,
      navigable: () => list.length > 1,
      counter: () => (s.navigable() ? `${s.index + 1} / ${list.length}` : ''),
      apply(action) {
        const stay = { moved: false, zoom: 'keep' };
        const go = (i) => {
          if (i < 0 || i >= list.length || i === s.index) return stay;
          s.index = i;
          s.imageIndex = 0;
          return { moved: true, zoom: 'reset' };
        };
        const images = list[s.index]?.images || [];
        const toImage = (j) => {
          if (j < 0 || j >= images.length || j === s.imageIndex) return stay;
          s.imageIndex = j;
          return { moved: true, zoom: 'keep' };
        };
        const sideIndex = (side) => images.findIndex((im) => im.side === side);
        switch (action) {
          case 'next': return go(s.index + 1);
          case 'prev': return go(s.index - 1);
          case 'first': return go(0);
          case 'last': return go(list.length - 1);
          case 'switch': return images.length > 1 ? toImage((s.imageIndex + 1) % images.length) : stay;
          case 'original': return toImage(sideIndex('original'));
          case 'modified': return toImage(sideIndex('modified'));
          default: return stay;
        }
      },
      // the images of the previous and next items, to load before they are shown
      preload() {
        const out = [];
        for (const i of [s.index - 1, s.index + 1]) {
          for (const im of list[i]?.images || []) {
            const src = im.src || im.file;
            if (src) out.push(src);
          }
        }
        return out;
      },
    };
    s.imageIndex = clampIndex(imageIndex, list[s.index]?.images.length || 0);
    return s;
  }

  const api = { createImageSequence, keyAction };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImageSequence = api;
})(typeof window !== 'undefined' ? window : globalThis);
