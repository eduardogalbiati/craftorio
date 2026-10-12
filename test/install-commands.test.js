// src/install-commands.js: the install commands offered by the Usage and Settings screens' play
// buttons (#147), per platform.
const test = require('node:test');
const assert = require('node:assert/strict');
const { installCommand, installCommands, installHint } = require('../src/install-commands');

test('installCommands: every CLI the orchestrator calls has a one-line installer on Windows and macOS, except Grok', () => {
  for (const platform of ['win32', 'darwin']) {
    const cmds = installCommands(platform);
    for (const id of ['claude', 'codex', 'gh', 'glab', 'git']) {
      assert.ok(cmds[id] && cmds[id].length > 0, `${id} has no install command on ${platform}`);
    }
    assert.equal(cmds.grok, null);
  }
});

// #316: Linux gets real commands (the distro package, the official install script) or short prose,
// never Homebrew's; macOS keeps brew; Windows is unchanged.
test('installHint (Linux): every CLI the orchestrator calls has a hint, and none of them is a brew command', () => {
  for (const id of ['claude', 'codex', 'gh', 'glab', 'git', 'grok']) {
    const hint = installHint(id, 'linux');
    assert.ok(hint && hint.length > 0, `${id} has no install hint on Linux`);
    assert.doesNotMatch(hint, /\bbrew\b/, `${id} suggests Homebrew on Linux: ${hint}`);
  }
});

test('installCommands (Linux): no install command is a brew command', () => {
  for (const [id, cmd] of Object.entries(installCommands('linux'))) {
    if (cmd) assert.doesNotMatch(cmd, /\bbrew\b/, `${id}: ${cmd}`);
  }
});

test('installCommands (macOS): gh, git and glab still install with Homebrew', () => {
  const mac = installCommands('darwin');
  assert.equal(mac.gh, 'brew install gh');
  assert.equal(mac.git, 'brew install git');
  assert.equal(mac.glab, 'brew install glab');
});

test('installCommands (Windows): unchanged winget and PowerShell commands', () => {
  const win = installCommands('win32');
  assert.equal(win.claude, 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"');
  assert.equal(win.codex, 'npm install -g @openai/codex');
  assert.equal(win.gh, 'winget install --id GitHub.cli -e');
  assert.equal(win.git, 'winget install --id Git.Git -e');
  assert.equal(win.glab, 'winget install --id GLab.GLab -e');
});

test('installCommands: whisper-cli only has a one-line installer on macOS', () => {
  assert.equal(installCommands('darwin')['whisper-cli'], 'brew install whisper-cpp');
  assert.equal(installCommands('win32')['whisper-cli'], null);
  assert.equal(installCommands('linux')['whisper-cli'], null);
});

test('installCommands: the Windows and macOS commands for the same tool differ (winget vs brew, one PowerShell/curl installer)', () => {
  const win = installCommands('win32');
  const mac = installCommands('darwin');
  assert.notEqual(win.gh, mac.gh);
  assert.notEqual(win.claude, mac.claude);
  assert.match(win.gh, /winget/);
  assert.match(mac.gh, /brew/);
});

test('installCommand: the command for a known tool, or null for one with no one-line installer', () => {
  assert.equal(installCommand('gh', 'win32'), 'winget install --id GitHub.cli -e');
  assert.equal(installCommand('grok', 'win32'), null);
});

test('installCommand: an unknown id returns null instead of throwing', () => {
  assert.equal(installCommand('not-a-real-tool', 'win32'), null);
});

test('installHint: Grok (no installer) falls back to the prose that explains where it lands', () => {
  assert.match(installHint('grok', 'win32'), /install Grok Build from x\.ai/);
});

test('installHint: a tool with an installer returns the command itself, not the prose', () => {
  assert.equal(installHint('gh', 'win32'), installCommand('gh', 'win32'));
});

test('installHint: an unknown id (no command, no prose) returns null', () => {
  assert.equal(installHint('not-a-real-tool', 'win32'), null);
});
