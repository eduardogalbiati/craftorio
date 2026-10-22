// #466 (e): a file dropped anywhere on the app's page never navigates the window to it.
// CONTRACT (acceptance tests written before the code): src/renderer/app.js registers document-level
//   (or window-level) 'dragover' and 'drop' listeners that call event.preventDefault() for any drag
//   (the drop zones of the views keep their own handlers). Loaded through test/renderer-app-harness.js
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
function dragEvent(app, type) {
  return {
    type,
    target: app.sandbox.document.body,
    currentTarget: app.sandbox.document,
    dataTransfer: { types: ['Files'], files: [{ name: 'x.html', path: 'C:/tmp/x.html' }], dropEffect: 'none' },
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
