// site/24x7/build.js: the build-in-public site (homes and chapters, Portuguese and English) builds
// from chapters.json, the templates and posts/*.md into plain HTML pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, loadChapters, build } = require('../site/24x7/build');

const dir = path.join(__dirname, '..', 'site', '24x7');

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'site-24x7-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('chapters.json: every chapter has both languages, and every published one its two texts', () => {
  const chapters = loadChapters();
  assert.ok(chapters.length >= 1);
  assert.deepEqual(chapters.map((c) => c.n), chapters.map((_, i) => i + 1), 'numbered 1..n with no gap');
  for (const c of chapters.filter((x) => x.status === 'published')) {
    for (const lang of ['pt', 'en']) assert.ok(fs.existsSync(path.join(dir, 'posts', `${String(c.n).padStart(2, '0')}.${lang}.md`)), `chapter ${c.n} ${lang}`);
  }
});

test('build: both homes and each published chapter in both languages, linked to each other, no placeholder left', (t) => {
  const out = tmp(t);
  const pages = build({ out, base: '/fabrica-24x7', media: '/ai-next-level/img', full: '/ai-next-level' });
  const published = loadChapters().filter((c) => c.status === 'published');
  assert.equal(pages.length, 2 + 2 * published.length);
  const read = (p) => fs.readFileSync(path.join(out, p.replace('/fabrica-24x7', ''), 'index.html'), 'utf8');
  for (const p of pages) {
    const html = read(p);
    assert.doesNotMatch(html, /\{\{\w+\}\}/, `${p}: a placeholder is left`);
    assert.match(html, /<link rel="alternate" hreflang="en"/, `${p}: English alternate`);
    assert.match(html, /<link rel="alternate" hreflang="pt-BR"/, `${p}: Portuguese alternate`);
    assert.match(html, /href="\/fabrica-24x7\/style\.css"/, `${p}: absolute stylesheet`);
  }
  assert.match(read('/fabrica-24x7'), /<html lang="pt-BR">/);
  assert.match(read('/fabrica-24x7/en'), /<html lang="en">/);
  for (const c of published) {
    const pt = `/fabrica-24x7/capitulos/${c.pt.slug}`;
    const en = `/fabrica-24x7/en/chapters/${c.en.slug}`;
    assert.ok(read(pt).includes(`href="${en}"`), 'the Portuguese chapter links to its English twin');
    assert.ok(read(en).includes(`href="${pt}"`), 'the English chapter links to its Portuguese twin');
    assert.ok(read('/fabrica-24x7').includes(`href="${pt}"`), 'the Portuguese home links to the chapter');
    assert.ok(read('/fabrica-24x7/en').includes(`href="${en}"`), 'the English home links to the chapter');
  }
  for (const f of ['style.css', 'main.js']) assert.ok(fs.existsSync(path.join(out, f)));
});

test('loadChapters refuses a published chapter without its text, a bad slug or a repeated one', (t) => {
  const d = tmp(t);
  fs.mkdirSync(path.join(d, 'posts'));
  const write = (chapters) => fs.writeFileSync(path.join(d, 'chapters.json'), JSON.stringify({ chapters }));
  const lang = (slug) => ({ slug, title: 'T', teaser: 'X' });
  write([{ n: 1, status: 'published', date: '2026-10-03', pt: lang('a'), en: lang('a') }]);
  assert.throws(() => loadChapters(d), /posts\/01\.pt\.md is missing/);
  write([{ n: 1, status: 'soon', pt: lang('Bad Slug'), en: lang('a') }]);
  assert.throws(() => loadChapters(d), /lowercase letters, digits and -/);
  write([{ n: 1, status: 'soon', pt: lang('a'), en: lang('a') }, { n: 2, status: 'soon', pt: lang('a'), en: lang('b') }]);
  assert.throws(() => loadChapters(d), /pt slug "a" is used twice/);
  write([{ n: 1, status: 'later', pt: lang('a'), en: lang('a') }]);
  assert.throws(() => loadChapters(d), /status is published or soon/);
});

test('parseArgs: --out is required, trailing slashes are dropped', () => {
  assert.throws(() => parseArgs([]), /--out <dir> is required/);
  assert.deepEqual(parseArgs(['--out', 'x', '--base', '/b/', '--media', '/m/img/']), { out: 'x', base: '/b', media: '/m/img', full: '/ai-next-level' });
});
