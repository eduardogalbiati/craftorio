/* global api */
// A project's page (Projects › a project, #354): its name, then the tabs Overview (its folder,
// repository and unpushed commits, and its runs in the shared run list, run-list.js: paged with an
// infinite scroll, filters and search answered by the service, #200), Conflict map
// (project-conflict-map.js), Architecture (project-architecture.js, #356, with the Seeds section
// below it, project-seeds.js, #360) and Refactor (an empty
// state until #357, with the proposals sent from the Architecture tab). The selected tab is remembered per project. The page is the header's project: opening
// one makes it the app's project, and choosing another in the header switches the page to it.
// No sidebar entry of its own: Projects stays lit (`menu`).
// openProjectView (the Projects cards, the Conflict map links, scripts/screenshot.js) and
// loadProjectRunsThrottled (app.js run events) stay globals. Registers itself with registerView
// (view-registry.js); uses app.js globals ($, esc, state, api, errMsg, showView, openDrawer,
// noteRunMeta) and showProjects (views/projects/projects.js).

const PV_TABS = [['overview', 'Overview'], ['conflicts', 'Conflict map'], ['architecture', 'Architecture'], ['refactor', 'Refactor']];
const PV_TABS_KEY = 'multiagent.projectTabs';

// the tab each project was last shown on: { <projectId>: <tab> }
function projectTabs() {
  try { return JSON.parse(localStorage.getItem(PV_TABS_KEY) || '{}') || {}; } catch { return {}; }
}
function rememberProjectTab(id, tab) {
  try { localStorage.setItem(PV_TABS_KEY, JSON.stringify({ ...projectTabs(), [id]: tab })); } catch { /* storage unavailable */ }
}

function newProjectPage(id) {
  const tab = projectTabs()[id];
  return {
    id, project: state.projects.find((p) => p.id === id) || null, runs: null, error: null, filter: 'all', showSim: false, q: '', expanded: new Set(), msgs: new Map(),
    tab: PV_TABS.some(([t]) => t === tab) ? tab : 'overview',
  };
}

// tab: open the page on this tab (the Conflict map links)
function openProjectView(id, { tab = null } = {}) {
  if (state.pv?.id !== id) state.pv = newProjectPage(id);
  if (tab) { state.pv.tab = tab; rememberProjectTab(id, tab); }
  // the header's project follows the page (the page is drawn right after)
  window.CurrentProject?.set(id, { redraw: false });
  showView('project');
}

// mode: 'reset' | 'more' | 'refresh' (run-list.js loadRunListPage)
let pvLoading = null;
let pvLastLoad = 0;
let pvTimer = null;
function loadProjectRuns(mode = 'reset') {
  const pv = state.pv;
  if (!pv) return;
  if (pvLoading && mode !== 'reset') return pvLoading;
  const p = (async () => {
    const res = await loadRunListPage(pv, async (opts) => {
      const out = await api.listProjectRuns(pv.id, opts);
      if (state.pv === pv) { pv.project = out.project || pv.project; pv.local = out.local || null; }
      return out;
    }, mode);
    if (res && state.pv === pv) noteRunMeta(res.runs || []);
    if (pvLoading === p) pvLoading = null;
    pvLastLoad = Date.now();
    if (state.view === 'project') renderProjectView();
  })();
  pvLoading = p;
  return p;
}

// At most one reload of the loaded pages every 10 s from run events while the view is visible (a
// run's own row follows its events: refreshRunRow).
function loadProjectRunsThrottled() {
  if (pvTimer || state.view !== 'project') return;
  const wait = Math.max(0, 10000 - (Date.now() - pvLastLoad));
  pvTimer = setTimeout(() => { pvTimer = null; if (state.view === 'project') loadProjectRuns('refresh'); }, wait);
}

