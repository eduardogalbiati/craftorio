/* global api */
// Workflows screen and its sidebar sub-items (state.workflowsTab): Runs (every run, in the shared run
// list of run-list.js), Definitions (the workflow files with their steps, origin badge, Restore
// default, Send to builder, Run) and Builder (builder.js, with its two dialogs). The header has the
// Keep awake switch on Runs and Definitions (keep-awake.js, #162). The deep links
// showRunInList (app.js openPastRun) and showWorkflowDefinition (the Agents menu), and the runs'
// reload on run events (loadWorkflowRunsThrottled, workflowRunsVisible, renderWorkflowRuns) stay
// globals. Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state,
// api, errMsg, showView, openDrawer, noteRunMeta, confirmDialog, showToast, CATEGORIES).

const WORKFLOW_PAGES = {
  runs: 'Every run, live or finished.',
  definitions: 'Workflows are YAML files in the workflows folder.',
  builder: 'Draw a workflow: desks in a line, each with an agent, and approval gates. Saved as YAML in the workflows folder.',
};
function showWorkflowsTab(tab) {
  if (!WORKFLOW_PAGES[tab]) tab = 'runs';
  state.workflowsTab = tab;
  if (state.view !== 'workflows') return showView('workflows');
  document.querySelectorAll('[data-wtab]').forEach((b) => {
    const on = b.dataset.wtab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  document.querySelectorAll('[data-wpage]').forEach((p) => p.classList.toggle('hidden', p.dataset.wpage !== tab));
  $('#workflows-page-title').textContent = { runs: 'Runs', definitions: 'Definitions', builder: 'Builder' }[tab];
  $('#workflows-page-hint').textContent = WORKFLOW_PAGES[tab];
  // Keep awake (#162) on Runs and Definitions; the Builder needs the room
  $('#workflows-keep-awake').classList.toggle('hidden', tab === 'builder');
  if (tab !== 'builder') refreshKeepAwake();
  if (tab === 'definitions') refreshWorkflows();
  if (tab === 'runs') { renderWorkflowRuns(); loadWorkflowRuns(); }
  if (tab === 'builder') window.showBuilder?.();
}

const workflowRunsVisible = () => state.view === 'workflows' && state.workflowsTab === 'runs';

// Every run, in the same list as Projects > Project.
function renderWorkflowRuns() {
  renderRunList(state.wr, {
    prefix: 'workflow', box: '#workflow-runs', empty: 'No workflows have run yet.',
    start: () => openDrawer(), rerender: renderWorkflowRuns,
  });
}

let wrLoading = null;
let wrLastLoad = 0;
let wrTimer = null;
function loadWorkflowRuns() {
  if (wrLoading) return wrLoading;
  const wr = state.wr;
  wrLoading = (async () => {
    try {
      wr.runs = (await api.listRuns()).runs || [];
      wr.error = null;
      noteRunMeta(wr.runs);
    } catch (e) {
      wr.error = errMsg(e);
    }
    wrLoading = null;
    wrLastLoad = Date.now();
    if (workflowRunsVisible()) renderWorkflowRuns();
  })();
  return wrLoading;
}

// At most one reload every 3 s from run events while the tab is visible.
function loadWorkflowRunsThrottled() {
  if (wrTimer || !workflowRunsVisible()) return;
  const wait = Math.max(0, 3000 - (Date.now() - wrLastLoad));
  wrTimer = setTimeout(() => { wrTimer = null; if (workflowRunsVisible()) loadWorkflowRuns(); }, wait);
}

async function refreshWorkflows() {
  state.workflows = await api.listWorkflows();
  const box = $('#workflows-list');
  if (!state.workflows.length) {
    box.innerHTML = '<div class="empty-state"><b>No workflows</b><p class="muted">Add .yaml files to the workflows folder.</p></div>';
    return;
  }
  box.innerHTML = state.workflows.map((w) => {
    const steps = (w.steps || []).map((s, i) => {
      const human = s.type === 'human_approval';
      const names = s.agents || [s.agent];
      const who = names.map((n) => `${esc(n)}${w.agents?.[n] ? ` · <span class="mono">${esc(w.agents[n].model)}</span>` : ''}`).join(s.agents ? '<br>' : '');
      const skillNames = [...new Set([...(s.skills || []), ...names.flatMap((n) => w.agents?.[n]?.skills || [])])];
      const others = s.next.filter((n) => n !== w.steps[i + 1]?.id);
      return `<li class="wf-step ${human ? 'human' : ''}">
        <span class="wf-step-n">${i + 1}</span>
        <div class="wf-step-body">
          <div class="wf-step-head"><b>${esc(s.id)}</b>
            ${s.agents ? '<span class="badge">parallel</span>' : ''}${s.goal ? '<span class="badge">/goal</span>' : ''}${s.loop ? '<span class="badge">/loop</span>' : ''}
            ${skillNames.map((k) => `<span class="badge" title="skill">⚡ ${esc(k.replace(/\{\{\s*inputs\.(\w+)\s*\}\}/g, '‹$1›'))}</span>`).join('')}</div>
          <div class="muted small">${human ? 'human approval' : who}</div>
          ${others.length ? `<div class="wf-step-next small">↳ ${others.map((n) => `<span class="mono">${esc(n)}</span>`).join(', ')}</div>` : ''}
        </div>
      </li>`;
    }).join('');
    return `
    <article class="wf-card" data-file="${esc(w.file)}">
      <div class="wf-card-head">
        <div>
          <h3>${esc(w.name)} ${w.version ? `<span class="muted small">v${esc(w.version)}</span>` : ''}</h3>
          <p class="muted small">${esc(w.error ? `Error: ${w.error}` : w.description || '')}</p>
          ${Array.isArray(w.inputs?.mode?.enum) ? `<p class="small wf-modes"><b>Modes:</b> ${w.inputs.mode.enum.map((m) => `<span class="badge mono">${esc(m)}${m === w.inputs.mode.default ? ' (default)' : ''}</span>`).join(' ')} <span class="muted">${esc(w.inputs.mode.description || '')}</span></p>` : ''}
          <div class="badges">
            <span class="badge cat-${esc(w.category)}">${esc(CATEGORIES[w.category] || w.category)}</span>
            <span class="badge">${(w.steps || []).length} steps</span>
            <span class="badge">${Object.keys(w.agents || {}).length} agents</span>
            <span class="badge mono">${esc(w.file)}</span>
            ${originBadge(w)}
          </div>
        </div>
        <div class="row">
          ${w.restorable ? '<button class="btn ghost sm" data-restore title="Move your edited copy to the trash and use the default bundled with the app">Restore default</button>' : ''}
          <button class="btn ghost sm" data-builder ${w.error ? 'disabled' : ''} title="${esc(w.origin !== 'custom' ? 'See it in the visual builder (read-only: clone it to change it)' : w.builder ? 'Edit it in the visual builder' : 'See it in the visual builder: its agents and prompts can be changed there, its steps stay as they are')}">Send to builder</button>
          <button class="btn primary sm" data-run ${w.error ? 'disabled' : ''}>Run</button>
        </div>
      </div>
      <ol class="wf-steps">${steps}</ol>
    </article>`;
  }).join('');
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => openDrawer({ workflow: b.closest('.wf-card').dataset.file })));
  box.querySelectorAll('[data-builder]').forEach((b) => (b.onclick = () => window.openInBuilder?.(b.closest('.wf-card').dataset.file)));
  box.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = async () => {
    const file = b.closest('.wf-card').dataset.file;
    if (!(await confirmDialog('Restore default', `Move your edited "${file}" to the trash and restore the default bundled with the app?`, 'Restore'))) return;
    try { await api.restoreWorkflow(file); } catch (e) { showToast('Restore failed', e.message); }
    refreshWorkflows();
  }));
}

