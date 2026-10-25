// Generated docs: files built from small per-feature sources, so features add a file instead of
// editing a shared table (fewer merge conflicts between parallel runs, issue #77).
//   docs/agents/code-map.md  from the header comment at the top of each source file, plus one row
//                            per screen folder (src/renderer/views/<view>/). Derived and
//                            gitignored (nobody reads it at runtime): rebuilt by `prepare`,
//                            `prestart`, `pretest` and `prebuild`, so a pull never leaves it stale.
//   docs/agents/test-map.md  (#219) the static code → tests map: for every source file, the test
//                            files that import it directly or transitively (the affected tests'
//                            import graph, src/engine/affected-tests.js testMap). Derived and
//                            gitignored like the code map; agents read it instead of guessing.
//   docs/agents/channels.md  (#338) the channel reference: every request/reply channel of the app's
//                            manifest (src/service/manifest.js) with its arguments and its result,
//                            from each entry's `schema`. Derived and gitignored like the code map;
//                            always this app's channels (the ones of the checkout docs.js runs from).
//   docs/agents/engine/field-reference.md  (#352) the workflow YAML's field rules, one row per entry of
//                            FIELD_RULES (src/engine/run/field-rules.js): field, applies to, type,
//                            template, required, message. Derived and gitignored like the code map;
//                            not an engine topic (left out of engine.md's index).
//   README.md tables        between `<!-- generated:<name> -->` markers: the bundled skills (each
//                            skills/*/SKILL.md frontmatter: name, summary, used_by) and the screens
//                            (docs/screens/*.md: menu, order, text). Committed (GitHub readers);
//                            a test fails when they are out of date.
//   README.md sections       (#157) the parts features used to edit by hand (the workflows, the
//                            engine features, the workspace, the structure) also sit between
//                            markers, built from docs/features/<feature>.md: each fragment holds
//                            its feature's pieces of one or more sections (see featurePieces).
//   README.md itself         (#248) assembled from docs/readme/*.md, one hand-written section per
//                            file, in file-name order (`<order>-<section>.md`), joined by a blank
//                            line; a fragment keeps a generated block as its empty markers, filled
//                            as above. A feature adds a fragment, never edits README.md.
//   docs/agents/engine.md    (#251) the index of docs/agents/engine/*.md, one topic per file: one
//                            line per topic from its first heading and the line after it (its
//                            summary line), in file-name order. Committed; a test fails when stale.
//   src/renderer/index.html  the renderer's own stylesheets and scripts, between
//                            `<!-- generated:styles -->` / `<!-- generated:scripts -->` markers
//                            (#152): adding a screen or a module adds files, never a hand-edited
//                            line. Committed (the page loads it as is). Order, per list: the pure
//                            modules of src/shared/ (scripts, `../shared/<file>`, #345; its subfolders
//                            first, each folder's index.js after its other files, #351), then the files
//                            whose header has `load: early`, then app.js (scripts), then the other
//                            files of src/renderer/, then those of src/renderer/views/<view>/, each
//                            group sorted by path; `load: after <file> [<file>…]` in a header puts
//                            a file after the ones it needs as it loads (same group or an earlier
//                            one). A reason may follow in parentheses. Vendor files (node_modules)
//                            stay hand-kept outside the markers.
//
//   npm run docs                   everything
//   node scripts/docs.js --derived only the gitignored files (the npm hooks)
//   node scripts/docs.js --check   writes nothing; exit 1 when the README, engine.md or
//                                  index.html's lists are out of date or a source file has no header comment (CI)
// No dependency beyond js-yaml (installed before `prepare` runs) and the app's own modules (the
// channel reference loads the channel files).

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { testMap, testMapMarkdown } = require('../src/engine/affected-tests');
const { fieldReference } = require('../src/engine/run/field-rules');

