// #837 Mockups phase 4: the edges the review asked for, beyond the acceptance tests
// (mockups-phase4-837.test.js, which stays as written):
// - liveLinkPage inlines the kit's two <link> as <style> and escapes a `</style` inside the CSS;
// - detectStorybook with a scoped @storybook/* dependency, and with a `.storybook` FILE (not a folder);
// - listScreens on an older meta.json without `components` answers 'static-kit';
// - importFigma twice with the same file replaces the same-named tokens and same-id figma references;
// - exportPlan with a repeated slug lists each file once;
// - mockups:figma-import with a file without a document is a client error (400) and, given `file`,
//   never reads the keychain;
// - mockups:live-link for an unknown screen is a client error and creates no link.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const mockups = require('../engine/domains/mockups');
const channels = require('../engine/channels/mockups');

const GIT_VARS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];

function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
}

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir));
  return dir;
}

// a temp workspace with an isolated git config; process.env restored after
function workspace(t) {
  const ws = tempDir(t, 'mockups-cov-837-');
  const cfgDir = tempDir(t, 'mockups-cov-cfg-837-');
  const cfg = path.join(cfgDir, 'config');
  fs.writeFileSync(cfg, '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n');
  const saved = Object.fromEntries(GIT_VARS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  });
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  return ws;
}

const doc = (body) => '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>S</title>'
  + '<link rel="stylesheet" href="../../kit/tokens.css"><link rel="stylesheet" href="../../kit/components.css">'
  + `</head><body>${body}</body></html>\n`;

async function withScreens(t, { tokensCss = ':root { --primary: #1a73e8; }\n', componentsCss = '.btn { color: red; }\n' } = {}) {
  const ws = workspace(t);
  await mockups.writeKit(ws, 'p1', { tokensCss, componentsCss, kit: { components: [], inferences: [] } });
  await mockups.createScreen(ws, 'p1', { title: 'Settings', html: doc('<main><h1>Settings</h1></main>'), source: { kind: 'prompt' } });
  return ws;
}

const kitJson = (ws) => JSON.parse(fs.readFileSync(path.join(ws, 'mockups', 'p1', 'kit', 'kit.json'), 'utf8'));
const count = (s, part) => s.split(part).length - 1;

// a ctx for the channels that records the keychain reads and the live links it creates
function channelsFor(ws) {
  const projectsDir = path.join(ws, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.writeFileSync(path.join(projectsDir, 'p1.json'), JSON.stringify({ name: 'Project One' }, null, 2));
  const secretReads = [];
  const links = [];
  const ctx = {
    ws: { root: ws, projects: projectsDir },
    events: new EventEmitter(),
    liveRun: () => null,
    startWorkflowRun: async () => ({ runId: 'r-837' }),
    host: { secrets: { get: async (k) => { secretReads.push(k); return 'figd_secret'; } } },
    createMockupLiveLink: (o) => { links.push(o); return { token: 'a'.repeat(48), path: `/mockups/live/${'a'.repeat(48)}`, expiresAt: null }; },
  };
  const entries = channels(ctx);
  const call = async (channel, arg) => entries.find((x) => x.channel === channel).fn(arg);
  return { call, secretReads, links };
}

const statusOf = async (fn) => { try { await fn(); return 'ok'; } catch (e) { return e.status ?? 'no status'; } };

// ---- liveLinkPage --------------------------------------------------------------------------------------

test('#837 liveLinkPage inlines the kit tokens and components as <style> instead of the two <link>', async (t) => {
  const ws = await withScreens(t);
  const html = mockups.liveLinkPage(ws, 'p1', 'settings');
  assert.deepEqual([count(html, '<link'), count(html, '<style>'), html.includes('--primary: #1a73e8'), html.includes('.btn { color: red; }')],
    [0, 2, true, true]);
});

test('#837 liveLinkPage escapes a </style inside the kit CSS so it cannot close the <style> early', async (t) => {
  const ws = await withScreens(t, { tokensCss: ':root { --a: 1px; }\n/* </style><script>alert(1)</script> */\n' });
  const html = mockups.liveLinkPage(ws, 'p1', 'settings');
  assert.deepEqual([html.includes('</style><script>'), html.includes('<\\/style><script>')], [false, true]);
});

// ---- detectStorybook -----------------------------------------------------------------------------------

test('#837 detectStorybook: a scoped @storybook/react dependency counts as Storybook', (t) => {
  const folder = tempDir(t, 'mockups-sb-837-');
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'shop', dependencies: { '@storybook/react': '^8.4.0' } }));
  const r = mockups.detectStorybook(folder);
  assert.deepEqual([r.available, r.configDir], [true, null]);
});