// Where a workflow file comes from (see src/seed.js): the bundled default, edited by the user or user-created.
function originBadge(w) {
  const badges = {
    default: '<span class="badge" title="Default bundled with the app; updated automatically with new app versions">default</span>',
    modified: '<span class="badge warn" title="Bundled default edited by you; app updates do not overwrite it">modified</span>',
    custom: '<span class="badge cat-build" title="Created by you">custom</span>',
  };
  const update = w.updateAvailable
    ? `<span class="badge warn" title="The app ships a newer default than the one you edited. Restore default to use it (your copy goes to the trash).">newer default${w.bundledVersion ? ` v${esc(w.bundledVersion)}` : ''}</span>`
    : '';
  return (badges[w.origin] || '') + update;
}

// Opens a run in Workflows › Runs, expanded.
function showRunInList(runId) {
  state.workflowsTab = 'runs';
  state.wr.filter = 'all';
  state.wr.showSim = true;
  state.wr.expanded.add(runId);
  showView('workflows');
  setTimeout(() => document.querySelector(`.pr-run[data-run="${CSS.escape(runId)}"]`)?.scrollIntoView({ block: 'center' }), 600);
}

// Opens a workflow in Workflows › Definitions, scrolled to and focused (the Agents menu's
// "Open in workflow").
function showWorkflowDefinition(file) {
  state.workflowsTab = 'definitions';
  showView('workflows');
  setTimeout(() => {
    const card = document.querySelector(`.wf-card[data-file="${CSS.escape(file)}"]`);
    card?.scrollIntoView({ block: 'center' });
    card?.focus?.();
  }, 600);
}

