/* global api */
// Projects, inside Settings (#254: Settings › Projects, no menu entry of its own): the project cards
// (Start workflow, Open folder, Edit, Remove; a click opens the project's page, views/project/) and
// the New / Edit project dialog with its Local preview fields and the run command detected in the
// folder (#115). The dialog is also opened from the Start drawer (app.js) and the header's project
// selector (current-project.js), so openProjectModal stays a global; showProjects opens the tab.
// load: after views/settings/settings.js (the cards go into its Projects page)
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, openModal, closeModal, confirmDialog, openDrawer, renderProjectOptions, runAppCommandHtml).

async function refreshProjects() {
  state.projects = await api.listProjects();
  window.CurrentProject.refresh();
  const box = $('#projects-list');
  if (!state.projects.length) {
    box.innerHTML = `<div class="empty-state"><b>No projects yet</b><p class="muted">Create a project that points to a local folder or a git repository.</p><button class="btn primary" id="empty-new-project">New project</button></div>`;
    $('#empty-new-project').onclick = () => openProjectModal(null);
    return;
  }
  box.innerHTML = state.projects.map((p) => `
    <div class="card clickable" data-id="${esc(p.id)}" title="View the runs of this project">
      <div class="card-head">
        <span class="card-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg></span>
        <b class="card-title">${esc(p.name)}</b>
        ${p.error ? '<span class="badge warn">error</span>' : p.isGit ? '<span class="badge">git</span>' : ''}
      </div>
      ${p.description ? `<p class="muted small">${esc(p.description)}</p>` : ''}
      <dl class="kv">
        <dt>folder</dt><dd class="${p.exists ? '' : 'warn-text'}">${esc(p.folder || '—')}${p.exists ? '' : ' (not found)'}</dd>
        <dt>repository</dt><dd>${esc(p.repo || '—')}</dd>
      </dl>
      <div class="card-actions">
        <button class="btn sm primary" data-act="run">Start workflow</button>
        <button class="btn sm ghost" data-act="open" ${p.exists ? '' : 'disabled'}>Open folder</button>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-act="edit">Edit</button>
        <button class="btn sm ghost danger" data-act="remove">Remove</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
    const p = state.projects.find((x) => x.id === b.closest('.card').dataset.id);
    if (b.dataset.act === 'run') openDrawer({ project: p.id });
    if (b.dataset.act === 'open') api.openPath(p.folder);
    if (b.dataset.act === 'edit') openProjectModal(p);
    if (b.dataset.act === 'remove' && await confirmDialog('Remove project', `Remove "${p.name}" from the list? The folder ${p.folder} is not deleted.`, 'Remove')) {
      await api.removeProject(p.id);
      refreshProjects();
    }
  }));
  box.querySelectorAll('.card').forEach((c) => (c.onclick = (e) => {
    if (e.target.closest('button, a, input, [data-act]')) return;
    openProjectView(c.dataset.id);
  }));
}

// Settings › Projects: where the links to the Projects screen lead (a project's page, a Run App copy)
function showProjects() {
  showView('settings');
  showSettingsTab('projects');
}

let editingProject = null;
let projectFromDrawer = false;
let projectFromHeader = false;
// fromDrawer / fromHeader: the new project becomes the Start drawer's / the app's (the header selector's)
function openProjectModal(p, { fromDrawer = false, fromHeader = false } = {}) {
  editingProject = p;
  projectFromDrawer = fromDrawer;
  projectFromHeader = fromHeader;
  $('#project-modal-title').textContent = p ? 'Edit project' : 'New project';
  $('#btn-pj-save').textContent = p ? 'Save' : 'Create project';
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
  box.innerHTML = `Detected: ${runAppCommandHtml(s)}${s.url ? ` at ${esc(s.url)}` : ''} <span class="muted">(from ${esc(s.from || 'the folder')})</span>
    <button type="button" class="btn sm ghost" id="btn-pj-lp-use">Use it</button>`;
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
  if (!editingProject && data.repo) btn.textContent = 'Cloning…';
  try {
    const p = editingProject ? await api.updateProject(editingProject.id, data) : await api.createProject(data);
    closeModal('#project-modal');
    state.projects = await api.listProjects();
    window.CurrentProject.refresh();
    if (projectFromDrawer) renderProjectOptions(p.id);
    if (projectFromHeader) window.CurrentProject.set(p.id);
    if (state.view === 'settings') refreshProjects();
  } catch (err) {
    $('#pj-error').textContent = errMsg(err);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

registerView({
  id: 'projects',
  modals: `
  <div id="project-modal" class="modal hidden">
    <form id="project-form" class="modal-card wide">
      <h3 id="project-modal-title">New project</h3>
      <div class="field">
        <label for="pj-name">Name <span class="req">*</span></label>
        <input type="text" id="pj-name" name="name" required />
      </div>
      <div class="field">
        <label for="pj-description">Description</label>
        <input type="text" id="pj-description" name="description" />
      </div>
      <div class="field">
        <label for="pj-repo">Git repository <span class="muted">(optional)</span></label>
        <input type="text" id="pj-repo" name="repo" placeholder="https://github.com/owner/repo.git" />
        <div class="hint">If the folder is not a git repository, the repo is cloned into it.</div>
      </div>
      <div class="field">
        <label for="pj-folder">Folder</label>
        <div class="row">
          <input type="text" id="pj-folder" name="folder" />
          <button type="button" id="btn-pj-pick" class="btn sm">…</button>
        </div>
        <div id="pj-folder-hint" class="hint">Leave empty to create it in &lt;workspace&gt;/projects/&lt;name&gt;.</div>
      </div>
      <div class="field">
        <label for="pj-lp-command">Local preview <span class="muted">(optional)</span></label>
        <div class="row">
          <input type="text" id="pj-lp-install" name="lp_install" placeholder="Install: npm ci" />
          <input type="text" id="pj-lp-command" name="lp_command" placeholder="Run: npm start" />
          <input type="text" id="pj-lp-url" name="lp_url" placeholder="URL: http://localhost:5173" />
        </div>
        <div id="pj-lp-detected" class="hint pj-lp-detected hidden"></div>
        <div class="hint">How to run a run's worktree: adds Run locally to the gates that offer it (e.g. developer_check). The install runs only when dependencies are missing or the lockfile changed. Overrides the workflow's orchestrator.local_preview.</div>
      </div>
      <p id="pj-error" class="error small"></p>
      <div class="modal-actions">
        <button type="button" id="btn-pj-cancel" class="btn ghost">Cancel</button>
        <button type="submit" id="btn-pj-save" class="btn primary">Create project</button>
      </div>
    </form>
  </div>`,
  mount() {
    // the page of Settings › Projects (settings.js has its tab and its empty page)
    $('#settings-projects').innerHTML = `
              <div class="page-head">
                <div>
                  <h2 class="settings-title">Projects</h2>
                  <p class="muted small">Each project points to a local folder and, optionally, a git repository. Stored in <span id="projects-dir" class="mono"></span></p>
                </div>
                <div class="row">
                  <button id="btn-projects-folder" class="btn ghost">Open folder</button>
                  <button id="btn-new-project" class="btn primary">New project</button>
                </div>
              </div>
              <div id="projects-list" class="card-grid"></div>`;
    $('#btn-new-project').onclick = () => openProjectModal(null);
    $('#btn-projects-folder').onclick = () => api.openPath(state.ws.projects);
    $('#project-form').onsubmit = saveProject;
    $('#btn-pj-cancel').onclick = () => closeModal('#project-modal');
    $('#btn-pj-pick').onclick = async () => { const d = await api.pickFolder(); if (d) { $('#pj-folder').value = d; detectProjectRun(); } };
  },
  // showView('projects') (an older link, a Run App copy's start screen) lands on Settings › Projects
  show: showProjects,
});
