// #835 Mockups phase 2, Compare in the editor: serveMockup (apps/desktop/host/mockups-window.js, what
// protocol.handle('mockup') answers) with `?at=<sha>` serves the file as it was in that commit of the
// project's mockup repository (<workspace>/mockups/<projectId>/, its own git), still with the CSP and the
// inspector; without `at` the working file; 404 for a sha the repository does not have.
// The repository is built here with plain git and an isolated config (identity), env restored after.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MODULE = require.resolve('../../host/mockups-window.js');
const GIT_VARS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
const OLD = '<!doctype html><html><head><title>Orders</title></head><body><main data-mid="m1">Old orders</main></body></html>';
const NEW = '<!doctype html><html><head><title>Orders</title></head><body><main data-mid="m1">New orders</main></body></html>';

// <ws>/mockups/p1 with two commits of screens/orders/index.html → { ws, older, newer }
function repoWorkspace(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-at-835-'));
  const cfg = path.join(ws, 'gitconfig');
  fs.writeFileSync(cfg, '[user]\n\tname = Test\n\temail = test@example.com\n[core]\n\tautocrlf = false\n');
  const saved = Object.fromEntries(GIT_VARS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(ws, { recursive: true, force: true });
  });
  const base = path.join(ws, 'mockups', 'p1');
  const screen = path.join(base, 'screens', 'orders');
  fs.mkdirSync(screen, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: base, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(screen, 'index.html'), OLD);
  git('add', '-A'); git('commit', '-q', '-m', 'one');
  const older = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(screen, 'index.html'), NEW);
  git('add', '-A'); git('commit', '-q', '-m', 'two');
  return { ws, older, newer: git('rev-parse', 'HEAD') };
}

function fresh(t) {
  delete require.cache[MODULE];
  t.after(() => { delete require.cache[MODULE]; });
  return require(MODULE);
}

test('#835 serveMockup with ?at=<sha> serves the screen as it was in that commit', async (t) => {
  const { ws, older } = repoWorkspace(t);
  const { serveMockup } = fresh(t);
  const res = await serveMockup(`mockup://p1/screens/orders/index.html?at=${older}`, ws);
  const body = String(res.body);
  assert.deepEqual([res.status, body.includes('Old orders'), body.includes('New orders')], [200, true, false]);
});

test('#835 serveMockup with a short ?at=<sha7> serves that commit too, with the CSP and the inspector', async (t) => {
  const { ws, older } = repoWorkspace(t);
  const { serveMockup, MOCKUP_CSP } = fresh(t);
  const res = await serveMockup(`mockup://p1/screens/orders/index.html?at=${older.slice(0, 7)}`, ws);
  const body = String(res.body);
  assert.deepEqual([res.status, body.includes('Old orders'), body.includes('mockup:select'), res.headers['content-security-policy'] === MOCKUP_CSP], [200, true, true, true]);
});

test('#835 serveMockup without ?at serves the working screen', async (t) => {
  const { ws } = repoWorkspace(t);
  const { serveMockup } = fresh(t);
  const body = String((await serveMockup('mockup://p1/screens/orders/index.html', ws)).body);
  assert.deepEqual([body.includes('New orders'), body.includes('Old orders')], [true, false]);
});

test('#835 serveMockup answers 404 for a sha the mockup repository does not have', async (t) => {
  const { ws } = repoWorkspace(t);
  const { serveMockup } = fresh(t);
  const res = await serveMockup('mockup://p1/screens/orders/index.html?at=0123456789abcdef0123456789abcdef01234567', ws);
  assert.equal(res.status, 404);
});

test('#835 serveMockup answers 404 for a file that did not exist yet in that commit', async (t) => {
  const { ws, older } = repoWorkspace(t);
  fs.mkdirSync(path.join(ws, 'mockups', 'p1', 'kit'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'mockups', 'p1', 'kit', 'tokens.css'), ':root { --a: #000; }');
  const { serveMockup } = fresh(t);
  assert.equal((await serveMockup(`mockup://p1/kit/tokens.css?at=${older}`, ws)).status, 404);
});
