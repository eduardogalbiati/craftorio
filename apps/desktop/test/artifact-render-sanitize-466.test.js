// #466 (c): the markdown an agent writes (apps/desktop/renderer/artifact-render.js markdownHtml, through
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

const renderSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'artifact-render.js'), 'utf8');

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

// ---- review 1: task lists keep their checkboxes although `input` is forbidden ----
// The real marked (a fresh instance per sandbox); a DOMPurify stand-in that drops every FORBID_TAGS
// tag from the markup, as DOMPurify's option does; a string-backed element that answers
// `[attr]` selectors over its markup (the minimum markdownHtml needs to swap nodes).
const VOID = new Set(['input', 'br', 'img', 'hr']);
function stringElement(tag) {
  const el = {
    tag, attrs: {}, html: '',
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    get outerHTML() {
      const a = Object.entries(el.attrs).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${v}"`)).join('');
      return VOID.has(tag) ? `<${tag}${a}>` : `<${tag}${a}>${el.html}</${tag}>`;
    },
    get innerHTML() { return el.html; },
    set innerHTML(h) { el.html = String(h); },
    querySelectorAll(sel) {
      const m = /^\[([\w-]+)\]$/.exec(sel);
      if (!m) return [];
      const re = new RegExp(`<(\\w+)([^>]*\\s${m[1]}(?:="[^"]*")?[^>]*)>(?:</\\1>)?`, 'g');
      return [...el.html.matchAll(re)].map(([whole, , attrText]) => ({
        getAttribute(k) { const a = new RegExp(`\\s${k}="([^"]*)"`).exec(attrText); return a ? a[1] : null; },
        replaceWith(node) { el.html = el.html.replace(whole, node.outerHTML); },
      }));
    },
  };
  return el;
}

function loadRealMarked() {
  const { Marked } = require('marked');
  const md = new Marked();
  const sandbox = {
    console,
    esc: (s) => String(s ?? ''),
    marked: { parse: (s, o) => md.parse(s, o), use: (...a) => md.use(...a) },
    DOMPurify: {
      sanitize(html, cfg) {
        let out = String(html);
        for (const t of cfg?.FORBID_TAGS || []) out = out.replace(new RegExp(`</?${t}\\b[^>]*>`, 'gi'), '');
        return out;
      },
      setConfig() {},
      addHook() {},
    },
    document: { createElement: (tag) => stringElement(tag) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(renderSrc, sandbox, { filename: 'artifact-render.js' });
  return vm.runInContext('markdownHtml', sandbox);
}

const checkboxes = (html) => [...html.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0]);

test('#466 a task list keeps one disabled checkbox per item, checked only on the done one', () => {
  const markdownHtml = loadRealMarked();
  const out = markdownHtml('- [x] done item\n- [ ] item to do\n');
  const boxes = checkboxes(out);
  assert.equal(boxes.length, 2, out);
  assert.equal(boxes.every((b) => /type="checkbox"/.test(b) && /\sdisabled\b/.test(b)), true, out);
  assert.equal(/\schecked\b/.test(boxes[0]), true, `the done item is checked: ${out}`);
  assert.equal(/\schecked\b/.test(boxes[1]), false, `the item to do is not: ${out}`);
  assert.equal(out.includes('done item') && out.includes('item to do'), true);
});

test('#466 a hand-written text input or form in the markdown does not come back as a control', () => {
  const markdownHtml = loadRealMarked();
  const out = markdownHtml('Fill in: <input type="text" name="q">\n\n<form action="../x.html"><button>Go</button></form>\n');
  assert.equal(checkboxes(out).length, 0, out);
  assert.equal(/<form\b/i.test(out), false, out);
  assert.equal(/<button\b/i.test(out), false, out);
});
