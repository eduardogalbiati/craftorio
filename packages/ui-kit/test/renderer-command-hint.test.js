// packages/ui-kit/command-hint.js: commandHint's markup (code + play button, #147) and the delegated
// click handler that confirms, then runs the command in a terminal of the dock. Pure DOM glue
// (confirmDialog/showToast/errMsg from app.js, openTerminal from term-dock.js, api.termOpen from the
// preload), so it is run in a vm sandbox against a minimal fake DOM, the way
// test/renderer-kept-work-dialog.test.js checks kept-work-dialog.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const hintSrc = fs.readFileSync(path.join(__dirname, '..', 'command-hint.js'), 'utf8');

// e.target for document's delegated click listener: .closest('[data-run-command]') either returns
// itself (a click on, or inside, the play button) or null (anywhere else).
function fakeTarget(runCommand) {
  return { closest: (sel) => (sel === '[data-run-command]' && runCommand != null ? { dataset: { runCommand } } : null) };
}

function loadCommandHint({ confirmResult = true, openTerminal } = {}) {
  const confirmCalls = [];
  const openCalls = [];
  const termOpenCalls = [];
  const toasts = [];
  let clickHandler = null;
  const sandbox = {
    document: { addEventListener: (type, fn) => { if (type === 'click') clickHandler = fn; } },
    confirmDialog: (title, message, yes) => { confirmCalls.push({ title, message, yes }); return Promise.resolve(confirmResult); },
    openTerminal: openTerminal || (async (opts) => { openCalls.push(opts); return opts.open(80, 24); }),
    api: { termOpen: (args) => { termOpenCalls.push(args); return { id: 'term1' }; } },
    showToast: (title, detail) => toasts.push({ title, detail }),
    errMsg: (e) => String(e?.message || e),
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  const esc = /const esc = \(s\) => [^\n]+;/.exec(appSrc)[0];
  assert.ok(esc, 'esc not found in app.js: the source moved');
  vm.runInContext(`${esc}\n${hintSrc}\nthis.commandHint = commandHint;\nthis.runSuggestedCommand = runSuggestedCommand;`, sandbox);
  return {
    commandHint: sandbox.commandHint,
    runSuggestedCommand: sandbox.runSuggestedCommand,
    click: (runCommand) => clickHandler({ target: fakeTarget(runCommand) }),
    confirmCalls, openCalls, termOpenCalls, toasts,
  };
}

test('commandHint: a <code> with the command and a play button carrying it in data-run-command, escaped', () => {
  const { commandHint } = loadCommandHint();
  const cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"';
  const html = commandHint(cmd);
  assert.match(html, /<code title="powershell[^"]*&quot;irm[^"]*">/);
  assert.match(html, /data-run-command="powershell[^"]*&quot;irm[^"]*"/);
  assert.match(html, /aria-label="Run in a terminal: powershell/);
  assert.doesNotMatch(html, /Bypass -Command "irm/, 'the embedded quotes must be escaped, not left raw inside an attribute');
});

test('document click: a click outside the play button does nothing (no confirmation, no terminal)', async () => {
  const { click, confirmCalls, openCalls } = loadCommandHint();
  click(null);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(confirmCalls, []);
  assert.deepEqual(openCalls, []);
});

test('document click: asks for confirmation with the command shown, and declining never opens a terminal', async () => {
  const { click, confirmCalls, openCalls } = loadCommandHint({ confirmResult: false });
  click('gh auth refresh -s user');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(confirmCalls.length, 1);
  assert.equal(confirmCalls[0].title, 'Run this command?');
  assert.match(confirmCalls[0].message, /gh auth refresh -s user/);
  assert.equal(confirmCalls[0].yes, 'Run');
  assert.deepEqual(openCalls, []);
});

test('document click: confirming opens a command terminal, whose open() calls api.termOpen with that exact command', async () => {
  const { click, openCalls, termOpenCalls } = loadCommandHint({ confirmResult: true });
  click('gh auth refresh -s user');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(openCalls.length, 1);
  assert.equal(openCalls[0].kind, 'command');
  assert.equal(openCalls[0].sessionId, 'gh auth refresh -s user');
  assert.equal(openCalls[0].label, 'Command');
  assert.equal(termOpenCalls.length, 1);
  assert.equal(termOpenCalls[0].kind, 'command');
  assert.equal(termOpenCalls[0].command, 'gh auth refresh -s user');
  assert.equal(termOpenCalls[0].cols, 80);
  assert.equal(termOpenCalls[0].rows, 24);
});

test('document click: a terminal that fails to open shows a toast instead of throwing', async () => {
  const { click, toasts } = loadCommandHint({ confirmResult: true, openTerminal: async () => { throw new Error('boom'); } });
  click('gh auth refresh -s user');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].title, 'Could not run the command');
  assert.equal(toasts[0].detail, 'boom');
});
