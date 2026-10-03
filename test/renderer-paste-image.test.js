// src/renderer/paste-image.js (#130): pasting an image into an AI prompt field. Its pure helpers
// (pastedFiles, checkImage, formatSize, LIMITS) are exported via module.exports when there is no
// `document` (see the file's own header comment), so they are required directly in Node; the DOM
// wiring (the document-level paste listener, the scan/attach pattern shared with voice.js) is
// evaluated in a vm sandbox with a minimal fake DOM, the way test/renderer-start-drawer.test.js
// checks start-drawer.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { checkImage, formatSize, LIMITS, pastedFiles } = require('../src/renderer/paste-image.js');
const { VOICE_FIELDS } = require('../src/renderer/voice.js');

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('pastedFiles: the clipboard\'s image files, when there is no text on it', () => {
  const png = { kind: 'file', type: 'image/png', getAsFile: () => ({ type: 'image/png', size: 10 }) };
  const data = { items: [png], getData: () => '' };
  assert.deepEqual(pastedFiles(data), [{ type: 'image/png', size: 10 }]);
});

test('pastedFiles: none when the clipboard also holds text (e.g. a copy from Office) — the text pastes as usual', () => {
  const png = { kind: 'file', type: 'image/png', getAsFile: () => ({ type: 'image/png', size: 10 }) };
  const data = { items: [png], getData: (t) => (t === 'text/plain' ? 'some text' : '') };
  assert.deepEqual(pastedFiles(data), []);
});

test('pastedFiles: none for clipboard data that is missing or has no file items', () => {
  assert.deepEqual(pastedFiles(null), []);
  assert.deepEqual(pastedFiles({ items: [{ kind: 'string', type: 'text/plain' }], getData: () => '' }), []);
});

test('checkImage: refuses a field that already has the maximum number of images', () => {
  assert.equal(checkImage({ type: 'image/png', size: 10 }, LIMITS.count), `Over ${LIMITS.count} images`);
  assert.equal(checkImage({ type: 'image/png', size: 10 }, LIMITS.count - 1), null);
});

test('checkImage: refuses an unsupported format, naming it generically', () => {
  assert.equal(checkImage({ type: 'image/bmp', size: 10 }), 'Unsupported format');
  assert.equal(checkImage({ type: 'image/png', size: 10 }), null);
});

test('checkImage: refuses an image over the byte limit, with the size and the limit in MB', () => {
  assert.equal(checkImage({ type: 'image/png', size: 12 * 1024 * 1024 }), 'Image too large: 12 MB, max 10 MB');
  assert.equal(checkImage({ type: 'image/png', size: 10 * 1024 * 1024 }), null);
});

test('formatSize: kilobytes under 1 MB, one decimal in MB from 1 MB up', () => {
  assert.equal(formatSize(240 * 1024), '240 KB');
  assert.equal(formatSize(1.5 * 1024 * 1024), '1.5 MB');
  assert.equal(formatSize(1), '1 KB');
});

// ---------------------------------------------------------------------------
// DOM wiring: a minimal fake DOM, close enough to what paste-image.js touches (matches,
// querySelectorAll, classList, getAttribute/setAttribute, document.createElement/addEventListener).
// ---------------------------------------------------------------------------

