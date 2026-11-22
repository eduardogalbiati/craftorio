#!/usr/bin/env node
// Proof of concept: the README as a static documentation site (a docs.balena.io-like layout: the
// pages on the left, the content in the middle, the page's sections on the right), in the app's
// dark theme (the tokens of packages/ui-kit/style.css).
//
//   node poc/docs-site/build.js [--out build/docs-site]
//
// Source: the assembled README.md (so the generated blocks are filled in). One page per `## `
// section; the `### ` headings of a page are its right-hand table of contents. The sidebar groups
// the pages by the map below; a workflow section (`## Name (workflows/x.yaml)`) goes to Workflows
// without being listed. In-README anchors (`#slug`) are rewritten to `page.html#slug`; relative
// links to repository files point at GitHub. Not part of the app: no test or lint walks it.
//
// Languages: the site is written once per language (`en/`, `pt/`; the root index redirects to
// English). The chrome (groups, labels) comes from STRINGS; a page's content comes from
// `i18n/<lang>/<page>.md` when that file exists (first line `# Title`, then the body), else from
// the English README with a "not translated yet" notice. The README's own language is English.
'use strict';
const fs = require('fs');
const path = require('path');
const { Marked } = require('marked');

const root = path.resolve(__dirname, '..', '..');
const outArg = process.argv.indexOf('--out');
const outDir = path.resolve(root, outArg > 0 ? process.argv[outArg + 1] : 'build/docs-site');
const REPO = 'https://github.com/eduardogalbiati/craftorio';
const LANGS = ['en', 'pt'];
const STRINGS = {
  en: {
    name: 'English', docs: 'docs', filter: 'Filter pages…', onThisPage: 'On this page', previous: 'Previous', next: 'Next',
    copy: 'Copy', copied: 'Copied', menu: 'Menu', more: (n) => `and ${n} more…`, less: 'show fewer', documentation: 'Documentation',
    notTranslated: 'This page is not translated yet; it is shown in English.',
    groups: { 'Getting started': 'Getting started', Workflows: 'Workflows', 'Skills and engine': 'Skills and engine', Operations: 'Operations', Reference: 'Reference' },
    about: {
      'Getting started': 'Install the app, the first run, your account and what the app may touch.',
      Workflows: 'The bundled workflows: what each one does, its agents and gates.',
      'Skills and engine': 'Skills, the supervisor, the Oracle, worktrees and how a run ends.',
      Operations: 'CI/CD, providers and budgets, sessions, the CLIs and the workspace.',
      Reference: 'Your repository\'s AGENTS.md, the code structure, contributing, license.',
    },
    viewAll: 'All pages',
  },
  pt: {
    name: 'Português', docs: 'docs', filter: 'Filtrar páginas…', onThisPage: 'Nesta página', previous: 'Anterior', next: 'Próxima',
    copy: 'Copiar', copied: 'Copiado', menu: 'Menu', more: (n) => `e mais ${n}…`, less: 'mostrar menos', documentation: 'Documentação',
    notTranslated: 'Esta página ainda não foi traduzida; está em inglês.',
    groups: { 'Getting started': 'Primeiros passos', Workflows: 'Workflows', 'Skills and engine': 'Skills e engine', Operations: 'Operação', Reference: 'Referência' },
    about: {
      'Getting started': 'Instalar o app, a primeira run, sua conta e o que o app pode tocar.',
      Workflows: 'Os workflows incluídos: o que cada um faz, seus agentes e gates.',
      'Skills and engine': 'Skills, o supervisor, o Oracle, worktrees e como uma run termina.',
      Operations: 'CI/CD, provedores e orçamentos, sessões, as CLIs e o workspace.',
      Reference: 'O AGENTS.md do seu repositório, a estrutura do código, contribuição, licença.',
    },
    viewAll: 'Todas as páginas',
  },
};
const BLOB = `${REPO}/blob/main/`;

