// #311: the AI Arena run's right column (<aside class="duo-side">: Documents, Peer scores,
// Supervisor) must never draw one section over another, at any window height and with a long
// document title. There is no layout engine in the unit tests (no Electron, no jsdom), so these
// tests resolve the cascade instead: the arena's own markup (views/arena/arena.js) is parsed into a
// small element tree, every stylesheet index.html loads is parsed in load order, and each element
// gets the declarations a browser would pick (selector matching, specificity, source order,
// !important, shorthands, inherited text properties). @media rules are always applied, so a rule for
// a small window counts too; a theme-scoped selector ([data-theme…]) is taken to match, so a theme
// cannot undo the layout either. The bounding-box check at a short window (criterion 6) is the E2E
// scenario's job: it needs a real renderer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');

// ---------------------------------------------------------------- CSS

function splitTop(text, sep) {
  const out = [];
  let depth = 0, quote = null, cur = '';
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// [{ selectors: [..], decls: [{ prop, value, important }], order }]; at-rule blocks are flattened
// (@media/@supports/@layer applied, @keyframes/@font-face skipped).
function parseCss(css, rules, file) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith('@')) {
      if (/^@(media|supports|layer|container)\b/.test(head)) parseCss(body, rules, file);
    } else if (head) {
      const decls = splitTop(body, ';').map((d) => {
        const k = d.indexOf(':');
        if (k < 0) return null;
        let value = d.slice(k + 1).trim();
        const important = /!\s*important$/i.test(value);
        if (important) value = value.replace(/!\s*important$/i, '').trim();
        return { prop: d.slice(0, k).trim().toLowerCase(), value, important };
      }).filter(Boolean);
      rules.push({ file, selectors: splitTop(head, ',').map((s) => s.trim()).filter(Boolean), decls, order: rules.length });
    }
    i = j;
  }
  return rules;
}

function loadRules() {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.includes('node_modules'));
  assert.ok(hrefs.includes('chat.css') && hrefs.includes('views/arena/arena.css'), 'index.html loads chat.css and the arena stylesheet');
  const rules = [];
  for (const h of hrefs) parseCss(fs.readFileSync(path.join(RENDERER, h), 'utf8'), rules, h);
  return rules;
}

// ---------------------------------------------------------------- markup

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function el(tag, attrs, parent) {
  const node = { tag, attrs, parent, children: [], classes: (attrs.class || '').split(/\s+/).filter(Boolean), id: attrs.id || null };
  if (parent) parent.children.push(node);
  return node;
}

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return attrs;
}

// The arena view's markup (the `markup:` template), mounted under html > body > main.
function loadArena() {
  const src = fs.readFileSync(path.join(RENDERER, 'views', 'arena', 'arena.js'), 'utf8');
  const m = /markup:\s*`([\s\S]*?)`\s*,\s*\n\s*modals:/.exec(src);
  assert.ok(m, 'arena.js has a markup template');
  const markup = m[1].replace(/<!--[\s\S]*?-->/g, '').replace(/\$\{[^}]*\}/g, '');
  const htmlEl = el('html', {}, null);
  const body = el('body', {}, htmlEl);
  let cur = el('main', {}, body);
  for (const t of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, tagRaw, attrSrc, selfClose] = t;
    const tag = tagRaw.toLowerCase();
    if (closing) {
      let n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    const node = el(tag, parseAttrs(attrSrc), cur);
    if (!selfClose && !VOID.has(tag)) cur = node;
  }
  const all = [];
  (function walk(n) { all.push(n); n.children.forEach(walk); })(htmlEl);
  const byId = (id) => all.find((n) => n.id === id);
  const side = all.find((n) => n.tag === 'aside' && n.classes.includes('duo-side'));
  assert.ok(side, 'the arena run has an <aside class="duo-side"> column');
  const sectionOf = (id) => { let n = byId(id); while (n && n.parent !== side) n = n.parent; return n; };
  const docSection = sectionOf('arena-doc-body');
  const boardSection = sectionOf('arena-board');
  const superSection = sectionOf('arena-checks');
  assert.ok(docSection && boardSection && superSection, 'Documents, Peer scores and Supervisor are sections of the column');
  // What the screen renders at run time: a document whose first heading is long, a score row.
  const docBody = byId('arena-doc-body');
  const title = el('h1', {}, docBody);
  el('p', {}, docBody);
  const board = byId('arena-board');
  const row = el('div', { class: 'ar-board-row best' }, board);
  const name = el('span', { class: 'name' }, row);
  const bar = el('span', { class: 'bar' }, row);
  el('i', {}, bar);
  const val = el('span', { class: 'val' }, row);
  return { side, docSection, boardSection, superSection, tabs: byId('arena-doc-tabs'), tabsHead: docSection.children.find((c) => c.classes.includes('duo-side-head')), docBody, title, row, name, bar, val };
}

