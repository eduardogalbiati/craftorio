// A test helper (not a test) for #443 and #437: what a narrow column does to rendered markup, with
// no browser. parseHtml reads the HTML a renderer function returns into a small tree; styleSheet
// cascades the app's stylesheets onto it (computed: classes, ids, tags, attributes, the descendant
// and child combinators, :not() and :first/last/only-child; states such as :hover, pseudo-elements
// and the sibling combinators never match; @media rules count as always on). overflows estimates,
// with a fixed width per character, which elements come out wider than their box (what
// scrollWidth > clientWidth catches in a browser): an unbreakable run of text (nowrap, or a word with
// no break opportunity) wider than its block, a grid or flex item that cannot shrink below its
// content (min-width: auto and overflow visible), an element that clips its text without "…". An
// element that truncates with text-overflow: ellipsis on one nowrap line is the intended cut, not an
// overflow. truncates / canShrink answer "does this element end in … inside its parent".
const fs = require('fs');
const path = require('path');
const { pageDirs, pageFile, pageFiles } = require('../../../scripts/source-tree');
const PAGE_ROOT = path.join(__dirname, '..', '..', '..');
// a page file by its page-relative name, wherever its layer is (phase 3 of the reorganisation study)
const page = (rel) => pageFile(PAGE_ROOT, rel);
void pageDirs; void pageFiles; void page;

const RENDERER = path.join(__dirname, '..');
const CH = 7; // px per character, a 12-13px UI font

// ---- HTML -----------------------------------------------------------------------------------------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, classes: new Set(), children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|(<)/g;
  for (let m; (m = re.exec(String(html)));) {
    if (m[1]) {
      const tag = m[1].toLowerCase();
      let p = cur;
      while (p && p.tag !== tag && p !== root) p = p.parent;
      if (p && p !== root) cur = p.parent;
    } else if (m[2]) {
      const attrs = {};
      for (const a of (m[3] || '').matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1].toLowerCase()] = unesc(a[2] ?? a[3] ?? a[4] ?? '');
      const el = { tag: m[2].toLowerCase(), attrs, classes: new Set((attrs.class || '').split(/\s+/).filter(Boolean)), children: [], parent: cur };
      cur.children.push(el);
      if (!m[4] && !VOID.has(el.tag)) cur = el;
    } else if (m[5] || m[6]) {
      cur.children.push({ text: unesc(m[5] || m[6]), parent: cur });
    }
  }
  return root;
}

const elements = (node) => (node.children || []).filter((c) => c.tag).flatMap((c) => [c, ...elements(c)]);
const textOf = (node) => (node.text != null ? node.text : (node.children || []).map(textOf).join(''));
const isEl = (n) => !!n.tag && n.tag !== '#root';
const describe = (el) => `<${el.tag}${el.classes.size ? `.${[...el.classes].join('.')}` : ''}${el.attrs['data-testid'] ? ` data-testid=${el.attrs['data-testid']}` : ''}> "${textOf(el).replace(/\s+/g, ' ').trim().slice(0, 50)}"`;

// ---- selectors ------------------------------------------------------------------------------------
const COMPOUND = /^(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([^\]]+)\]|(::?)([\w-]+)(\((?:[^()]|\([^()]*\))*\))?/g;

function parseCompound(src) {
  const parts = [];
  let used = 0;
  COMPOUND.lastIndex = 0;
  for (let m; (m = COMPOUND.exec(src));) {
    if (m.index !== used) return null;
    used = COMPOUND.lastIndex;
    if (m[1]) parts.push({ tag: m[1].toLowerCase() });
    else if (m[2]) parts.push({ id: m[2] });
    else if (m[3]) parts.push({ cls: m[3] });
    else if (m[4]) {
      const a = /^\s*([\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(?:i)?)?\s*$/.exec(m[4]);
      if (!a) return null;
      parts.push({ attr: a[1].toLowerCase(), op: a[2] || null, val: a[3] ?? a[4] ?? a[5] ?? '' });
    } else if (m[5] === '::' || ['before', 'after', 'placeholder', 'selection', 'marker', 'first-line', 'first-letter'].includes(m[6])) parts.push({ never: true });
    else if (m[6] === 'not') {
      const inner = m[7].slice(1, -1).split(',').map((s) => parseCompound(s.trim()));
      if (inner.some((x) => !x)) return null;
      parts.push({ not: inner });
    } else if (['first-child', 'last-child', 'only-child'].includes(m[6])) parts.push({ pos: m[6] });
    else parts.push({ never: true });
  }
  return used === src.length && parts.length ? parts : null;
}

function parseSelector(sel) {
  const toks = sel.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
  if (toks.some((x) => x === '+' || x === '~' || /[+~]/.test(x.replace(/\[[^\]]*\]|\([^)]*\)/g, '')))) return null;
  const out = [];
  let comb = ' ';
  for (const tk of toks) {
    if (tk === '>') { comb = '>'; continue; }
    const c = parseCompound(tk);
    if (!c) return null;
    out.push({ comb, compound: c });
    comb = ' ';
  }
  return out.length ? out : null;
}

