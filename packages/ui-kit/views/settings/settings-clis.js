/* global api */
// Settings › Agents & CLIs' CLI section (#740): the CLIs the runs call (claude, codex, grok, gh, glab, git)
// with the first-run Setup's rows (setup.js window.SetupRows: status, version, account, ▶ Install /
// ▶ Sign in) in data-testid="settings-clis", a close button (settings-clis-close) and no stepper. An engine
// setting: the CLIs are installed and signed in on the engine's machine (the runs call them there).
// - An action runs as the engine's job (cli-setup:start, packages/engine/service/areas/cli-setup.js) when the
//   engine offers it, after a confirm: its output follows cli-setup:changed in the console panel
//   (data-testid="cli-console", data-state running | ended), with a sign-in's one-time code
//   (cli-setup-device-code) and its URL as a link, or, for a sign-in that needs a terminal on the server,
//   what to run there. A CLI without a one-line installer here (glab on Linux) starts no job: its ▶ Install
//   shows the install hint in the panel (data-status="manual"; #110: in the interface language,
//   SetupModel.installHintText). When the job ends the row shows the CLI checked again (the job's `tool`). The
//   desktop app keeps its terminal dock for a sign-in (interactive, on this computer).
// - #97: above the rows, the orchestrator AI (#set-orchestrator, data-testid="settings-orchestrator"): the Setup's
//   "Use as orchestrator" radios for Claude Code and Codex (SetupRows.orchestratorRadio, each in a label
//   settings-orchestrator-<id>), the saved settings.orchestratorProvider checked, saved at once when it changes
//   (the next run uses it; a running one keeps its own), then the workflows read again (Start's requirements).
// - window.Settings.open(section, { highlight, onClose }): the deep link (the project wizard's Open Setup,
//   fronts/build/views/projects/project-wizard.js): the Settings screen on that tab, the `highlight` CLI's row
//   marked and scrolled to; the close button goes back to the screen it was opened from, then calls onClose.
//   Leaving Settings another way ends that visit (onShow, settings.js's view show): a later visit marks no
//   CLI and its close button calls no old onClose.
// - window.SettingsClis = { render, run, consoleHtml }: settings.js renderTools draws the rows with render;
//   setup.js runs its own rows' actions in the browser with run and shows consoleHtml.
// Uses app.js globals ($, esc, t, state, showView, confirmDialog, showToast, errMsg), settings.js's
// showSettingsTab, command-hint.js's runSuggestedCommand and start-drawer.js's setCliStates.

