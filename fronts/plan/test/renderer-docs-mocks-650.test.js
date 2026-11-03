// #650 Write doc phase 5 (docs/work/write-doc/spec.md R16 and Design): interactive mocks in an opaque
// origin. A mock (an HTML screen of the Mockups, #625) runs its own scripts, so it is drawn in an iframe
// sandboxed with allow-scripts and WITHOUT allow-same-origin (an opaque origin: no window.api, no
// parent DOM, no storage of the app), and a CSP that allows no network. Acceptance tests written before
// the code. Seam assumed: window.DocsPage.mockFrame(html, { title }) → the iframe's HTML (a string) for
// the reader (fronts/plan/views/docs/docs-page.js), its page in `srcdoc`.
// Strings only cross the vm boundary (never a sandbox object handed to an assertion).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');

const MOCK = '<button id="pay" onclick="this.textContent=\'Paid\'">Pay now</button><script>document.title = "mock";</script>';

async function app() {
  const a = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listDocItems: async () => [],
    },
  });
  await a.boot();
  return a;
}

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function frameOf(html) {
  const a = await app();
  a.run(`window.__mock650 = ${JSON.stringify(html)};`);
  return String(a.run("typeof DocsPage.mockFrame === 'function' ? String(DocsPage.mockFrame(window.__mock650, { title: 'Checkout mock' })) : 'missing'"));
}
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
};

test('#650 a mock is drawn in an iframe sandboxed with allow-scripts only (an opaque origin)', async () => {
  const frame = await frameOf(MOCK);
  assert.notEqual(frame, 'missing', 'DocsPage.mockFrame');
  assert.match(frame, /^<iframe\b/);
  assert.equal(attr(frame, 'sandbox'), 'allow-scripts');
  assert.equal(/allow-same-origin/.test(frame), false, frame);
});

test('#650 the mock\'s page keeps its markup and scripts under a CSP that allows no network', async () => {
  const frame = await frameOf(MOCK);
  const page = attr(frame, 'srcdoc');
  assert.ok(page, frame);
  assert.ok(page.includes('<button id="pay"'), page);
  const csp = (page.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i) || [])[1];
  assert.ok(csp, page);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'unsafe-inline'/);
  assert.equal(/https?:|\*|connect-src (?!'none')/.test(csp), false, csp);
});

test('#650 a mock that tries to close the frame does not escape it: its text stays inside srcdoc', async () => {
  const frame = await frameOf('</iframe><script>parent.api && parent.api.startRun({})</script>');
  assert.equal((frame.match(/<iframe\b/g) || []).length, 1, frame);
  assert.equal((frame.match(/<\/iframe>/g) || []).length, 1, frame);
  assert.ok(frame.trim().endsWith('</iframe>'), frame);
});
