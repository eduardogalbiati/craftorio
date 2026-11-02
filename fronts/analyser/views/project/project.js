/* global api */
// A project's page (Projects › a project, #354): its name, then the tabs Overview (its folder,
// repository and unpushed commits, its workflow set and default, projects/project-workflows.js #486,
// and its runs in the shared run list, run-list.js: paged with an
// infinite scroll, filters and search answered by the service, #200), City (project-architecture.js,
// #373: the project's 3D city and its Analyze), Health (project-health.js, #730: the git facts, the
// Oracle's report and its findings, each of which becomes an issue; the Seeds section below it,
// project-seeds.js, #360) and Conflict map (project-conflict-map.js), in this order (#730: no
// Architecture or Refactor tab any more; a tab remembered as one of them opens the Overview). The
// selected tab is remembered per project. The page is the header's project: opening
// one makes it the app's project, and choosing another in the header switches the page to it.
// No sidebar entry of its own: Projects stays lit (`menu`). The header's "Ways of working" opens the
// interview drawer (project-ways-of-working.js, #487). After the new-project wizard's Finish (#642, spec
// R11) the Overview leads with the Next steps card (project-next-steps, as mock-7 of
// docs/work/first-project-onboarding/images, #669: "<name> is ready · <n> workflows" in its head (the count only
// for a project with its own workflow set), then a grid of entries:
// next-step-refactors, the project's proposals with a checkbox each and "File and add <n>" (the checked ones
// filed and added to the roadmap, then the Roadmap), next-step-idea → the Inbox, next-step-cadence's "Turn on"
// → the Health tab, where the findings become issues (#730; it does not turn anything on itself), and
// next-step-release-ci / next-step-screenshots shown disabled (later phases);
// next-steps-dismiss), remembered per project in localStorage multiagent.nextSteps.
// openProjectView (the Projects cards, the Conflict map links, scripts/screenshot.js) and
// loadProjectRunsThrottled (app.js run events) stay globals. Registers itself with registerView
// (view-registry.js); uses app.js globals ($, esc, state, api, errMsg, showView, openDrawer,
// noteRunMeta) and showProjects (views/projects/projects.js).

// [id, i18n key of its label]
const PV_TABS = [['overview', 'project.overview'], ['city', 'project.city'], ['health', 'project.health'], ['conflicts', 'project.conflict_map']];
const PV_TABS_KEY = 'multiagent.projectTabs';

// a map per project kept in localStorage under `key`: { <projectId>: <value> }
function pvStored(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
}
function pvRemember(key, id, value) {
  try { localStorage.setItem(key, JSON.stringify({ ...pvStored(key), [id]: value })); } catch { /* storage unavailable */ }
}

// the tab each project was last shown on: { <projectId>: <tab> }
function projectTabs() { return pvStored(PV_TABS_KEY); }
function rememberProjectTab(id, tab) { pvRemember(PV_TABS_KEY, id, tab); }

// #642: the Next steps card of the projects the wizard finished: { <projectId>: 'open' | 'dismissed' }
const PV_NEXT_STEPS_KEY = 'multiagent.nextSteps';
// [id, i18n key of its title, of its line (none: the proposals), of its button, later: shown disabled]: mock-7,
// spec R11 (release CI and screenshots come in later phases)
const PV_NEXT_STEPS = [
  ['refactors', 'onboarding.next_steps_refactors', null, 'onboarding.next_steps_file_add', false],
  ['idea', 'onboarding.next_steps_idea', 'onboarding.next_steps_idea_text', 'onboarding.open_inbox', false],
  ['cadence', 'onboarding.next_steps_cadence', 'onboarding.next_steps_cadence_text', 'onboarding.turn_on', false],
  ['release-ci', 'onboarding.next_steps_release_ci', 'onboarding.next_steps_release_ci_text', 'onboarding.add_to_roadmap', true],
  ['screenshots', 'onboarding.next_steps_screenshots', 'onboarding.next_steps_screenshots_text', 'onboarding.add_spike', true],
];
// the refactor proposals the card lists (the first ones, ranked)
const PV_NEXT_STEP_PROPOSALS = 5;
function nextSteps() { return pvStored(PV_NEXT_STEPS_KEY); }
function rememberNextSteps(id, value) { pvRemember(PV_NEXT_STEPS_KEY, id, value); }

