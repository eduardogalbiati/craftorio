// #189: the Product Owner's Speed ↔ Quality calibration is user-visible (the Agents screen's editor,
// the Backlog drawer's settings panel and chip): these scenarios drive scripts/screenshot.js, the
// project's own UI-check tool (never a hand-written script that launches src/main directly), the way
// test/screenshot.test.js does. Given/When/Then documents each scenario; the screenshot is the
// evidence a developer or QA reads at the gate. Only runs with MULTIAGENT_UI_TESTS=1 (it needs the
// Electron binary and a display), like the rest of the Electron part of test/screenshot.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-189-'));
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

test('@issue-189 Given the Agents screen, when the owner opens the Product Owner, then its editor shows a Planning section with the Speed ↔ Quality slider and what each control changes', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'agents', '--click', ".agent-card[data-id='product-owner']", '--name', 'planning-section', '--wait', '1200', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'planning-section.png');
  assert.ok(isPng(file));
});

test('@issue-189 Given the Product Owner drawer, when the owner clicks the settings button next to Clear, then a panel with a back arrow shows the same slider, the model and the effort, applying to the next answer', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'backlog', '--po', 'stopped', '--click', '#btn-po-settings', '--name', 'drawer-settings', '--wait', '1200', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'drawer-settings.png');
  assert.ok(isPng(file));
});

test('@issue-189 Given a saved calibration of Speed-leaning, when the owner asks one question for Quality, then that question and its answer are marked "for Quality" / "Planned for Quality · this question" while the header chip keeps showing the saved step', { skip, timeout: 90000 }, async (t) => {
  const out = tmp(t);
  // the demo conversation (scripts/screenshot.js's demoPoConversation) already seeds a question asked
  // "for Quality" (#189, a per-question override) over a Speed-leaning (2) saved calibration; the
  // drawer defaults to Register an issue here because an earlier demo draft is still unfiled (#117), so
  // this switches back to Plan the backlog, where the calibration chip and badges apply.
  const r = await shoot(['--view', 'backlog', '--po', 'stopped', '--click', "[data-po-mode='plan']", '--size', '1400x2000', '--name', 'per-question-override', '--wait', '1200', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\[renderer:error\]/);
  const file = path.join(out, 'per-question-override.png');
  assert.ok(isPng(file));
});
