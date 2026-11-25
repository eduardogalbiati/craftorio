// The first-run Setup (#319): a large modal with a stepper, Agents · First project (#643: no Workflows step any
// more; #69: nor a simulation one), and Back / Next / Skip (Enter = Next, Esc = Skip after a confirm, app.js). app.js
// opens it once per workspace (settings.setupDone === false, after the workspace dialog and under
// the sign-in screen while it shows); Settings › Agents & CLIs › Run setup again reopens it. Finish
// or Skip saves setupDone, so it never opens by itself again. #740: it stays first-run only; the CLIs
// are managed in Settings › Agents & CLIs (views/settings/settings-clis.js, the same rows: window.SetupRows),
// which the project wizard's Open Setup opens instead of this modal.
// - Agents: one row per CLI (env:details) with its status badge, version, account and what it is
//   for (SetupModel), and one action, ▶ Install or ▶ Sign in, run in the terminal dock
//   (runSuggestedCommand, command-hint.js); a row re-checks when its terminal exits; disabled with
//   a tooltip where no terminal can run it (canRunCommands). #740: in the browser UI the action runs on
//   the engine's machine (SettingsClis.run, cli-setup:start) with its console under the rows.
// - First project: the projects, and New project opening the onboarding wizard (#643,
//   the action openProjectWizard of fronts/build/views/projects/project-wizard.js, no button without
//   it; opened by itself when there is none, over the Setup, which then leaves it the focus; the
//   list is read again when it closes). Finish saves setupDone only, never
//   settings.hiddenWorkflows (what a workspace hides from Start stays) nor developerMode (#69: the simulation is
//   turned on in Settings › Execution), then opens the Start drawer; #846: not after an onboarding
//   opened from First project that left its project's page open (its analysis may still run).
// window.Setup = { open(step), isOpen(), skip() } (app.js, Settings, scripts/screenshot.js).
// Registers its dialog with registerView (view-registry.js, modals only: no screen, no menu entry); uses app.js globals ($, esc,
// state, api, errMsg, confirmDialog, showToast, openDrawer),
// start-drawer.js's loadCliStatus and command-hint.js's runSuggestedCommand / canRunCommands.
// #329: every text comes from the catalog through t (packages/shared/i18n.js, setup.* keys); the
// Interface language select above the stepper opens on the interface language (the saved one, else
// the computer's when it has a catalog, else English), saves settings.language.interface and redraws
// the app in it (interface-language.js); the dialog repaints its texts on I18n.onChange.

