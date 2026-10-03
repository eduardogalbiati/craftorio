// Builds the 24x7 site (the build-in-public page and its chapters, in Portuguese and English) into
// a folder ready to serve: no build step on the server, plain HTML files.
//
//   node site/24x7/build.js --out <dir> [--base /fabrica-24x7] [--media /ai-next-level/img] [--full /ai-next-level]
//
// Sources, next to this file:
//   home.pt.html, home.en.html  the home page per language
//   post.html                   the chapter page template (its strings come from STRINGS below)
//   chapters.json               every chapter: number, date, status, and per language slug, title, teaser
//   posts/<nn>.<lang>.md        a published chapter's text (Markdown); required when status is "published"
//   style.css, main.js          copied as they are
// Placeholders: {{base}} {{media}} {{full}} {{lang}} {{alt}} (the same page in the other language),
// {{chapters}} (the chapter cards), and in post.html the post's own ({{title}}, {{body}}…).
// Output: <out>/index.html (pt), <out>/en/index.html, <out>/capitulos/<slug>/index.html,
// <out>/en/chapters/<slug>/index.html, <out>/style.css, <out>/main.js. Each page is a folder's
// index.html: the server maps /<base>/<path> to it (next.config.js rewrites on the site).

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const HERE = __dirname;
const LANGS = ['pt', 'en'];
// where each language lives under the base, and where its chapters live
const ROOT = { pt: '', en: '/en' };
const CHAPTERS_DIR = { pt: 'capitulos', en: 'chapters' };

const STRINGS = {
  pt: {
    locale: 'pt-BR', chapter: 'Capítulo', read: 'Ler o capítulo', published: 'publicado', soon: 'capítulo em breve',
    all: 'Todos os capítulos', next: 'Próximo capítulo', nextSoon: 'Sai em breve. Assine para receber quando sair.',
    subscribeTitle: 'Receba os próximos capítulos', subscribeText: 'Um e-mail quando sair um capítulo novo. Sem spam, e você sai quando quiser.',
    name: 'Nome', optional: '(opcional)', namePh: 'Como posso te chamar?', email: 'E-mail', emailPh: 'voce@exemplo.com',
    consent: 'Quero receber os capítulos por e-mail.', subscribe: 'Assinar', done: 'Pronto, você está na lista.', doneText: 'O próximo capítulo chega no seu e-mail.',
    other: 'English', otherShort: 'EN', home: 'Diário da fábrica', seeAll: 'Ver todas as funcionalidades', footer: 'Diário da fábrica · um projeto de hobby, construído em público',
  },
  en: {
    locale: 'en', chapter: 'Chapter', read: 'Read the chapter', published: 'published', soon: 'coming soon',
    all: 'All chapters', next: 'Next chapter', nextSoon: 'Coming soon. Subscribe to get it when it is out.',
    subscribeTitle: 'Get the next chapters', subscribeText: 'One email when a new chapter is out. No spam, unsubscribe anytime.',
    name: 'Name', optional: '(optional)', namePh: 'What should I call you?', email: 'Email', emailPh: 'you@example.com',
    consent: 'Send me the chapters by email.', subscribe: 'Subscribe', done: 'Done, you are on the list.', doneText: 'The next chapter will reach your inbox.',
    other: 'Português', otherShort: 'PT', home: 'Factory diary', seeAll: 'See every feature', footer: 'Factory diary · a hobby project, built in public',
  },
};

function parseArgs(argv) {
  const a = { out: null, base: '/fabrica-24x7', media: '/ai-next-level/img', full: '/ai-next-level' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    if (k === '--out') a.out = next();
    else if (k === '--base') a.base = next();
    else if (k === '--media') a.media = next();
    else if (k === '--full') a.full = next();
    else throw new Error(`Unknown argument: ${k}`);
  }
  if (!a.out) throw new Error('--out <dir> is required');
  for (const k of ['base', 'media', 'full']) a[k] = a[k].replace(/\/+$/, '');
  return a;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => {
  if (!(k in vars)) throw new Error(`no value for {{${k}}}`);
  return vars[k];
});
const nn = (n) => String(n).padStart(2, '0');

