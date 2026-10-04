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
const { fileName, parseArgs, recordShot, usage, VIEWS } = require('../scripts/screenshot');
const evidence = require('../src/evidence');

const root = path.join(__dirname, '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('--help prints the header comment: every option, without comment markers', () => {
  const text = usage();
  for (const opt of ['--view', '--tab', '--click', '--ref', '--out', '--name', '--side', '--caption', '--input', '--stop-at']) assert.match(text, new RegExp(opt));
  assert.doesNotMatch(text, /--before/);
  assert.doesNotMatch(text, /^\/\//m);
});

test('the backlog view offers roadmap and epics modes, alongside list and kanban', () => {
  assert.deepEqual(VIEWS.backlog.modes, ['list', 'kanban', 'roadmap', 'epics']);
  assert.equal(parseArgs(['--view', 'backlog', '--mode', 'roadmap']).name, 'backlog-roadmap');
  assert.equal(parseArgs(['--view', 'backlog', '--mode', 'epics']).name, 'backlog-epics');
});

test('--view roadmap (#254: the Roadmap screen) draws the Backlog in its roadmap mode, named backlog-roadmap, and takes no --mode', () => {
  const args = parseArgs(['--view', 'roadmap']);
  assert.equal(args.view, 'backlog');
  assert.equal(args.mode, 'roadmap');
  assert.equal(args.name, 'backlog-roadmap');
  assert.throws(() => parseArgs(['--view', 'roadmap', '--mode', 'kanban']), /--mode kanban does not apply to roadmap/);
});

test('the analytics view offers the Run (#228) and 24/7 (#188) tabs, alongside usage and performance', () => {
  for (const tab of ['usage', 'performance', 'run', 'occupancy']) assert.ok(VIEWS.analytics.tabs.includes(tab), `analytics tab ${tab}`);
  assert.equal(parseArgs(['--view', 'analytics', '--tab', 'run']).name, 'analytics-run');
  assert.equal(parseArgs(['--view', 'analytics', '--tab', 'occupancy', '--theme', 'light']).name, 'analytics-occupancy-light');
});

test('--view home-empty (#255) is a view of its own: Home of a new workspace, named home-empty, with no tab or mode', () => {
  assert.ok(VIEWS['home-empty'], 'a home-empty view');
  assert.equal(parseArgs(['--view', 'home-empty']).name, 'home-empty');
  assert.equal(parseArgs(['--view', 'home-empty', '--theme', 'light']).name, 'home-empty-light');
  assert.throws(() => parseArgs(['--view', 'home-empty', '--mode', 'kanban']), /does not apply to home-empty/);
  assert.match(usage(), /home-empty/);
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
  assert.throws(() => parseArgs(['--before', 'a.png']), /Unknown argument: --before/);
  assert.throws(() => parseArgs(['--real']), /Unknown argument: --real/);
});

// #162: --keep-awake off | idle | active | error, a demo state of the Keep awake switch.
test('--keep-awake takes off, idle, active or error; anything else is refused', () => {
  assert.equal(parseArgs(['--view', 'workflows']).keepAwake, null);
  for (const v of ['off', 'idle', 'active', 'error']) assert.equal(parseArgs(['--view', 'workflows', '--keep-awake', v]).keepAwake, v);
  assert.throws(() => parseArgs(['--view', 'workflows', '--keep-awake', 'nope']), /--keep-awake takes off \| idle \| active \| error/);
});

// #180: --po working | writing | stopped | failed, the Product Owner's drawer with its live turn.
test('--po takes working, writing, stopped or failed, and only applies to --view backlog', () => {
  assert.equal(parseArgs(['--view', 'backlog']).po, undefined);
  for (const v of ['working', 'writing', 'stopped', 'failed']) {
    const a = parseArgs(['--view', 'backlog', '--po', v]);
    assert.equal(a.po, v);
    assert.equal(a.name, `backlog-po-${v}`);
  }
  assert.throws(() => parseArgs(['--view', 'backlog', '--po', 'nope']), /--po takes working \| writing \| stopped \| failed/);
  assert.throws(() => parseArgs(['--view', 'dashboard', '--po', 'working']), /--po applies to --view backlog/);
});

test('--side takes original or modified, and is inferred from --ref (original) or --caption (modified) when not given', () => {
  assert.equal(parseArgs(['--view', 'dashboard']).side, null);
  assert.equal(parseArgs(['--view', 'dashboard', '--side', 'original']).side, 'original');
  assert.throws(() => parseArgs(['--view', 'dashboard', '--side', 'before']), /--side takes original \| modified/);
  assert.equal(parseArgs(['--view', 'dashboard', '--ref', 'HEAD']).side, 'original');
});

test('fileName: --side appends .original.png / .modified.png; without it, just <name>.png', () => {
  assert.equal(fileName(parseArgs(['--view', 'dashboard'])), 'dashboard.png');
  assert.equal(fileName(parseArgs(['--view', 'dashboard', '--side', 'original'])), 'dashboard.original.png');
  assert.equal(fileName(parseArgs(['--view', 'dashboard', '--side', 'modified'])), 'dashboard.modified.png');
});

