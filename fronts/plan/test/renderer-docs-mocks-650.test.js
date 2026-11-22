// #650 Write doc phase 5 (docs/work/write-doc/spec.md R16 and Design): interactive mocks in an opaque
// origin. A mock (an HTML screen of the Mockups, #625) runs its own scripts, so it is drawn in an iframe
// sandboxed with allow-scripts and WITHOUT allow-same-origin (an opaque origin: no window.api, no
// parent DOM, no storage of the app), and a CSP that allows no network. Acceptance tests written before
// the code. Seam assumed: window.DocsPage.mockFrame(html, { title }) → the iframe's HTML (a string) for
// the reader (fronts/plan/views/docs/docs-page.js), its page in `srcdoc`.
// Strings only cross the vm boundary (never a sandbox object handed to an assertion).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

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

// ---- the document's mock blocks and how they are mounted (review of round 1) ------------------------

const DOC_WITH_MOCKS = [
  '# Spec: checkout',
  '',
  '```html mock Pay screen',
  '<button id="pay">Pay now</button>',
  '```',
  '',
  'Between the two.',
  '',
  '```html mock',
  '<p>Second</p>',
  '```',
  '',
  '```html',
  '<p>not a mock</p>',
  '```',
].join('\n');

test('#650 DocsPage.mocks lists the document\'s ```html mock blocks with their titles, not the plain html blocks', async () => {
  const a = await app();
  a.run(`window.__md650 = ${JSON.stringify(DOC_WITH_MOCKS)};`);
  const out = JSON.parse(String(a.run('JSON.stringify(DocsPage.mocks(window.__md650))')));
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'Pay screen');
  assert.equal(out[0].html.trim(), '<button id="pay">Pay now</button>');
  assert.equal(out[1].html.trim(), '<p>Second</p>');
  assert.ok(out[1].title, 'an untitled mock still gets a title');
});

// mountMocks(box, markup) in a page: docs-page.js loaded alone in a vm, with a small DOM whose
// <template> content holds the markup's iframes as elements (attributes readable and writable) and
// whose box keeps what it is given, serialised back to markup (strings only leave the vm).
function mountedMarkup(markup) {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const file = require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), 'views/docs/docs-page.js');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const frameOfTag = (tag) => {
    const attrs = new Map([...tag.matchAll(/\s([\w-]+)="([^"]*)"/g)].map((m) => [m[1], unesc(m[2])]));
    return {
      attrs,
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      removeAttribute: (k) => attrs.delete(k),
      hasAttribute: (k) => attrs.has(k),
      matches: () => true,
      serialise: () => `<iframe${[...attrs].map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}></iframe>`,
    };
  };
  const template = () => {
    let frames = [];
    let rest = '';
    const content = {
      querySelectorAll: (sel) => frames.filter((f) => !/\[srcdoc\]/.test(sel) || f.hasAttribute('srcdoc')),
      serialise: () => rest.replace(/<!--frame(\d+)-->/g, (_, i) => frames[Number(i)].serialise()),
    };
    return {
      content,
      set innerHTML(html) {
        frames = [];
        rest = String(html).replace(/<iframe\b[^>]*>\s*<\/iframe>/g, (tag) => { frames.push(frameOfTag(tag)); return `<!--frame${frames.length - 1}-->`; });
      },
    };
  };
  const box = { html: null, replaceChildren(node) { box.html = node?.serialise ? node.serialise() : String(node ?? ''); }, set innerHTML(h) { box.html = String(h); } };
  const sandbox = {
    esc,
    console,
    URL,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: {
      currentScript: { src: 'file:///app/fronts/plan/views/docs/docs-page.js' },
      documentElement: {},
      createElement: (name) => (name === 'template' ? template() : { set innerHTML(h) {} }),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
  vm.runInContext(`window.DocsPage.mountMocks(window.__box, window.DocsPage.mockFrame(${JSON.stringify(markup)}, { title: 'Pay screen' }))`, Object.assign(sandbox, { __box: box }));
  return String(box.html);
}

test('#650 mountMocks loads each mock through docs-mock.html, its page in the URL fragment, without srcdoc, sandbox still allow-scripts', () => {
  const html = mountedMarkup(MOCK);
  const tags = html.match(/<iframe\b[^>]*>/g) || [];
  assert.equal(tags.length, 1, html);
  const tag = tags[0];
  assert.equal(attr(tag, 'srcdoc'), null, tag);
  assert.equal(attr(tag, 'sandbox'), 'allow-scripts');
  const src = attr(tag, 'src');
  assert.ok(src, tag);
  const [shell, fragment] = [src.slice(0, src.indexOf('#')), src.slice(src.indexOf('#') + 1)];
  assert.match(shell, /\/views\/docs\/docs-mock\.html$/);
  const page = decodeURIComponent(fragment);
  assert.ok(page.includes('<button id="pay"'), page);
  assert.match(page, /default-src 'none'/);
});

test('#650 docs-mock.html has its own CSP: inline scripts run, no network, and it writes the page of its fragment', () => {
  const fs = require('fs');
  const path = require('path');
  const file = require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), 'views/docs/docs-mock.html');
  assert.ok(file && fs.existsSync(file), 'views/docs/docs-mock.html');
  const shell = fs.readFileSync(file, 'utf8');
  const csp = (shell.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i) || [])[1];
  assert.ok(csp, 'a CSP meta');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'unsafe-inline'/);
  assert.equal(/https?:|\*|'self'|connect-src (?!'none')/.test(csp), false, csp);
  assert.match(shell, /location\.hash/);
});

test('#650 a mock that tries to close the frame does not escape it: its text stays inside srcdoc', async () => {
  const frame = await frameOf('</iframe><script>parent.api && parent.api.startRun({})</script>');
  assert.equal((frame.match(/<iframe\b/g) || []).length, 1, frame);
  assert.equal((frame.match(/<\/iframe>/g) || []).length, 1, frame);
  assert.ok(frame.trim().endsWith('</iframe>'), frame);
});
