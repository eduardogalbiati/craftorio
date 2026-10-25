// #466 (d): the app page's Content-Security-Policy (apps/desktop/renderer/index.html's meta) forbids form
// submissions, plugins and a <base> rewriting relative URLs.
// CONTRACT (acceptance tests written before the code): the meta http-equiv="Content-Security-Policy"
//   content keeps its current directives and gains `form-action 'none'`, `object-src 'none'` and
//   `base-uri 'none'`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);

const html = fs.readFileSync(pageFileOf('index.html'), 'utf8');

// the CSP directives, by name → their value (spaces collapsed)
function csp() {
  const m = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html);
  assert.ok(m, 'apps/desktop/renderer/index.html has a Content-Security-Policy meta');
  const out = {};
  for (const part of m[1].split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = values.join(' ');
  }
  return out;
}

test('#466 the CSP keeps its script-src \'self\' (guard)', () => {
  assert.equal(csp()['script-src'], "'self'");
});

test('#466 the CSP has form-action \'none\'', () => {
  assert.equal(csp()['form-action'], "'none'");
});

test('#466 the CSP has object-src \'none\'', () => {
  assert.equal(csp()['object-src'], "'none'");
});

test('#466 the CSP has base-uri \'none\'', () => {
  assert.equal(csp()['base-uri'], "'none'");
});
