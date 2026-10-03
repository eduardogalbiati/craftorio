/* global api */
// Project screen (Projects › a project): its folder, repository and unpushed commits, and its runs
// in the shared run list (run-list.js: paged with an infinite scroll, filters and search answered by
// the service, #200). No sidebar entry of its own: showView highlights Projects.
// openProjectView (the Projects cards, scripts/screenshot.js) and loadProjectRunsThrottled (app.js
// run events) stay globals. Registers itself with registerView (view-registry.js); uses app.js
// globals ($, esc, state, api, errMsg, showView, openDrawer, noteRunMeta).

function openProjectView(id) {
  if (state.pv?.id !== id) {
    state.pv = { id, project: state.projects.find((p) => p.id === id) || null, runs: null, error: null, filter: 'all', showSim: false, q: '', expanded: new Set(), msgs: new Map() };
  }
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
      <dl class="kv">
        <dt>folder</dt><dd class="${p && !p.exists ? 'warn-text' : ''}">${esc(p?.folder || '—')}${p && !p.exists ? ' (not found)' : ''}</dd>
        <dt>repository</dt><dd>${esc(p?.repo || '—')}</dd>
        ${pv.local?.ahead > 0 ? `<dt>not pushed</dt><dd class="warn-text">${pv.local.ahead} commit${pv.local.ahead === 1 ? '' : 's'} on the local ${esc(pv.local.base)}${pv.local.issues?.length ? ` (closes ${esc(pv.local.issues.map((n) => `#${n}`).join(', '))})` : ''}: push from the Backlog</dd>` : ''}
      </dl>
    </div>
    <div class="row">
      <button class="btn ghost" id="pv-open-folder" ${p?.exists ? '' : 'disabled'}>Open folder</button>
      <button class="btn primary" id="pv-start">Start workflow</button>
    </div>`;
  $('#pv-open-folder').onclick = () => p && api.openPath(p.folder);
  $('#pv-start').onclick = () => openDrawer({ project: pv.id });
  renderRunList(pv, {
    prefix: 'project', box: '#project-runs', empty: 'No workflows have run in this project yet.',
    start: () => openDrawer({ project: pv.id }), rerender: renderProjectView,
    reload: () => loadProjectRuns(), loadMore: () => loadProjectRuns('more'),
  });
}

registerView({
  id: 'project',
  markup: `
      <section id="view-project" class="view hidden">
        <button id="btn-project-back" class="link-btn back-link" type="button">← Projects</button>
        <div id="project-head" class="page-head"></div>
        <div class="pr-toolbar">
          <div id="project-run-filters" class="chips"></div>
          <span class="spacer"></span>
          <input type="text" id="project-run-search" class="pr-search" placeholder="Search runs" aria-label="Search runs" spellcheck="false" />
          <label class="check small"><input type="checkbox" id="project-show-sim" /><span>Show simulated</span></label>
          <button id="btn-project-refresh" class="btn sm ghost">Refresh</button>
        </div>
        <p id="project-runs-error" class="error small"></p>
        <div id="project-runs" class="pr-list"></div>
      </section>`,
  mount() {
    $('#btn-project-back').onclick = () => showView('projects');
    $('#btn-project-refresh').onclick = () => loadProjectRuns();
    $('#project-show-sim').onchange = (e) => { if (state.pv) { state.pv.showSim = e.target.checked; loadProjectRuns(); } };
    let searchTimer = null;
    $('#project-run-search').oninput = (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { if (state.pv) { state.pv.q = e.target.value.trim(); loadProjectRuns(); } }, 250);
    };
  },
  show() {
    renderProjectView();
    loadProjectRuns(state.pv?.runs ? 'refresh' : 'reset');
  },
});
