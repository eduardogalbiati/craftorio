// #649 (write-doc phase 3, R7): the evidence of a write-doc run in ANOTHER project, nobody running its
// app. packages/engine/engine/screenshot-step.js captures, in this order:
//   1. the project's own screenshot command: `npm run screenshot` (package.json) here, the `command:` of
//      `.multiagent/screenshot.yaml` elsewhere; "original" with `--ref <base>`, "modified" on the branch;
//   2. Run App: the local preview of `.multiagent/local-preview.yaml` + a headless browser
//      (captureScreenshots' `capturePreview` option, replaceable);
//   3. a manual attachment, asked for when neither exists.
// captureSource(dir) → { kind: 'command', command } | { kind: 'run-app', ... } | { kind: 'manual' }.
// The module is required inside each test so a missing export fails its test, never the file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../engine/screenshot-step');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, rel, text) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// another project: no package.json script, its own `.multiagent/screenshot.yaml`
function projectWithYaml(t) {
  const dir = tmpDir(t, 'proj-yaml-');
  write(dir, '.multiagent/screenshot.yaml', 'command: node tools/shoot.js\n');
  return dir;
}

function projectWithPreview(t) {
  const dir = tmpDir(t, 'proj-preview-');
  write(dir, '.multiagent/local-preview.yaml', 'command: npm start\nurl: http://localhost:5173\n');
  return dir;
}

const ONE_ENTRY = [{ name: '649-home', caption: 'The home page', args: ['--view', 'home'] }];

// a capture that writes the image it was asked for
const shoot = (calls) => async (opts) => {
  calls.push(opts);
  const arg = (name) => opts.args[opts.args.indexOf(name) + 1];
  fs.writeFileSync(path.join(arg('--out'), `${arg('--name')}.${arg('--side')}.png`), 'PNG');
  return { code: 0, output: '', timedOut: false };
};

// ---- screenshotCommand ------------------------------------------------------------------------------

test('screenshotCommand: a project without a package.json script uses the command of .multiagent/screenshot.yaml', (t) => {
  const { screenshotCommand } = load();
  assert.equal(screenshotCommand(projectWithYaml(t)), 'node tools/shoot.js');
});

test('screenshotCommand: an invalid .multiagent/screenshot.yaml or one without `command` is null, never a throw', (t) => {
  const { screenshotCommand } = load();
  const bad = tmpDir(t, 'proj-bad-');
  write(bad, '.multiagent/screenshot.yaml', 'command: [unclosed\n  : : :\n');
  assert.equal(screenshotCommand(bad), null);
  const empty = tmpDir(t, 'proj-nocmd-');
  write(empty, '.multiagent/screenshot.yaml', 'timeout: 30\n');
  assert.equal(screenshotCommand(empty), null);
});

test('screenshotCommand: a package.json-only project is still `npm run screenshot` (guard)', (t) => {
  const { screenshotCommand } = load();
  const dir = tmpDir(t, 'proj-pkg-');
  write(dir, 'package.json', JSON.stringify({ scripts: { screenshot: 'node scripts/screenshot.js' } }));
  assert.equal(screenshotCommand(dir), 'npm run screenshot');
});

// ---- captureScreenshots with the project's own command ----------------------------------------------

test('captureScreenshots: another project\'s .multiagent/screenshot.yaml command takes the before (--ref base) and the after, nobody running its app', async (t) => {
  const { captureScreenshots } = load();
  const cwd = projectWithYaml(t);
  const runDir = tmpDir(t, 'run-');
  const logFile = path.join(runDir, 'logs', 'screenshots.log');
  const calls = [];
  let announced = null;
  const out = await captureScreenshots({
    entries: ONE_ENTRY, cwd, runDir, folder: 'writer', round: 1, base: 'main', env: {}, mock: false,
    run: shoot(calls), logFile, onLog: (l) => { announced = l.command; },
  });
  assert.equal(out.taken, 2, out.message);
  assert.deepEqual(out.screenshots.map((s) => s.side).sort(), ['modified', 'original']);
  assert.equal(calls.length, 2);
  assert.equal(announced, 'node tools/shoot.js', 'the command run is the yaml one');
  // the spawned command lines, as the captures' log records them: `$ <command> -- <args>`
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('$ '));
  assert.equal(lines.length, 2);
  for (const l of lines) {
    assert.ok(l.startsWith('$ node tools/shoot.js'), `starts with the yaml command: ${l}`);
    assert.ok(!l.includes('npm run screenshot'), `not npm run screenshot: ${l}`);
  }
  const original = lines.find((l) => l.includes('--side original'));
  const modified = lines.find((l) => l.includes('--side modified'));
  assert.ok(original && original.includes('--ref main'), 'the before side carries --ref <base>');
  assert.ok(modified && !modified.includes('--ref'), 'the after side has no --ref');
  const originalCall = calls.find((c) => c.args.includes('original'));
  const modifiedCall = calls.find((c) => c.args.includes('modified'));
  assert.equal(originalCall.args[originalCall.args.indexOf('--ref') + 1], 'main');
  assert.equal(modifiedCall.args.includes('--ref'), false);
});