// the card's proposals, read once per page (null while reading) and drawn when they arrive
function loadNextStepProposals(pv) {
  if (nextSteps()[pv.id] !== 'open' || pv.nextStepProposals !== undefined) return;
  pv.nextStepProposals = null;
  new Promise((resolve) => resolve(api.refactorProposals?.(pv.id))).then((list) => list, () => []).then((list) => {
    pv.nextStepProposals = Array.isArray(list) ? list : [];
    if (state.pv === pv && state.view === 'project') renderProjectView();
  });
  // mock-7's "3 workflows": the project's own workflow set; a project without one (the wizard's import)
  // shows no count, since everything the workspace can run is not the project's
  const set = pv.project?.workflows;
  pv.nextStepWorkflows = Array.isArray(set) ? set.length : 0;
}

const fileAndAddLabel = (pv) => t('onboarding.next_steps_file_add', { count: pv.nextStepPicked.size });

function nextStepsMarkup(pv) {
  if (nextSteps()[pv.id] !== 'open') return '';
  const proposals = () => {
    const list = pv.nextStepProposals;
    if (!list) return `<p class="muted small">${esc(t('onboarding.next_steps_reading'))}</p>`;
    if (!list.length) return `<p class="muted small">${esc(t('onboarding.review_refactors_empty'))}</p>`;
    return `<ul class="pr-next-step-picks">${list.slice(0, PV_NEXT_STEP_PROPOSALS).map((p) => `<li><label class="check small">
        <input type="checkbox" data-next-refactor="${esc(p.id)}"${pv.nextStepPicked.has(p.id) ? ' checked' : ''}>
        <span class="text-cut" title="${esc(p.title)}">${esc(p.title)}</span></label></li>`).join('')}</ul>`;
  };
  const entry = ([step, title, line, action, later]) => `<li class="pr-next-step" data-testid="next-step-${step}">
      <strong>${esc(t(title))}</strong>
      ${line ? `<span class="muted small">${esc(t(line, { name: pv.project?.name || '' }))}</span>` : proposals()}
      <button type="button" class="btn sm" data-next-step="${step}"${later ? ' disabled aria-disabled="true"' : ''}>${esc(step === 'refactors' ? fileAndAddLabel(pv) : t(action))}</button>
    </li>`;
  // mock-7's head: "<name> is ready", its workflows' count, then "city and refactor backlog done" once the
  // ranking made proposals
  const ready = [t('onboarding.next_steps_ready', { name: pv.project?.name || '' })];
  if (pv.nextStepWorkflows) ready.push(t('onboarding.next_steps_workflows', { count: pv.nextStepWorkflows }));
  if (pv.nextStepProposals?.length) ready.push(t('onboarding.next_steps_done'));
  return `<section class="card pr-next-steps" data-testid="project-next-steps">
      <header class="pr-next-steps-head"><h3>${esc(t('onboarding.next_steps_title'))}</h3>
        <span class="muted small pr-next-steps-ready">${esc(ready.join(' · '))}</span>
        <button type="button" class="btn ghost sm" data-testid="next-steps-dismiss" data-next-steps-dismiss aria-label="${esc(t('onboarding.next_steps_dismiss'))}">×</button></header>
      <ul class="pr-next-steps-list">${PV_NEXT_STEPS.map(entry).join('')}</ul>
    </section>`;
}

// an entry of the card leads to its screen (the card stays until dismissed); File and add first files the
// checked proposals and adds them to the roadmap as planned items (as the wizard's Finish does)
function onNextStepClick(step) {
  if (step === 'refactors') {
    const pv = state.pv;
    const failed = (e) => showToast(t('onboarding.next_steps_add_failed'), errMsg(e));
    for (const id of pv?.nextStepPicked || []) Promise.resolve(api.addRefactorToRoadmap(pv.id, id, { file: true })).catch(failed);
    // the added ones leave the card's list (never added twice)
    if (pv) {
      pv.nextStepProposals = (pv.nextStepProposals || []).filter((p) => !pv.nextStepPicked.has(p.id));
      pv.nextStepPicked = new Set();
    }
    showView('roadmap');
  }
  else if (step === 'idea') showView('inbox');
  else if (step === 'cadence' && state.pv) {
    state.pv.tab = 'health';
    rememberProjectTab(state.pv.id, state.pv.tab);
    renderProjectView();
  }
}

