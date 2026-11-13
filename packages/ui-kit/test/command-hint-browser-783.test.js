// #783 (acceptance tests, written before the code): the browser UI's ▶ of a suggested command
// (packages/ui-kit/command-hint.js, the document's delegated click on [data-run-command]) routes by command:
// - a CLI's install / sign-in command (api.envDetails()) still runs as the engine's cli-setup job
//   (window.SettingsClis.run, #740), never in a terminal of the dock;
// - any other suggested command (gh's billing scope, `gh auth refresh -s user`) asks for confirmation, as the
//   desktop does, then opens a terminal of the dock on the engine: openTerminal with kind 'command' whose
//   open() calls api.termOpen({ kind: 'command', command, cols, rows }) (the engine's term:open);
// - a command the engine refuses (its allow list, packages/engine/service/areas/terminals.js) keeps the
//   toast "Run this on the computer where the app runs".
// Same vm sandbox as command-hint-browser-740.test.js; the boundaries are the engine's api, the dock's
// openTerminal, the confirmation dialog and the toast.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const hintSrc = fs.readFileSync(path.join(__dirname, '..', 'command-hint.js'), 'utf8');

const SCOPE_HINT = 'gh auth refresh -s user';
const INSTALL = 'winget install --id GitHub.cli -e';
const SIGN_IN = 'gh auth login';
const NO_TERMINAL_HINT = 'Run this on the computer where the app runs';
const ALLOWED = [SCOPE_HINT, INSTALL, SIGN_IN];

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

function browserHint({ confirm = true, settingsClis = true } = {}) {
  const calls = { confirms: 0, openKinds: [], termOpen: [], toasts: [], cliRuns: [] };
  let clickHandler = null;
  const sandbox = {
    document: { addEventListener: (type, fn) => { if (type === 'click') clickHandler = fn; }, querySelector: () => null, dispatchEvent: () => true },
    confirmDialog: async () => { calls.confirms++; return confirm; },
    openTerminal: async (opts) => { calls.openKinds.push(String(opts.kind)); await opts.open(80, 24); return { id: 'pty-1', kind: opts.kind }; },
    renderTermTabs: () => {},
    api: {
      platform: 'browser',
      cliSetupStart: async ({ id, action }) => ({ jobId: 'j1', id, action, status: 'running', output: '' }),
      envDetails: async () => [{ id: 'gh', name: 'GitHub CLI', path: null, installCommand: INSTALL, signInCommand: SIGN_IN }],
      // the engine's term:open: refuses what it does not suggest itself, as terminals.js commandSpec does
      termOpen: async (args) => {
        calls.termOpen.push(`${args.kind}:${args.command}`);
        if (!ALLOWED.includes(args.command)) throw new Error('Only the commands the app suggests can run in a command terminal.');
        return { id: 'pty-1' };
      },
      onTermData: () => {},
      onTermExit: () => {},
    },
    SettingsClis: { run: async (id, action) => { calls.cliRuns.push(`${id}:${action}`); return null; } },
    showToast: (title) => { calls.toasts.push(String(title)); },
    errMsg: (e) => String(e?.message || e),
  };
  if (!settingsClis) delete sandbox.SettingsClis;
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  const esc = /const esc = \(s\) => [^\n]+;/.exec(appSrc)[0];
  vm.runInContext(`${esc}\n${hintSrc}`, sandbox);
  const click = (runCommand, { signIn = false } = {}) => clickHandler({
    target: { closest: (sel) => (sel === '[data-run-command]' ? { dataset: signIn ? { runCommand, signIn: '' } : { runCommand } } : null) },
  });
  return { click, calls };
}

test('#783 the browser UI\'s ▶ of gh\'s billing scope asks for confirmation, then opens a dock terminal running it on the engine', async () => {
  const hint = browserHint();
  hint.click(SCOPE_HINT);
  await settle();
  assert.equal(hint.calls.confirms, 1, 'confirmed first, as the desktop app does');
  assert.deepEqual(hint.calls.openKinds, ['command'], 'one terminal tab of the dock, kind command');
  assert.deepEqual(hint.calls.termOpen, [`command:${SCOPE_HINT}`], 'the engine\'s term:open with that exact command');
  assert.deepEqual(hint.calls.cliRuns, [], 'not a cli-setup job');
  assert.equal(hint.calls.toasts.includes(NO_TERMINAL_HINT), false, 'no "run it on the server" toast');
});

test('#783 declining the confirmation opens no terminal and shows no toast', async () => {
  const hint = browserHint({ confirm: false });
  hint.click(SCOPE_HINT);
  await settle();
  assert.equal(hint.calls.confirms, 1);
  assert.deepEqual(hint.calls.openKinds, []);
  assert.deepEqual(hint.calls.termOpen, []);
  assert.deepEqual(hint.calls.toasts, []);
});

test('#783 a command the engine refuses keeps the toast "Run this on the computer where the app runs"', async () => {
  const hint = browserHint();
  hint.click('rm -rf /');
  await settle();
  assert.deepEqual(hint.calls.cliRuns, [], 'not a cli-setup job');
  assert.deepEqual(hint.calls.toasts, [NO_TERMINAL_HINT], 'only the toast that says where to run it');
});

test('#783 a CLI\'s install command without the Settings\' CLI job on the page shows the toast, never a terminal', async () => {
  const hint = browserHint({ settingsClis: false });
  hint.click(INSTALL);
  await settle();
  assert.equal(hint.calls.confirms, 0, 'no confirmation for a terminal that never opens');
  assert.deepEqual(hint.calls.openKinds, []);
  assert.deepEqual(hint.calls.termOpen, [], 'an install never goes to a terminal of the page');
  assert.deepEqual(hint.calls.toasts, [NO_TERMINAL_HINT]);
});

// guards (#740, pass before #783): a CLI's install / sign-in still goes to the engine's job
test('#783 guard: a CLI\'s install command still runs as the cli-setup job, not in a terminal', async () => {
  const hint = browserHint();
  hint.click(INSTALL);
  await settle();
  assert.deepEqual(hint.calls.cliRuns, ['gh:install']);
  assert.deepEqual(hint.calls.termOpen, []);
  assert.deepEqual(hint.calls.toasts, []);
});

test('#783 guard: a CLI\'s sign-in command still runs as the cli-setup job (login), not in a terminal', async () => {
  const hint = browserHint();
  hint.click(SIGN_IN, { signIn: true });
  await settle();
  assert.deepEqual(hint.calls.cliRuns, ['gh:login']);
  assert.deepEqual(hint.calls.termOpen, []);
  assert.deepEqual(hint.calls.toasts, []);
});
