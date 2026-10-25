// The diff viewer's pure part (#118), no DOM (diff-viewer.js draws it; unit-testable in Node):
// - parsePatch: one file's unified patch -> its hunks, each line numbered on the old and new side;
// - rows: the unified rows of a file (hunk headers, lines, and the collapsed unchanged regions
//   between hunks, "gaps", partly or fully expanded from both sides' contents);
// - splitRows: the same rows aligned side by side (a block of removed lines next to the added
//   lines that follow it), so split and unified show the same hunks;
// - wordDiff: the changed span inside a removed/added pair (word-level highlights);
// - highlightHtml: a line's HTML with light syntax highlighting by file type and the changed spans;
// - groupByFolder, fileIcon: the left list's folders and the added / modified / deleted / renamed icons.
(() => {
  const EXPAND_STEP = 20;

  // { hunks: [{ header, oldStart, newStart, lines: [{ type: ' ' | '-' | '+', text, oldNo, newNo }] }], binary }
  function parsePatch(patch) {
    const hunks = [];
    let h = null;
    let o = 0;
    let n = 0;
    const binary = /^Binary files .* differ$/m.test(String(patch || '')) || /^GIT binary patch$/m.test(String(patch || ''));
    for (const raw of String(patch || '').split('\n')) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
      if (m) {
        h = { header: line, section: m[5].trim(), oldStart: +m[1], oldLines: m[2] == null ? 1 : +m[2], newStart: +m[3], newLines: m[4] == null ? 1 : +m[4], lines: [] };
        hunks.push(h);
        o = h.oldStart;
        n = h.newStart;
        continue;
      }
      if (!h || line.startsWith('\\')) continue; // file header lines, "\ No newline at end of file"
      const t = line[0];
      if (t === ' ' || (t === undefined && raw === '')) {
        if (t === undefined && (o >= h.oldStart + h.oldLines && n >= h.newStart + h.newLines)) continue; // the patch's trailing newline
        h.lines.push({ type: ' ', text: line.slice(1), oldNo: o++, newNo: n++ });
      } else if (t === '-') h.lines.push({ type: '-', text: line.slice(1), oldNo: o++, newNo: null });
      else if (t === '+') h.lines.push({ type: '+', text: line.slice(1), oldNo: null, newNo: n++ });
    }
    return { hunks, binary };
  }

  const splitLines = (s) => (s == null ? null : String(s).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));

  // The unchanged region before hunk i (i = hunks.length: after the last one), in both numberings.
  // length null: unknown (after the last hunk without the file's contents).
  function gapOf(hunks, i, newCount) {
    const prev = hunks[i - 1];
    const next = hunks[i];
    // a side without lines in a hunk (-4,0 / +4,0) names the line before it, not its first line
    const oldFrom = prev ? prev.oldStart + prev.oldLines + (prev.oldLines ? 0 : 1) : 1;
    const newFrom = prev ? prev.newStart + prev.newLines + (prev.newLines ? 0 : 1) : 1;
    const newTo = next ? next.newStart - (next.newLines ? 0 : -1) : newCount == null ? null : newCount + 1;
    const length = newTo == null ? null : Math.max(0, newTo - newFrom);
    return { index: i, oldFrom, newFrom, length };
  }

  // The unified rows of a file: { kind: 'hunk', header } / { kind: 'line', type, text, oldNo, newNo }
  // / { kind: 'gap', index, hidden, up, down } (the buttons that apply: up reveals the lines above
  // the next hunk, down the ones below the previous hunk; hidden null: unknown, the contents are not
  // loaded). contents: { before, after } texts or null; expanded: { [gapIndex]: { top, bottom } }
  // (Infinity: all).
  function rows(parsed, contents = null, expanded = {}) {
    const hunks = parsed?.hunks || [];
    const out = [];
    if (!hunks.length) return out;
    const after = splitLines(contents?.after);
    const before = splitLines(contents?.before);
    const newCount = after ? after.length : before && hunks.every((h) => !h.newLines) ? 0 : null;
    const textAt = (g, k) => (after ? after[g.newFrom - 1 + k] : before ? before[g.oldFrom - 1 + k] : undefined);
    const emitGap = (i) => {
      const g = gapOf(hunks, i, newCount);
      if (g.length === 0) return;
      const e = expanded[i] || {};
      const known = g.length != null && (after || before);
      if (!known) {
        // without the contents: one collapsed row (the region's size when it is known)
        out.push({ kind: 'gap', index: i, hidden: g.length, up: i < hunks.length, down: i > 0, all: true, unknown: true });
        return;
      }
      const top = i === 0 ? 0 : Math.min(e.top || 0, g.length);
      const bottom = i === hunks.length ? 0 : Math.min(e.bottom || 0, g.length - top);
      const line = (k) => ({ kind: 'line', type: ' ', text: textAt(g, k) ?? '', oldNo: g.oldFrom + k, newNo: g.newFrom + k, expanded: true });
      for (let k = 0; k < top; k++) out.push(line(k));
      const hidden = g.length - top - bottom;
      if (hidden > 0) out.push({ kind: 'gap', index: i, hidden, up: i < hunks.length, down: i > 0, all: true });
      for (let k = g.length - bottom; k < g.length; k++) out.push(line(k));
    };
    hunks.forEach((h, i) => {
      emitGap(i);
      out.push({ kind: 'hunk', header: h.header, section: h.section, index: i });
      for (const l of h.lines) out.push({ kind: 'line', ...l });
    });
    emitGap(hunks.length);
    return out;
  }

  // A gap's new expansion: dir 'up' | 'down' | 'all'.
  function expand(expanded, index, dir) {
    const e = { ...(expanded[index] || {}) };
    if (dir === 'all') { e.top = Infinity; e.bottom = Infinity; } // the region before the first hunk only has a bottom
    else if (dir === 'down') e.top = (e.top || 0) + EXPAND_STEP;
    else e.bottom = (e.bottom || 0) + EXPAND_STEP;
    return { ...expanded, [index]: e };
  }

  // The unified rows side by side: { kind: 'pair', left, right } (a side null: blank), hunks and gaps
  // across both. A run of removed lines is paired with the run of added lines right after it.
  function splitRows(list) {
    const out = [];
    for (let i = 0; i < list.length;) {
      const r = list[i];
      if (r.kind !== 'line') { out.push(r); i++; continue; }
      if (r.type === ' ') { out.push({ kind: 'pair', left: r, right: r }); i++; continue; }
      const del = [];
      const add = [];
      while (i < list.length && list[i].kind === 'line' && list[i].type === '-') del.push(list[i++]);
      while (i < list.length && list[i].kind === 'line' && list[i].type === '+') add.push(list[i++]);
      out.push(...pairBlock(del, add));
    }
    return out;
  }

  // A removed line next to the first added line like it (wordDiff finds a shared part), in order;
  // the lines left over are paired by position (a lone removed line next to a lone added one).
  function pairBlock(del, add) {
    const like = (a, b) => { const w = wordDiff(a.text, b.text); return !!(w.a.length || w.b.length); };
    const rowsOut = [];
    let j = 0;
    for (const d of del) {
      let m = j;
      while (m < add.length && !like(d, add[m])) m++;
      if (m === add.length) { rowsOut.push({ kind: 'pair', left: d, right: null }); continue; }
      for (; j < m; j++) rowsOut.push({ kind: 'pair', left: null, right: add[j] });
      rowsOut.push({ kind: 'pair', left: d, right: add[m] });
      j = m + 1;
    }
    for (; j < add.length; j++) rowsOut.push({ kind: 'pair', left: null, right: add[j] });
    const merged = [];
    for (const r of rowsOut) {
      const last = merged[merged.length - 1];
      if (last && last.left && !last.right && !r.left && r.right) last.right = r.right;
      else merged.push(r);
    }
    return merged;
  }

  // The removed/added pairs of a list of rows (the same pairing as splitRows): Map row -> its partner.
  function partners(list) {
    const map = new Map();
    for (const p of splitRows(list)) if (p.kind === 'pair' && p.left && p.right && p.left !== p.right) { map.set(p.left, p.right); map.set(p.right, p.left); }
    return map;
  }

  const TOKEN_RE = /\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g;
  // The changed span of a and of b, as [start, end) character ranges ([] when equal or no overlap
  // worth showing): the common token prefix and suffix are left out.
  function wordDiff(a, b) {
    const ta = String(a).match(TOKEN_RE) || [];
    const tb = String(b).match(TOKEN_RE) || [];
    let p = 0;
    while (p < ta.length && p < tb.length && ta[p] === tb[p]) p++;
    let s = 0;
    while (s < ta.length - p && s < tb.length - p && ta[ta.length - 1 - s] === tb[tb.length - 1 - s]) s++;
    // little in common besides whitespace and punctuation: the whole line changed, nothing to point at
    const common = [...ta.slice(0, p), ...ta.slice(ta.length - s)].join('').replace(/[\s\W]/g, '').length;
    if (common < 2) return { a: [], b: [] };
    const span = (t) => {
      const start = t.slice(0, p).join('').length;
      const end = t.join('').length - t.slice(t.length - s).join('').length;
      return end > start ? [[start, end]] : [];
    };
    return { a: span(ta), b: span(tb) };
  }

  // Light syntax highlighting: comments, strings, numbers and keywords, by file extension.
  const KEYWORDS = {
    c: 'abstract as async await break case catch class const continue default delete do else enum export extends false final finally for from func function go if implements import in instanceof interface let new nil null package private protected public return static struct super switch this throw true try type typeof undefined using var void while yield',
    py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield',
    sh: 'case do done elif else esac exit export fi for function if in local return then until while',
  };
  const LANG = {
    js: 'c', mjs: 'c', cjs: 'c', ts: 'c', tsx: 'c', jsx: 'c', java: 'c', cs: 'c', go: 'c', c: 'c', h: 'c', cpp: 'c', rs: 'c', kt: 'c', swift: 'c', php: 'c', css: 'css', scss: 'css',
    py: 'py', rb: 'py', sh: 'sh', bash: 'sh', ps1: 'sh', yml: 'yaml', yaml: 'yaml', toml: 'yaml', json: 'json', md: 'md', html: 'html', xml: 'html', svg: 'html',
  };
  const langOf = (file) => LANG[String(file || '').toLowerCase().split('.').pop()] || null;
  const RULES = {
    c: [['cmt', /\/\/.*|\/\*.*?(?:\*\/|$)/y], ['str', /"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|`(?:\\.|[^`\\])*`?/y]],
    css: [['cmt', /\/\*.*?(?:\*\/|$)/y], ['str', /"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?/y], ['kw', /[a-z-]+(?=\s*:)/y]],
    py: [['cmt', /#.*/y], ['str', /"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?/y]],
    sh: [['cmt', /#.*/y], ['str', /"(?:\\.|[^"\\])*"?|'[^']*'?/y]],
    yaml: [['cmt', /#.*/y], ['str', /"(?:\\.|[^"\\])*"?|'[^']*'?/y], ['kw', /[\w.-]+(?=\s*[:=](?:\s|$))/y]],
    json: [['kw', /"(?:\\.|[^"\\])*"(?=\s*:)/y], ['str', /"(?:\\.|[^"\\])*"?/y]],
    md: [['kw', /#{1,6} .*/y], ['str', /`[^`]*`?/y]],
    html: [['cmt', /<!--.*?(?:-->|$)/y], ['str', /"[^"]*"?|'[^']*'?/y], ['kw', /<\/?[\w:-]+|\/?>/y]],
  };

  // [{ text, cls }] of a line: cls '' | 'cmt' | 'str' | 'num' | 'kw'.
  function tokens(text, file) {
    const lang = langOf(file);
    const s = String(text);
    if (!lang) return [{ text: s, cls: '' }];
    const rules = RULES[lang] || [];
    const kw = KEYWORDS[lang === 'yaml' || lang === 'json' || lang === 'css' || lang === 'md' || lang === 'html' ? '' : lang];
    const words = kw ? new Set(kw.split(' ')) : null;
    const out = [];
    const push = (t, cls) => { if (out.length && out[out.length - 1].cls === cls) out[out.length - 1].text += t; else out.push({ text: t, cls }); };
    let i = 0;
    outer: while (i < s.length) {
      for (const [cls, re] of rules) {
        re.lastIndex = i;
        const m = re.exec(s);
        if (m && m[0]) { push(m[0], cls); i += m[0].length; continue outer; }
      }
      const w = /[A-Za-z_$][\w$]*|\d[\w.]*/y;
      w.lastIndex = i;
      const m = w.exec(s);
      if (m) { push(m[0], /^\d/.test(m[0]) ? 'num' : words?.has(m[0]) ? 'kw' : ''); i += m[0].length; continue; }
      push(s[i], '');
      i++;
    }
    return out;
  }

  const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // A line's HTML: its tokens (span.hl-<cls>) with the changed ranges wrapped in mark.dv-word.
  function highlightHtml(text, file, ranges = []) {
    let pos = 0;
    let html = '';
    for (const t of tokens(text, file)) {
      let k = 0;
      while (k < t.text.length) {
        const at = pos + k;
        const r = ranges.find(([a, b]) => at >= a && at < b);
        const stop = r ? r[1] : Math.min(...ranges.map(([a]) => a).filter((a) => a > at), Infinity);
        const piece = t.text.slice(k, Math.min(t.text.length, stop - pos));
        const inner = t.cls ? `<span class="hl-${t.cls}">${escHtml(piece)}</span>` : escHtml(piece);
        html += r ? `<mark class="dv-word">${inner}</mark>` : inner;
        k += piece.length;
      }
      pos += t.text.length;
    }
    return html;
  }

  // The left list: [{ folder, files }] by folder ('' = the repository's root), sorted.
  function groupByFolder(files) {
    const map = new Map();
    for (const f of [...files].sort((a, b) => a.file.localeCompare(b.file))) {
      const cut = f.file.lastIndexOf('/');
      const folder = cut < 0 ? '' : f.file.slice(0, cut);
      if (!map.has(folder)) map.set(folder, []);
      map.get(folder).push(f);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([folder, list]) => ({ folder, files: list }));
  }

  // The status icon and label of a file (GitHub's: + added, ± modified, − deleted, → renamed).
  const ICONS = { added: ['+', 'Added'], modified: ['±', 'Modified'], deleted: ['−', 'Deleted'], renamed: ['→', 'Renamed'], reported: ['•', 'Reported by the developer'] };
  const fileIcon = (status) => ICONS[status] || ICONS.modified;

  const api = { EXPAND_STEP, expand, fileIcon, groupByFolder, highlightHtml, langOf, parsePatch, partners, rows, splitRows, tokens, wordDiff };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DiffViewerModel = api;
})();
