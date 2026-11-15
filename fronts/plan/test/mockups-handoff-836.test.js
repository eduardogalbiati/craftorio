// #836 Mockups phase 3 (the handoff): the new exports of fronts/plan/engine/domains/mockups.js, the new
// mockups:* channels (fronts/plan/engine/channels/mockups.js), the crops reaching the issues of the #258 commit
// (packages/engine/domains/discovery/discovery-commit.js) and the i18n/docs of the new labels. Written before
// the code: every new export is loaded inside its test. All simulated (MULTIAGENT_SIMULATION_ONLY=1, set by
// `npm test`): no model is called, no workflow run starts. The contract:
// - freezeVersion(ws, id, { slug, commit }) → { ref: '<slug>@<full sha>', slug, commit (full sha), dir }: `dir`
//   is a folder holding the screen as it was at that commit (index.html) and the kit as it was then
//   (kit/tokens.css, kit/components.css, kit/kit.json); later turns or kit changes leave it alone; no new
//   commit in the mockup repository; a bad commit throws. Its path is what a dev run's `mockup` input gets.
//   Channel mockups:freeze ({ projectId, slug, commit }), api method freezeMockupVersion.
// - saveCrops(ws, id, { slug, commit, regions: [{ mid, data }] }) → [{ mid, file, name }] in the regions'
//   order: each cropped image (data: a data URL, base64 or a Buffer, as saveRef) saved in the mockup folder
//   (`file` relative to it); a mid the screen does not have at that commit, a bad commit or an empty image
//   throws. Channel mockups:crops ({ projectId, slug, commit, regions: [{ mid, box?, data? }] }), api method
//   saveMockupCrops: a region without `data` is captured by the host (ctx.host) or, without one (a browser,
//   simulation), drawn as a placeholder image; each crop still carries its mid.
// - mockups:review ({ projectId, slug, axe? }), api method reviewMockupScreen: the on-demand review of the
//   screen (kit conformance, axe, layout) → { findings: [{ kind: 'kit' | 'axe' | 'layout', rule, … }],
//   costUsd, model }; simulated: the kit lint's problems and the given axe violations as findings, $0, no
//   run. Its estimate is mockups:estimate 'review-screen' (shown first by the UI). A designer turn
//   (mockups:chat) never reviews.
// - mockups:recreate ({ projectId, title, url? }), api method recreateMockupFromApp: a new screen recreated
//   from the running app (Run App / Local preview: the project's localPreview, else the repository's
//   .multiagent/local-preview.yaml) → { slug, commit, runId }; the screen's source is
//   { kind: 'running-app', url } and it links the project's kit; refused (and nothing created) when no Run
//   App / Local preview is set; simulated: no workflow run; real: mockup-generate with mode 'recreate'.
//   Its estimate is mockups:estimate 'recreate-screen' (a new MockupModel action).
// - the #258 commit: checkSplit keeps each issue's `crops` ([{ mid, file, name }]) and issueBody shows each
//   crop with its data-mid.
// Each test gets a temp workspace and an isolated git config (like mockups-phase2-835), env restored after.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = () => require('../engine/domains/mockups');
const loadChannels = () => require('../engine/channels/mockups');
const loadModel = () => require('@multiagent/shared/mockup-model');
const loadCommit = () => require('@multiagent/engine/domains/discovery/discovery-commit');

const GIT_VARS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];

function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
}

