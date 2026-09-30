// Generated docs: files built from small per-feature sources, so features add a file instead of
// editing a shared table (fewer merge conflicts between parallel runs, issue #77).
//   docs/agents/code-map.md  from the header comment at the top of each source file. Derived and
//                            gitignored (nobody reads it at runtime): rebuilt by `prepare`,
//                            `prestart`, `pretest` and `prebuild`, so a pull never leaves it stale.
//   README.md tables         between `<!-- generated:<name> -->` markers: the bundled skills (each
//                            skills/*/SKILL.md frontmatter: name, summary, used_by) and the screens
//                            (docs/screens/*.md: menu, order, text). Committed (GitHub readers);
//                            a test fails when they are out of date.
//
//   npm run docs                   everything
//   node scripts/docs.js --derived only the gitignored files (the npm hooks)
//   node scripts/docs.js --check   writes nothing; exit 1 when the README is out of date or a
//                                  source file has no header comment
// No dependency beyond js-yaml (installed before `prepare` runs).

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const CODE_MAP = path.join('docs', 'agents', 'code-map.md');
const SUFFIXES = ['js', 'python', 'go', 'java', 'csharp', 'gh', 'gl'];
// Source folders mapped file by file (their .js files, recursively).
const SOURCE_DIRS = ['src', 'scripts'];
// Folders described as a whole: no header comment to read from.
const FOLDERS = [
  ['src/renderer/', 'Plain HTML/CSS/JS UI, no bundler (index.html, style.css and one script per screen). See [renderer.md](renderer.md).'],
  ['src/service/channels/', 'The service\'s channels, one file per area (see `src/service/manifest.js`).'],
  ['workflows/*.yaml', 'The bundled workflows (seeded into `<workspace>/workflows/`). See [engine.md](engine.md).'],
  ['skills/', 'The bundled skills, one folder each (`SKILL.md` + support files, seeded into `<workspace>/skills/`); the README table is generated from their frontmatter.'],
  ['docs/screens/', 'One fragment per screen (`menu`, `order`, text): the README\'s screens table.'],
  ['docs/agents/', 'These topic docs, indexed by `CLAUDE.md` (`test/claude-md.test.js` keeps the index small and its links valid).'],
  ['supabase/migrations/', '`accounts` table and `entitlement()` (trial and plan); `waitlist` table (RLS, no policies) written only through `join_waitlist()` (anon may execute; duplicate emails ignored). Applied by pasting into the Supabase SQL editor.'],
  ['site/', 'Waitlist landing page (Portuguese copy, first market Brazil): static `index.html` + `styles.css` + `main.js`, no build; the form calls `join_waitlist` with the publishable key. `img/` holds the feature videos recorded with `scripts/screenshot.js --record` from the step files in `recordings/`. Not packaged into the app.'],
];

const posix = (p) => p.split(path.sep).join('/');
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const cell = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

function frontmatter(text) {
  const m = /^﻿?---\n([\s\S]*?)\n---\n?/.exec(text);
  let meta = {};
  if (m) { try { meta = yaml.load(m[1]) || {}; } catch { meta = {}; } }
  return { meta, body: m ? text.slice(m[0].length) : text };
}

function listJs(root, dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : listJs(root, rel);
    return e.name.endsWith('.js') ? [posix(rel)] : [];
  }).sort();
}

