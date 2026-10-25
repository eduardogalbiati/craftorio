/* global api */
// Keep awake (#162): the switch in the Workflows screen's header (Runs, Definitions and Pipelines) and in
// Settings › Execution, one setting (settings.keepAwake, per workspace): changing one changes the
// other. Shows the blocker's state from main (apps/desktop/host/keep-awake.js): Off, "On: waiting for work",
// "Active: 2 runs, roadmap stage 3/6", or the error of a blocker that failed to start (the switch
// stays on); a moon-off item in the sidebar while the blocker is held. The browser client (npm run
// serve) has no blocker: the switch is disabled there. initKeepAwake() runs from app.js's init().
// Uses app.js globals ($, esc, errMsg, state, showView).

const keepAwake = { state: null, error: null };
const keepAwakeAvailable = () => api.platform !== 'browser' && typeof api.keepAwakeState === 'function';

function renderKeepAwake() {
  const available = keepAwakeAvailable();
  const on = !!state.settings?.keepAwake;
  const s = keepAwake.state;
  const status = !available ? 'Not available in the browser client' : s ? s.label : on ? 'On' : 'Off';
  const tone = !available || !on ? '' : s?.error ? 'warn' : s?.holding ? 'cat-monitor' : '';
  document.querySelectorAll('[data-keep-awake-toggle]').forEach((el) => { el.checked = on && available; el.disabled = !available; });
  document.querySelectorAll('[data-keep-awake-status]').forEach((el) => {
    el.textContent = status;
    el.title = status;
    el.className = `badge keep-awake-status ${tone}`;
  });
  const error = available && on ? s?.error || keepAwake.error || '' : '';
  document.querySelectorAll('[data-keep-awake-error]').forEach((el) => { el.textContent = error; });
  const nav = $('#nav-keep-awake');
  if (nav) {
    nav.classList.toggle('hidden', !(available && on && s?.holding));
    nav.title = s?.holding ? t('keep_awake.keep_awake_value_the_display_may', { value: s.label.replace(/^Active: /, '') }) : '';
  }
}

// asks main again (it re-checks the work in progress) and shows the answer
async function refreshKeepAwake() {
  if (!keepAwakeAvailable()) return renderKeepAwake();
  try {
    keepAwake.state = await api.keepAwakeState();
    keepAwake.error = null;
  } catch (e) {
    keepAwake.error = errMsg(e);
  }
  renderKeepAwake();
}

async function setKeepAwake(on) {
  try {
    state.settings = await api.setSettings({ keepAwake: !!on });
  } catch (e) {
    keepAwake.error = errMsg(e);
  }
  await refreshKeepAwake();
}

function initKeepAwake() {
  // the toggles are in views' markup (already mounted) and change with a click on either
  document.addEventListener('change', (e) => {
    if (e.target.matches?.('[data-keep-awake-toggle]')) setKeepAwake(e.target.checked);
  });
  $('#nav-keep-awake')?.addEventListener('click', () => { state.workflowsTab = 'runs'; showView('workflows'); });
  api.onKeepAwakeChange?.((s) => { keepAwake.state = s; renderKeepAwake(); });
  refreshKeepAwake();
}
