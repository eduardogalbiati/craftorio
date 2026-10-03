// #196 is user-visible in Backlog › Roadmap: an item whose start was refused for kept work (an ended
// run left commits of its own) used to show no Retry/Skip, only the error text. The demo roadmap's
// "Tonight" stage (scripts/screenshot.js's demoRoadmap) seeds exactly that: item-7 (#14) paused the
// roadmap with a kept-work error and no run. The button logic (retryable/refusedStart) is unit-tested
// in test/renderer-backlog-roadmap.test.js; these scenarios only drive scripts/screenshot.js, the way
// test/e2e/200-paged-artifacts.test.js does. Only with MULTIAGENT_UI_TESTS=1 (it needs the Electron
// binary and a display), like the rest of the Electron part of test/screenshot.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-196-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const electron = (() => {
  const dir = path.join(root, 'node_modules', 'electron');
  try { const p = path.join(dir, 'dist', fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim()); return fs.existsSync(p) ? p : null; } catch { return null; }
})();
const skip = process.env.MULTIAGENT_UI_TESTS !== '1' ? 'set MULTIAGENT_UI_TESTS=1 to open the app' : false;

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

test('@issue-196 Given an item whose start was refused because an ended run kept work, when the owner opens Backlog › Roadmap, then that item shows Retry and Skip buttons and the roadmap banner points to it', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--mode', 'roadmap', '--name', 'roadmap-refused-start', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'roadmap-refused-start.png');
  assert.ok(isPng(file));
});

test('@issue-196 Given that item, when the owner clicks Retry, then the kept-work dialog asks to resume the old run or start from scratch', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--mode', 'roadmap', '--click', '[data-item="item-7"] [data-rm-item="retry"]', '--name', 'roadmap-refused-start-dialog', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'roadmap-refused-start-dialog.png');
  assert.ok(isPng(file));
});
