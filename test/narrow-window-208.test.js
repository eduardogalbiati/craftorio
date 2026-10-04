// #208: the app never shifts sideways in a narrow window (the owner's: 1069 px) when the Oracle
// opens, and the Oracle's header stays readable. There is no layout engine in node:test, so these
// are source-level checks of what keeps it so:
// - every programmatic focus() in the renderer passes { preventScroll: true } (a focused field
//   inside a clipped container must not scroll the page: overflow: hidden still scrolls
//   programmatically). xterm's `term.focus()` (a Terminal object, not a DOM element; it takes no
//   options) is left out;
// - `body` and `.shell` use overflow: clip (never scrolls, even programmatically);
// - `.topbar` wraps (flex-wrap: wrap; min-width: 0) instead of growing wider than the window;
// - `.oracle-head` wraps its buttons onto a second line and its title ends with an ellipsis;
// - scripts/screenshot.js takes a window size (--size 1069x800) to capture the narrow case.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../scripts/screenshot');

const root = path.join(__dirname, '..');
const renderer = path.join(root, 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

// ---- a tiny CSS reader: comments stripped, every `selectors { declarations }` block (rules inside
// an @media block included, flagged media: true) -------------------------------------------------
function cssRules(text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = []; // the open @-blocks' preludes
  let buf = '';
  for (const ch of css) {
    if (ch === '{') {
      const prelude = buf.trim();
      buf = '';
      if (prelude.startsWith('@')) { stack.push(prelude); continue; }
      stack.push({ prelude });
    } else if (ch === '}') {
      const open = stack.pop();
      if (open && typeof open === 'object') {
        const decls = {};
        for (const d of buf.split(';')) {
          const i = d.indexOf(':');
          if (i > 0) decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim().replace(/\s*!important$/, '');
        }
        const selectors = open.prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
        rules.push({ selectors, decls, media: stack.length > 0 });
      }
      buf = '';
    } else buf += ch;
  }
  return rules;
}
// every value a property takes in the top-level rules whose selector list has exactly `selector`
const valuesOf = (rules, selector, prop) => rules
  .filter((r) => !r.media && r.selectors.includes(selector) && prop in r.decls)
  .map((r) => r.decls[prop]);

const styleRules = cssRules(read(renderer, 'style.css'));
const oracleRules = cssRules(read(renderer, 'views', 'oracle', 'oracle.css'));

// ---- focus({ preventScroll: true }) ---------------------------------------------------------

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(p) : e.name.endsWith('.js') ? [p] : [];
  });
}
// `file:line` of every `.focus()` called with no argument (xterm's term.focus() excepted)
function bareFocusCalls(files) {
  const out = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      const bare = code.match(/(\w*)\??\.focus\(\s*\)/g) || [];
      if (bare.some((call) => !/^term\??\.focus/.test(call))) out.push(`${path.relative(root, f).replace(/\\/g, '/')}:${i + 1}`);
    });
  }
  return out;
}

test('#208 the Oracle (views/oracle/oracle.js) never focuses a field without { preventScroll: true }', () => {
  const offenders = bareFocusCalls([path.join(renderer, 'views', 'oracle', 'oracle.js')]);
  assert.deepEqual(offenders, [], `bare focus() calls (use focus({ preventScroll: true })):\n${offenders.join('\n')}`);
});

test('#208 no renderer script calls focus() without { preventScroll: true } (xterm term.focus() excepted)', () => {
  const offenders = bareFocusCalls(jsFiles(renderer));
  assert.deepEqual(offenders, [], `bare focus() calls (use focus({ preventScroll: true })):\n${offenders.join('\n')}`);
});

// ---- the page and the shell never scroll sideways -------------------------------------------

test('#208 style.css: body uses overflow: clip, never overflow: hidden', () => {
  const values = valuesOf(styleRules, 'body', 'overflow');
  assert.ok(values.length, 'body declares its overflow');
  assert.deepEqual(values, values.map(() => 'clip'));
});

test('#208 style.css: .shell uses overflow: clip, never overflow: hidden', () => {
  const values = valuesOf(styleRules, '.shell', 'overflow');
  assert.ok(values.length, '.shell declares its overflow');
  assert.deepEqual(values, values.map(() => 'clip'));
});

test('#208 style.css: .topbar wraps onto a second line (flex-wrap: wrap; min-width: 0) instead of growing wider than the window', () => {
  assert.ok(valuesOf(styleRules, '.topbar', 'flex-wrap').includes('wrap'), '.topbar has flex-wrap: wrap');
  assert.ok(valuesOf(styleRules, '.topbar', 'min-width').includes('0'), '.topbar has min-width: 0');
});

// ---- the Oracle's header ---------------------------------------------------------------------

test('#208 oracle.css: the Oracle header (.oracle-head) wraps its buttons onto a second line', () => {
  const wraps = oracleRules.some((r) => r.selectors.some((s) => /(^|[^\w-])\.oracle-head$/.test(s.replace(/^\.drawer-head(?=\.oracle-head$)/, ''))) && r.decls['flex-wrap'] === 'wrap');
  assert.ok(wraps, 'a .oracle-head (or .drawer-head.oracle-head) rule with flex-wrap: wrap');
});

test('#208 the Oracle header\'s title ends with an ellipsis when it does not fit', () => {
  // either a rule for the title inside the head, or a class on the title whose rule cuts it
  const titleRule = oracleRules.some((r) => r.selectors.some((s) => /\.oracle-(head|who)\b.*(\.drawer-title|\bh2\b)|\.oracle-title\b/.test(s)) && r.decls['text-overflow'] === 'ellipsis');
  const oracleSrc = read(renderer, 'views', 'oracle', 'oracle.js');
  const h2 = /<h2 class="([^"]*)"[^>]*>Oracle<\/h2>/.exec(oracleSrc);
  const classes = h2 ? h2[1].split(/\s+/).filter((c) => c !== 'drawer-title') : [];
  const classRule = classes.some((c) => [...oracleRules, ...styleRules].some((r) => r.selectors.includes(`.${c}`) && r.decls['text-overflow'] === 'ellipsis'));
  assert.ok(titleRule || classRule, 'the "Oracle" title gets text-overflow: ellipsis');
});

// ---- the screenshot script captures the narrow case -----------------------------------------

test('#208 screenshot --size 1069x800 sets the window to 1069 by 800; a size that is not WIDTHxHEIGHT is refused', () => {
  assert.deepEqual(parseArgs(['--view', 'dashboard', '--size', '1069x800']).size, [1069, 800]);
  assert.throws(() => parseArgs(['--view', 'dashboard', '--size', 'abc']), /WIDTHxHEIGHT/);
});