/** Reads chapters.json and checks it: both languages, unique slugs, a text for every published one. */
function loadChapters(dir = HERE) {
  const { chapters } = JSON.parse(fs.readFileSync(path.join(dir, 'chapters.json'), 'utf8'));
  const seen = new Set();
  for (const c of chapters) {
    if (!Number.isInteger(c.n)) throw new Error(`chapter without a number: ${JSON.stringify(c)}`);
    if (!['published', 'soon'].includes(c.status)) throw new Error(`chapter ${c.n}: status is published or soon`);
    for (const lang of LANGS) {
      const t = c[lang];
      if (!t?.slug || !t.title || !t.teaser) throw new Error(`chapter ${c.n}: ${lang} needs slug, title and teaser`);
      if (!/^[a-z0-9-]+$/.test(t.slug)) throw new Error(`chapter ${c.n}: ${lang} slug "${t.slug}" must be lowercase letters, digits and -`);
      const key = `${lang}:${t.slug}`;
      if (seen.has(key)) throw new Error(`chapter ${c.n}: ${lang} slug "${t.slug}" is used twice`);
      seen.add(key);
      if (c.status === 'published' && !fs.existsSync(path.join(dir, 'posts', `${nn(c.n)}.${lang}.md`))) throw new Error(`chapter ${c.n} is published but posts/${nn(c.n)}.${lang}.md is missing`);
    }
    if (c.status === 'published' && !/^\d{4}-\d{2}-\d{2}$/.test(c.date || '')) throw new Error(`chapter ${c.n}: a published chapter needs its date (YYYY-MM-DD)`);
  }
  return chapters.sort((a, b) => a.n - b.n);
}

const homeUrl = (o, lang) => `${o.base}${ROOT[lang]}`;
const postUrl = (o, lang, c) => `${o.base}${ROOT[lang]}/${CHAPTERS_DIR[lang]}/${c[lang].slug}`;
const dateText = (lang, d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(STRINGS[lang].locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function cards(o, lang, chapters) {
  const S = STRINGS[lang];
  return chapters.map((c) => {
    const t = c[lang];
    const open = c.status === 'published';
    const tag = open ? `<span class="soon done-tag">${S.published} · ${esc(dateText(lang, c.date))}</span>` : `<span class="soon">${S.soon}</span>`;
    const body = `<span class="n">${nn(c.n)}</span><h3>${esc(t.title)}</h3><p>${esc(t.teaser)}</p>${tag}`;
    return open
      ? `          <a class="lesson-link" href="${postUrl(o, lang, c)}"><article class="open">${body}<span class="read">${S.read} →</span></article></a>`
      : `          <article>${body}</article>`;
  }).join('\n');
}

function build(o, dir = HERE) {
  const chapters = loadChapters(dir);
  const out = path.resolve(o.out);
  fs.rmSync(out, { recursive: true, force: true });
  const write = (rel, text) => { const f = path.join(out, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  for (const f of ['style.css', 'main.js']) write(f, fs.readFileSync(path.join(dir, f), 'utf8'));
  const common = { base: o.base, media: o.media, full: o.full };
  const pages = [];

  for (const lang of LANGS) {
    const other = LANGS.find((l) => l !== lang);
    const home = fill(fs.readFileSync(path.join(dir, `home.${lang}.html`), 'utf8'), {
      ...common, lang, alt: homeUrl(o, other), self: homeUrl(o, lang), chapters: cards(o, lang, chapters),
    });
    write(path.join(ROOT[lang], 'index.html'), home);
    pages.push(homeUrl(o, lang));
  }

  const tpl = fs.readFileSync(path.join(dir, 'post.html'), 'utf8');
  for (const c of chapters.filter((x) => x.status === 'published')) {
    for (const lang of LANGS) {
      const S = STRINGS[lang];
      const other = LANGS.find((l) => l !== lang);
      const md = fs.readFileSync(path.join(dir, 'posts', `${nn(c.n)}.${lang}.md`), 'utf8');
      const next = chapters.find((x) => x.n === c.n + 1);
      const nextHtml = !next ? '' : next.status === 'published'
        ? `<a class="next-card" href="${postUrl(o, lang, next)}"><span class="kicker">${S.next}</span><b>${esc(next[lang].title)}</b><span>${esc(next[lang].teaser)}</span></a>`
        : `<div class="next-card"><span class="kicker">${S.next}</span><b>${esc(next[lang].title)}</b><span>${S.nextSoon}</span></div>`;
      const page = fill(tpl, {
        ...common, ...Object.fromEntries(Object.entries(S).map(([k, v]) => [`s_${k}`, esc(v)])),
        lang: S.locale, altLang: STRINGS[other].locale, title: esc(c[lang].title), teaser: esc(c[lang].teaser), n: nn(c.n),
        date: c.date, dateText: esc(dateText(lang, c.date)),
        body: marked.parse(md.replace(/\{\{(base|media|full)\}\}/g, (m, k) => common[k])),
        self: postUrl(o, lang, c), alt: postUrl(o, other, c), home: homeUrl(o, lang), next: nextHtml,
      });
      const rel = path.join(ROOT[lang], CHAPTERS_DIR[lang], c[lang].slug, 'index.html');
      write(rel, page);
      pages.push(postUrl(o, lang, c));
    }
  }
  return pages;
}

module.exports = { parseArgs, loadChapters, build, STRINGS };

if (require.main === module) {
  try {
    const pages = build(parseArgs(process.argv.slice(2)));
    console.log(`built ${pages.length} pages:\n${pages.map((p) => `  ${p}`).join('\n')}`);
  } catch (e) {
    console.error(`build: ${e.message}`);
    process.exit(1);
  }
}
