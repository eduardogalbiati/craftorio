// The project's public page (site/, built by scripts/site.js into build/site/ and published by
// .github/workflows/pages.yml): loads docs/work/<item>/*.md and CHANGELOG.md at runtime and renders them
// (marked + DOMPurify from cdnjs). The markdown is the only source; nothing here is generated ahead of time.
// Pages: index.html (Overview, Work, Changelog) and item.html?item=<slug>[#stage|#section-id].
// Theme: front matter of docs/work/README.md (theme, accent, background, *_dark), plus a per-viewer
// preview override kept in localStorage. No window.api, no eval, no inline HTML from the markdown
// survives sanitizing; relative links/images resolve inside the item's folder only.
(function () {
  'use strict';
  var BASE = '', ROOT = 'docs/work/';
  var STAGES = [
    { f: 'intent', name: 'Plan', fills: 'Written by a person (or Grill me) and accepted by the product owner.' },
    { f: 'spec', name: 'Design', fills: 'Written from the accepted intent and signed off by the product owner.' },
    { f: 'plan', name: 'Build', fills: 'Written by the engineer; its Progress table is filled by the Code & Build runs.' },
    { f: 'test', name: 'Test', fills: 'Created by the first Build run: suite, E2E, screenshots and evals.' },
    { f: 'deploy', name: 'Deploy', fills: 'Created by the review, the PR and the release workflow.' },
    { f: 'maintain', name: 'Maintain', fills: 'Created by the Monitor and the Night watch after the release.' }
  ];
  var OK = /^(accepted|signed off|approved|done|passed|merged|released|shipped|resolved)$/;
  var NONE = /^(not started|no incidents|missing)$/;
  var BAD = /^(rejected|failed|blocked)$/;
  var WORKING = /^(draft|in progress|writing|running)$/;
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem('sdlc-reader:' + k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('sdlc-reader:' + k, JSON.stringify(v)); } catch (e) { /* private window */ } },
    del: function (k) { try { localStorage.removeItem('sdlc-reader:' + k); } catch (e) { /* ignore */ } }
  };
  function itemHref(name) { return 'item.html?item=' + encodeURIComponent(name); }
  var HOME = './';

  // ---------- markdown ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function slug(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  // a front-matter date (2026-10-26) is a calendar day where the reader is, not UTC midnight
  function day(v) { var m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], m[2] - 1, +m[3]).getTime() : Date.parse(v); }
  function statusCls(s) { s = (s || '').toLowerCase(); return OK.test(s) ? 'ok' : NONE.test(s) ? 'none' : BAD.test(s) ? 'bad' : 'wait'; }

  // A YAML subset: "key: value  # comment" and "key:" followed by "  - item" lines. The comment is kept
  // as the field's hint (the status lifecycle, e.g. "draft → signed off (product owner)").
  function frontMatter(text) {
    text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    var m = text.match(/^---\n([\s\S]*?)\n---\n?/);
    var meta = {}, hints = {}, list = null;
    if (m) m[1].split('\n').forEach(function (line) {
      var li = line.match(/^\s+-\s+(.*)$/);
      if (li && list) { meta[list].push(unquote(li[1].replace(/\s+#.*$/, ''))); return; }
      var i = line.indexOf(':');
      if (i <= 0 || /^\s/.test(line)) return;
      var key = line.slice(0, i).trim(), rest = line.slice(i + 1), hash = rest.search(/\s#\s/);
      var val = (hash >= 0 ? rest.slice(0, hash) : rest).trim();
      if (hash >= 0) hints[key] = rest.slice(hash).replace(/^\s#\s*/, '').trim();
      if (val === '') { meta[key] = []; list = key; } else { meta[key] = unquote(val); list = null; }
    });
    return { meta: meta, hints: hints, body: m ? text.slice(m[0].length) : text };
  }
  function unquote(v) { return v.replace(/^(["'])(.*)\1$/, '$2'); }

  // Renders markdown to a sanitized fragment, then fixes it up in the DOM (never with regexes on HTML):
  // ids for h2/h3, requirement anchors, links and images resolved inside the item folder.
  function render(md, opts) {
    var html = window.marked.parse(md, { gfm: true, breaks: false });
    var frag = window.DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'svg', 'math'],
      FORBID_ATTR: ['style', 'id', 'class']
    });
    var box = document.createElement('div');
    box.appendChild(frag);
    var title = '', toc = [], prefix = opts.prefix || 'doc';
    var h1 = box.querySelector('h1');
    if (h1 && opts.takeTitle) { title = h1.textContent; h1.remove(); }
    var used = {};
    function uid(base) { var id = prefix + '-' + (base || 'section'), n = 1; while (used[id]) id = prefix + '-' + base + '-' + (++n); used[id] = 1; return id; }
    box.querySelectorAll('h2,h3,p').forEach(function (el) {
      if (el.tagName === 'P') {
        // "**R1. Title.** text" becomes an entry of the index
        var s = el.firstElementChild, m = s && s.tagName === 'STRONG' && el.firstChild === s && s.textContent.match(/^(R\d+)\.\s*(.*?)\.?$/);
        if (!m) return;
        el.id = uid(m[1].toLowerCase()); el.className = 'req';
        toc.push({ lvl: 3, id: el.id, t: m[1] + ' · ' + m[2] });
        return;
      }
      el.id = uid(slug(el.textContent));
      toc.push({ lvl: el.tagName === 'H2' ? 2 : 3, id: el.id, t: el.textContent });
    });
    box.querySelectorAll('img').forEach(function (img) {
      var src = img.getAttribute('src') || '';
      if (opts.base && !/^(https?:|data:|\/)/i.test(src)) img.setAttribute('src', resolve(opts.base, src));
      img.loading = 'lazy'; img.decoding = 'async';
    });
    box.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      var stage = href.match(/^(?:\.\/)?(intent|spec|plan|test|deploy|maintain)\.md(#.*)?$/);
      if (stage && opts.onStageLink) { a.setAttribute('href', '#' + stage[1]); a.dataset.stage = stage[1]; return; }
      if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; return; }
      if (href.charAt(0) === '#') { a.setAttribute('href', '#' + prefix + '-' + slug(href.slice(1))); return; }
      if (opts.base) a.setAttribute('href', resolve(opts.base, href));
    });
    box.querySelectorAll('table').forEach(function (t) { var w = document.createElement('div'); w.className = 'tbl'; t.parentNode.insertBefore(w, t); w.appendChild(t); });
    return { el: box, title: title, toc: toc };
  }
  // Resolves a relative path inside base without letting "../" climb out of it.
  function resolve(base, rel) {
    var parts = rel.split(/[?#]/)[0].split('/'), out = [];
    parts.forEach(function (p) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return base + out.map(encodeURIComponent).join('/');
  }

  async function getText(url) {
    var r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    var type = r.headers.get('content-type') || '';
    var text = await r.text();
    // SPA-style servers answer every path with the page itself: that is not a markdown file
    if (/text\/html/.test(type) && /^\s*<(!doctype|html)/i.test(text)) return null;
    return { text: text, modified: r.headers.get('last-modified') };
  }

  // ---------- theme ----------
  var config = { theme: 'auto' };
  function applyTheme() {
    var o = store.get('theme') || {}, c = config;
    var mode = o.theme || c.theme || 'auto';
    var dark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    var accent = dark ? (o.accent_dark || c.accent_dark) : (o.accent || c.accent);
    var bg = dark ? (o.background_dark || c.background_dark) : (o.background || c.background);
    var hex = /^#[0-9a-f]{3,8}$/i;
    if (accent && hex.test(accent)) root.style.setProperty('--accent', accent); else root.style.removeProperty('--accent');
    if (bg && hex.test(bg)) root.style.setProperty('--paper', bg); else root.style.removeProperty('--paper');
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  async function loadConfig() {
    var r = await getText(ROOT + 'README.md').catch(function () { return null; });
    var fm = r ? frontMatter(r.text) : { meta: {}, body: '' };
    ['theme', 'accent', 'background', 'accent_dark', 'background_dark'].forEach(function (k) { if (typeof fm.meta[k] === 'string') config[k] = fm.meta[k]; });
    applyTheme();
    return fm;
  }

  var ICON = {
    palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2" fill="currentColor"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor"/><circle cx="16" cy="10" r="1.2" fill="currentColor"/><path d="M12 21a2.5 2.5 0 0 1 0-5h1.5a2.5 2.5 0 0 0 0-5"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  // One popover open at a time; Escape or a click outside closes it and returns focus to its button.
  function popover(btn, build) {
    var pop = null;
    function close() { if (!pop) return; pop.remove(); pop = null; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', outside, true); }
    function outside(e) { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); }
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function () {
      if (pop) { close(); return; }
      document.dispatchEvent(new CustomEvent('reader:closepops'));
      pop = document.createElement('div'); pop.className = 'pop'; pop.setAttribute('role', 'dialog');
      build(pop, close);
      btn.parentNode.appendChild(pop); btn.setAttribute('aria-expanded', 'true');
      var f = pop.querySelector('button,input'); if (f) f.focus();
      document.addEventListener('mousedown', outside, true);
    });
    document.addEventListener('reader:closepops', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop) { close(); btn.focus(); } });
  }

  function appearance(btn) {
    btn.innerHTML = ICON.palette + '<span class="lbl">Appearance</span>';
    btn.setAttribute('aria-label', 'Appearance');
    popover(btn, function (pop) {
      pop.innerHTML = '<h3>Appearance</h3><div class="seg" role="group" aria-label="Theme">' +
        ['auto', 'light', 'dark'].map(function (m) { return '<button type="button" data-mode="' + m + '">' + m.charAt(0).toUpperCase() + m.slice(1) + '</button>'; }).join('') +
        '</div><div data-colors></div>' +
        '<p>A preview for you only. To change it for everyone, set these keys in the front matter of <code>docs/work/README.md</code>:</p><pre></pre>' +
        '<button type="button" class="linkbtn" data-reset>Reset to README.md</button>';
      // the colour rows edit the keys of the theme in use (accent or accent_dark, ...), so they are redrawn with it
      function sync() {
        var cur = Object.assign({}, config, store.get('theme') || {});
        var mode = cur.theme || 'auto', dark = document.documentElement.getAttribute('data-theme') === 'dark';
        var css = getComputedStyle(document.documentElement), sfx = dark ? '_dark' : '', name = dark ? 'dark' : 'light';
        pop.querySelectorAll('[data-mode]').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.mode === mode); });
        var box = pop.querySelector('[data-colors]');
        box.innerHTML = '<label for="ap-accent">Accent (' + name + ')<input id="ap-accent" type="color" data-k="accent' + sfx + '" value="' + toHex(css.getPropertyValue('--accent')) + '"></label>' +
          '<label for="ap-bg">Background (' + name + ')<input id="ap-bg" type="color" data-k="background' + sfx + '" value="' + toHex(css.getPropertyValue('--paper')) + '"></label>';
        box.querySelectorAll('input').forEach(function (inp) {
          inp.addEventListener('input', function () { var t = store.get('theme') || {}; t[inp.dataset.k] = inp.value; store.set('theme', t); applyTheme(); code(); });
        });
        code();
      }
      function code() {
        var cur = Object.assign({}, config, store.get('theme') || {});
        pop.querySelector('pre').textContent = ['theme', 'accent', 'background', 'accent_dark', 'background_dark'].filter(function (k) { return cur[k]; }).map(function (k) { return k + ': ' + (k === 'theme' ? cur[k] : '"' + cur[k] + '"'); }).join('\n');
      }
      pop.querySelectorAll('[data-mode]').forEach(function (b) {
        b.addEventListener('click', function () { var t = store.get('theme') || {}; t.theme = b.dataset.mode; store.set('theme', t); applyTheme(); sync(); });
      });
      pop.querySelector('[data-reset]').addEventListener('click', function () { store.del('theme'); applyTheme(); sync(); });
      sync();
    });
  }
  function toHex(v) {
    v = (v || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map(function (c) { return c + c; }).join('');
    var m = v.match(/\d+/g); if (!m || m.length < 3) return '#3b55d4';
    return '#' + m.slice(0, 3).map(function (n) { return ('0' + (+n).toString(16)).slice(-2); }).join('');
  }

  // ---------- items ----------
  var SAFE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
  // The items: docs/work/index.json, which scripts/site.js writes (a static host lists no folder); else a
  // development server's listing of docs/work/ (JSON, or the HTML index of npx serve / http.server).
  async function listItems() {
    var names = [];
    try {
      var idx = await fetch(ROOT + 'index.json', { cache: 'no-cache' });
      if (idx.ok && /json/.test(idx.headers.get('content-type') || '')) {
        return (await idx.json()).map(function (e) { if (typeof e === 'string') return e; if (e && e.kind === 'milestone') MILESTONES[e.name] = true; return e && e.name; }).filter(function (n) { return SAFE.test(n || ''); });
      }
    } catch (e) { /* no index: ask the server */ }
    try {
      var r = await fetch(ROOT, { headers: { Accept: 'application/json' }, cache: 'no-cache' });
      if (r.ok) {
        var type = r.headers.get('content-type') || '', body = await r.text();
        if (/json/.test(type)) names = JSON.parse(body).map(function (e) { return typeof e === 'string' ? e : e.name; });
        else {
          var doc = new DOMParser().parseFromString(body, 'text/html');
          doc.querySelectorAll('a[href]').forEach(function (a) {
            var m = a.getAttribute('href').match(/(?:^|\/)docs\/work\/([^/?#]+)\/?$|^([^/?#.][^/?#]*)\/$/);
            var n = m && decodeURIComponent(m[1] || m[2]);
            if (n) names.push(n);
          });
        }
      }
    } catch (e) { /* fall through */ }
    var seen = {};
    return names.filter(function (n) { if (!SAFE.test(n) || seen[n]) return false; seen[n] = 1; return true; });
  }

  // Each stage file is the English source; its front matter may name a translation beside it
  // (`translation: intent.pt-BR.md`, which says `source: intent.md (English)` back).
  var TR = /^[a-z0-9][a-z0-9._-]*\.md$/i;
  // the items index.json marks as milestones: their folder has no stage file to ask for
  var MILESTONES = {};
  async function loadItem(name) {
    var base = ROOT + name + '/';
    if (MILESTONES[name]) return loadMilestone(name, base);
    var files = await Promise.all(STAGES.map(function (s) { return getText(base + s.f + '.md').catch(function () { return null; }); }));
    if (!files.some(Boolean)) return loadMilestone(name, base);
    var stages = await Promise.all(STAGES.map(async function (s, i) {
      var r = files[i];
      if (!r) return { f: s.f, name: s.name, fills: s.fills, missing: true, meta: { status: 'not started' }, hints: {}, body: '', raw: '', file: s.f + '.md' };
      var fm = frontMatter(r.text);
      var st = { f: s.f, name: s.name, fills: s.fills, meta: fm.meta, hints: fm.hints, body: fm.body, raw: r.text, modified: r.modified, file: s.f + '.md' };
      var tname = typeof fm.meta.translation === 'string' ? fm.meta.translation.split(/\s/)[0] : '';
      if (TR.test(tname)) {
        var t = await getText(base + tname).catch(function () { return null; });
        if (t) { var tf = frontMatter(t.text); st.tr = { meta: tf.meta, hints: tf.hints, body: tf.body, raw: t.text, file: tname }; }
        else st.trMissing = tname;
      }
      return st;
    }));
    var here = currentStage(stages);
    stages.forEach(function (s, i) { s.past = i < here; s.here = i === here; });
    function h1(body) { return cleanTitle((body.match(/^#\s+(.+)$/m) || [])[1] || ''); }
    var first = stages[0];
    var dates = stages.map(function (s) {
      var t = s.modified ? Date.parse(s.modified) : NaN;
      if (isNaN(t) && s.meta.date) t = day(s.meta.date);
      return t;
    }).filter(function (t) { return !isNaN(t); });
    var written = stages.filter(function (s) { return !s.missing; });
    // history: a stage starts on its file's `date`; it lasts until the next stage starts (the current one, until today)
    var DAY = 864e5, now = Date.now();
    stages.forEach(function (s) { s.at = s.meta.date ? day(s.meta.date) : NaN; });
    stages.forEach(function (s, i) {
      s.days = null;
      if (isNaN(s.at) || i > here || s.f === 'maintain') return;
      var next = stages.slice(i + 1).find(function (n) { return !isNaN(n.at); });
      var end = i === here ? now : next && next.at;
      if (end) s.days = Math.max(0, (end - s.at) / DAY);
      s.ongoing = i === here;
    });
    var deploy = stages[4], released = deploy.meta.released ? day(deploy.meta.released) : NaN;
    var shipped = statusCls(deploy.meta.status) === 'ok' || here === 5;
    var group = shipped ? 'shipped' : here < 2 || (here === 2 && statusCls(stages[2].meta.status) !== 'ok') ? 'planned' : 'progress';
    return {
      group: group, created: stages[0].at, released: released, release: deploy.meta.release || '', target: first.meta.target || '',
      plan: stages[2].missing ? null : planProgress(stages[2].body),
      summary: { en: first.missing ? '' : firstParagraph(first.body), pt: first.tr ? firstParagraph(first.tr.body) : (first.missing ? '' : firstParagraph(first.body)) },
      issue: first.meta.issue || '', lead: !isNaN(released) && !isNaN(stages[0].at) ? (released - stages[0].at) / DAY : null,
      name: name, base: base, stages: stages, here: here,
      title: { en: (!first.missing && h1(first.body)) || name, pt: (first.tr && h1(first.tr.body)) || (!first.missing && h1(first.body)) || name },
      translated: written.filter(function (s) { return s.tr; }).length, written: written.length,
      updated: dates.length ? Math.max.apply(null, dates) : null
    };
  }
  // A milestone (docs/work/<name>/milestone.md, `kind: milestone`): a marker on the project's history,
  // not an SDLC item, so it has no stages. Front matter: title, summary, status (planned | in progress |
  // done), after (the item it follows in Next), expected (the day it should be reached), reached (the
  // day it was: it then shows on the Changelog), date (when it was written), and a translation.
  async function loadMilestone(name, base) {
    var r = await getText(base + 'milestone.md').catch(function () { return null; });
    if (!r) return null;
    var fm = frontMatter(r.text), M = fm.meta, tn = typeof M.translation === 'string' ? M.translation.split(/\s/)[0] : '';
    var t = TR.test(tn) ? await getText(base + tn).catch(function () { return null; }) : null, tf = t ? frontMatter(t.text) : null;
    var st = String(M.status || 'planned').toLowerCase();
    var str = function (v) { return typeof v === 'string' ? v : ''; };
    return {
      kind: 'milestone', name: name, base: base, here: -1, stages: [], issue: '', release: '', target: '', lead: null,
      group: st === 'done' ? 'shipped' : WORKING.test(st) ? 'progress' : 'planned', status: st, after: str(M.after),
      created: M.date ? day(M.date) : NaN, expected: M.expected ? day(M.expected) : NaN, reached: M.reached ? day(M.reached) : NaN,
      title: { en: str(M.title) || name, pt: (tf && str(tf.meta.title)) || str(M.title) || name },
      summary: { en: str(M.summary), pt: (tf && str(tf.meta.summary)) || str(M.summary) },
      doc: { en: { meta: M, hints: fm.hints, body: fm.body, raw: r.text, file: 'milestone.md' }, pt: tf ? { meta: tf.meta, hints: tf.hints, body: tf.body, raw: t.text, file: tn } : null }
    };
  }
  // Milestones follow the item they name in `after:`, wherever the list puts it.
  function placeAfter(list) {
    var follows = function (m) { return m.kind === 'milestone' && m.after && list.some(function (x) { return x.name === m.after; }); };
    var out = list.filter(function (x) { return !follows(x); });
    list.filter(follows).forEach(function (m) { var i = out.findIndex(function (x) { return x.name === m.after; }); out.splice(i + 1, 0, m); });
    return out;
  }
  // The plan's Progress table (`## Progress` / `## Progresso`): its rows, and the ones whose Status says done.
  function planProgress(body) {
    var lines = String(body || '').split('\n'), at = lines.findIndex(function (l) { return /^##\s+(progress|progresso)\b/i.test(l); });
    if (at < 0) return null;
    var rows = [], col = -1;
    for (var i = at + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
      if (!/^\s*\|/.test(lines[i])) { if (rows.length || col >= 0) { if (lines[i].trim()) break; } continue; }
      var cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
      if (col < 0) { col = cells.findIndex(function (c) { return /^status$/i.test(c); }); continue; }
      if (cells.every(function (c) { return /^:?-+:?$/.test(c); })) continue;
      rows.push(cells);
    }
    if (col < 0 || !rows.length) return null;
    var done = rows.filter(function (r) { return /^(done|feito|merged|shipped|ok|✓|✅)/i.test(r[col] || ''); }).length;
    return { done: done, total: rows.length };
  }
  // The first plain paragraph of a document (after its headings), as a one-line summary.
  function firstParagraph(body) {
    var para = String(body || '').split(/\n\s*\n/).map(function (b) { return b.trim(); })
      .find(function (b) { return b && !/^(#|\||!|>|-|\*|\d+\.|```)/.test(b); }) || '';
    para = para.replace(/\s+/g, ' ').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    return para.length > 220 ? para.slice(0, 217).replace(/\s+\S*$/, '') + '…' : para;
  }
  // The stage being worked on: the first one with a working status (draft, in progress); else the last
  // one started, moving past it when it is approved (an accepted plan means Build is on, so it stays).
  function currentStage(stages) {
    var w = stages.findIndex(function (s) { return WORKING.test((s.meta.status || '').toLowerCase()); });
    if (w >= 0) return w;
    var last = -1;
    stages.forEach(function (s, i) { if (statusCls(s.meta.status) !== 'none') last = i; });
    if (last < 0) return 0;
    if (statusCls(stages[last].meta.status) === 'ok' && /^(intent|spec|test|deploy)$/.test(stages[last].f) && last < stages.length - 1) return last + 1;
    return last;
  }
  // EN reads the source, PT the translation; the choice is remembered per viewer
  var lang = store.get('lang') === 'pt' ? 'pt' : 'en';
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  function langSwitch(onChange) {
    var el = document.createElement('div'); el.className = 'seg lang'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Language');
    el.innerHTML = '<button type="button" data-lang="en" title="English (source)">EN</button><button type="button" data-lang="pt" title="Português (translation)">PT</button>';
    function sync() { el.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.lang === lang); }); }
    el.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { if (lang === b.dataset.lang) return; lang = b.dataset.lang; store.set('lang', lang); document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en'; sync(); onChange(); });
    });
    sync();
    return el;
  }
  function cleanTitle(t) { t = t.replace(/[*_`]/g, '').replace(/^[^:]+:\s*/, ''); return t.charAt(0).toUpperCase() + t.slice(1); }
  function fmtDate(t) { return new Date(t).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }); }
  function pill(s) { var st = s.meta.status || ''; return '<span class="pill ' + statusCls(st) + '"' + (s.hints.status ? ' title="' + esc(s.hints.status) + '"' : '') + '>' + esc(st) + '</span>'; }

  // ---------- home ----------
  // Three tabs read from the repository: Overview (now / next / shipped, time per stage), Work (every item,
  // filtered) and Changelog (CHANGELOG.md, Keep a Changelog format). Tab names are plain hash tokens.
  var GROUPS = { progress: 'In progress', planned: 'Planned', shipped: 'Shipped' };
  var SHORT = ['Plan', 'Design', 'Build', 'Test', 'Deploy', 'Maintain'];
  function days(d) { return d == null ? '' : d < 1 ? '<1d' : Math.round(d) + 'd'; }
  function shortDate(t) { return isNaN(t) || t == null ? '' : new Date(t).toLocaleDateString('en', { month: 'short', day: 'numeric' }); }
  function ago(t) { var d = Math.round((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; }
  function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); var m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null; }

  // The six stages as dots on a line: done (green, checked), current (accent), to do (hollow); the time spent
  // in a stage sits on the line that leaves it.
  function flowDots(it) {
    return '<ol class="fdots" aria-label="Stages">' + it.stages.map(function (s, i) {
      var cls = s.here && it.group !== 'shipped' ? 'here' : i < it.here || (s.here && it.group === 'shipped') ? 'done' : 'todo';
      var tip = SHORT[i] + ' · ' + (s.missing ? 'not started' : (s.meta.status || '')) + (isNaN(s.at) ? '' : ' · ' + shortDate(s.at)) + (s.days != null ? ' · ' + days(s.days) + (s.ongoing ? ' so far' : '') : '');
      return '<li class="fd ' + cls + (s.ongoing ? ' ongoing' : '') + '" title="' + esc(tip) + '"><span class="d" aria-hidden="true"></span><span class="l">' + SHORT[i] + '<span class="sr"> ' + (cls === 'done' ? 'done' : cls === 'here' ? 'current' : 'to do') + '</span></span>' +
        (i < 5 && s.days != null ? '<span class="t">' + days(s.days) + '</span>' : '') + '</li>';
    }).join('') + '</ol>';
  }
  var FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>';
  function longDay(t) { return new Date(t).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }); }
  // "Expected Thu, Nov 5 · in 5 days", or when it was reached
  function milestoneWhen(it) {
    if (it.group === 'shipped') return isNaN(it.reached) ? 'Reached' : 'Reached ' + longDay(it.reached);
    if (isNaN(it.expected)) return 'No date yet';
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var left = Math.round((it.expected - today.getTime()) / 864e5);
    return 'Expected <b>' + longDay(it.expected) + '</b> · ' + (left > 1 ? 'in ' + left + ' days' : left === 1 ? 'tomorrow' : left === 0 ? 'today' : (-left) + (left === -1 ? ' day' : ' days') + ' late');
  }
  function milestoneCard(it) {
    return '<a class="wcard mile g-' + it.group + '" href="' + itemHref(it.name) + '" data-item="' + esc(it.name) + '">' +
      '<div class="wc-top"><span class="gtag mtag">' + FLAG + 'Milestone</span></div>' +
      '<h3>' + esc(it.title[lang]) + '</h3>' + (it.summary[lang] ? '<p class="msum">' + esc(it.summary[lang]) + '</p>' : '') +
      '<div class="wc-foot mwhen">' + milestoneWhen(it) + '</div></a>';
  }
  // What GitHub and git say (scripts/site-data.js writes them at build time; absent on a local build
  // without a token): the state of each item's issue and its pull requests, the backlog label's open
  // issues, and the commit activity. A private repository's issues are named, never linked.
  var GH = null, ACT = null;
  async function loadExtras() {
    var j = function (f) { return getText(ROOT + f).then(function (r) { return r ? JSON.parse(r.text) : null; }).catch(function () { return null; }); };
    var r = await Promise.all([j('github.json'), j('activity.json')]);
    GH = r[0]; ACT = r[1];
  }
  function ghIssue(it) { var m = String(it.issue || '').match(/#(\d+)/); return GH && m ? GH.issues[m[1]] || null : null; }
  function refHtml(it) {
    if (!it.issue) return '';
    var g = ghIssue(it);
    return '<span class="ref">' + (g ? '<i class="st st-' + g.state + '" title="Issue ' + g.state + ' on GitHub"></i>' : '') + esc(it.issue.split(/\s/)[0]) + '</span>';
  }
  function lastPr(it) {
    var g = ghIssue(it), pr = g && g.prs && g.prs[0];
    return pr ? 'PR #' + pr.number + ' ' + pr.state : '';
  }
  // The item's sub-issues (its epic's phases on GitHub), folded under its card: how many are done, then
  // the list, open ones first. A private repository's issues are named, never linked.
  function subsHtml(it) {
    var g = ghIssue(it), kids = g && g.children ? g.children : [];
    if (!kids.length) return '';
    var done = kids.filter(function (c) { return c.state === 'closed'; }).length;
    var order = kids.slice().sort(function (a, b) { return (a.state === 'closed') - (b.state === 'closed') || a.number - b.number; });
    // a dot per sub-issue, filled when it is done (a bar past 12)
    var pips = kids.length <= 12 ? '<span class="pips" aria-hidden="true">' + kids.map(function (c, k) { return '<i class="' + (k < done ? 'on' : '') + '"></i>'; }).join('') + '</span>'
      : '<span class="sbar" aria-hidden="true"><i style="width:' + Math.round(done / kids.length * 100) + '%"></i></span>';
    return '<details class="subs"><summary>' + pips + '<span><b>' + kids.length + '</b> sub-issues · ' + done + ' done</span></summary><ul>' +
      order.map(subLi).join('') + '</ul></details>';
  }
  // One sub-issue: its state and title; a phase with steps of its own folds them under it, with its count.
  function subLi(c) {
    var n = '#' + c.number, kids = c.children || [], done = kids.filter(function (k) { return k.state === 'closed'; }).length;
    var line = '<i class="st st-' + c.state + '"></i><span class="num">' + (GH.private ? n : '<a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">' + n + '</a>') + '</span><span class="ttl">' + esc(c.title) + '</span>' +
      '<span class="stt">' + (kids.length ? done + '/' + kids.length : c.state === 'closed' ? 'done' : 'open') + '</span>';
    if (!kids.length) return '<li class="' + (c.state === 'closed' ? 'done' : '') + '">' + line + '</li>';
    var order = kids.slice().sort(function (a, b) { return (a.state === 'closed') - (b.state === 'closed') || a.number - b.number; });
    return '<li class="has-kids' + (c.state === 'closed' ? ' done' : '') + '"><details><summary>' + line + '</summary><ul>' + order.map(subLi).join('') + '</ul></details></li>';
  }
  // A card and its folded sub-issues, kept together (the details cannot sit inside the card's link).
  function cardBlock(it) { return '<div class="cblock">' + itemCard(it) + subsHtml(it) + '</div>'; }
  function itemCard(it) {
    if (it.kind === 'milestone') return milestoneCard(it);
    var cur = it.stages[it.here];
    var foot = ['Created ' + (shortDate(it.created) || '—')];
    if (it.group === 'shipped') { foot.push('shipped in <b>' + esc(it.release) + '</b>'); if (it.lead != null) foot.push(days(it.lead) + ' from intent to release'); }
    else { if (cur.days != null) foot.push(days(cur.days) + ' in ' + SHORT[it.here]); if (it.target) foot.push('target <b>' + esc(it.target) + '</b>'); }
    if (lastPr(it)) foot.push(esc(lastPr(it)));
    return '<a class="wcard g-' + it.group + '" href="' + itemHref(it.name) + '" data-item="' + esc(it.name) + '">' +
      '<div class="wc-top"><span class="gtag">' + GROUPS[it.group] + (it.group === 'shipped' ? '' : ' · ' + SHORT[it.here]) + '</span>' + refHtml(it) + '</div>' +
      '<h3>' + esc(it.title[lang]) + '</h3>' + flowDots(it) +
      '<div class="wc-foot">' + foot.join(' · ') + '</div></a>';
  }
  function historyHtml(it) {
    return '<ul class="hist">' + it.stages.map(function (s, i) {
      if (isNaN(s.at)) return '';
      return '<li><span>' + SHORT[i] + '</span><span>' + shortDate(s.at) + '</span><span>' + (s.days != null ? days(s.days) + (s.ongoing ? ' so far' : '') : '') + '</span></li>';
    }).join('') + '</ul>' + (it.lead != null ? '<p>' + days(it.lead) + ' from intent to release ' + esc(it.release) + '.</p>' : '');
  }

  // Time in each stage for the shipped items: one bar per item, segments on a single-hue ramp (stages are ordered).
  function stageChart(items) {
    var rows = items.filter(function (it) { return it.group === 'shipped' && it.lead != null; });
    if (!rows.length) return '';
    var max = Math.max.apply(null, rows.map(function (it) { return it.lead; })), step = max > 12 ? 4 : 2, top = Math.ceil(max / step) * step || step;
    var ticks = []; for (var t = 0; t <= top; t += step) ticks.push(t);
    return '<figure class="chart"><figcaption><b>Time in each stage</b><span>Shipped items, from intent to release, in days</span></figcaption>' +
      '<div class="legend" aria-hidden="true">' + SHORT.slice(0, 5).map(function (n, i) { return '<span><i class="sw s' + i + '"></i>' + n + '</span>'; }).join('') + '</div>' +
      '<div class="crows">' + rows.map(function (it) {
        return '<div class="crow"><a class="cl" href="' + itemHref(it.name) + '" title="' + esc(it.title[lang]) + '">' + esc(it.title[lang]) + '</a>' +
          '<div class="ctrack">' + ticks.map(function (t) { return '<span class="grid" style="left:' + (t / top * 100) + '%"></span>'; }).join('') +
          '<div class="cbar" style="width:' + (it.lead / top * 100) + '%">' + it.stages.slice(0, 5).map(function (s, i) {
            var d = s.days || 0;
            return d > 0 ? '<span class="seg s' + i + '" style="flex:' + d + '" data-tip="' + esc(it.title[lang] + '\n' + SHORT[i] + ': ' + days(d) + ' (' + shortDate(s.at) + ')') + '"></span>' : '';
          }).join('') + '</div><span class="ctot" style="left:' + (it.lead / top * 100) + '%">' + days(it.lead) + '</span></div></div>';
      }).join('') + '</div>' +
      '<div class="caxis">' + ticks.map(function (t) { return '<span style="left:' + (t / top * 100) + '%">' + t + 'd</span>'; }).join('') + '</div>' +
      '<details class="ctable"><summary>Show as a table</summary><div class="tbl"><table><thead><tr><th>Item</th>' + SHORT.slice(0, 5).map(function (n) { return '<th>' + n + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>' +
      rows.map(function (it) { return '<tr><td>' + esc(it.title[lang]) + '</td>' + it.stages.slice(0, 5).map(function (s) { return '<td>' + days(s.days) + '</td>'; }).join('') + '<td>' + days(it.lead) + '</td></tr>'; }).join('') +
      '</tbody></table></div></details></figure>';
  }

  // CHANGELOG.md: "## [1.4.0] - 2026-10-26", an optional "> summary", then "### Added" / "Changed" / "Fixed" / "Security".
  function parseChangelog(text, items) {
    var body = frontMatter(text).body, out = [];
    body.split(/^## /m).slice(1).forEach(function (chunk) {
      var head = chunk.split('\n')[0], m = head.match(/^\[?([^\]\s]+)\]?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
      if (!m) return;
      var rest = chunk.slice(head.length), sum = (rest.match(/^>\s*(.+)$/m) || [])[1] || '';
      var sections = rest.split(/^### /m).slice(1).map(function (sec) {
        var name = sec.split('\n')[0].trim();
        return { name: name, html: render(sec.slice(name.length), { prefix: 'cl' }).el };
      });
      out.push({ version: m[1], date: m[2] ? day(m[2]) : NaN, summary: sum, sections: sections });
    });
    var repo = config.repo || '';
    out.forEach(function (v) {
      v.sections.forEach(function (sec) {
        // a link to docs/work/<item>/ becomes the item's chip; "#123" links to the issue
        sec.html.querySelectorAll('a[href]').forEach(function (a) {
          var mm = a.getAttribute('href').match(/docs\/work\/([^/]+)\/?$/);
          if (!mm) return;
          var it = items.find(function (x) { return x.name === mm[1]; });
          a.className = 'ichip'; a.setAttribute('href', itemHref(mm[1])); a.removeAttribute('target');
          a.textContent = it ? it.title[lang] : mm[1];
        });
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return;
        var walk = document.createTreeWalker(sec.html, NodeFilter.SHOW_TEXT), nodes = [];
        while (walk.nextNode()) if (/#\d+/.test(walk.currentNode.nodeValue) && !walk.currentNode.parentNode.closest('a,code')) nodes.push(walk.currentNode);
        nodes.forEach(function (n) {
          var frag = document.createDocumentFragment(), last = 0, txt = n.nodeValue;
          txt.replace(/#(\d+)/g, function (all, num, at) {
            frag.appendChild(document.createTextNode(txt.slice(last, at)));
            var a = document.createElement('a'); a.className = 'iref'; a.href = 'https://github.com/' + repo + '/issues/' + num; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = all;
            frag.appendChild(a); last = at + all.length; return all;
          });
          frag.appendChild(document.createTextNode(txt.slice(last)));
          n.parentNode.replaceChild(frag, n);
        });
      });
    });
    return out;
  }
  var KIND = { Added: 'add', Changed: 'chg', Fixed: 'fix', Security: 'sec', Removed: 'rem', Deprecated: 'rem' };
  function changelogHtml(versions, milestones) {
    var box = document.createElement('div'); box.className = 'clog';
    // milestones on the timeline: an upcoming one (with an expected day) above everything, a reached one
    // above the first release older than it
    var marks = (milestones || []).filter(function (m) { return !isNaN(m.reached) || (m.group !== 'shipped' && !isNaN(m.expected)); });
    var placed = marks.map(function (m) {
      if (isNaN(m.reached)) return { m: m, at: 0 };
      var i = versions.findIndex(function (v) { return !isNaN(v.date) && v.date < m.reached; });
      return { m: m, at: i < 0 ? versions.length : i };
    });
    var markHtml = function (m) {
      var sec = document.createElement('section'); sec.className = 'rel mile' + (m.group === 'shipped' ? ' reached' : ' upcoming');
      sec.innerHTML = '<div class="rel-side"><span class="ver mver">' + FLAG + 'Milestone</span><span class="rdate">' + (m.group === 'shipped' ? new Date(m.reached).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }) : 'expected ' + longDay(m.expected)) + '</span></div>' +
        '<div class="rel-body"><p class="rsum"><a href="' + itemHref(m.name) + '"></a></p>' + (m.summary[lang] ? '<p class="msum"></p>' : '') + '</div>';
      sec.querySelector('.rsum a').textContent = m.title[lang];
      if (m.summary[lang]) sec.querySelector('.msum').textContent = m.summary[lang];
      return sec;
    };
    versions.forEach(function (v, i) {
      placed.filter(function (p) { return p.at === i; }).forEach(function (p) { box.appendChild(markHtml(p.m)); });
      var next = versions[i + 1], gap = next && !isNaN(v.date) && !isNaN(next.date) ? Math.round((v.date - next.date) / 864e5) : null;
      var sec = document.createElement('section'); sec.className = 'rel' + (v.version.toLowerCase() === 'unreleased' ? ' unrel' : '') + (v === versions.find(function (x) { return !isNaN(x.date); }) ? ' newest' : '');
      sec.id = 'v-' + slug(v.version);
      sec.innerHTML = '<div class="rel-side"><span class="ver">' + esc(v.version.toLowerCase() === 'unreleased' ? 'Unreleased' : v.version) + '</span>' +
        (isNaN(v.date) ? '<span class="rdate">on main</span>' : '<span class="rdate">' + new Date(v.date).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }) + '</span>') +
        (gap != null ? '<span class="rgap">' + gap + ' days after ' + esc(next.version) + '</span>' : '') + '</div>' +
        '<div class="rel-body">' + (v.summary ? '<p class="rsum"></p>' : '') + '</div>';
      if (v.summary) sec.querySelector('.rsum').textContent = v.summary;
      var body = sec.querySelector('.rel-body');
      v.sections.forEach(function (s) {
        var g = document.createElement('div'); g.className = 'rsec k-' + (KIND[s.name] || 'chg');
        g.innerHTML = '<h4><i aria-hidden="true"></i>' + esc(s.name) + '</h4>';
        g.appendChild(s.html); body.appendChild(g);
      });
      box.appendChild(sec);
    });
    placed.filter(function (p) { return p.at === versions.length; }).forEach(function (p) { box.appendChild(markHtml(p.m)); });
    return box;
  }

  // Commits per week as bars, the last one the current week; the numbers say the rest.
  function activityTile(a) {
    var max = Math.max.apply(null, a.weeks.map(function (w) { return w.commits; }).concat([1]));
    var fmt = function (n) { return Number(n).toLocaleString('en'); };
    return '<div class="stat wide span3 act"><dt>Activity</dt><dd>' + fmt(a.commits30) + '<small>commits in the last 30 days · ' + fmt(a.merges30) + ' pull requests merged · last commit ' + esc(shortDate(day(a.last))) + '</small></dd>' +
      '<div class="spark" role="img" aria-label="Commits per week, last ' + a.weeks.length + ' weeks">' + a.weeks.map(function (w) {
        return '<span title="Week of ' + esc(shortDate(day(w.start))) + ': ' + fmt(w.commits) + ' commits"><i style="height:' + Math.max(w.commits ? 6 : 2, Math.round(w.commits / max * 100)) + '%"></i></span>';
      }).join('') + '</div></div>';
  }

  // A project just imported: no item and no release yet. Shows what will fill the page, and from where.
  // Overview as a spine (owner's choice of 2026-10-31): what is ahead on top (the farthest first), today
  // in the middle with what is being built, what shipped below (the releases, newest first, with the
  // items each one carried). One vertical line; the rows alternate sides on a wide screen.
  function spine(items, versions) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var T = today.getTime(), DAY = 864e5;
    var daysTo = function (t) { return Math.round((t - T) / DAY); };
    var ago = function (t) { var d = -daysTo(t); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
    var side = 0, rows = [];
    function row(kind, node, card, meta) {
      side++;
      rows.push('<div class="srow ' + kind + ' ' + (side % 2 ? 'side-r' : 'side-l') + '"><div class="snode" aria-hidden="true">' + node + '</div><div class="scard">' + card + '</div><div class="smeta">' + (meta || '') + '</div></div>');
    }
    var sep = function (label) { rows.push('<div class="ssep"><span>' + label + '</span></div>'); };
    var ahead = placeAfter(items.filter(function (it) { return it.group === 'planned'; })).reverse();
    var now = items.filter(function (it) { return it.group === 'progress'; });
    var nextStop = items.filter(function (it) { return it.kind === 'milestone' && it.group !== 'shipped' && !isNaN(it.expected) && it.expected >= T; })
      .sort(function (a, b) { return a.expected - b.expected; })[0];
    var backlog = GH && GH.backlog ? GH.backlog : [];
    if (ahead.length || backlog.length) {
      sep('Ahead');
      if (backlog.length) {
        row('s-backlog', '<span class="n-plan"></span>', '<div class="rcard bcard"><div class="rhead"><b>From the backlog</b><span>' + backlog.length + (backlog.length === 1 ? ' issue' : ' issues') + ' marked for the roadmap</span></div><ul class="blist">' +
          backlog.slice(0, 6).map(function (b) { var n = '#' + b.number; return '<li><span class="mono">' + (GH.private ? n : '<a href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer">' + n + '</a>') + '</span> ' + esc(b.title) + '</li>'; }).join('') +
          (backlog.length > 6 ? '<li class="more">and ' + (backlog.length - 6) + ' more</li>' : '') + '</ul></div>', 'not started');
      }
      ahead.forEach(function (it) {
        if (it.kind === 'milestone') row('s-mile', '<span class="n-mile"></span>', milestoneCard(it), isNaN(it.expected) ? '' : longDay(it.expected));
        else row('s-plan', '<span class="n-plan"></span>', cardBlock(it), isNaN(it.created) ? '' : 'created ' + shortDate(it.created));
      });
    }
    // today: the date on one side, what is being built on the other
    var nowCards = now.map(function (it) {
      if (it.kind === 'milestone') return milestoneCard(it);
      var sum = it.summary && it.summary[lang], p = it.plan;
      return '<div class="cblock"><a class="wcard now g-progress" href="' + itemHref(it.name) + '" data-item="' + esc(it.name) + '">' +
        '<div class="wc-top"><span class="gtag">In progress · ' + SHORT[it.here] + '</span>' + refHtml(it) + '</div>' +
        '<h3>' + esc(it.title[lang]) + '</h3>' + (sum ? '<p class="msum">' + esc(sum) + '</p>' : '') + flowDots(it) +
        (p ? '<div class="pbar"><span><i style="width:' + Math.max(3, Math.round(p.done / p.total * 100)) + '%"></i></span><b>plan: ' + p.done + ' of ' + p.total + ' steps</b></div>' : '') +
        (lastPr(it) ? '<div class="wc-foot">' + esc(lastPr(it)) + '</div>' : '') + '</a>' + subsHtml(it) + '</div>';
    }).join('') || '<p class="none">Nothing in progress right now.</p>';
    var todayLine = now.length + ' in progress' + (nextStop ? ' · next stop in ' + daysTo(nextStop.expected) + (daysTo(nextStop.expected) === 1 ? ' day' : ' days') : '');
    rows.push('<div class="srow today"><div class="snode" aria-hidden="true"><span class="n-today"></span></div><div class="smeta"><span class="kicker">Today</span><b>' + esc(longDay(T)) + '</b><span>' + esc(todayLine) + '</span></div><div class="scard">' + nowCards + '</div></div>');
    // shipped: unreleased work on main, then the releases (and the milestones reached between them)
    var reached = items.filter(function (it) { return it.kind === 'milestone' && !isNaN(it.reached); });
    if (versions.length || reached.length) sep('Shipped');
    var dated = versions.filter(function (v) { return !isNaN(v.date); });
    versions.forEach(function (v) {
      var bullets = []; v.sections.forEach(function (sec) { sec.html.querySelectorAll('li').forEach(function (li) { bullets.push(li.textContent.replace(/\s+/g, ' ').trim()); }); });
      var counts = v.sections.map(function (sec) { return '<span>' + sec.html.querySelectorAll('li').length + ' ' + esc(sec.name.toLowerCase()) + '</span>'; }).join('');
      var carried = items.filter(function (it) { return it.release && it.release === v.version; }).map(function (it) { return '<a class="ichip" href="' + itemHref(it.name) + '">' + esc(it.title[lang]) + '</a>'; }).join('');
      var text = v.summary || bullets.slice(0, 2).join(' ');
      if (isNaN(v.date)) {
        // what is on main: its changes themselves, not the section's generic summary
        row('s-unrel', '<span class="n-unrel"></span>', '<div class="rcard"><div class="rhead"><b>Not released yet</b><span>on main</span></div>' + (bullets.length ? '<ul class="rlist">' + bullets.slice(0, 3).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' : '') + '<div class="rcounts">' + counts + '</div></div>', 'next release');
        return;
      }
      reached.filter(function (m) { return m.reached >= v.date && !m.placed; }).forEach(function (m) { m.placed = true; row('s-mile s-reached', '<span class="n-mile"></span>', milestoneCard(m), ago(m.reached)); });
      var prev = dated[dated.indexOf(v) + 1], gap = prev ? Math.round((v.date - prev.date) / DAY) : null;
      row('s-rel' + (v === dated[0] ? ' s-newest' : ''), '<span class="n-rel"></span>',
        '<div class="rcard"><div class="rhead"><b>' + esc(v.version) + '</b><span>' + shortDate(v.date) + (gap != null ? ' · ' + gap + ' days after ' + esc(prev.version) : '') + '</span></div>' +
        (text ? '<p>' + esc(text) + '</p>' : '') + (carried ? '<div class="rcarried">' + carried + '</div>' : '') + '<div class="rcounts">' + counts + '</div></div>', ago(v.date));
    });
    reached.filter(function (m) { return !m.placed; }).forEach(function (m) { row('s-mile s-reached', '<span class="n-mile"></span>', milestoneCard(m), ago(m.reached)); });
    reached.forEach(function (m) { delete m.placed; });
    return '<div class="spine">' + rows.join('') + '</div>' + (versions.length ? '<p class="spine-more"><button type="button" class="linkbtn" data-goto="changelog">Read the full changelog →</button></p>' : '');
  }

  function emptyWork() {
    var steps = [['Plan', 'intent.md', 'Grill me or Write doc turns an idea into an intent; a person accepts it.'],
      ['Design', 'spec.md', 'The spec, signed off at its gate.'], ['Build', 'plan.md', 'The plan, then the runs: commits and PRs fill its progress.'],
      ['Test', 'test.md', 'Suites, E2E and screenshots from the runs.'], ['Deploy', 'deploy.md', 'The review, the PR and the release.'],
      ['Maintain', 'maintain.md', 'Incidents and post-mortems after the release.']];
    return '<div class="empty-state"><span class="kicker">No work items yet</span><h3>Each feature or fix will show up here, stage by stage</h3>' +
      '<p>An item is a folder under <code>docs/work/</code>. Its documents are written by the project\'s workflows and committed by a run at the usual gate, so this page fills itself as the work moves.</p>' +
      '<ol class="esteps">' + steps.map(function (s) { return '<li><span class="d" aria-hidden="true"></span><b>' + s[0] + '</b><code>' + s[1] + '</code><span>' + s[2] + '</span></li>'; }).join('') + '</ol></div>';
  }

  async function home() {
    var root = document.getElementById('app');
    var fm = await loadConfig();
    config.repo = typeof fm.meta.repo === 'string' ? fm.meta.repo : '';
    async function pair(file) {
      var en = await getText(file).catch(function () { return null; });
      if (!en) return null;
      var f = frontMatter(en.text), tn = typeof f.meta.translation === 'string' ? f.meta.translation.split(/\s/)[0] : '';
      var pt = TR.test(tn) ? await getText(file.replace(/[^/]*$/, '') + tn).catch(function () { return null; }) : null;
      return { en: en.text, pt: pt ? pt.text : null };
    }
    var readme = { en: fm, pt: null }, rp = await pair(ROOT + 'README.md');
    if (rp && rp.pt) readme.pt = frontMatter(rp.pt);
    var header = bar('', '', false);
    root.appendChild(header);
    var main = document.createElement('div'); main.className = 'home';
    root.appendChild(main);
    var hero = document.createElement('section'); hero.className = 'hero'; main.appendChild(hero);
    var tabs = document.createElement('nav'); tabs.className = 'tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Sections');
    main.appendChild(tabs);
    var panes = { overview: document.createElement('section'), work: document.createElement('section'), changelog: document.createElement('section') };
    Object.keys(panes).forEach(function (k) { var p = panes[k]; p.className = 'pane'; p.id = 'pane-' + k; p.setAttribute('role', 'tabpanel'); p.hidden = true; main.appendChild(p); });
    panes.overview.innerHTML = '<p class="status-msg">Reading docs/work/…</p>';
    var foot = document.createElement('p'); foot.className = 'foot noprint'; main.appendChild(foot);

    var names = await listItems();
    var results = await Promise.all([loadExtras(), Promise.all(names.map(function (n) { return loadItem(n).catch(function () { return null; }); })), pair(BASE + 'CHANGELOG.md')]);
    var items = results[1].filter(Boolean), clog = results[2];
    var order = { progress: 0, planned: 1, shipped: 2 };
    items.sort(function (a, b) { return order[a.group] - order[b.group] || (b.here - a.here) || ((b.released || b.created || 0) - (a.released || a.created || 0)); });
    var tab = ['overview', 'work', 'changelog'].indexOf(location.hash.slice(1)) >= 0 ? location.hash.slice(1) : 'overview';
    var filter = 'all', query = '';

    function draw() {
      var f = lang === 'pt' && readme.pt ? readme.pt : readme.en, M = Object.assign({}, fm.meta, f.meta);
      var title = M.title || 'SDLC documents';
      document.title = title;
      header.querySelector('.title b').textContent = title;
      header.querySelector('.title span').textContent = M.repo || 'docs/work/';
      var versions = clog ? parseChangelog(lang === 'pt' && clog.pt ? clog.pt : clog.en, items) : [];
      var latest = versions.find(function (v) { return !isNaN(v.date); });
      var count = function (g) { return items.filter(function (it) { return it.group === g && it.kind !== 'milestone'; }).length; };
      var leads = items.map(function (it) { return it.lead; }).filter(function (x) { return x != null; });
      var med = median(leads);
      hero.innerHTML = '<div class="hero-in"><div class="hero-text">' + (M.kicker ? '<span class="kicker"></span>' : '') + '<h1></h1><p class="tagline"></p><div class="intro"></div>' + (M.generated_by ? '<p class="prov"></p>' : '') + '</div>' +
        '<dl class="stats">' +
        '<div class="stat s-progress"><dt>In progress</dt><dd>' + count('progress') + '</dd></div>' +
        '<div class="stat s-planned"><dt>Planned</dt><dd>' + count('planned') + '</dd></div>' +
        '<div class="stat s-shipped"><dt>Shipped</dt><dd>' + count('shipped') + '</dd></div>' +
        (latest ? '<div class="stat wide ' + (med != null ? 'span2' : 'span3') + '"><dt>Latest release</dt><dd>' + esc(latest.version) + '<small>' + shortDate(latest.date) + ' · ' + ago(latest.date) + '</small></dd></div>' : '<div class="stat wide ' + (med != null ? 'span2' : 'span3') + '"><dt>Latest release</dt><dd>—<small>No release recorded yet</small></dd></div>') +
        (med != null ? '<div class="stat wide span1"><dt>Median lead time</dt><dd>' + days(med) + '<small>intent to release</small></dd></div>' : '') +
        (ACT && ACT.weeks ? activityTile(ACT) : '') +
        '</dl></div>';
      hero.querySelector('h1').textContent = title;
      hero.querySelector('.tagline').textContent = M.tagline || '';
      if (M.kicker) hero.querySelector('.kicker').textContent = M.kicker;
      if (M.generated_by) hero.querySelector('.prov').textContent = 'Written by ' + M.generated_by + '. Edit docs/work/README.md to change it.';
      if (f.body.trim()) hero.querySelector('.intro').appendChild(render(f.body, { prefix: 'readme', base: ROOT }).el);

      tabs.innerHTML = [['overview', 'Overview', ''], ['work', 'Work', items.length], ['changelog', 'Changelog', versions.filter(function (v) { return !isNaN(v.date); }).length]].map(function (t) {
        return '<button type="button" role="tab" id="tab-' + t[0] + '" aria-controls="pane-' + t[0] + '" aria-selected="' + (t[0] === tab) + '" tabindex="' + (t[0] === tab ? 0 : -1) + '" data-tab="' + t[0] + '">' + t[1] + (t[2] !== '' ? '<span class="n">' + t[2] + '</span>' : '') + '</button>';
      }).join('');
      tabs.querySelectorAll('[role=tab]').forEach(function (b) { b.addEventListener('click', function () { select(b.dataset.tab, true); }); });

      // Overview
      if (!items.length && !versions.length) panes.overview.innerHTML = emptyWork();
      else panes.overview.innerHTML = spine(items, versions) + (stageChart(items) ? '<div class="shipped-row solo">' + stageChart(items) + '</div>' : '');
      panes.overview.querySelectorAll('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { select(b.dataset.goto, true); window.scrollTo({ top: tabs.offsetTop - 70, behavior: 'smooth' }); }); });
      var tip = document.createElement('div'); tip.className = 'ctip'; tip.hidden = true; panes.overview.appendChild(tip);
      panes.overview.querySelectorAll('.seg').forEach(function (seg) {
        seg.addEventListener('mouseenter', function () { tip.textContent = seg.dataset.tip; tip.hidden = false; });
        seg.addEventListener('mousemove', function (e) { var r = panes.overview.getBoundingClientRect(); tip.style.left = (e.clientX - r.left + 12) + 'px'; tip.style.top = (e.clientY - r.top + 14) + 'px'; });
        seg.addEventListener('mouseleave', function () { tip.hidden = true; });
      });

      // Work
      panes.work.innerHTML = '<div class="wtools"><div class="chips" role="group" aria-label="Filter by state">' +
        [['all', 'All', items.length], ['progress', 'In progress', count('progress')], ['planned', 'Planned', count('planned')], ['shipped', 'Shipped', count('shipped')]].map(function (c) {
          return '<button type="button" class="chip c-' + c[0] + '" data-f="' + c[0] + '" aria-pressed="' + (c[0] === filter) + '"><i aria-hidden="true"></i>' + c[1] + '<span>' + c[2] + '</span></button>';
        }).join('') + '</div><label class="search" for="work-q"><span class="sr">Search items</span><input id="work-q" type="search" placeholder="Search items, issues, versions" autocomplete="off"></label></div>' +
        '<div class="wlist"></div>';
      var q = panes.work.querySelector('#work-q'); q.value = query;
      function list() {
        var shown = items.filter(function (it) {
          if (filter !== 'all' && it.group !== filter) return false;
          if (!query) return true;
          return (it.title.en + ' ' + it.title.pt + ' ' + it.name + ' ' + it.issue + ' ' + it.release + ' ' + it.target).toLowerCase().indexOf(query.toLowerCase()) >= 0;
        });
        panes.work.querySelector('.wlist').innerHTML = placeAfter(shown).map(cardBlock).join('') || (items.length ? '<p class="none">No item matches.</p>' : '<p class="none">No work items yet: the first one appears when a workflow writes its <code>intent.md</code>.</p>');
        bindCards(panes.work);
      }
      panes.work.querySelectorAll('.chip').forEach(function (c) { c.addEventListener('click', function () { filter = c.dataset.f; panes.work.querySelectorAll('.chip').forEach(function (x) { x.setAttribute('aria-pressed', x === c); }); list(); }); });
      q.addEventListener('input', function () { query = q.value.trim(); list(); });
      list();

      // Changelog
      panes.changelog.innerHTML = '';
      if (versions.length) panes.changelog.appendChild(changelogHtml(versions, items.filter(function (it) { return it.kind === 'milestone'; })));
      else panes.changelog.innerHTML = '<div class="empty-state"><span class="kicker">Changelog</span><h3>No release recorded yet</h3><p>The <code>release</code> workflow adds each version to <code>CHANGELOG.md</code> when someone ships it at the Ship gate, with the items that went in. A repository that already has tags can generate the history from them, in a run you approve.</p></div>';

      bindCards(main);
      foot.innerHTML = 'Read from <code>docs/work/</code> and <code>CHANGELOG.md</code>' + (M.repo ? ' in <a href="https://github.com/' + esc(M.repo) + '" target="_blank" rel="noopener noreferrer">' + esc(M.repo) + '</a>' : '') + ', rendered in your browser.';
      select(tab, false);
    }
    function bindCards(host) { host.querySelectorAll('a.wcard,a.cl,a.ichip').forEach(function (a) { if (a.dataset.bound) return; a.dataset.bound = 1; a.addEventListener('click', function () { var m = a.getAttribute('href').match(/item=([^&]+)/); if (m) store.set('last-item', decodeURIComponent(m[1])); }); }); }
    function select(t, push) {
      tab = t;
      tabs.querySelectorAll('[role=tab]').forEach(function (b) { var on = b.dataset.tab === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
      Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== t; });
      if (push) try { history.replaceState(null, '', location.pathname + location.search + '#' + t); } catch (e) { /* sandboxed */ }
    }
    tabs.addEventListener('keydown', function (e) {
      var keys = ['overview', 'work', 'changelog'], i = keys.indexOf(tab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); select(keys[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3], true); tabs.querySelector('[aria-selected="true"]').focus(); }
    });
    header.querySelector('.actions').prepend(langSwitch(draw));
    draw();
    // the tabs stick under the bar, whatever its height
    var measure = function () { document.documentElement.style.setProperty('--bar', header.offsetHeight + 'px'); };
    measure(); window.addEventListener('resize', measure);
    window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (panes[h]) select(h, false); });
  }

  function bar(title, sub, withBack) {
    var header = document.createElement('header'); header.className = 'bar';
    header.innerHTML = '<div class="bar-in">' + (withBack ? '<a class="ibtn" href="' + HOME + '" aria-label="All items">' + ICON.back + '</a>' : '') +
      '<div class="title"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div><div class="flow-slot" hidden></div>' +
      '<div class="actions"><button class="ibtn" type="button" data-appearance></button></div></div>';
    appearance(header.querySelector('[data-appearance]'));
    return header;
  }

  // ---------- item ----------
  // A milestone's page: its one document, with the front matter, the source and the EN/PT switch.
  function milestonePage(root, it) {
    var header = bar(it.title[lang], 'docs/work/' + it.name + '/', true);
    var main = document.createElement('div'); main.className = 'home mpage';
    function draw() {
      header.querySelector('.title b').textContent = document.title = it.title[lang];
      var d = lang === 'pt' && it.doc.pt ? it.doc.pt : it.doc.en, isTr = d !== it.doc.en;
      var r = render(d.body, { prefix: 'milestone', base: it.base, takeTitle: true });
      var keys = Object.keys(d.meta).filter(function (k) { return k !== 'kind'; });
      main.innerHTML = '<article class="panel" lang="' + (isTr ? 'pt-BR' : 'en') + '"><div class="eyebrow">Milestone · ' + esc(d.file) + ' · <span class="kind">' + (isTr ? 'translation' : 'source') + '</span></div><h1></h1>' +
        '<p class="mwhen big">' + milestoneWhen(it) + '</p>' +
        (lang === 'pt' && !it.doc.pt ? '<p class="notice" lang="en"><b>Translation missing.</b> No pt-BR translation for this file; showing the English source.</p>' : '') +
        '<dl class="meta">' + keys.map(function (k) { var v = Array.isArray(d.meta[k]) ? d.meta[k].join(', ') : d.meta[k]; return '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + (d.hints[k] ? '<small>' + esc(d.hints[k]) + '</small>' : '') + '</dd></div>'; }).join('') + '</dl></article>';
      main.querySelector('h1').textContent = r.title || it.title[lang];
      r.el.className = 'doc'; main.querySelector('article').appendChild(r.el);
      var raw = document.createElement('details'); raw.className = 'raw';
      raw.innerHTML = '<summary>Markdown source: ' + esc(d.file) + ' (what is committed)</summary><pre></pre>';
      raw.querySelector('pre').textContent = d.raw;
      main.querySelector('article').appendChild(raw);
    }
    header.querySelector('.actions').before(langSwitch(draw));
    root.appendChild(header); root.appendChild(main);
    draw();
  }

  // The item's issue on GitHub and the pull requests that name it (the item page's left rail).
  function issueHtml(it) {
    var g = ghIssue(it);
    if (!g) return '';
    var link = function (x, label) { return GH.private ? esc(label) : '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>'; };
    return '<b class="ihead">On GitHub</b><ul class="hist"><li><span><i class="st st-' + g.state + '"></i>' + link(g, 'Issue #' + g.number) + '</span><span>' + g.state + '</span><span></span></li>' +
      (g.prs || []).slice(0, 5).map(function (pr) { return '<li><span>' + link(pr, 'PR #' + pr.number) + '</span><span>' + pr.state + '</span><span></span></li>'; }).join('') + '</ul>' + subsHtml(it);
  }

  async function item() {
    var root = document.getElementById('app');
    // ?item= names the item; the last one opened from the list covers a host that drops the query string
    var params = new URLSearchParams(location.search), name = params.get('item') || store.get('last-item') || '';
    await loadConfig();
    if (!SAFE.test(name)) { root.innerHTML = '<p class="status-msg">Pick an item on the <a href="' + HOME + '">list</a>.</p>'; return; }
    await listItems().catch(function () { return []; });   // marks the milestones
    var it = await loadItem(name);
    await loadExtras();
    if (!it) { root.innerHTML = '<p class="status-msg">No markdown found in <code>docs/work/' + esc(name) + '/</code>. <a href="' + HOME + '">All items</a></p>'; return; }
    if (it.kind === 'milestone') { milestonePage(root, it); return; }
    document.title = it.title[lang];
    var header = bar(it.title[lang], 'docs/work/' + it.name + '/', true);
    var flow = document.createElement('nav'); flow.className = 'flow'; flow.setAttribute('aria-label', 'AI-native SDLC stages');
    flow.innerHTML = it.stages.map(function (s, i) {
      return (i ? '<span class="flow-arrow" aria-hidden="true">→</span>' : '') + '<a class="stage' + (s.past ? ' past' : '') + (s.here ? ' here' : '') + (s.missing ? ' missing' : '') + '" href="#' + s.f + '" data-tab="' + s.f + '"><span class="st-num">' + (i + 1) + '</span><span class="st-text"><span class="st-name">' + s.name + '</span><span class="st-file">' + s.f + '.md</span></span>' + pill(s) + '</a>';
    }).join('');
    header.querySelector('.flow-slot').replaceWith(flow);
    var pdf = document.createElement('button'); pdf.className = 'ibtn'; pdf.type = 'button'; pdf.setAttribute('aria-label', 'Export PDF');
    pdf.innerHTML = ICON.pdf + '<span class="lbl">Export PDF</span>';
    header.querySelector('.actions').appendChild(pdf);
    var langEl = langSwitch(function () { header.querySelector('.title b').textContent = document.title = it.title[lang]; document.dispatchEvent(new CustomEvent('reader:lang')); });
    header.querySelector('.actions').before(langEl);
    root.appendChild(header);

    var mbar = document.createElement('div'); mbar.className = 'mbar';
    mbar.innerHTML = '<button class="ibtn burger" type="button" aria-label="Open the index" aria-expanded="false" aria-controls="drawer">' + ICON.menu + '</button><div class="mcur" aria-live="polite"><small></small><span></span></div>';
    var scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.setAttribute('data-close', '');
    var drawerEl = document.createElement('aside'); drawerEl.className = 'drawer'; drawerEl.id = 'drawer'; drawerEl.setAttribute('aria-label', 'Index'); drawerEl.setAttribute('aria-hidden', 'true'); drawerEl.inert = true;
    drawerEl.innerHTML = '<div class="drawer-head"><b>Index</b><button class="ibtn" type="button" data-close aria-label="Close the index">' + ICON.close + '</button></div>';
    var layout = document.createElement('div'); layout.className = 'layout';
    var left = document.createElement('aside'); left.className = 'left';
    var main = document.createElement('main');
    layout.appendChild(left); layout.appendChild(main);
    root.appendChild(mbar); root.appendChild(scrim); root.appendChild(drawerEl); root.appendChild(layout);

    it.stages.forEach(function (s) {
      ['en', 'pt'].forEach(function (lg) {
        // PT without a translation falls back to the source, saying so
        var d = lg === 'pt' && s.tr ? s.tr : s, isTr = d !== s, fallback = lg === 'pt' && !s.tr && !s.missing;
        var key = s.f + (lg === 'pt' ? '@pt' : ''), prefix = (lg === 'pt' ? 'pt-' : '') + s.f;
        var r = s.missing ? { el: document.createElement('div'), title: '', toc: [] } : render(d.body, { prefix: prefix, base: it.base, takeTitle: true, onStageLink: true });
        var panel = document.createElement('article'); panel.className = 'panel'; panel.dataset.panel = key; panel.hidden = true;
        panel.lang = isTr ? 'pt-BR' : 'en'; panel.dataset.lang = lg;
        panel.setAttribute('aria-labelledby', prefix + '-title');
        var h = s.missing ? s.name + ': not written yet' : r.title;
        panel.innerHTML = '<div class="print-head">' + esc(it.title[lg]) + ' · docs/work/' + esc(it.name) + '/' + (d.file || s.f + '.md') + '</div>' +
          '<div class="eyebrow">' + s.name + ' · ' + esc(d.file || s.f + '.md') + (s.missing ? '' : ' · <span class="kind">' + (isTr ? 'translation' : 'source') + '</span>') + (s.here ? ' · you are here' : '') + '</div><h1 id="' + prefix + '-title">' + esc(h) + '</h1>';
        if (fallback) panel.insertAdjacentHTML('beforeend', '<p class="notice" lang="en"><b>Translation missing.</b> ' + (s.trMissing ? esc(s.trMissing) + ' is named in the front matter but does not exist; ' : 'No pt-BR translation for this file; ') + 'showing the English source.</p>');
        if (s.missing) {
          panel.insertAdjacentHTML('beforeend', '<div class="empty" lang="en"><b>' + s.f + '.md does not exist yet.</b><br>' + esc(s.fills) + '</div>');
        } else {
          var keys = Object.keys(d.meta).filter(function (k) { return k !== 'item'; });
          if (keys.length) panel.insertAdjacentHTML('beforeend', '<dl class="meta">' + keys.map(function (k) {
            var v = Array.isArray(d.meta[k]) ? d.meta[k].join(', ') : d.meta[k];
            return '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + (d.hints[k] ? '<small>' + esc(d.hints[k]) + '</small>' : '') + '</dd></div>';
          }).join('') + '</dl>');
          r.el.className = 'doc'; panel.appendChild(r.el);
          var raw = document.createElement('details'); raw.className = 'raw'; raw.id = prefix + '-source';
          raw.innerHTML = '<summary>Markdown source: ' + esc(d.file) + ' (what is committed)</summary><pre></pre>';
          raw.querySelector('pre').textContent = d.raw;
          panel.appendChild(raw);
        }
        main.appendChild(panel);
        var tocHtml = '<b>' + s.name + ' · ' + esc(d.file || s.f + '.md') + '</b><a class="l2" href="#' + prefix + '-title">' + esc(s.missing ? 'Not written yet' : cleanTitle(r.title)) + '</a>' +
          r.toc.map(function (t) { return '<a class="l' + t.lvl + '" href="#' + t.id + '">' + esc(t.t) + '</a>'; }).join('') +
          (s.missing ? '' : '<a class="l2" href="#' + prefix + '-source">Markdown source</a>');
        var toc = document.createElement('nav'); toc.className = 'toc'; toc.dataset.toc = key; toc.hidden = true; toc.setAttribute('aria-label', 'Index of ' + (d.file || s.f + '.md')); toc.innerHTML = tocHtml;
        left.appendChild(toc);
        var dtoc = toc.cloneNode(true); dtoc.className = 'toc dtoc'; delete dtoc.dataset.toc; dtoc.dataset.dtoc = key;
        drawerEl.appendChild(dtoc);
      });
    });
    left.insertAdjacentHTML('beforeend', '<div class="loopnote"><b>History</b>' + historyHtml(it) + issueHtml(it) + '</div>');

    wire(it, pdf);
  }

  function wire(it, pdfBtn) {
    var current = it.stages[it.here].f, links = [], targets = [], ticking = false, idxOn = 0;
    function key() { return current + (lang === 'pt' ? '@pt' : ''); }
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var mobile = function () { return window.innerWidth <= 760; };
    var barEl = document.querySelector('.bar'), mbarEl = document.querySelector('.mbar'), burger = mbarEl.querySelector('.burger'), drawerEl = document.getElementById('drawer');
    function measure() { document.documentElement.style.setProperty('--bar', barEl.offsetHeight + 'px'); }
    function barH() { return barEl.offsetHeight + (mobile() ? mbarEl.offsetHeight : 0); }
    function collect() {
      links = [].slice.call(document.querySelectorAll('.toc:not(.dtoc)[data-toc="' + key() + '"] a'));
      targets = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
    }
    function mark() {
      ticking = false;
      var line = barH() + 24, idx = 0;
      for (var i = 0; i < targets.length; i++) if (targets[i] && targets[i].getBoundingClientRect().top - line <= 0) idx = i;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) idx = targets.length - 1;
      idxOn = idx;
      links.forEach(function (a, i) { a.classList.toggle('on', i === idx); if (i === idx) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
      var cur = links[idx], mc = mbarEl.querySelector('.mcur');
      if (cur) { mc.querySelector('small').textContent = document.querySelector('.toc[data-toc="' + key() + '"] b').textContent; mc.querySelector('span').textContent = cur.textContent; }
      document.querySelectorAll('.dtoc[data-dtoc="' + key() + '"] a').forEach(function (a, i) { a.classList.toggle('on', i === idx); });
      var toc = cur && cur.parentNode;
      if (cur && toc && !mobile()) {
        var r = cur.getBoundingClientRect(), t = toc.getBoundingClientRect();
        if (r.top < t.top + 40 || r.bottom > t.bottom - 40) toc.scrollTop += r.top - t.top - t.height / 3;
      }
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(mark); } }, { passive: true });
    window.addEventListener('resize', function () { measure(); requestAnimationFrame(mark); });

    function drawer(open) {
      document.body.classList.toggle('drawer-open', open);
      burger.setAttribute('aria-expanded', open); drawerEl.setAttribute('aria-hidden', !open); drawerEl.inert = !open;
      if (open) { var on = document.querySelector('.dtoc:not([hidden]) a.on') || document.querySelector('.dtoc:not([hidden]) a'); if (on) { on.scrollIntoView({ block: 'center' }); on.focus({ preventScroll: true }); } }
      else burger.focus({ preventScroll: true });
    }
    burger.addEventListener('click', function () { drawer(true); });
    document.querySelectorAll('[data-close]').forEach(function (el) { el.addEventListener('click', function () { drawer(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) drawer(false); });

    function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function go(el) {
      if (el.tagName === 'DETAILS') el.open = true;
      var y = el.getBoundingClientRect().top + window.scrollY - barH() - 16;
      if (reduce) { window.scrollTo(0, y); return; }
      var from = window.scrollY, dist = y - from, dur = Math.min(650, Math.max(320, Math.abs(dist) / 4)), t0 = null;
      function step(ts) { if (t0 === null) t0 = ts; var k = Math.min(1, (ts - t0) / dur); window.scrollTo(0, from + dist * ease(k)); if (k < 1) requestAnimationFrame(step); else { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); mark(); } }
      requestAnimationFrame(step);
    }
    function setHash(h) { try { history.replaceState(null, '', location.pathname + location.search + '#' + h); } catch (x) { /* sandboxed */ } }
    function show(tab) {
      current = tab;
      var flow = document.querySelector('.flow');
      document.querySelectorAll('.stage').forEach(function (a) {
        a.setAttribute('aria-current', a.dataset.tab === tab);
        // on a narrow bar the strip scrolls: keep the open stage in it
        if (a.dataset.tab === tab && flow.scrollWidth > flow.clientWidth) flow.scrollLeft = a.offsetLeft - flow.offsetLeft - (flow.clientWidth - a.offsetWidth) / 2;
      });
      var k = key();
      document.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.dataset.panel !== k; });
      document.querySelectorAll('.toc:not(.dtoc)').forEach(function (n) { n.hidden = n.dataset.toc !== k; });
      document.querySelectorAll('.dtoc').forEach(function (n) { n.hidden = n.dataset.dtoc !== k; });
      collect(); mark();
    }
    document.addEventListener('reader:lang', function () {
      var at = idxOn, atTop = window.scrollY < 4;
      show(current);
      var t = targets[Math.min(at, targets.length - 1)];
      if (!atTop && t) window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - barH() - 16);
      mark();
    });
    function openStage(tab) { show(tab); window.scrollTo(0, 0); mark(); setHash(tab); }
    document.querySelectorAll('.stage').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); openStage(a.dataset.tab); }); });
    document.querySelectorAll('.doc a[data-stage]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); openStage(a.dataset.stage); }); });
    document.querySelectorAll('.toc a, .doc a[href^="#"]:not([data-stage])').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href').slice(1), t = document.getElementById(id);
        if (!t) return;
        e.preventDefault(); setHash(id);
        if (a.closest('.drawer')) { drawer(false); setTimeout(function () { go(t); }, reduce ? 0 : 180); }
        else { links.forEach(function (x) { x.classList.toggle('on', x === a); }); go(t); }
      });
    });

    // Export PDF: the open stage or the whole item, through the print stylesheet.
    popover(pdfBtn, function (pop, close) {
      pop.className = 'pop menu';
      pop.innerHTML = '<h3>Export PDF</h3><button type="button" data-p="stage">This stage<small>Only the open stage, ' + current + '.md</small></button><button type="button" data-p="all">Whole item<small>All six stages, one per page</small></button>' +
        '<p>Opens the print dialog: choose "Save as PDF".</p>';
      pop.querySelectorAll('[data-p]').forEach(function (b) {
        b.addEventListener('click', function () {
          close();
          document.body.classList.toggle('print-all', b.dataset.p === 'all'); document.body.dataset.lang = lang;
          try { window.print(); } catch (e) { /* blocked in sandboxed frames */ }
        });
      });
    });
    window.addEventListener('afterprint', function () { document.body.classList.remove('print-all'); });

    measure();
    var h = decodeURIComponent((location.hash || '').slice(1));
    var tabs = it.stages.map(function (s) { return s.f; });
    if (tabs.indexOf(h) >= 0) show(h);
    else {
      var hid = h.replace(/^pt-/, ''), sec = h && document.getElementById((lang === 'pt' ? 'pt-' : '') + hid), panel = sec && sec.closest('.panel');
      if (panel) current = panel.dataset.panel.replace('@pt', '');
      show(current);
      if (panel) {
        // a deep link (#spec-r9): load the images above the target first, so the scroll lands on it
        var imgs = [].slice.call(panel.querySelectorAll('img')).filter(function (img) { return img.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING; });
        imgs.forEach(function (img) { img.loading = 'eager'; });
        var land = function () { window.scrollTo(0, sec.getBoundingClientRect().top + window.scrollY - barH() - 16); mark(); };
        land();
        Promise.race([Promise.all(imgs.map(function (img) { return img.complete ? 0 : new Promise(function (ok) { img.onload = img.onerror = ok; }); })), new Promise(function (ok) { setTimeout(ok, 2500); })]).then(land);
      }
    }
  }

  window.SdlcReader = { home: home, item: item };
})();
