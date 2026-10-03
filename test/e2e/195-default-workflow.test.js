// #195 is user-visible in Settings › General › Backlog: a new "Default development workflow" select,
// used wherever a workflow is not picked by hand. The resolver (src/renderer/default-workflow.js) and
// the fallback paths (Product Owner, split, Assign) are unit-tested in test/default-workflow.test.js,
// test/product-owner.test.js and the renderer tests of backlog-po.js/backlog-po-proposals.js/
// settings.js; the "N items will push" start confirmation is covered in
// test/renderer-backlog-roadmap.test.js. This scenario only drives scripts/screenshot.js for the
// Settings select itself, the way test/e2e/200-paged-artifacts.test.js does. The split/"Create +
// roadmap" workflow selects and the push confirmation dialog are not reachable from
// scripts/screenshot.js's demo data (they need a Product Owner proposal or a mixed roadmap to exist
// first) and stay covered by the renderer unit tests above instead of a second, costlier scenario.
// Only with MULTIAGENT_UI_TESTS=1 (it needs the Electron binary and a display), like the rest of the
// Electron part of test/screenshot.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-195-'));
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

test('@issue-195 Given a fresh workspace with no default set, when the owner opens Settings › General, then "Default development workflow" shows the local workflow picked, with the other workflows to choose from', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'settings', '--tab', 'general', '--name', 'settings-default-workflow', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'settings-default-workflow.png');
  assert.ok(isPng(file));
});
