// #330 the screen text a script builds outside markup follows the interface language too: the check
// of test/untranslated-text.js reads markup (text nodes and the labelled attributes); this one reads
// the code around it, in every .js file of src/renderer and the packages/shared/ modules with screen text:
// - no English plural suffix (`n === 1 ? '' : 's'`): a plural is a catalog entry { one, other } picked
//   by its count;
// - no English word given to t() as a param (`t(key, { value: open ? 'Hide' : 'Show' })`): one key per
//   variant;
// - no English sentence given to a toast, a confirm, a text or a label (`showToast('Saved')`,
//   `el.textContent = 'Empty'`, `el.title = 'Click to open'`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const SHARED = path.join(ROOT, 'packages', 'shared');
const SHARED_SCREEN = ['roadmap-model.js', 'roadmap-summary.js', 'po-calibration.js', 'platforms'];

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'vendor' ? [] : jsFiles(p);
    return /\.jsx?$/.test(e.name) ? [p] : [];
  });
}

const files = () => [
  ...jsFiles(RENDERER),
  ...SHARED_SCREEN.flatMap((p) => (fs.statSync(path.join(SHARED, p)).isDirectory() ? jsFiles(path.join(SHARED, p)) : [path.join(SHARED, p)])),
];

const WORD = "[A-Z][a-z]+(?:[ ,.:;!?…'’-]|$)";
// a quoted phrase with a space in it (a trailing one too): 'draft ', 'a title', 'the platform (x: y)';
// a catalog key, a class name or a separator (' · ') has none, or no word
const PHRASE = "'[\\s.,;:·—-]*[A-Za-z(][A-Za-z()/:,;’-]*\\s[^'$`{}]*'";
const T_PARAMS = "\\bt\\('[\\w.]+',\\s*\\{[^}]*?\\?\\s*";
const RULES = [
  ['an English plural suffix', /[!=]==\s*1\s*\?\s*'(?:s|es)?'\s*:\s*'(?:s|es)?'/],
  ['an English word given to t() as a param', /\bt\('[\w.]+',\s*\{[^}]*?:\s*[^,}]*?\?\s*'[A-Za-z][a-z]+(?: [a-z]+)*'\s*:\s*'[A-Za-z][a-z]+/],
  ['an English phrase given to t() as a param', new RegExp(`${T_PARAMS}(?:${PHRASE}|(?:'[^']*'|[^:?]+?)\\s*:\\s*${PHRASE})`)],
  ['an English sentence in a toast or a confirm', new RegExp(`\\b(?:showToast|confirmDialog)\\(\\s*[\`'"]${WORD}`)],
  ['an English text or label set by code', new RegExp(`\\.(?:textContent|innerText|title|placeholder)\\s*=\\s*[\`'"]${WORD}`)],
];

/** Every line of `src` that breaks a rule, as `file:line: rule: code`. */
function builtEnglish(src, name) {
  const out = [];
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const [rule, re] of RULES) if (re.test(line)) out.push(`${name}:${i + 1}: ${rule}: ${line.trim().slice(0, 140)}`);
  });
  return out;
}

test('#330 the check finds each kind of built English text', () => {
  const bad = [
    "const s = `${n} run${n === 1 ? '' : 's'}`;",
    "x = t('run_list.sessions', { value: open ? 'Hide' : 'Show' });",
    "showToast('Saved the workflow');",
    "confirmDialog(`Remove ${name}?`);",
    "el.textContent = 'Nothing here yet';",
    "btn.title = 'Click to open its run.';",
    // #330 review: an English phrase as a t() param (a trailing space, a one-letter word, parentheses)
    "x = t('backlog.open_value_p_title', { value: p.draft ? 'draft ' : '', p: prName(p) });",
    "x = t('discovery_commit.issue_value_needs_value2', { value: 1, value2: ok ? t('a.b') : 'a title' });",
    "x = t('duo.preview_it', { value: chat.mock ? 'the platform (simulated run: preview only)' : 'GitHub/GitLab' });",
  ];
  assert.deepEqual(bad.map((line) => builtEnglish(line, 'x.js').length), bad.map(() => 1));
  const good = [
    "const s = t('run_list.runs', { count: n });",
    "x = t(open ? 'run_list.hide_sessions' : 'run_list.show_sessions');",
    "showToast(t('workflows.saved'));",
    "el.textContent = '';",
    "el.className = n === 1 ? 'one' : 'many';",
    "x = t('run_list.meta', { sep: n ? ' · ' : '', cls: on ? 'is-on' : 'is-off' });",
    "x = t('backlog.open_value_p_title', { value: p.draft ? t('backlog.draft_prefix') : '' });",
    "x = `<a class=\"badge${p.draft ? ' draft' : ''}\">${t('backlog.pr')}</a>`;",
  ];
  assert.deepEqual(good.flatMap((line) => builtEnglish(line, 'x.js')), []);
});

test('#330 src/renderer and the shared screen modules build no English text outside the catalog', () => {
  const found = files().flatMap((f) => builtEnglish(fs.readFileSync(f, 'utf8'), path.relative(ROOT, f).split(path.sep).join('/')));
  assert.deepEqual(found, []);
});
