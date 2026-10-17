/* global api */
// Projects (#354: back in the menu, Code & Build before Backlog; it was a page of Settings since
// #254): the project cards (Start workflow, Open folder, Edit, Remove; a click opens the project's
// page, views/project/) with Open folder and New project in the header, and the New / Edit project
// dialog with its Local preview fields and the run command detected in the folder (#115). The dialog
// is also opened from the Start drawer (app.js) and the header's project selector
// (current-project.js), so openProjectModal stays a global; showProjects opens the screen.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, openModal, closeModal, confirmDialog, openDrawer, renderProjectOptions, runAppCommandHtml).

async function refreshProjects() {
  state.projects = await api.listProjects();
  window.CurrentProject.refresh();
  const box = $('#projects-list');
  if (!state.projects.length) {
    box.innerHTML = `<div class="empty-state"><b>${t('projects.no_projects_yet')}</b><p class="muted">${t('projects.create_a_project_that_points_to')}</p><button class="btn primary" id="empty-new-project">${t('projects.new_project')}</button></div>`;
    $('#empty-new-project').onclick = () => openProjectModal(null);
    return;
  }
  box.innerHTML = state.projects.map((p) => `
    <div class="card clickable" data-testid="project-card" data-id="${esc(p.id)}" title="${t('projects.open_this_project_its_runs_conflict')}">
      <div class="card-head">
        <span class="card-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg></span>
        <b class="card-title">${esc(p.name)}</b>
        ${p.error ? `<span class="badge warn">${t('projects.error')}</span>` : p.isGit ? `<span class="badge">${t('projects.git')}</span>` : ''}
      </div>
      ${p.description ? `<p class="muted small">${esc(p.description)}</p>` : ''}
      <dl class="kv">
        <dt>${t('projects.folder')}</dt><dd class="${p.exists ? '' : 'warn-text'}">${esc(p.folder || '—')}${p.exists ? '' : t('projects.not_found')}</dd>
        <dt>${t('projects.repository')}</dt><dd>${esc(p.repo || '—')}</dd>
      </dl>
      <div class="card-actions">
        <button class="btn sm primary" data-act="run">${t('projects.start_workflow')}</button>
        <button class="btn sm ghost" data-act="open" ${p.exists ? '' : 'disabled'}>${t('projects.open_folder')}</button>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-act="edit">${t('projects.edit')}</button>
        <button class="btn sm ghost danger" data-act="remove">${t('projects.remove')}</button>
      </div>
    </div>`).join('');
}

// One delegated listener for the cards (they are drawn again on each refresh): a button acts, a
// click elsewhere on a card opens the project's page
async function onProjectsClick(e) {
  const act = e.target.closest('[data-act]');
  const card = e.target.closest('[data-testid="project-card"]') || act?.closest('[data-testid="project-card"]');
  const p = card && state.projects.find((x) => x.id === card.dataset.id);
  if (!p) return;
  if (!act) {
    if (!e.target.closest('button, a, input')) openProjectView(p.id);
    return;
  }
  if (act.dataset.act === 'run') openDrawer({ project: p.id });
  if (act.dataset.act === 'open') api.openPath(p.folder);
  if (act.dataset.act === 'edit') openProjectModal(p);
  if (act.dataset.act === 'remove' && await confirmDialog(t('projects.remove_project'), t('projects.remove_name_from_the_list_the', { name: p.name, folder: p.folder }), t('projects.remove'))) {
    await api.removeProject(p.id);
    refreshProjects();
  }
}

// The Projects screen: where the links to the projects lead (a project's page, a Run App copy)
function showProjects() {
  showView('projects');
}

let editingProject = null;
let projectFromDrawer = false;
let projectFromHeader = false;
// fromDrawer / fromHeader: the new project becomes the Start drawer's / the app's (the header selector's)
function openProjectModal(p, { fromDrawer = false, fromHeader = false } = {}) {
  editingProject = p;
  projectFromDrawer = fromDrawer;
  projectFromHeader = fromHeader;
  $('#project-modal-title').textContent = p ? t('projects.edit_project') : t('projects.new_project');
  $('#btn-pj-save').textContent = p ? t('common.save') : t('projects.create_project');
  $('#pj-name').value = p?.name || '';
  $('#pj-description').value = p?.description || '';
  $('#pj-repo').value = p?.repo || '';
  $('#pj-folder').value = p?.folder || '';
  $('#pj-lp-install').value = p?.localPreview?.install || '';
  $('#pj-lp-command').value = p?.localPreview?.command || '';
  $('#pj-lp-url').value = p?.localPreview?.url || '';
  $('#pj-folder').required = !!p;
  $('#pj-folder-hint').classList.toggle('hidden', !!p);
  $('#pj-error').textContent = '';
  pjDetected = null;
  $('#pj-folder').oninput = () => { clearTimeout(pjDetectTimer); pjDetectTimer = setTimeout(detectProjectRun, 400); };
  detectProjectRun();
  openModal('#project-modal');
  $('#pj-name').focus({ preventScroll: true });
}

