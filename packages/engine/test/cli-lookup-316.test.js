// packages/engine/engine/providers.js resolveCommand on macOS and Linux (#316): a real lookup of an executable
// file on the PATH plus the known install folders, `null` when nothing is found (the Windows
// contract), and the login shell's PATH merged into process.env.PATH once per process.
//
// Each case runs in its own Node process: the login-shell merge happens once per process, and the
// platform is faked there ('linux') so the lookup is also checked on a Windows machine. The cases
// that need a real executable bit or a shell script (#!/bin/sh) only run on macOS and Linux.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PROVIDERS = path.join(__dirname, '..', 'engine', 'providers.js');
const POSIX = process.platform !== 'win32';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-lookup-316-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// An executable fake CLI (a POSIX script; on Windows only its presence counts).
function fakeCli(dir, name, mode = 0o755) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/sh\necho fake\n');
  fs.chmodSync(file, mode);
  return file;
}

// A fake login shell running `body` (named `name`: the lookup treats a shell named fish apart).
function fakeShell(dir, body, name = 'fake-shell.sh') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

// Runs resolveCommand(name) for each name in a fresh Node process with the given environment;
// returns { results, path, ms } (results: what resolveCommand returned, per name; path: the
// PATH afterwards; ms: how long the lookups took).
function lookup({ names, env, platform = 'linux' }) {
  const script = `
    Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
    const { resolveCommand } = require(${JSON.stringify(PROVIDERS)});
    const t0 = Date.now();
    const results = ${JSON.stringify(names)}.map((n) => resolveCommand(n));
    process.stdout.write('\\n@@' + JSON.stringify({ results, path: process.env.PATH, ms: Date.now() - t0 }));
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, MULTIAGENT_SIMULATION_ONLY: '1', ...env },
    encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  return JSON.parse(out.slice(out.lastIndexOf('\n@@') + 3));
}

// An isolated home (no ~/.local/bin etc.) and a shell that does not exist, so only what the
// test puts on PATH or in the home can be found.
function baseEnv(home, PATH) {
  return { HOME: home, USERPROFILE: home, PATH, SHELL: path.join(home, 'no-such-shell') };
}

test('resolveCommand (macOS/Linux): a CLI in a PATH folder resolves to its absolute path, without a shell', (t) => {
  const dir = tmp(t);
  const bin = path.join(dir, 'bin');
  const file = fakeCli(bin, 'fakecli-316');
  const { results } = lookup({ names: ['fakecli-316'], env: baseEnv(path.join(dir, 'home'), bin) });
  assert.deepEqual(results[0], { file, shell: false });
});

test('resolveCommand (macOS/Linux): a name found nowhere returns null', (t) => {
  const dir = tmp(t);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const { results } = lookup({ names: ['no-such-cli-316'], env: baseEnv(path.join(dir, 'home'), bin) });
  assert.equal(results[0], null);
});

test('resolveCommand (macOS/Linux): a directory with the CLI\'s name is not a CLI', (t) => {
  const dir = tmp(t);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(path.join(bin, 'dircli-316'), { recursive: true });
  const { results } = lookup({ names: ['dircli-316'], env: baseEnv(path.join(dir, 'home'), bin) });
  assert.equal(results[0], null);
});

test('resolveCommand (macOS/Linux): the first PATH folder that has the CLI wins', (t) => {
  const dir = tmp(t);
  const a = path.join(dir, 'a');
  const b = path.join(dir, 'b');
  fs.mkdirSync(a);
  const second = fakeCli(b, 'twice-316');
  const first = fakeCli(path.join(dir, 'c'), 'twice-316');
  const PATH = [path.join(dir, 'c'), a, b].join(path.delimiter);
  const { results } = lookup({ names: ['twice-316'], env: baseEnv(path.join(dir, 'home'), PATH) });
  assert.equal(results[0].file, first);
  assert.notEqual(results[0].file, second);
});

test('resolveCommand (macOS/Linux): the known install folders are searched even when they are not on PATH (~/.local/bin for claude, ~/.grok/bin for grok, ~/.npm-global/bin for npm CLIs)', (t) => {
  const dir = tmp(t);
  const home = path.join(dir, 'home');
  const claude = fakeCli(path.join(home, '.local', 'bin'), 'claude-316');
  const grok = fakeCli(path.join(home, '.grok', 'bin'), 'grok-316');
  const codex = fakeCli(path.join(home, '.npm-global', 'bin'), 'codex-316');
  const empty = path.join(dir, 'empty');
  fs.mkdirSync(empty);
  const { results } = lookup({ names: ['claude-316', 'grok-316', 'codex-316'], env: baseEnv(home, empty) });
  assert.deepEqual(results, [
    { file: claude, shell: false },
    { file: grok, shell: false },
    { file: codex, shell: false },
  ]);
});

test('resolveCommand (macOS/Linux): a file without the executable bit is not a CLI', { skip: !POSIX && 'needs a real executable bit (macOS/Linux)' }, (t) => {
  const dir = tmp(t);
  const bin = path.join(dir, 'bin');
  fakeCli(bin, 'noexec-316', 0o644);
  const { results } = lookup({ names: ['noexec-316'], env: baseEnv(path.join(dir, 'home'), bin), platform: process.platform });
  assert.equal(results[0], null);
});

test('login shell PATH (macOS/Linux): a CLI only the login shell\'s PATH has is found, the PATH keeps its own folders, and the shell runs once per process', { skip: !POSIX && 'needs a POSIX shell script' }, (t) => {
  const dir = tmp(t);
  const loginBin = path.join(dir, 'login-bin');
  const file = fakeCli(loginBin, 'loginonly-316');
  const own = path.join(dir, 'own-bin');
  fs.mkdirSync(own);
  const calls = path.join(dir, 'calls.log');
  const shell = fakeShell(dir, `echo call >> '${calls}'\nprintf %s '${loginBin}:/usr/bin:/bin'`);
  const PATH = [own, '/usr/bin', '/bin'].join(':');
  const r = lookup({
    names: ['loginonly-316', 'loginonly-316', 'no-such-cli-316'],
    env: { HOME: path.join(dir, 'home'), PATH, SHELL: shell },
    platform: process.platform,
  });
  assert.deepEqual(r.results[0], { file, shell: false });
  assert.deepEqual(r.results[1], { file, shell: false });
  assert.equal(r.results[2], null);
  const entries = r.path.split(':');
  assert.ok(entries.includes(loginBin), `the login shell's folder was not merged: ${r.path}`);
  assert.ok(entries.includes(own), `the process's own PATH folder was dropped: ${r.path}`);
  assert.equal(fs.readFileSync(calls, 'utf8').trim().split('\n').length, 1);
});

