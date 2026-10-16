// #329 the untranslated-text check (a permanent guard, written before the code). It fails when:
// (a) code uses a key missing from src/shared/i18n/en.json: every `t('a.key')` / `I18n.t('a.key')` with a
//     literal dotted first argument in src/ (.js, .jsx; node_modules and vendor folders left out);
// (b) a catalog of src/shared/i18n/ has keys en.json does not (the message lists them), a plural has no
//     `other` form, or a translation's {placeholders} differ from the English ones;
// (c) a file already moved to the catalog (MOVED_FILES) shows visible text outside t() in its HTML
//     templates: a text node `>Some words<` or a literal title= / placeholder= / aria-label= / alt=
//     value with letters. `${...}` content, entities, symbols and whitespace are not text; a line ending
//     with `// i18n-ignore` opts out (a product name, a code sample).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CATALOGS = path.join(SRC, 'shared', 'i18n');

// The files whose visible text lives in the catalog (a folder: every .js in it). #330 grows this list.
const MOVED_FILES = [
  'src/renderer/setup.js',
  'src/renderer/views/settings/',
];

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const english = () => readJson(path.join(CATALOGS, 'en.json'));
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'vendor') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// ---- (a) keys used in code ----------------------------------------------------------------------
const KEY_CALL = /(?:\bI18n\.t|(?<![\w$.])t)\(\s*(['"`])([a-z][\w-]*(?:\.[\w-]+)+)\1/g;

function usedKeys() {
  const used = new Map(); // key → first 'file:line'
  for (const file of sourceFiles(SRC)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(KEY_CALL)) if (!used.has(m[2])) used.set(m[2], `${rel(file)}:${i + 1}`);
    });
  }
  return used;
}

test('#329 (a) every key the code passes to t() exists in en.json', () => {
  const en = english();
  const used = usedKeys();
  assert.ok(used.size > 0, 'the code uses the catalog through t()');
  const missing = [...used].filter(([k]) => !(k in en)).map(([k, where]) => `${k} (${where})`);
  assert.deepEqual(missing, [], `keys missing from en.json:\n${missing.join('\n')}`);
});

// ---- (b) the catalogs ---------------------------------------------------------------------------
const catalogFiles = () => fs.readdirSync(CATALOGS).filter((f) => f.endsWith('.json'));
const placeholders = (v) => [...new Set([...(typeof v === 'string' ? [v] : Object.values(v || {}))]
  .flatMap((s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();

test('#329 (b) every catalog has only keys en.json has (the extra ones listed)', () => {
  const en = english();
  const files = catalogFiles();
  assert.ok(files.includes('en.json') && files.includes('pt-BR.json'), `catalogs: ${files.join(', ')}`);
  for (const f of files) {
    const extra = Object.keys(readJson(path.join(CATALOGS, f))).filter((k) => !(k in en));
    assert.deepEqual(extra, [], `${f} has keys en.json does not:\n${extra.join('\n')}`);
  }
});

test('#329 (b) every value is a text or a plural with an "other" form', () => {
  for (const f of catalogFiles()) {
    const bad = Object.entries(readJson(path.join(CATALOGS, f))).filter(([, v]) => {
      if (typeof v === 'string') return false;
      if (!v || typeof v !== 'object' || Array.isArray(v)) return true;
      return typeof v.other !== 'string' || Object.entries(v).some(([c, s]) => !PLURAL_CATEGORIES.includes(c) || typeof s !== 'string');
    }).map(([k]) => k);
    assert.deepEqual(bad, [], `${f}: values that are neither a text nor a plural with "other":\n${bad.join('\n')}`);
  }
});

test('#329 (b) a translation uses the same {placeholders} as its English text', () => {
  const en = english();
  for (const f of catalogFiles().filter((x) => x !== 'en.json')) {
    const cat = readJson(path.join(CATALOGS, f));
    const bad = Object.keys(cat).filter((k) => k in en && placeholders(cat[k]).join(',') !== placeholders(en[k]).join(','));
    assert.deepEqual(bad, [], `${f}: placeholders differ from en.json:\n${bad.join('\n')}`);
  }
});

// ---- (c) visible text outside t() in the moved files ---------------------------------------------
const TAG_TEXT = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>([^<]*)/g;
const ATTR = /\b(title|placeholder|aria-label|alt)="([^"]*)"/g;
const LETTERS = /[A-Za-zÀ-ÿ]{2,}/;

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

function movedFiles() {
  return MOVED_FILES.flatMap((p) => {
    const abs = path.join(ROOT, ...p.split('/'));
    return p.endsWith('/') ? sourceFiles(abs) : [abs];
  });
}

test('#329 (c) the check itself: catches >Time zone< and literal labels, lets ${...}, entities and opted-out lines through', () => {
  assert.equal(untranslated('const a = `<div class="s-label"><b>Time zone</b></div>`;').length, 1);
  assert.equal(untranslated('const a = `<select aria-label="Time zone"></select>`;').length, 1);
  assert.equal(untranslated('const a = `<input placeholder="Search runs" />`;').length, 1);
  assert.equal(untranslated('const a = `<b>${t(\'settings.tabs.general\')}</b>`;').length, 0);
  assert.equal(untranslated('const a = `<b>${esc(x)}</b> <span>&nbsp;&middot;</span> <i>▶ </i>`;').length, 0);
  assert.equal(untranslated('const a = `<b title="${t(\'a.b\')}" aria-label="${esc(label)}">  </b>`;').length, 0);
  assert.equal(untranslated('const a = `<b>Claude Code</b>`; // i18n-ignore').length, 0);
  assert.equal(untranslated('// <b>Time zone</b> in a comment').length, 0);
  assert.equal(untranslated('const a = `<b>${ok ? `<i>${t(\'a.b\')}</i>` : \'\'}</b>`;').length, 0);
});

test('#329 (c) the files moved to the catalog show no visible text outside t()', () => {
  const files = movedFiles();
  assert.ok(files.length >= 4, `moved files: ${files.map(rel).join(', ')}`);
  const found = files.flatMap((f) => untranslated(fs.readFileSync(f, 'utf8'), rel(f)));
  assert.deepEqual(found, [], `visible text outside t() (move it to en.json, or end the line with // i18n-ignore):\n${found.slice(0, 40).join('\n')}${found.length > 40 ? `\n… ${found.length - 40} more` : ''}`);
});
