#!/usr/bin/env node
// The documentation site: docs/site/<lang>/*.md → build/docs-site/<lang>/*.html, a static site in the
// app's theme (pages grouped on the left, the content in the middle, the page's sections on the
// right). `npm run docs:site [-- --out <dir>]`; serve the output folder with any static server.
//
// A page is a markdown file with a front matter:
//   ---
//   title: Project structure      (the sidebar entry and the h1)
//   group: Getting started        (a key of GROUPS; the sidebar's groups keep GROUPS' order)
//   description: one line         (the index card; optional)
//   ---
// Pages are ordered by file name (`010-project-structure.md`); the same file name in every language
// is the same page, so the language switch keeps the reader on it. English is the source: a page
// missing in another language is shown in English with a notice. Images live in docs/site/assets/
// and are referenced as `../assets/<file>` (the folder is copied as is); screenshots are JPEGs
// in assets/screens/ (1400px wide, quality 75, from `npm run screenshot`) and open at full size. `##` and `###` headings
// make the right-hand list. In-site links are `<file>.html`; other relative links point at GitHub.
// A `{.class}` paragraph right after a table gives the table that class (`{.map}`: a tight
// name | purpose table).
'use strict';
const fs = require('fs');
const path = require('path');
const { Marked } = require('marked');

const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'docs', 'site');
const outArg = process.argv.indexOf('--out');
const outDir = path.resolve(root, outArg > 0 ? process.argv[outArg + 1] : 'build/docs-site');
const REPO = 'https://github.com/eduardogalbiati/multiagent-orchestrator';
const BLOB = `${REPO}/blob/main/`;
const LANGS = ['en', 'pt'];
const GROUPS = ['Getting started', 'Concepts', 'Workflows', 'Skills', 'Operations', 'Reference'];
const STRINGS = {
  en: {
    name: 'English', docs: 'docs', filter: 'Filter pages…', onThisPage: 'On this page', previous: 'Previous', next: 'Next',
    copy: 'Copy', copied: 'Copied', menu: 'Menu', documentation: 'Documentation', viewAll: 'All pages',
    notTranslated: 'This page is not translated yet; it is shown in English.',
    tagline: 'Multi-agent workflows, defined in YAML, run by Claude Code, Codex CLI and Grok Build on your computer.',
    groups: { 'Getting started': 'Getting started', Concepts: 'Concepts', Workflows: 'Workflows', Skills: 'Skills', Operations: 'Operations', Reference: 'Reference' },
  },
  pt: {
    name: 'Português', docs: 'docs', filter: 'Filtrar páginas…', onThisPage: 'Nesta página', previous: 'Anterior', next: 'Próxima',
    copy: 'Copiar', copied: 'Copiado', menu: 'Menu', documentation: 'Documentação', viewAll: 'Todas as páginas',
    notTranslated: 'Esta página ainda não foi traduzida; está em inglês.',
    tagline: 'Workflows multiagente, definidos em YAML, executados por Claude Code, Codex CLI e Grok Build no seu computador.',
    groups: { 'Getting started': 'Primeiros passos', Concepts: 'Conceitos', Workflows: 'Workflows', Skills: 'Skills', Operations: 'Operação', Reference: 'Referência' },
  },
};

