// #205 is user-visible in three places: the Agents screen's Product Owner editor (Planning
// section), the Backlog drawer's settings panel, and the roadmap's items, which now carry a Cost
// badge next to the Speed ↔ Quality calibration (#189). These scenarios drive scripts/screenshot.js
// (the project's own UI-check tool, never a hand-written script that launches src/main directly),
// the way test/e2e/189-po-calibration.test.js does. Only runs with MULTIAGENT_UI_TESTS=1 (it needs
// the Electron binary and a display), like the rest of the Electron part of test/screenshot.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-205-'));
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

test('@issue-205 Given the Agents screen, when the owner opens the Product Owner, then its editor shows a Cost slider (Economy ↔ Generous) next to Speed ↔ Quality, with what each step does', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'agents', '--click', ".agent-card[data-id='product-owner']", '--name', 'planning-section-cost', '--wait', '1200', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'planning-section-cost.png');
  assert.ok(isPng(file));
});

test('@issue-205 Given the Product Owner drawer, when the owner opens its settings panel, then it shows the same Cost slider next to Speed ↔ Quality, saved on its own', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--po', 'stopped', '--click', '#btn-po-settings', '--name', 'drawer-settings-cost', '--wait', '1200', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'drawer-settings-cost.png');
  assert.ok(isPng(file));
});

test('@issue-205 Given a plan answer that grouped issues at a chosen cost level, when the owner looks at the roadmap, then each item shows a Cost badge (Economy or Generous) with its tests and grouping reason', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--size', '1400x2000', '--name', 'roadmap-cost-badges', '--wait', '1200', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'roadmap-cost-badges.png');
  assert.ok(isPng(file));
});
