// #783: in the browser UI (api.platform 'browser') the play button of the GitHub Actions card's scope
// hint (`gh auth refresh -s user`, commandHint in packages/ui-kit/command-hint.js) confirms and runs
// the command in a dock terminal (term:open kind 'command'). When that terminal exits with 0 the card
// reads the usage again (api.getActionsUsage, forced) without a page reload; a non-zero exit does not.
// Wiring-agnostic: the REAL term-dock.js, command-hint.js and views/usage/usage.js run in one vm sandbox
// over packages/ui-kit/test/mini-dom.js, with a fake xterm `Terminal` and stand-ins for app.js's
// helpers the screen is not about. The seam is the engine api boundary only: what reaches
// api.termOpen / api.getActionsUsage, and the engine's term:exit (api.onTermExit) fired back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', '..');
const UI_KIT = path.join(ROOT, 'packages', 'ui-kit');
const HINT = 'gh auth refresh -s user';
const DOCK_MARKUP = `<section id="term-dock" class="term-dock hidden"><div id="term-resize"></div><div class="term-bar">
  <div id="term-tabs"></div><span id="term-msg" class="muted small term-msg"></span>
  <button id="btn-term-popout"></button><button id="btn-term-collapse"></button></div>
  <div id="term-body" class="term-body"></div></section>`;

const tick = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

function loadUsageScreen() {
  const { createDom } = require('../../../packages/ui-kit/test/mini-dom.js');
  const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');
  const usageFile = require('../../../scripts/source-tree').pageFile(ROOT, 'views/usage/usage.js');
  const appSrc = fs.readFileSync(path.join(UI_KIT, 'app.js'), 'utf8');
  const pick = (re, what) => { const m = re.exec(appSrc); assert.ok(m, `${what} not found in app.js: the source moved`); return m[0]; };
  const helpers = [
    pick(/const esc = \(s\) => [^\n]+;/, 'esc'),
    pick(/const NEEDS_RESTART = [^\n]+;/, 'NEEDS_RESTART'),
    pick(/const missingChannel = [^\n]+;/, 'missingChannel'),
    pick(/const errMsg = \(e\) => \{[\s\S]*?\n\};/, 'errMsg'),
  ].join('\n');
  const src = [
    helpers,
    fs.readFileSync(path.join(UI_KIT, 'term-dock.js'), 'utf8'),
    fs.readFileSync(path.join(UI_KIT, 'command-hint.js'), 'utf8'),
    fs.readFileSync(usageFile, 'utf8'),
    'this.initTerminalDock = initTerminalDock;',
  ].join('\n;\n');

  const calls = { termOpen: [], getActionsUsage: [], toasts: [] };
  const exitListeners = [];
  const views = [];
  class Terminal {
    constructor(options) { this.options = { ...options }; this.cols = 80; this.rows = 24; }
    open(parent) { this.element = sandbox.document.createElement('div'); parent.appendChild(this.element); }
    loadAddon() {}
    onData() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    attachCustomKeyEventHandler() {}
    hasSelection() { return false; }
    getSelection() { return ''; }
    clearSelection() {}
    focus() {}
    write() {}
    dispose() {}
  }

  const sandbox = {
    Terminal,
    FitAddon: { FitAddon: class { fit() {} } },
    state: { view: 'usage', usageScope: 'orchestrator', usage: { month: '2026-11', providers: [], prices: {}, runs: [] } },
    localStorage: { getItem: () => null, setItem() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    innerHeight: 800,
    setTimeout, clearTimeout, Date, Promise, console,
    navigator: { platform: '', clipboard: { readText: async () => '' } },
    // app.js / view-registry.js stand-ins the Actions card is not about
    registerView: (v) => views.push(v),
    loadUsage: () => {},
    renderScopeToggles: () => {},
    setUsageScope: () => {},
    renderUsageAll: () => {},
    monthLabel: (m) => String(m),
    usageStale: () => false,
    runsTableHtml: () => '',
    TimeZone: { current: () => 'UTC' },
    fmtTok: (n) => String(n ?? ''),
    fmtUsd: (n) => String(n ?? ''),
    fmtNum: (n) => String(n ?? ''),
    meterHtml: () => '',
    meterRaw: () => '',
    parseAmount: () => null,
    STATUS_TEXT: {},
    openModal: () => {},
    closeModal: () => {},
    confirmDialog: async () => true,
    showToast: (title, body) => { calls.toasts.push(`${title}|${body ?? ''}`); },
    api: {
      platform: 'browser',
      cliSetupStart: async () => ({}),
      envDetails: async () => [{ id: 'gh', installCommand: 'winget install --id GitHub.cli -e', signInCommand: 'gh auth login' }],
      termOpen: async (opts) => { calls.termOpen.push({ kind: opts?.kind, command: opts?.command }); return { id: 'pty-1' }; },
      termInput() {},
      termResize() {},
      termKill: async () => {},
      onTermData: () => () => {},
      onTermExit: (fn) => { exitListeners.push(fn); return () => {}; },
      getActionsUsage: async (force) => {
        calls.getActionsUsage.push(force === undefined ? 'undefined' : force);
        return { error: 'GitHub billing usage needs the gh "user" scope', hint: HINT };
      },
      getUsage: async () => sandbox.state.usage,
    },
  };
  sandbox.window = sandbox;
  const { document } = createDom({ window: sandbox });
  sandbox.document = document;
  sandbox.$ = (sel) => document.querySelector(sel);
  vm.createContext(withI18n(sandbox));
  vm.runInContext(src, sandbox);

  const view = views.find((v) => v.id === 'usage');
  assert.ok(view, 'usage.js did not register the usage view');
  document.body.innerHTML = view.markup() + (view.modals ? view.modals() : '') + DOCK_MARKUP;
  document.querySelector('#view-usage').classList.remove('hidden');
  sandbox.initTerminalDock();
  view.mount();
  return {
    calls,
    show: () => view.show(),
    runButton: () => document.querySelector(`#usage-cards [data-run-command="${HINT}"]`),
    exit: (exitCode) => { for (const fn of exitListeners) fn({ id: 'pty-1', exitCode }); },
  };
}

// Shows the screen, clicks the Actions card's play button and returns the screen with a clean call log.
async function clickScopeHint() {
  const s = loadUsageScreen();
  s.show();
  await tick();
  const button = s.runButton();
  assert.equal(Boolean(button), true, 'the GitHub Actions card shows no play button for the scope hint');
  s.calls.getActionsUsage.length = 0;
  button.click();
  await tick();
  assert.deepEqual(s.calls.termOpen.map((c) => `${c.kind}|${c.command}`), [`command|${HINT}`],
    `the browser click did not open a dock terminal for "${HINT}" (toasts: ${JSON.stringify(s.calls.toasts)})`);
  return s;
}

test('#783: the scope hint\'s terminal exiting with 0 makes the GitHub Actions card read the usage again, forced', async () => {
  const s = await clickScopeHint();
  s.exit(0);
  await tick();
  assert.equal(s.calls.getActionsUsage.length > 0, true, 'api.getActionsUsage was not called again after the terminal exited with 0');
  assert.equal(s.calls.getActionsUsage.some(Boolean), true, 'the re-read was not forced');
});

test('#783: the scope hint\'s terminal exiting non-zero does not read the GitHub Actions usage again', async () => {
  const s = await clickScopeHint();
  s.exit(1);
  await tick();
  assert.equal(s.calls.getActionsUsage.length, 0);
});