test('--caption needs --out to be a run\'s evidence round folder (<run_dir>/evidence/<step>/round-<n>)', (t) => {
  const run = tmp(t);
  assert.throws(() => parseArgs(['--view', 'dashboard', '--caption', 'x']), /--caption needs --out/);
  assert.throws(() => parseArgs(['--view', 'dashboard', '--caption', 'x', '--out', run]), /--caption needs --out/, 'not a round folder');
  const roundDir = evidence.roundDir(run, 'evidence', 1);
  fs.mkdirSync(roundDir, { recursive: true });
  const a = parseArgs(['--view', 'dashboard', '--caption', 'It works', '--out', roundDir]);
  assert.equal(a.caption, 'It works');
  assert.equal(a.side, 'modified');
});

test('--input and --stop-at only apply to --view run; --input takes key=value and is repeatable', () => {
  const a = parseArgs(['--view', 'run', '--input', 'mode=validated', '--input', 'base_branch=main']);
  assert.deepEqual(a.inputs, { mode: 'validated', base_branch: 'main' });
  assert.equal(parseArgs(['--view', 'run', '--stop-at', 'developer_check']).stopAt, 'developer_check');
  assert.throws(() => parseArgs(['--input', 'mode=validated']), /--stop-at and --input apply to --view run/);
  assert.throws(() => parseArgs(['--view', 'dashboard', '--stop-at', 'developer_check']), /--stop-at and --input apply to --view run/);
  assert.throws(() => parseArgs(['--view', 'run', '--input', 'mode']), /--input takes key=value/);
});

test('recordShot records a round folder\'s file (caption, commit) into the run\'s evidence manifest', (t) => {
  const run = tmp(t);
  const roundDir = evidence.roundDir(run, 'evidence', 1);
  fs.mkdirSync(roundDir, { recursive: true });
  const file = path.join(roundDir, 'settings-general.modified.png');
  fs.writeFileSync(file, 'PNG');

  const m = recordShot(roundDir, { file, caption: 'Settings > General', commit: 'abc1234' });

  assert.equal(m.images.length, 1);
  assert.equal(m.images[0].path, 'evidence/evidence/round-1/settings-general.modified.png');
  assert.equal(m.images[0].caption, 'Settings > General');
  assert.equal(m.images[0].commit, 'abc1234');
  assert.deepEqual(JSON.parse(fs.readFileSync(evidence.manifestPath(run), 'utf8')).images[0].caption, 'Settings > General');
});

test('recordShot refuses a folder that is not a run\'s evidence round folder', (t) => {
  const dir = tmp(t);
  assert.throws(() => recordShot(dir, { file: path.join(dir, 'x.png'), caption: 'x' }), /Not a round folder of a run's evidence/);
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

// #187 (E2E, @issue-187): the Oracle drawer's --oracle actions demo data (scripts/screenshot.js
// demoOracleActions) has a proposed card 'c1' and a done+undoable card 'c3'; clicking their real
// buttons drives the real preload.js + the real service, the way the owner does. The screenshot is
// evidence for the gate reviewer; the assertion here is that the real app does not crash or hang on
// the click (a regression that threw "not in the conversation" synchronously, before any await,
// would still leave the renderer running, but a thrown promise rejection the renderer never awaits
// can surface as an uncaught exception at the Electron process level, which the pass/fail here would
// still have caught via `r.code`). The service-level test in test/oracle.test.js is what proves the
// id reaches the service as a string, not an object.
test('Oracle drawer: clicking "Do it" on a proposed card does not crash the app (#187, @issue-187)', { skip, timeout: 60000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'oracle', '--oracle', 'actions', '--click', '[data-oracle-act="c1"]', '--wait', '1500', '--out', out, '--name', '187-do-it'], 50000);
  assert.equal(r.code, 0, r.out);
  assert.ok(isPng(path.join(out, '187-do-it.png')));
});

test('Oracle drawer: clicking "Dismiss" on a proposed card does not crash the app (#187, @issue-187)', { skip, timeout: 60000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'oracle', '--oracle', 'actions', '--click', '[data-oracle-dismiss="c2"]', '--wait', '1500', '--out', out, '--name', '187-dismiss'], 50000);
  assert.equal(r.code, 0, r.out);
  assert.ok(isPng(path.join(out, '187-dismiss.png')));
});

test('Oracle drawer: clicking "Undo" on a done, undoable card (after confirming) does not crash the app (#187, @issue-187)', { skip, timeout: 60000 }, async (t) => {
  const out = tmp(t);
  const r = await shoot(['--view', 'oracle', '--oracle', 'actions', '--click', '[data-oracle-undo="c3"]', '--click', '#btn-confirm-yes', '--wait', '1500', '--out', out, '--name', '187-undo'], 50000);
  assert.equal(r.code, 0, r.out);
  assert.ok(isPng(path.join(out, '187-undo.png')));
});
