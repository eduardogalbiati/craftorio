// scripts/screenshot.js: one screen of the app in simulation, saved as a PNG, and the app quits by
// itself. The Electron part opens ~25 windows in about a minute, so it only runs with
// MULTIAGENT_UI_TESTS=1 (CI does it on Windows): it needs the Electron binary
// (`node node_modules/electron/install.js`) and a display (on Linux: xvfb-run).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseArgs, recordShot, usage, VIEWS } = require('../scripts/screenshot');

const root = path.join(__dirname, '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('--help prints the header comment: every option, without comment markers', () => {
  const text = usage();
  for (const opt of ['--view', '--tab', '--click', '--ref', '--out', '--name', '--caption', '--before']) assert.match(text, new RegExp(opt));
  assert.doesNotMatch(text, /^\/\//m);
});

test('parseArgs names the file after the scenario and checks options against the view', () => {
  assert.equal(parseArgs(['--view', 'backlog', '--mode', 'kanban', '--theme', 'light']).name, 'backlog-kanban-light');
  assert.deepEqual(parseArgs(['--view', 'settings', '--tab', 'about', '--size', '1200x800']).size, [1200, 800]);
  assert.equal(parseArgs([]).view, 'dashboard');
  assert.equal(parseArgs(['--view', 'run']).wait, 20000);
  assert.throws(() => parseArgs(['--view', 'nope']), /Unknown view: nope/);
  assert.throws(() => parseArgs(['--view', 'settings', '--tab', 'kanban']), /does not apply to settings \(tabs: general/);
  assert.throws(() => parseArgs(['--view', 'dashboard', '--mode', 'kanban']), /does not apply to dashboard$/);
  assert.throws(() => parseArgs(['--size', 'big']), /WIDTHxHEIGHT/);
  assert.throws(() => parseArgs(['--name', '../x']), /plain file name/);
  assert.throws(() => parseArgs(['--before', 'a.png']), /--before needs --caption/);
  assert.throws(() => parseArgs(['--real']), /Unknown argument: --real/);
});

test('recordShot adds a shot to screenshots.json and replaces the one with the same file', (t) => {
  const dir = tmp(t);
  recordShot(dir, { path: 'settings-after.png', caption: 'Settings', before: 'settings-before.png' });
  recordShot(dir, { path: 'backlog.png', caption: 'Backlog' });
  recordShot(dir, { path: 'settings-after.png', caption: 'Settings > General', before: 'settings-before.png' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'screenshots.json'), 'utf8')), [
    { path: 'settings-after.png', caption: 'Settings > General', before: 'settings-before.png' },
    { path: 'backlog.png', caption: 'Backlog' },
  ]);
});

// ---- in Electron ------------------------------------------------------------------------------
// Located without require('electron'), which would download the binary when it is missing.
const electron = (() => {
  const dir = path.join(root, 'node_modules', 'electron');
  try { const p = path.join(dir, 'dist', fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim()); return fs.existsSync(p) ? p : null; } catch { return null; }
})();
const skip = process.env.MULTIAGENT_UI_TESTS !== '1' ? 'set MULTIAGENT_UI_TESTS=1 to open the app' : false;

test('the Electron binary is installed for the UI tests', { skip }, () => {
  assert.ok(electron, 'run `node node_modules/electron/install.js` first');
});

/** Runs the script; resolves { code, out, ms }. Kills it (and fails) if it outlives `limit`. */
function shoot(args, limit = 150000) {
  return new Promise((resolve, reject) => {
    if (!electron) { reject(new Error('the Electron binary is not installed')); return; }
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const started = Date.now();
    const child = spawn(electron, [path.join(root, 'scripts', 'screenshot.js'), ...args], { cwd: root, env, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`still running after ${limit} ms: ${args.join(' ')}\n${out}`)); }, limit);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, ms: Date.now() - started }); });
  });
}

const isPng = (file) => fs.readFileSync(file).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

// every view, plus each tab and mode; three apps at a time
const SCENARIOS = Object.entries(VIEWS).flatMap(([view, v]) => {
  const extra = (v.tabs || []).map((tab) => ['--tab', tab]).concat((v.modes || []).map((mode) => ['--mode', mode]));
  return (extra.length ? extra : [[]]).map((opts) => ['--view', view, ...opts, ...(v.live ? ['--wait', '4000'] : ['--wait', '300'])]);
});

test('opens every view in simulation, saves a PNG and quits by itself', { skip, timeout: 900000 }, async (t) => {
  const out = tmp(t);
  const queue = [...SCENARIOS];
  const failures = [];
  await Promise.all([1, 2, 3].map(async () => {
    for (let args = queue.shift(); args; args = queue.shift()) {
      const r = await shoot([...args, '--out', out]);
      const name = parseArgs(args).name;
      const file = path.join(out, `${name}.png`);
      if (r.code !== 0 || !fs.existsSync(file) || !isPng(file)) failures.push(`${args.join(' ')} → exit ${r.code}\n${r.out.trim()}`);
    }
  }));
  assert.deepEqual(failures, []);
});

test('--ref captures the app at a git ref and leaves node_modules in place', { skip, timeout: 180000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'settings', '--ref', 'HEAD', '--name', 'before', '--wait', '300', '--out', out]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /app at HEAD \([0-9a-f]{12}\)/);
  assert.ok(isPng(path.join(out, 'before.png')));
  // the scratch copy reached node_modules through a junction; removing it must not follow it
  assert.ok(fs.existsSync(electron));
  assert.ok(fs.existsSync(path.join(root, 'node_modules', 'js-yaml', 'package.json')));
});

test('exits with an error after its hard timeout', { skip, timeout: 120000 }, async (t) => {
  const r = await shoot(['--view', 'dashboard', '--wait', '600000', '--timeout', '8000', '--out', tmp(t)], 60000);
  assert.equal(r.code, 1);
  assert.match(r.out, /timed out after 8000 ms/);
});

test('refuses an unknown view without opening the app', { skip, timeout: 60000 }, async () => {
  const r = await shoot(['--view', 'nope'], 30000);
  assert.equal(r.code, 2);
  assert.match(r.out, /Unknown view: nope/);
});
