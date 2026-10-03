/* global api */
// A command the app suggests (#147: a CLI's install command, gh's billing scope) shown as code with a
// play button: commandHint(command) is the markup, used by the Usage screen and Settings. A click on
// the button asks for confirmation (the command may download and install software), then runs that
// exact command in a terminal of the dock (term:open kind 'command', src/service/areas/terminals.js,
// which refuses any command it does not suggest itself). Uses app.js's helpers and term-dock.js.

const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z"/></svg>';

function commandHint(command) {
  return `<span class="cmd-hint"><code title="${esc(command)}">${esc(command)}</code><button type="button" class="icon-btn cmd-run" data-run-command="${esc(command)}" title="Run in a terminal" aria-label="Run in a terminal: ${esc(command)}">${PLAY_ICON}</button></span>`;
}

async function runSuggestedCommand(command) {
  const ok = await confirmDialog('Run this command?', `A terminal opens and runs:\n\n${command}\n\nIt may download and install software on this machine. The terminal stays open afterwards.`, 'Run');
  if (!ok) return;
  try {
    await openTerminal({ kind: 'command', sessionId: command, label: 'Command', open: (cols, rows) => api.termOpen({ kind: 'command', command, cols, rows }) });
  } catch (e) {
    showToast('Could not run the command', errMsg(e));
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-run-command]');
  if (b) runSuggestedCommand(b.dataset.runCommand);
});
