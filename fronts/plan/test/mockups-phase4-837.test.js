// #837 Mockups phase 4: live components (Storybook), export to the repository by PR, Figma import, the
// live link (its server route is pinned in packages/engine/test/mockups-live-link-837.test.js) and the docs.
// Written before the code: every new export, channel and file is loaded inside its test. All simulated
// (MULTIAGENT_SIMULATION_ONLY=1): no model, no workflow run, no network. The contract:
// - fronts/plan/engine/domains/mockups.js, new exports:
//   - detectStorybook(folder) → { available: boolean, configDir: string | null }: available when the project
//     folder has a `.storybook/` folder (configDir '.storybook') or a `storybook` / `@storybook/*` entry in
//     package.json dependencies or devDependencies; otherwise { available: false, configDir: null }.
//   - a screen records how it renders components: listScreens entries gain
//     `components: 'storybook' | 'static-kit'` (meta.json; 'static-kit', D4, when absent).
//   - exportPlan(ws, id, { slugs, kitOfficial = false }) → { targetDir: 'design/mockups', kitOfficial,
//     files: [{ from, to }] }: `from` relative to the mockup folder, `to` relative to the project's repository
//     under design/mockups/ (the kit: design/mockups/kit/tokens.css, components.css, kit.json; each chosen
//     screen: design/mockups/screens/<slug>/index.html, …); only the chosen screens; an empty selection or an
//     unknown slug throws. kitOfficial (Q-2, per project): the kit becomes the project's official design system.
//   - importFigma(ws, id, { file?, fileKey?, token?, fetch? }) → { commit, tokens: [names], references: [{ id, name }] }:
//     `file` is a Figma REST `GET /v1/files/:key` answer (document → CANVAS → FRAME, `styles`); each FILL
//     style of a node becomes a kit token { name: '--<slug of the style name>', value: '#rrggbb', source:
//     'figma' } in kit.json `tokens` (and tokens.css), each top-level FRAME a reference { source: 'figma',
//     id, name } in kit.json `references`, and kit.json `inferences` records the import (an entry naming
//     Figma); ONE commit. A file without a document throws and leaves kit.json as it was. With `fileKey`
//     the real path downloads it with `fetch`; simulated (MULTIAGENT_SIMULATION_ONLY) it never calls fetch.
// - fronts/plan/engine/channels/mockups.js, new channels (channel → api method):
//   mockups:storybook ({ projectId }) → detectStorybook of the project's folder, detectMockupStorybook;
//   mockups:export-repo ({ projectId, slugs, kitOfficial }) → { plan, runId }: real, a
//     workflows/mockups-export.yaml run (inputs project_path, mockup_dir, slugs, kit_official); simulated,
//     the plan and no run (runId null), exportMockupsToRepo;
//   mockups:figma-import ({ projectId, file?, fileKey? }) → importFigma, importMockupFigma;
//   mockups:live-link ({ projectId, slug, ttlMs? }) → { token (48 hex), path: '/mockups/live/<token>',
//     expiresAt }, createMockupLiveLink (served by the engine server, see the server test).
//   mockups:create-screen gives the new screen components 'storybook' when the project has Storybook,
//   'static-kit' otherwise (and the screen still links kit/tokens.css and kit/components.css).
// - workflows/mockups-export.yaml: loads with the engine's workflow loader, metadata.name mockups-export,
//   inputs project_path, mockup_dir, slugs, kit_official, and opens the PR through the pr-pipeline fragment
//   (a step `fragment: pr-pipeline`, as feature.yaml and fix.yaml do).
// - docs/agents/storage/mockups.md documents Storybook, the export (mockups-export), Figma and the live link.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = () => require('../engine/domains/mockups');
const loadChannels = () => require('../engine/channels/mockups');

const GIT_VARS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];

function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
}

// a temp workspace with an isolated git config (identity, main, no autocrlf); process.env restored after
function workspace(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-ws-837-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-cfg-837-'));
  const cfg = path.join(cfgDir, 'config');
  fs.writeFileSync(cfg, '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n');
  const saved = Object.fromEntries(GIT_VARS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rm(ws); rm(cfgDir);
  });
  return ws;
}