// ---------------------------------------------------------------- selector matching

function compounds(selector) {
  // [{ comb, compound }] from left to right; comb is the combinator before the compound.
  const parts = [];
  let comb = null, cur = '', depth = 0;
  const flush = () => { if (cur.trim()) { parts.push({ comb, compound: cur.trim() }); comb = null; } cur = ''; };
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && /[\s>+~]/.test(ch)) {
      if (cur.trim()) { flush(); comb = ' '; }
      if (ch !== ' ' && ch !== '\n' && ch !== '\t') comb = ch;
      continue;
    }
    cur += ch;
  }
  flush();
  return parts;
}

function simpleParts(compound) {
  return [...compound.matchAll(/(::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?|#[\w-]+|\.[\w-]+|\[[^\]]*\]|\*|[a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

function prevSiblings(n) { return n.parent ? n.parent.children.slice(0, n.parent.children.indexOf(n)) : []; }

function matchesSimple(n, p) {
  if (p === '*') return true;
  if (p.startsWith('#')) return n.id === p.slice(1);
  if (p.startsWith('.')) return n.classes.includes(p.slice(1));
  if (p.startsWith('[')) {
    if (/theme/i.test(p)) return true; // a theme scope counts as active: it must not undo the layout
    const a = /^\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*["']?([^"'\]]*)["']?)?\s*\]$/.exec(p);
    if (!a || !(a[1] in n.attrs)) return false;
    if (!a[2]) return true;
    const v = n.attrs[a[1]];
    return a[2] === '=' ? v === a[3] : a[2] === '~=' ? v.split(/\s+/).includes(a[3]) : a[2] === '^=' ? v.startsWith(a[3]) : a[2] === '$=' ? v.endsWith(a[3]) : a[2] === '*=' ? v.includes(a[3]) : v === a[3] || v.startsWith(`${a[3]}-`);
  }
  if (p.startsWith('::')) return false;
  if (p.startsWith(':')) {
    const f = /^:([\w-]+)(?:\((.*)\))?$/.exec(p);
    const [name, arg] = [f[1], f[2]];
    const sibs = n.parent ? n.parent.children : [n];
    if (name === 'root') return n.tag === 'html';
    if (name === 'not') return !splitTop(arg, ',').some((s) => matches(n, s.trim()));
    if (name === 'is' || name === 'where' || name === 'matches') return splitTop(arg, ',').some((s) => matches(n, s.trim()));
    if (name === 'has') return false;
    if (name === 'first-child') return sibs[0] === n;
    if (name === 'last-child') return sibs[sibs.length - 1] === n;
    if (name === 'only-child') return sibs.length === 1;
    if (name === 'nth-child' || name === 'nth-of-type') {
      const list = name === 'nth-child' ? sibs : sibs.filter((s) => s.tag === n.tag);
      const idx = list.indexOf(n) + 1;
      const a = arg.trim();
      if (a === 'odd') return idx % 2 === 1;
      if (a === 'even') return idx % 2 === 0;
      const k = /^(-?\d*)n\s*(?:([+-])\s*(\d+))?$/.exec(a);
      if (!k) return idx === Number(a);
      const step = k[1] === '' ? 1 : k[1] === '-' ? -1 : Number(k[1]);
      const off = k[2] ? Number(`${k[2]}${k[3]}`) : 0;
      return step === 0 ? idx === off : (idx - off) / step >= 0 && (idx - off) % step === 0;
    }
    return false; // :hover, :focus, :checked…: a state the column is not in by default
  }
  return n.tag === p.toLowerCase();
}

function matchesCompound(n, compound) { return simpleParts(compound).every((p) => matchesSimple(n, p)); }

function matches(n, selector) {
  const parts = compounds(selector);
  if (!parts.length) return false;
  const at = (node, i) => {
    if (!matchesCompound(node, parts[i].compound)) return false;
    if (i === 0) return true;
    const comb = parts[i].comb;
    if (comb === '>') return !!node.parent && at(node.parent, i - 1);
    if (comb === '+') { const s = prevSiblings(node); return s.length > 0 && at(s[s.length - 1], i - 1); }
    if (comb === '~') return prevSiblings(node).some((s) => at(s, i - 1));
    for (let a = node.parent; a; a = a.parent) if (at(a, i - 1)) return true;
    return false;
  };
  return at(n, parts.length - 1);
}

function specificity(selector) {
  let a = 0, b = 0, c = 0;
  for (const { compound } of compounds(selector)) {
    for (const p of simpleParts(compound)) {
      if (p.startsWith('#')) a++;
      else if (p.startsWith('::')) c++;
      else if (/^:(where)\(/.test(p)) continue;
      else if (/^:(not|is|matches|has)\(/.test(p)) {
        const best = splitTop(p.slice(p.indexOf('(') + 1, -1), ',').map((s) => specificity(s.trim())).sort((x, y) => y - x)[0] || 0;
        a += Math.floor(best / 10000); b += Math.floor((best % 10000) / 100); c += best % 100;
      } else if (p.startsWith('.') || p.startsWith('[') || p.startsWith(':')) b++;
      else if (p !== '*') c++;
    }
  }
  return a * 10000 + b * 100 + c;
}

// ---------------------------------------------------------------- the cascade

function expand(prop, value) {
  const v = value.trim().toLowerCase();
  const tokens = v.split(/\s+/);
  if (prop === 'overflow') return { 'overflow-x': tokens[0], 'overflow-y': tokens[1] || tokens[0] };
  if (prop === 'flex') {
    if (v === 'none') return { 'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto' };
    if (v === 'auto') return { 'flex-grow': '1', 'flex-shrink': '1', 'flex-basis': 'auto' };
    if (v === 'initial') return { 'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto' };
    const num = (t) => /^[\d.]+$/.test(t);
    const out = { 'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': '0%' };
    const nums = tokens.filter(num);
    const basis = tokens.find((t) => !num(t));
    if (nums[0] != null) out['flex-grow'] = nums[0];
    if (nums[1] != null) out['flex-shrink'] = nums[1];
    if (basis) out['flex-basis'] = basis;
    if (!nums.length) out['flex-grow'] = '1';
    return out;
  }
  if (prop === 'flex-flow') {
    const out = {};
    for (const t of tokens) {
      if (/^(nowrap|wrap|wrap-reverse)$/.test(t)) out['flex-wrap'] = t;
      else out['flex-direction'] = t;
    }
    return out;
  }
  if (prop === 'word-wrap') return { 'overflow-wrap': v };
  return { [prop]: v };
}

const INHERITED = ['overflow-wrap', 'word-break', 'white-space'];

const cache = new WeakMap(); // rules → Map(node → style)
function computed(rules, n) {
  if (!cache.has(rules)) cache.set(rules, new Map());
  const memo = cache.get(rules);
  if (!memo.has(n)) memo.set(n, cascade(rules, n));
  return memo.get(n);
}

function cascade(rules, n) {
  const hits = [];
  for (const r of rules) {
    let best = -1;
    for (const s of r.selectors) if (matches(n, s)) best = Math.max(best, specificity(s));
    if (best >= 0) hits.push({ r, spec: best });
  }
  const decls = [];
  for (const { r, spec } of hits) for (const d of r.decls) decls.push({ ...d, spec, order: r.order });
  decls.sort((x, y) => (x.important - y.important) || (x.spec - y.spec) || (x.order - y.order));
  const style = {};
  for (const d of decls) Object.assign(style, expand(d.prop, d.value));
  const parent = n.parent ? computed(rules, n.parent) : {};
  for (const p of INHERITED) if (style[p] == null && parent[p] != null) style[p] = parent[p];
  return style;
}

const isPositiveLength = (v) => !!v && v !== 'auto' && !/^0(px|rem|em|%|vh)?$/.test(v) && !/^-/.test(v);
const shrinks = (s) => s['flex-shrink'] == null || Number(s['flex-shrink']) > 0;
const scrolls = (v) => v === 'auto' || v === 'scroll';
const wraps = (s) => ['anywhere', 'break-word'].includes(s['overflow-wrap']) || ['break-word', 'break-all'].includes(s['word-break']);
const ellipsis = (s) => s['text-overflow'] === 'ellipsis' && s['overflow-x'] && s['overflow-x'] !== 'visible';

function setup() {
  return { rules: loadRules(), arena: loadArena() };
}

// ---------------------------------------------------------------- criterion 1 (and 5)

test('arena side panel (#311): the right column scrolls vertically when its sections are taller than the window', () => {
  const { rules, arena } = setup();
  const s = computed(rules, arena.side);
  assert.ok(scrolls(s['overflow-y']), `.duo-side overflow-y is "${s['overflow-y'] ?? 'visible'}", expected auto or scroll (any theme or @media rule included)`);
  assert.ok(s['min-height'] === '0' || s['min-height'] === '0px' || isPositiveLength(s['max-height']) || isPositiveLength(s.height), 'the column is bounded by its grid row (min-height: 0 or a height), so it scrolls instead of growing');
});

test('arena side panel (#311): Peer scores and Supervisor keep their natural height (never squeezed under the Documents box)', () => {
  const { rules, arena } = setup();
  for (const [label, node] of [['Peer scores (.ar-board-panel)', arena.boardSection], ['Supervisor (.duo-super-panel)', arena.superSection]]) {
    const s = computed(rules, node);
    assert.ok(!shrinks(s), `${label} has flex-shrink ${s['flex-shrink'] ?? '1 (default)'}: expected 0 (flex: none / 0 0 auto / flex-shrink: 0)`);
  }
});

test('arena side panel (#311): the Documents section cannot shrink below its heading and tabs, nor spill over the next section', () => {
  const { rules, arena } = setup();
  const s = computed(rules, arena.docSection);
  const keepsFloor = !shrinks(s) || s['min-height'] == null || s['min-height'] === 'auto' || isPositiveLength(s['min-height']);
  const containsOwn = scrolls(s['overflow-y']);
  assert.ok(keepsFloor || containsOwn,
    `.duo-doc: flex-shrink ${s['flex-shrink'] ?? 1}, min-height ${s['min-height'] ?? 'auto'}, overflow-y ${s['overflow-y'] ?? 'visible'}: `
    + 'expected it not to shrink (flex-shrink 0), a positive min-height, or to scroll its own content');
});

// ---------------------------------------------------------------- criterion 2

test('arena side panel (#311): the document tabs wrap or scroll and never shrink over the "Documents" heading', () => {
  const { rules, arena } = setup();
  const s = computed(rules, arena.tabs);
  assert.ok(s['flex-wrap'] === 'wrap' || scrolls(s['overflow-x']), `#arena-doc-tabs: flex-wrap ${s['flex-wrap'] ?? 'nowrap'}, overflow-x ${s['overflow-x'] ?? 'visible'}`);
  for (const [label, node] of [['#arena-doc-tabs', arena.tabs], ['the Documents heading (.duo-side-head)', arena.tabsHead]]) {
    const n = computed(rules, node);
    assert.ok(!shrinks(n) || n['min-height'] == null || n['min-height'] === 'auto' || isPositiveLength(n['min-height']),
      `${label} can be squeezed to zero height (min-height ${n['min-height']}, flex-shrink ${n['flex-shrink'] ?? 1})`);
  }
});

// ---------------------------------------------------------------- criterion 3

test('arena side panel (#311): a long document title wraps or is clipped inside the document box', () => {
  const { rules, arena } = setup();
  const t = computed(rules, arena.title);
  assert.ok(wraps(t) || ellipsis(t), `the document's first heading: overflow-wrap ${t['overflow-wrap'] ?? 'normal'}, word-break ${t['word-break'] ?? 'normal'}, text-overflow ${t['text-overflow'] ?? 'clip'}`);
  const b = computed(rules, arena.docBody);
  for (const axis of ['overflow-x', 'overflow-y']) {
    assert.ok(b[axis] && b[axis] !== 'visible', `#arena-doc-body ${axis} is ${b[axis] ?? 'visible'}: the document box must contain its content`);
  }
});

// ---------------------------------------------------------------- criterion 4

test('arena side panel (#311): a peer score bar never shrinks to zero width in the 360px column', () => {
  const { rules, arena } = setup();
  const bar = computed(rules, arena.bar);
  const row = computed(rules, arena.row);
  const tracks = row.display === 'grid' && row['grid-template-columns'] ? splitTop(row['grid-template-columns'], ' ').map((x) => x.trim()).filter(Boolean) : [];
  const barTrack = tracks[arena.row.children.indexOf(arena.bar)];
  const trackFloor = !!barTrack && (/^minmax\(\s*([\d.]+)(px|rem|em)/.exec(barTrack)?.[1] > 0 || /^[\d.]+(px|rem|em)$/.test(barTrack) && parseFloat(barTrack) > 0);
  assert.ok(isPositiveLength(bar['min-width']) || (row.display !== 'grid' && !shrinks(bar)) || trackFloor,
    `.ar-board-row .bar: min-width ${bar['min-width'] ?? 'auto'}, flex-shrink ${bar['flex-shrink'] ?? 1}, grid track "${barTrack ?? '-'}": expected a positive minimum width`);
});

test('arena side panel (#311): each peer score row keeps the model name, bar and value on one line', () => {
  const { rules, arena } = setup();
  const row = computed(rules, arena.row);
  assert.ok(row.display === 'grid' || (/flex/.test(row.display || '') && (row['flex-wrap'] ?? 'nowrap') === 'nowrap'), `.ar-board-row display ${row.display}`);
  const name = computed(rules, arena.name);
  assert.equal(name['white-space'], 'nowrap', 'a long model name stays on one line');
  assert.ok(ellipsis(name), 'a long model name ends with an ellipsis instead of pushing the bar');
});
