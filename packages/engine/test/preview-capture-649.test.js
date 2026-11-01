// #649 (write-doc phase 3, R7): the Run App capture (packages/engine/engine/preview-capture.js). A project
// without a screenshot command has its screens taken by starting its local preview
// (.multiagent/local-preview.yaml { install, command, url, cwd }) and opening `url` in a headless
// Chromium. Here the preview is a real tiny node HTTP server and the browser is faked at its boundary
// (the `playwright` module, swapped in require.cache): no real Chromium runs.
// What is checked: the preview stops (its port is free) once a capture returns; a port something
// else answers on is refused; a preview that exits or cannot start is an error with its cause; the
// original side runs in a worktree of the base, made once per session and removed by session.release();
// the install runs once per folder of a session.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const load = () => require('../engine/preview-capture');
const MODULE_DIR = path.join(__dirname, '..', 'engine');

function tmpDir(t, prefix) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

const freePortNumber = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const answers = (port) => new Promise((resolve) => {
  const sock = net.connect({ port, host: '127.0.0.1' });
  const done = (v) => { sock.destroy(); resolve(v); };
  sock.setTimeout(1000, () => done(false));
  sock.once('connect', () => done(true));
  sock.once('error', () => done(false));
});

// a fake `playwright` whose chromium records the pages it opens and writes a PNG on screenshot
function fakeBrowser(t) {
  let resolved;
  try { resolved = require.resolve('playwright', { paths: [MODULE_DIR] }); } catch { return null; }
  const before = require.cache[resolved];
  const visits = [];
  const chromium = {
    launch: async () => ({
      newPage: async () => ({
        goto: async (url) => { visits.push(url); },
        click: async () => {},
        screenshot: async ({ path: out }) => { fs.writeFileSync(out, 'PNG'); },
      }),
      close: async () => {},
    }),
  };
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { chromium }, children: [], paths: [] };
  t.after(() => { if (before) require.cache[resolved] = before; else delete require.cache[resolved]; });
  return { visits };
}

const SERVER = "require('http').createServer((q, s) => s.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');";
const node = `"${process.execPath}"`;

// a project folder with the server script (and, with git, a repository with one commit on main)
function project(t, { git = false } = {}) {
  const dir = tmpDir(t, 'preview-proj-');
  fs.writeFileSync(path.join(dir, 'server.js'), SERVER);
  if (git) {
    const g = (...args) => execFileSync('git', args, { cwd: dir, windowsHide: true, stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
    t.after(() => { try { g('worktree', 'prune'); } catch { /* the folder is gone */ } });
  }
  return dir;
}

const worktrees = (dir) => execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, windowsHide: true }).toString()
  .split(/\r?\n/).filter((l) => l.startsWith('worktree ')).length;

test('previewOptions: --path is the route and each --click a selector, in order', () => {
  const { previewOptions } = load();
  assert.deepEqual(previewOptions(['--path', '/settings', '--click', '#a', '--click', '.b']), { route: '/settings', clicks: ['#a', '.b'] });
  assert.deepEqual(previewOptions([]), { route: '', clicks: [] });
});

test('capturePreview: a preview config without a command or a url is refused', async (t) => {
  const { capturePreview } = load();
  const out = path.join(tmpDir(t, 'shot-'), 'x.png');
  await assert.rejects(capturePreview({ entry: { args: [] }, out, cwd: os.tmpdir(), config: { url: 'http://127.0.0.1:1' } }), /command and a url/);
  await assert.rejects(capturePreview({ entry: { args: [] }, out, cwd: os.tmpdir(), config: { command: 'npm start' } }), /command and a url/);
});

test('capturePreview: starts the preview, opens its url with the --path route, writes the image and leaves the port free', async (t) => {
  const browser = fakeBrowser(t);
  if (!browser) { t.skip('playwright is not installed here'); return; }
  const { capturePreview } = load();
  const cwd = project(t);
  const port = await freePortNumber();
  const url = `http://127.0.0.1:${port}`;
  const out = path.join(tmpDir(t, 'shot-'), '649-home.modified.png');
  await capturePreview({ entry: { args: ['--path', '/home'] }, ref: null, out, cwd, config: { command: `${node} server.js ${port}`, url }, timeoutMs: 30000 });
  assert.equal(fs.existsSync(out), true, 'the image was written');
  assert.deepEqual(browser.visits, [`${url}/home`]);
  assert.equal(await answers(port), false, 'the preview stopped before the capture returned');
});

