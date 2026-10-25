// Generated docs: files built from small per-feature sources, so features add a file instead of
// editing a shared table (fewer merge conflicts between parallel runs, issue #77).
//   docs/agents/code-map.md  from the header comment at the top of each source file, plus one row
//                            per screen folder (apps/desktop/renderer/views/<view>/). Derived and
//                            gitignored (nobody reads it at runtime): rebuilt by `prepare`,
//                            `prestart`, `pretest` and `prebuild`, so a pull never leaves it stale.
//   docs/agents/test-map.md  (#219) the static code → tests map: for every source file, the test
//                            files that import it directly or transitively (the affected tests'
//                            import graph, packages/engine/engine/affected-tests.js testMap). Derived and
//                            gitignored like the code map; agents read it instead of guessing.
//   docs/agents/channels.md  (#338) the channel reference: every request/reply channel of the app's
//                            manifest (packages/engine/service/manifest.js) with its arguments and its result,
//                            from each entry's `schema`. Derived and gitignored like the code map;
//                            always this app's channels (the ones of the checkout docs.js runs from).
//   docs/agents/engine/field-reference.md  (#352) the workflow YAML's field rules, one row per entry of
//                            FIELD_RULES (packages/engine/engine/run/field-rules.js): field, applies to, type,
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
//   apps/<app>/renderer/index.html  each app's page (apps/desktop, phase 3's apps/web): its stylesheets
//                            and scripts, between `<!-- generated:styles -->` / `<!-- generated:scripts -->`
//                            markers (#152), from the app's composition (`<app>/composition.js`, the
//                            fronts it ships; scripts/source-tree.js): adding a screen or a module adds
//                            files, never a hand-edited line. Committed (the page loads it as is).
//                            Order, per list: the pure modules of packages/shared/ (scripts, `<relative
//                            path>/<file>`, #345; its subfolders first, each folder's index.js after
//                            its other files, #351), then the files whose header has `load: early`
//                            (any layer), then the UI kit (packages/ui-kit: app.js first, its other
//                            root files, its views/<view>/), then each front of the composition in
//                            order (fronts/<id>/views/<view>/), then the app's own page files, each
//                            group sorted by path; `load: after <file> [<file>…]` in a header puts a
//                            file after the ones it needs as it loads (a file of the same layer, else
//                            of the kit). A reason may follow in parentheses. Vendor files (node_modules)
//                            stay hand-kept outside the markers. Paths are relative to the page.
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
const { testMap, testMapMarkdown } = require('@multiagent/engine/engine/affected-tests');
const { fieldReference } = require('@multiagent/engine/engine/run/field-rules');
const {
  appPages,
  composition,
  frontEngineDirs,
  pageDirs,
  sourceFiles,
  uiKit,
  viewsOf,
  workspaces,
} = require('./source-tree');

