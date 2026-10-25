// packages/engine/domains/machine/install-commands.js: the install commands offered by the Usage and Settings screens' play
// buttons (#147), per platform. On macOS the Homebrew commands depend on Homebrew being installed
// (#398): the tests pass `{ brew }` to make that machine-independent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { installCommand, installCommands, installHint } = require('../../domains/machine/install-commands');

const WITH_BREW = { brew: true };
const NO_BREW = { brew: false };

test('installCommands: every CLI the orchestrator calls has a one-line installer on Windows and on macOS with Homebrew, except Grok', () => {
  for (const platform of ['win32', 'darwin']) {
    const cmds = installCommands(platform, WITH_BREW);
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

test('installCommands (macOS with Homebrew): gh, git and glab still install with Homebrew', () => {
  const mac = installCommands('darwin', WITH_BREW);
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

test('installCommands: whisper-cli only has a one-line installer on macOS with Homebrew', () => {
  assert.equal(installCommands('darwin', WITH_BREW)['whisper-cli'], 'brew install whisper-cpp');
  assert.equal(installCommands('win32')['whisper-cli'], null);
  assert.equal(installCommands('linux')['whisper-cli'], null);
});

test('installCommands: the Windows and macOS commands for the same tool differ (winget vs brew, one PowerShell/curl installer)', () => {
  const win = installCommands('win32');
  const mac = installCommands('darwin', WITH_BREW);
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

// #398 (acceptance tests, written before the code): on a Mac without Homebrew no command or hint is
// a brew command; gh, glab and whisper-cli get prose naming Homebrew (https://brew.sh) and the
// official alternative where one exists; git installs with Apple's Command Line Tools.
test('installCommands (macOS without Homebrew, #398): no install command uses brew', () => {
  for (const [id, cmd] of Object.entries(installCommands('darwin', NO_BREW))) {
    if (cmd) assert.doesNotMatch(cmd, /\bbrew\b/, `${id}: ${cmd}`);
  }
});

test('installHint (macOS without Homebrew, #398): no hint is a brew install command', () => {
  for (const id of ['claude', 'codex', 'gh', 'glab', 'git', 'grok', 'whisper-cli']) {
    const hint = installHint(id, 'darwin', NO_BREW);
    assert.ok(hint && hint.length > 0, `${id} has no install hint on a Mac without Homebrew`);
    assert.doesNotMatch(hint, /\bbrew install\b/, `${id}: ${hint}`);
  }
});

test('installHint (macOS without Homebrew, #398): gh has no command, and its prose names Homebrew and the installer from cli.github.com', () => {
  assert.equal(installCommand('gh', 'darwin', NO_BREW), null);
  const hint = installHint('gh', 'darwin', NO_BREW);
  assert.match(hint, /Homebrew/);
  assert.match(hint, /https:\/\/brew\.sh/);
  assert.match(hint, /https:\/\/cli\.github\.com/);
});

test('installHint (macOS without Homebrew, #398): glab has no command, and its prose names Homebrew and the GitLab CLI releases page', () => {
  assert.equal(installCommand('glab', 'darwin', NO_BREW), null);
  const hint = installHint('glab', 'darwin', NO_BREW);
  assert.match(hint, /Homebrew/);
  assert.match(hint, /https:\/\/brew\.sh/);
  assert.match(hint, /gitlab\.com\/gitlab-org\/cli\/-\/releases/);
});

test('installCommand (macOS without Homebrew, #398): git installs with Apple\'s Command Line Tools (xcode-select --install)', () => {
  assert.equal(installCommand('git', 'darwin', NO_BREW), 'xcode-select --install');
  assert.equal(installHint('git', 'darwin', NO_BREW), 'xcode-select --install');
});

test('installHint (macOS without Homebrew, #398): whisper-cli has no command, and its prose says it needs Homebrew', () => {
  assert.equal(installCommand('whisper-cli', 'darwin', NO_BREW), null);
  const hint = installHint('whisper-cli', 'darwin', NO_BREW);
  assert.match(hint, /Homebrew/);
  assert.match(hint, /https:\/\/brew\.sh/);
});

test('installCommands (macOS without Homebrew, #398): Claude Code and Codex keep their installers (they do not need Homebrew)', () => {
  const mac = installCommands('darwin', NO_BREW);
  assert.equal(mac.claude, 'curl -fsSL https://claude.ai/install.sh | bash');
  assert.equal(mac.codex, 'npm install -g @openai/codex');
});

test('installCommands (#398): the Homebrew flag changes nothing on Linux and Windows', () => {
  for (const platform of ['linux', 'win32']) {
    assert.deepEqual(installCommands(platform, WITH_BREW), installCommands(platform, NO_BREW), platform);
    assert.deepEqual(installCommands(platform, WITH_BREW), installCommands(platform), platform);
  }
  for (const cmd of Object.values(installCommands('linux', WITH_BREW))) {
    if (cmd) assert.doesNotMatch(cmd, /\bbrew\b/);
  }
});

// #401: install-commands.js is a utility and never looks Homebrew up itself; a call without `brew`
// asks the lookup the engine registers (setBrewLookup), else assumes no Homebrew. This file does not
// load the engine, so no lookup is registered unless a test sets one (and resets it).
const { setBrewLookup } = require('../../domains/machine/install-commands');

function withLookup(t, answer) {
  const asked = [];
  setBrewLookup(() => { asked.push(true); return answer; });
  t.after(() => setBrewLookup(null));
  return asked;
}

test('installCommands (#401): without a registered lookup and without `brew`, macOS gets no brew command', () => {
  setBrewLookup(null);
  const mac = installCommands('darwin');
  assert.equal(mac.gh, null);
  assert.equal(mac.git, 'xcode-select --install');
  assert.equal(installHint('gh', 'darwin'), installHint('gh', 'darwin', NO_BREW));
});

test('installCommands (#401): a call without `brew` follows the registered lookup on macOS', (t) => {
  withLookup(t, true);
  assert.equal(installCommand('gh', 'darwin'), 'brew install gh');
  assert.equal(installHint('whisper-cli', 'darwin'), 'brew install whisper-cpp');
  setBrewLookup(() => false);
  assert.equal(installCommand('gh', 'darwin'), null);
  assert.equal(installHint('gh', 'darwin'), installHint('gh', 'darwin', NO_BREW));
});

test('installCommands (#401): an explicit `brew` wins over the registered lookup', (t) => {
  withLookup(t, true);
  assert.equal(installCommand('gh', 'darwin', NO_BREW), null);
  setBrewLookup(() => false);
  assert.equal(installCommand('gh', 'darwin', WITH_BREW), 'brew install gh');
});

test('installCommand (#401): tools that never install with Homebrew do not consult the lookup', (t) => {
  const asked = withLookup(t, true);
  for (const id of ['claude', 'codex', 'grok']) installCommand(id, 'darwin');
  assert.equal(asked.length, 0);
});

test('installCommands (#401): a registered lookup that says yes changes nothing on Linux and Windows', (t) => {
  withLookup(t, true);
  for (const platform of ['linux', 'win32']) assert.deepEqual(installCommands(platform), installCommands(platform, NO_BREW), platform);
});