function renderProjectView() {
  const pv = state.pv;
  if (!pv) return;
  const p = pv.project;
  $('#project-head').innerHTML = `
    <div class="pr-head-info">
      <h1>${esc(p?.name || 'Project')}</h1>
      ${p?.description ? `<p class="muted">${esc(p.description)}</p>` : ''}
    </div>
    <div class="row">
      <button class="btn ghost" id="pv-open-folder" ${p?.exists ? '' : 'disabled'}>Open folder</button>
      <button class="btn primary" id="pv-start">Start workflow</button>
    </div>`;
  $('#pv-open-folder').onclick = () => p && api.openPath(p.folder);
  $('#pv-start').onclick = () => openDrawer({ project: pv.id });
  $('#project-tabs').innerHTML = PV_TABS.map(([id, label]) =>
    `<button type="button" class="tab${pv.tab === id ? ' active' : ''}" role="tab" data-pv-tab="${id}" aria-selected="${pv.tab === id}" aria-controls="project-panel-${id}">${label}</button>`).join('');
  for (const [id] of PV_TABS) $(`#project-panel-${id}`).classList.toggle('hidden', pv.tab !== id);
  if (pv.tab === 'conflicts') window.ProjectConflictMap?.show(pv.id, $('#project-conflicts'));
  if (pv.tab === 'architecture') {
    window.ProjectArchitecture?.show(pv.id, $('#project-architecture'));
    window.ProjectSeeds?.show(pv.id, $('#project-seeds'));
  }
  if (pv.tab === 'refactor') window.ProjectArchitecture?.showRefactor(pv.id, $('#project-refactor-proposals'), $('#project-panel-refactor [data-testid="project-refactor-empty"]'));
  if (pv.tab !== 'overview') return;
  $('#project-info').innerHTML = `
    <dl class="kv">
      <dt>folder</dt><dd class="${p && !p.exists ? 'warn-text' : ''}">${esc(p?.folder || '—')}${p && !p.exists ? ' (not found)' : ''}</dd>
      <dt>repository</dt><dd>${esc(p?.repo || '—')}</dd>
      ${pv.local?.ahead > 0 ? `<dt>not pushed</dt><dd class="warn-text">${pv.local.ahead} commit${pv.local.ahead === 1 ? '' : 's'} on the local ${esc(pv.local.base)}${pv.local.issues?.length ? ` (closes ${esc(pv.local.issues.map((n) => `#${n}`).join(', '))})` : ''}: push from the Backlog</dd>` : ''}
    </dl>`;
  renderRunList(pv, {
    prefix: 'project', box: '#project-runs', empty: 'No workflows have run in this project yet.',
    start: () => openDrawer({ project: pv.id }), rerender: renderProjectView,
    reload: () => loadProjectRuns(), loadMore: () => loadProjectRuns('more'),
  });
}

// the page's delegated clicks: a tab, then the Conflict map tab's controls and rows
function onProjectPageClick(e) {
  const tab = e.target.closest('[data-pv-tab]');
  if (tab && state.pv) {
    state.pv.tab = tab.dataset.pvTab;
    rememberProjectTab(state.pv.id, state.pv.tab);
    renderProjectView();
    return;
  }
  if (!window.ProjectArchitecture?.onClick(e) && !window.ProjectSeeds?.onClick(e)) window.ProjectConflictMap?.onClick(e);
}

registerView({
  id: 'project',
  menu: 'projects',
  markup: `
      <section id="view-project" class="view hidden" data-testid="project-page">
        <button id="btn-project-back" class="link-btn back-link" type="button">← Projects</button>
        <div id="project-head" class="page-head"></div>
        <div id="project-tabs" class="tabs page-tabs" role="tablist" aria-label="Project"></div>
        <div id="project-panel-overview" role="tabpanel" aria-label="Overview" data-testid="project-overview">
          <div id="project-info" class="pr-head-info"></div>
          <div class="pr-toolbar">
            <div id="project-run-filters" class="chips"></div>
            <span class="spacer"></span>
            <input type="text" id="project-run-search" class="pr-search" placeholder="Search runs" aria-label="Search runs" spellcheck="false" />
            <label class="check small"><input type="checkbox" id="project-show-sim" /><span>Show simulated</span></label>
            <button id="btn-project-refresh" class="btn sm ghost">Refresh</button>
          </div>
          <p id="project-runs-error" class="error small"></p>
          <div id="project-runs" class="pr-list"></div>
        </div>
        <div id="project-panel-conflicts" class="hidden" role="tabpanel" aria-label="Conflict map" data-testid="project-conflict-map">
          <div id="project-conflicts"></div>
        </div>
        <div id="project-panel-architecture" class="hidden" role="tabpanel" aria-label="Architecture" data-testid="project-architecture">
          <div id="project-architecture"></div>
          <div id="project-seeds"></div>
        </div>
        <div id="project-panel-refactor" class="hidden" role="tabpanel" aria-label="Refactor">
          <div class="empty-state" data-testid="project-refactor-empty"><b>Refactor: coming soon</b><p class="muted">This tab will hold the prioritized refactors of the project, added to the roadmap every few runs.</p></div>
          <div id="project-refactor-proposals"></div>
        </div>
      </section>`,
  mount() {
    $('#btn-project-back').onclick = () => showProjects();
    $('#view-project').addEventListener('click', onProjectPageClick);
    $('#view-project').addEventListener('change', (e) => window.ProjectArchitecture?.onChange(e) || window.ProjectConflictMap?.onChange(e));
    // a Conflict map row opens from the keyboard too
    $('#view-project').addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-pcm-row]')) { e.preventDefault(); window.ProjectConflictMap?.onClick(e); }
    });
    $('#btn-project-refresh').onclick = () => loadProjectRuns();
    $('#project-show-sim').onchange = (e) => { if (state.pv) { state.pv.showSim = e.target.checked; loadProjectRuns(); } };
    let searchTimer = null;
    $('#project-run-search').oninput = (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { if (state.pv) { state.pv.q = e.target.value.trim(); loadProjectRuns(); } }, 250);
    };
  },
  show() {
    // the header's project changed while the page was open: the page switches to it
    const current = window.CurrentProject?.get();
    if (current && state.pv?.id !== current) state.pv = newProjectPage(current);
    renderProjectView();
    loadProjectRuns(state.pv?.runs ? 'refresh' : 'reset');
  },
});
