// #206 is user-visible on the Backlog's roadmap: items and stages show an estimated cost, the
// roadmap pauses before a real start that would pass the owner's daily (or nightly) budget, and
// the top bar shows today's spending against it. These scenarios drive scripts/screenshot.js (the
// project's own UI-check tool), the way test/e2e/205-cost-slider.test.js does, using its --budget
// demo states (paused: the cap reached, mid-roadmap; set: a budget that is not yet reached). Only
// runs with MULTIAGENT_UI_TESTS=1 (it needs the Electron binary and a display), like the rest of
// the Electron part of test/screenshot.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-206-'));
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

test('@issue-206 Given past successful runs of a workflow, when the owner opens the Backlog roadmap, then each item and its stage show an estimated cost ("≈ $X"), or "no estimate yet" without history', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--size', '1400x2000', '--name', 'roadmap-estimates', '--wait', '1200', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'roadmap-estimates.png');
  assert.ok(isPng(file));
});

test('@issue-206 Given the next stage would pass today\'s budget, when the owner opens the Backlog, then the roadmap pauses with "Budget reached" and offers "Raise for today" and "Resume anyway", never starting the item or crossing a gate', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--budget', 'paused', '--name', 'roadmap-budget-paused', '--wait', '1200', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'roadmap-budget-paused.png');
  assert.ok(isPng(file));
});

test('@issue-206 Given a daily budget is set and not yet reached, when the owner opens the Backlog, then the top bar shows today\'s spending against it, e.g. "$X / $Y today"', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--budget', 'set', '--name', 'top-bar-budget-meter', '--wait', '1200', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'top-bar-budget-meter.png');
  assert.ok(isPng(file));
});