test('#837 detectStorybook: a .storybook FILE (not a folder) is not Storybook', (t) => {
  const folder = tempDir(t, 'mockups-sb-837-');
  fs.writeFileSync(path.join(folder, '.storybook'), 'not a folder\n');
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'shop' }));
  const r = mockups.detectStorybook(folder);
  assert.deepEqual([r.available, r.configDir], [false, null]);
});

// ---- listScreens on an older meta.json ------------------------------------------------------------------

test('#837 listScreens answers static-kit for a screen whose meta.json predates the components field', async (t) => {
  const ws = await withScreens(t);
  const metaFile = path.join(ws, 'mockups', 'p1', 'screens', 'settings', 'meta.json');
  fs.writeFileSync(metaFile, JSON.stringify({ slug: 'settings', title: 'Settings', source: null, createdAt: '2026-10-01T00:00:00Z' }));
  assert.equal(mockups.listScreens(ws, 'p1').find((s) => s.slug === 'settings')?.components, 'static-kit');
});

// ---- importFigma twice ---------------------------------------------------------------------------------

const FIGMA_FILE = {
  name: 'Shop design',
  document: {
    id: '0:0', type: 'DOCUMENT', name: 'Document',
    children: [{
      id: '0:1', type: 'CANVAS', name: 'Page 1',
      children: [{
        id: '1:10', type: 'FRAME', name: 'Checkout',
        children: [{ id: '1:11', type: 'RECTANGLE', name: 'Pay', fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }], styles: { fill: 'S:1' } }],
      }],
    }],
  },
  styles: { 'S:1': { key: 'k1', name: 'Primary', styleType: 'FILL' } },
};

test('#837 importFigma twice with the same file replaces its tokens and references instead of duplicating them', async (t) => {
  const ws = await withScreens(t);
  await mockups.importFigma(ws, 'p1', { file: FIGMA_FILE });
  await mockups.importFigma(ws, 'p1', { file: FIGMA_FILE });
  const kit = kitJson(ws);
  const tokens = (kit.tokens || []).filter((x) => x && x.name === '--primary').map((x) => x.value);
  const refs = (kit.references || []).filter((r) => r && r.source === 'figma').map((r) => r.id);
  assert.deepEqual([tokens, refs], [['#ff0000'], ['1:10']]);
});

// ---- exportPlan with a repeated slug -------------------------------------------------------------------

test('#837 exportPlan with a repeated slug lists each file once', async (t) => {
  const ws = await withScreens(t);
  const to = mockups.exportPlan(ws, 'p1', { slugs: ['settings', 'settings'] }).files.map((f) => f.to);
  assert.deepEqual([to.length === new Set(to).size, count(to.join('\n'), 'design/mockups/screens/settings/index.html')], [true, 1]);
});

// ---- the channels --------------------------------------------------------------------------------------

test('#837 mockups:figma-import with a file without a document is a client error (400)', async (t) => {
  const ws = await withScreens(t);
  const { call } = channelsFor(ws);
  assert.equal(await statusOf(() => call('mockups:figma-import', { projectId: 'p1', file: { name: 'Not a Figma file' } })), 400);
});

test('#837 mockups:figma-import given a file never reads the Figma token from the keychain', async (t) => {
  const ws = await withScreens(t);
  const { call, secretReads } = channelsFor(ws);
  await statusOf(() => call('mockups:figma-import', { projectId: 'p1', file: { name: 'Not a Figma file' } }));
  await call('mockups:figma-import', { projectId: 'p1', file: FIGMA_FILE, fileKey: 'AbC123' });
  assert.deepEqual(secretReads, []);
});

test('#837 mockups:live-link for an unknown screen is a client error and creates no link', async (t) => {
  const ws = await withScreens(t);
  const { call, links } = channelsFor(ws);
  const status = await statusOf(() => call('mockups:live-link', { projectId: 'p1', slug: 'nowhere' }));
  assert.deepEqual([status, links.length], [400, 0]);
});
