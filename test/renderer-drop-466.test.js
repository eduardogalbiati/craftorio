// #466 (e): a file dropped anywhere on the app's page never navigates the window to it.
// CONTRACT (acceptance tests written before the code): src/renderer/app.js registers document-level
//   (or window-level) 'dragover' and 'drop' listeners: dragover is always prevented, a drop carrying
//   a file or a link (Files, text/uri-list) is prevented, plain text still drops into a text box
//   (review 1); the drop zones of the views keep their own handlers. Loaded through test/renderer-app-harness.js
//   (the page's scripts in a vm with a fake DOM whose document records its listeners; window's
//   addEventListener goes to the document's there).
const test = require('node:test');
const assert = require('node:assert/strict');

async function page() {
  const { loadApp } = require('./renderer-app-harness');
  const app = loadApp();
  await app.boot();
  return app;
}

// a drag event reaching the document (nothing in the page stopped it)
function dragEvent(app, type, types = ['Files']) {
  return {
    type,
    target: app.sandbox.document.body,
    currentTarget: app.sandbox.document,
    dataTransfer: { types, files: types.includes('Files') ? [{ name: 'x.html', path: 'C:/tmp/x.html' }] : [], dropEffect: 'none' },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
}

test('#466 a file dragged over the page: the document-level dragover is prevented', async () => {
  const app = await page();
  const ev = dragEvent(app, 'dragover');
  app.sandbox.document.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
});

test('#466 a file dropped on the page: the document-level drop is prevented (no navigation to the file)', async () => {
  const app = await page();
  const ev = dragEvent(app, 'drop');
  app.sandbox.document.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
});

// review 1: a dropped link (text/uri-list) navigates like a file; plain text never does, and it
// still has to drop into the text box under it (the chat's textarea)
test('#466 a link dropped on the page: the document-level drop is prevented', async () => {
  const app = await page();
  const ev = dragEvent(app, 'drop', ['text/uri-list', 'text/plain']);
  app.sandbox.document.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
});

test('#466 plain text dragged over the page: dragover is still prevented', async () => {
  const app = await page();
  const ev = dragEvent(app, 'dragover', ['text/plain']);
  app.sandbox.document.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
});

test('#466 plain text dropped: the document lets it through (it drops into a text box)', async () => {
  const app = await page();
  const ev = dragEvent(app, 'drop', ['text/plain']);
  app.sandbox.document.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
});