// The comment block at the top of a file ('' when there is none): `//` lines or one `/* */` block,
// after a shebang and `/* global */` / `/* eslint */` lines.
function headerOf(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && (/^#!/.test(lines[i]) || /^\/\*\s*(global|eslint)\b.*\*\/\s*$/.test(lines[i]) || /^['"]use strict['"];?$/.test(lines[i].trim()))) i++;
  const out = [];
  if (/^\s*\/\*/.test(lines[i] || '')) {
    for (; i < lines.length; i++) {
      out.push(lines[i].replace(/^\s*\/\*+\s?/, '').replace(/\*+\/\s*$/, '').replace(/^\s*\*\s?/, ''));
      if (/\*\/\s*$/.test(lines[i])) break;
    }
  } else {
    for (; i < lines.length && /^\s*\/\//.test(lines[i]); i++) out.push(lines[i].replace(/^\s*\/\/\s?/, ''));
  }
  return out.join('\n').trim();
}

function codeMap(root = ROOT) {
  const files = SOURCE_DIRS.flatMap((d) => listJs(root, d)).filter((f) => !f.startsWith('src/service/channels/'));
  const rows = files.map((f) => `| \`${f}\` | ${cell(headerOf(read(root, f))) || '(no header comment)'} |`);
  return [
    '# Code map',
    '',
    '<!-- Generated by `npm run docs` from the header comment of each source file: edit the header, not this file. -->',
    '',
    'Read this when you need to find where something lives. One row per source file, from the comment',
    'at its top: document a file in its own header (or in a topic doc), never in a shared list.',
    '',
    '## Adding things without editing shared lists',
    '',
    '- **A channel** (`window.api` method): add an entry to the area\'s file in `src/service/channels/`',
    '  (or a new file there: files are discovered). `src/preload.js` and `src/renderer/api-http.js` build',
    '  `window.api` from the manifest at runtime; nothing else to edit.',
    '- **A screen**: its script and markup in `src/renderer/`, and a fragment `docs/screens/<view>.md`',
    '  (`menu`, `order`, text) for the README table; run `npm run docs`.',
    '- **A skill**: a folder `skills/<name>/SKILL.md` with `name`, `description`, `summary` and `used_by`',
    '  in its frontmatter; run `npm run docs` for the README table.',
    '- **A source file**: start it with a header comment (what it does, who uses it); this map picks it up.',
    '',
    '| File | What it does |',
    '|---|---|',
    ...rows,
    ...FOLDERS.map(([f, text]) => `| \`${f}\` | ${text} |`),
    '',
  ].join('\n');
}

// Source files with no header comment (the check fails on them).
function missingHeaders(root = ROOT) {
  return SOURCE_DIRS.flatMap((d) => listJs(root, d)).filter((f) => !headerOf(read(root, f)));
}

function skillsTable(root = ROOT) {
  const dir = path.join(root, 'skills');
  const skills = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
    .map((e) => {
      const { meta } = frontmatter(read(root, path.join('skills', e.name, 'SKILL.md')));
      const name = String(meta.name || e.name);
      const summary = meta.summary || String(meta.description || '').split(/(?<=\.)\s/)[0];
      return { name, summary: cell(summary), usedBy: cell(Array.isArray(meta.used_by) ? meta.used_by.join(', ') : meta.used_by || '') };
    });
  // a language/platform family (`<capability>-<suffix>`) is one row: `cap-{js,python}`
  const rows = new Map();
  for (const s of skills) {
    const m = new RegExp(`^(.+)-(${SUFFIXES.join('|')})$`).exec(s.name);
    const key = m ? `${m[1]}-*` : s.name;
    if (!rows.has(key)) rows.set(key, { ...s, base: m?.[1], suffixes: [] });
    if (m) rows.get(key).suffixes.push(m[2]);
  }
  const lines = [...rows.values()]
    .map((r) => ({ ...r, label: r.base ? (r.suffixes.length > 1 ? `${r.base}-{${SUFFIXES.filter((x) => r.suffixes.includes(x)).join(',')}}` : `${r.base}-${r.suffixes[0]}`) : r.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((r) => `| \`${r.label}\` | ${r.usedBy || '—'} | ${r.summary} |`);
  return ['| Skill | Used by | Content |', '|---|---|---|', ...lines].join('\n');
}

function screensTable(root = ROOT) {
  const dir = path.join(root, 'docs', 'screens');
  const screens = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const { meta, body } = frontmatter(read(root, path.join('docs', 'screens', f)));
    return { menu: String(meta.menu || path.basename(f, '.md')), order: Number(meta.order) || 999, text: cell(body) };
  }).sort((a, b) => a.order - b.order || a.menu.localeCompare(b.menu));
  return ['| Menu | What it has |', '|---|---|', ...screens.map((s) => `| ${s.menu} | ${s.text} |`)].join('\n');
}

const SECTIONS = { skills: skillsTable, screens: screensTable };

// The README with every generated section replaced (the markers stay).
function renderReadme(text, root = ROOT) {
  let out = text.replace(/\r\n/g, '\n');
  for (const [name, build] of Object.entries(SECTIONS)) {
    const re = new RegExp(`(<!-- generated:${name} -->\\n)[\\s\\S]*?(\\n<!-- /generated:${name} -->)`);
    if (!re.test(out)) throw new Error(`README.md: the <!-- generated:${name} --> markers are missing.`);
    out = out.replace(re, (_m, open, close) => `${open}${build(root)}${close}`);
  }
  return out;
}

function main(argv = process.argv.slice(2), root = ROOT) {
  const check = argv.includes('--check');
  const derivedOnly = argv.includes('--derived');
  const problems = [];
  if (check) {
    const readme = read(root, 'README.md');
    if (renderReadme(readme, root) !== readme) problems.push('README.md is out of date: run `npm run docs` and commit it.');
    for (const f of missingHeaders(root)) problems.push(`${f} has no header comment (the code map is built from it).`);
    for (const p of problems) console.error(p);
    return problems.length ? 1 : 0;
  }
  fs.writeFileSync(path.join(root, CODE_MAP), codeMap(root));
  if (!derivedOnly) fs.writeFileSync(path.join(root, 'README.md'), renderReadme(read(root, 'README.md'), root));
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  codeMap,
  headerOf,
  main,
  missingHeaders,
  renderReadme,
  screensTable,
  skillsTable,
};
