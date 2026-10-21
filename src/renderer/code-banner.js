/* global api */
// The code banner (#83): the code on disk changed while the app runs, with a safe restart (it
// lists the runs in progress first); after a restart, the runs it interrupted, each with Resume.
// initCodeBanner() runs from app.js's init(), once the runs in progress are known. Also the banner of
// an app update whose new code did not start (#279, checkFailedAppUpdate).

// The code changed on disk while the app runs (#83): a pull or a merge updated src/ and a reload
// (Ctrl+R) runs the new UI against the old main process (or server), where new channels are
// missing. Checked when the window loads and gets the focus; a banner offers a safe restart.
const RESTART_KEY = 'multiagent.restartInterrupted';
const codeState = { running: null, changed: false, reload: false };

async function checkCodeVersion() {
  let v = null;
  try {
    // a main process older than this check has no such channel: it is older than the page
    v = typeof api.codeVersion === 'function' ? await api.codeVersion() : { changed: true };
  } catch (e) {
    v = missingChannel(String(e?.message || e)) ? { changed: true } : null;
  }
  if (!v) return;
  // the browser UI: the server restarted with other code than the page loaded
  if (codeState.running && v.running && v.running !== codeState.running) codeState.reload = true;
  codeState.running = codeState.running || v.running || null;
  if (v.changed || codeState.reload) showCodeBanner();
}

const runningStepsOf = (runId) => [...(state.runs.get(runId)?.steps.values() || [])].filter((s) => s.status === 'running').map((s) => s.id).join(', ');

async function showCodeBanner() {
  codeState.changed = true;
  let runs = [];
  try { runs = await api.listActiveRuns(); } catch { /* the count is left out */ }
  const n = runs.length;
  const inProgress = n ? t('code_banner.runs_in_progress_will_be_interrupted', { count: n }) : '';
  const desktop = api.platform !== 'browser' && typeof api.relaunchApp === 'function';
  const text = codeState.reload ? t('code_banner.server_restarted_with_other_code')
    : desktop ? t('code_banner.code_changed_restart', { inProgress })
      : api.platform === 'browser' ? t('code_banner.code_changed_restart_server', { inProgress })
        : t('code_banner.code_changed_reopen', { inProgress });
  const el = $('#code-banner');
  el.innerHTML = `<span>${esc(text)}</span>
    ${codeState.reload ? `<button class="btn sm primary" type="button" data-code="reload">${t('code_banner.reload')}</button>` : desktop ? `<button class="btn sm primary" type="button" data-code="restart">${t('code_banner.restart')}</button>` : ''}
    <button class="btn sm ghost" type="button" data-code="dismiss" title="${t('code_banner.hide_until_the_next_check')}">${t('code_banner.later')}</button>`;
  el.classList.remove('hidden');
}
window.showCodeBanner = showCodeBanner;

// Warns with the runs in progress (and the step each is on), then restarts: main refuses again if
// a run started meanwhile and the user did not confirm it.
async function restartApp() {
  let runs = [];
  try { runs = await api.listActiveRuns(); } catch { /* main still refuses with runs in progress */ }
  if (runs.length) {
    const lines = runs.map((r) => `• ${r.workflow} (${r.runId}): ${r.waiting ? t('code_banner.waiting_for_approval') : runningStepsOf(r.runId) || t('code_banner.in_progress')}`);
    const ok = await confirmDialog(t('code_banner.restart_and_interrupt_runs'),
      t('code_banner.runs_in_progress_will_be_interrupted_list', { count: runs.length, lines: lines.join('\n') }), t('code_banner.restart'));
    if (!ok) return;
  }
  try { localStorage.setItem(RESTART_KEY, JSON.stringify(runs.map((r) => ({ runId: r.runId, workflow: r.workflow })))); } catch { /* storage unavailable */ }
  try {
    await api.relaunchApp(runs.length > 0);
  } catch (e) {
    try { localStorage.removeItem(RESTART_KEY); } catch { /* storage unavailable */ }
    showToast(t('code_banner.restart_refused'), errMsg(e));
  }
}

// After a restart: the runs it interrupted, each with Resume (a new run from a step, #74-#76).
function showRestartInterrupted() {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(RESTART_KEY) || '[]');
    localStorage.removeItem(RESTART_KEY);
  } catch { return; }
  if (!Array.isArray(list) || !list.length) return;
  const el = $('#code-banner');
  el.innerHTML = `<span>${t('code_banner.the_restart_interrupted_runs', { count: list.length })}</span>
    ${list.map((r) => `<span class="code-banner-run"><span class="mono small">${esc(r.workflow || 'workflow')} ${esc(r.runId)}</span>
      <button class="btn sm primary" type="button" data-code="resume" data-run="${esc(r.runId)}">${t('code_banner.resume')}</button></span>`).join('')}
    <button class="btn sm ghost" type="button" data-code="dismiss">${t('common.dismiss')}</button>`;
  el.classList.remove('hidden');
}

// #279: an app update whose new code did not start within 2 minutes (api.appUpdateFailed, the intent
// <workspace>/oracle/app-update.json is still there): what was updated and the command to go back,
// kept (at every start) until the owner dismisses it. Checked when the window loads.
async function checkFailedAppUpdate() {
  const box = $('#app-update-banner');
  if (!box || typeof api.appUpdateFailed !== 'function') return;
  let f = null;
  try { f = await api.appUpdateFailed(); } catch { return; }
  if (!f) { box.innerHTML = ''; return; }
  const subjects = (f.subjects || []).slice(0, 5);
  box.innerHTML = `<div class="code-banner app-update-banner" role="alert" data-testid="app-update-failed-banner">
    <span>${t('code_banner.the_app_update_to')} <b class="mono">${esc(String(f.to || '').slice(0, 7))}</b> ${t('code_banner.did_not_start_no_record_came')}${subjects.length ? t('code_banner.it_brought_value_value2', { value: subjects.map((s) => esc(s)).join('; '), value2: f.subjects.length > subjects.length ? '; …' : '' }) : ''}</span>
    <span>${t('code_banner.to_go_back_to')} <span class="mono">${esc(String(f.from || '').slice(0, 7))}</span>${t('code_banner.close_the_app_and_run')} <code class="mono">${esc(f.command)}</code>${t('code_banner.then_open_it_again')}</span>
    <button class="btn sm ghost" type="button" data-app-update="dismiss" title="${t('code_banner.deletes_the_update_s_record_the')}">${t('common.dismiss')}</button>
  </div>`;
  box.querySelector('[data-app-update="dismiss"]').onclick = async () => {
    try { await api.dismissAppUpdate(); box.innerHTML = ''; } catch (e) { showToast(t('code_banner.could_not_dismiss'), errMsg(e)); }
  };
}

function initCodeBanner() {
  checkFailedAppUpdate();
  $('#code-banner').onclick = (e) => {
    const b = e.target.closest('[data-code]');
    if (!b) return;
    if (b.dataset.code === 'restart') restartApp();
    if (b.dataset.code === 'reload') location.reload();
    if (b.dataset.code === 'resume') openResumeDialog(b.dataset.run);
    if (b.dataset.code === 'dismiss') $('#code-banner').classList.add('hidden');
  };
  showRestartInterrupted();
  checkCodeVersion();
  window.addEventListener('focus', checkCodeVersion);
  api.onReconnect?.(checkCodeVersion);
}
