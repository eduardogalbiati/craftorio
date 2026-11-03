// #740: in the browser UI (api.platform 'browser') with an engine that runs a CLI's install / sign-in as a
// job (api.cliSetupStart), canRunCommands() is true, so the ▶ of a suggested command (commandHint: the
// Start drawer's missing CLI, Usage, Settings' voice row) is shown. Its click must not go to the
// desktop's terminal dock (api.termOpen / openTerminal): the browser has none, and the command must run on
// the engine's machine. Same vm sandbox as renderer-command-hint.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const hintSrc = fs.readFileSync(path.join(__dirname, '..', 'command-hint.js'), 'utf8');

function browserHint() {
  const termOpenCalls = [];
  const openCalls = [];
  let clickHandler = null;
  const sandbox = {
    document: { addEventListener: (type, fn) => { if (type === 'click') clickHandler = fn; }, querySelector: () => null },
    confirmDialog: () => Promise.resolve(true),
    openTerminal: async (opts) => { openCalls.push(opts.kind); return opts.open(80, 24); },
    api: {
      platform: 'browser',
      cliSetupStart: async ({ id, action }) => ({ jobId: 'j1', id, action, status: 'running', output: '' }),
      envDetails: async () => [{ id: 'gh', name: 'GitHub CLI', path: null, installCommand: 'winget install --id GitHub.cli -e', signInCommand: 'gh auth login' }],
      termOpen: (args) => { termOpenCalls.push(args.command); return { id: 'term1' }; },
    },
    showToast: () => {},
    errMsg: (e) => String(e?.message || e),
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  const esc = /const esc = \(s\) => [^\n]+;/.exec(appSrc)[0];
  vm.runInContext(`${esc}\n${hintSrc}\nthis.__canRun = canRunCommands;`, sandbox);
  const click = (runCommand) => clickHandler({ target: { closest: (sel) => (sel === '[data-run-command]' ? { dataset: { runCommand } } : null) } });
  return { canRun: () => sandbox.__canRun(), click, termOpenCalls, openCalls };
}

test('#740 the browser UI\'s ▶ of a CLI\'s install command never opens a terminal of the page', async () => {
  const hint = browserHint();
  assert.equal(hint.canRun(), true, 'the ▶ is shown in the browser with the engine\'s job');
  hint.click('winget install --id GitHub.cli -e');
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(hint.openCalls, [], 'no terminal of the dock');
  assert.deepEqual(hint.termOpenCalls, [], 'no term:open');
});