function selMatches(el, selectorList) {
  return String(selectorList).split(',').some((raw) => {
    const sel = raw.trim();
    const m = /^([a-z][a-z0-9]*)?((?:[.#]\S+|\[[^\]]+\])*)$/i.exec(sel);
    if (!m) return false;
    const [, tag, rest] = m;
    if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    const parts = rest.match(/\.[\w-]+|#[\w-]+|\[id\^="[^"]*"\]|\[id\$="[^"]*"\]/g) || [];
    return parts.every((p) => {
      if (p[0] === '.') return el.classList.contains(p.slice(1));
      if (p[0] === '#') return el.id === p.slice(1);
      let mm = /^\[id\^="([^"]*)"\]$/.exec(p);
      if (mm) return el.id.startsWith(mm[1]);
      mm = /^\[id\$="([^"]*)"\]$/.exec(p);
      if (mm) return el.id.endsWith(mm[1]);
      return false;
    });
  });
}

function makeField({ tag = 'textarea', id = '', classes = [], disabled = false, readOnly = false } = {}) {
  const classSet = new Set(classes);
  const attrs = {};
  const el = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    id,
    disabled,
    readOnly,
    nextElementSibling: null,
    classList: {
      contains: (c) => classSet.has(c),
      add: (c) => classSet.add(c),
      remove: (c) => classSet.delete(c),
      toggle(c, force) { force === undefined ? (classSet.has(c) ? classSet.delete(c) : classSet.add(c)) : (force ? classSet.add(c) : classSet.delete(c)); },
    },
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    setAttribute: (n, v) => { attrs[n] = String(v); },
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    after() {},
    addEventListener() {},
    matches(sel) { return selMatches(el, sel); },
    focus() {},
  };
  return el;
}

// Loads paste-image.js in a vm sandbox with a fake document holding `fields`, a stubbed
// `api` (recording its calls) and `voice.VOICE_FIELDS` taken from the real module (so the test
// never keeps a second hand-copied field list). Returns the sandbox, the captured document-level
// paste listener and the fields passed in (now wired by the module's own scan/attach).
function loadPasteImage(fields) {
  const calls = [];
  const api = {
    clipboardSaveImage: async (data, name) => { calls.push(['save', data, name]); return { path: `/ws/attachments/pending/${name}`, size: 123, name }; },
    clipboardDiscardImage: async (p) => { calls.push(['discard', p]); },
  };
  const pasteHandlers = [];
  class FileReader {
    readAsDataURL() { this.result = 'data:image/png;base64,AAAA'; if (this.onload) this.onload(); }
  }
  class MutationObserver { observe() {} }
  const sandbox = {
    api,
    voice: { VOICE_FIELDS },
    document: {
      body: { nodeType: 1, matches: () => false, querySelectorAll: (sel) => fields.filter((f) => selMatches(f, sel)) },
      createElement: () => makeField({ tag: 'div' }),
      addEventListener(type, cb) { if (type === 'paste') pasteHandlers.push(cb); },
      readyState: 'complete',
    },
    FileReader,
    MutationObserver,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'paste-image.js'), 'utf8');
  vm.runInContext(src, sandbox);
  return { sandbox, calls, paste: (ev) => pasteHandlers.forEach((h) => h(ev)) };
}

function pasteEvent({ target, text = '', images = [] }) {
  const ev = {
    target,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    clipboardData: {
      items: images.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      getData: (t) => (t === 'text/plain' ? text : ''),
    },
  };
  return ev;
}

test('a paste event with an image item on a field matched by VOICE_FIELDS (e.g. a Start drawer input) adds a chip and saves it through the service', async () => {
  const ta = makeField({ id: 'in-request' });
  const { calls, paste } = loadPasteImage([ta]);
  const ev = pasteEvent({ target: ta, images: [{ type: 'image/png', size: 1024 }] });
  paste(ev);

  assert.equal(ev.defaultPrevented, true);
  assert.equal(ta._paste.items.length, 1);
  assert.match(ta._paste.row.innerHTML, /paste-chip/);
  await ta._paste.items[0].saving; // the actual save (api.clipboardSaveImage) happens once the image is read
  assert.equal(calls[0][0], 'save');
  assert.equal(ta._paste.items[0].status, 'ready');
});

test('a text/plain paste (even with an image item, e.g. a copy from Office) is left to the browser: no chip, not prevented', () => {
  const ta = makeField({ id: 'in-request' });
  const { calls, paste } = loadPasteImage([ta]);
  const ev = pasteEvent({ target: ta, text: 'hello', images: [{ type: 'image/png', size: 1024 }] });
  paste(ev);

  assert.equal(ev.defaultPrevented, false);
  assert.equal(ta._paste.items.length, 0);
  assert.deepEqual(calls, []);
});

test('a disabled or read-only field ignores a pasted image', () => {
  const disabled = makeField({ id: 'in-disabled', disabled: true });
  const readOnly = makeField({ id: 'in-readonly', readOnly: true });
  const { calls, paste } = loadPasteImage([disabled, readOnly]);
  const image = { type: 'image/png', size: 1024 };

  const evDisabled = pasteEvent({ target: disabled, images: [image] });
  paste(evDisabled);
  assert.equal(evDisabled.defaultPrevented, false);
  assert.equal(disabled._paste.items.length, 0);

  const evReadOnly = pasteEvent({ target: readOnly, images: [image] });
  paste(evReadOnly);
  assert.equal(evReadOnly.defaultPrevented, false);
  assert.equal(readOnly._paste.items.length, 0);
  assert.deepEqual(calls, []);
});

test('fields with their own image paste (#po-question, the Oracle\'s .oracle-input) are left out, even though they match VOICE_FIELDS', () => {
  const po = makeField({ id: 'po-question' });
  const oracle = makeField({ id: 'oracle-q-1', classes: ['svc-input', 'oracle-input'] });
  loadPasteImage([po, oracle]);
  assert.equal(po._paste, undefined);
  assert.equal(oracle._paste, undefined);
});
