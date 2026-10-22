// #466 (c): the markdown an agent writes (src/renderer/artifact-render.js markdownHtml, through
// sanitizeHtml) never carries a form or a form control: a `<form action="../../x.html"><button>`
// in a report would navigate the window to a local page on a click.
// CONTRACT (acceptance tests written before the code): sanitizeHtml passes DOMPurify a config with
//   FORBID_TAGS ⊇ form, input, button, textarea, select, style and FORBID_ATTR ⊇ action, formaction
//   (as the second argument of DOMPurify.sanitize, or once through DOMPurify.setConfig). Optional:
//   ALLOWED_URI_REGEXP limited to https?:, mailto:, # (not tested: "consider" in the issue).
// Why a recording DOMPurify and not the real one: DOMPurify needs a DOM, and no DOM implementation
// (jsdom, linkedom, happy-dom) is installed for the node tests; the real browser behaviour is
// DOMPurify's own (FORBID_TAGS / FORBID_ATTR are its documented options). The stub records the
// config and the hooks; marked is a pass-through, the fake document is the minimum markdownHtml uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const renderSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'artifact-render.js'), 'utf8');

const FORM_MD = '# Report\n\n<form action="../../../../tmp/x.html"><button>Open the report</button></form>\n';

function loadRender() {
  const purify = { calls: [], configs: [], hooks: {} };
  const sandbox = {
    console,
    esc: (s) => String(s ?? ''),
    marked: { parse: (s) => String(s ?? ''), use() {}, setOptions() {} },
    DOMPurify: {
      sanitize(html, cfg) { purify.calls.push(String(html)); if (cfg) purify.configs.push(cfg); return `[clean]${html}`; },
      setConfig(cfg) { purify.configs.push(cfg); },
      addHook(name, fn) { (purify.hooks[name] ||= []).push(fn); },
    },
    document: {
      createElement: () => ({ innerHTML: '', querySelectorAll: () => [] }),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(renderSrc, sandbox, { filename: 'artifact-render.js' });
  return { markdownHtml: vm.runInContext('markdownHtml', sandbox), purify };
}

// the union of a config key over every config DOMPurify was given, lower-cased
function configured(purify, key) {
  const out = new Set();
  for (const cfg of purify.configs) for (const v of cfg?.[key] || []) out.add(String(v).toLowerCase());
  return out;
}

test('#466 the markdown goes through DOMPurify and markdownHtml returns what it sanitized (guard)', () => {
  const { markdownHtml, purify } = loadRender();
  const out = markdownHtml(FORM_MD);
  assert.equal(purify.calls.length, 1);
  assert.equal(purify.calls[0].includes('<form action="../../../../tmp/x.html">'), true, 'the form markup reaches DOMPurify');
  assert.equal(out.startsWith('[clean]'), true, `the sanitized string comes back: ${out.slice(0, 40)}`);
});

test('#466 sanitizeHtml forbids the form and form-control tags: form, input, button, textarea, select, style', () => {
  const { markdownHtml, purify } = loadRender();
  markdownHtml(FORM_MD);
  const tags = configured(purify, 'FORBID_TAGS');
  for (const tag of ['form', 'input', 'button', 'textarea', 'select', 'style']) {
    assert.equal(tags.has(tag), true, `FORBID_TAGS has ${tag}: ${JSON.stringify([...tags])}`);
  }
});

test('#466 sanitizeHtml forbids the action and formaction attributes', () => {
  const { markdownHtml, purify } = loadRender();
  markdownHtml('<button formaction="file:///C:/tmp/x.html">Go</button>');
  const attrs = configured(purify, 'FORBID_ATTR');
  assert.equal(attrs.has('action'), true, `FORBID_ATTR has action: ${JSON.stringify([...attrs])}`);
  assert.equal(attrs.has('formaction'), true, `FORBID_ATTR has formaction: ${JSON.stringify([...attrs])}`);
});

test('#466 links keep their behaviour: an https link opens in a new tab, an #anchor link stays in the page (guard)', () => {
  const { markdownHtml, purify } = loadRender();
  markdownHtml('[a](https://example.com) [b](#section)');
  const hooks = purify.hooks.afterSanitizeAttributes || [];
  assert.equal(hooks.length >= 1, true, 'an afterSanitizeAttributes hook');
  const link = (href) => {
    const attrs = { href };
    return { tagName: 'A', attrs, getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); } };
  };
  const https = link('https://example.com');
  const anchor = link('#section');
  for (const fn of hooks) { fn(https); fn(anchor); }
  assert.equal(https.attrs.href, 'https://example.com');
  assert.equal(https.attrs.target, '_blank');
  assert.equal(https.attrs.rel, 'noopener noreferrer');
  assert.equal(anchor.attrs.href, '#section');
  assert.equal('target' in anchor.attrs, false);
});
