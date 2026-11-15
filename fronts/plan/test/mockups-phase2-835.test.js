// #835 Project mockups, phase 2: the new exports of fronts/plan/engine/domains/mockups.js (fs + local git,
// the workspace folder first), the new mockups:* channels and the kit workflow/skill. Written before the code:
// the modules are loaded inside each test. The contract:
// - applyKitMap(ws, id, { components_css, components: [{ name, source: 'file:line', html? }], inferences })
//   → { commit }: kit/components.css, kit/components.html (each component), kit/kit.json (components with
//   their source, inferences), ONE commit;
// - promoteToKit(ws, id, { slug, mid, name }) → { commit }: the element becomes a kit component (in kit.json
//   and components.css), its colours become tokens (the lint stops flagging them), ONE commit; an unknown
//   mid or an empty name throws;
// - compareVersions(ws, id, { slug, from, to }) → { before, after, changed } (MockupModel.diffMids);
// - variants are branches of the mockup repository: listVariants → { current, variants: [{ name }] },
//   createVariant / switchVariant / keepVariant ({ name }); turns go to the current variant only;
// - saveFlow(ws, id, { name, links }) → { commit, file: 'flows/<name>.json' }; listFlows → [{ name }];
//   readFlow(ws, id, name) → the flow; a link to an unknown screen throws;
// - exportZip(ws, id) → a Buffer of a .zip: index.html, screens/<slug>/index.html, kit/, flows/, no .git/,
//   no chat/, opens offline;
// - attachment(ws, id, { slug, commit }) → { projectId, slug, commit, thumbnail } (a Discovery card's frozen
//   version); screenAt(ws, id, { slug, commit }) → the html of that commit.
// Each test gets a temp workspace and an isolated git config (same helper as mockups-domain-625).
// Every call is awaited (the service may be sync or async).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = () => require('../engine/domains/mockups');
const loadChannels = () => require('../engine/channels/mockups');

const GIT_VARS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];

function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
}

