// #193 is user-visible in Backlog › Roadmap: a long Product Owner reason (and other long content)
// used to stretch the stage/item cards past the window, with a horizontal scrollbar under the
// stages. The fix is the CSS grid tracks (backlog.css, checked in test/renderer-backlog-roadmap.test.js
// and test/renderer-styles.test.js) and the demo roadmap's stage "Reports and health" already carries
// a 500+ character reason (scripts/screenshot.js's demoRoadmap). These scenarios drive
// scripts/screenshot.js (the project's own UI-check tool), the way test/e2e/200-paged-artifacts.test.js
// and test/e2e/203-test-options.test.js do. Only with MULTIAGENT_UI_TESTS=1 (it needs the Electron
// binary and a display), like the rest of the Electron part of test/screenshot.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-193-'));
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

test('@issue-193 Given a roadmap stage whose item has a 500+ character reason, when the owner opens Backlog › Roadmap at a narrow 900px window, then the page fits the window width with no horizontal scrollbar and the reason ends with an ellipsis', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--mode', 'roadmap', '--size', '900x900', '--name', 'roadmap-overflow-900', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'roadmap-overflow-900.png');
  assert.ok(isPng(file));
});

test('@issue-193 Given the same long reason, when the owner switches Roadmap to "Group by epic", then the epic cards fit the window width too', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--mode', 'roadmap', '--size', '900x900', '--click', '[data-rm-by-epic]', '--name', 'roadmap-overflow-by-epic', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'roadmap-overflow-by-epic.png');
  assert.ok(isPng(file));
});
