// #200 is user-visible on the Runs list (Workflows › Runs, same list on Projects › Project) and the
// Artifacts screen: the list pages itself (infinite scroll), and a row's files load only once it is
// expanded, grouped by step with "Show more". These scenarios drive scripts/screenshot.js (the
// project's own UI-check tool, never a hand-written script that launches src/main directly), the way
// test/e2e/189-po-calibration.test.js does; its demoRunHistory (#200) seeds 40 finished runs, so the
// list needs a second page, and the newest one (id ending -demohist00) saved 72 files over four
// steps, so expanding it needs "Show more". Only runs with MULTIAGENT_UI_TESTS=1 (it needs the
// Electron binary and a display), like the rest of the Electron part of test/screenshot.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-200-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Located without require('electron'), which would download the binary when it is missing.
const electron = (() => {
  const dir = path.join(root, 'node_modules', 'electron');
  try { const p = path.join(dir, 'dist', fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim()); return fs.existsSync(p) ? p : null; } catch { return null; }
})();
const skip = process.env.MULTIAGENT_UI_TESTS !== '1' ? 'set MULTIAGENT_UI_TESTS=1 to open the app' : false;

/** Runs scripts/screenshot.js; resolves { code, out }. Kills it (and fails) if it outlives `limit`. */
function shoot(args, limit = 90000) {
  return new Promise((resolve, reject) => {
    if (!electron) { reject(new Error('the Electron binary is not installed')); return; }
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, 'scripts', 'screenshot.js'), ...args], { cwd: root, env, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`still running after ${limit} ms: ${args.join(' ')}\n${out}`)); }, limit);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

const isPng = (file) => fs.readFileSync(file).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

test('@issue-200 Given a workspace with more runs than fit on one page, when the owner opens Workflows › Runs, then a "Loading more…" row waits below the first page, ready for infinite scroll', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'workflows', '--wait', '1000', '--name', 'runs-loading-more', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'runs-loading-more.png');
  assert.ok(isPng(file));
});

test('@issue-200 Given a run that produced many files, when the owner expands its row, then its artifacts load and show grouped by step, with a "Show more" button for the files past the first page', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'workflows', '--click', '[data-run$="-demohist00"] .pr-row', '--wait', '1200', '--name', 'run-artifacts-grouped', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'run-artifacts-grouped.png');
  assert.ok(isPng(file));
});

test('@issue-200 Given an expanded run\'s artifacts capped at the first page, when the owner clicks "Show more", then the rest of its files appear too', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'workflows', '--click', '[data-run$="-demohist00"] .pr-row', '--click', '[data-art-more]', '--wait', '1200', '--name', 'run-artifacts-show-more', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'run-artifacts-show-more.png');
  assert.ok(isPng(file));
});
