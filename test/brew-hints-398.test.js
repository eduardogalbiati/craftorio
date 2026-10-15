// #398 (acceptance tests, written before the code): on macOS the screens that show install hints
// (the first-run Setup and Settings › Agents & CLIs through the settings area's envDetails,
// Settings › General › Voice input through src/speech.js status) offer a brew command only when
// `brew` resolves, and otherwise all show the same Homebrew-free hint as src/install-commands.js.
//
// Each case runs in its own Node process with the platform faked ('darwin'), an isolated home and a
// PATH of scratch folders, so Homebrew's presence is decided by the test (a fake `brew` on PATH or
// none). On a real Mac whose Homebrew sits in /opt/homebrew/bin or /usr/local/bin (always searched)
// the "without Homebrew" case cannot be set up and is skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC = path.join(__dirname, '..', 'src');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-hints-398-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// What each screen gets on a faked Mac: { brew (resolveCommand('brew') found it), tools (envDetails),
// voice (speech.status), hints (installHint/installCommand for the same machine, by default) }.
function screens(dir, PATH) {
  const script = `
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { resolveCommand } = require(${JSON.stringify(path.join(SRC, 'engine', 'providers.js'))});
    const speech = require(${JSON.stringify(path.join(SRC, 'speech.js'))});
    const ic = require(${JSON.stringify(path.join(SRC, 'install-commands.js'))});
    const settings = require(${JSON.stringify(path.join(SRC, 'service', 'areas', 'settings.js'))});
    const brew = !!resolveCommand('brew');
    const voice = speech.status({}, ${JSON.stringify(path.join(dir, 'data'))});
    const hints = {};
    for (const id of ['gh', 'git', 'glab', 'whisper-cli']) hints[id] = { command: ic.installCommand(id), hint: ic.installHint(id) };
    settings().envDetails().then((tools) => {
      process.stdout.write('\\n@@' + JSON.stringify({ brew, tools, voice: { installHint: voice.installHint, installCommand: voice.installCommand }, hints }));
    }, (e) => { process.stdout.write('\\n@@' + JSON.stringify({ error: e.message })); });
  `;
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, MULTIAGENT_SIMULATION_ONLY: '1', HOME: home, USERPROFILE: home, PATH, SHELL: path.join(home, 'no-such-shell') },
    encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  const r = JSON.parse(out.slice(out.lastIndexOf('\n@@') + 3));
  assert.equal(r.error, undefined, r.error);
  return r;
}

const tool = (r, id) => r.tools.find((x) => x.id === id);

test('Setup and Settings on a Mac without Homebrew (#398): no brew command; gh and glab show prose naming https://brew.sh, git offers xcode-select --install, the same as installHint', (t) => {
  const dir = tmp(t);
  const empty = path.join(dir, 'empty');
  fs.mkdirSync(empty);
  const r = screens(dir, empty);
  if (r.brew) return t.skip('Homebrew is installed in a folder the lookup always searches');
  for (const id of ['gh', 'glab']) {
    const x = tool(r, id);
    assert.equal(x.path, null, `${id} found at ${x.path}`);
    assert.equal(x.installCommand, null, `${id}: ${x.installCommand}`);
    assert.match(x.installHint, /https:\/\/brew\.sh/, `${id}: ${x.installHint}`);
    assert.doesNotMatch(x.installHint, /\bbrew install\b/, `${id}: ${x.installHint}`);
    assert.equal(x.installHint, r.hints[id].hint, `${id}: Settings and installHint disagree`);
  }
  const git = tool(r, 'git');
  if (!git.path) {
    assert.equal(git.installCommand, 'xcode-select --install');
    assert.equal(git.installCommand, r.hints.git.command);
  }
});

test('Voice input on a Mac without Homebrew (#398): no brew command, and the hint names Homebrew, the same as installHint', (t) => {
  const dir = tmp(t);
  const empty = path.join(dir, 'empty');
  fs.mkdirSync(empty);
  const r = screens(dir, empty);
  if (r.brew) return t.skip('Homebrew is installed in a folder the lookup always searches');
  assert.equal(r.voice.installCommand, null);
  assert.match(r.voice.installHint, /https:\/\/brew\.sh/);
  assert.doesNotMatch(r.voice.installHint, /\bbrew install\b/);
  assert.equal(r.voice.installHint, r.hints['whisper-cli'].hint);
});

test('Setup, Settings and Voice input on a Mac with Homebrew (#398): the brew commands stay', (t) => {
  const dir = tmp(t);
  const bin = path.join(dir, 'brew-bin');
  fs.mkdirSync(bin);
  const brew = path.join(bin, 'brew');
  fs.writeFileSync(brew, '#!/bin/sh\necho fake brew\n');
  fs.chmodSync(brew, 0o755);
  const r = screens(dir, bin);
  assert.equal(r.brew, true, 'the fake brew on PATH is found');
  for (const id of ['gh', 'glab']) {
    const x = tool(r, id);
    if (!x.path) assert.equal(x.installCommand, `brew install ${id}`);
  }
  assert.equal(r.voice.installCommand, 'brew install whisper-cpp');
  assert.equal(r.hints.gh.command, 'brew install gh');
  assert.equal(r.hints.git.command, 'brew install git');
});