// a temp project folder with the given files (relative path → content)
function projectFolder(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-repo-837-'));
  t.after(() => rm(dir));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

const dirOf = (ws, id = 'p1') => path.join(ws, 'mockups', id);
const kitJsonFile = (ws) => path.join(dirOf(ws), 'kit', 'kit.json');
const readKitJson = (ws) => JSON.parse(fs.readFileSync(kitJsonFile(ws), 'utf8'));

// refused: the call throws, and not because the function or the channel is missing (then the test must stay red)
async function refuses(fn) {
  try { await fn(); return false; } catch (e) {
    if ((e instanceof TypeError && /is not a function/.test(e.message)) || e instanceof assert.AssertionError) throw e;
    return true;
  }
}

const doc = (body) => '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>S</title>'
  + '<link rel="stylesheet" href="../../kit/tokens.css"><link rel="stylesheet" href="../../kit/components.css">'
  + `</head><body>${body}</body></html>\n`;
const ORDERS = doc('<main data-mid="m1"><h1 data-mid="m2">Orders</h1></main>');
const SETTINGS = doc('<main data-mid="m1"><h1 data-mid="m2">Settings</h1></main>');
const TOKENS = ':root { --primary: #1a73e8; }\n';

async function withKit(t) {
  const ws = workspace(t);
  const m = load();
  await m.writeKit(ws, 'p1', { tokensCss: TOKENS, componentsCss: '', kit: { components: [], inferences: [] } });
  return { ws, m };
}

// a real ctx for the channels: the workspace, its projects folder, a run starter that records its calls
function channelsFor(ws, { project = null } = {}) {
  const projectsDir = path.join(ws, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  if (project) fs.writeFileSync(path.join(projectsDir, 'p1.json'), JSON.stringify({ name: 'Project One', ...project }, null, 2));
  const started = [];
  const ctx = {
    ws: { root: ws, projects: projectsDir },
    events: new EventEmitter(),
    liveRun: () => null,
    startWorkflowRun: async (opts) => { started.push(opts); return { runId: 'r-837' }; },
  };
  const entries = loadChannels()(ctx);
  const call = async (channel, arg) => {
    const e = entries.find((x) => x.channel === channel);
    assert.ok(e, `no channel ${channel}`);
    return e.fn(arg);
  };
  return { call, started };
}

// ---- live components (Storybook) ----------------------------------------------------------------------

test('#837 detectStorybook: a project with a .storybook/ folder has Storybook', (t) => {
  const folder = projectFolder(t, { '.storybook/main.js': 'module.exports = { stories: [] };\n', 'package.json': '{"name":"shop"}\n' });
  const r = load().detectStorybook(folder);
  assert.deepEqual([r.available, r.configDir], [true, '.storybook']);
});

test('#837 detectStorybook: a storybook devDependency in package.json counts as Storybook', (t) => {
  const folder = projectFolder(t, { 'package.json': JSON.stringify({ name: 'shop', devDependencies: { storybook: '^8.4.0' } }) });
  assert.equal(load().detectStorybook(folder).available, true);
});

test('#837 detectStorybook: a project without Storybook has none (the static kit, D4)', (t) => {
  const folder = projectFolder(t, { 'package.json': JSON.stringify({ name: 'shop', devDependencies: { vite: '^5.0.0' } }) });
  const r = load().detectStorybook(folder);
  assert.deepEqual([r.available, r.configDir], [false, null]);
});

test('#837 simulated, a new screen of a project with Storybook uses its live components', async (t) => {
  const ws = workspace(t);
  const folder = projectFolder(t, { '.storybook/main.js': 'module.exports = {};\n' });
  const { call } = channelsFor(ws, { project: { folder } });
  const { slug } = await call('mockups:create-screen', { projectId: 'p1', title: 'Orders dashboard' });
  assert.equal(load().listScreens(ws, 'p1').find((s) => s.slug === slug)?.components, 'storybook');
});

test('#837 simulated, a new screen of a project without Storybook keeps the static kit and links its stylesheets', async (t) => {
  const ws = workspace(t);
  const folder = projectFolder(t, { 'package.json': '{"name":"shop"}\n' });
  const { call } = channelsFor(ws, { project: { folder } });
  const { slug } = await call('mockups:create-screen', { projectId: 'p1', title: 'Orders dashboard' });
  const screen = load().listScreens(ws, 'p1').find((s) => s.slug === slug);
  const html = load().screenHtml(ws, 'p1', slug);
  assert.deepEqual([screen?.components, html.includes('kit/tokens.css'), html.includes('kit/components.css')], ['static-kit', true, true]);
});

// ---- export to the repository by PR -----------------------------------------------------------------

async function withTwoScreens(t) {
  const { ws, m } = await withKit(t);
  await m.createScreen(ws, 'p1', { title: 'Orders dashboard', html: ORDERS, source: { kind: 'prompt' } });
  await m.createScreen(ws, 'p1', { title: 'Settings', html: SETTINGS, source: { kind: 'prompt' } });
  return { ws, m };
}

test('#837 exportPlan targets design/mockups/ with the kit and only the chosen screens', async (t) => {
  const { ws, m } = await withTwoScreens(t);
  const plan = await m.exportPlan(ws, 'p1', { slugs: ['orders-dashboard'] });
  const to = plan.files.map((f) => f.to);
  const kit = ['design/mockups/kit/components.css', 'design/mockups/kit/kit.json', 'design/mockups/kit/tokens.css'].filter((f) => to.includes(f));
  const screens = [...new Set(to.filter((f) => f.startsWith('design/mockups/screens/')).map((f) => f.split('/')[3]))];
  assert.deepEqual([plan.targetDir, kit.length, screens, to.includes('design/mockups/screens/orders-dashboard/index.html')],
    ['design/mockups', 3, ['orders-dashboard'], true]);
});

test('#837 exportPlan carries the per-project choice of the kit as the official design system (off by default)', async (t) => {
  const { ws, m } = await withTwoScreens(t);
  const official = await m.exportPlan(ws, 'p1', { slugs: ['settings'], kitOfficial: true });
  const plain = await m.exportPlan(ws, 'p1', { slugs: ['settings'] });
  assert.deepEqual([official.kitOfficial, plain.kitOfficial], [true, false]);
});

test('#837 exportPlan refuses an empty selection', async (t) => {
  const { ws, m } = await withTwoScreens(t);
  assert.equal(await refuses(() => m.exportPlan(ws, 'p1', { slugs: [] })), true);
});

test('#837 exportPlan refuses an unknown screen', async (t) => {
  const { ws, m } = await withTwoScreens(t);
  assert.equal(await refuses(() => m.exportPlan(ws, 'p1', { slugs: ['orders-dashboard', 'nowhere'] })), true);
});

test('#837 simulated, mockups:export-repo answers the plan and starts no workflow run', async (t) => {
  const { ws } = await withTwoScreens(t);
  const folder = projectFolder(t, { 'package.json': '{"name":"shop"}\n' });
  const { call, started } = channelsFor(ws, { project: { folder } });
  const r = await call('mockups:export-repo', { projectId: 'p1', slugs: ['settings'], kitOfficial: true });
  assert.deepEqual([r.plan?.targetDir, r.plan?.kitOfficial, r.runId ?? null, started.length], ['design/mockups', true, null, 0]);
});

// ---- workflows/mockups-export.yaml -------------------------------------------------------------------

const EXPORT_WORKFLOW = path.join(ROOT, 'workflows', 'mockups-export.yaml');

test('#837 workflows/mockups-export.yaml loads with the workflow loader and takes the export inputs', () => {
  const wf = require('@multiagent/engine/engine/workflow').loadWorkflow(EXPORT_WORKFLOW);
  const inputs = Object.keys(wf.inputs || {});
  assert.deepEqual([wf.metadata?.name, ['project_path', 'mockup_dir', 'slugs', 'kit_official'].filter((k) => !inputs.includes(k))], ['mockups-export', []]);
});

test('#837 workflows/mockups-export.yaml opens a pull request through the pr-pipeline fragment', () => {
  const raw = require('js-yaml').load(fs.readFileSync(EXPORT_WORKFLOW, 'utf8'));
  assert.equal((raw.steps || []).some((s) => s && s.fragment === 'pr-pipeline'), true);
});

// ---- Figma import ------------------------------------------------------------------------------------

// a Figma REST GET /v1/files/:key answer: two frames on a page, two FILL styles used by their nodes
const FIGMA_FILE = {
  name: 'Shop design',
  lastModified: '2026-11-10T12:00:00Z',
  document: {
    id: '0:0', type: 'DOCUMENT', name: 'Document',
    children: [{
      id: '0:1', type: 'CANVAS', name: 'Page 1',
      children: [
        {
          id: '1:10', type: 'FRAME', name: 'Checkout',
          children: [{ id: '1:11', type: 'RECTANGLE', name: 'Pay', fills: [{ type: 'SOLID', color: { r: 26 / 255, g: 115 / 255, b: 232 / 255, a: 1 } }], styles: { fill: 'S:1' } }],
        },
        {
          id: '1:20', type: 'FRAME', name: 'Orders',
          children: [{ id: '1:21', type: 'RECTANGLE', name: 'Card', fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }], styles: { fill: 'S:2' } }],
        },
      ],
    }],
  },
  styles: {
    'S:1': { key: 'k1', name: 'Primary', styleType: 'FILL', description: '' },
    'S:2': { key: 'k2', name: 'Surface', styleType: 'FILL', description: '' },
  },
};

