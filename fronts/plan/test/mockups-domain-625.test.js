// #625 Project mockups (Phase 0 + Phase 1 MVP): the mockups service of the plan front.
// fronts/plan/engine/domains/mockups.js (fs + local git, the workspace folder first, never the project's repository):
// - projectDir(workspace, projectId) → <workspace>/mockups/<projectId>; throws for '/', '\', '..' or empty;
// - ensureProject → kit/ screens/ flows/ refs/ chat/ and a git repository with a commit, idempotent;
// - createScreen(ws, id, { title, html, source }) → { slug, commit }: screens/<slug>/index.html (data-mid on
//   every element) and meta.json { slug, title, source, createdAt }, ONE commit; same title → <slug>-2;
// - listScreens → [{ slug, title }] sorted by slug ([] without the project); screenHtml → index.html;
// - saveTurn(ws, id, { slug, html, message }) → { commit }: ONE commit whose message has `message`;
//   unknown slug or a slug with '..' or '/' throws;
// - listVersions(ws, id, slug) → [{ commit, message }] newest first; restoreVersion → a NEW commit with that html;
// - saveRef(ws, id, { data, ext }) → 'refs/<hex>.<ext>' from a content hash;
// - appendChat / readChat → chat/<slug>.jsonl, in order, [] when none;
// - writeKit / readKit → kit/tokens.css, kit/components.css, kit/kit.json, one commit; null without a kit.
// fronts/plan/engine/channels/mockups.js: `(ctx) => [{ channel, method, params, schema, fn }]`, every channel
// `mockups:*` (front-channels-590 covers its schemas and duplicates once the file exists).
// The service makes its own commits: each test gets a temp workspace and an isolated git config with an
// identity (GIT_CONFIG_GLOBAL, like @craftorio/engine/test/repo-workflow-fixtures-485), env restored after.
// Every call is awaited (the service may be sync or async).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const load = () => require('../engine/domains/mockups');
const loadChannels = () => require('../engine/channels/mockups');

const GIT_VARS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];

function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
}