// a temp workspace with an isolated git config (identity, main, no autocrlf); process.env restored after
function workspace(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-ws-836-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-cfg-836-'));
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

const dirOf = (ws, id = 'p1') => path.join(ws, 'mockups', id);
const git = (ws, ...args) => execFileSync('git', args, { cwd: dirOf(ws), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const commitCount = (ws) => Number(git(ws, 'rev-list', '--count', 'HEAD'));

// refused: the call throws, and not because the function or the channel is missing (then the test must stay red)
async function refuses(fn) {
  try { await fn(); return false; } catch (e) {
    if ((e instanceof TypeError && /is not a function/.test(e.message)) || e instanceof assert.AssertionError) throw e;
    return true;
  }
}

const doc = (body) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>S</title>`
  + '<link rel="stylesheet" href="../../kit/tokens.css"><link rel="stylesheet" href="../../kit/components.css">'
  + `</head><body>${body}</body></html>\n`;
const V1 = doc('<main data-mid="m1"><h1 data-mid="m2">Orders</h1><button data-mid="m5">Pay</button></main>');
const V2 = doc('<main data-mid="m1"><h1 data-mid="m2">Orders, later</h1></main>');
const BUY = doc('<main data-mid="m1"><button style="background:#ff3366" data-mid="m5">Buy</button></main>');
const TOKENS = ':root { --primary: #1a73e8; }\n';
const LATER_TOKENS = ':root { --primary: #000000; }\n';

const png = (n) => `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n]).toString('base64')}`;

async function withScreen(t, html = V1, title = 'Orders dashboard') {
  const ws = workspace(t);
  const m = load();
  await m.writeKit(ws, 'p1', { tokensCss: TOKENS, componentsCss: '', kit: { components: [] } });
  const { slug, commit } = await m.createScreen(ws, 'p1', { title, html, source: { kind: 'prompt' } });
  return { ws, m, slug, commit };
}

// ---- freeze a version (the `mockup` input of a dev run) ---------------------------------------------

test('#836 freezeVersion gives the ref <slug>@<full sha> of the version', async (t) => {
  const { ws, m, slug, commit } = await withScreen(t);
  const full = git(ws, 'rev-parse', commit);
  const f = await m.freezeVersion(ws, 'p1', { slug, commit: commit.slice(0, 7) });
  assert.deepEqual([f.ref, f.slug, f.commit], [`orders-dashboard@${full}`, 'orders-dashboard', full]);
});

test('#836 the frozen folder holds the screen as it was at that version, after a later turn', async (t) => {
  const { ws, m, slug, commit } = await withScreen(t);
  await m.saveTurn(ws, 'p1', { slug, html: V2, message: 'later' });
  const { dir } = await m.freezeVersion(ws, 'p1', { slug, commit });
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), V1);
});

test('#836 the frozen folder holds the kit as it was at that version, after the kit changed', async (t) => {
  const { ws, m, slug, commit } = await withScreen(t);
  await m.writeKit(ws, 'p1', { tokensCss: LATER_TOKENS, componentsCss: '', kit: { components: [] } });
  const { dir } = await m.freezeVersion(ws, 'p1', { slug, commit });
  assert.equal(fs.readFileSync(path.join(dir, 'kit', 'tokens.css'), 'utf8'), TOKENS);
});

test('#836 a frozen folder stays as it was when the screen changes after the freeze', async (t) => {
  const { ws, m, slug, commit } = await withScreen(t);
  const { dir } = await m.freezeVersion(ws, 'p1', { slug, commit });
  await m.saveTurn(ws, 'p1', { slug, html: V2, message: 'after the freeze' });
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), V1);
});

test('#836 freezeVersion makes no commit in the mockup repository', async (t) => {
  const { ws, m, slug, commit } = await withScreen(t);
  const before = commitCount(ws);
  await m.freezeVersion(ws, 'p1', { slug, commit });
  assert.equal(commitCount(ws), before);
});

test('#836 freezeVersion refuses a bad commit', async (t) => {
  const { ws, m, slug } = await withScreen(t);
  assert.equal(await refuses(() => m.freezeVersion(ws, 'p1', { slug, commit: 'not a commit' })), true);
});

// ---- crops (Product Owner issues: each selected region as a cropped image with its data-mid) ---------

test('#836 saveCrops gives one crop per region, with its data-mid, in the regions\' order', async (t) => {
  const { ws, m, slug, commit } = await withScreen(t);
  const crops = await m.saveCrops(ws, 'p1', { slug, commit, regions: [{ mid: 'm5', data: png(1) }, { mid: 'm2', data: png(2) }] });
  assert.deepEqual(crops.map((c) => c.mid), ['m5', 'm2']);
});

test('#836 each crop\'s file is saved in the mockup folder with the image\'s bytes', async (t) => {
  const { ws, m, slug, commit } = await withScreen(t);
  const [crop] = await m.saveCrops(ws, 'p1', { slug, commit, regions: [{ mid: 'm5', data: png(7) }] });
  const bytes = fs.readFileSync(path.join(dirOf(ws), ...String(crop.file).split('/')));
  assert.equal(bytes.equals(Buffer.from(png(7).replace(/^data:[^,]*,/, ''), 'base64')), true);
});

test('#836 saveCrops refuses a data-mid the screen does not have at that version', async (t) => {
  const { ws, m, slug, commit } = await withScreen(t);
  assert.equal(await refuses(() => m.saveCrops(ws, 'p1', { slug, commit, regions: [{ mid: 'm99', data: png(1) }] })), true);
});

test('#836 saveCrops refuses a data-mid a later turn removed (the version\'s elements count)', async (t) => {
  const { ws, m, slug } = await withScreen(t);
  const { commit: later } = await m.saveTurn(ws, 'p1', { slug, html: V2, message: 'no more button' });
  assert.equal(await refuses(() => m.saveCrops(ws, 'p1', { slug, commit: later, regions: [{ mid: 'm5', data: png(1) }] })), true);
});

test('#836 saveCrops refuses an empty image', async (t) => {
  const { ws, m, slug, commit } = await withScreen(t);
  assert.equal(await refuses(() => m.saveCrops(ws, 'p1', { slug, commit, regions: [{ mid: 'm5', data: '' }] })), true);
});

test('#836 saveCrops refuses a bad commit', async (t) => {
  const { ws, m, slug } = await withScreen(t);
  assert.equal(await refuses(() => m.saveCrops(ws, 'p1', { slug, commit: 'zzz', regions: [{ mid: 'm5', data: png(1) }] })), true);
});

// ---- the channels --------------------------------------------------------------------------------

const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
const anyCtx = new Proxy({}, { get: (tg, k) => (k in tg ? tg[k] : k === 'ws' ? null : stub) });

test('#836 the mockups channels include freeze, crops, review and recreate', () => {
  const names = loadChannels()(anyCtx).map((c) => c.channel);
  assert.deepEqual(['mockups:crops', 'mockups:freeze', 'mockups:recreate', 'mockups:review'].filter((c) => !names.includes(c)), []);
});

test('#836 the new channels\' api methods are freezeMockupVersion, saveMockupCrops, reviewMockupScreen and recreateMockupFromApp', () => {
  const byChannel = Object.fromEntries(loadChannels()(anyCtx).map((c) => [c.channel, c.method]));
  assert.deepEqual(['mockups:freeze', 'mockups:crops', 'mockups:review', 'mockups:recreate'].map((c) => byChannel[c] ?? null),
    ['freezeMockupVersion', 'saveMockupCrops', 'reviewMockupScreen', 'recreateMockupFromApp']);
});

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
    startWorkflowRun: async (opts) => { started.push(opts); return { runId: 'r-836' }; },
  };
  const entries = loadChannels()(ctx);
  const call = async (channel, arg) => {
    const e = entries.find((x) => x.channel === channel);
    assert.ok(e, `no channel ${channel}`);
    return e.fn(arg);
  };
  return { call, started };
}

test('#836 mockups:freeze answers the frozen version (ref and folder)', async (t) => {
  const { ws, slug, commit } = await withScreen(t);
  const { call } = channelsFor(ws);
  const f = await call('mockups:freeze', { projectId: 'p1', slug, commit });
  assert.deepEqual([f.ref, fs.readFileSync(path.join(f.dir, 'index.html'), 'utf8')], [`orders-dashboard@${git(ws, 'rev-parse', commit)}`, V1]);
});

test('#836 simulated, mockups:crops crops a region given only its box (no host): one crop per mid, its file saved', async (t) => {
  const { ws, slug, commit } = await withScreen(t);
  const { call } = channelsFor(ws);
  const crops = await call('mockups:crops', { projectId: 'p1', slug, commit, regions: [{ mid: 'm2', box: [0, 0, 200, 40] }, { mid: 'm5', box: [0, 50, 80, 30] }] });
  assert.deepEqual(crops.map((c) => [c.mid, fs.existsSync(path.join(dirOf(ws), ...String(c.file).split('/')))]), [['m2', true], ['m5', true]]);
});

// review on demand --------------------------------------------------------------------------------

test('#836 simulated, mockups:review reports a raw colour off the kit as a kit finding', async (t) => {
  const { ws, slug } = await withScreen(t, BUY, 'Shop');
  const { call } = channelsFor(ws);
  const { findings } = await call('mockups:review', { projectId: 'p1', slug, axe: [] });
  assert.equal(findings.some((f) => f.kind === 'kit' && JSON.stringify(f).includes('#ff3366')), true, JSON.stringify(findings));
});

test('#836 simulated, mockups:review reports each axe violation it is given as an axe finding', async (t) => {
  const { ws, slug } = await withScreen(t);
  const { call } = channelsFor(ws);
  const axe = [{ id: 'color-contrast', impact: 'serious', nodes: 2, help: 'Elements must meet minimum color contrast ratio thresholds' }];
  const { findings } = await call('mockups:review', { projectId: 'p1', slug, axe });
  assert.deepEqual(findings.filter((f) => f.kind === 'axe').map((f) => f.rule), ['color-contrast']);
});

test('#836 simulated, mockups:review costs $0 and starts no workflow run', async (t) => {
  const { ws, slug } = await withScreen(t);
  const { call, started } = channelsFor(ws);
  const r = await call('mockups:review', { projectId: 'p1', slug, axe: [] });
  assert.deepEqual([r.costUsd, started.length], [0, 0]);
});

test('#836 mockups:review refuses an unknown screen', async (t) => {
  const { ws } = await withScreen(t);
  const { call } = channelsFor(ws);
  assert.equal(await refuses(() => call('mockups:review', { projectId: 'p1', slug: 'nowhere', axe: [] })), true);
});

// the review is on demand (its own channel), a designer turn never reviews
test('#836 a designer turn (mockups:chat) answers no review findings: the review is its own channel', async (t) => {
  const { ws, slug } = await withScreen(t, BUY, 'Shop');
  const { call } = channelsFor(ws);
  const r = await call('mockups:chat', { projectId: 'p1', slug, message: 'Make the title bigger.', selection: [] });
  const hasReview = loadChannels()(anyCtx).some((c) => c.channel === 'mockups:review');
  assert.deepEqual([hasReview, ['findings', 'review'].filter((k) => r && Object.hasOwn(r, k))], [true, []]);
});

// recreate from the running app -------------------------------------------------------------------

const PREVIEW = { command: 'npm run dev', url: 'http://localhost:5173' };

test('#836 MockupModel has the recreate-screen action and its estimate (shown before a recreate)', () => {
  const { ACTIONS, estimateCost } = loadModel();
  const e = estimateCost('recreate-screen');
  assert.deepEqual([ACTIONS.includes('recreate-screen'), typeof e.model === 'string' && e.model.length > 0, e.max > 0 && e.min <= e.max], [true, true, true]);
});

test('#836 mockups:estimate answers the recreate-screen estimate', async (t) => {
  const ws = workspace(t);
  const { call } = channelsFor(ws);
  const e = await call('mockups:estimate', { action: 'recreate-screen' });
  assert.equal(e.max > 0, true);
});

test('#836 mockups:recreate is refused when no Run App / Local preview is set', async (t) => {
  const ws = workspace(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-repo-836-'));
  t.after(() => rm(folder));
  const { call } = channelsFor(ws, { project: { folder } });
  assert.equal(await refuses(() => call('mockups:recreate', { projectId: 'p1', title: 'Orders from the app' })), true);
});

test('#836 a refused recreate creates no screen', async (t) => {
  const ws = workspace(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-repo-836-'));
  t.after(() => rm(folder));
  const { call } = channelsFor(ws, { project: { folder } });
  await refuses(() => call('mockups:recreate', { projectId: 'p1', title: 'Orders from the app' }));
  assert.deepEqual(fs.existsSync(dirOf(ws)) ? load().listScreens(ws, 'p1') : [], []);
});

test('#836 simulated, mockups:recreate with the project\'s Local preview creates a screen whose source is the running app', async (t) => {
  const ws = workspace(t);
  const { call } = channelsFor(ws, { project: { folder: '', localPreview: PREVIEW } });
  const { slug } = await call('mockups:recreate', { projectId: 'p1', title: 'Orders from the app' });
  const screen = load().listScreens(ws, 'p1').find((s) => s.slug === slug);
  assert.deepEqual([screen?.source?.kind, screen?.source?.url], ['running-app', 'http://localhost:5173']);
});

test('#836 the recreated screen links the project\'s kit', async (t) => {
  const ws = workspace(t);
  const { call } = channelsFor(ws, { project: { folder: '', localPreview: PREVIEW } });
  const { slug } = await call('mockups:recreate', { projectId: 'p1', title: 'Orders from the app' });
  const html = load().screenHtml(ws, 'p1', slug);
  assert.deepEqual([html.includes('kit/tokens.css'), html.includes('kit/components.css')], [true, true]);
});

test('#836 simulated, mockups:recreate starts no workflow run', async (t) => {
  const ws = workspace(t);
  const { call, started } = channelsFor(ws, { project: { folder: '', localPreview: PREVIEW } });
  const r = await call('mockups:recreate', { projectId: 'p1', title: 'Orders from the app' });
  assert.deepEqual([started.length, r.runId ?? null], [0, null]);
});

test('#836 the repository\'s .multiagent/local-preview.yaml counts as the Run App setting for a recreate', async (t) => {
  const ws = workspace(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-repo-836-'));
  t.after(() => rm(folder));
  fs.mkdirSync(path.join(folder, '.multiagent'));
  fs.writeFileSync(path.join(folder, '.multiagent', 'local-preview.yaml'), 'command: npm run dev\nurl: http://localhost:3000\n');
  const { call } = channelsFor(ws, { project: { folder } });
  const { slug } = await call('mockups:recreate', { projectId: 'p1', title: 'Settings from the app' });
  assert.equal(load().listScreens(ws, 'p1').find((s) => s.slug === slug)?.source?.url, 'http://localhost:3000');
});

// ---- the #258 commit carries the crops ---------------------------------------------------------------

const CROP = { mid: 'm42', file: 'refs/0a1b2c.png', name: 'orders-dashboard@c41e2a9-m42.png' };

test('#836 checkSplit keeps each issue\'s crops (data-mid and file)', () => {
  const { checkSplit } = loadCommit();
  const [issue] = checkSplit({ issues: [{ title: 'Pay button', tasks: ['Add the Pay button'], complexity: 1, crops: [CROP] }] });
  assert.deepEqual((issue.crops || []).map((c) => [c.mid, c.file]), [['m42', 'refs/0a1b2c.png']]);
});

test('#836 an issue\'s body shows each crop with its data-mid', () => {
  const { issueBody } = loadCommit();
  const card = { id: '20261114-a001', title: 'Orders dashboard', document: '', clarity: { score: 90 } };
  const body = issueBody({ card, issue: { title: 'Pay button', tasks: ['Add the Pay button'], complexity: 1, crops: [CROP] }, index: 0, total: 1 });
  assert.deepEqual([body.includes('m42'), body.includes('orders-dashboard@c41e2a9-m42.png')], [true, true]);
});

// ---- i18n and docs ---------------------------------------------------------------------------------

const KEYS = {
  'mockups.review_screen': 'Review this screen',
  'mockups.start_run': 'Start a development run',
  'mockups.recreate_from_app': 'Recreate from the running app',
  'mockups.prepare_issues': 'Prepare issues',
};
const MORE_KEYS = ['mockups.recreate_needs_preview', 'discovery_commit.crops'];
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));

test('#836 the English catalog has the new mockup labels', () => {
  const en = catalog('en');
  assert.deepEqual(Object.keys(KEYS).map((k) => en[k] ?? null), Object.values(KEYS));
});

test('#836 both catalogs have every new key, not empty', () => {
  const missing = [];
  for (const lang of ['en', 'pt-BR']) {
    const c = catalog(lang);
    for (const k of [...Object.keys(KEYS), ...MORE_KEYS]) if (typeof c[k] !== 'string' || !c[k].trim()) missing.push(`${lang}:${k}`);
  }
  assert.deepEqual(missing, []);
});

test('#836 docs/agents/storage/mockups.md documents the freeze, the crops, the review and the recreate channels', () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'agents', 'storage', 'mockups.md'), 'utf8');
  assert.deepEqual(['mockups:freeze', 'mockups:crops', 'mockups:review', 'mockups:recreate'].filter((c) => !md.includes(c)), []);
});