test('capturePreview: a port something else already answers on is refused (the image would be of that app)', async (t) => {
  const browser = fakeBrowser(t);
  if (!browser) { t.skip('playwright is not installed here'); return; }
  const { capturePreview } = load();
  const other = require('http').createServer((q, s) => s.end('other app'));
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  t.after(() => other.close());
  const { port } = other.address();
  const out = path.join(tmpDir(t, 'shot-'), 'x.png');
  await assert.rejects(
    capturePreview({ entry: { args: [] }, out, cwd: project(t), config: { command: `${node} server.js ${port}`, url: `http://127.0.0.1:${port}` }, timeoutMs: 30000 }),
    /already in use/,
  );
  assert.deepEqual(browser.visits, [], 'the other app was never captured');
});

test('capturePreview: a preview command that exits is an error with its exit code', async (t) => {
  const browser = fakeBrowser(t);
  if (!browser) { t.skip('playwright is not installed here'); return; }
  const { capturePreview } = load();
  const cwd = project(t);
  fs.writeFileSync(path.join(cwd, 'quit.js'), 'process.exit(3);');
  const port = await freePortNumber();
  const out = path.join(tmpDir(t, 'shot-'), 'x.png');
  await assert.rejects(
    capturePreview({ entry: { args: [] }, out, cwd, config: { command: `${node} quit.js`, url: `http://127.0.0.1:${port}` }, timeoutMs: 30000 }),
    /exited with 3/,
  );
});

test('capturePreview: a preview that cannot start fails with the cause, before the deadline', async (t) => {
  const browser = fakeBrowser(t);
  if (!browser) { t.skip('playwright is not installed here'); return; }
  const { capturePreview } = load();
  const cwd = project(t);
  const port = await freePortNumber();
  const out = path.join(tmpDir(t, 'shot-'), 'x.png');
  const t0 = Date.now();
  // its folder (config.cwd) does not exist: the spawn itself fails
  await assert.rejects(
    capturePreview({ entry: { args: [] }, out, cwd, config: { command: `${node} server.js ${port}`, url: `http://127.0.0.1:${port}`, cwd: 'missing' }, timeoutMs: 60000 }),
    /could not start/,
  );
  assert.equal(Date.now() - t0 < 30000, true, 'it did not wait for the deadline');
});

test('capturePreview: the original side runs in one worktree of the base per session, its install once, removed by session.release()', async (t) => {
  const browser = fakeBrowser(t);
  if (!browser) { t.skip('playwright is not installed here'); return; }
  const { capturePreview } = load();
  const cwd = project(t, { git: true });
  const counter = path.join(tmpDir(t, 'count-'), 'installs.txt');
  const installJs = path.join(path.dirname(counter), 'install.js');
  fs.writeFileSync(installJs, `require('fs').appendFileSync(${JSON.stringify(counter)}, process.cwd() + '\\n');`);
  const port = await freePortNumber();
  const config = { install: `${node} "${installJs}"`, command: `${node} server.js ${port}`, url: `http://127.0.0.1:${port}` };
  const shots = tmpDir(t, 'shot-');
  const session = {};
  for (const name of ['a', 'b']) {
    await capturePreview({ entry: { args: [] }, ref: 'main', out: path.join(shots, `${name}.original.png`), cwd, config, timeoutMs: 30000, session });
  }
  assert.equal(fs.existsSync(path.join(shots, 'a.original.png')) && fs.existsSync(path.join(shots, 'b.original.png')), true);
  const bases = Object.values(session.bases || {});
  assert.equal(bases.length, 1, 'one worktree of the base for the session');
  assert.equal(fs.existsSync(bases[0]), true);
  assert.equal(worktrees(cwd), 2);
  const installs = fs.readFileSync(counter, 'utf8').trim().split(/\r?\n/);
  assert.equal(installs.length, 1, 'the install ran once for the session');
  assert.equal(typeof session.release, 'function');
  await session.release();
  assert.equal(fs.existsSync(bases[0]), false, 'session.release() removed the worktree');
  assert.equal(worktrees(cwd), 1);
});

test('capturePreview: without a session, the base worktree goes once the capture ends', async (t) => {
  const browser = fakeBrowser(t);
  if (!browser) { t.skip('playwright is not installed here'); return; }
  const { capturePreview } = load();
  const cwd = project(t, { git: true });
  const port = await freePortNumber();
  const out = path.join(tmpDir(t, 'shot-'), 'x.original.png');
  await capturePreview({ entry: { args: [] }, ref: 'main', out, cwd, config: { command: `${node} server.js ${port}`, url: `http://127.0.0.1:${port}` }, timeoutMs: 30000 });
  assert.equal(fs.existsSync(out), true);
  assert.equal(worktrees(cwd), 1, 'no worktree left behind');
});