const ROOT = path.join(__dirname, '..');
const CODE_MAP = path.join('docs', 'agents', 'code-map.md');
const TEST_MAP = path.join('docs', 'agents', 'test-map.md');
const CHANNELS_REF = path.join('docs', 'agents', 'channels.md');
const SUFFIXES = ['js', 'python', 'go', 'java', 'csharp', 'rust', 'gh', 'gl'];
// The source files mapped one by one (scripts/source-tree.js: the workspaces and scripts/; their .js
// and .jsx files, recursively: .jsx are the run's 3D view's sources, packages/ui-kit/run3d/, bundled by
// scripts/build-3d.js).
const listSources = (root) => sourceFiles(root, { scripts: true, match: /\.jsx?$/ });
// Folders that are not part of the app: left out of the code → tests map (poc/: proofs of concept).
const OUTSIDE = ['poc/'];
// Folders described as a whole: no header comment to read from.
const FOLDERS = [
  ['packages/engine/domains/', 'The backend\'s domain modules (phase 1 of `docs/reorganisation-study-2026-10.md`), one folder per domain (agents, analytics, backlog, chat, cli, discovery, evidence, local, machine, night, oracle, po, project, refactor, releases, roadmap, run, seed, session, supervisor, usage, workflow, workspace): what the service and the engine require besides each other. A new module goes in the folder of the domain that uses it; its tests in `test/<domain>/`. Layers: `scripts/layers.js`.'],
  ['apps/desktop/', 'The workspace `@multiagent/desktop` (phase 2 of `docs/reorganisation-study-2026-10.md`): the Electron desktop app. `host/` (the main process the root `package.json` names, the preloads, the windows and their guards), `renderer/` (the UI, also served by the engine server), `assets/` (the icons), `scripts/package.js` (the packager, run from the root as `npm run build`); the native module `node-pty` is its dependency (decision 6). Its tests in `apps/desktop/test/`.'],
  ['apps/desktop/host/', 'The Electron host (phase 1 of `docs/reorganisation-study-2026-10.md`): `main.js` (the entry `package.json` names), the preloads, the windows and their guards, the account sign-in, the external terminal and Keep awake. The service and the engine require nothing here (`scripts/layers.js`, area `desktop`).'],
  ['apps/desktop/renderer/', 'Plain HTML/CSS/JS UI, no bundler (index.html, style.css and one script per screen; moved screens in `views/<view>/`, registered with `registerView`). index.html\'s `<link>`/`<script>` lists are generated by `npm run docs` (order: `load:` header lines). See [renderer.md](renderer.md).'],
  ['packages/engine/', 'The workspace `@multiagent/engine` (phase 2 of `docs/reorganisation-study-2026-10.md`): the engine (`engine/`), the service (`service/`, its channels and areas), the HTTP/WebSocket server and the control channel (`server/`, `control/`), the domain modules (`domains/<name>/`, the account sign-in in `domains/account/`) and the `multiagent-engine` bin (`bin/`, today\'s `npm run serve`), each folder at the package root so the requires inside the package stay relative; required from the host and the scripts as `@multiagent/engine/<folder>/<file>`. Bundled defaults (workflows, skills, pipelines, seeds, fragments) come from the app root (`domains/workspace/app-root.js`), never from the package\'s folder. Its tests in `packages/engine/test/`. Layers: `scripts/layers.js`.'],
  ['packages/shared/', 'The workspace `@multiagent/shared` (phase 2 of `docs/reorganisation-study-2026-10.md`): pure modules both sides use (#345), each working with `require` (`@multiagent/shared/<file>`) and as a renderer `<script>` (a browser global), requiring nothing of the app and loading before the renderer\'s files; its tests in `packages/shared/test/`. The layers of the sources and their allowed directions: `scripts/layers.js`. See [renderer.md](renderer.md).'],
  ['packages/ui-kit/', 'The workspace `@multiagent/ui-kit` (phase 3 of `docs/reorganisation-study-2026-10.md`, #579): the UI kit every page starts from, plain scripts and stylesheets a page loads (no bundler): the shell (`app.js`, `view-registry.js`, the header, the sidebar, Setup, the account), the run kernel (the run lists, the gate panel, the artifacts panel, the Start drawer, the agent chat, the run\'s 3D view), the controls (select, toast, alerts, the image and diff viewers) and `style.css`; the shell\'s screens in `views/` (Home, Settings). Required by nothing (layer `renderer`: it may require only `packages/shared/`); its tests in `packages/ui-kit/test/`. See [renderer.md](renderer.md).'],
  ['fronts/', 'The fronts (phase 3 of `docs/reorganisation-study-2026-10.md`, decision 7): one workspace `fronts/<id>/` = `@multiagent/front-<id>` per front (`analyser`, `build`, `plan`, `ai`), each a package of `views/<view>/` folders that register themselves with `registerView`, their CSS, its `features/` and its `test/`. An app\'s `composition.js` lists the fronts it ships; `scripts/source-tree.js` is where the tooling learns them. A front never requires another one (layer `renderer`). See [renderer.md](renderer.md), "Composition".'],
  ['apps/web/', 'The workspace `@multiagent/web` (phase 3 of `docs/reorganisation-study-2026-10.md`): the browser UI the engine server serves at `/` (the root `package.json`\'s `multiagent.ui`): `composition.js` (the fronts it ships), `renderer/index.html` (generated from the composition) and `renderer/api-http.js` (`window.api` over the server\'s HTTP and WebSocket API). Not part of the desktop asar: the desktop app attached to a remote engine loads this page from the engine.'],
  ['packages/engine/service/channels/', 'The service\'s channels, one file per area (see `packages/engine/service/manifest.js`).'],
  ['fronts/<id>/engine/', 'A front\'s engine side (phase 4 of `docs/reorganisation-study-2026-10.md`, #590): `channels/` and `areas/`, loaded next to the kernel\'s when the app\'s composition serves the front (`packages/engine/service/fronts.js`), and `domains/`, the modules only that front\'s engine files require. It requires `@multiagent/engine` and `@multiagent/shared`, never another front (layer `front-engine:<id>`); the front\'s UI reaches it only through `window.api`. See [fronts.md](fronts.md).'],
  ['native/', 'The cargo workspace of the native sidecars (#341), one crate per binary, shipped in `resources/bin/`: `multiagent-mcp`, the Rust twin of `packages/engine/domains/supervisor/supervisor-mcp.js` (started by `mcpCommand` when built). See [environment.md](environment.md).'],
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
  // the channel files are documented by docs/agents/channels.md, the kernel's and the fronts' alike
  const channelFolders = ['packages/engine/service/channels/', ...frontEngineDirs(root).map((f) => `${f.engine}/channels/`)];
  const files = listSources(root).filter((f) => !channelFolders.some((d) => f.startsWith(d)));
  const rows = files.map((f) => `| \`${f}\` | ${cell(headerOf(read(root, f))) || '(no header comment)'} |`);
  // One row per screen folder (<layer>/views/<view>/: the UI kit's, each front's and each app's page
  // folder's, scripts/source-tree.js), discovered: its files, from disk.
  const viewRows = pageDirs(root).flatMap((dir) => viewsOf(root, dir).map((v) => {
    const own = fs.readdirSync(path.join(root, dir, 'views', v)).filter((f) => /\.(js|css)$/.test(f)).sort();
    return `| \`${dir}/views/${v}/\` | The ${v} screen's folder (registered with \`registerView\`): ${own.map((f) => `\`${f}\``).join(', ')}. |`;
  }));
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
    '- **A channel** (`window.api` method): add an entry to the area\'s file in `packages/engine/service/channels/`',
    '  (or a new file there: files are discovered), or, when one front\'s screens alone call it, in that',
    '  front\'s `fronts/<id>/engine/channels/` (phase 4, [fronts.md](fronts.md)). `apps/desktop/host/preload.js` and `apps/web/renderer/api-http.js` build',
    '  `window.api` from the manifest at runtime; nothing else to edit. The entry carries its',
    '  `schema: { params, result }` (JSON Schema, #338; shared ids and builders in `packages/engine/service/schemas.js`):',
    '  the service refuses arguments that break `params` with a 400 before the channel runs, and the tests',
    '  check every result against `result`. A channel without one fails',
    '  `test/service/channel-schema-ratchet-338.test.js`. The reference of every channel is',
    '  [channels.md](channels.md) (generated, gitignored).',
    '- **Service state or a helper behind a channel**: add it to its area\'s file in `packages/engine/service/areas/`',
    '  (or a new file there: files are discovered, see `packages/engine/service/index.js`; a front\'s own in',
    '  `fronts/<id>/engine/areas/`), never to `packages/engine/service/index.js`;',
    '  its tests go in `test/service/<area>.test.js` (a front\'s in `fronts/<id>/test/`; see [testing.md](testing.md)).',
    '- **A screen**: a folder `views/<view>/` in the front that owns it (`fronts/<id>/views/<view>/`; a shell',
    '  screen in `packages/ui-kit/views/`) with',
    '  `<view>.js` calling `registerView` and `<view>.css` (see [renderer.md](renderer.md), "Composition"),',
    '  a fragment `docs/screens/<view>.md` (`menu`, `order`, text) for',
    '  the README table, and its screenshot seed `scripts/screenshot/views/<view>.js` (its tabs, modes,',
    '  demo data and how it opens; found by the screenshot runner, which is never edited for a screen);',
    '  run `npm run docs`, which lists its files in `index.html` (never by hand).',
    '- **A renderer module or stylesheet** (the UI kit\'s `packages/ui-kit/*.js|css`, or the page\'s own folder):',
    '  add the file and run `npm run docs`; a `load: early` or `load: after <file>` line in its header when it',
    '  needs others as it loads (a file of the same package, else of the UI kit).',
    '- **Code both the UI and the backend use** (pure: no DOM, no fs, no Electron): a dual-load module in',
    '  `packages/shared/` (`module.exports` under Node, a `window` global as a `<script>`; copy',
    '  `packages/shared/display-name.js`) and run `npm run docs`. The backend never requires the UI (the kit, the fronts, the apps\' pages).',
    '- **Something GitHub and GitLab do differently** (a `gh`/`glab` command, its JSON, a term such as',
    '  "PR #" / "MR !"): a member of both platform adapters, `packages/shared/platforms/github.js` and `gitlab.js`',
    '  (#351), called through the registry (`resolvePlatform` / `platformOrDefault` in `packages/shared/platforms/index.js`,',
    '  by either vocabulary: `github`/`gh`, `gitlab`/`gl`), never an `if (platform === ...)` branch: a',
    '  platform literal outside the adapters fails `test/platform-literals-351.test.js`. See [capabilities.md](capabilities.md).',
    '- **A provider** (a fourth CLI, #348): one adapter file `packages/shared/providers/<id>.js` (copy `codex.js`: id,',
    '  type, label, model prefixes, workflow definition, isolationArgs, stream parser, usage-limit patterns,',
    '  sessions folder, trust) plus its two lines in `packages/shared/providers/index.js`, the registry (its',
    '  `require`, its `window` global); run',
    '  `npm run docs` for its `<script>` tag. Nothing else names a provider: `test/provider-registry-348.test.js`',
    '  fails on a provider literal outside `packages/shared/providers/` (see [engine/providers.md](engine/providers.md)).',
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
    '- **Something in the workspace index** (`<workspace>/index.db`, `packages/engine/domains/workspace/store.js`): append a migration to',
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
  return listSources(root).filter((f) => !headerOf(read(root, f)));
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
    'Read the topic you need before changing `packages/engine/engine/workflow.js` or a workflow YAML. The README',
    'documents the same features for users; these topics are the implementer\'s summary, one file each.',
    'Which field is valid where, its type and the loader\'s message: [the field reference](engine/field-reference.md)',
    '(generated from the loader\'s rule table, #352; gitignored like the code map).',
    '',
    ...topics.map((t) => `- [${t.title}](engine/${t.file})${t.summary ? `: ${t.summary}` : ''}`),
    '',
  ].join('\n');
}

// ---- the pages: index.html generated from each app's composition (phase 3 of the reorganisation study) ----
// The apps whose page is generated: those with a page folder (scripts/source-tree.js appPages, the one
// place that knows the page folder's name) holding an index.html.
const pageApps = (root) => appPages(root).filter((a) => fs.existsSync(path.join(root, ...a.page.split('/'), 'index.html'))).map((a) => a.app);
const DEFAULT_APP = 'apps/desktop';
const indexHtmlOf = (root, app) => `${composition(root, app).page}/index.html`;
// The shared package's folder (path from root, with /): the workspace named @multiagent/shared
// (scripts/source-tree.js), so index.html's <script> paths follow the package wherever it lives.
const SHARED_PACKAGE = '@multiagent/shared';
function sharedDir(root) {
  const w = workspaces(root).find((x) => x.name === SHARED_PACKAGE);
  if (w) return w.dir;
  return fs.existsSync(path.join(root, 'packages', 'shared')) ? 'packages/shared' : null;
}
const RENDERER_MAIN = 'app.js';

// The `load:` line of a file's header: { early, after: [paths relative to the file's own layer] }.
function loadRule(text, file) {
  const m = /^\s*load:\s*([^(\n]*?)\s*(?:\(.*\))?\s*$/m.exec(headerOf(text));
  if (!m) return { early: false, after: [] };
  const [kind, ...files] = m[1].split(/\s+/);
  if (kind === 'early' && !files.length) return { early: true, after: [] };
  if (kind === 'after' && files.length) return { early: false, after: files };
  throw new Error(`${file}: unknown load rule "load: ${m[1]}" (use \`load: early\` or \`load: after <file> …\`).`);
}

// The page files of one layer (the UI kit, a front, the app's own renderer folder): its root files,
// then its views/<view>/ files, each sorted by path; nothing deeper (run3d/, city3d/, test/ are not page files).
function layerFiles(root, dir, ext) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const filesIn = (rel) => fs.readdirSync(path.join(abs, rel), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => posix(path.join(rel, e.name))).sort();
  const views = viewsOf(root, dir).flatMap((v) => filesIn(path.join('views', v)));
  return [...filesIn('.'), ...views];
}

// The layers of an app's page, in load order: the UI kit (packages/ui-kit, when installed), the
// fronts its composition names (scripts/source-tree.js composition), then the app's own page folder
// (`<app>/renderer/`: index.html and the files only that app has, e.g. the browser's api-http.js).
// Each: { id, dir, prefix (from the page folder to the layer, '' for the page itself), kit }.
function pageLayers(root, app = DEFAULT_APP) {
  const { page, fronts: list } = composition(root, app);
  const kit = uiKit(root);
  const layers = [
    ...(kit ? [{ id: 'ui-kit', dir: kit.dir, kit: true }] : []),
    ...list.map((f) => ({ id: f.id, dir: f.dir, kit: false })),
    { id: 'app', dir: page, kit: false },
  ];
  return layers.map((l) => ({ ...l, prefix: l.dir === page ? '' : `${posix(path.relative(path.join(root, page), path.join(root, l.dir)))}/` }));
}

// The page's own files with extension `ext` ('.js' or '.css'), as paths relative to its index.html,
// in load order (see the header): the shared package's pure modules (scripts), then the files whose
// header has `load: early` (any layer), then the kit's app.js, then the kit's other root files, the
// kit's views, each front's files in the composition's order, and the app's own files last; a
// `load: after <file> …` names a file of the same layer, else one of the UI kit (which loads before
// every front); every group in path order, a file moved down only until what it names is placed.
function rendererAssets(root, ext, app = DEFAULT_APP) {
  const layers = pageLayers(root, app);
  const kitLayer = layers.find((l) => l.kit) || null;
  const items = layers.flatMap((layer) => layerFiles(root, layer.dir, ext).map((file) => ({ layer, file, key: `${layer.dir}/${file}`, out: `${layer.prefix}${file}` })));
  // the shell's files live where app.js is: the kit, or the page folder itself while the kit is empty
  const shell = items.find((it) => it.file === RENDERER_MAIN)?.layer || kitLayer || layers[layers.length - 1];
  const byKey = new Map(items.map((it) => [it.key, it]));
  for (const it of items) {
    it.rule = loadRule(read(root, it.key), it.key);
    it.deps = it.rule.after.map((dep) => {
      const own = byKey.get(`${it.layer.dir}/${dep}`);
      const kit = kitLayer && byKey.get(`${kitLayer.dir}/${dep}`);
      if (!own && !kit) throw new Error(`${it.key}: "load: after ${dep}" names no file of ${it.layer.dir}/${kitLayer && kitLayer !== it.layer ? ` or of ${kitLayer.dir}/` : ''}.`);
      return (own || kit).key;
    });
  }
  const isView = (it) => it.file.startsWith('views/');
  const groups = [
    items.filter((it) => it.rule.early),
    items.filter((it) => it.layer === shell && it.file === RENDERER_MAIN && !it.rule.early),
    items.filter((it) => it.layer === shell && !isView(it) && it.file !== RENDERER_MAIN && !it.rule.early),
    items.filter((it) => it.layer === shell && isView(it) && !it.rule.early),
    ...layers.filter((l) => l !== shell).map((l) => items.filter((it) => it.layer === l && !it.rule.early)),
  ];
  const placed = [];
  const done = new Set();
  for (const group of groups) {
    const left = [...group];
    while (left.length) {
      const i = left.findIndex((it) => it.deps.every((dep) => done.has(dep)));
      if (i < 0) throw new Error(`${app}: the load: after rules of ${left.map((it) => it.key).join(', ')} name a later file or form a cycle.`);
      const [it] = left.splice(i, 1);
      placed.push(it.out);
      done.add(it.key);
    }
  }
  // the pure modules of the shared package first: they need nothing as they load, the page's files read them
  const pageDir = composition(root, app).page;
  const sharedRel = sharedDir(root);
  const shared = ext === '.js' && sharedRel && fs.existsSync(path.join(root, sharedRel)) ? sharedScripts(path.join(root, sharedRel), ext, posix(path.relative(path.join(root, pageDir), path.join(root, sharedRel)))) : [];
  return [...shared, ...placed];
}

// The scripts of the shared package, as `<prefix>/<file>` paths relative to index.html: its subfolders
// first (e.g. platforms/, #351: the adapters, then the folder's index.js, which reads them as it loads),
// then its own files, each sorted by name. Its test/ folder is not loaded.
function sharedScripts(sharedAbs, ext, prefix) {
  const entries = fs.readdirSync(sharedAbs, { withFileTypes: true });
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name).sort();
  const indexLast = (names) => [...names.filter((n) => n !== `index${ext}`), ...names.filter((n) => n === `index${ext}`)];
  const nested = entries.filter((e) => e.isDirectory() && !['node_modules', 'test'].includes(e.name)).map((e) => e.name).sort()
    .flatMap((d) => indexLast(files(path.join(sharedAbs, d))).map((n) => `${prefix}/${d}/${n}`));
  return [...nested, ...files(sharedAbs).map((n) => `${prefix}/${n}`)];
}

const ASSET_SECTIONS = {
  styles: (root, app) => rendererAssets(root, '.css', app).map((f) => `  <link rel="stylesheet" href="${f}" />`).join('\n'),
  scripts: (root, app) => rendererAssets(root, '.js', app).map((f) => `  <script src="${f}"></script>`).join('\n'),
};

// An app's index.html with its generated stylesheet and script lists replaced (the markers stay).
function renderIndexHtml(text, root = ROOT, app = DEFAULT_APP) {
  const sections = Object.fromEntries(Object.entries(ASSET_SECTIONS).map(([name, build]) => [name, () => build(root, app)]));
  return renderSections(text, sections, indexHtmlOf(root, app));
}

// The channel reference (#338): the request/reply channels of this app's manifest, by area file, each
// with its window.api method, its arguments (one row per named param, or the one argument) and its
// result, as JSON Schema. The channel files are loaded with a stand-in ctx: an entry only reads ctx
// when it is called, and without a workspace (`ws` null) their minute timers do nothing.
function channelReference() {
  const { CHANNELS_DIR } = require('@multiagent/engine/service/manifest');
  const { installedFronts, serviceFiles } = require('@multiagent/engine/service/fronts');
  const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
  const ctx = new Proxy({}, { get: (target, key) => (key in target ? target[key] : key === 'ws' ? null : stub) });
  const json = (s) => (s === undefined ? '(none)' : `\`${JSON.stringify(s)}\``);
  const lines = [
    '# Channel reference',
    '',
    '<!-- Generated by `npm run docs` from the manifest entries\' `schema` (packages/engine/service/channels/ and the fronts\' engine/channels/): edit the entry, not this file. -->',
    '',
    'Every request/reply channel the service answers (IPC `ipcRenderer.invoke`, `POST /api/<channel>`),',
    'with its arguments and result as JSON Schema (#338; shared definitions: `packages/engine/service/schemas.js`).',
    'A call whose arguments break the schema is refused with a 400 before the channel runs.',
    '',
  ];
  // the kernel's files and every installed front's (fronts/<id>/engine/channels/, phase 4, #590), in
  // the service's own order; a front's section says which front holds it
  for (const { file, name, from } of serviceFiles(CHANNELS_DIR, installedFronts(ROOT), 'channels')) {
    const entries = require(file)(ctx).filter((e) => e.channel);
    if (!entries.length) continue;
    lines.push(`## ${name.replace(/\.js$/, '')}${from === 'engine' ? '' : ` (the ${from} front)`}`, '');
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
  for (const app of pageApps(root)) {
    const html = read(root, indexHtmlOf(root, app));
    try {
      if (renderIndexHtml(html, root, app) !== html) problems.push(`${indexHtmlOf(root, app)}'s script and style lists are out of date: run \`npm run docs\` and commit it.`);
    } catch (err) { problems.push(err.message); }
  }
  for (const f of missingHeaders(root)) problems.push(`${f} has no header comment (the code map is built from it).`);
  return problems;
}

function main(argv = process.argv.slice(2), root = ROOT) {
  const derivedOnly = argv.includes('--derived');
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
    for (const app of pageApps(root)) fs.writeFileSync(path.join(root, indexHtmlOf(root, app)), renderIndexHtml(read(root, indexHtmlOf(root, app)), root, app));
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
  pageApps,
  pageLayers,
  rendererAssets,
  renderIndexHtml,
  renderReadme,
  screensTable,
  skillsTable,
};