for (const [what, body] of [
  ['fails', 'echo "broken profile" >&2\nexit 3'],
  ['prints noise instead of a PATH', 'echo "Welcome to the machine!"\necho "Last login: today"'],
]) {
  test(`login shell PATH (macOS/Linux): a login shell that ${what} leaves the PATH's folders as they were, and the lookup still works`, { skip: !POSIX && 'needs a POSIX shell script' }, (t) => {
    const dir = tmp(t);
    const own = path.join(dir, 'own-bin');
    const file = fakeCli(own, 'owncli-316');
    const shell = fakeShell(dir, body);
    const PATH = [own, '/usr/bin', '/bin'].join(':');
    const r = lookup({ names: ['owncli-316'], env: { HOME: path.join(dir, 'home'), PATH, SHELL: shell }, platform: process.platform });
    assert.deepEqual(r.results[0], { file, shell: false });
    const entries = r.path.split(':').filter(Boolean);
    for (const p of [own, '/usr/bin', '/bin']) assert.ok(entries.includes(p), `${p} was dropped from PATH: ${r.path}`);
    for (const p of entries) assert.ok(path.isAbsolute(p), `a non-folder entry "${p}" was merged into PATH`);
  });
}

// A caller: Settings › Agents & CLIs on Linux, with none of the CLIs installed, reports each as not
// installed (no path) with its install hint, instead of a path that fails later with ENOENT.
// Claude Code and Grok Build are checked (never preinstalled in /usr/local/bin on a CI machine).
test('Settings › Agents & CLIs (Linux): a CLI that is not installed shows no path and its install hint', (t) => {
  const dir = tmp(t);
  const empty = path.join(dir, 'empty');
  fs.mkdirSync(empty);
  const area = path.join(__dirname, '..', 'service', 'areas', 'settings.js');
  const script = `
    Object.defineProperty(process, 'platform', { value: 'linux' });
    require(${JSON.stringify(area)})().envDetails().then((list) => {
      process.stdout.write('\\n@@' + JSON.stringify(list));
    }, (e) => { process.stdout.write('\\n@@' + JSON.stringify({ error: e.message })); });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, MULTIAGENT_SIMULATION_ONLY: '1', ...baseEnv(path.join(dir, 'home'), empty) },
    encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  const list = JSON.parse(out.slice(out.lastIndexOf('\n@@') + 3));
  assert.equal(list.error, undefined);
  for (const id of ['claude', 'grok']) {
    const tool = list.find((x) => x.id === id);
    assert.equal(tool.path, null, `${id} reported at ${tool.path}`);
    assert.equal(tool.connected, false);
    assert.ok(tool.installHint, `${id} has no install hint`);
  }
});

test('login shell PATH (macOS/Linux): a login shell that hangs is given up after a few seconds', { skip: !POSIX && 'needs a POSIX shell script' }, (t) => {
  const dir = tmp(t);
  const own = path.join(dir, 'own-bin');
  const file = fakeCli(own, 'owncli-316');
  const shell = fakeShell(dir, 'sleep 30');
  const PATH = [own, '/usr/bin', '/bin'].join(':');
  const r = lookup({ names: ['owncli-316'], env: { HOME: path.join(dir, 'home'), PATH, SHELL: shell }, platform: process.platform });
  assert.deepEqual(r.results[0], { file, shell: false });
  assert.ok(r.ms < 10000, `the lookup waited ${r.ms} ms for a hanging login shell`);
  const entries = r.path.split(':');
  for (const p of [own, '/usr/bin', '/bin']) assert.ok(entries.includes(p), `${p} was dropped from PATH: ${r.path}`);
});

// An interactive bash or zsh ignores SIGTERM: the hanging login shell must still be stopped at
// the timeout (a plain sh script, as in the test above, would die on SIGTERM alone).
test('login shell PATH (macOS/Linux): a hanging login shell that ignores SIGTERM is still given up after a few seconds, and PATH is unchanged', { skip: !POSIX && 'needs a POSIX shell script' }, (t) => {
  const dir = tmp(t);
  const own = path.join(dir, 'own-bin');
  const file = fakeCli(own, 'owncli-316');
  const shell = fakeShell(dir, 'trap "" TERM\nsleep 30');
  const PATH = [own, '/usr/bin', '/bin'].join(':');
  const r = lookup({ names: ['owncli-316'], env: { HOME: path.join(dir, 'home'), PATH, SHELL: shell }, platform: process.platform });
  assert.deepEqual(r.results[0], { file, shell: false });
  assert.ok(r.ms < 8000, `the lookup waited ${r.ms} ms for a login shell that ignores SIGTERM`);
  assert.equal(r.path, PATH);
});

// fish expands "$PATH" to its entries joined with spaces. The fake fish below stands in for it: it
// runs the command it is given with sh, after expanding "$PATH" the way fish does (spaces) and
// `(string join : $PATH)` to the colon-joined list.
test('login shell PATH (macOS/Linux): with fish as the login shell, every folder of its PATH is merged (not one space-joined entry)', { skip: !POSIX && 'needs a POSIX shell script' }, (t) => {
  const dir = tmp(t);
  const first = path.join(dir, 'fish-a');
  fs.mkdirSync(first);
  const second = path.join(dir, 'fish-b');
  const file = fakeCli(second, 'fishonly-316');
  const body = [
    'case "$2" in',
    `  *"string join"*) list='${first}:${second}:/usr/bin:/bin' ;;`,
    `  *) list='${first} ${second} /usr/bin /bin' ;;`,
    'esac',
    `cmd=$(printf %s "$2" | sed -e "s#(string join : \\$PATH)#'$list'#" -e "s#\\"\\$PATH\\"#'$list'#")`,
    'exec /bin/sh -c "$cmd"',
  ].join('\n');
  const shell = fakeShell(dir, body, 'fish');
  const own = path.join(dir, 'own-bin');
  fs.mkdirSync(own);
  const PATH = [own, '/usr/bin', '/bin'].join(':');
  const r = lookup({ names: ['fishonly-316'], env: { HOME: path.join(dir, 'home'), PATH, SHELL: shell }, platform: process.platform });
  assert.deepEqual(r.results[0], { file, shell: false });
  const entries = r.path.split(':');
  for (const p of [first, second, own]) assert.ok(entries.includes(p), `${p} missing from PATH: ${r.path}`);
});