// ---- captureSource: the order of the fallbacks ------------------------------------------------------

test('captureSource: a screenshot command (yaml or package.json) comes first', (t) => {
  const { captureSource } = load();
  assert.equal(typeof captureSource, 'function', 'screenshot-step exports captureSource');
  const yamlOne = captureSource(projectWithYaml(t));
  assert.equal(yamlOne.kind, 'command');
  assert.equal(yamlOne.command, 'node tools/shoot.js');
  const pkg = tmpDir(t, 'proj-pkg-');
  write(pkg, 'package.json', JSON.stringify({ scripts: { screenshot: 'node s.js' } }));
  write(pkg, '.multiagent/local-preview.yaml', 'command: npm start\nurl: http://localhost:3000\n');
  const pkgOne = captureSource(pkg);
  assert.equal(pkgOne.kind, 'command', 'a command wins over a local preview');
  assert.equal(pkgOne.command, 'npm run screenshot');
});

test('captureSource: only a .multiagent/local-preview.yaml is Run App; nothing at all is a manual attachment', (t) => {
  const { captureSource } = load();
  assert.equal(typeof captureSource, 'function', 'screenshot-step exports captureSource');
  assert.equal(captureSource(projectWithPreview(t)).kind, 'run-app');
  assert.equal(captureSource(tmpDir(t, 'proj-none-')).kind, 'manual');
});

// ---- captureScreenshots through Run App -------------------------------------------------------------

test('captureScreenshots: without a screenshot command, Run App (capturePreview) takes both sides; only the before gets the base ref', async (t) => {
  const { captureScreenshots } = load();
  const cwd = projectWithPreview(t);
  const runDir = tmpDir(t, 'run-');
  const previews = [];
  const capturePreview = async ({ entry, side, ref, out, name }) => {
    previews.push({ entryName: entry?.name, side, ref: ref ?? null, name });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, 'PNG');
    return { path: out };
  };
  let ranCommand = false;
  const result = await captureScreenshots({
    entries: ONE_ENTRY, cwd, runDir, folder: 'writer', round: 1, base: 'main', env: {}, mock: false,
    capturePreview, run: async () => { ranCommand = true; return { code: 1, output: 'no command', timedOut: false }; },
  });
  assert.equal(ranCommand, false, 'no screenshot command is run');
  assert.equal(result.source, 'run-app');
  assert.equal(result.taken, 2, result.message);
  assert.deepEqual(result.screenshots.map((s) => s.side).sort(), ['modified', 'original']);
  assert.equal(previews.length, 2);
  assert.equal(previews.find((p) => p.side === 'original').ref, 'main');
  assert.equal(previews.find((p) => p.side === 'modified').ref, null);
});

test('captureScreenshots: every Run App capture of a step shares one session, released once at the end', async (t) => {
  const { captureScreenshots } = load();
  const cwd = projectWithPreview(t);
  const runDir = tmpDir(t, 'run-');
  const sessions = [];
  let released = 0;
  const capturePreview = async ({ out, session }) => {
    sessions.push(session);
    session.release = async () => { released++; };
    fs.writeFileSync(out, 'PNG');
  };
  const entries = [...ONE_ENTRY, { name: '649-settings', caption: 'Settings', args: ['--path', '/settings'] }];
  const result = await captureScreenshots({ entries, cwd, runDir, folder: 'writer', round: 1, base: 'main', env: {}, mock: false, capturePreview });
  assert.equal(result.taken, 4, result.message);
  assert.equal(sessions.length, 4);
  assert.equal(sessions.every((s) => s === sessions[0]), true, 'one session for the step');
  assert.equal(released, 1);
});

