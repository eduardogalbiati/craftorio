// #194 is user-visible in Backlog › Roadmap: an item with a live run now shows a circular progress
// ring (estimated %, current step, agent avatar) instead of only a "run <id>" link. The demo roadmap's
// "Tonight" stage (scripts/screenshot.js's demoRoadmap/demoRoadmapRuns) seeds a running, a waiting
// (at the human review gate) and a failed run so the three ring states show together. The estimate's
// math is unit-tested in test/run-progress.test.js and the ring markup in
// test/renderer-backlog-roadmap.test.js; this scenario only drives scripts/screenshot.js, the way
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-194-'));
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

test('@issue-194 Given a stage with a running, a waiting and a failed run, when the owner opens Backlog › Roadmap, then each item shows a progress ring with its estimated percent and current step, in the state\'s own colour', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--mode', 'roadmap', '--wait', '2500', '--name', 'roadmap-progress-rings', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'roadmap-progress-rings.png');
  assert.ok(isPng(file));
});