// ---------- sidebar groups: section title → group (a title not listed goes to "Reference") ----------
const GROUPS = [
  ['Getting started', ['Running', 'Install', 'Account and privacy', 'Workflows, skills and seeds are code', 'Security model']],
  ['Workflows', ['Visual builder', 'Workflows in your repository', 'Ways of working: an interview that writes your workflows']],
  ['Skills and engine', ['Skills']],
  ['Operations', ['CI/CD', 'Providers, availability and budgets', 'How sessions are opened (no tmux)', 'Installing the CLIs on Windows', 'Voice input', 'Workspace', 'Observability']],
  ['Reference', ['Structuring your repository\'s CLAUDE.md', 'Structure', 'Contributing', 'License']],
];
const WORKFLOW_RE = /\(`workflows\/[^`]+\.yaml`\)\s*$/;

// ---------- split the README into pages ----------
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
const lines = readme.split('\n');
const pages = [];
let intro = [];
let current = null;
let fence = false;
for (const line of lines) {
  if (/^```/.test(line)) fence = !fence;
  if (!fence && /^## /.test(line)) {
    current = { title: inlineText(line.slice(3).trim()), raw: line.slice(3).trim(), body: [] };
    pages.push(current);
    continue;
  }
  (current ? current.body : intro).push(line);
}

// ---------- slugs (GitHub style, unique per document) ----------
function slugger() {
  const seen = new Map();
  return (text) => {
    let s = text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
    const n = seen.get(s) || 0;
    seen.set(s, n + 1);
    return n ? `${s}-${n}` : s;
  };
}
function inlineText(md) {
  return md.replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]*)\*\*/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}
function fileOf(title) {
  return title.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.html';
}