// a temp workspace with an isolated git config (identity, main, no autocrlf); process.env restored after
function workspace(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-ws-835-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-cfg-835-'));
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
const exists = (ws, rel) => fs.existsSync(path.join(dirOf(ws), ...rel.split('/')));

// refused: the call throws, and not because the function is missing (then the test must stay red)
async function refuses(fn) {
  try { await fn(); return false; } catch (e) { if (e instanceof TypeError && /is not a function/.test(e.message)) throw e; return true; }
}

// markup where every element already has its data-mid: addMids leaves it byte for byte
const doc = (body) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>S</title>`
  + '<link rel="stylesheet" href="../../kit/tokens.css"><link rel="stylesheet" href="../../kit/components.css">'
  + `</head><body>${body}</body></html>\n`;
const V1 = doc('<h1 data-mid="m1">A</h1><p data-mid="m2">x</p><p data-mid="m3">y</p>');
const V2 = doc('<h1 data-mid="m1">B</h1><p data-mid="m2">x</p><button data-mid="m4">go</button>');
const BOLD = doc('<h1 data-mid="m1" style="font-weight:900">BOLD</h1>');
const BUY = doc('<main data-mid="m1"><button style="background:#ff3366;color:#ffffff" data-mid="m5">Buy</button></main>');

const TOKENS = ':root { --primary: #1a73e8; }\n';
const KIT_MAP = {
  components_css: '.btn-primary { background: var(--primary); }\n.card-x { padding: 8px; }\n',
  components: [
    { name: 'Button/primary', source: 'src/ui/button.css:12', html: '<button class="btn-primary">Save</button>' },
    { name: 'Card', source: 'src/ui/card.css:3' },
  ],
  inferences: ['The primary button is the one used on every form'],
};

async function withScreen(t, html = V1, title = 'Home') {
  const ws = workspace(t);
  const m = load();
  const { slug, commit } = await m.createScreen(ws, 'p1', { title, html, source: { kind: 'prompt' } });
  return { ws, m, slug, commit };
}

// ---- kit map -----------------------------------------------------------------------------------

test('#835 applyKitMap makes exactly one commit and returns it', async (t) => {
  const ws = workspace(t);
  const m = load();
  await m.writeKit(ws, 'p1', { tokensCss: TOKENS });
  const before = commitCount(ws);
  const { commit } = await m.applyKitMap(ws, 'p1', KIT_MAP);
  assert.deepEqual([commitCount(ws), commit], [before + 1, git(ws, 'rev-parse', 'HEAD')]);
});

test('#835 applyKitMap writes kit/components.css with the components css', async (t) => {
  const ws = workspace(t);
  const m = load();
  await m.writeKit(ws, 'p1', { tokensCss: TOKENS });
  await m.applyKitMap(ws, 'p1', KIT_MAP);
  assert.equal(read(ws, 'kit/components.css').includes('.btn-primary { background: var(--primary); }'), true);
});

test('#835 applyKitMap writes kit/components.html naming every component', async (t) => {
  const ws = workspace(t);
  const m = load();
  await m.writeKit(ws, 'p1', { tokensCss: TOKENS });
  await m.applyKitMap(ws, 'p1', KIT_MAP);
  const html = read(ws, 'kit/components.html');
  assert.deepEqual([html.includes('Button/primary'), html.includes('Card')], [true, true]);
});

test('#835 applyKitMap writes kit/kit.json with each component\'s name and file:line source and the inferences', async (t) => {
  const ws = workspace(t);
  const m = load();
  await m.writeKit(ws, 'p1', { tokensCss: TOKENS });
  await m.applyKitMap(ws, 'p1', KIT_MAP);
  const kit = JSON.parse(read(ws, 'kit/kit.json'));
  assert.deepEqual(kit.components.map((c) => [c.name, c.source]), [['Button/primary', 'src/ui/button.css:12'], ['Card', 'src/ui/card.css:3']]);
  assert.deepEqual(kit.inferences, ['The primary button is the one used on every form']);
});

test('#835 after applyKitMap readKit gives the two components', async (t) => {
  const ws = workspace(t);
  const m = load();
  await m.writeKit(ws, 'p1', { tokensCss: TOKENS });
  await m.applyKitMap(ws, 'p1', KIT_MAP);
  assert.equal((await m.readKit(ws, 'p1')).kit.components.length, 2);
});

// ---- promote to kit ----------------------------------------------------------------------------

async function withBuy(t) {
  const s = await withScreen(t, BUY, 'Shop');
  await s.m.writeKit(s.ws, 'p1', { tokensCss: TOKENS, componentsCss: '', kit: { components: [] } });
  return s;
}

test('#835 promoteToKit makes exactly one commit and returns it', async (t) => {
  const { ws, m, slug } = await withBuy(t);
  const before = commitCount(ws);
  const { commit } = await m.promoteToKit(ws, 'p1', { slug, mid: 'm5', name: 'buy-button' });
  assert.deepEqual([commitCount(ws), commit], [before + 1, git(ws, 'rev-parse', 'HEAD')]);
});

test('#835 promoteToKit adds a kit component with the given name', async (t) => {
  const { ws, m, slug } = await withBuy(t);
  await m.promoteToKit(ws, 'p1', { slug, mid: 'm5', name: 'buy-button' });
  assert.deepEqual((await m.readKit(ws, 'p1')).kit.components.map((c) => c.name).filter((n) => n === 'buy-button'), ['buy-button']);
});

test('#835 promoteToKit adds the component to components.css', async (t) => {
  const { ws, m, slug } = await withBuy(t);
  await m.promoteToKit(ws, 'p1', { slug, mid: 'm5', name: 'buy-button' });
  assert.equal((await m.readKit(ws, 'p1')).componentsCss.includes('buy-button'), true);
});

test('#835 after promoteToKit the lint of a turn no longer flags the promoted colour', async (t) => {
  const { ws, m, slug } = await withBuy(t);
  const before = await m.saveTurn(ws, 'p1', { slug, html: BUY.replace('>Buy<', '>Buy now<'), message: 'wording' });
  assert.equal(before.problems.some((p) => p.rule === 'raw-color' && p.value === '#ff3366'), true);
  await m.promoteToKit(ws, 'p1', { slug, mid: 'm5', name: 'buy-button' });
  const { problems } = await m.saveTurn(ws, 'p1', { slug, html: BUY, message: 'x' });
  assert.deepEqual(problems.filter((p) => p.rule === 'raw-color' && p.value === '#ff3366'), []);
});

test('#835 promoteToKit refuses an unknown mid', async (t) => {
  const { ws, m, slug } = await withBuy(t);
  assert.equal(await refuses(() => m.promoteToKit(ws, 'p1', { slug, mid: 'm99', name: 'buy-button' })), true);
});

test('#835 promoteToKit refuses an empty name', async (t) => {
  const { ws, m, slug } = await withBuy(t);
  assert.equal(await refuses(() => m.promoteToKit(ws, 'p1', { slug, mid: 'm5', name: '' })), true);
});

// ---- compare -----------------------------------------------------------------------------------

async function withTwoTurns(t) {
  const s = await withScreen(t, doc('<p data-mid="m1">first</p>'));
  const { commit: older } = await s.m.saveTurn(s.ws, 'p1', { slug: s.slug, html: V1, message: 'one' });
  const { commit: newer } = await s.m.saveTurn(s.ws, 'p1', { slug: s.slug, html: V2, message: 'two' });
  return { ...s, older, newer };
}

test('#835 compareVersions gives the html of both commits', async (t) => {
  const { ws, m, slug, older, newer } = await withTwoTurns(t);
  const r = await m.compareVersions(ws, 'p1', { slug, from: older, to: newer });
  assert.deepEqual([r.before, r.after], [V1, V2]);
});

test('#835 compareVersions lists the changed data-mids, sorted', async (t) => {
  const { ws, m, slug, older, newer } = await withTwoTurns(t);
  assert.deepEqual((await m.compareVersions(ws, 'p1', { slug, from: older, to: newer })).changed, ['m1', 'm3', 'm4']);
});

test('#835 compareVersions refuses a bad commit', async (t) => {
  const { ws, m, slug, newer } = await withTwoTurns(t);
  assert.equal(await refuses(() => m.compareVersions(ws, 'p1', { slug, from: 'not a commit', to: newer })), true);
});

// ---- variants ----------------------------------------------------------------------------------

test('#835 listVariants starts with the single variant main, current', async (t) => {
  const { ws, m } = await withScreen(t);
  const r = await m.listVariants(ws, 'p1');
  assert.deepEqual([r.current, r.variants.map((v) => v.name)], ['main', ['main']]);
});

test('#835 createVariant makes the new variant current', async (t) => {
  const { ws, m } = await withScreen(t);
  await m.createVariant(ws, 'p1', { name: 'bold' });
  const r = await m.listVariants(ws, 'p1');
  assert.deepEqual([r.current, r.variants.map((v) => v.name).sort()], ['bold', ['bold', 'main']]);
});

test('#835 a turn on a variant leaves main as it was', async (t) => {
  const { ws, m, slug } = await withScreen(t);
  await m.createVariant(ws, 'p1', { name: 'bold' });
  await m.saveTurn(ws, 'p1', { slug, html: BOLD, message: 'bolder' });
  await m.switchVariant(ws, 'p1', { name: 'main' });
  assert.equal(await m.screenHtml(ws, 'p1', slug), V1);
});

test('#835 switching back to a variant shows its html', async (t) => {
  const { ws, m, slug } = await withScreen(t);
  await m.createVariant(ws, 'p1', { name: 'bold' });
  await m.saveTurn(ws, 'p1', { slug, html: BOLD, message: 'bolder' });
  await m.switchVariant(ws, 'p1', { name: 'main' });
  await m.switchVariant(ws, 'p1', { name: 'bold' });
  assert.equal(await m.screenHtml(ws, 'p1', slug), BOLD);
});

test('#835 keepVariant leaves one variant holding the kept html', async (t) => {
  const { ws, m, slug } = await withScreen(t);
  await m.createVariant(ws, 'p1', { name: 'bold' });
  await m.saveTurn(ws, 'p1', { slug, html: BOLD, message: 'bolder' });
  await m.switchVariant(ws, 'p1', { name: 'main' });
  await m.keepVariant(ws, 'p1', { name: 'bold' });
  assert.deepEqual([(await m.listVariants(ws, 'p1')).variants.length, await m.screenHtml(ws, 'p1', slug)], [1, BOLD]);
});

test('#835 createVariant refuses a name that already exists', async (t) => {
  const { ws, m } = await withScreen(t);
  await m.createVariant(ws, 'p1', { name: 'bold' });
  assert.equal(await refuses(() => m.createVariant(ws, 'p1', { name: 'bold' })), true);
});

test('#835 createVariant refuses a name with ".." or spaces', async (t) => {
  const { ws, m } = await withScreen(t);
  const refused = [];
  for (const name of ['a..b', '../x', 'very bold']) refused.push(await refuses(() => m.createVariant(ws, 'p1', { name })));
  assert.deepEqual(refused, [true, true, true]);
});

// ---- flows -------------------------------------------------------------------------------------

async function withTwoScreens(t) {
  const ws = workspace(t);
  const m = load();
  const a = (await m.createScreen(ws, 'p1', { title: 'Cart', html: V1, source: { kind: 'prompt' } })).slug;
  const b = (await m.createScreen(ws, 'p1', { title: 'Pay', html: V2, source: { kind: 'prompt' } })).slug;
  const flow = { name: 'checkout', links: [{ from: { screen: a, mid: 'm1' }, to: b }] };
  return { ws, m, a, b, flow };
}

test('#835 saveFlow writes flows/<name>.json in one commit and returns it', async (t) => {
  const { ws, m, flow } = await withTwoScreens(t);
  const before = commitCount(ws);
  const r = await m.saveFlow(ws, 'p1', flow);
  assert.deepEqual([r.file, r.commit, commitCount(ws)], ['flows/checkout.json', git(ws, 'rev-parse', 'HEAD'), before + 1]);
});

test('#835 the saved flow file parses to the flow', async (t) => {
  const { ws, m, flow } = await withTwoScreens(t);
  await m.saveFlow(ws, 'p1', flow);
  const back = JSON.parse(read(ws, 'flows/checkout.json'));
  assert.deepEqual([back.name, back.links], ['checkout', [{ from: { screen: 'cart', mid: 'm1' }, to: 'pay' }]]);
});

test('#835 listFlows lists the saved flow by name', async (t) => {
  const { ws, m, flow } = await withTwoScreens(t);
  await m.saveFlow(ws, 'p1', flow);
  assert.deepEqual((await m.listFlows(ws, 'p1')).map((f) => f.name), ['checkout']);
});

test('#835 readFlow gives back the links', async (t) => {
  const { ws, m, flow } = await withTwoScreens(t);
  await m.saveFlow(ws, 'p1', flow);
  assert.deepEqual((await m.readFlow(ws, 'p1', 'checkout')).links, [{ from: { screen: 'cart', mid: 'm1' }, to: 'pay' }]);
});

test('#835 saveFlow refuses a link to an unknown screen', async (t) => {
  const { ws, m, a } = await withTwoScreens(t);
  assert.equal(await refuses(() => m.saveFlow(ws, 'p1', { name: 'checkout', links: [{ from: { screen: a, mid: 'm1' }, to: 'nowhere' }] })), true);
});

// ---- export ------------------------------------------------------------------------------------

// a minimal zip reader: End of Central Directory → central directory → local headers; stored or deflate
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('No End of Central Directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    entries.set(name, method === 8 ? zlib.inflateRawSync(raw).toString('utf8') : raw.toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function exported(t) {
  const { ws, m, a, b, flow } = await withTwoScreens(t);
  await m.writeKit(ws, 'p1', { tokensCss: TOKENS, componentsCss: '.btn { color: var(--primary); }\n', kit: {} });
  await m.saveFlow(ws, 'p1', flow);
  await m.appendChat(ws, 'p1', a, { role: 'user', text: 'secret chat' });
  const buf = await m.exportZip(ws, 'p1');
  return { buf, a, b };
}

test('#835 exportZip returns a Buffer', async (t) => {
  const { buf } = await exported(t);
  assert.equal(Buffer.isBuffer(buf), true);
});

test('#835 the export holds index.html, every screen, the kit and the flows', async (t) => {
  const { buf } = await exported(t);
  const names = [...unzip(buf).keys()];
  const expected = ['index.html', 'screens/cart/index.html', 'screens/pay/index.html', 'kit/tokens.css', 'kit/components.css', 'flows/checkout.json'];
  assert.deepEqual(expected.filter((e) => !names.includes(e)), []);
});

test('#835 the export holds no .git/ and no chat/', async (t) => {
  const { buf } = await exported(t);
  assert.deepEqual([...unzip(buf).keys()].filter((n) => n.includes('.git/') || n.startsWith('chat/') || n.includes('/chat/')), []);
});

test('#835 no html of the export loads anything from the network (no http or protocol-relative src/href)', async (t) => {
  const { buf } = await exported(t);
  const online = [...unzip(buf)].filter(([n, text]) => n.endsWith('.html') && /\b(src|href)\s*=\s*["']?\s*(https?:|\/\/)/i.test(text)).map(([n]) => n);
  assert.deepEqual(online, []);
});

test('#835 the export\'s index.html links to every screen with a relative href', async (t) => {
  const { buf } = await exported(t);
  const index = unzip(buf).get('index.html') || '';
  const linked = (slug) => new RegExp(`href\\s*=\\s*["'](\\./)?screens/${slug}/(index\\.html)?["']`).test(index);
  assert.deepEqual([linked('cart'), linked('pay')], [true, true]);
});

