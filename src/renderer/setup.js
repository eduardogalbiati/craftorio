// The first-run Setup (#319): a large modal with a stepper, Agents · Try it safely · Workflows ·
// First project, and Back / Next / Skip (Enter = Next, Esc = Skip after a confirm, app.js). app.js
// opens it once per workspace (settings.setupDone === false, after the workspace dialog and under
// the sign-in screen while it shows); Settings › Agents & CLIs › Run setup again reopens it. Finish
// or Skip saves setupDone, so it never opens by itself again.
// - Agents: one row per CLI (env:details) with its status badge, version, account and what it is
//   for (SetupModel), and one action, ▶ Install or ▶ Sign in, run in the terminal dock
//   (runSuggestedCommand, command-hint.js); a row re-checks when its terminal exits; disabled with
//   a tooltip where no terminal can run it (the browser UI, canRunCommands).
// - Try it safely: Show simulation mode (= settings.developerMode), on by default on a first run.
// - Workflows: the bundled workflows by category with their requirement badges and Ready / Missing
//   state; the ready ones are picked (SetupModel.preselectedWorkflows), the unpicked ones go to
//   settings.hiddenWorkflows at Finish (Workflows › Definitions › Show in Start undoes it).
// - First project: the projects, and the existing New project dialog (opened by itself when there
//   is none). Finish opens the Start drawer on the first picked workflow (Simulation checked when
//   it shows, applyDeveloperMode).
// window.Setup = { open(step), isOpen(), skip() } (app.js, Settings, scripts/screenshot.js).
// Registers its dialog with registerView (view-registry.js, modals only: no screen, no menu entry); uses app.js globals ($, esc,
// state, api, errMsg, confirmDialog, showToast, openDrawer, applyDeveloperMode, CATEGORIES),
// start-drawer.js's loadCliStatus and command-hint.js's runSuggestedCommand / canRunCommands.