test('#837 importFigma records the Figma fill styles as kit tokens whose source is figma', async (t) => {
  const { ws, m } = await withKit(t);
  await m.importFigma(ws, 'p1', { file: FIGMA_FILE });
  const tokens = (readKitJson(ws).tokens || []).filter((x) => x && x.source === 'figma').map((x) => [x.name, String(x.value).toLowerCase()]);
  assert.deepEqual(tokens.sort(), [['--primary', '#1a73e8'], ['--surface', '#ffffff']]);
});

test('#837 importFigma records the frames as references and the import as an inference in kit.json', async (t) => {
  const { ws, m } = await withKit(t);
  await m.importFigma(ws, 'p1', { file: FIGMA_FILE });
  const kit = readKitJson(ws);
  const refs = (kit.references || []).filter((r) => r && r.source === 'figma').map((r) => [r.id, r.name]);
  const inferred = (kit.inferences || []).some((i) => /figma/i.test(typeof i === 'string' ? i : JSON.stringify(i)));
  assert.deepEqual([refs, inferred], [[['1:10', 'Checkout'], ['1:20', 'Orders']], true]);
});

test('#837 importFigma refuses a file without a document and leaves kit.json as it was', async (t) => {
  const { ws, m } = await withKit(t);
  const before = fs.readFileSync(kitJsonFile(ws), 'utf8');
  const refused = await refuses(() => m.importFigma(ws, 'p1', { file: { name: 'Not a Figma file' } }));
  assert.deepEqual([refused, fs.readFileSync(kitJsonFile(ws), 'utf8')], [true, before]);
});

