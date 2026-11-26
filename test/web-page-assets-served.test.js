// A browser tab on the engine server (`/` redirects to /apps/web/renderer/index.html, packages/engine/server):
// every file the page names with a relative path (<img src>, <script src>, <link href>) must be inside
// a folder the server serves and exist. The new logo (85149ec7) named ../../desktop/assets/logo.png,
// which a browser resolves to /apps/desktop/assets/logo.png: not served, so the header showed a broken image
// and the Findings capture of the page (html-to-image) failed (features/751-findings-remote-capture.feature).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { staticDirs, uiDir } = require('../packages/engine/server');

const root = path.join(__dirname, '..');
const ui = uiDir(require('../package.json'));

test('every relative file the web page names is served by the engine server and exists', () => {
  const html = fs.readFileSync(path.join(root, ui, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/<(?:img|script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    .filter((r) => !/^(?:[a-z]+:|\/\/|#|data:)/i.test(r));
  assert.ok(refs.some((r) => r.endsWith('logo.png')), 'the page names its logo');
  const served = staticDirs(root, ui);
  const bad = [];
  for (const ref of refs) {
    const rel = decodeURIComponent(new URL(ref, `http://engine.test/${ui}index.html`).pathname).replace(/^\/+/, '');
    const inServed = served.some((d) => rel.startsWith(d));
    if (!inServed || !fs.existsSync(path.join(root, rel))) bad.push(`${ref} -> /${rel}${inServed ? ' (missing)' : ' (not served)'}`);
  }
  assert.deepEqual(bad, [], 'files the browser tab cannot load');
});
