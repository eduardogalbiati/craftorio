// packages/engine/engine/screenshot-step.js (#144): the `type: screenshots` step's captureScreenshots, run once
// per entry of an earlier step's `screenshots` output, modified (the worktree) then original
// (--ref base), into <run_dir>/evidence/<folder>/round-<n>/. It never throws: every outcome (no
// entries, a bad entry, a simulated run, a missing command, a timeout, an invalid option, a missing
// image) ends up in the returned object.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { captureScreenshots, checkEntry, splitArgs } = require('../engine/screenshot-step');
const { acquireSlot, SCREENSHOT_SLOT_ENV } = require('../engine/machine-slot');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A worktree with a "screenshot" script in package.json (screenshotCommand() looks for it).
function worktreeWithCommand(t) {
  const dir = tmpDir(t, 'wt-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { screenshot: 'node scripts/screenshot.js' } }));
  return dir;
}

const ONE_ENTRY = [{ name: '144-dashboard-default', caption: 'The dashboard', args: ['--view', 'dashboard'] }];

// ---- checkEntry / splitArgs (used by captureScreenshots to validate the developer's list) -----

test('checkEntry: a plain entry is valid; a reserved option, a bad name and args of the wrong type are rejected', () => {
  assert.deepEqual(checkEntry({ name: '144-dashboard-default', caption: 'The dashboard', args: ['--view', 'dashboard'] }, 0),
    { name: '144-dashboard-default', caption: 'The dashboard', args: ['--view', 'dashboard'] });
  assert.match(checkEntry({ name: '144-dashboard-default', args: ['--out', '/tmp/x'] }, 0).error, /--out is set by the step/);
  assert.match(checkEntry({ name: 'not a plain name!', args: [] }, 0).error, /name must be a plain file name/);
  assert.match(checkEntry({ name: 'x', args: 42 }, 0).error, /args must be a list/);
  assert.match(checkEntry('not an object', 0).error, /not an object/);
});

test('splitArgs: a quoted string splits like a shell command line; a list of strings passes through unchanged', () => {
  assert.deepEqual(splitArgs('--view run --click "[data-x] .y"'), ['--view', 'run', '--click', '[data-x] .y']);
  assert.deepEqual(splitArgs(['--view', 'run']), ['--view', 'run']);
  assert.deepEqual(splitArgs(null), []);
  assert.equal(splitArgs(5), null);
});

// ---- captureScreenshots: outcomes that never need a real command ------------------------------

test('captureScreenshots: no entries skips the capture with the "no screens" reason', async () => {
  const out = await captureScreenshots({ entries: [], cwd: '/x', runDir: '/x', folder: 'developer', round: 1, mock: false });
  assert.equal(out.taken, 0);
  assert.equal(out.reason, 'the developer listed no screens (a change without UI)');
  assert.equal(out.message, 'No screenshots: the developer listed no screens (a change without UI)');
});

test('captureScreenshots: a simulated run never calls the screenshot command, even with a valid list', async () => {
  let called = false;
  const out = await captureScreenshots({ entries: ONE_ENTRY, cwd: '/x', runDir: '/x', folder: 'developer', round: 1, mock: true, run: async () => { called = true; return { code: 0, output: '', timedOut: false }; } });
  assert.equal(called, false);
  assert.equal(out.taken, 0);
  assert.equal(out.reason, 'simulated run (the app is not captured)');
});

test('captureScreenshots: every entry invalid reports "no valid entry" with the per-entry errors', async () => {
  const out = await captureScreenshots({
    entries: [{ name: 'bad name!', args: [] }, { name: 'x', args: ['--ref', 'main'] }],
    cwd: '/x', runDir: '/x', folder: 'developer', round: 1, mock: false,
  });
  assert.equal(out.taken, 0);
  assert.equal(out.reason, 'no valid entry in the developer\'s list');
  assert.equal(out.errors.length, 2);
});

// ---- captureScreenshots: a real capture, with an injected run() -------------------------------

function captureOpts(t, overrides = {}) {
  const cwd = worktreeWithCommand(t);
  const runDir = tmpDir(t, 'run-');
  return { entries: ONE_ENTRY, cwd, runDir, folder: 'developer', round: 1, base: 'main', env: {}, mock: false, ...overrides };
}

test('captureScreenshots: exit 2 (an invalid option) fails the modified side and never tries the original one', async (t) => {
  const calls = [];
  const run = async (opts) => { calls.push(opts.args); return { code: 2, output: 'error: unknown option --bogus', timedOut: false }; };
  const out = await captureScreenshots(captureOpts(t, { run }));
  assert.equal(calls.length, 1, 'the original side is never attempted after exit 2');
  assert.equal(out.taken, 0);
  assert.equal(out.screens, 0);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].side, 'modified');
  assert.match(out.errors[0].error, /exit 2: error: unknown option --bogus/);
  assert.match(out.reason, /every capture failed/);
});

