/* global api */
// A command the app suggests (#147: a CLI's install command, gh's billing scope) shown as code with a
// play button: commandHint(command) is the markup, used by the Usage screen and Settings. A click on
// the button asks for confirmation (the command may download and install software), then runs that
// exact command in a terminal of the dock (term:open kind 'command', packages/engine/service/areas/terminals.js,
// which refuses any command it does not suggest itself). Uses app.js's helpers and term-dock.js.

const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z"/></svg>';

// `signIn`: a CLI's sign-in command (#319), confirmed with words that fit it.
function commandHint(command, { signIn = false } = {}) {
  return `<span class="cmd-hint"><code title="${esc(command)}">${esc(command)}</code><button type="button" class="icon-btn cmd-run" data-run-command="${esc(command)}"${signIn ? ' data-sign-in' : ''} title="${t('command_hint.run_in_a_terminal')}" aria-label="${t('command_hint.run_in_a_terminal_command', { command: esc(command) })}">${PLAY_ICON}</button></span>`;
}

// Resolves to the dock's tab (the Setup re-checks a CLI when it exits, #319), or null.
// `signIn`: a CLI's sign-in command (#319), confirmed with words that fit it. `onRefused(e)`: what to
// show when the terminal does not open (#783: the browser UI says where to run it instead).
async function runSuggestedCommand(command, { signIn = false, onRefused = null } = {}) {
  const what = t(signIn ? 'command_hint.what_sign_in' : 'command_hint.what_install');
  // nothing is destroyed: the accent button, and the exact command as code under the message
  const ok = await confirmDialog(t('command_hint.run_this_command'), t('command_hint.a_terminal_opens_and_runs', { what }), `▶ ${t('command_hint.run')}`, { tone: 'primary', command });
  if (!ok) return null;
  try {
    return await openTerminal({ kind: 'command', sessionId: command, label: t('command_hint.command'), open: (cols, rows) => api.termOpen({ kind: 'command', command, cols, rows }) });
  } catch (e) {
    if (onRefused) onRefused(e);
    else showToast(t('command_hint.could_not_run_the_command'), errMsg(e));
    return null;
  }
}

// #783: who wants to know when a terminal a ▶ opened exits (the Usage screen re-reads the Actions
// minutes after gh's billing scope): fn({ command, exitCode }).
const commandExitListeners = [];
function onSuggestedCommandExit(fn) { commandExitListeners.push(fn); }
function followCommandExit(tab, command) {
  if (!tab) return;
  const notify = () => { for (const fn of commandExitListeners) { try { fn({ command, exitCode: tab.exitCode }); } catch (e) { console.error(e); } } };
  tab.onChange = () => { renderTermTabs(); if (tab.exited) notify(); };
  if (tab.exited) notify();
}

// #319: whether a suggested command can run here: the browser UI (npm run serve) may be on another
// computer than the app, and without the terminal component nothing can show the command. #740: a CLI's
// install / sign-in runs on the engine's machine as a job (cli-setup:start, Settings › Agents & CLIs,
// views/settings/settings-clis.js) when the engine offers it, so the browser UI can run those too.
const canRunCommands = () => (api.platform === 'browser' ? typeof api.cliSetupStart === 'function' : typeof Terminal !== 'undefined');
const NO_TERMINAL_HINT = 'Run this on the computer where the app runs';

// #740: in the browser UI a CLI's install / sign-in command runs as the engine's job (window.SettingsClis.run,
// confirmed there). #783: any other command opens a terminal of the dock on the engine (term:open kind
// 'command', confirmed first); one the engine refuses (not on its allow list) is shown to run on the server.
async function runOnEngine(command, { signIn = false } = {}) {
  let tool = null;
  try {
    tool = (await api.envDetails()).find((x) => x.installCommand === command || x.signInCommand === command) || null;
  } catch {
    tool = null;
  }
  if (tool) {
    // an install / sign-in is always the engine's job, never a terminal of the page (#740)
    if (!window.SettingsClis) { showToast(NO_TERMINAL_HINT, command); return null; }
    const action = tool.signInCommand === command && (signIn || tool.installCommand !== command) ? 'login' : 'install';
    return window.SettingsClis.run(tool.id, action);
  }
  const tab = await runSuggestedCommand(command, { signIn, onRefused: () => showToast(NO_TERMINAL_HINT, command) });
  followCommandExit(tab, command);
  return tab;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-run-command]');
  if (!b) return;
  const command = b.dataset.runCommand;
  const opts = { signIn: b.dataset.signIn !== undefined };
  if (api.platform === 'browser') runOnEngine(command, opts);
  else runSuggestedCommand(command, opts).then((tab) => followCommandExit(tab, command));
});