(function () {
  const clis = {
    tools: null,        // env:details, null while checking
    error: null,        // the check's error
    highlight: null,    // the CLI a deep link was opened for
    onClose: null,      // the deep link's callback
    back: null,         // the screen Settings was opened from
    job: null,          // the console's job
    watching: false,
  };
  const followers = new Map(); // jobId → onChange(job), until the job ends
  const seen = new Map();      // jobId → its last cli-setup:changed (one may come before cli-setup:start answers)
  const ended = (job) => !!job && job.status !== 'running';

  // ---------- the console panel ----------
  const STATUS = {
    running: () => t('settings.clis.status_running'),
    done: () => t('settings.clis.status_done'),
    failed: () => t('settings.clis.status_failed'),
    manual: () => t('settings.clis.status_manual'),
  };

  function consoleHtml(job) {
    const name = window.SetupModel.toolName(job.id);
    const what = job.action === 'login' ? t('settings.clis.signing_in') : t('settings.clis.installing');
    const status = (STATUS[job.status] || STATUS.failed)();
    const tone = job.status === 'failed' ? ' warn' : '';
    // #110: the manual state's install prose in the interface language
    const hint = window.SetupModel.installHintText({ id: job.id, installHint: job.command || '' });
    const device = job.deviceCode || job.url ? `
      <div class="cli-device">
        ${job.deviceCode ? `<span class="muted small">${t('settings.clis.device_code')}</span> <b class="cli-device-code" data-testid="cli-setup-device-code">${esc(job.deviceCode)}</b>` : ''}
        ${job.url ? `<a href="${esc(job.url)}" target="_blank" rel="noopener noreferrer" data-testid="cli-setup-url">${esc(job.url)}</a>` : ''}
      </div>` : '';
    const manual = job.status === 'manual' ? `
      <p class="small">${t(job.action === 'install' ? 'settings.clis.manual_install' : 'settings.clis.manual')}</p>
      <code class="setup-cmd" title="${esc(hint)}">${esc(hint)}</code>` : '';
    return `
      <div class="cli-console" data-testid="cli-console" data-state="${ended(job) ? 'ended' : 'running'}" data-status="${esc(job.status)}" role="status" aria-live="polite">
        <div class="row cli-console-head"><b>${esc(name)}</b><code>${esc(job.id)}</code><span class="muted small">${esc(what)}</span><span class="spacer"></span><span class="badge${tone}">${esc(status)}</span></div>
        ${device}${manual}
        ${job.output ? `<pre class="cli-console-out">${esc(job.output)}</pre>` : ''}
      </div>`;
  }

  // ---------- the rows ----------
  function renderRows() {
    const box = $('#set-tools');
    if (!box) return;
    if (clis.error) {
      box.innerHTML = `<div class="s-row"><div class="s-label"><span class="error small" role="alert">${esc(t('settings.clis.check_failed', { error: clis.error }))}</span></div></div>`;
      return;
    }
    const tools = clis.tools || window.SetupRows.TOOL_IDS.map((id) => ({ id, checking: true }));
    box.innerHTML = tools.map((tool) => window.SetupRows.cliRow(tool, { highlight: clis.highlight })).join('');
    renderOrchestrator(tools);
  }

  // #97: the orchestrator AI, the saved one checked (claude when none), the Setup's radios (off while not ready)
  function renderOrchestrator(tools) {
    const box = $('#set-orchestrator');
    if (!box) return;
    const saved = state.settings?.orchestratorProvider === 'codex' ? 'codex' : 'claude';
    const row = (id) => {
      const tool = tools.find((x) => x.id === id) || { id, checking: true };
      const name = tool.name || window.SetupModel.toolName(id);
      return `<div class="s-row"><div class="s-label"><b>${esc(name)}</b><span>${esc(window.SetupModel.statusBadge(tool).label)}</span></div>
        <div class="s-ctrl">${window.SetupRows.orchestratorRadio(tool, saved, { testid: `settings-orchestrator-${id}` })}</div></div>`;
    };
    box.innerHTML = `<div class="s-row"><div class="s-label"><b>${esc(t('settings.agents.orchestrator'))}</b><span>${esc(t('settings.agents.orchestrator_help'))}</span></div></div>
      ${window.SetupRows.ORCHESTRATORS.map(row).join('')}`;
  }

  // a new orchestrator: saved at once, for the next run (a running one keeps its own); the Start panel's
  // requirements follow it (workflows:list computes them on the saved orchestrator)
  async function onOrchestratorChange(e) {
    if (e.target?.name !== 'orchestrator' || e.target.type !== 'radio' || e.target.disabled) return;
    try {
      state.settings = await api.setSettings({ orchestratorProvider: e.target.value });
    } catch (err) {
      showToast(t('setup.save_failed'), errMsg(err));
      return;
    }
    renderRows();
    $(`#set-orchestrator [data-testid="setup-orchestrator-${e.target.value}"]`)?.focus({ preventScroll: true });
    try { state.workflows = await api.listWorkflows(); } catch { /* the list stays */ }
  }

  function renderConsole() {
    const el = $('#set-cli-console');
    if (el) el.innerHTML = clis.job ? consoleHtml(clis.job) : '';
  }

  // the deep link's row in view
  function showHighlight() {
    if (!clis.highlight) return;
    document.querySelector(`#set-tools [data-testid="setup-cli-${clis.highlight}"]`)?.scrollIntoView?.({ block: 'center' });
  }

  // reads env:details again and draws the rows (settings.js renderTools)
  async function render() {
    clis.tools = null;
    clis.error = null;
    renderRows();
    renderConsole();
    try {
      clis.tools = await api.envDetails();
    } catch (e) {
      clis.error = errMsg(e);
    }
    if (clis.tools && typeof setCliStates === 'function') setCliStates(clis.tools); // the Start panel's missing CLIs follow (#319)
    renderRows();
    showHighlight();
  }

  // ---------- the job ----------
  function onChanged(job) {
    if (!job?.jobId) return;
    seen.set(job.jobId, job);
    if (seen.size > 20) seen.delete(seen.keys().next().value);
    const fn = followers.get(job.jobId);
    if (!fn) return;
    if (ended(job)) followers.delete(job.jobId);
    fn(job);
  }

  function watch() {
    if (clis.watching || typeof api.onCliSetupChanged !== 'function') return;
    api.onCliSetupChanged(onChanged);
    clis.watching = true;
  }

  // the Settings section's own job: the console, then the row checked again
  function settingsJob(job) {
    clis.job = job;
    renderConsole();
    if (!ended(job) || job.status === 'manual') return;
    if (job.tool && clis.tools) {
      clis.tools = clis.tools.map((tool) => (tool.id === job.tool.id ? job.tool : tool));
      if (typeof setCliStates === 'function') setCliStates(clis.tools);
      renderRows();
    } else {
      render();
    }
  }

  const canRunOnEngine = () => typeof api.cliSetupStart === 'function';
  // a sign-in on the desktop app goes on in its terminal dock (interactive, on this computer)
  const inTerminal = (action) => action === 'login' && api.platform !== 'browser' && typeof Terminal !== 'undefined';

  // ▶ Install / ▶ Sign in of a CLI: confirmed, then the engine's job (or the desktop's terminal dock)
  async function run(id, action, { onChange = settingsJob, hint = null } = {}) {
    const tool = (clis.tools || []).find((x) => x.id === id) || {};
    const command = action === 'login' ? tool.signInCommand : tool.installCommand;
    // a CLI without a one-line installer on the engine's platform (glab on Linux, #316): nothing runs, the
    // console says what to install there (the row's install hint)
    const installHint = action === 'install' && !command ? tool.installHint || hint : null;
    if (installHint) {
      const job = { jobId: `manual-${id}`, id, action, status: 'manual', output: '', command: installHint };
      onChange(job);
      return job;
    }
    if (inTerminal(action) || !canRunOnEngine()) {
      if (!command) return null;
      const tab = await runSuggestedCommand(command, { signIn: action === 'login' });
      if (tab) tab.onChange = () => { renderTermTabs(); render(); };
      return null;
    }
    const name = tool.name || window.SetupModel.toolName(id);
    const body = t(action === 'login' ? 'settings.clis.confirm_login' : 'settings.clis.confirm_install', { name, command: command || id });
    if (!(await confirmDialog(t('settings.clis.confirm_title'), body, t('command_hint.run')))) return null;
    watch();
    let job;
    try {
      job = await api.cliSetupStart({ id, action });
    } catch (e) {
      showToast(t('settings.clis.start_failed'), errMsg(e));
      return null;
    }
    job = seen.get(job.jobId) || job;
    if (!ended(job)) followers.set(job.jobId, onChange);
    onChange(job);
    return job;
  }

  async function onRowsClick(e) {
    const btn = e.target.closest?.('[data-cli-action]');
    if (!btn || btn.disabled) return;
    await run(btn.dataset.cliId, btn.dataset.cliAction);
  }

  // ---------- the deep link ----------
  // the deep link belongs to the visit it opened: a visit of Settings opened another way (the sidebar,
  // after leaving through it) marks no CLI and its close button calls no old onClose
  let opening = false;
  function forget() {
    clis.onClose = null;
    clis.highlight = null;
    clis.back = null;
  }

  function open(section = 'agents', { highlight = null, onClose = null } = {}) {
    if (state.view !== 'settings') clis.back = state.view;
    clis.highlight = highlight || null;
    clis.onClose = typeof onClose === 'function' ? onClose : null;
    opening = true;
    try {
      showView('settings');
    } finally {
      opening = false;
    }
    showSettingsTab(section);
  }

  // settings.js's view show: every visit of the Settings screen
  function onShow() {
    if (!opening) forget();
  }

  function close() {
    const done = clis.onClose;
    const back = clis.back;
    forget();
    showView(back && back !== 'settings' ? back : 'dashboard');
    done?.();
  }

  // settings.js mount (again after a language redraw): the section's controls
  function mount() {
    const box = $('#set-tools');
    if (box) box.onclick = onRowsClick;
    const orchestrator = $('#set-orchestrator');
    if (orchestrator) orchestrator.onchange = onOrchestratorChange;
    const closeBtn = $('#btn-settings-clis-close');
    if (closeBtn) closeBtn.onclick = close;
    watch();
  }

  window.SettingsClis = { consoleHtml, mount, onShow, render, run };
  window.Settings = { ...(window.Settings || {}), open };
})();
