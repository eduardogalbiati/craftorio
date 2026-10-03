// src/install-commands.js: the install commands offered by the Usage and Settings screens' play
// buttons (#147), per platform.
const test = require('node:test');
const assert = require('node:assert/strict');
const { installCommand, installCommands, installHint } = require('../src/install-commands');

test('installCommands: every CLI the orchestrator calls has a one-line installer on Windows and Linux, except Grok', () => {
  for (const platform of ['win32', 'linux']) {
    const cmds = installCommands(platform);
    for (const id of ['claude', 'codex', 'gh', 'glab', 'git']) {
      assert.ok(cmds[id] && cmds[id].length > 0, `${id} has no install command on ${platform}`);
    }
    assert.equal(cmds.grok, null);
  }
});

test('installCommands: whisper-cli only has a one-line installer on macOS', () => {
  assert.equal(installCommands('darwin')['whisper-cli'], 'brew install whisper-cpp');
  assert.equal(installCommands('win32')['whisper-cli'], null);
  assert.equal(installCommands('linux')['whisper-cli'], null);
});

test('installCommands: the Windows and POSIX commands for the same tool differ (winget vs brew, one PowerShell/curl installer)', () => {
  const win = installCommands('win32');
  const linux = installCommands('linux');
  assert.notEqual(win.gh, linux.gh);
  assert.notEqual(win.claude, linux.claude);
  assert.match(win.gh, /winget/);
  assert.match(linux.gh, /brew/);
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