(function () {
  const STEPS = [
    { id: 'agents', name: 'Agents', title: 'Connect your agents', lead: 'Each agent turn runs one of these CLIs on this computer: install the ones you want and sign in to them.' },
    { id: 'try-it-safely', name: 'Try it safely', title: 'Try it safely', lead: 'See a whole workflow run before it spends anything.' },
    { id: 'workflows', name: 'Workflows', title: 'Pick your workflows', lead: 'The picked workflows are offered in Start; the others stay in Workflows › Definitions.' },
    { id: 'first-project', name: 'First project', title: 'Add your first project', lead: 'A project is the folder or repository the workflows work on.' },
  ];
  const ACTION = { install: '▶ Install', signIn: '▶ Sign in' };
  const setup = {
    step: 0,
    open: false,
    tools: null,       // env:details, null while checking
    picked: null,      // workflow ids picked in the Workflows step (null: not shown yet)
    simulation: true,  // the Try it safely switch
  };
  const $s = (sel) => document.querySelector(`#setup-modal ${sel}`);

  const modals = `
    <div id="setup-modal" class="modal setup-modal hidden" role="dialog" aria-modal="true" aria-labelledby="setup-title" aria-describedby="setup-lead" data-testid="setup">
      <div class="modal-card setup-card">
        <ol class="setup-stepper" aria-label="Setup steps">
          ${STEPS.map((s, i) => `<li class="setup-step" data-step="${s.id}" data-testid="setup-step-${s.id}"><span class="setup-num" aria-hidden="true">${i + 1}</span>${esc(s.name)}</li>`).join('')}
        </ol>
        <h3 id="setup-title"></h3>
        <p id="setup-lead" class="muted"></p>
        <div id="setup-body" class="setup-body"></div>
        <div class="modal-actions setup-actions">
          <button type="button" id="btn-setup-skip" class="btn ghost" data-testid="setup-skip">Skip</button>
          <span class="spacer"></span>
          <button type="button" id="btn-setup-back" class="btn ghost" data-testid="setup-back">Back</button>
          <button type="button" id="btn-setup-next" class="btn primary" data-testid="setup-next">Next</button>
        </div>
      </div>
    </div>`;

  // ---------- Agents ----------
  const statesOf = () => Object.fromEntries((setup.tools || []).map((t) => [t.id, window.SetupModel.statusBadge(t).state]));
  const bundled = () => (state.workflows || []).filter((w) => !w.error && w.origin !== 'custom' && w.requirements);

  function actionButton(t) {
    const off = !canRunCommands();
    const tip = off ? ` title="${esc(NO_TERMINAL_HINT)}"` : '';
    if (!t.path && t.installCommand) return `<button type="button" class="btn sm primary" data-setup-run="${esc(t.installCommand)}" data-testid="setup-install-${esc(t.id)}"${tip}${off ? ' disabled' : ''}>${ACTION.install}</button>`;
    if (t.path && !t.connected && t.auth && t.signInCommand) return `<button type="button" class="btn sm primary" data-setup-run="${esc(t.signInCommand)}" data-sign-in data-testid="setup-sign-in-${esc(t.id)}"${tip}${off ? ' disabled' : ''}>${ACTION.signIn}</button>`;
    return '';
  }

  function cliRow(t) {
    const badge = window.SetupModel.statusBadge(t);
    const need = window.SetupModel.toolRequirement(t.id);
    const detail = t.checking ? '' : t.path ? [t.version, t.account ? `account ${t.account}` : ''].filter(Boolean).join(' · ') : !t.installCommand && t.installHint ? `Install: ${t.installHint}` : '';
    const command = !t.checking && !t.path ? t.installCommand : !t.checking && !t.connected && t.auth ? t.signInCommand : null;
    return `
      <div class="s-row setup-cli" data-testid="setup-cli-${esc(t.id)}">
        <div class="s-label">
          <b>${esc(t.name || window.SetupModel.toolName(t.id))}</b>
          <span><span class="badge${need === 'Required' ? ' setup-required' : ''}">${esc(need)}</span>${detail ? ` <span title="${esc(detail)}">${esc(detail)}</span>` : ''}</span>
          ${command ? `<code class="setup-cmd" title="${esc(command)}">${esc(command)}</code>` : ''}
          ${t.output && badge.state !== 'ready' ? `<pre class="setup-out" data-testid="setup-cli-output">${esc(t.output)}</pre>` : ''}
        </div>
        <div class="s-ctrl">
          <span class="conn setup-conn ${badge.state === 'ready' ? 'on' : 'off'}" data-state="${badge.state}"><span class="conn-dot"></span>${esc(badge.label)}</span>
          ${t.checking ? '' : actionButton(t)}
        </div>
      </div>`;
  }

  // What will not work with the CLIs as they are (Next is allowed anyway).
  function agentsNote() {
    if (!setup.tools) return '';
    const states = statesOf();
    const blocked = bundled().filter((w) => window.SetupModel.missingRequirements(w.requirements, states).length);
    if (!blocked.length) return '<p class="small setup-note">Every bundled workflow can run on this computer.</p>';
    const core = ['claude', 'git'].filter((id) => states[id] !== 'ready').map(window.SetupModel.toolName);
    const head = core.length ? `Without ${core.join(' and ')}, no workflow runs for real (simulations still do).` : `Not ready yet: ${blocked.map((w) => w.name).join(', ')}.`;
    return `<p class="small warn-text setup-note" data-testid="setup-missing-note">${esc(head)} You can go on and come back later from Settings › Agents &amp; CLIs.</p>`;
  }

  function renderAgents() {
    const ids = ['claude', 'codex', 'grok', 'gh', 'glab', 'git'];
    const tools = setup.tools || ids.map((id) => ({ id, checking: true }));
    return `
      <div class="s-group setup-clis">${tools.map(cliRow).join('')}</div>
      <div class="row setup-row">
        <button type="button" class="btn sm ghost" data-setup-check data-testid="setup-check-again" ${setup.tools ? '' : 'disabled'}>Check again</button>
        <span class="muted small">After installing or signing in, press Check again (or end its terminal: the rows check again by themselves).</span>
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
    const tab = await runSuggestedCommand(btn.dataset.setupRun, { signIn: btn.dataset.signIn !== undefined });
    // the dock's own repaint, then this row's CLI checked again (the terminal ended: installed, signed in)
    if (tab) tab.onChange = () => { renderTermTabs(); if (setup.open) checkAgents(); };
  }

  // ---------- Try it safely ----------
  function renderTry() {
    return `
      <p>Real runs use your own CLI subscriptions or API credits: each agent turn is billed by its provider.</p>
      <p>A simulation runs the whole flow (steps, gates, results) with made-up answers: no CLI is called and nothing is spent.</p>
      <div class="s-group">
        <div class="s-row">
          <div class="s-label"><b>Show simulation mode</b><span>Adds a Simulation checkbox to Start, checked by default. Turn it off later in Settings › Execution › Developer mode.</span></div>
          <label class="switch"><input type="checkbox" data-setup-sim data-testid="setup-simulation" aria-label="Show simulation mode" ${setup.simulation ? 'checked' : ''} /><span></span></label>
        </div>
      </div>`;
  }

  // ---------- Workflows ----------
  function workflowCard(w) {
    const id = window.SetupModel.workflowId(w.file);
    const missing = window.SetupModel.missingRequirements(w.requirements, statesOf());
    const badges = window.SetupModel.requirementBadges(w.requirements).map((b) => `<span class="badge">${esc(b)}</span>`).join('');
    const ready = !missing.length;
    return `
      <label class="setup-wf${setup.picked.includes(id) ? ' picked' : ''}" data-testid="setup-workflow-${esc(id)}">
        <input type="checkbox" data-setup-wf="${esc(id)}" ${setup.picked.includes(id) ? 'checked' : ''} aria-label="Show ${esc(w.name)} in Start" />
        <span class="setup-wf-main">
          <b title="${esc(w.name)}">${esc(w.name)}</b>
          <span class="muted small setup-wf-desc" title="${esc(w.description || '')}">${esc(w.description || '')}</span>
          <span class="setup-wf-tags">${badges}<span class="pill ${ready ? 'pill-success' : 'pill-cancelled'}" title="${esc(ready ? 'Everything it needs is installed and signed in' : window.SetupModel.missingLabel(missing))}">${esc(ready ? 'Ready' : window.SetupModel.missingLabel(missing))}</span></span>
        </span>
      </label>`;
  }

  function renderWorkflows() {
    if (!setup.tools) return '<p class="muted">Checking the CLIs…</p>';
    const list = bundled();
    if (!list.length) return '<p class="muted">No bundled workflows found in the workspace\'s workflows/ folder.</p>';
    if (!setup.picked) {
      const hidden = state.settings.hiddenWorkflows || [];
      // a first run picks what is ready; a run again starts from what Start shows today
      setup.picked = state.settings.setupDone ? list.map((w) => window.SetupModel.workflowId(w.file)).filter((id) => !hidden.includes(id))
        : window.SetupModel.preselectedWorkflows(list.map((w) => ({ id: window.SetupModel.workflowId(w.file), requirements: w.requirements })), statesOf());
    }
    const first = (a, b) => (window.SetupModel.workflowId(b.file) === window.SetupModel.FIRST) - (window.SetupModel.workflowId(a.file) === window.SetupModel.FIRST);
    return Object.entries(CATEGORIES).map(([cat, label]) => {
      const items = list.filter((w) => (w.category || 'build') === cat).sort(first);
      return items.length ? `<section class="setup-wf-group"><h4 class="badge cat-${esc(cat)}">${esc(label)}</h4><div class="setup-wfs">${items.map(workflowCard).join('')}</div></section>` : '';
    }).join('') + `<p class="muted small" data-testid="setup-picked-count">${setup.picked.length ? `${setup.picked.length} picked` : 'None picked: Start keeps offering them all'}. Workflows › Definitions › Show in Start changes it later; nothing is deleted.</p>`;
  }

  // ---------- First project ----------
  function renderProject() {
    const projects = state.projects || [];
    const list = projects.length
      ? `<div class="s-group">${projects.map((p) => `<div class="s-row"><div class="s-label"><b title="${esc(p.name)}">${esc(p.name)}</b><span title="${esc(p.folder)}">${esc(p.folder)}</span></div></div>`).join('')}</div>`
      : '<div class="empty-state setup-empty"><b>No project yet</b><p class="muted small">Add the folder of a repository you work on. Simulations do not need one.</p></div>';
    return `${list}<div class="row setup-row"><button type="button" class="btn sm" data-setup-project data-testid="setup-new-project">New project</button><span class="muted small">Finish opens Start on your first picked workflow.</span></div>`;
  }

  function newProject() {
    openProjectModal(null, { fromHeader: true });
    // the dialog has no callback: the list is read again when it closes
    const modal = document.getElementById('project-modal');
    const watch = new MutationObserver(async () => {
      if (!modal.classList.contains('hidden')) return;
      watch.disconnect();
      try { state.projects = await api.listProjects(); } catch { /* the list stays */ }
      if (setup.open && STEPS[setup.step].id === 'first-project') render();
    });
    watch.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  // ---------- the stepper ----------
  function render() {
    const step = STEPS[setup.step];
    document.querySelectorAll('#setup-modal .setup-step').forEach((li, i) => {
      li.classList.toggle('done', i < setup.step);
      if (i === setup.step) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    $s('#setup-title').textContent = step.title;
    $s('#setup-lead').textContent = step.lead;
    $s('#setup-body').innerHTML = { agents: renderAgents, 'try-it-safely': renderTry, workflows: renderWorkflows, 'first-project': renderProject }[step.id]();
    $s('#btn-setup-back').disabled = setup.step === 0;
    $s('#btn-setup-next').textContent = setup.step === STEPS.length - 1 ? 'Finish' : 'Next';
  }

  async function saveSimulation() {
    if (!!state.settings.developerMode === setup.simulation) return;
    state.settings = await api.setSettings({ developerMode: setup.simulation });
    applyDeveloperMode();
  }

  async function go(delta) {
    try {
      if (STEPS[setup.step].id === 'try-it-safely') await saveSimulation();
    } catch (e) { showToast('Could not save', errMsg(e)); return; }
    setup.step = Math.max(0, Math.min(STEPS.length - 1, setup.step + delta));
    render();
    if (STEPS[setup.step].id === 'first-project' && !(state.projects || []).length && delta > 0) newProject();
    $s('#btn-setup-next').focus({ preventScroll: true });
  }

  function close() {
    setup.open = false;
    document.getElementById('setup-modal').classList.add('hidden');
    document.body.classList.remove('setup-open');
  }

  async function finish() {
    const ids = bundled().map((w) => window.SetupModel.workflowId(w.file));
    const picked = setup.picked || ids.filter((id) => !(state.settings.hiddenWorkflows || []).includes(id));
    // the unpicked bundled workflows are hidden (none picked: none hidden, Start is never left empty);
    // custom ones keep what they had
    const unpicked = picked.length ? ids.filter((id) => !picked.includes(id)) : [];
    const hidden = [...new Set([...(state.settings.hiddenWorkflows || []).filter((id) => !ids.includes(id)), ...unpicked])];
    try {
      state.settings = await api.setSettings({ setupDone: true, developerMode: setup.simulation, hiddenWorkflows: hidden });
    } catch (e) { showToast('Could not save the setup', errMsg(e)); return; }
    applyDeveloperMode();
    close();
    const first = picked.includes(window.SetupModel.FIRST) ? window.SetupModel.FIRST : ids.find((id) => picked.includes(id));
    const file = first && (state.workflows || []).find((w) => window.SetupModel.workflowId(w.file) === first)?.file;
    openDrawer(file ? { workflow: file } : {}).catch((e) => showToast('Could not open Start', errMsg(e)));
  }

  async function skip() {
    if (!(await confirmDialog('Skip the setup?', 'Nothing more is changed. You can run it again from Settings › Agents & CLIs.', 'Skip'))) return;
    try {
      state.settings = await api.setSettings({ setupDone: true });
    } catch (e) { showToast('Could not save', errMsg(e)); return; }
    close();
  }

  async function open(stepId = 'agents') {
    setup.step = Math.max(0, STEPS.findIndex((s) => s.id === stepId));
    setup.open = true;
    setup.picked = null;
    setup.simulation = state.settings.setupDone === false ? true : !!state.settings.developerMode;
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
    body.addEventListener('change', (e) => {
      if (e.target.matches('[data-setup-sim]')) setup.simulation = e.target.checked;
      const wf = e.target.closest('[data-setup-wf]');
      if (!wf) return;
      const id = wf.dataset.setupWf;
      setup.picked = wf.checked ? [...setup.picked.filter((x) => x !== id), id] : setup.picked.filter((x) => x !== id);
      render();
      $s(`[data-setup-wf="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    });
    // Enter = Next, except on a control that has its own Enter (a button, a field, a link)
    document.getElementById('setup-modal').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.closest('button, a, input, select, textarea')) return;
      e.preventDefault();
      $s('#btn-setup-next').click();
    });
  }

  registerView({ id: 'setup', modals, mount });
  window.Setup = { isOpen: () => setup.open, open, skip };
})();