// a temp workspace with an isolated git config (identity, main, no autocrlf); process.env restored after
function workspace(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-ws-625-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-cfg-625-'));
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
const read = (ws, rel) => fs.readFileSync(path.join(dirOf(ws), ...rel.split('/')), 'utf8');
const hasMid = (html, tag) => new RegExp(`<${tag}\\b[^>]*data-mid="m\\d+"`).test(html);

const HTML = '<main><h1>Orders</h1><button>Export</button></main>';

// ---- projectDir / ensureProject ----------------------------------------------------------------

test('#625 projectDir is <workspace>/mockups/<projectId>', () => {
  assert.equal(load().projectDir(path.join('w', 's'), 'p1'), path.join('w', 's', 'mockups', 'p1'));
});

test('#625 projectDir refuses a projectId with "/", "\\", ".." or empty', () => {
  const { projectDir } = load();
  const refused = ['a/b', 'a\\b', '..', ''].map((id) => { try { projectDir('ws', id); return false; } catch { return true; } });
  assert.deepEqual(refused, [true, true, true, true]);
});

test('#625 ensureProject creates kit, screens, flows, refs and chat and a git repository with a commit', async (t) => {
  const ws = workspace(t);
  await load().ensureProject(ws, 'p1');
  assert.deepEqual(['kit', 'screens', 'flows', 'refs', 'chat', '.git'].map((d) => fs.existsSync(path.join(dirOf(ws), d))), [true, true, true, true, true, true]);
  assert.equal(commitCount(ws) >= 1, true);
});

test('#625 a second ensureProject adds no commit', async (t) => {
  const ws = workspace(t);
  const m = load();
  await m.ensureProject(ws, 'p1');
  const before = commitCount(ws);
  await m.ensureProject(ws, 'p1');
  assert.equal(commitCount(ws), before);
});

// ---- createScreen / listScreens / screenHtml ---------------------------------------------------

test('#625 createScreen writes index.html with a data-mid on every element and meta.json, in one commit', async (t) => {
  const ws = workspace(t);
  const m = load();
  await m.ensureProject(ws, 'p1');
  const before = commitCount(ws);
  const { slug, commit } = await m.createScreen(ws, 'p1', { title: 'Orders Dashboard', html: HTML, source: { kind: 'prompt' } });
  assert.equal(slug, 'orders-dashboard');
  assert.deepEqual([commitCount(ws), commit], [before + 1, git(ws, 'rev-parse', 'HEAD')]);
  const html = read(ws, 'screens/orders-dashboard/index.html');
  assert.deepEqual(['main', 'h1', 'button'].map((tag) => hasMid(html, tag)), [true, true, true]);
  const meta = JSON.parse(read(ws, 'screens/orders-dashboard/meta.json'));
  assert.deepEqual([meta.slug, meta.title, meta.source, typeof meta.createdAt], ['orders-dashboard', 'Orders Dashboard', { kind: 'prompt' }, 'string']);
});

test('#625 a second screen with the same title gets the slug <slug>-2', async (t) => {
  const ws = workspace(t);
  const m = load();
  await m.createScreen(ws, 'p1', { title: 'Orders Dashboard', html: HTML, source: { kind: 'prompt' } });
  const second = await m.createScreen(ws, 'p1', { title: 'Orders Dashboard', html: HTML, source: { kind: 'discovery', card: 'c1' } });
  assert.equal(second.slug, 'orders-dashboard-2');
});

test('#625 listScreens gives slug and title sorted by slug, and [] for a project without a folder', async (t) => {
  const ws = workspace(t);
  const m = load();
  assert.deepEqual(await m.listScreens(ws, 'p1'), []);
  await m.createScreen(ws, 'p1', { title: 'Settings', html: HTML, source: { kind: 'prompt' } });
  await m.createScreen(ws, 'p1', { title: 'Home', html: HTML, source: { kind: 'prompt' } });
  assert.deepEqual((await m.listScreens(ws, 'p1')).map((s) => [s.slug, s.title]), [['home', 'Home'], ['settings', 'Settings']]);
});

// ---- saveTurn / versions -----------------------------------------------------------------------

test('#625 saveTurn rewrites index.html with data-mids in one commit whose message has the request', async (t) => {
  const ws = workspace(t);
  const m = load();
  const { slug } = await m.createScreen(ws, 'p1', { title: 'Home', html: HTML, source: { kind: 'prompt' } });
  const before = commitCount(ws);
  const { commit } = await m.saveTurn(ws, 'p1', { slug, html: '<main><h2>Denser</h2></main>', message: 'Make the header denser' });
  assert.deepEqual([commitCount(ws), commit], [before + 1, git(ws, 'rev-parse', 'HEAD')]);
  assert.equal(git(ws, 'log', '-1', '--format=%B').includes('Make the header denser'), true);
  const html = await m.screenHtml(ws, 'p1', slug);
  assert.deepEqual([html.includes('Denser'), hasMid(html, 'h2')], [true, true]);
});

test('#625 saveTurn refuses an unknown slug and a slug with ".." or "/"', async (t) => {
  const ws = workspace(t);
  const m = load();
  await m.createScreen(ws, 'p1', { title: 'Home', html: HTML, source: { kind: 'prompt' } });
  const refused = [];
  for (const slug of ['nope', '../home', 'home/../x']) {
    try { await m.saveTurn(ws, 'p1', { slug, html: '<p>x</p>', message: 'm' }); refused.push(false); } catch { refused.push(true); }
  }
  assert.deepEqual(refused, [true, true, true]);
});

test('#625 listVersions lists the screen\'s commits newest first and restoreVersion brings one back as a new commit', async (t) => {
  const ws = workspace(t);
  const m = load();
  const { slug, commit: first } = await m.createScreen(ws, 'p1', { title: 'Home', html: HTML, source: { kind: 'prompt' } });
  const original = await m.screenHtml(ws, 'p1', slug);
  const { commit: second } = await m.saveTurn(ws, 'p1', { slug, html: '<main><p>Other</p></main>', message: 'Rewrite' });
  assert.deepEqual((await m.listVersions(ws, 'p1', slug)).map((v) => v.commit), [second, first]);
  const before = commitCount(ws);
  const { commit } = await m.restoreVersion(ws, 'p1', { slug, commit: first });
  assert.deepEqual([commitCount(ws), commit === first, await m.screenHtml(ws, 'p1', slug)], [before + 1, false, original]);
});

// ---- refs, chat, kit ---------------------------------------------------------------------------

test('#625 saveRef names the file from a content hash: the same bytes give the same refs/ path', async (t) => {
  const ws = workspace(t);
  const m = load();
  const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const a = await m.saveRef(ws, 'p1', { data, ext: 'png' });
  const b = await m.saveRef(ws, 'p1', { data: Buffer.from(data), ext: 'png' });
  assert.match(a, /^refs\/[0-9a-f]+\.png$/);
  assert.equal(b, a);
  assert.deepEqual(fs.readFileSync(path.join(dirOf(ws), ...a.split('/'))).equals(data), true);
});

test('#625 appendChat writes chat/<slug>.jsonl and readChat reads the entries back in order, [] when none', async (t) => {
  const ws = workspace(t);
  const m = load();
  await m.ensureProject(ws, 'p1');
  assert.deepEqual(await m.readChat(ws, 'p1', 'home'), []);
  await m.appendChat(ws, 'p1', 'home', { role: 'user', text: 'one' });
  await m.appendChat(ws, 'p1', 'home', { role: 'assistant', text: 'two' });
  assert.deepEqual((await m.readChat(ws, 'p1', 'home')).map((e) => e.text), ['one', 'two']);
  assert.equal(read(ws, 'chat/home.jsonl').trim().split('\n').length, 2);
});

test('#625 readKit is null before a kit and gives back what writeKit wrote in one commit', async (t) => {
  const ws = workspace(t);
  const m = load();
  await m.ensureProject(ws, 'p1');
  assert.equal(await m.readKit(ws, 'p1'), null);
  const before = commitCount(ws);
  const kit = { tokensCss: ':root { --primary: #1a73e8; }\n', componentsCss: '.btn { color: var(--primary); }\n', kit: { components: ['button'] } };
  await m.writeKit(ws, 'p1', kit);
  assert.equal(commitCount(ws), before + 1);
  const back = await m.readKit(ws, 'p1');
  assert.deepEqual([back.tokensCss, back.componentsCss, back.kit], [kit.tokensCss, kit.componentsCss, kit.kit]);
});

// ---- channels ----------------------------------------------------------------------------------

const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
const ctx = new Proxy({}, { get: (tg, k) => (k in tg ? tg[k] : k === 'ws' ? null : stub) });

test('#625 every mockups channel is named mockups:*', () => {
  const names = loadChannels()(ctx).map((c) => c.channel || c.send);
  assert.deepEqual(names.filter((n) => !String(n).startsWith('mockups:')), []);
});

test('#625 the mockups channels include list, create-screen, save-turn, versions, estimate and open-editor', () => {
  const names = loadChannels()(ctx).map((c) => c.channel);
  const expected = ['mockups:list', 'mockups:create-screen', 'mockups:save-turn', 'mockups:versions', 'mockups:estimate', 'mockups:open-editor'];
  assert.deepEqual(expected.filter((c) => !names.includes(c)), []);
});