// ---- attach to a Discovery card (a frozen version) -----------------------------------------------

test('#835 attachment gives the project, the screen, the commit and a thumbnail', async (t) => {
  const { ws, m, slug, commit } = await withScreen(t);
  const a = await m.attachment(ws, 'p1', { slug, commit });
  assert.deepEqual([a.projectId, a.slug, String(a.commit).startsWith(commit) || commit.startsWith(String(a.commit)), typeof a.thumbnail, String(a.thumbnail).length > 0],
    ['p1', 'home', true, 'string', true]);
});

test('#835 attachment refuses a bad commit', async (t) => {
  const { ws, m, slug } = await withScreen(t);
  assert.equal(await refuses(() => m.attachment(ws, 'p1', { slug, commit: 'not a commit' })), true);
});

test('#835 screenAt gives the attached commit\'s html after a later turn', async (t) => {
  const { ws, m, slug, commit } = await withScreen(t);
  await m.attachment(ws, 'p1', { slug, commit });
  await m.saveTurn(ws, 'p1', { slug, html: V2, message: 'later' });
  assert.equal(await m.screenAt(ws, 'p1', { slug, commit }), V1);
});

test('#835 screenAt refuses a bad commit', async (t) => {
  const { ws, m, slug } = await withScreen(t);
  assert.equal(await refuses(() => m.screenAt(ws, 'p1', { slug, commit: 'zzz' })), true);
});

