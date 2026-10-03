// #207 is user-visible on the Backlog's Kanban board (and the List view, which shares the same label
// chips): labels now show a pastel background in their own colour, no border, instead of an outlined
// pill. The CSS itself is checked in test/renderer-styles.test.js (color-mix background, no border,
// the active-filter ring); this scenario only drives scripts/screenshot.js for a visual before/after,
// the way test/e2e/200-paged-artifacts.test.js does. The contrast of label text on the pastel
// background (WCAG 4.5:1 for the repository's real labels) is the owner's own measurement, not
// asserted here. Only with MULTIAGENT_UI_TESTS=1 (it needs the Electron binary and a display), like
// the rest of the Electron part of test/screenshot.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-207-'));
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

test('@issue-207 Given issues with several labels (type, complexity, area), when the owner opens the Backlog\'s Kanban board, then every label chip shows a pastel background in its own colour with no border', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--mode', 'kanban', '--name', 'kanban-pastel-labels', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'kanban-pastel-labels.png');
  assert.ok(isPng(file));
});