(function () {
  const STEPS = [
    { id: 'agents', name: () => t('setup.agents.name'), title: () => t('setup.agents.title'), lead: () => t('setup.agents.lead') },
    { id: 'first-project', name: () => t('setup.project.name'), title: () => t('setup.project.title'), lead: () => t('setup.project.lead') },
  ];
  const ACTION = { install: () => t('setup.install'), signIn: () => t('setup.sign_in') };
  // the CLIs the setup checks, in their rows' order (also Settings › Agents & CLIs', #740)
  const TOOL_IDS = ['claude', 'codex', 'grok', 'gh', 'glab', 'git', 'gitleaks'];
  const setup = {
    step: 0,
    open: false,
    tools: null,       // env:details, null while checking
    onboarded: false,  // #846: First project opened the onboarding wizard
  };
  const $s = (sel) => document.querySelector(`#setup-modal ${sel}`);

  const stepperHtml = () => STEPS.map((s, i) => `<li class="setup-step" data-step="${s.id}" data-testid="setup-step-${s.id}"><span class="setup-num" aria-hidden="true">${i + 1}</span>${esc(s.name())}</li>`).join('');
  // the interface language: the saved one, else the one the page runs in (I18n.resolveLanguage)
  const languageHtml = () => `<label class="setup-language small"><span class="muted">${t('setup.language')}</span>
          ${window.Select.markup(`data-setup-language data-testid="setup-language" aria-label="${t('setup.language')}"`, window.I18n.languages().map((code) => [code, window.Language.labelOf(code)]), window.I18n.getLanguage())}</label>`;

  const modals = () => `
    <div id="setup-modal" class="modal setup-modal hidden" role="dialog" aria-modal="true" aria-labelledby="setup-title" aria-describedby="setup-lead" data-testid="setup">
      <div class="modal-card setup-card">
        <div class="row setup-top">
          <ol class="setup-stepper" aria-label="${t('setup.steps')}">${stepperHtml()}</ol>
          <span class="spacer"></span>
          <span id="setup-language-box">${languageHtml()}</span>
        </div>
        <h3 id="setup-title"></h3>
        <p id="setup-lead" class="muted"></p>
        <div id="setup-body" class="setup-body"></div>
        <div class="modal-actions setup-actions">
          <button type="button" id="btn-setup-skip" class="btn ghost" data-testid="setup-skip">${t('setup.skip')}</button>
          <span class="spacer"></span>
          <button type="button" id="btn-setup-back" class="btn ghost" data-testid="setup-back">${t('setup.back')}</button>
          <button type="button" id="btn-setup-next" class="btn primary" data-testid="setup-next">${t('setup.next')}</button>
        </div>
      </div>
    </div>`;

  // a new interface language (#329): the dialog's own texts, then the step
  function repaint() {
    const modal = document.getElementById('setup-modal');
    if (!modal) return;
    $s('.setup-stepper').innerHTML = stepperHtml();
    $s('.setup-stepper').setAttribute('aria-label', t('setup.steps'));
    $s('#setup-language-box').innerHTML = languageHtml();
    $s('#btn-setup-skip').textContent = t('setup.skip');
    $s('#btn-setup-back').textContent = t('setup.back');
    if (setup.open) render();
    else $s('#btn-setup-next').textContent = t('setup.next');
  }

  async function saveLanguage(code) {
    try {
      state.settings = await api.setSettings(window.LanguageSettings.patch(state.settings, 'interface', code));
    } catch (e) { showToast(t('setup.save_failed'), errMsg(e)); return; }
    window.InterfaceLanguage?.apply(state.settings);
  }

  // ---------- Agents ----------
  const statesOf = () => Object.fromEntries((setup.tools || []).map((t) => [t.id, window.SetupModel.statusBadge(t).state]));
  const bundled = () => (state.workflows || []).filter((w) => !w.error && w.origin !== 'custom' && w.requirements);

  // #740: data-cli-id / data-cli-action name the engine's job (cli-setup:start) the button starts
  function actionButton(tool) {
    const off = !canRunCommands();
    const tip = off ? ` title="${esc(NO_TERMINAL_HINT)}"` : '';
    if (!tool.path && tool.installCommand) return `<button type="button" class="btn sm primary" data-setup-run="${esc(tool.installCommand)}" data-cli-id="${esc(tool.id)}" data-cli-action="install" data-testid="setup-install-${esc(tool.id)}"${tip}${off ? ' disabled' : ''}>${ACTION.install()}</button>`;
    // a CLI without a one-line installer here (glab on Linux, #316): ▶ Install runs nothing, it shows what
    // to install on the engine's machine (the console's manual state, Settings › Agents & CLIs' run)
    if (!tool.checking && !tool.path && tool.installHint && window.SettingsClis) return `<button type="button" class="btn sm primary" data-setup-run="" data-install-hint="${esc(tool.installHint)}" data-cli-id="${esc(tool.id)}" data-cli-action="install" data-testid="setup-install-${esc(tool.id)}">${ACTION.install()}</button>`;
    if (tool.path && !tool.connected && tool.auth && tool.signInCommand) return `<button type="button" class="btn sm primary" data-setup-run="${esc(tool.signInCommand)}" data-sign-in data-cli-id="${esc(tool.id)}" data-cli-action="login" data-testid="setup-sign-in-${esc(tool.id)}"${tip}${off ? ' disabled' : ''}>${ACTION.signIn()}</button>`;
    return '';
  }

  // One CLI's row (also Settings › Agents & CLIs', #740: window.SetupRows); `highlight`: the id of the CLI
  // a deep link was opened for (data-highlight on its row only).
  function cliRow(tool, { highlight = null } = {}) {
    const badge = window.SetupModel.statusBadge(tool);
    const need = window.SetupModel.toolRequirement(tool.id);
    const detail = tool.checking ? '' : tool.path ? [tool.version, tool.account ? t('setup.account', { account: tool.account }) : ''].filter(Boolean).join(' · ')
      : !tool.installCommand && tool.installHint ? t('setup.install_hint', { hint: tool.installHint }) : '';
    const command = !tool.checking && !tool.path ? tool.installCommand : !tool.checking && !tool.connected && tool.auth ? tool.signInCommand : null;
    return `
      <div class="s-row setup-cli${highlight && tool.id === highlight ? ' highlight' : ''}" data-testid="setup-cli-${esc(tool.id)}"${highlight && tool.id === highlight ? ' data-highlight' : ''}>
        <div class="s-label">
          <b>${esc(tool.name || window.SetupModel.toolName(tool.id))}</b>
          <span><span class="badge${need === t('setup.required') ? ' setup-required' : ''}">${esc(need)}</span>${detail ? ` <span title="${esc(detail)}">${esc(detail)}</span>` : ''}</span>
          ${command ? `<code class="setup-cmd" title="${esc(command)}">${esc(command)}</code>` : ''}
          ${tool.output && badge.state !== 'ready' ? `<pre class="setup-out" data-testid="setup-cli-output">${esc(tool.output)}</pre>` : ''}
        </div>
        <div class="s-ctrl">
          <span class="conn setup-conn ${badge.state === 'ready' ? 'on' : 'off'}" data-state="${badge.state}"><span class="conn-dot"></span>${esc(badge.label)}</span>
          ${tool.checking ? '' : actionButton(tool)}
        </div>
      </div>`;
  }

  // What will not work with the CLIs as they are (Next is allowed anyway).
  function agentsNote() {
    if (!setup.tools) return '';
    const states = statesOf();
    const blocked = bundled().filter((w) => window.SetupModel.missingRequirements(w.requirements, states).length);
    if (!blocked.length) return `<p class="small setup-note">${t('setup.all_ready')}</p>`;
    const core = ['claude', 'git'].filter((id) => states[id] !== 'ready').map(window.SetupModel.toolName);
    const head = core.length ? t('setup.without_core', { names: core.join(t('setup.and')) }) : t('setup.not_ready', { names: blocked.map((w) => w.name).join(', ') });
    return `<p class="small warn-text setup-note" data-testid="setup-missing-note">${esc(head)} ${t('setup.come_back')}</p>`;
  }

  function renderAgents() {
    const tools = setup.tools || TOOL_IDS.map((id) => ({ id, checking: true }));
    return `
      <div class="s-group setup-clis">${tools.map((tool) => cliRow(tool)).join('')}</div>
      ${setup.job && window.SettingsClis ? window.SettingsClis.consoleHtml(setup.job) : ''}
      <div class="row setup-row">
        <button type="button" class="btn sm ghost" data-setup-check data-testid="setup-check-again" ${setup.tools ? '' : 'disabled'}>${t('setup.check_again')}</button>
        <span class="muted small">${t('setup.check_again_help')}</span>
      </div>
      ${agentsNote()}`;
  }

  async function checkAgents() {
    setup.tools = null;
    if (STEPS[setup.step].id === 'agents') render();
    setup.tools = await loadCliStatus();
    if (setup.open) render();
  }

  async function runAction(btn) {
    // #740: in the browser UI the command runs on the engine's machine (Settings › Agents & CLIs' job),
    // its console under the rows; the CLIs are checked again when it ends
    // a CLI without an install command (data-install-hint): its instructions, on every platform
    if ((api.platform === 'browser' || btn.dataset.installHint) && window.SettingsClis) {
      await window.SettingsClis.run(btn.dataset.cliId, btn.dataset.cliAction, {
        hint: btn.dataset.installHint,
        onChange: (job) => {
          setup.job = job;
          if (setup.open && STEPS[setup.step].id === 'agents') render();
          if (job.status !== 'running' && job.status !== 'manual' && setup.open) checkAgents();
        },
      });
      return;
    }
    const tab = await runSuggestedCommand(btn.dataset.setupRun, { signIn: btn.dataset.signIn !== undefined });
    // the dock's own repaint, then this row's CLI checked again (the terminal ended: installed, signed in)
    if (tab) tab.onChange = () => { renderTermTabs(); if (setup.open) checkAgents(); };
  }

  // ---------- First project ----------
  function renderProject() {
    const projects = state.projects || [];
    const list = projects.length
      ? `<div class="s-group">${projects.map((p) => `<div class="s-row"><div class="s-label"><b title="${esc(p.name)}">${esc(p.name)}</b><span title="${esc(p.folder)}">${esc(p.folder)}</span></div></div>`).join('')}</div>`
      : `<div class="empty-state setup-empty"><b>${t('setup.project.empty')}</b><p class="muted small">${t('setup.project.empty_help')}</p></div>`;
    const button = canNewProject() ? `<button type="button" class="btn sm" data-setup-project data-testid="setup-new-project">${t('setup.project.new')}</button>` : '';
    return `${list}<div class="row setup-row">${button}<span class="muted small">${t('setup.project.finish_help')}</span></div>`;
  }

  // the wizard is the build front's action: without that front, no New project in the Setup
  const canNewProject = () => window.Actions.has('openProjectWizard');

  function newProject() {
    if (!canNewProject()) return false;
    setup.onboarded = true; // #846: Finish then leaves the project's page the wizard opened, no Start drawer
    window.Actions.call('openProjectWizard');
    // the wizard has no callback: the list is read again when it closes (hidden)
    const wizard = document.getElementById('project-wizard');
    if (!wizard || typeof MutationObserver !== 'function') return true;
    const watch = new MutationObserver(async () => {
      if (!wizard.hidden) return;
      watch.disconnect();
      try { state.projects = await api.listProjects(); } catch { /* the list stays */ }
      if (setup.open && STEPS[setup.step].id === 'first-project') render();
    });
    watch.observe(wizard, { attributes: true, attributeFilter: ['hidden'] });
    return true;
  }

  // ---------- the stepper ----------
  function render() {
    const step = STEPS[setup.step];
    document.querySelectorAll('#setup-modal .setup-step').forEach((li, i) => {
      li.classList.toggle('done', i < setup.step);
      if (i === setup.step) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    $s('#setup-title').textContent = step.title();
    $s('#setup-lead').textContent = step.lead();
    $s('#setup-body').innerHTML = { agents: renderAgents, 'first-project': renderProject }[step.id]();
    $s('#btn-setup-back').disabled = setup.step === 0;
    $s('#btn-setup-next').textContent = setup.step === STEPS.length - 1 ? t('setup.finish') : t('setup.next');
  }

  function go(delta) {
    setup.step = Math.max(0, Math.min(STEPS.length - 1, setup.step + delta));
    render();
    // the wizard opened over the Setup keeps the focus, so Enter never reaches Finish under it
    if (STEPS[setup.step].id === 'first-project' && !(state.projects || []).length && delta > 0 && newProject()) return;
    $s('#btn-setup-next').focus({ preventScroll: true });
  }

  function close() {
    setup.open = false;
    document.getElementById('setup-modal').classList.add('hidden');
    document.body.classList.remove('setup-open');
  }

  // #643: settings.hiddenWorkflows is never written here, an older workspace keeps what it hides
  async function finish() {
    try {
      state.settings = await api.setSettings({ setupDone: true });
    } catch (e) { showToast(t('setup.save_setup_failed'), errMsg(e)); return; }
    close();
    // #846: the onboarding opened from here finished on its project's page, its analysis maybe still running
    // (the Imports tray): a Start drawer there (analyze-project, that project) would offer a second paid analysis
    if (setup.onboarded && state.view === 'project') return;
    openDrawer({}).catch((e) => showToast(t('setup.open_start_failed'), errMsg(e)));
  }

  async function skip() {
    if (!(await confirmDialog(t('setup.skip_title'), t('setup.skip_body'), t('setup.skip')))) return;
    try {
      state.settings = await api.setSettings({ setupDone: true });
    } catch (e) { showToast(t('setup.save_failed'), errMsg(e)); return; }
    close();
  }

  async function open(stepId = 'agents') {
    setup.step = Math.max(0, STEPS.findIndex((s) => s.id === stepId));
    setup.open = true;
    setup.onboarded = false;
    // a first run records that it is not done yet, so quitting before Finish or Skip opens it again
    // even after another setting was saved (workspace.js writeSettings leaves an unknown setupDone out)
    if (state.settings.setupDone === false) api.setSettings({ setupDone: false }).catch(() => {});
    document.body.classList.add('setup-open');
    document.getElementById('setup-modal').classList.remove('hidden');
    render();
    $s('#btn-setup-next').focus({ preventScroll: true });
    try {
      [state.workflows, state.projects] = await Promise.all([api.listWorkflows(), api.listProjects()]);
    } catch { /* the lists app.js loaded stay */ }
    await checkAgents();
  }

  function mount() {
    $s('#btn-setup-skip').onclick = skip;
    $s('#btn-setup-back').onclick = () => go(-1);
    $s('#btn-setup-next').onclick = () => (setup.step === STEPS.length - 1 ? finish() : go(1));
    const body = $s('#setup-body');
    body.addEventListener('click', (e) => {
      const run = e.target.closest('[data-setup-run]');
      if (run) return runAction(run);
      if (e.target.closest('[data-setup-check]')) return checkAgents();
      if (e.target.closest('[data-setup-project]')) return newProject();
      return undefined;
    });
    $s('#setup-language-box').addEventListener('change', (e) => {
      if (e.target.matches('[data-setup-language]')) saveLanguage(e.target.value);
    });
    window.I18n.onChange(repaint);
    // Enter = Next, except on a control that has its own Enter (a button, a field, a link)
    document.getElementById('setup-modal').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.closest('button, a, input, select, textarea')) return;
      e.preventDefault();
      $s('#btn-setup-next').click();
    });
  }

  registerView({ id: 'setup', modals, mount });
  window.Setup = { isOpen: () => setup.open, open, skip };
  window.SetupRows = { TOOL_IDS, cliRow };
})();
