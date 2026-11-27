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
//   #97: the step asks which AI is the orchestrator: the Claude Code and Codex cards carry a "Use as orchestrator"
//   radio (one group, off while that CLI is missing or signed out; Grok Build none), saved at once as
//   settings.orchestratorProvider (the only ready AI is the default, saved once the CLIs are checked, and again
//   by Finish), the workflows read again (their requirements follow it); the chosen card reads
//   Required (SetupModel.requiredTools) and the missing note names it.
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
// #110: a missing CLI's install prose in the interface language (SetupModel.installHintText), the workflows that
// will not run by name (WorkflowInputs.humanize, never their ids), and an install's console only on the step that
// started it (setup.jobStep).

(function () {
  const STEPS = [
    { id: 'agents', name: () => t('setup.agents.name'), title: () => t('setup.agents.title'), lead: () => t('setup.agents.lead') },
    { id: 'versioning', name: () => t('setup.versioning.name'), title: () => t('setup.versioning.title'), lead: () => t('setup.versioning.lead') },
    { id: 'first-project', name: () => t('setup.project.name'), title: () => t('setup.project.title'), lead: () => t('setup.project.lead') },
  ];
  const ACTION = { install: () => t('setup.install'), signIn: () => t('setup.sign_in') };
  // the CLIs the setup checks, in their rows' order (also Settings › Agents & CLIs', #740)
  const TOOL_IDS = ['claude', 'codex', 'grok', 'gh', 'glab', 'git', 'gitleaks'];
  // the Setup's own steps show them as cards, one group per step
  const AGENT_TOOLS = ['claude', 'codex', 'grok'];
  const STEP_TOOLS = { agents: AGENT_TOOLS, versioning: ['git', 'gitleaks', ...TOOL_IDS.filter((id) => ![...AGENT_TOOLS, 'git', 'gitleaks'].includes(id))] };
  // Each CLI's own logo, in its card: Simple Icons' SVGs (CC0; Claude, OpenAI for Codex, Git, GitHub, GitLab),
  // xAI's mark for Grok (Wikimedia Commons) and the Gitleaks project's avatar. The marks belong to their owners.
  const LOGOS = {
    claude: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>',
    codex: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>',
    grok: '<svg viewBox="0 0 466.04 516.93" fill="currentColor" aria-hidden="true"><polygon points="0.12 182.71 234.14 516.92 338.15 516.92 104.13 182.71 0.12 182.71"/><polygon points="0 516.92 104.08 516.92 156.08 442.67 104.04 368.34 0 516.92"/><polygon points="466.04 0 361.96 0 182.1 256.86 234.15 331.18 466.04 0"/><polygon points="380.78 516.92 466.04 516.92 466.04 37.16 380.78 158.92 380.78 516.92"/></svg>',
    git: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.09 23.549a1.54 1.54 0 0 1-2.18 0L.451 13.089a1.54 1.54 0 0 1 0-2.179l7.191-7.19 2.733 2.733a1.85 1.85 0 0 0 .964 2.326v6.66a1.849 1.849 0 1 0 1.54 0V8.957l2.508 2.508a1.85 1.85 0 1 0 1.09-1.09l-2.634-2.634a1.85 1.85 0 0 0-2.378-2.377L8.73 2.63 10.91.451a1.54 1.54 0 0 1 2.179 0l10.459 10.46a1.54 1.54 0 0 1 0 2.179z"/></svg>',
    gh: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>',
    glab: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z"/></svg>',
    gitleaks: '<img alt="" src="data:image/png;base64,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" />',
  };
  const CHECK_ICON = '<svg class="setup-check-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>';
  const setup = {
    step: 0,
    open: false,
    tools: null,       // env:details, null while checking
    onboarded: false,  // #846: First project opened the onboarding wizard
    job: null,         // #740: the install / sign-in job its console shows
    jobStep: null,     // #110: the id of the step that started it (its console shows there only)
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
        <div class="setup-head">
          <div class="setup-head-text">
            <h3 id="setup-title"></h3>
            <p id="setup-lead" class="muted"></p>
          </div>
          <button type="button" id="btn-setup-check" class="btn sm ghost btn-icon setup-check" data-setup-check data-testid="setup-check-again" title="${t('setup.check_again_help')}">${CHECK_ICON}<span id="setup-check-label">${t('setup.check_again')}</span></button>
        </div>
        <div id="setup-body" class="setup-body"></div>
        <div class="modal-actions setup-actions">
          <button type="button" id="btn-setup-skip" class="btn ghost" data-testid="setup-skip">${t('setup.skip')}</button>
          <button type="button" id="btn-setup-simulation" class="link-btn" data-testid="setup-simulation-only" hidden>${t('setup.simulation_only')}</button>
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
    $s('#setup-check-label').textContent = t('setup.check_again');
    $s('#btn-setup-simulation').textContent = t('setup.simulation_only');
    $s('#btn-setup-check').title = t('setup.check_again_help');
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
  // #97: the CLIs that can lead a run (Grok Build cannot) and the saved one (claude by default):
  // packages/shared/orchestrator-models.js
  const Orch = () => window.OrchestratorModels;
  const savedOrchestrator = () => Orch().orchestratorOf(state.settings?.orchestratorProvider);
  // the Setup's orchestrator: the saved one, unless it is not ready and the other one is the only one ready
  function orchestrator() {
    const saved = savedOrchestrator();
    const states = statesOf();
    const ready = Orch().ORCHESTRATORS.filter((id) => states[id] === 'ready');
    return ready.length === 1 && states[saved] !== 'ready' ? ready[0] : saved;
  }
  // One AI card's "Use as orchestrator" radio (also Settings › Agents & CLIs', window.SetupRows): one group
  // (name="orchestrator"; Settings' radios sit in their own <form>, another group), off until that CLI is
  // installed and signed in; `testid`: the label's own test id
  function orchestratorRadio(tool, chosen, { testid = null } = {}) {
    if (!Orch().ORCHESTRATORS.includes(tool.id)) return '';
    const ready = window.SetupModel.statusBadge(tool).state === 'ready';
    const tip = ready ? '' : ` title="${esc(t('setup.orchestrator_not_ready', { name: tool.name || window.SetupModel.toolName(tool.id) }))}"`;
    return `<label class="setup-orchestrator${ready ? '' : ' off'}"${testid ? ` data-testid="${esc(testid)}"` : ''}${tip}><input type="radio" name="orchestrator" value="${esc(tool.id)}" data-testid="setup-orchestrator-${esc(tool.id)}"${chosen === tool.id ? ' checked' : ''}${ready ? '' : ' disabled'}><span>${esc(t('setup.use_as_orchestrator'))}</span></label>`;
  }

  // saved at once; the workflows read again (their requirements are computed on the saved orchestrator, the
  // missing note reads them); focus: back on the radio chosen (not after checkAgents' default)
  async function saveOrchestrator(id, { focus = true } = {}) {
    try {
      state.settings = await api.setSettings({ orchestratorProvider: id });
    } catch (e) { showToast(t('setup.save_failed'), errMsg(e)); return; }
    try { state.workflows = await api.listWorkflows(); } catch { /* the list stays */ }
    if (!setup.open) return;
    render();
    if (focus) $s(`[data-testid="setup-orchestrator-${id}"]`)?.focus({ preventScroll: true });
  }
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
    const need = window.SetupModel.toolRequirement(tool.id, { orchestrator: state.settings?.orchestratorProvider });
    const detail = tool.checking ? '' : tool.path ? [tool.version, tool.account ? t('setup.account', { account: tool.account }) : ''].filter(Boolean).join(' · ')
      : !tool.installCommand && tool.installHint ? t('setup.install_hint', { hint: window.SetupModel.installHintText(tool) }) : '';
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

  // One CLI's card in the Setup's own steps: the same facts and action as its row, stacked.
  function cliCard(tool) {
    const badge = window.SetupModel.statusBadge(tool);
    const chosen = orchestrator();
    const required = window.SetupModel.toolRequirement(tool.id, { orchestrator: chosen }) === t('setup.required');
    const name = tool.name || window.SetupModel.toolName(tool.id);
    const detail = tool.checking ? '' : tool.path ? [tool.version, tool.account ? t('setup.account', { account: tool.account }) : ''].filter(Boolean).join(' · ')
      : !tool.installCommand && tool.installHint ? t('setup.install_hint', { hint: window.SetupModel.installHintText(tool) }) : '';
    const command = !tool.checking && !tool.path ? tool.installCommand : !tool.checking && !tool.connected && tool.auth ? tool.signInCommand : null;
    return `
      <div class="setup-tool" data-testid="setup-cli-${esc(tool.id)}" data-state="${badge.state}"${required ? ' data-required' : ''}${chosen === tool.id ? ' data-orchestrator' : ''}>
        <div class="setup-tool-top">
          <span class="badge${required ? ' setup-required' : ''}">${esc(required ? t('setup.required') : t('setup.optional'))}</span>
          <span class="conn setup-conn ${badge.state === 'ready' ? 'on' : 'off'}" data-state="${badge.state}"><span class="conn-dot"></span>${esc(badge.label)}</span>
        </div>
        <span class="setup-logo" data-logo="${esc(tool.id)}" aria-hidden="true">${LOGOS[tool.id] || esc(name.slice(0, 1))}</span>
        <b class="setup-tool-name text-cut" title="${esc(name)}">${esc(name)}</b>
        <p class="setup-tool-what">${esc(t(`setup.what.${tool.id}`))}</p>
        <span class="setup-tool-grow"></span>
        ${cardDetail(tool, detail)}
        ${command ? `<code class="setup-cmd" title="${esc(command)}">${esc(command)}</code>` : ''}
        ${tool.output && badge.state !== 'ready' ? `<pre class="setup-out" data-testid="setup-cli-output">${esc(tool.output)}</pre>` : ''}
        ${tool.checking ? '' : actionButton(tool)}
        ${orchestratorRadio(tool, chosen)}
      </div>`;
  }

  // A card's version and account (an installed CLI) or its install hint.
  function cardDetail(tool, detail) {
    if (!detail) return '';
    if (!tool.path) return `<span class="setup-tool-detail hint text-cut" title="${esc(detail)}">${esc(detail)}</span>`;
    return `<span class="setup-tool-detail" title="${esc(detail)}">${tool.version ? `<span class="text-cut">${esc(tool.version)}</span>` : ''}${tool.account ? `<span class="text-cut setup-tool-account">${esc(t('setup.account', { account: tool.account }))}</span>` : ''}</span>`;
  }

  // What will not work with the CLIs as they are (Next is allowed anyway).
  function agentsNote() {
    if (!setup.tools) return '';
    const states = statesOf();
    const blocked = bundled().filter((w) => window.SetupModel.missingRequirements(w.requirements, states).length);
    if (!blocked.length) return '';
    const core = window.SetupModel.requiredTools({ orchestrator: orchestrator() }).filter((id) => states[id] !== 'ready').map(window.SetupModel.toolName);
    const head = core.length ? t('setup.without_core', { names: core.join(t('setup.and')) }) : t('setup.not_ready', { names: blocked.map((w) => window.WorkflowInputs.humanize(w.name)).join(', ') });
    return `<p class="small warn-text setup-note" data-testid="setup-missing-note">${esc(head)} ${t('setup.come_back')}</p>`;
  }

  // A step's CLIs as cards (agents: the AI CLIs; versioning: Git, the forges and the secret scan)
  function renderTools(stepId) {
    const ids = STEP_TOOLS[stepId];
    const tools = setup.tools ? ids.map((id) => setup.tools.find((tool) => tool.id === id)).filter(Boolean) : ids.map((id) => ({ id, checking: true }));
    return `
      <div class="setup-tools" data-count="${tools.length}">${tools.map(cliCard).join('')}</div>
      ${setup.job && setup.jobStep === stepId && window.SettingsClis ? window.SettingsClis.consoleHtml(setup.job) : ''}
      ${agentsNote()}`;
  }
  // the AIs step lets nobody past it without one AI CLI ready: Next is off and there is no Skip
  const aiReady = () => (setup.tools || []).some((tool) => STEP_TOOLS.agents.includes(tool.id) && window.SetupModel.statusBadge(tool).state === 'ready');
  // the version control step the same without Git, which every real run needs
  const gitReady = () => (setup.tools || []).some((tool) => tool.id === 'git' && window.SetupModel.statusBadge(tool).state === 'ready');
  const aiLocked = () => (STEPS[setup.step].id === 'agents' && !aiReady()) || (STEPS[setup.step].id === 'versioning' && !gitReady());
  const onTools = () => Boolean(STEP_TOOLS[STEPS[setup.step].id]);

  async function checkAgents() {
    setup.tools = null;
    if (onTools()) render();
    setup.tools = await loadCliStatus();
    if (!setup.open) return;
    // #97: the only ready AI shown as the orchestrator is saved as one (a Skip or Esc then keeps it too)
    if (orchestrator() !== savedOrchestrator()) await saveOrchestrator(orchestrator(), { focus: false });
    else render();
  }

  async function runAction(btn) {
    // #740: in the browser UI the command runs on the engine's machine (Settings › Agents & CLIs' job),
    // its console under the rows; the CLIs are checked again when it ends
    // a CLI without an install command (data-install-hint): its instructions, on every platform
    if ((api.platform === 'browser' || btn.dataset.installHint) && window.SettingsClis) {
      // #110: its console shows on the step that started it only (kept with the job itself: a cancelled
      // or refused click, or a later update of an earlier job, never moves another job's console)
      const step = STEPS[setup.step].id;
      await window.SettingsClis.run(btn.dataset.cliId, btn.dataset.cliAction, {
        hint: btn.dataset.installHint,
        onChange: (job) => {
          setup.job = job;
          setup.jobStep = step;
          if (setup.open && onTools()) render();
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
    $s('#setup-body').innerHTML = STEP_TOOLS[step.id] ? renderTools(step.id) : renderProject();
    const check = $s('#btn-setup-check');
    check.hidden = !STEP_TOOLS[step.id];
    check.disabled = !setup.tools;
    check.classList.toggle('checking', !setup.tools);
    $s('#btn-setup-back').disabled = setup.step === 0;
    const next = $s('#btn-setup-next');
    next.textContent = setup.step === STEPS.length - 1 ? t('setup.finish') : t('setup.next');
    next.disabled = aiLocked();
    next.title = !aiLocked() ? '' : step.id === 'agents' ? t('setup.need_ai') : t('setup.need_git');
    $s('#btn-setup-skip').hidden = Boolean(STEP_TOOLS[step.id]);
    // the way out without an AI CLI: simulations need none (not while the CLIs are still being checked)
    $s('#btn-setup-simulation').hidden = !(aiLocked() && setup.tools);
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
    // #97: its orchestrator radios share a name with Settings › Agents & CLIs': none left behind in the page,
    // and Settings' rows (open under it after "Run setup again") show the orchestrator saved here
    $s('#setup-body').innerHTML = '';
    window.SettingsClis?.refresh?.();
  }

  // #643: settings.hiddenWorkflows is never written here, an older workspace keeps what it hides
  async function finish() {
    try {
      // #97: the orchestrator shown (the only ready AI when nothing was chosen) is the one the runs use
      state.settings = await api.setSettings({ setupDone: true, orchestratorProvider: orchestrator() });
    } catch (e) { showToast(t('setup.save_setup_failed'), errMsg(e)); return; }
    close();
    // #846: the onboarding opened from here finished on its project's page, its analysis maybe still running
    // (the Imports tray): a Start drawer there (analyze-project, that project) would offer a second paid analysis
    if (setup.onboarded && state.view === 'project') return;
    openDrawer({}).catch((e) => showToast(t('setup.open_start_failed'), errMsg(e)));
  }

  async function skip() {
    if (onTools()) return; // no Skip on the steps that list CLIs (Esc neither)
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
    $s('#btn-setup-check').onclick = checkAgents;
    $s('#btn-setup-simulation').onclick = () => go(1);
    const body = $s('#setup-body');
    body.addEventListener('click', (e) => {
      const run = e.target.closest('[data-setup-run]');
      if (run) return runAction(run);
      if (e.target.closest('[data-setup-project]')) return newProject();
      return undefined;
    });
    // #97: a new orchestrator (a click or the arrow keys), saved at once
    body.addEventListener('change', (e) => {
      if (e.target?.name === 'orchestrator' && e.target.type === 'radio' && !e.target.disabled) saveOrchestrator(e.target.value);
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
  window.SetupRows = { // LOGOS: the project wizard's provider tiles too
    LOGOS,
    TOOL_IDS,
    cliRow,
    orchestratorRadio,
  };
})();
