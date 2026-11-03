/* global api */
// Projects (#354: back in the menu, Code & Build before Backlog; it was a page of Settings since
// #254): the project cards (Start workflow, Open folder, Edit, Remove; a click opens the project's
// page, views/project/) with Open folder and New project in the header. #643: New project (the header
// and the empty state, data-testid="projects-empty") opens the onboarding wizard (window.ProjectWizard,
// project-wizard.js). #741: one editor for a project: creating is the wizard only and a card's Edit opens
// the project's page on its settings (data-testid="project-settings", project-settings.js); the old New /
// Edit project dialog is gone. A card whose onboarding was closed before Finish reads "Onboarding not
// finished" (data-testid="project-onboarding-unfinished") with Continue (data-act="continue"): the wizard
// on that project's saved step. #742: Remove asks in the confirm modal, with "Also delete the folder"
// (project-remove.js). showProjects opens the screen, offered as an action (actions.js) to the kit and the
// other fronts; a card's click asks the openProject action (the project's page, when its front is shipped).
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api, openDrawer).

const onboardingUnfinished = (p) => p.onboarding?.finished === false;

async function refreshProjects() {
  state.projects = await api.listProjects();
  window.CurrentProject.refresh();
  renderProjects();
}

// Draws the cards from state.projects; the wizard (project-wizard.js) asks for it when it changes the
// list while the screen is open (a project it created, its onboarding closed or finished)
function renderProjects() {
  const box = $('#projects-list');
  if (!box) return;
  if (!state.projects.length) {
    box.innerHTML = `<div class="empty-state" data-testid="projects-empty"><b>${t('projects.no_projects_yet')}</b><p class="muted">${t('projects.create_a_project_that_points_to')}</p><button class="btn primary" id="empty-new-project">${t('projects.new_project')}</button></div>`;
    $('#empty-new-project').onclick = () => window.ProjectWizard.open();
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
      ${onboardingUnfinished(p) ? `<div class="row"><span class="badge warn" data-testid="project-onboarding-unfinished">${t('projects.onboarding_not_finished')}</span><button class="btn sm" data-act="continue">${t('projects.continue_onboarding')}</button></div>` : ''}
      <dl class="kv">
        <dt>${t('projects.folder')}</dt><dd class="${p.exists ? '' : 'warn-text'}">${esc(p.folder || '—')}${p.exists ? '' : t('projects.not_found')}</dd>
        <dt>${t('projects.repository')}</dt><dd>${esc(p.repo || '—')}</dd>
      </dl>
      <div class="card-actions">
        <button class="btn sm primary" data-act="run">${t('projects.start_workflow')}</button>
        <button class="btn sm ghost" data-act="open" ${p.exists ? '' : 'disabled'}>${t('projects.open_folder')}</button>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-act="edit">${t('projects.edit')}</button>
        <button class="btn sm ghost danger" data-act="remove">${t('common.remove')}</button>
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
    if (!e.target.closest('button, a, input')) window.Actions.call('openProject', p.id);
    return;
  }
  if (act.dataset.act === 'run') openDrawer({ project: p.id });
  if (act.dataset.act === 'open') api.openPath(p.folder);
  if (act.dataset.act === 'continue') window.ProjectWizard.open({ projectId: p.id });
  if (act.dataset.act === 'edit') window.Actions.call('openProject', p.id, { settings: true });
  if (act.dataset.act === 'remove' && await window.ProjectRemove.remove(p)) refreshProjects();
}

// The Projects screen: where the links to the projects lead (a project's page, a Run App copy)
function showProjects() {
  showView('projects');
}
window.Actions.register('showProjects', showProjects);
window.ProjectsView = {
  refresh: refreshProjects,
  render: renderProjects,
};

registerView({
  id: 'projects',
  nav: { label: 'Projects', order: 38, group: 'build', title: 'Your projects: each one\'s runs, conflict map, architecture and refactors', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>' },
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
  mount() {
    $('#projects-list').onclick = onProjectsClick;
    $('#btn-new-project').onclick = () => window.ProjectWizard.open();
    $('#btn-projects-folder').onclick = () => api.openPath(state.ws.projects);
  },
  show: refreshProjects,
});