// ---------- pages ----------
function readPage(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) throw new Error(`${path.relative(root, file)}: no front matter`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  if (!meta.title) throw new Error(`${path.relative(root, file)}: no title`);
  if (!GROUPS.includes(meta.group)) throw new Error(`${path.relative(root, file)}: unknown group "${meta.group}" (one of ${GROUPS.join(', ')})`);
  const body = text.slice(m[0].length).split('\n');
  const slug = slugger();
  const headings = [];
  let inFence = false;
  for (const l of body) {
    if (/^```/.test(l)) inFence = !inFence;
    const h = !inFence && /^(##|###) (.*)$/.exec(l);
    if (h) headings.push({ depth: h[1].length, text: inlineText(h[2].trim()), slug: slug(inlineText(h[2].trim())) });
  }
  const name = path.basename(file, '.md');
  return { ...meta, name, file: `${name.replace(/^\d+-/, '')}.html`, body, headings };
}
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
function listPages(lang) {
  const dir = path.join(SRC, lang);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => readPage(path.join(dir, f)));
}
const byLang = Object.fromEntries(LANGS.map((l) => [l, listPages(l)]));
const pages = byLang.en; // the source of truth: the set and order of pages
function localized(page, lang) {
  const t = byLang[lang].find((p) => p.name === page.name);
  return t ? { ...t, translated: true } : { ...page, translated: lang === 'en' };
}
const groups = GROUPS.map((name) => ({ name, pages: pages.filter((p) => p.group === name) })).filter((g) => g.pages.length);

// ---------- markdown → HTML ----------
function render(page, lang) {
  const slug = slugger();
  const renderer = {
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens);
      const text = inlineText(tokens.map((t) => t.raw).join(''));
      const id = slug(text);
      return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to ${escapeHtml(text)}">#</a>${html}</h${depth}>\n`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      let target = href;
      if (!/^[a-z]+:/i.test(href) && !href.startsWith('#') && !/\.html(#|$)/.test(href) && !href.startsWith('../assets/')) {
        target = BLOB + href.replace(/^(\.\.\/)+/, '').replace(/^\.?\//, '');
      }
      const ext = /^[a-z]+:/i.test(target) ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${target}"${title ? ` title="${escapeHtml(title)}"` : ''}${ext}>${text}</a>`;
    },
    image({ href, text, title }) {
      const caption = title ? `<figcaption>${escapeHtml(title)}</figcaption>` : '';
      const img = `<img src="${href}" alt="${escapeHtml(text || '')}" loading="lazy">`;
      // a screenshot opens at full size; a diagram is already at its size
      const body = /\.(png|jpe?g|webp)$/i.test(href) ? `<a class="shot" href="${href}" target="_blank" rel="noopener">${img}</a>` : img;
      return `<figure>${body}${caption}</figure>`;
    },
    code({ text, lang: fenceLang }) {
      const cls = fenceLang ? ` class="language-${fenceLang}"` : '';
      return `<div class="code"><button class="copy" type="button" data-copied="${STRINGS[lang].copied}">${STRINGS[lang].copy}</button><pre><code${cls}>${escapeHtml(text)}</code></pre></div>\n`;
    },
  };
  return new Marked({ gfm: true, renderer }).parse(page.body.join('\n'))
    .replace(/<table>([\s\S]*?)<\/table>\s*<p>\{\.([\w-]+)\}<\/p>/g, '<table class="$2">$1</table>');
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- layout ----------
function sidebar(active, lang) {
  return groups.map((g) => `
      <div class="nav-group${g.pages.some((p) => p.name === active) ? ' open' : ''}">
        <button class="nav-group-title" type="button" aria-expanded="${g.pages.some((p) => p.name === active)}">${escapeHtml(STRINGS[lang].groups[g.name])}<span class="chev"></span></button>
        <ul>${g.pages.map((p) => `
          <li><a href="${p.file}"${p.name === active ? ' class="active" aria-current="page"' : ''}>${escapeHtml(localized(p, lang).title)}</a></li>`).join('')}
        </ul>
      </div>`).join('');
}
function toc(page, lang) {
  if (!page.headings.length) return '';
  const label = STRINGS[lang].onThisPage;
  return `<nav class="toc" aria-label="${label}"><div class="toc-title">${label}</div><ul>${page.headings
    .map((h) => `<li class="d${h.depth}"><a href="#${h.slug}">${escapeHtml(h.text)}</a></li>`).join('')}</ul></nav>`;
}
function pager(i, lang) {
  const prev = pages[i - 1] && localized(pages[i - 1], lang);
  const next = pages[i + 1] && localized(pages[i + 1], lang);
  return `<div class="pager">
      ${prev ? `<a class="prev" href="${prev.file}"><span>${STRINGS[lang].previous}</span>${escapeHtml(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a class="next" href="${next.file}"><span>${STRINGS[lang].next}</span>${escapeHtml(next.title)}</a>` : '<span></span>'}
    </div>`;
}
function langSwitch(lang, file) {
  return `<div class="lang" role="group" aria-label="Language">${LANGS.map((l) =>
    `<a href="../${l}/${file}"${l === lang ? ' class="active" aria-current="true"' : ''} lang="${l}" title="${STRINGS[l].name}">${l.toUpperCase()}</a>`).join('')}</div>`;
}
function layout({ title, active, main, side, lang, file }) {
  const S = STRINGS[lang];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Multiagent Orchestrator</title>
<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../style.css">
</head>
<body>
<header class="topbar">
  <button class="menu" type="button" aria-label="${S.menu}">☰</button>
  <a class="brand" href="index.html">Multiagent <span>Orchestrator</span><em>${S.docs}</em></a>
  <div class="search"><input id="search" type="search" placeholder="${S.filter}" autocomplete="off"></div>
  <div class="header-right">${langSwitch(lang, file)}<a class="btn" href="${REPO}" target="_blank" rel="noopener">GitHub</a></div>
</header>
<div class="shell">
  <aside class="sidebar" id="sidebar"><nav aria-label="${S.documentation}">${sidebar(active, lang)}</nav></aside>
  <main class="content">${main}</main>
  <aside class="aside">${side}</aside>
</div>
<script src="../site.js"></script>
</body>
</html>`;
}

// ---------- write ----------
require(path.join(SRC, 'diagrams.js')); // the SVGs in docs/site/assets/
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const f of ['style.css', 'site.js']) fs.copyFileSync(path.join(SRC, f), path.join(outDir, f));
fs.cpSync(path.join(SRC, 'assets'), path.join(outDir, 'assets'), { recursive: true });

const MAX_CARD = 5;
for (const lang of LANGS) {
  const dir = path.join(outDir, lang);
  fs.mkdirSync(dir, { recursive: true });
  const S = STRINGS[lang];
  pages.forEach((p, i) => {
    const page = localized(p, lang);
    const notice = page.translated ? '' : `<div class="notice">${S.notTranslated}</div>`;
    const main = `<article class="doc">${notice}<h1>${escapeHtml(page.title)}</h1>${render(page, lang)}</article>${pager(i, lang)}`;
    fs.writeFileSync(path.join(dir, p.file), layout({ title: page.title, active: p.name, main, side: toc(page, lang), lang, file: p.file }));
  });
  const cards = groups.map((g) => {
    const items = g.pages.map((p) => {
      const l = localized(p, lang);
      return `<li><a href="${p.file}" title="${escapeHtml(l.title)}">${escapeHtml(l.title)}</a></li>`;
    });
    const footer = items.length > MAX_CARD ? `<a class="card-all" href="${g.pages[0].file}">${S.viewAll} (${items.length}) →</a>` : '';
    const first = localized(g.pages[0], lang);
    return `
  <section class="card">
    <h2>${escapeHtml(S.groups[g.name])}</h2>
    <p>${escapeHtml(first.description || '')}</p>
    <ul>${items.slice(0, MAX_CARD).join('')}</ul>${footer}
  </section>`;
  }).join('');
  fs.writeFileSync(path.join(dir, 'index.html'), layout({
    title: S.documentation, active: null, lang, file: 'index.html',
    main: `<article class="doc"><h1>Multiagent Orchestrator</h1><p class="lead">${S.tagline}</p><div class="cards">${cards}</div></article>`,
    side: '',
  }));
}
fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=en/index.html"><a href="en/index.html">English</a> · <a href="pt/index.html">Português</a>\n`);
console.log(`${pages.length} pages × ${LANGS.length} languages → ${path.relative(root, outDir)}/`);