function specificity(parts) {
  const s = [0, 0, 0];
  const add = (compound) => {
    for (const p of compound) {
      if (p.id) s[0]++;
      else if (p.cls || p.attr || p.pos || p.never) s[1]++;
      else if (p.tag && p.tag !== '*') s[2]++;
      else if (p.not) { let best = [0, 0, 0]; for (const c of p.not) { const x = specificity([{ compound: c }]); if (cmp(x, best) > 0) best = x; } s[0] += best[0]; s[1] += best[1]; s[2] += best[2]; }
    }
  };
  for (const p of parts) add(p.compound);
  return s;
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function matchCompound(el, compound) {
  const siblings = () => el.parent.children.filter(isEl);
  return compound.every((p) => {
    if (p.never) return false;
    if (p.tag) return p.tag === '*' || el.tag === p.tag;
    if (p.id) return el.attrs.id === p.id;
    if (p.cls) return el.classes.has(p.cls);
    if (p.attr) {
      const v = el.attrs[p.attr];
      if (v === undefined) return false;
      switch (p.op) {
        case null: return true;
        case '=': return v === p.val;
        case '~=': return v.split(/\s+/).includes(p.val);
        case '^=': return v.startsWith(p.val);
        case '$=': return v.endsWith(p.val);
        case '*=': return v.includes(p.val);
        case '|=': return v === p.val || v.startsWith(`${p.val}-`);
        default: return false;
      }
    }
    if (p.not) return !p.not.some((c) => matchCompound(el, c));
    if (p.pos) {
      const sib = siblings();
      if (p.pos === 'first-child') return sib[0] === el;
      if (p.pos === 'last-child') return sib[sib.length - 1] === el;
      return sib.length === 1;
    }
    return false;
  });
}

function matches(el, parts, i = parts.length - 1) {
  if (!matchCompound(el, parts[i].compound)) return false;
  if (i === 0) return true;
  if (parts[i].comb === '>') return isEl(el.parent) && matches(el.parent, parts, i - 1);
  for (let p = el.parent; isEl(p); p = p.parent) if (matches(p, parts, i - 1)) return true;
  return false;
}

// ---- the cascade ----------------------------------------------------------------------------------
const INHERITED = ['wrap', 'overflowWrap', 'wordBreak', 'fontFamily'];
const BLOCK_TAGS = new Set(['div', 'section', 'aside', 'article', 'header', 'footer', 'nav', 'main', 'p', 'ul', 'ol', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'form', 'figure', 'figcaption', 'details', 'summary', 'pre', 'blockquote', 'fieldset', 'table', 'hr']);
const DEFAULT_DISPLAY = (tag) => (tag === 'li' ? 'list-item' : BLOCK_TAGS.has(tag) ? 'block' : ['button', 'input', 'select', 'textarea', 'img', 'svg'].includes(tag) ? 'inline-block' : ['script', 'style', 'template'].includes(tag) ? 'none' : 'inline');

function parseDecls(text) {
  return String(text).split(';').map((d) => {
    const i = d.indexOf(':');
    if (i < 0) return null;
    let value = d.slice(i + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    value = value.replace(/!\s*important\s*$/i, '').trim();
    return { prop: d.slice(0, i).trim().toLowerCase(), value, important };
  }).filter((d) => d && d.prop);
}

// files: paths relative to apps/desktop/renderer ('style.css', 'views/run/run.css'), in the page's order
function styleSheet(files) {
  const rules = [];
  let order = 0;
  for (const f of files) {
    const css = fs.readFileSync(page(f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls = parseDecls(m[2]);
      for (const sel of m[1].split(/,(?![^(]*\))/)) {
        const s = sel.trim();
        if (!s || s.startsWith('@')) continue;
        const parts = parseSelector(s);
        if (parts) rules.push({ selector: s, parts, spec: specificity(parts), order: order++, decls, file: f });
      }
    }
  }
  const cache = new WeakMap();

  function apply(st, { prop, value }) {
    const v = value.toLowerCase();
    if (/^(inherit|unset|revert)$/.test(v)) return;
    switch (prop) {
      case 'display': st.display = v.split(/\s+/)[0] === 'flow' ? v.split(/\s+/)[1] || 'block' : v.split(/\s+/)[0]; break;
      case 'white-space': st.wrap = /^(nowrap|pre)$/.test(v) ? 'nowrap' : 'wrap'; break;
      case 'text-wrap': case 'text-wrap-mode': if (/\bnowrap\b/.test(v)) st.wrap = 'nowrap'; else if (/\b(wrap|balance|pretty|stable)\b/.test(v)) st.wrap = 'wrap'; break;
      case 'overflow': st.overflowX = v.split(/\s+/)[0]; break;
      case 'overflow-x': st.overflowX = v; break;
      case 'text-overflow': st.textOverflow = v; break;
      case 'overflow-wrap': case 'word-wrap': st.overflowWrap = v; break;
      case 'word-break': st.wordBreak = v; break;
      case 'min-width': st.minWidth = v; break;
      case 'max-width': st.maxWidth = v; break;
      case 'width': st.width = v; break;
      case 'flex-wrap': st.flexWrap = v; break;
      case 'flex-direction': st.flexDirection = v; break;
      case 'flex-flow': for (const x of v.split(/\s+/)) { if (/wrap/.test(x)) st.flexWrap = x; else if (/row|column/.test(x)) st.flexDirection = x; } break;
      case 'grid-template-columns': st.gridTemplateColumns = v; break;
      case 'font-family': st.fontFamily = v; break;
      case 'padding': { const p = v.split(/\s+/); st.padL = p[p.length === 4 ? 3 : p.length > 1 ? 1 : 0]; st.padR = p[p.length > 1 ? 1 : 0]; break; }
      case 'padding-left': case 'padding-inline-start': case 'padding-inline': st.padL = v.split(/\s+/)[0]; if (prop === 'padding-inline') st.padR = v.split(/\s+/).pop(); break;
      case 'padding-right': case 'padding-inline-end': st.padR = v; break;
      case '-webkit-line-clamp': case 'line-clamp': st.lineClamp = v; break;
      default: break;
    }
  }

  function computed(el) {
    if (!isEl(el)) return { display: 'block', wrap: 'wrap', overflowX: 'visible', overflowWrap: 'normal', wordBreak: 'normal', fontFamily: '' };
    if (cache.has(el)) return cache.get(el);
    const parent = computed(el.parent);
    const st = { display: DEFAULT_DISPLAY(el.tag), overflowX: 'visible', textOverflow: 'clip', minWidth: 'auto', maxWidth: 'none', width: 'auto', flexWrap: 'nowrap', flexDirection: 'row', gridTemplateColumns: 'none', padL: '0', padR: '0', lineClamp: 'none' };
    for (const k of INHERITED) st[k] = parent[k];
    if (el.tag === 'button') st.padL = st.padR = '6px';
    if (el.tag === 'ul' || el.tag === 'ol') st.padL = '40px';
    const found = [];
    for (const r of rules) if (matches(el, r.parts)) for (const d of r.decls) found.push({ ...d, spec: r.spec, order: r.order });
    if (el.attrs.style) for (const d of parseDecls(el.attrs.style)) found.push({ ...d, spec: [1000, 0, 0], order: Infinity });
    found.sort((a, b) => (a.important - b.important) || cmp(a.spec, b.spec) || a.order - b.order);
    for (const d of found) apply(st, d);
    if ('hidden' in el.attrs) st.display = 'none';
    cache.set(el, st);
    return st;
  }
  return { computed, rules };
}

// ---- the estimated layout -------------------------------------------------------------------------
function px(v, base = 0) {
  const s = String(v || '').trim();
  if (s === '0') return 0;
  let m = /^(-?[\d.]+)px$/.exec(s);
  if (m) return Number(m[1]);
  m = /^([\d.]+)r?em$/.exec(s);
  if (m) return Number(m[1]) * 13;
  m = /^([\d.]+)ch$/.exec(s);
  if (m) return Number(m[1]) * CH;
  m = /^([\d.]+)%$/.exec(s);
  if (m) return (Number(m[1]) / 100) * base;
  return null;
}

function layoutOf(sheet) {
  const cs = (el) => sheet.computed(el);
  const pad = (el) => (px(cs(el).padL) || 0) + (px(cs(el).padR) || 0);
  const clips = (el) => /^(hidden|clip|auto|scroll)$/.test(cs(el).overflowX);
  const isFlex = (d) => d === 'flex' || d === 'inline-flex';
  const isGrid = (d) => d === 'grid' || d === 'inline-grid';
  const isBlockLevel = (d) => ['block', 'list-item', 'flex', 'grid', 'table', 'flow-root', '-webkit-box'].includes(d);
  const isAtomic = (d) => ['inline-block', 'inline-flex', 'inline-grid', 'inline-table'].includes(d);
  // a grid or flex item: may it be narrower than its content?
  const itemShrinks = (el) => {
    const parent = el.parent;
    if (isGrid(cs(parent).display) && /minmax\(\s*0/.test(cs(parent).gridTemplateColumns)) return true;
    return px(cs(el).minWidth) !== null || clips(el);
  };
  const breakAnywhere = (el) => /anywhere|break-word/.test(cs(el).overflowWrap) || /break-all|break-word/.test(cs(el).wordBreak);
  const inFlowChildren = (el) => el.children.filter((c) => (isEl(c) ? cs(c).display !== 'none' : true));

  // the width of an atomic inline in a line, its max-width (a % of `avail`) applied
  function atomWidth(el, avail) {
    const mc = minContent(el);
    const max = px(cs(el).maxWidth, avail);
    return max !== null ? Math.min(mc, max) : mc;
  }

  // the widest unbreakable piece of the inline content of `el` (text, inline elements, atomic inlines)
  function inlineRun(el, avail) {
    let widest = 0;
    let run = 0;
    const brk = () => { widest = Math.max(widest, run); run = 0; };
    const walk = (node) => {
      if (node.text != null) {
        const owner = node.parent;
        const nowrap = cs(owner).wrap === 'nowrap';
        const anywhere = !nowrap && breakAnywhere(owner);
        for (const ch of node.text) {
          if (/\s/.test(ch) && ch !== ' ') { if (!nowrap) { brk(); continue; } run += CH; continue; }
          run += CH;
          if (anywhere) { widest = Math.max(widest, CH); run = 0; } else if (ch === '-' && !nowrap) brk();
        }
        return;
      }
      const d = cs(node).display;
      if (d === 'none') return;
      if (isBlockLevel(d)) { brk(); return; }
      if (isAtomic(d) || node.tag === 'svg' || node.tag === 'img') {
        brk();
        run = node.tag === 'svg' || node.tag === 'img' ? Number(node.attrs.width) || 12 : atomWidth(node, avail);
        brk();
        return;
      }
      node.children.forEach(walk);
    };
    el.children.forEach(walk);
    brk();
    return widest;
  }

  // the narrowest the element can be without its content spilling (its min-content width)
  function minContent(el) {
    if (!isEl(el)) return inlineRunOfText(el);
    const s = cs(el);
    if (s.display === 'none') return 0;
    if (el.tag === 'svg' || el.tag === 'img') return Number(el.attrs.width) || 12;
    const w = px(s.width);
    if (w !== null) return w;
    const kids = inFlowChildren(el);
    let inner;
    if (isFlex(s.display)) {
      const items = kids.map((c) => minContent(c));
      inner = /column/.test(s.flexDirection) || /wrap/.test(s.flexWrap) && s.flexWrap !== 'nowrap' ? Math.max(0, ...items) : items.reduce((a, b) => a + b, 0);
    } else if (isGrid(s.display)) {
      inner = Math.max(0, ...kids.filter(isEl).map((c) => (itemShrinks(c) ? Math.max(0, px(cs(c).minWidth) || 0) : minContent(c))));
    } else {
      const blocks = kids.filter((c) => isEl(c) && isBlockLevel(cs(c).display)).map(minContent);
      const nested = elements(el).filter((c) => isBlockLevel(cs(c).display) && !isBlockLevel(cs(c.parent).display) && c.parent !== el);
      inner = Math.max(inlineRun(el, Infinity), 0, ...blocks, ...nested.map(minContent));
    }
    return inner + pad(el);
  }
  // a text child of a flex or grid container (an anonymous item)
  function inlineRunOfText(node) {
    return inlineRun({ children: [node], tag: '#anon' }, Infinity);
  }

  // does the element end its text in "…" on one line (clipped, ellipsis, nowrap, not inline)?
  function truncates(el) {
    const s = cs(el);
    const pd = cs(el.parent).display;
    const blockified = isFlex(pd) || isGrid(pd); // a flex or grid item is a block whatever its display
    return clips(el) && s.textOverflow === 'ellipsis' && s.wrap === 'nowrap' && (s.display !== 'inline' || blockified);
  }

  // can the element be as narrow as its parent's box, whatever its content? (a block in block flow, a
// grid/flex item with min-width 0 or overflow hidden, an inline-block with a max-width, an inline)
  function canShrink(el) {
    const pd = cs(el.parent).display;
    if (isFlex(pd) || isGrid(pd)) return itemShrinks(el);
    const d = cs(el).display;
    if (isBlockLevel(d)) return true;
    if (isAtomic(d)) return px(cs(el).maxWidth, 100) !== null;
    return true; // an inline element: no box of its own, its content follows the block around it
  }

  // the elements of `el` that come out wider than their box when `el` gets `width` px
  function overflows(el, width) {
    const out = [];
    const visit = (node, avail) => {
      const s = cs(node);
      if (s.display === 'none') return;
      const content = Math.max(0, avail - pad(node));
      if (!isFlex(s.display) && !isGrid(s.display)) {
        const run = inlineRun(node, content);
        if (run > content + 0.5 && s.display !== 'inline') {
          if (truncates(node)) { /* the intended cut: … and its title */ } else if (clips(node) && s.lineClamp !== 'none') { /* clamped prose */ } else out.push(`${describe(node)}: an unbreakable line of ${Math.round(run)}px in a ${Math.round(content)}px box${clips(node) ? ' (cut without …)' : ''}`);
        }
      }
      const kids = inFlowChildren(node);
      if (isGrid(s.display) || isFlex(s.display)) {
        const row = isFlex(s.display) && !/column/.test(s.flexDirection);
        const wraps = /wrap/.test(s.flexWrap) && s.flexWrap !== 'nowrap';
        let sum = 0;
        for (const c of kids) {
          const shrinks = isEl(c) && itemShrinks(c);
          const need = shrinks ? 0 : minContent(c);
          sum += need;
          if (need > content + 0.5 && (isGrid(s.display) || row || !isEl(c))) out.push(`${isEl(c) ? describe(c) : `text "${c.text.trim().slice(0, 50)}"`}: a ${isGrid(s.display) ? 'grid' : 'flex'} item that cannot shrink below ${Math.round(need)}px (min-width: auto), in a ${Math.round(content)}px box`);
          if (isEl(c)) visit(c, content);
        }
        if (row && !wraps && sum > content + 0.5 && kids.length > 1) out.push(`${describe(node)}: its flex items need ${Math.round(sum)}px on one line (no flex-wrap), in a ${Math.round(content)}px box`);
        return;
      }
      const walk = (n) => {
        for (const c of n.children.filter(isEl)) {
          const d = cs(c).display;
          if (d === 'none') continue;
          if (isBlockLevel(d)) visit(c, content);
          else if (isAtomic(d)) visit(c, Math.min(content, atomWidth(c, content)) || content);
          else walk(c);
        }
      };
      walk(node);
    };
    visit(el, width);
    return out;
  }

  return { overflows, truncates, canShrink, minContent, computed: cs };
}

module.exports = { parseHtml, styleSheet, layoutOf, elements, textOf, describe, CH };
