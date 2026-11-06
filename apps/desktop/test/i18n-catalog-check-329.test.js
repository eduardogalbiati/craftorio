// #329 the untranslated-text check (a permanent guard, written before the code). It fails when:
// (a) code uses a key missing from packages/shared/i18n/en.json: every `t('a.key')` / `I18n.t('a.key')` with a
//     literal dotted first argument in src/ (.js, .jsx; node_modules and vendor folders left out);
// (b) a catalog of packages/shared/i18n/ has keys en.json does not (the message lists them), a plural has no
//     `other` form, or a translation's {placeholders} differ from the English ones;
// (c) a file already moved to the catalog (MOVED_FILES) shows visible text outside t() in its HTML
//     templates: a text node `>Some words<` or a literal title= / placeholder= / aria-label= / alt=
//     value with letters. `${...}` content, entities, symbols and whitespace are not text; a line ending
//     with `// i18n-ignore` opts out (a product name, a code sample).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { report, sourceFiles, untranslated } = require('./untranslated-text');

const ROOT = path.join(__dirname, '..', '..', '..');
const { sourceFiles: allSources } = require('../../../scripts/source-tree');
const CATALOGS = path.join(ROOT, 'packages', 'shared', 'i18n');

// The files whose visible text lives in the catalog (a folder: every .js in it). #330 grows this list.
const MOVED_FILES = [
  'packages/ui-kit/setup.js',
  'packages/ui-kit/views/settings/',
];

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const english = () => readJson(path.join(CATALOGS, 'en.json'));
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

// ---- (a) keys used in code ----------------------------------------------------------------------
const KEY_CALL = /(?:\bI18n\.t|(?<![\w$.])t)\(\s*(['"`])([a-z][\w-]*(?:\.[\w-]+)+)\1/g;

function usedKeys() {
  const used = new Map(); // key → first 'file:line'
  for (const file of allSources(ROOT).map((f) => path.join(ROOT, ...f.split('/')))) {
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

// #437: a status pill's label (status_pill.status_*) of any language fits a pill on one line: at most
// STATUS_LABEL_MAX characters, so pt-BR reads as short as English ("Rodando", not "Em execução").
const STATUS_LABEL_MAX = 16;
// #797: the one exception, its text set by the issue ("Aguardando merge do PR"); only the Roadmap's card
// draws it, on a line of its own that wraps (.rm-status-line), and the pill still keeps one line
const STATUS_LABEL_LONGER = new Set(['status_pill.status_waiting_merge']);
const statusLabelsTooLong = (catalog) => Object.entries(catalog)
  .filter(([k]) => k.startsWith('status_pill.status_') && !STATUS_LABEL_LONGER.has(k))
  .flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : Object.values(v || {}).map((s) => [k, s])))
  .filter(([, s]) => [...String(s)].length > STATUS_LABEL_MAX)
  .map(([k, s]) => `${k}: "${s}" (${[...String(s)].length} > ${STATUS_LABEL_MAX})`);

test('#437 the length rule itself: a status pill label over 16 characters is reported, 16 or fewer is not', () => {
  assert.deepEqual(statusLabelsTooLong({ 'status_pill.status_success': 'Concluído com sucesso', 'status_pill.status_running': 'Rodando', 'status_pill.status_waiting': 'Esperando você 16' }),
    ['status_pill.status_success: "Concluído com sucesso" (21 > 16)', 'status_pill.status_waiting: "Esperando você 16" (17 > 16)']);
  assert.deepEqual(statusLabelsTooLong({ 'status_pill.status_parked': 'Parado no gate', 'other.key': 'A long text that is not a status pill label' }), []);
});

test('#437 every status pill label (status_pill.status_*) of every catalog has at most 16 characters', () => {
  const files = catalogFiles();
  assert.ok(files.includes('pt-BR.json'), `catalogs: ${files.join(', ')}`);
  for (const f of files) {
    const cat = readJson(path.join(CATALOGS, f));
    assert.ok(Object.keys(cat).some((k) => k.startsWith('status_pill.status_')), `${f} has no status pill labels`);
    const long = statusLabelsTooLong(cat);
    assert.deepEqual(long, [], `${f}: status pill labels longer than ${STATUS_LABEL_MAX} characters:\n${long.join('\n')}`);
  }
});

// ---- (c) visible text outside t() in the moved files ---------------------------------------------
// the checker itself lives in test/untranslated-text.js (#330 runs it over the whole renderer)

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
  assert.deepEqual(found, [], report(found));
});
