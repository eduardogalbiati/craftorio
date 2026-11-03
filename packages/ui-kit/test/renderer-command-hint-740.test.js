// #740 (acceptance tests, written before the code): packages/ui-kit/command-hint.js canRunCommands() says
// whether a CLI's install / sign-in can run from this page. Before #740 it was false in the browser UI
// (npm run serve, the desktop app in remote mode); now the engine runs them as a job on its own machine.
//
// The contract assumed here:
// - the engine offers the job when the page's api has the method of the cli-setup:start channel
//   (window.api is built from the engine's manifest in the browser, apps/web/renderer/api-http.js), i.e.
//   typeof api.cliSetupStart === 'function';
// - canRunCommands() is true in the browser (api.platform === 'browser') when the engine offers the job,
//   with or without the terminal component; still true on the desktop with the terminal component (the
//   terminal dock stays there); false in the browser when the engine does not offer the job.
// Loaded the way renderer-command-hint.test.js loads it: the file in a vm sandbox with app.js's esc.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const hintSrc = fs.readFileSync(path.join(__dirname, '..', 'command-hint.js'), 'utf8');

// canRunCommands() of command-hint.js with this api and, when `terminal`, the xterm.js component
function canRun({ api, terminal }) {
  const sandbox = {
    document: { addEventListener: () => {} },
    confirmDialog: async () => false,
    openTerminal: async () => null,
    showToast: () => {},
    errMsg: (e) => String(e?.message || e),
    api,
  };
  if (terminal) sandbox.Terminal = class {};
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  const esc = /const esc = \(s\) => [^\n]+;/.exec(appSrc)[0];
  vm.runInContext(`${esc}\n${hintSrc}\nthis.__canRun = canRunCommands();`, sandbox);
  return sandbox.__canRun === true;
}

const cliSetupStart = async () => ({ jobId: 'j1', status: 'running' });

test('#740 the browser UI can run a CLI\'s install / sign-in when the engine offers the job (api.cliSetupStart)', () => {
  assert.equal(canRun({ api: { platform: 'browser', cliSetupStart } }), true);
});

test('#740 the browser UI with the terminal component loaded and the engine\'s job can run them too', () => {
  assert.equal(canRun({ api: { platform: 'browser', cliSetupStart }, terminal: true }), true);
});

// guards (pass before #740): the desktop keeps its terminal dock; an engine without the job keeps the hint
test('#740 guard: the desktop app with the terminal component still can (its terminal dock)', () => {
  assert.equal(canRun({ api: { platform: 'win32' }, terminal: true }), true);
});

test('#740 guard: the browser UI with an engine that does not offer the job cannot', () => {
  assert.equal(canRun({ api: { platform: 'browser' }, terminal: true }), false);
});
