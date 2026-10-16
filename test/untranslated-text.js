// A test helper (not a test): the untranslated-text check of the interface language (#329, #330),
// shared by test/i18n-catalog-check-329.test.js (part c) and test/i18n-every-screen-330.test.js.
// - untranslated(src, name): the visible text a .js file shows outside t() in its HTML templates: a
//   text node `>Some words<` or a literal title= / placeholder= / aria-label= / alt= value with letters.
//   `${...}` content, entities, symbols and whitespace are not text; a line ending with
//   `// i18n-ignore` opts out (a product name, a code sample); comment lines are skipped.
// - untranslatedHtml(src, name): the same for a static page (src/renderer/index.html): a text node or
//   one of those attributes is translated when its own tag carries the hook interface-language.js
//   paints (data-i18n for the text, data-i18n-<attr> for the attribute); the product name, <script>,
//   <style> and comments are left out, a line ending with `<!-- i18n-ignore -->` opts out.
// - sourceFiles(dir): every .js / .jsx under dir (node_modules and vendor folders left out);
// - report(found): the assertion message (the first 40 findings).
const fs = require('fs');
const path = require('path');

const TAG_TEXT = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>([^<]*)/g;
const ATTR = /\b(title|placeholder|aria-label|alt)="([^"]*)"/g;
const LETTERS = /[A-Za-zÀ-ÿ]{2,}/;

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'vendor') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The text left once ${...} expressions, entities and anything after the template's end are dropped. */
function visible(s) {
  let out = String(s);
  for (let prev = null; prev !== out;) { prev = out; out = out.replace(/\$\{[^{}]*\}/g, ''); }
  const cut = out.search(/\$\{|`/); // an expression or a template that goes on past this point
  if (cut >= 0) out = out.slice(0, cut);
  return out.replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, '').trim();
}

/** Visible English outside t() in one file's source: ['file:line: "text"']. */
function untranslated(src, name = 'file') {
  const found = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (/\/\/\s*i18n-ignore\s*$/.test(line) || /^(\/\/|\/\*|\*)/.test(trimmed)) return;
    for (const m of line.matchAll(TAG_TEXT)) {
      const text = visible(m[1]);
      if (LETTERS.test(text)) found.push(`${name}:${i + 1}: >${text}<`);
    }
    for (const m of line.matchAll(ATTR)) {
      const text = visible(m[2]);
      if (LETTERS.test(text)) found.push(`${name}:${i + 1}: ${m[1]}="${text}"`);
    }
  });
  return found;
}

// the product's name is not translated (the brand, the window title)
const PRODUCT = /^(?:Multiagent|Orchestrator|Multiagent Orchestrator)$/;
const HTML_TAG = /<(\/?)([a-z][a-z0-9-]*)((?:\s[^<>]*)?)\/?>([^<]*)/gi;

/** Visible text of a static page without its data-i18n hook: ['file:line: "text"']. */
function untranslatedHtml(src, name = 'page.html') {
  const found = [];
  let skip = null; // inside <script> / <style> / a comment
  src.split(/\r?\n/).forEach((line, i) => {
    if (/<!--\s*i18n-ignore\s*-->\s*$/.test(line)) return;
    let rest = line;
    if (skip === 'comment') { const end = rest.indexOf('-->'); if (end < 0) return; rest = rest.slice(end + 3); skip = null; }
    rest = rest.replace(/<!--[\s\S]*?-->/g, '');
    if (rest.includes('<!--')) { rest = rest.slice(0, rest.indexOf('<!--')); skip = 'comment'; }
    for (const m of rest.matchAll(HTML_TAG)) {
      const [, closing, tag, attrs, after] = m;
      const lower = tag.toLowerCase();
      if (skip && skip !== 'comment') { if (closing && lower === skip) skip = null; continue; }
      if (!closing && (lower === 'script' || lower === 'style')) { if (!/<\/(script|style)>/i.test(rest.slice(m.index))) skip = lower; continue; }
      if (!closing) {
        for (const a of attrs.matchAll(ATTR)) {
          const text = a[2].replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, '').trim();
          if (LETTERS.test(text) && !PRODUCT.test(text) && !new RegExp(`\\bdata-i18n-${a[1]}=`).test(attrs)) found.push(`${name}:${i + 1}: ${a[1]}="${text}"`);
        }
      }
      const text = after.replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, '').replace(/\s+/g, ' ').trim();
      if (!LETTERS.test(text) || PRODUCT.test(text)) continue;
      if (closing || !/\bdata-i18n=/.test(attrs)) found.push(`${name}:${i + 1}: >${text}<`);
    }
  });
  return found;
}

/** The assertion message of a list of findings (the first 40). */
function report(found, what = 'visible text outside t() (move it to en.json, or end the line with // i18n-ignore)') {
  return `${what}:\n${found.slice(0, 40).join('\n')}${found.length > 40 ? `\n… ${found.length - 40} more` : ''}`;
}

module.exports = { ATTR, LETTERS, TAG_TEXT, report, sourceFiles, untranslated, untranslatedHtml, visible };
