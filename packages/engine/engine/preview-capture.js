// The Run App capture of the screenshots step (#649, write-doc phase 3): a project without a screenshot
// command but with a .multiagent/local-preview.yaml ({ install, command, url, cwd, env }) gets its
// screens taken by starting that preview and opening `url` in a headless Chromium (Playwright, loaded
// when a capture runs: a machine without it gets an error that says so, and the step reports it).
// capturePreview({ entry, side, ref, out, cwd, config, env, signal, timeoutMs }) writes `out` (a PNG)
// or throws: the modified side runs in the worktree (cwd); the original side (ref = the base) in a
// detached git worktree of the base, installed first, removed after. The entry's args understood here:
// `--path <route>` (appended to url) and `--click <selector>` (clicked in order before the capture).
// Each capture starts and stops its own preview: nothing is left running.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { commandLine, needsInstall, runFolder } = require('../domains/local/local-preview');
const { killTree, OWN_GROUP } = require('./providers');

const POLL_MS = 500;

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

// Resolves once `url` answers anything; rejects at the deadline, on abort or when the preview exits
async function waitForUrl(url, timeoutMs, signal, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('cancelled');
    if (child.exitCode != null) throw new Error(`the preview command exited with ${child.exitCode}`);
    try { await fetch(url, { signal: AbortSignal.timeout(POLL_MS * 4) }); return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`${url} did not answer within ${Math.round(timeoutMs / 1000)} s`);
}

// The preview's process in `root` (installed first when its dependencies are missing)
function startPreview(root, config, env) {
  const dir = runFolder(root, config);
  const install = needsInstall(dir, path.join(os.tmpdir(), 'multiagent-preview-capture-none.json')).install;
  const childEnv = { ...env, ...config.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return spawn(commandLine(config, install), { cwd: dir, env: childEnv, shell: true, windowsHide: true, stdio: 'ignore', ...OWN_GROUP });
}

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

async function capturePreview({ entry, ref, out, cwd, config, env = process.env, signal, timeoutMs = 180000 }) {
  if (!config?.command || !config.url) throw new Error('.multiagent/local-preview.yaml needs a command and a url');
  loadChromium();
  const base = ref ? fs.mkdtempSync(path.join(os.tmpdir(), 'preview-base-')) : null;
  if (base) await gitRun(cwd, ['worktree', 'add', '--detach', base, ref]);
  const child = startPreview(base || cwd, config, env);
  child.on('error', () => {});
  try {
    await waitForUrl(config.url, timeoutMs, signal, child);
    await shoot(config.url, previewOptions(entry?.args), out);
  } finally {
    killTree(child);
    if (base) await gitRun(cwd, ['worktree', 'remove', '--force', base]).catch(() => fs.rmSync(base, { recursive: true, force: true }));
  }
}

module.exports = {
  capturePreview,
  previewOptions,
};