function newProjectPage(id) {
  const tab = projectTabs()[id];
  return {
    id, project: state.projects.find((p) => p.id === id) || null, runs: null, error: null, filter: 'all', showSim: false, q: '', expanded: new Set(), msgs: new Map(),
    nextStepProposals: undefined, nextStepPicked: new Set(),
    tab: PV_TABS.some(([t]) => t === tab) ? tab : 'overview',
  };
}

// tab: open the page on this tab (the Conflict map links); nextSteps: show the Next steps card (the
// wizard's Finish, #642); while the card is open the page opens on the Overview that leads with it
function openProjectView(id, { tab = null, nextSteps: withNextSteps = false } = {}) {
  if (withNextSteps) rememberNextSteps(id, 'open');
  if (state.pv?.id !== id) state.pv = newProjectPage(id);
  if (!tab && nextSteps()[id] === 'open') tab = 'overview';
  if (tab) { state.pv.tab = tab; rememberProjectTab(id, tab); }
  // the header's project follows the page (the page is drawn right after)
  window.CurrentProject?.set(id, { redraw: false });
  showView('project');
}
window.Actions.register('openProject', openProjectView); // the Projects cards ask for it (actions.js)

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
      <h1>${esc(p?.name || t('project.project'))}</h1>
      ${p?.description ? `<p class="muted">${esc(p.description)}</p>` : ''}
    </div>
    <div class="row">
      <button class="btn ghost" id="pv-open-folder" ${p?.exists ? '' : 'disabled'}>${t('project.open_folder')}</button>
      <button class="btn ghost" id="pv-ways-of-working" data-testid="project-ways-of-working" ${p?.exists ? '' : 'disabled'}>${t('project.ways_of_working')}</button>
      <button class="btn primary" id="pv-start">${t('project.start_workflow')}</button>
    </div>`;
  $('#pv-open-folder').onclick = () => p && api.openPath(p.folder);
  // #487: the interview drawer (project-ways-of-working.js)
  $('#pv-ways-of-working').onclick = () => p && window.ProjectWaysOfWorking?.open(p);
  $('#pv-start').onclick = () => openDrawer({ project: pv.id });
  $('#project-tabs').innerHTML = PV_TABS.map(([id, label]) =>
    `<button type="button" class="tab${pv.tab === id ? ' active' : ''}" role="tab" data-pv-tab="${id}" data-testid="project-tab-${id}" aria-selected="${pv.tab === id}" aria-controls="project-panel-${id}">${t(label)}</button>`).join('');
  for (const [id] of PV_TABS) $(`#project-panel-${id}`).classList.toggle('hidden', pv.tab !== id);
  if (pv.tab === 'conflicts') window.ProjectConflictMap?.show(pv.id, $('#project-conflicts'));
  if (pv.tab === 'city') window.ProjectArchitecture?.show(pv.id, $('#project-city'));
  if (pv.tab === 'health') {
    window.ProjectHealth?.show(pv.id, $('#project-health'));
    window.ProjectSeeds?.show(pv.id, $('#project-seeds'));
  }
  if (pv.tab !== 'overview') return;
  loadNextStepProposals(pv);
  $('#project-next-steps-box').innerHTML = nextStepsMarkup(pv);
  $('#project-info').innerHTML = `
    <dl class="kv">
      <dt>${t('project.folder')}</dt><dd class="${p && !p.exists ? 'warn-text' : ''}">${esc(p?.folder || '—')}${p && !p.exists ? t('project.not_found') : ''}</dd>
      <dt>${t('project.repository')}</dt><dd>${esc(p?.repo || '—')}</dd>
      ${pv.local?.ahead > 0 ? `<dt>${t('project.not_pushed')}</dt><dd class="warn-text">${t(pv.local.issues?.length ? 'project.commits_on_local_base_closes' : 'project.commits_on_local_base', { count: pv.local.ahead, base: esc(pv.local.base), issues: esc((pv.local.issues || []).map((n) => `#${n}`).join(', ')) })}</dd>` : ''}
    </dl>`;
  // #486: the project's workflow set and default, edited here (project-workflows.js)
  window.ProjectWorkflows?.showPage(p, $('#project-workflows'));
  renderRunList(pv, {
    prefix: 'project', box: '#project-runs', empty: t('project.no_workflows_have_run_in_this'),
    start: () => openDrawer({ project: pv.id }), rerender: renderProjectView,
    reload: () => loadProjectRuns(), loadMore: () => loadProjectRuns('more'),
  });
}

