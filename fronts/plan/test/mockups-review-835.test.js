// #835 Mockups phase 2, review follow-ups on the mockups service (fronts/plan/engine/domains/mockups.js and
// fronts/plan/engine/channels/mockups.js):
// - promoteToKit with two colours in one declaration (both become kit tokens, the lint flags neither) and a
//   token name the kit already has (the existing token kept, the new one suffixed -2);
// - keepVariant('main') with another variant present (main stays, the others go) and switchVariant to an
//   unknown name refused;
// - a ui-kit-map run's components step (run:event step.finished, components with html) reaching the kit
//   through the channels' listener (kit/kit.json, kit/components.html); another workflow's run ignored.
// Each test gets a temp workspace and an isolated git config (like mockups-phase2-835), env restored after.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const load = () => require('../engine/domains/mockups');
const loadChannels = () => require('../engine/channels/mockups');

const GIT_VARS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];

function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
}

function workspace(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-rv-835-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockups-rvcfg-835-'));
  const cfg = path.join(cfgDir, 'config');
  fs.writeFileSync(cfg, '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = master\n[core]\n\tautocrlf = false\n');
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

const read = (ws, rel) => fs.readFileSync(path.join(ws, 'mockups', 'p1', ...rel.split('/')), 'utf8');
// the custom properties of a stylesheet: name → value
const tokensOf = (css) => Object.fromEntries([...String(css).matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));

async function refuses(fn) {
  try { await fn(); return false; } catch (e) { if (e instanceof TypeError && /is not a function/.test(e.message)) throw e; return true; }
}

const doc = (body) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>S</title>`
  + '<link rel="stylesheet" href="../../kit/tokens.css"><link rel="stylesheet" href="../../kit/components.css">'
  + `</head><body>${body}</body></html>\n`;
const V1 = doc('<h1 data-mid="m1">A</h1>');
const BOLD = doc('<h1 data-mid="m1" style="font-weight:900">BOLD</h1>');
const GRADIENT = doc('<main data-mid="m1"><a style="background:linear-gradient(#aaaaaa, #bbbbbb)" data-mid="m2">Go</a></main>');
const BUY = doc('<main data-mid="m1"><button style="background:#ff3366" data-mid="m5">Buy</button></main>');

async function withScreen(t, html, tokensCss = ':root { --primary: #1a73e8; }\n') {
  const ws = workspace(t);
  const m = load();
  const { slug } = await m.createScreen(ws, 'p1', { title: 'Home', html });
  await m.writeKit(ws, 'p1', { tokensCss, componentsCss: '', kit: { components: [] } });
  return { ws, m, slug };
}

// ---- promote to kit ----------------------------------------------------------------------------

test('#835 promoteToKit turns both colours of one declaration into kit tokens', async (t) => {
  const { ws, m, slug } = await withScreen(t, GRADIENT);
  await m.promoteToKit(ws, 'p1', { slug, mid: 'm2', name: 'go-link' });
  const values = Object.values(tokensOf((await m.readKit(ws, 'p1')).tokensCss));
  assert.deepEqual([values.includes('#aaaaaa'), values.includes('#bbbbbb')], [true, true]);
});

test('#835 after promoting a two-colour declaration the lint flags neither colour', async (t) => {
  const { ws, m, slug } = await withScreen(t, GRADIENT);
  await m.promoteToKit(ws, 'p1', { slug, mid: 'm2', name: 'go-link' });
  const { problems } = await m.saveTurn(ws, 'p1', { slug, html: GRADIENT.replace('>Go<', '>Go on<'), message: 'wording' });
  assert.deepEqual(problems.filter((p) => p.rule === 'raw-color').map((p) => p.value), []);
});

test('#835 promoteToKit keeps a token the kit already has and suffixes the new one -2', async (t) => {
  const { ws, m, slug } = await withScreen(t, BUY, ':root { --buy-button-background: #000000; }\n');
  await m.promoteToKit(ws, 'p1', { slug, mid: 'm5', name: 'buy-button' });
  const tokens = tokensOf((await m.readKit(ws, 'p1')).tokensCss);
  assert.deepEqual([tokens['--buy-button-background'], tokens['--buy-button-background-2']], ['#000000', '#ff3366']);
});

// ---- variants ----------------------------------------------------------------------------------

test('#835 the mockup repository starts on main whatever the user\'s default branch', async (t) => {
  const { ws, m } = await withScreen(t, V1);
  assert.equal((await m.listVariants(ws, 'p1')).current, 'main');
});

test('#835 keepVariant main with another variant present keeps main\'s html and drops the others', async (t) => {
  const { ws, m, slug } = await withScreen(t, V1);
  await m.createVariant(ws, 'p1', { name: 'bold' });
  await m.saveTurn(ws, 'p1', { slug, html: BOLD, message: 'bolder' });
  await m.keepVariant(ws, 'p1', { name: 'main' });
  const r = await m.listVariants(ws, 'p1');
  assert.deepEqual([r.current, r.variants.map((v) => v.name), await m.screenHtml(ws, 'p1', slug)], ['main', ['main'], V1]);
});

test('#835 switchVariant refuses a variant that does not exist', async (t) => {
  const { ws, m } = await withScreen(t, V1);
  assert.equal(await refuses(() => m.switchVariant(ws, 'p1', { name: 'nope' })), true);
  assert.equal((await m.listVariants(ws, 'p1')).current, 'main');
});

// ---- a ui-kit-map run reaching the kit (the channels' run:event listener) ------------------------

// the components step's output, as the ui-kit-map workflow's schema gives it (a mock-provider answer)
const KIT_OUTPUT = {
  components_css: '.btn-primary { background: var(--primary); }\n',
  components: [
    { name: 'Button/primary', source: 'src/ui/button.css:12', html: '<button class="btn-primary">Save</button>' },
    { name: 'Page/two-columns', source: 'src/layout/page.css:4', html: '<div class="two-col"><aside></aside><main></main></div>' },
  ],
  inferences: ['The primary button is the one used on every form'],
};

function kitChannels(ws, workflow) {
  const events = new EventEmitter();
  const runs = { r1: { wf: { metadata: { name: workflow } }, inputs: { project_id: 'p1' } } };
  loadChannels()({ events, ws: { root: ws }, liveRun: (id) => runs[id] || null });
  return events;
}

const settle = () => new Promise((r) => setImmediate(r));

test('#835 a ui-kit-map run\'s components step writes the components and their sources into the kit', async (t) => {
  const { ws } = await withScreen(t, V1);
  const events = kitChannels(ws, 'ui-kit-map');
  events.emit('run:event', { run_id: 'r1', type: 'step.finished', step: 'components', output: KIT_OUTPUT });
  await settle();
  const kit = JSON.parse(read(ws, 'kit/kit.json'));
  assert.deepEqual(kit.components.map((c) => [c.name, c.source]), [['Button/primary', 'src/ui/button.css:12'], ['Page/two-columns', 'src/layout/page.css:4']]);
  assert.deepEqual(kit.inferences, ['The primary button is the one used on every form']);
});

test('#835 a ui-kit-map run\'s components step puts each component\'s html in kit/components.html', async (t) => {
  const { ws } = await withScreen(t, V1);
  const events = kitChannels(ws, 'ui-kit-map');
  events.emit('run:event', { run_id: 'r1', type: 'step.finished', step: 'components', output: KIT_OUTPUT });
  await settle();
  const html = read(ws, 'kit/components.html');
  assert.deepEqual([html.includes('<button class="btn-primary">Save</button>'), html.includes('class="two-col"')], [true, true]);
});

test('#835 the same output from another workflow\'s run leaves the kit alone', async (t) => {
  const { ws } = await withScreen(t, V1);
  const events = kitChannels(ws, 'project-map');
  events.emit('run:event', { run_id: 'r1', type: 'step.finished', step: 'components', output: KIT_OUTPUT });
  await settle();
  assert.deepEqual(JSON.parse(read(ws, 'kit/kit.json')).components, []);
});