// The README is one document: an anchor `#slug` is unique across it, so slugs are computed in
// README order once, then every page knows which file an anchor lives in.
const readmeSlug = slugger();
const anchorToPage = new Map();
pages.forEach((p) => {
  p.file = fileOf(p.title);
  p.slug = readmeSlug(p.title);
  anchorToPage.set(p.slug, p.file);
  p.headings = [];
  let inFence = false;
  for (const l of p.body) {
    if (/^```/.test(l)) inFence = !inFence;
    const m = !inFence && /^(###+) (.*)$/.exec(l);
    if (m) {
      const text = inlineText(m[2].trim());
      const slug = readmeSlug(text);
      p.headings.push({ depth: m[1].length, text, slug });
      anchorToPage.set(slug, p.file);
    }
  }
});
pages.forEach((p) => { p.group = groupOf(p); });
function groupOf(p) {
  for (const [g, titles] of GROUPS) if (titles.includes(p.title)) return g;
  if (WORKFLOW_RE.test(p.raw)) return 'Workflows';
  return 'Reference';
}
const groups = GROUPS.map(([name]) => ({ name, pages: pages.filter((p) => p.group === name) }));

// ---------- translations: i18n/<lang>/<page>.md → { title, body, headings } ----------
function translation(lang, file) {
  const p = path.join(__dirname, 'i18n', lang, file.replace(/\.html$/, '.md'));
  if (lang === 'en' || !fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const title = text[0].replace(/^#\s*/, '').trim();
  const body = text.slice(1);
  const slug = slugger();
  slug(title);
  const headings = [];
  let inFence = false;
  for (const l of body) {
    if (/^```/.test(l)) inFence = !inFence;
    const m = !inFence && /^(###+) (.*)$/.exec(l);
    if (m) headings.push({ depth: m[1].length, text: inlineText(m[2].trim()), slug: slug(inlineText(m[2].trim())) });
  }
  return { title, body, headings };
}
// a page as shown in one language: the translation when there is one, else the English README
function localized(page, lang) {
  const t = translation(lang, page.file);
  return t ? { ...page, ...t, translated: true } : { ...page, translated: lang === 'en' };
}

// ---------- markdown → HTML ----------
function renderPage(page, lang) {
  const slug = slugger();
  slug(page.title); // the h2's own slug comes first, as in the README
  const renderer = {
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens);
      const text = inlineText(tokens.map((t) => t.raw).join(''));
      const id = slug(text);
      const h = depth; // the page keeps the README's levels: ### stays h3
      return `<h${h} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to ${escapeHtml(text)}">#</a>${html}</h${h}>\n`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      let target = href;
      if (href.startsWith('#')) {
        const file = anchorToPage.get(href.slice(1));
        if (file && file !== page.file) target = `${file}${href}`;
      } else if (!/^[a-z]+:/i.test(href)) {
        target = BLOB + href.replace(/^\.?\//, '');
      }
      const ext = /^[a-z]+:/i.test(target) ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${target}"${title ? ` title="${escapeHtml(title)}"` : ''}${ext}>${text}</a>`;
    },
    image({ href, text }) {
      let src = href;
      if (!/^[a-z]+:/i.test(href)) {
        const from = path.join(root, href);
        if (fs.existsSync(from)) {
          const to = path.join(outDir, href);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(from, to);
        } else src = BLOB + href;
      }
      return `<img src="${src}" alt="${escapeHtml(text || '')}" loading="lazy">`;
    },
    code({ text, lang: fenceLang }) {
      const cls = fenceLang ? ` class="language-${fenceLang}"` : '';
      return `<div class="code"><button class="copy" type="button" data-copied="${STRINGS[lang].copied}">${STRINGS[lang].copy}</button><pre><code${cls}>${escapeHtml(text)}</code></pre></div>\n`;
    },
  };
  const md = new Marked({ gfm: true, renderer });
  return md.parse(page.body.join('\n'));
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- layout ----------
function sidebar(active, lang) {
  return groups.filter((g) => g.pages.length).map((g) => `
      <div class="nav-group${g.pages.some((p) => p === active) ? ' open' : ''}">
        <button class="nav-group-title" type="button" aria-expanded="${g.pages.some((p) => p === active)}">${escapeHtml(STRINGS[lang].groups[g.name] || g.name)}<span class="chev"></span></button>
        <ul>${g.pages.map((p) => `
          <li><a href="${p.file}"${p === active ? ' class="active" aria-current="page"' : ''}>${escapeHtml(shortTitle(localized(p, lang)))}</a></li>`).join('')}
        </ul>
      </div>`).join('');
}
function shortTitle(p) {
  return p.title.replace(/\s*\(workflows\/[^)]+\)\s*$/, '');
}
function toc(page, lang) {
  if (!page.headings.length) return '';
  const label = STRINGS[lang].onThisPage;
  return `<nav class="toc" aria-label="${label}"><div class="toc-title">${label}</div><ul>${page.headings
    .map((h) => `<li class="d${h.depth}"><a href="#${h.slug}">${escapeHtml(h.text)}</a></li>`).join('')}</ul></nav>`;
}
function prevNext(i, lang) {
  const prev = pages[i - 1] && localized(pages[i - 1], lang);
  const next = pages[i + 1] && localized(pages[i + 1], lang);
  return `<div class="pager">
      ${prev ? `<a class="prev" href="${prev.file}"><span>${STRINGS[lang].previous}</span>${escapeHtml(shortTitle(prev))}</a>` : '<span></span>'}
      ${next ? `<a class="next" href="${next.file}"><span>${STRINGS[lang].next}</span>${escapeHtml(shortTitle(next))}</a>` : '<span></span>'}
    </div>`;
}
function langSwitch(lang, file) {
  return `<div class="lang" role="group" aria-label="Language">${LANGS.map((l) =>
    `<a href="../${l}/${file}"${l === lang ? ' class="active" aria-current="true"' : ''} lang="${l}" title="${STRINGS[l].name}">${l.toUpperCase()}</a>`).join('')}</div>`;
}
function layout({ title, active, main, side, index, lang, file }) {
  const S = STRINGS[lang];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Craftorio docs</title>
<link rel="stylesheet" href="../style.css">
</head>
<body>
<header class="topbar">
  <button class="menu" type="button" aria-label="${S.menu}">☰</button>
  <a class="brand" href="index.html">Multiagent <span>Orchestrator</span><em>${S.docs}</em></a>
  <div class="search"><input id="search" type="search" placeholder="${S.filter}" autocomplete="off"></div>
  <div class="header-right">${langSwitch(lang, file)}<span class="pill pill-running">POC</span><a class="btn" href="${REPO}" target="_blank" rel="noopener">GitHub</a></div>
</header>
<div class="shell">
  <aside class="sidebar" id="sidebar"><nav aria-label="${S.documentation}">${sidebar(active, lang)}</nav></aside>
  <main class="content"><article class="doc">${main}</article>${index === undefined ? '' : prevNext(index, lang)}</main>
  <aside class="aside">${side}</aside>
</div>
<script src="../site.js"></script>
</body>
</html>`;
}

// ---------- write ----------
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'style.css'), path.join(outDir, 'style.css'));
fs.copyFileSync(path.join(__dirname, 'site.js'), path.join(outDir, 'site.js'));

const MAX_CARD = 5;
for (const lang of LANGS) {
  const dir = path.join(outDir, lang);
  fs.mkdirSync(dir, { recursive: true });
  const S = STRINGS[lang];
  pages.forEach((p, i) => {
    const page = localized(p, lang);
    const notice = page.translated ? '' : `<div class="notice">${S.notTranslated}</div>`;
    const yaml = WORKFLOW_RE.test(p.raw) ? `<p class="muted mono small">${escapeHtml(/\(`([^`]+)`\)/.exec(p.raw)[1])}</p>` : '';
    const main = `${notice}<h1>${escapeHtml(shortTitle(page))}</h1>${yaml}${renderPage(page, lang)}`;
    fs.writeFileSync(path.join(dir, p.file), layout({ title: shortTitle(page), active: p, main, side: toc(page, lang), index: i, lang, file: p.file }));
  });

  // index: the README's intro (or its translation), then the groups as cards
  const introT = translation(lang, 'index.html');
  const introMd = introT ? introT.body.join('\n') : intro.join('\n').replace(/^# .*\n/, '');
  const notice = introT || lang === 'en' ? '' : `<div class="notice">${S.notTranslated}</div>`;
  const cards = groups.filter((g) => g.pages.length).map((g) => {
    const items = g.pages.map((p) => `<li><a href="${p.file}" title="${escapeHtml(shortTitle(localized(p, lang)))}">${escapeHtml(shortTitle(localized(p, lang)))}</a></li>`);
    const rest = items.length - MAX_CARD;
    const list = rest > 1 ? items.slice(0, MAX_CARD).join('') : items.join('');
    const footer = rest > 1 ? `<a class="card-all" href="${g.pages[0].file}">${S.viewAll} (${items.length}) →</a>` : '';
    return `
  <section class="card">
    <h2>${escapeHtml(S.groups[g.name] || g.name)}</h2>
    <p>${escapeHtml(S.about[g.name] || '')}</p>
    <ul>${list}</ul>${footer}
  </section>`;
  }).join('');
  fs.writeFileSync(path.join(dir, 'index.html'), layout({
    title: S.documentation, active: null, lang, file: 'index.html',
    main: `${notice}<h1>Craftorio</h1>${new Marked({ gfm: true }).parse(introMd)}<div class="cards">${cards}</div>`,
    side: '',
  }));
}
fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=en/index.html"><a href="en/index.html">English</a> · <a href="pt/index.html">Português</a>\n`);

console.log(`${(pages.length + 1) * LANGS.length} pages (${LANGS.join(', ')}) → ${path.relative(root, outDir)}/`);