// the page's delegated clicks: the Next steps card, a tab, then the Conflict map tab's controls and rows
function onProjectPageClick(e) {
  // a proposal's checkbox of the card: its count on File and add (the box keeps its own checked state)
  const pick = e.target.closest('[data-next-refactor]');
  if (pick && state.pv) {
    const picked = state.pv.nextStepPicked;
    const id = pick.dataset.nextRefactor;
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    const button = $('#project-next-steps-box [data-next-step="refactors"]');
    if (button) button.textContent = fileAndAddLabel(state.pv);
    return;
  }
  const step = e.target.closest('[data-next-step]');
  if (step) { onNextStepClick(step.dataset.nextStep); return; }
  if (e.target.closest('[data-next-steps-dismiss]') && state.pv) {
    rememberNextSteps(state.pv.id, 'dismissed');
    renderProjectView();
    return;
  }
  const tab = e.target.closest('[data-pv-tab]');
  if (tab && state.pv) {
    state.pv.tab = tab.dataset.pvTab;
    rememberProjectTab(state.pv.id, state.pv.tab);
    renderProjectView();
    return;
  }
  if (window.ProjectWorkflows?.onClick(e)) return;
  if (!window.ProjectArchitecture?.onClick(e) && !window.ProjectHealth?.onClick(e) && !window.ProjectSeeds?.onClick(e)) window.ProjectConflictMap?.onClick(e);
}

registerView({
  id: 'project',
  menu: 'projects',
  markup: () => `
      <section id="view-project" class="view hidden" data-testid="project-page">
        <button id="btn-project-back" class="link-btn back-link" type="button">${t('project.projects')}</button>
        <div id="project-head" class="page-head"></div>
        <div id="project-tabs" class="tabs page-tabs" role="tablist" aria-label="${t('project.project')}"></div>
        <div id="project-panel-overview" role="tabpanel" aria-label="${t('project.overview')}" data-testid="project-overview">
          <div id="project-next-steps-box"></div>
          <div id="project-info" class="pr-head-info"></div>
          <div id="project-workflows"></div>
          <div class="pr-toolbar">
            <div id="project-run-filters" class="chips"></div>
            <span class="spacer"></span>
            <input type="text" id="project-run-search" class="pr-search" placeholder="${t('project.search_runs')}" aria-label="${t('project.search_runs')}" spellcheck="false" />
            <label class="check small"><input type="checkbox" id="project-show-sim" /><span>${t('project.show_simulated')}</span></label>
            <button id="btn-project-refresh" class="btn sm ghost">${t('project.refresh')}</button>
          </div>
          <p id="project-runs-error" class="error small"></p>
          <div id="project-runs" class="pr-list"></div>
        </div>
        <div id="project-panel-city" class="hidden" role="tabpanel" aria-label="${t('project.city')}" data-testid="project-city">
          <div id="project-city"></div>
        </div>
        <div id="project-panel-health" class="hidden" role="tabpanel" aria-label="${t('project.health')}" data-testid="project-health-panel">
          <div id="project-health"></div>
          <div id="project-seeds"></div>
        </div>
        <div id="project-panel-conflicts" class="hidden" role="tabpanel" aria-label="${t('project.conflict_map')}" data-testid="project-conflict-map">
          <div id="project-conflicts"></div>
        </div>
      </section>`,
  mount() {
    // Back: the Projects screen when its front is shipped (the showProjects action), else Home
    $('#btn-project-back').onclick = () => (window.Actions.has('showProjects') ? window.Actions.call('showProjects') : showView('dashboard'));
    $('#view-project').addEventListener('click', onProjectPageClick);
    $('#view-project').addEventListener('change', (e) => window.ProjectArchitecture?.onChange(e) || window.ProjectHealth?.onChange(e) || window.ProjectConflictMap?.onChange(e));
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