test('captureScreenshots: each capture\'s process is handed to onSpawn, so the memory guard watches it (#276)', async (t) => {
  let next = 4321;
  const run = async (opts) => {
    opts.onSpawn?.(next++);
    const arg = (name) => opts.args[opts.args.indexOf(name) + 1];
    fs.writeFileSync(path.join(arg('--out'), `${arg('--name')}.${arg('--side')}.png`), 'png');
    return { code: 0, output: '', timedOut: false };
  };
  const spawned = [];
  await captureScreenshots(captureOpts(t, { run, onSpawn: (pid) => spawned.push(pid) }));
  assert.deepEqual(spawned, [4321, 4322], 'the modified and the original captures');
});

test('captureScreenshots: a timed out command is reported with the timeout, in seconds', async (t) => {
  const run = async () => { await new Promise((r) => setTimeout(r, 1)); return { code: null, output: '', timedOut: true }; };
  const out = await captureScreenshots(captureOpts(t, { run, base: null, timeoutMs: 5000 }));
  assert.equal(out.taken, 0);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].side, 'modified');
  assert.equal(out.errors[0].error, 'timed out after 5 s');
});

test('captureScreenshots: exit 0 without the expected image file on disk is "the command wrote no image"', async (t) => {
  const run = async () => ({ code: 0, output: '', timedOut: false }); // the stub never creates the file
  const out = await captureScreenshots(captureOpts(t, { run, base: null }));
  assert.equal(out.taken, 0);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].error, 'the command wrote no image');
});

test('captureScreenshots: a successful command that writes the image is counted taken, with its side and duration', async (t) => {
  const opts = captureOpts(t, { base: null });
  const run = async ({ cwd: _cwd, args }) => {
    const out = args[args.indexOf('--out') + 1];
    const name = args[args.indexOf('--name') + 1];
    const side = args[args.indexOf('--side') + 1];
    fs.writeFileSync(path.join(out, `${name}.${side}.png`), 'PNG');
    return { code: 0, output: '', timedOut: false };
  };
  const out = await captureScreenshots({ ...opts, run });
  assert.equal(out.taken, 1);
  assert.equal(out.screens, 1);
  assert.deepEqual(out.errors, []);
  assert.equal(out.screenshots[0].side, 'modified');
  assert.equal(out.screenshots[0].caption, 'The dashboard');
  assert.ok(Number.isInteger(out.screenshots[0].duration_ms));
  assert.match(out.message, /1 screenshot of 1 screen taken in round 1/);
});

// ---- captureScreenshots: the machine-wide screenshot slot (#199) -----------------------------

test('captureScreenshots: takes the slot, gives its token to run via MULTIAGENT_SCREENSHOT_SLOT, and releases it', async (t) => {
  let released = false;
  let seenName;
  const slot = async (name) => { seenName = name; return { token: 'tok-123', release: () => { released = true; } }; };
  let seenToken;
  const run = async ({ env }) => { seenToken = env[SCREENSHOT_SLOT_ENV]; return { code: 0, output: '', timedOut: false }; };
  await captureScreenshots(captureOpts(t, { base: null, run, slot }));
  assert.equal(seenName, 'screenshot');
  assert.equal(seenToken, 'tok-123');
  assert.equal(released, true);
});

test('captureScreenshots: a slot that cannot be acquired reports the wait as the capture\'s own error', async (t) => {
  const slot = async () => { throw new Error('the screenshot slot is still held by pid 42 after 1200 s'); };
  const out = await captureScreenshots(captureOpts(t, { base: null, slot }));
  assert.equal(out.taken, 0);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0].error, /waiting for the screenshot slot: the screenshot slot is still held by pid 42/);
});

test('captureScreenshots: two captures competing for the same machine-wide slot never run at the same time; the second waits', async (t) => {
  const locksDir = tmpDir(t, 'locks-');
  const slot = (name, opts) => acquireSlot(name, { ...opts, dir: locksDir });
  const order = [];
  const run = async ({ args }) => {
    const name = args[args.indexOf('--name') + 1];
    order.push(`start:${name}`);
    await new Promise((r) => setTimeout(r, 50));
    order.push(`end:${name}`);
    return { code: 0, output: '', timedOut: false };
  };
  let waited = false;
  const onSlotWait = () => { waited = true; };
  const optsA = captureOpts(t, { base: null, run, slot, onSlotWait, entries: [{ name: 'a-shot', args: [] }] });
  const optsB = captureOpts(t, { base: null, run, slot, onSlotWait, entries: [{ name: 'b-shot', args: [] }] });
  await Promise.all([captureScreenshots(optsA), captureScreenshots(optsB)]);
  assert.equal(waited, true);
  const aStart = order.indexOf('start:a-shot');
  const aEnd = order.indexOf('end:a-shot');
  const bStart = order.indexOf('start:b-shot');
  const bEnd = order.indexOf('end:b-shot');
  assert.ok(aEnd < bStart || bEnd < aStart, `expected no interleaving, got ${order.join(',')}`);
});