registerView({
  id: 'workflows',
  nav: { label: 'Workflows', order: 60, icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="12" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.5 6H12a3 3 0 0 1 3 3v.5M8.5 18H12a3 3 0 0 0 3-3v-.5" /></svg>' },
  markup: `
      <section id="view-workflows" class="view hidden">
        <div class="page-head">
          <div>
            <h1>Workflows <span class="muted">›</span> <span id="workflows-page-title">Runs</span></h1>
            <p class="muted small"><span id="workflows-page-hint"></span> Folder: <span id="workflows-dir" class="mono"></span> (defaults bundled with the app are copied there; your edits are kept on app updates).</p>
          </div>
          <div class="row keep-awake-head">
            <div id="workflows-keep-awake" class="keep-awake">
              <div class="keep-awake-top">
                <b>Keep awake</b>
                <span class="badge keep-awake-status" data-keep-awake-status></span>
                <label class="switch" title="Keep awake"><input type="checkbox" data-keep-awake-toggle aria-label="Keep awake" /><span></span></label>
              </div>
              <span class="muted small">Keeps this computer from sleeping while runs or a roadmap are active (this workspace). Sleep, the lid and the power plan still apply.</span>
              <span class="error small" data-keep-awake-error></span>
            </div>
            <button id="btn-workflows-folder" class="btn ghost">Open folder</button>
          </div>
        </div>
        <div data-wpage="runs">
          <div class="pr-toolbar">
            <div id="workflow-run-filters" class="chips"></div>
            <span class="spacer"></span>
            <label class="check small"><input type="checkbox" id="workflow-show-sim" /><span>Show simulated</span></label>
            <button id="btn-workflow-runs-refresh" class="btn sm ghost">Refresh</button>
          </div>
          <p id="workflow-runs-error" class="error small"></p>
          <div id="workflow-runs" class="pr-list"></div>
        </div>
        <div data-wpage="definitions" class="hidden">
          <div id="workflows-list" class="wf-list"></div>
        </div>
        <div data-wpage="builder" class="hidden">
          <div id="wb" class="wb">
            <div class="wb-bar">
              <input type="text" id="wb-name" class="wb-name" placeholder="Workflow name" aria-label="Workflow name" spellcheck="false" />
              <select id="wb-category" aria-label="Category"></select>
              <span class="spacer"></span>
              <select id="wb-open" aria-label="Open a workflow in the builder"></select>
              <button id="wb-new" class="btn ghost sm" type="button">New</button>
              <button id="wb-clone" class="btn ghost sm hidden" type="button" title="Make your own copy of this workflow (custom), which you can change">Clone</button>
              <button id="wb-save" class="btn sm" type="button">Save</button>
              <button id="wb-run" class="btn primary sm" type="button" title="Save and open the start panel">Run</button>
            </div>
            <textarea id="wb-description" class="wb-description" rows="2" placeholder="What it does (shown when you start it)" aria-label="Description"></textarea>
            <p id="wb-banner" class="wb-banner small hidden"></p>
            <div class="wb-meta muted small"><span class="mono" id="wb-file"></span><span id="wb-dirty" class="badge warn hidden">unsaved</span>
              <span class="spacer"></span>
              <button id="wb-add-desk" class="btn ghost sm" type="button" title="Add an agent desk after the selected one">+ Desk</button>
              <button id="wb-add-gate" class="btn ghost sm" type="button" title="Add an approval gate after the selected desk">+ Approval gate</button>
            </div>
            <div class="wb-main">
              <div id="wb-canvas" class="wb-canvas" aria-label="Steps, in order"></div>
              <aside id="wb-panel" class="wb-panel"></aside>
            </div>
            <p id="wb-error" class="error small wb-error"></p>
          </div>
        </div>
      </section>`,
  modals: `
  <!-- Workflows > Builder: the skills of a desk -->
  <div id="wb-skills-modal" class="modal hidden">
    <div class="modal-card wide" role="dialog" aria-labelledby="wb-skills-title">
      <h3 id="wb-skills-title">Skills of this agent <span id="wb-skill-count" class="muted small"></span></h3>
      <input type="text" id="wb-skill-search" placeholder="Filter skills" aria-label="Filter skills" />
      <div id="wb-skill-list" class="ag-skills wb-skill-list"></div>
      <div class="modal-actions">
        <button type="button" id="btn-wb-skills-cancel" class="btn ghost">Cancel</button>
        <button type="button" id="btn-wb-skills-ok" class="btn primary">Apply</button>
      </div>
    </div>
  </div>
  <!-- Workflows > Builder: import an agent (Agents menu) into a desk -->
  <div id="wb-agents-modal" class="modal hidden">
    <div class="modal-card wb-agents-card" role="dialog" aria-labelledby="wb-agents-title">
      <h3 id="wb-agents-title">Import an agent</h3>
      <p class="muted small">Its look, prompt and skills go to the desk; you can still adjust them there.</p>
      <div id="wb-agents-list" class="card-grid agents-grid wb-agents-list"></div>
      <div class="modal-actions">
        <button type="button" id="btn-wb-agents-manage" class="btn ghost">Manage agents</button>
        <span class="spacer"></span>
        <button type="button" id="btn-wb-agents-cancel" class="btn ghost">Cancel</button>
      </div>
    </div>
  </div>`,
  mount() {
    // the sub-items, right under the sidebar entry (showView shows them on this screen only)
    $('nav.sidebar [data-view="workflows"]').insertAdjacentHTML('afterend', `
      <div class="nav-sub hidden" id="nav-workflows-sub" role="group" aria-label="Workflows">
        <button class="nav-subitem" data-wtab="runs">Runs</button>
        <button class="nav-subitem" data-wtab="definitions">Definitions</button>
        <button class="nav-subitem" data-wtab="builder">Builder</button>
      </div>`);
    $('#btn-workflows-folder').onclick = () => api.openPath(state.ws.workflows);
    document.querySelectorAll('[data-wtab]').forEach((b) => (b.onclick = () => { state.workflowsTab = b.dataset.wtab; showView('workflows'); }));
    $('#btn-workflow-runs-refresh').onclick = () => loadWorkflowRuns();
    $('#workflow-show-sim').onchange = (e) => { state.wr.showSim = e.target.checked; renderWorkflowRuns(); };
  },
  show: () => showWorkflowsTab(state.workflowsTab),
});