const ROOT = path.join(__dirname, '..');
const CODE_MAP = path.join('docs', 'agents', 'code-map.md');
const TEST_MAP = path.join('docs', 'agents', 'test-map.md');
const CHANNELS_REF = path.join('docs', 'agents', 'channels.md');
const SUFFIXES = ['js', 'python', 'go', 'java', 'csharp', 'rust', 'gh', 'gl'];
// Source folders mapped file by file (their .js and .jsx files, recursively: .jsx are the run's 3D view's
// sources, src/renderer/run3d/, bundled by scripts/build-3d.js).
const SOURCE_DIRS = ['src', 'scripts'];
// Folders that are not part of the app: left out of the code → tests map (poc/: proofs of concept).
const OUTSIDE = ['poc/'];
// Folders described as a whole: no header comment to read from.
const FOLDERS = [
  ['src/domains/', 'The backend\'s domain modules (phase 1 of `docs/reorganisation-study-2026-10.md`), one folder per domain (agents, analytics, backlog, chat, cli, discovery, evidence, local, machine, night, oracle, po, project, refactor, releases, roadmap, run, seed, session, supervisor, usage, workflow, workspace): what the service and the engine require besides each other. A new module goes in the folder of the domain that uses it; its tests in `test/<domain>/`. Layers: `scripts/layers.js`.'],
  ['src/host/', 'The Electron host (phase 1 of `docs/reorganisation-study-2026-10.md`): `main.js` (the entry `package.json` names), the preloads, the windows and their guards, the account sign-in, the external terminal and Keep awake. The service and the engine require nothing here (`scripts/layers.js`, area `desktop`).'],
  ['src/renderer/', 'Plain HTML/CSS/JS UI, no bundler (index.html, style.css and one script per screen; moved screens in `views/<view>/`, registered with `registerView`). index.html\'s `<link>`/`<script>` lists are generated by `npm run docs` (order: `load:` header lines). See [renderer.md](renderer.md).'],
  ['src/shared/', 'Pure modules both sides use (#345): each works with `require` and as a renderer `<script>` (a browser global), requires nothing of the app, and loads before the renderer\'s files. The layers of `src/` and their allowed directions: `scripts/layers.js`. See [renderer.md](renderer.md).'],
  ['src/service/channels/', 'The service\'s channels, one file per area (see `src/service/manifest.js`).'],
  ['native/', 'The cargo workspace of the native sidecars (#341), one crate per binary, shipped in `resources/bin/`: `multiagent-mcp`, the Rust twin of `src/domains/supervisor/supervisor-mcp.js` (started by `mcpCommand` when built). See [environment.md](environment.md).'],
  ['workflows/*.yaml', 'The bundled workflows (seeded into `<workspace>/workflows/`). See [engine.md](engine.md).'],
  ['fragments/*.yaml', 'Step bodies the bundled workflows share (#434), included by a step\'s `fragment: <name>` and read from the app folder only. See [step-fragments.md](engine/step-fragments.md).'],
  ['skills/', 'The bundled skills, one folder each (`SKILL.md` + support files, seeded into `<workspace>/skills/`); the README table is generated from their frontmatter.'],
  ['docs/screens/', 'One fragment per screen (`menu`, `order`, text): the README\'s screens table.'],
  ['docs/features/', 'One fragment per feature (`order`, then `<!-- section:<name> -->` pieces): the README\'s generated workflows, engine, workspace and structure sections.'],
  ['docs/agents/', 'These topic docs, indexed by `AGENTS.md` (`CLAUDE.md` imports it; `test/claude-md.test.js` keeps the index small and its links valid).'],
  ['docs/agents/engine/', 'One file per engine topic (`# <Title>`, a summary line, the notes): `docs/agents/engine.md` is their generated index.'],
  ['docs/readme/', 'One file per hand-written README section, in file-name order: `README.md` is assembled from them (generated blocks kept as empty markers).'],
  ['supabase/migrations/', '`accounts` table (sign-up, last seen, app version, OS) and `touch_account()`. Applied by pasting into the Supabase SQL editor.'],
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
    return /\.jsx?$/.test(e.name) ? [posix(rel)] : [];
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
  // One row per screen folder (src/renderer/views/<view>/), discovered: its files, from disk.
  const viewsDir = path.join(root, RENDERER, 'views');
  const viewRows = fs.existsSync(viewsDir)
    ? fs.readdirSync(viewsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
      .map((v) => {
        const own = fs.readdirSync(path.join(viewsDir, v)).filter((f) => /\.(js|css)$/.test(f)).sort();
        return `| \`src/renderer/views/${v}/\` | The ${v} screen's folder (registered with \`registerView\`): ${own.map((f) => `\`${f}\``).join(', ')}. |`;
      })
    : [];
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
    '  (or a new file there: files are discovered). `src/host/preload.js` and `src/renderer/api-http.js` build',
    '  `window.api` from the manifest at runtime; nothing else to edit. The entry carries its',
    '  `schema: { params, result }` (JSON Schema, #338; shared ids and builders in `src/service/schemas.js`):',
    '  the service refuses arguments that break `params` with a 400 before the channel runs, and the tests',
    '  check every result against `result`. A channel without one fails',
    '  `test/service/channel-schema-ratchet-338.test.js`. The reference of every channel is',
    '  [channels.md](channels.md) (generated, gitignored).',
    '- **Service state or a helper behind a channel**: add it to its area\'s file in `src/service/areas/`',
    '  (or a new file there: files are discovered, see `src/service/index.js`), never to `src/service/index.js`;',
    '  its tests go in `test/service/<area>.test.js` (see [testing.md](testing.md)).',
    '- **A screen**: a folder `src/renderer/views/<view>/` (`<view>.js` calling `registerView`, `<view>.css`;',
    '  see [renderer.md](renderer.md)), a fragment `docs/screens/<view>.md` (`menu`, `order`, text) for',
    '  the README table, and its screenshot seed `scripts/screenshot/views/<view>.js` (its tabs, modes,',
    '  demo data and how it opens; found by the screenshot runner, which is never edited for a screen);',
    '  run `npm run docs`, which lists its files in `index.html` (never by hand).',
    '- **A renderer module or stylesheet** (`src/renderer/*.js|css`): add the file and run `npm run docs`;',
    '  a `load: early` or `load: after <file>` line in its header when it needs others as it loads.',
    '- **Code both the UI and the backend use** (pure: no DOM, no fs, no Electron): a dual-load module in',
    '  `src/shared/` (`module.exports` under Node, a `window` global as a `<script>`; copy',
    '  `src/shared/display-name.js`) and run `npm run docs`. The backend never requires `src/renderer/`.',
    '- **Something GitHub and GitLab do differently** (a `gh`/`glab` command, its JSON, a term such as',
    '  "PR #" / "MR !"): a member of both platform adapters, `src/shared/platforms/github.js` and `gitlab.js`',
    '  (#351), called through the registry (`resolvePlatform` / `platformOrDefault` in `src/shared/platforms/index.js`,',
    '  by either vocabulary: `github`/`gh`, `gitlab`/`gl`), never an `if (platform === ...)` branch: a',
    '  platform literal outside the adapters fails `test/platform-literals-351.test.js`. See [capabilities.md](capabilities.md).',
    '- **A provider** (a fourth CLI, #348): one adapter file `src/shared/providers/<id>.js` (copy `codex.js`: id,',
    '  type, label, model prefixes, workflow definition, isolationArgs, stream parser, usage-limit patterns,',
    '  sessions folder, trust) plus its two lines in `src/shared/providers/index.js`, the registry (its',
    '  `require`, its `window` global); run',
    '  `npm run docs` for its `<script>` tag. Nothing else names a provider: `test/provider-registry-348.test.js`',
    '  fails on a provider literal outside `src/shared/providers/` (see [engine/providers.md](engine/providers.md)).',
    '- **Where a new module goes**: the area whose rules fit what it requires (`AREAS` in `scripts/layers.js`:',
    '  shared requires nothing of the app; the engine shared and the root utilities it lists; the root domain',
    '  modules the engine and shared; the service all of these; the desktop entry and the server the service',
    '  and what is below it; the renderer only shared, and nothing else requires it). `test/layers-345.test.js` (`node scripts/layers.js`) fails on another direction',
    '  and on any require cycle, lazy ones included: move the shared helper down instead of listing an exception.',
    '- **A skill**: a folder `skills/<name>/SKILL.md` with `name`, `description`, `summary` and `used_by`',
    '  in its frontmatter; run `npm run docs` for the README table.',
    '- **A README paragraph** (a workflow, an engine feature, a workspace file, a source file in Structure):',
    '  a fragment `docs/features/<feature>.md` (`order` in its frontmatter, then one `<!-- section:<name> [order:<n>] -->`',
    '  line per piece; sections: `FEATURE_SECTIONS` in `scripts/docs.js`) instead of editing the README; run `npm run docs`.',
    '- **A README section** (a `## ` heading of its own): a fragment `docs/readme/<order>-<section>.md` (the',
    '  README is assembled from them in file-name order: pick a name that sorts where it belongs); never edit',
    '  `README.md` itself, `npm run docs` rebuilds it and `test/docs.test.js` fails when it is stale.',
    '- **An engine topic** (implementer\'s notes on a workflow YAML feature): add to its file in',
    '  `docs/agents/engine/`, or add a file there (`# <Title>`, then a one-line summary); `npm run docs`',
    '  lists it in the [engine.md](engine.md) index (never edit the index by hand).',
    '- **Something in the workspace index** (`<workspace>/index.db`, `src/domains/workspace/store.js`): append a migration to',
    '  `MIGRATIONS` (never edit a shipped one: `PRAGMA user_version` counts them) and a helper next to its',
    '  table\'s; only the service writes (the engine emits). The files stay the source of truth: a cache',
    '  must rebuild from them. What lives in files vs the index, and why: [storage.md](storage.md).',
    '- **A source file**: start it with a header comment (what it does, who uses it); this map picks it up.',
    '',
    '| File | What it does |',
    '|---|---|',
    ...rows,
    ...viewRows,
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

// README sections built from feature fragments (#157), in the order they are rendered: a section
// whose markers sit inside another section's fragments comes after it. `join`: what goes between
// two pieces (a blank line for prose, a newline for list items or lines); `fence`: the pieces form
// one code block (the markers stay outside it).
const FEATURE_SECTIONS = {
  workflows: { join: '\n\n' },
  'local-hero': { join: '\n' },
  engine: { join: '\n\n' },
  'workspace-tree': { join: '\n', fence: true },
  workspace: { join: '\n\n' },
  structure: { join: '\n', fence: true },
};
const FEATURES = path.join('docs', 'features');
const PIECE = /^<!-- section:([\w-]+)(?:\s+order:(\d+))?\s*-->$/;

// Every piece of docs/features/*.md: { section, order, file, text }. A fragment is frontmatter
// (`order`) and one or more pieces, each opened by a `<!-- section:<name> [order:<n>] -->` line
// (the piece's own order wins over the file's), sorted by order, then file, then position.
function featurePieces(root = ROOT) {
  const dir = path.join(root, FEATURES);
  if (!fs.existsSync(dir)) return [];
  const pieces = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
    const { meta, body } = frontmatter(read(root, path.join(FEATURES, f)));
    const file = posix(path.join(FEATURES, f));
    let current = null;
    for (const line of body.split('\n')) {
      const m = PIECE.exec(line.trim());
      if (m) {
        if (!FEATURE_SECTIONS[m[1]]) throw new Error(`${file}: unknown README section "${m[1]}" (one of: ${Object.keys(FEATURE_SECTIONS).join(', ')}).`);
        current = { section: m[1], order: Number(m[2] ?? meta.order) || 999, file, index: pieces.length, lines: [] };
        pieces.push(current);
      } else if (current) current.lines.push(line);
      else if (line.trim()) throw new Error(`${file}: text before the first <!-- section:<name> --> line.`);
    }
    if (!current) throw new Error(`${file}: no <!-- section:<name> --> line.`);
  }
  return pieces
    .map((p) => ({ section: p.section, order: p.order, file: p.file, index: p.index, text: p.lines.join('\n').replace(/^\n+|\s+$/g, '') }))
    .sort((a, b) => a.order - b.order || a.file.localeCompare(b.file) || a.index - b.index);
}

function featureSection(name, root = ROOT) {
  const { join, fence } = FEATURE_SECTIONS[name];
  const text = featurePieces(root).filter((p) => p.section === name && p.text).map((p) => p.text).join(join);
  return fence ? ['```', text, '```'].join('\n') : text;
}

const SECTIONS = {
  skills: skillsTable,
  screens: screensTable,
  ...Object.fromEntries(Object.keys(FEATURE_SECTIONS).map((name) => [name, (root) => featureSection(name, root)])),
};

// `text` with every `<!-- generated:<name> -->` section of `sections` replaced (the markers stay).
function renderSections(text, sections, file) {
  let out = text.replace(/\r\n/g, '\n');
  for (const [name, build] of Object.entries(sections)) {
    const re = new RegExp(`(<!-- generated:${name} -->\\n)[\\s\\S]*?(\\n[ \\t]*<!-- /generated:${name} -->)`);
    if (!re.test(out)) throw new Error(`${file}: the <!-- generated:${name} --> markers are missing.`);
    out = out.replace(re, (_m, open, close) => `${open}${build()}${close}`);
  }
  return out;
}

// The README with every generated section replaced (the markers stay).
function renderReadme(text, root = ROOT) {
  const sections = Object.fromEntries(Object.entries(SECTIONS).map(([name, build]) => [name, () => build(root)]));
  return renderSections(text, sections, 'README.md');
}

const README_FRAGMENTS = path.join('docs', 'readme');
const mdFiles = (root, dir) => (fs.existsSync(path.join(root, dir))
  ? fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.md')).sort()
  : []);

// The README's hand-written text (#248): docs/readme/*.md in file-name order, joined by a blank
// line; null when there is no fragment (a project whose README.md is its own source).
function assembleReadme(root = ROOT) {
  const files = mdFiles(root, README_FRAGMENTS);
  if (!files.length) return null;
  return `${files.map((f) => read(root, path.join(README_FRAGMENTS, f)).replace(/^\n+|\s+$/g, '')).join('\n\n')}\n`;
}

// The README as `npm run docs` writes it: the fragments (or the README itself) with every
// generated section filled.
function buildReadme(root = ROOT) {
  return renderReadme(assembleReadme(root) ?? read(root, 'README.md'), root);
}

const ENGINE_TOPICS = path.join('docs', 'agents', 'engine');
const ENGINE_INDEX = path.join('docs', 'agents', 'engine.md');
const FIELD_REF = path.join(ENGINE_TOPICS, 'field-reference.md');

// docs/agents/engine/*.md (#251): { file, title, summary }, the title from the first heading, the
// summary from the first non-blank line after it. The generated field reference is not a topic.
function engineTopics(root = ROOT) {
  return mdFiles(root, ENGINE_TOPICS).filter((file) => file !== path.basename(FIELD_REF)).map((file) => {
    const lines = read(root, path.join(ENGINE_TOPICS, file)).split('\n');
    const at = lines.findIndex((l) => /^#+\s/.test(l));
    const summary = at < 0 ? '' : (lines.slice(at + 1).find((l) => l.trim()) || '');
    return { file, title: at < 0 ? path.basename(file, '.md') : lines[at].replace(/^#+\s+/, '').trim(), summary: /^#/.test(summary) ? '' : summary.trim() };
  });
}

// docs/agents/engine.md, the index of the engine topics; null when there is no topic file.
function engineIndex(root = ROOT) {
  const topics = engineTopics(root);
  if (!topics.length) return null;
  return [
    '# Engine: workflow YAML features',
    '',
    '<!-- Generated by `npm run docs` from docs/agents/engine/*.md (each file\'s first heading and summary line): edit or add a topic file, not this index. -->',
    '',
    'Read the topic you need before changing `src/engine/workflow.js` or a workflow YAML. The README',
    'documents the same features for users; these topics are the implementer\'s summary, one file each.',
    'Which field is valid where, its type and the loader\'s message: [the field reference](engine/field-reference.md)',
    '(generated from the loader\'s rule table, #352; gitignored like the code map).',
    '',
    ...topics.map((t) => `- [${t.title}](engine/${t.file})${t.summary ? `: ${t.summary}` : ''}`),
    '',
  ].join('\n');
}

const RENDERER = path.join('src', 'renderer');
const SHARED = path.join('src', 'shared');
const INDEX_HTML = path.join(RENDERER, 'index.html');
const RENDERER_MAIN = 'app.js';

// The `load:` line of a file's header: { early, after: [paths relative to src/renderer/] }.
function loadRule(text, file) {
  const m = /^\s*load:\s*([^(\n]*?)\s*(?:\(.*\))?\s*$/m.exec(headerOf(text));
  if (!m) return { early: false, after: [] };
  const [kind, ...files] = m[1].split(/\s+/);
  if (kind === 'early' && !files.length) return { early: true, after: [] };
  if (kind === 'after' && files.length) return { early: false, after: files };
  throw new Error(`src/renderer/${file}: unknown load rule "load: ${m[1]}" (use \`load: early\` or \`load: after <file> …\`).`);
}

// The renderer's own files with extension `ext` ('.js' or '.css'), in load order (see the header).
function rendererAssets(root, ext) {
  const abs = path.join(root, RENDERER);
  const filesIn = (rel) => fs.readdirSync(path.join(abs, rel), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => posix(path.join(rel, e.name))).sort();
  const viewsDir = path.join(abs, 'views');
  const views = fs.existsSync(viewsDir)
    ? fs.readdirSync(viewsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
      .flatMap((v) => filesIn(path.join('views', v)))
    : [];
  const all = [...filesIn('.'), ...views];
  const rules = new Map(all.map((f) => [f, loadRule(read(root, path.join(RENDERER, f)), f)]));
  for (const [f, rule] of rules) {
    for (const dep of rule.after) if (!rules.has(dep)) throw new Error(`src/renderer/${f}: "load: after ${dep}" names no file of src/renderer/.`);
  }
  const groups = [
    all.filter((f) => rules.get(f).early),
    all.filter((f) => f === RENDERER_MAIN && !rules.get(f).early),
    all.filter((f) => !f.includes('/') && f !== RENDERER_MAIN && !rules.get(f).early),
    views.filter((f) => !rules.get(f).early),
  ];
  // each group in path order, a file moved down only until what it names is placed
  const placed = [];
  for (const group of groups) {
    const left = [...group];
    while (left.length) {
      const i = left.findIndex((f) => rules.get(f).after.every((dep) => placed.includes(dep)));
      if (i < 0) throw new Error(`src/renderer: the load: after rules of ${left.join(', ')} name a later file or form a cycle.`);
      placed.push(...left.splice(i, 1));
    }
  }
  // the pure modules of src/shared/ first: they need nothing as they load, the renderer's files read them
  const sharedDir = path.join(root, SHARED);
  const shared = ext === '.js' && fs.existsSync(sharedDir) ? sharedScripts(sharedDir, ext) : [];
  return [...shared, ...placed];
}

// The scripts of src/shared/: its subfolders first (e.g. platforms/, #351: the adapters, then the
// folder's index.js, which reads them as it loads), then its own files, each sorted by name.
function sharedScripts(sharedDir, ext) {
  const entries = fs.readdirSync(sharedDir, { withFileTypes: true });
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name).sort();
  const indexLast = (names) => [...names.filter((n) => n !== `index${ext}`), ...names.filter((n) => n === `index${ext}`)];
  const nested = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
    .flatMap((d) => indexLast(files(path.join(sharedDir, d))).map((n) => `../shared/${d}/${n}`));
  return [...nested, ...files(sharedDir).map((n) => `../shared/${n}`)];
}

const ASSET_SECTIONS = {
  styles: (root) => rendererAssets(root, '.css').map((f) => `  <link rel="stylesheet" href="${f}" />`).join('\n'),
  scripts: (root) => rendererAssets(root, '.js').map((f) => `  <script src="${f}"></script>`).join('\n'),
};

// index.html with its generated stylesheet and script lists replaced (the markers stay).
function renderIndexHtml(text, root = ROOT) {
  const sections = Object.fromEntries(Object.entries(ASSET_SECTIONS).map(([name, build]) => [name, () => build(root)]));
  return renderSections(text, sections, 'src/renderer/index.html');
}

// The channel reference (#338): the request/reply channels of this app's manifest, by area file, each
// with its window.api method, its arguments (one row per named param, or the one argument) and its
// result, as JSON Schema. The channel files are loaded with a stand-in ctx: an entry only reads ctx
// when it is called, and without a workspace (`ws` null) their minute timers do nothing.
function channelReference() {
  const { CHANNELS_DIR } = require('../src/service/manifest');
  const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
  const ctx = new Proxy({}, { get: (target, key) => (key in target ? target[key] : key === 'ws' ? null : stub) });
  const json = (s) => (s === undefined ? '(none)' : `\`${JSON.stringify(s)}\``);
  const lines = [
    '# Channel reference',
    '',
    '<!-- Generated by `npm run docs` from the manifest entries\' `schema` (src/service/channels/): edit the entry, not this file. -->',
    '',
    'Every request/reply channel the service answers (IPC `ipcRenderer.invoke`, `POST /api/<channel>`),',
    'with its arguments and result as JSON Schema (#338; shared definitions: `src/service/schemas.js`).',
    'A call whose arguments break the schema is refused with a 400 before the channel runs.',
    '',
  ];
  for (const f of fs.readdirSync(CHANNELS_DIR).filter((x) => x.endsWith('.js')).sort()) {
    const entries = require(path.join(CHANNELS_DIR, f))(ctx).filter((e) => e.channel);
    if (!entries.length) continue;
    lines.push(`## ${f.replace(/\.js$/, '')}`, '');
    for (const e of entries) {
      lines.push(`### ${e.channel}`, '', `- method: ${e.method ? `\`window.api.${e.method}\`` : '(not exposed)'}`);
      const params = e.schema?.params;
      if (Array.isArray(e.params)) {
        const props = params?.properties || {};
        lines.push('- arguments (one object):', '', '| Name | Schema | Required |', '|---|---|---|');
        for (const name of e.params.map((p) => p.replace(/^\.\.\./, ''))) {
          lines.push(`| \`${name}\` | ${cell(json(props[name]))} | ${(params?.required || []).includes(name) ? 'yes' : ''} |`);
        }
        lines.push('');
      } else if (e.params) lines.push(`- argument \`${e.params}\`: ${json(params)}`);
      else lines.push('- no argument');
      lines.push(`- result: ${e.schema ? json(e.schema.result) : '(no schema)'}`, '');
    }
  }
  return `${lines.join('\n')}\n`;
}

// the problems `--check` reports (also run by npm run check, scripts/check.js)
function checkDocs(root = ROOT) {
  const problems = [];
  const engine = engineIndex(root);
  const current = (rel) => (fs.existsSync(path.join(root, rel)) ? read(root, rel) : null);
  if (buildReadme(root) !== current('README.md')) problems.push('README.md is out of date with docs/readme/: run `npm run docs` and commit it.');
  if (engine !== null && engine !== current(ENGINE_INDEX)) problems.push('docs/agents/engine.md is out of date with docs/agents/engine/: run `npm run docs` and commit it.');
  if (fs.existsSync(path.join(root, INDEX_HTML))) {
    const html = read(root, INDEX_HTML);
    try {
      if (renderIndexHtml(html, root) !== html) problems.push('src/renderer/index.html\'s script and style lists are out of date: run `npm run docs` and commit it.');
    } catch (err) { problems.push(err.message); }
  }
  for (const f of missingHeaders(root)) problems.push(`${f} has no header comment (the code map is built from it).`);
  return problems;
}

function main(argv = process.argv.slice(2), root = ROOT) {
  const derivedOnly = argv.includes('--derived');
  const hasIndex = fs.existsSync(path.join(root, INDEX_HTML));
  const engine = engineIndex(root);
  if (argv.includes('--check')) {
    const problems = checkDocs(root);
    for (const p of problems) console.error(p);
    return problems.length ? 1 : 0;
  }
  fs.writeFileSync(path.join(root, CODE_MAP), codeMap(root));
  // a project outside git or without tests gets a map that says why there is none
  const map = testMap({ root });
  for (const f of Object.keys(map.sources || {})) if (OUTSIDE.some((dir) => f.startsWith(dir))) delete map.sources[f];
  fs.writeFileSync(path.join(root, TEST_MAP), testMapMarkdown(map, { generatedBy: '`npm run docs` (scripts/docs.js)' }));
  fs.writeFileSync(path.join(root, CHANNELS_REF), channelReference());
  fs.mkdirSync(path.join(root, ENGINE_TOPICS), { recursive: true });
  fs.writeFileSync(path.join(root, FIELD_REF), fieldReference());
  if (!derivedOnly) {
    fs.writeFileSync(path.join(root, 'README.md'), buildReadme(root));
    if (engine !== null) fs.writeFileSync(path.join(root, ENGINE_INDEX), engine);
    if (hasIndex) fs.writeFileSync(path.join(root, INDEX_HTML), renderIndexHtml(read(root, INDEX_HTML), root));
  }
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  assembleReadme,
  buildReadme,
  channelReference,
  checkDocs,
  codeMap,
  engineIndex,
  engineTopics,
  featurePieces,
  featureSection,
  headerOf,
  loadRule,
  main,
  missingHeaders,
  rendererAssets,
  renderIndexHtml,
  renderReadme,
  screensTable,
  skillsTable,
};
