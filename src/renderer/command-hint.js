/* global api */
// A command the app suggests (#147: a CLI's install command, gh's billing scope) shown as code with a
// play button: commandHint(command) is the markup, used by the Usage screen and Settings. A click on
// the button asks for confirmation (the command may download and install software), then runs that
// exact command in a terminal of the dock (term:open kind 'command', src/service/areas/terminals.js,
// which refuses any command it does not suggest itself). Uses app.js's helpers and term-dock.js.

const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z"/></svg>';

// `signIn`: a CLI's sign-in command (#319), confirmed with words that fit it.
function commandHint(command, { signIn = false } = {}) {
  return `<span class="cmd-hint"><code title="${esc(command)}">${esc(command)}</code><button type="button" class="icon-btn cmd-run" data-run-command="${esc(command)}"${signIn ? ' data-sign-in' : ''} title="${t('command_hint.run_in_a_terminal')}" aria-label="${t('command_hint.run_in_a_terminal_command', { command: esc(command) })}">${PLAY_ICON}</button></span>`;
}

// Resolves to the dock's tab (the Setup re-checks a CLI when it exits, #319), or null.
// `signIn`: a CLI's sign-in command (#319), confirmed with words that fit it.
async function runSuggestedCommand(command, { signIn = false } = {}) {
  const what = signIn ? 'It signs this CLI in to your account (a browser page may open).' : 'It may download and install software on this machine.';
  const ok = await confirmDialog('Run this command?', `A terminal opens and runs:\n\n${command}\n\n${what} The terminal stays open afterwards.`, 'Run');
  if (!ok) return null;
  try {
    return await openTerminal({ kind: 'command', sessionId: command, label: 'Command', open: (cols, rows) => api.termOpen({ kind: 'command', command, cols, rows }) });
  } catch (e) {
    showToast('Could not run the command', errMsg(e));
    return null;
  }
}

// #319: whether a suggested command can run here: the browser UI (npm run serve) may be on another
// computer than the app, and without the terminal component nothing can show the command.
const canRunCommands = () => api.platform !== 'browser' && typeof Terminal !== 'undefined';
const NO_TERMINAL_HINT = 'Run this on the computer where the app runs';

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-run-command]');
  if (b) runSuggestedCommand(b.dataset.runCommand, { signIn: b.dataset.signIn !== undefined });
});