test('#837 simulated, importFigma by file key never calls the network', async (t) => {
  const { ws, m } = await withKit(t);
  const calls = [];
  const fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => FIGMA_FILE }; };
  try {
    await m.importFigma(ws, 'p1', { fileKey: 'AbC123xyz', token: 'figd_test', fetch });
  } catch (e) {
    if (e instanceof TypeError && /is not a function/.test(e.message)) throw e;
  }
  assert.deepEqual(calls, []);
});

// ---- the channels ------------------------------------------------------------------------------------

const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
const anyCtx = new Proxy({}, { get: (tg, k) => (k in tg ? tg[k] : k === 'ws' ? null : stub) });

test('#837 the new mockups channels and their api methods', () => {
  const byChannel = Object.fromEntries(loadChannels()(anyCtx).map((c) => [c.channel, c.method]));
  assert.deepEqual(['mockups:storybook', 'mockups:export-repo', 'mockups:figma-import', 'mockups:live-link'].map((c) => byChannel[c] ?? null),
    ['detectMockupStorybook', 'exportMockupsToRepo', 'importMockupFigma', 'createMockupLiveLink']);
});

// ---- docs --------------------------------------------------------------------------------------------

test('#837 docs/agents/storage/mockups.md documents Storybook, the export by PR, the Figma import and the live link', () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'agents', 'storage', 'mockups.md'), 'utf8');
  assert.deepEqual(['Storybook', 'mockups-export', 'Figma', 'mockups:live-link', 'mockups:export-repo', 'mockups:figma-import'].filter((w) => !md.includes(w)), []);
});
