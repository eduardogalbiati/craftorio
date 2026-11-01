// The Run App capture of the screenshots step (#649, write-doc phase 3): a project without a screenshot
// command but with a .multiagent/local-preview.yaml ({ install, command, url, cwd, env }) gets its
// screens taken by starting that preview and opening `url` in a headless Chromium (Playwright, loaded
// when a capture runs: a machine without it gets an error that says so, and the step reports it).
// capturePreview({ entry, side, ref, out, cwd, config, env, signal, timeoutMs, session }) writes `out`
// (a PNG) or throws: the modified side runs in the worktree (cwd); the original side (ref = the base) in
// a detached git worktree of the base. The entry's args understood here: `--path <route>` (appended to
// url) and `--click <selector>` (clicked in order before the capture).
// The install runs on its own, before the preview, with its own deadline (INSTALL_TIMEOUT_MS); timeoutMs
// covers the start and the capture. Each capture starts and stops its own preview, waits for it to exit
// and refuses a port something else already answers on (the image would be of that app). `session`
// (an object the step keeps for all its captures): the base worktree and the installs are made once,
// and `await session.release()` removes the worktree; without one, it goes after the capture.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const {
  needsInstall,
  portInUse,
  portOf,
  runFolder,
} = require('../domains/local/local-preview');
const { killTree, OWN_GROUP } = require('./providers');

const POLL_MS = 500;
const EXIT_WAIT_MS = 10000;
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

// Playwright's chromium, from whichever package the machine has → chromium; throws when none
function loadChromium() {
  for (const name of ['playwright', '@playwright/test']) {
    try { return require(name).chromium; } catch { /* the next one */ }
  }
  throw new Error('Run App capture needs Playwright (npm install -D playwright, then npx playwright install chromium)');
}

// '--path /x --click a --click b' → { route: '/x', clicks: ['a', 'b'] }
function previewOptions(args = []) {
  const opts = { route: '', clicks: [] };
  args.forEach((a, i) => {
    if (a === '--path') opts.route = args[i + 1] || '';
    else if (a === '--click' && args[i + 1]) opts.clicks.push(args[i + 1]);
  });
  return opts;
}

const gitRun = (cwd, args) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, windowsHide: true }, (err, _out, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve()));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The child's exit (its 'close'), at most `ms`; true when it exited
function exited(child, ms) {
  if (child.exitCode != null || child.signalCode != null || child.startError) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once('close', () => { clearTimeout(timer); resolve(true); });
  });
}

// A shell child of `line` in `dir`, its spawn error kept as child.startError
function shellChild(line, dir, config, env) {
  const childEnv = { ...env, ...config.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(line, { cwd: dir, env: childEnv, shell: true, windowsHide: true, stdio: 'ignore', ...OWN_GROUP });
  child.on('error', (e) => { child.startError = e; });
  return child;
}

// Resolves once `url` answers anything; rejects at the deadline, on abort or when the preview exits
async function waitForUrl(url, timeoutMs, signal, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('cancelled');
    if (child.startError) throw new Error(`the preview command could not start: ${child.startError.message}`);
    if (child.exitCode != null) throw new Error(`the preview command exited with ${child.exitCode}`);
    try { await fetch(url, { signal: AbortSignal.timeout(POLL_MS * 4) }); return; } catch { /* not up yet */ }
    await sleep(POLL_MS);
  }
  throw new Error(`${url} did not answer within ${Math.round(timeoutMs / 1000)} s`);
}

// The preview's install in `dir` when its dependencies are missing (a null state file: a one-off
// preview, needsInstall's first case), once per folder of the session
async function install(dir, config, env, signal, session) {
  if (!config.install || session?.installed?.has(dir) || !needsInstall(dir, null).install) return;
  const child = shellChild(config.install, dir, config, env);
  const stop = () => killTree(child);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    if (!(await exited(child, INSTALL_TIMEOUT_MS))) {
      killTree(child);
      throw new Error(`the install (${config.install}) did not end within ${Math.round(INSTALL_TIMEOUT_MS / 60000)} min`);
    }
  } finally { signal?.removeEventListener('abort', stop); }
  if (signal?.aborted) throw new Error('cancelled');
  if (child.startError) throw new Error(`the install (${config.install}) could not start: ${child.startError.message}`);
  if (child.exitCode !== 0) throw new Error(`the install (${config.install}) exited with ${child.exitCode}`);
  if (session) (session.installed ||= new Set()).add(dir);
}

// Waits for the preview's port to be free (the previous capture's server stopping), then fails
async function freePort(url) {
  const port = portOf(url);
  if (!port) return;
  const deadline = Date.now() + EXIT_WAIT_MS;
  while (await portInUse(port)) {
    if (Date.now() > deadline) throw new Error(`port ${port} of ${url} is already in use: stop what runs there, the capture would show it`);
    await sleep(POLL_MS);
  }
}

// The detached worktree of `ref`: the session's when it has one (removed by session.release())
async function baseWorktree(cwd, ref, session) {
  if (session?.bases?.[ref]) return session.bases[ref];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-base-'));
  await gitRun(cwd, ['worktree', 'add', '--detach', dir, ref]);
  if (session) {
    session.bases = { ...session.bases, [ref]: dir };
    session.release = async () => {
      for (const d of Object.values(session.bases || {})) await removeWorktree(cwd, d);
      session.bases = {};
    };
  }
  return dir;
}

const removeWorktree = (cwd, dir) => gitRun(cwd, ['worktree', 'remove', '--force', dir]).catch(() => fs.rmSync(dir, { recursive: true, force: true }));

async function shoot(url, { route, clicks }, out) {
  const browser = await loadChromium().launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(new URL(route || '/', url).href, { waitUntil: 'networkidle' });
    for (const selector of clicks) await page.click(selector, { timeout: 10000 });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out });
  } finally { await browser.close(); }
}

async function capturePreview({ entry, ref, out, cwd, config, env = process.env, signal, timeoutMs = 180000, session = null }) {
  if (!config?.command || !config.url) throw new Error('.multiagent/local-preview.yaml needs a command and a url');
  loadChromium();
  const base = ref ? await baseWorktree(cwd, ref, session) : null;
  try {
    const dir = runFolder(base || cwd, config);
    await install(dir, config, env, signal, session);
    await freePort(config.url);
    const child = shellChild(config.command, dir, config, env);
    try {
      await waitForUrl(config.url, timeoutMs, signal, child);
      await shoot(config.url, previewOptions(entry?.args), out);
    } finally {
      killTree(child);
      await exited(child, EXIT_WAIT_MS);
    }
  } finally {
    if (base && !session) await removeWorktree(cwd, base);
  }
}

module.exports = {
  capturePreview,
  previewOptions,
};