test('captureScreenshots: the Run App session is released even when the capture loop throws', async (t) => {
  const { captureScreenshots } = load();
  const cwd = projectWithPreview(t);
  const runDir = tmpDir(t, 'run-');
  let released = 0;
  const capturePreview = async ({ out, session }) => {
    session.release = async () => { released++; };
    fs.writeFileSync(out, 'PNG');
  };
  let logs = 0;
  // the second capture's log line throws, after the first capture made the session's worktree
  const log = () => { if (++logs === 2) throw new Error('log broke'); };
  await assert.rejects(
    captureScreenshots({ entries: ONE_ENTRY, cwd, runDir, folder: 'writer', round: 1, base: 'main', env: {}, mock: false, capturePreview, log }),
    /log broke/,
  );
  assert.equal(released, 1);
});

test('captureScreenshots: a Run App capture that fails is the side\'s error with its message, never a throw', async (t) => {
  const { captureScreenshots } = load();
  const cwd = projectWithPreview(t);
  const runDir = tmpDir(t, 'run-');
  const capturePreview = async ({ side, out }) => {
    if (side === 'original') throw new Error('port 5173 of http://localhost:5173 is already in use');
    fs.writeFileSync(out, 'PNG');
  };
  const result = await captureScreenshots({ entries: ONE_ENTRY, cwd, runDir, folder: 'writer', round: 1, base: 'main', env: {}, mock: false, capturePreview });
  assert.equal(result.taken, 1);
  assert.deepEqual(result.errors.map((e) => e.side), ['original']);
  assert.match(result.errors[0].error, /already in use/);
});

// ---- the yaml command, really run: the arguments reach it unchanged ---------------------------------

test('captureScreenshots: the yaml command gets every argument unchanged through the shell (spaces, quotes, %, &, ^, !, |, <>)', async (t) => {
  const { captureScreenshots } = load();
  const cwd = tmpDir(t, 'proj-real-');
  const seen = path.join(cwd, 'argv.json');
  // shoot.js records its arguments and writes the image the step asks for
  write(cwd, 'shoot.js', [
    "const fs = require('fs'); const path = require('path');",
    'const a = process.argv.slice(2); const v = (n) => a[a.indexOf(n) + 1];',
    `fs.appendFileSync(${JSON.stringify(seen)}, JSON.stringify(a) + '\\n');`,
    "fs.writeFileSync(path.join(v('--out'), v('--name') + '.' + v('--side') + '.png'), 'PNG');",
  ].join('\n'));
  write(cwd, '.multiagent/screenshot.yaml', `command: ${JSON.stringify(`"${process.execPath}" shoot.js`)}\n`);
  const runDir = tmpDir(t, 'run-');
  const odd = ['--view', 'two words', 'say "hi"', '100%', '%PATH%', 'x & echo injected', 'a^b', '!bang!', 'a|b', 'a<b>c'];
  const slot = async () => ({ token: 'test', release() {} });
  const result = await captureScreenshots({
    entries: [{ name: '649-odd', caption: 'Odd args', args: odd }], cwd, runDir, folder: 'writer', round: 1, env: process.env, mock: false, slot, timeoutMs: 60000,
  });
  assert.equal(result.source, 'command');
  assert.equal(result.taken, 1, result.message);
  const got = fs.readFileSync(seen, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(got.length, 1, 'the command ran once and nothing else was injected');
  // `<command> -- <args>`: node hands the `--` after the script to it
  const args = got[0][0] === '--' ? got[0].slice(1) : got[0];
  assert.deepEqual(args.slice(0, odd.length), odd);
});

// ---- the manual fallback ----------------------------------------------------------------------------

test('captureScreenshots: no command and no local preview asks for a manual attachment (no throw, nothing taken)', async (t) => {
  const { captureScreenshots } = load();
  const cwd = tmpDir(t, 'proj-none-');
  const runDir = tmpDir(t, 'run-');
  const result = await captureScreenshots({ entries: ONE_ENTRY, cwd, runDir, folder: 'writer', round: 1, base: 'main', env: {}, mock: false });
  assert.equal(result.taken, 0);
  assert.equal(result.source, 'manual');
  assert.match(`${result.reason || ''} ${result.message || ''}`, /attach/i);
});