// ---- channels ----------------------------------------------------------------------------------

const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
const ctx = new Proxy({}, { get: (tg, k) => (k in tg ? tg[k] : k === 'ws' ? null : stub) });

test('#835 the mockups channels include kit-map, promote, compare, variants, flows, export and attach', () => {
  const names = loadChannels()(ctx).map((c) => c.channel);
  const expected = ['mockups:attach', 'mockups:compare', 'mockups:create-variant', 'mockups:export', 'mockups:flows', 'mockups:keep-variant',
    'mockups:kit-map', 'mockups:promote', 'mockups:save-flow', 'mockups:switch-variant', 'mockups:variants'];
  assert.deepEqual(expected.filter((c) => !names.includes(c)), []);
});

// ---- the kit workflow and skill ------------------------------------------------------------------

test('#835 the ui-kit-extraction skill asks for components.html, kit.json and file:line sources', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'ui-kit-extraction', 'SKILL.md'), 'utf8');
  assert.deepEqual([skill.includes('components.html'), skill.includes('kit.json'), skill.includes('file:line')], [true, true, true]);
});

test('#835 the ui-kit-map components step lets each component carry its html', () => {
  const yaml = require('js-yaml');
  const wf = yaml.load(fs.readFileSync(path.join(ROOT, 'workflows', 'ui-kit-map.yaml'), 'utf8'));
  const step = wf.steps.find((s) => s.id === 'components');
  assert.equal(step.output_schema.properties.components.items.properties.html?.type, 'string');
});