// What the folder declares (.multiagent/local-preview.yaml) or is detected to run with (#115), so
// the owner confirms it here ("Use it" fills Local preview) before any gate asks.
let pjDetectTimer = null;
let pjDetectSeq = 0;
let pjDetected = null; // the suggestion "Use it" took (its cwd / env are saved with the fields)
async function detectProjectRun() {
  const box = $('#pj-lp-detected');
  const folder = $('#pj-folder').value.trim();
  const seq = ++pjDetectSeq;
  box.classList.add('hidden');
  if (!folder || editingProject?.localPreview?.command) return;
  let s = null;
  try { s = await api.suggestLocalPreview(folder); } catch { /* an unreadable folder suggests nothing */ }
  if (seq !== pjDetectSeq || !s?.command) return;
  box.innerHTML = `Detected: ${runAppCommandHtml(s)}${s.url ? ` at ${esc(s.url)}` : ''} <span class="muted">${t('projects.from_value', { value: esc(s.from || 'the folder') })}</span>
    <button type="button" class="btn sm ghost" id="btn-pj-lp-use">${t('projects.use_it')}</button>`;
  box.classList.remove('hidden');
  $('#btn-pj-lp-use').onclick = () => {
    $('#pj-lp-install').value = s.install || '';
    $('#pj-lp-command').value = s.command;
    $('#pj-lp-url').value = s.url || '';
    pjDetected = s;
    box.classList.add('hidden');
  };
}

async function saveProject(e) {
  e.preventDefault();
  const { lp_install: install, lp_command: command, lp_url: url, ...data } = Object.fromEntries(new FormData($('#project-form')));
  // the fields show install / command / URL; a monorepo app's folder and the env are kept
  const kept = pjDetected?.command === command ? pjDetected : editingProject?.localPreview || {};
  data.localPreview = { cwd: kept.cwd, env: kept.env, install, command, url };
  pjDetected = null;
  const btn = $('#btn-pj-save');
  $('#pj-error').textContent = '';
  btn.disabled = true;
  const label = btn.textContent;
  if (!editingProject && data.repo) btn.textContent = t('projects.cloning');
  try {
    const p = editingProject ? await api.updateProject(editingProject.id, data) : await api.createProject(data);
    closeModal('#project-modal');
    state.projects = await api.listProjects();
    // created from the header's selector: it becomes the app's project, and the open screen shows it
    if (projectFromHeader) window.CurrentProject.set(p.id, { redraw: false });
    window.CurrentProject.refresh();
    if (projectFromDrawer) renderProjectOptions(p.id);
    if (projectFromHeader) showView(state.view);
    else if (state.view === 'projects') refreshProjects();
  } catch (err) {
    $('#pj-error').textContent = errMsg(err);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

registerView({
  id: 'projects',
  nav: { label: 'Projects', order: 38, group: 'code', title: 'Your projects: each one\'s runs, conflict map, architecture and refactors', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>' },
  markup: () => `
      <section id="view-projects" class="view hidden" data-testid="projects-screen">
        <div class="page-head">
          <div>
            <h1>${t('projects.projects')}</h1>
            <p class="muted small">${t('projects.each_project_points_to_a_local')} <span id="projects-dir" class="mono"></span></p>
          </div>
          <div class="row">
            <button id="btn-projects-folder" class="btn ghost nowrap" type="button">${t('projects.open_folder')}</button>
            <button id="btn-new-project" class="btn primary nowrap" type="button">${t('projects.new_project')}</button>
          </div>
        </div>
        <div id="projects-list" class="card-grid"></div>
      </section>`,
  modals: () => `
  <div id="project-modal" class="modal hidden">
    <form id="project-form" class="modal-card wide">
      <h3 id="project-modal-title">${t('projects.new_project')}</h3>
      <div class="field">
        <label for="pj-name">${t('projects.name')} <span class="req">*</span></label>
        <input type="text" id="pj-name" name="name" required />
      </div>
      <div class="field">
        <label for="pj-description">${t('projects.description')}</label>
        <input type="text" id="pj-description" name="description" />
      </div>
      <div class="field">
        <label for="pj-repo">${t('projects.git_repository')} <span class="muted">${t('projects.optional')}</span></label>
        <input type="text" id="pj-repo" name="repo" placeholder="${t('projects.https_github_com_owner_repo_git')}" />
        <div class="hint">${t('projects.if_the_folder_is_not_a')}</div>
      </div>
      <div class="field">
        <label for="pj-folder">${t('projects.folder_2')}</label>
        <div class="row">
          <input type="text" id="pj-folder" name="folder" />
          <button type="button" id="btn-pj-pick" class="btn sm">…</button>
        </div>
        <div id="pj-folder-hint" class="hint">${t('projects.leave_empty_to_create_it_in')}</div>
      </div>
      <div class="field">
        <label for="pj-lp-command">${t('projects.local_preview')} <span class="muted">${t('projects.optional')}</span></label>
        <div class="row">
          <input type="text" id="pj-lp-install" name="lp_install" placeholder="${t('projects.install_npm_ci')}" />
          <input type="text" id="pj-lp-command" name="lp_command" placeholder="${t('projects.run_npm_start')}" />
          <input type="text" id="pj-lp-url" name="lp_url" placeholder="${t('projects.url_http_localhost_5173')}" />
        </div>
        <div id="pj-lp-detected" class="hint pj-lp-detected hidden"></div>
        <div class="hint">${t('projects.how_to_run_a_run_s')}</div>
      </div>
      <p id="pj-error" class="error small"></p>
      <div class="modal-actions">
        <button type="button" id="btn-pj-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="submit" id="btn-pj-save" class="btn primary">${t('projects.create_project')}</button>
      </div>
    </form>
  </div>`,
  mount() {
    $('#projects-list').onclick = onProjectsClick;
    $('#btn-new-project').onclick = () => openProjectModal(null);
    $('#btn-projects-folder').onclick = () => api.openPath(state.ws.projects);
    $('#project-form').onsubmit = saveProject;
    $('#btn-pj-cancel').onclick = () => closeModal('#project-modal');
    $('#btn-pj-pick').onclick = async () => { const d = await api.pickFolder(); if (d) { $('#pj-folder').value = d; detectProjectRun(); } };
  },
  show: refreshProjects,
});
