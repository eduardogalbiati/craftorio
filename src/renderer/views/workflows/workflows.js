/* global api */
// Workflows screen and its tabs (state.workflowsTab; #254: each is an entry of the menu's Workflows
// group and a tab of the screen): Definitions (#137: the workflows in sections by category, compact cards with
// origin badge, Restore default, Open in builder, Run, and the saved pipelines connected), Runs (every run, in the shared run
// list of run-list.js; its Artifacts tab opens views/artifacts/), Builder (builder.js, with its two dialogs) and Pipelines (the saved
// pipelines alone). A round Supervisor button in the bottom-right corner on every tab (#409,
// .po-fab.sup-fab, data-testid=supervisor-fab; its robot and unseen dot drawn by views/supervisor/)
// opens the Supervisor's chat as a drawer (#264). The header has the
// Keep awake switch on Runs, Definitions and Pipelines (keep-awake.js, #162). The deep links
// showRunInList (app.js openPastRun) and showWorkflowDefinition (the Agents menu), and the runs'
// reload on run events (loadWorkflowRunsThrottled, workflowRunsVisible, renderWorkflowRuns) stay
// globals. Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state,
// api, errMsg, showView, openDrawer, noteRunMeta, confirmDialog, showToast, CATEGORIES).

// each tab's hint and title: catalog keys
const WORKFLOW_PAGES = {
  runs: 'workflows.page_runs_hint',
  definitions: 'workflows.page_definitions_hint',
  builder: 'workflows.page_builder_hint',
  pipelines: 'workflows.page_pipelines_hint',
};
const WORKFLOW_TITLES = { runs: 'workflows.runs', definitions: 'workflows.definitions', builder: 'workflows.builder', pipelines: 'workflows.pipelines' };
function showWorkflowsTab(tab) {
  if (!WORKFLOW_PAGES[tab]) tab = 'runs';
  state.workflowsTab = tab;
  if (state.view !== 'workflows') return showView('workflows');
  document.querySelectorAll('[data-wtab]').forEach((b) => {
    const on = b.dataset.wtab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  // the menu's entry of the tab (app.js)
  paintNav();
  // Pipelines is the Definitions page showing the pipelines alone
  const page = tab === 'pipelines' ? 'definitions' : tab;
  document.querySelectorAll('[data-wpage]').forEach((p) => p.classList.toggle('hidden', p.dataset.wpage !== page));
  $('#workflows-page-title').textContent = t(WORKFLOW_TITLES[tab]);
  $('#workflows-page-hint').textContent = t(WORKFLOW_PAGES[tab]);
  // Keep awake (#162) on Runs, Definitions and Pipelines; the Builder needs the room
  $('#workflows-keep-awake').classList.toggle('hidden', tab === 'builder');
  if (tab !== 'builder') refreshKeepAwake();
  if (page === 'definitions') refreshWorkflows();
  // back on the list: the pages it had, again (a deep link starts over to reach its run)
  if (tab === 'runs') { renderWorkflowRuns(); loadWorkflowRuns(state.wr.runs && !state.wr.upTo ? 'refresh' : 'reset'); }
  if (tab === 'builder') window.showBuilder?.();
}

const workflowRunsVisible = () => state.view === 'workflows' && state.workflowsTab === 'runs';

// Every run, in the same list as Projects > Project.
function renderWorkflowRuns() {
  renderRunList(state.wr, {
    prefix: 'workflow', box: '#workflow-runs', empty: t('workflows.no_workflows_have_run_yet'),
    start: () => openDrawer(), rerender: renderWorkflowRuns,
    reload: () => loadWorkflowRuns(), loadMore: () => loadWorkflowRuns('more'),
  });
}

// mode: 'reset' (first page), 'more' (next page), 'refresh' (the loaded pages again): run-list.js
// loadRunListPage. A reset replaces a load in flight; 'more' and 'refresh' wait for it.
let wrLoading = null;
let wrLastLoad = 0;
let wrTimer = null;
function loadWorkflowRuns(mode = 'reset') {
  if (wrLoading && mode !== 'reset') return wrLoading;
  const wr = state.wr;
  const p = (async () => {
    const res = await loadRunListPage(wr, (opts) => api.listRuns(opts), mode);
    if (res) noteRunMeta(res.runs || []);
    if (wrLoading === p) wrLoading = null;
    wrLastLoad = Date.now();
    if (!workflowRunsVisible()) return;
    renderWorkflowRuns();
    // a deep link to a run (showRunInList): the page reached it, scroll there
    if (res && wr.upTo && mode === 'reset') {
      const id = wr.upTo;
      wr.upTo = null;
      document.querySelector(`.pr-run[data-run="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
    }
  })();
  wrLoading = p;
  return p;
}

// At most one reload of the loaded pages every 10 s from run events while the tab is visible (a run's
// own row follows its events: refreshRunRow).
function loadWorkflowRunsThrottled() {
  if (wrTimer || !workflowRunsVisible()) return;
  const wait = Math.max(0, 10000 - (Date.now() - wrLastLoad));
  wrTimer = setTimeout(() => { wrTimer = null; if (workflowRunsVisible()) loadWorkflowRuns('refresh'); }, wait);
}

// Definitions (#137): the workflows in sections by category (metadata.category; unknown → Other),
// each a compact card (modes, declared outputs, agents, the steps as a one-line flow that expands),
// and the saved pipelines (api.listPipelines, #135) as connected cards in their category's section.
// A section filter (pills) and a search narrow both; "Used in" links a workflow to its pipelines.
// each section's hint: catalog keys. #485: first the four flows a repository's manifest files its
// workflows under (src/project-manifest.js), shown always; the app's CATEGORIES (app.js) name the others
const WF_SECTIONS = {
  intake: 'workflows.section_intake_hint',
  solo: 'workflows.section_solo_hint',
  team: 'workflows.section_team_hint',
  release: 'workflows.section_release_hint',
  plan: 'workflows.section_plan_hint',
  build: 'workflows.section_build_hint',
  monitor: 'workflows.section_monitor_hint',
  other: 'workflows.section_other_hint',
};
// repository: the projects' repository workflows (origin 'repository'), manifestErrors: a malformed
// manifest's entry per project (#485); both apart from state.workflows, which other screens read
const wfDefs = { section: 'all', query: '', open: new Set(), pipelines: [], pipelinesError: null, repository: [], manifestErrors: [] };
const wfSectionOf = (category) => (category && Object.hasOwn(WF_SECTIONS, category) ? category : 'other');
const wfSectionName = (key) => CATEGORIES[key] || { intake: t('workflows.section_intake'), solo: t('workflows.section_solo'), team: t('workflows.section_team'), release: t('workflows.section_release') }[key] || t('workflows.section_other');
const isManifestError = (w) => w.origin === 'repository' && w.error && w.name === '.multiagent/project.yaml';
const wfByFile = (file) => state.workflows.find((w) => w.file === file);
// A pipeline sits in its own category's section, else in its first workflow's.
const pipeSection = (p) => wfSectionOf(p.category || wfByFile(p.stages[0]?.workflow)?.category);

function wfMatches(w, q) {
  if (!q) return true;
  const agents = Object.entries(w.agents || {}).flatMap(([n, a]) => [n, a.model, a.provider]);
  return [w.name, w.description, w.file, ...(w.tags || []), ...Object.keys(w.outputs || {}), ...(w.steps || []).map((s) => s.id), ...agents]
    .some((t) => String(t || '').toLowerCase().includes(q));
}
function pipeMatches(p, q) {
  if (!q) return true;
  return [p.name, p.description, p.file, ...p.stages.flatMap((s) => [s.workflow, wfByFile(s.workflow)?.name])]
    .some((t) => String(t || '').toLowerCase().includes(q));
}

// #485: the projects with a folder, each asked for its repository workflows alone (a failing project lists none)
async function repositoryLists() {
  const projects = await (api.listProjects ? api.listProjects() : Promise.resolve([])).catch(() => []);
  if (projects?.length) state.projects = projects;
  return Promise.all((projects || []).filter((p) => p.folder).map((p) => api.listWorkflows({ projectId: p.id, repositoryOnly: true }).catch(() => [])));
}

async function refreshWorkflows() {
  wfDefs.pipelinesError = null;
  const [workflows, pipelines, perProject] = await Promise.all([
    api.listWorkflows(),
    (api.listPipelines ? api.listPipelines() : Promise.resolve([])).catch((e) => { wfDefs.pipelinesError = errMsg(e); return []; }),
    repositoryLists(),
  ]);
  // a workflow a manifest names without a file (origin 'manifest', by name: the file's stem) takes
  // the manifest's category (the first project's)
  const placed = new Map();
  const repository = new Map();
  const errors = new Map();
  for (const w of [...perProject.flat(), ...workflows]) {
    if (w.origin === 'manifest') { if (w.category && !placed.has(w.name)) placed.set(w.name, w.category); continue; }
    if (w.origin !== 'repository') continue;
    (isManifestError(w) ? errors : repository).set(`${w.projectId}\n${w.file}`, w);
  }
  const stem = (file) => String(file || '').replace(/\.ya?ml$/i, '');
  state.workflows = workflows.filter((w) => w.origin !== 'repository' && w.origin !== 'manifest').map((w) => ({ ...w, category: placed.get(stem(w.file)) || w.category }));
  wfDefs.repository = [...repository.values()];
  wfDefs.manifestErrors = [...errors.values()];
  wfDefs.pipelines = pipelines;
  renderWorkflowDefinitions();
}

function renderWorkflowDefinitions() {
  const box = $('#workflows-list');
  const filters = $('#wf-sections');
  // #254: the Pipelines tab is this page with the pipelines alone
  const pipesOnly = state.workflowsTab === 'pipelines';
  const pipesError = wfDefs.pipelinesError ? `<p class="error small">${t('workflows.pipelines_could_not_be_read')} ${esc(wfDefs.pipelinesError)}</p>` : '';
  // #485: a malformed repository manifest, per project, above the sections (its project runs on the workspace's workflows)
  const projectName = (id) => (state.projects || []).find((p) => p.id === id)?.name || id;
  const manifestErrors = pipesOnly ? '' : wfDefs.manifestErrors.map((e) => `<p class="error small" role="alert" data-testid="workflows-manifest-error">${esc(`${projectName(e.projectId)}: ${e.error}`)}</p>`).join('');
  if (pipesOnly ? !wfDefs.pipelines.length : !state.workflows.length && !wfDefs.repository.length) {
    filters.innerHTML = '';
    box.innerHTML = pipesOnly
      ? `${pipesError}<div class="empty-state"><b>${t('workflows.no_pipelines_yet')}</b><p class="muted">${t('workflows.a_pipeline_chains_workflows_start_a')}</p></div>`
      : `${manifestErrors}<div class="empty-state"><b>${t('workflows.no_workflows')}</b><p class="muted">${t('workflows.add_yaml_files_to_the_workflows')}</p></div>`;
    return;
  }
  const q = wfDefs.query.trim().toLowerCase();
  // the four flows (the sections the app's CATEGORIES do not name) lead, 'other' closes
  const flows = Object.keys(WF_SECTIONS).filter((k) => k !== 'other' && !CATEGORIES[k]);
  const keys = [...flows, ...Object.keys(CATEGORIES), 'other'];
  const workflows = pipesOnly ? [] : [...state.workflows, ...wfDefs.repository].filter((w) => wfMatches(w, q));
  const pipelines = wfDefs.pipelines.filter((p) => pipeMatches(p, q));
  const yours = (w) => w.origin === 'custom' || w.origin === 'repository';
  const inSection = (key) => ({
    // bundled workflows first, then yours and the repositories', each by name
    workflows: workflows.filter((w) => wfSectionOf(w.category) === key)
      .sort((a, b) => yours(a) - yours(b) || String(a.name).localeCompare(String(b.name))),
    pipelines: pipelines.filter((p) => pipeSection(p) === key),
  });
  const sections = Object.fromEntries(keys.map((k) => [k, inSection(k)]));
  const count = (k) => sections[k].workflows.length + sections[k].pipelines.length;
  const pills = [['all', t('workflows.section_all'), workflows.length + pipelines.length], ...keys.filter((k) => k !== 'other' || count(k)).map((k) => [k, wfSectionName(k), count(k)])];
  if (wfDefs.section !== 'all' && !keys.includes(wfDefs.section)) wfDefs.section = 'all';
  filters.innerHTML = pills.map(([k, label, n]) => `<button class="chip ${wfDefs.section === k ? 'active' : ''}" data-section="${k}" aria-pressed="${wfDefs.section === k}">${esc(label)} <span class="muted">${n}</span></button>`).join('');
  filters.querySelectorAll('[data-section]').forEach((b) => (b.onclick = () => { wfDefs.section = b.dataset.section; renderWorkflowDefinitions(); }));

  // the four flows stay visible, empty too, unless a search narrows the list
  const always = (k) => !pipesOnly && !q && flows.includes(k);
  const shown = keys.filter((k) => (wfDefs.section === 'all' || wfDefs.section === k) && (count(k) || always(k)));
  if (!shown.length) {
    box.innerHTML = `<div class="empty-state"><b>${t(pipesOnly ? 'workflows.no_pipeline_matches' : 'workflows.no_workflow_matches')}</b><p class="muted">${t(q ? 'workflows.nothing_matches_query_in_section' : 'workflows.nothing_in_section', { query: esc(wfDefs.query.trim()), section: esc(wfDefs.section === 'all' ? t('workflows.any_section') : wfSectionName(wfDefs.section)) })}</p><button class="btn ghost sm" data-clear>${t('workflows.clear_the_filters')}</button></div>`;
    box.querySelector('[data-clear]').onclick = () => { wfDefs.section = 'all'; wfDefs.query = ''; $('#wf-search').value = ''; renderWorkflowDefinitions(); };
    return;
  }
  box.innerHTML = pipesError + manifestErrors + shown.map((k) => {
    const s = sections[k];
    const n = (x, key) => t(key, { count: x });
    return `
    <section class="wf-section" data-section="${k}" data-testid="workflow-category" data-category="${k}">
      <header class="wf-section-head">
        <h2>${esc(wfSectionName(k))}</h2>
        ${pipesOnly ? '' : `<span class="badge cat-${k}">${n(s.workflows.length, 'workflows.workflows_count')}</span>`}
        ${s.pipelines.length ? `<span class="badge${pipesOnly ? ` cat-${k}` : ''}">${n(s.pipelines.length, 'workflows.pipelines_count')}</span>` : ''}
        <span class="muted small" data-testid="workflow-category-explanation">${esc(t(WF_SECTIONS[k]))}</span>
      </header>
      ${s.pipelines.length ? `<div class="wf-pipes">${s.pipelines.map(pipelineCard).join('')}</div>` : ''}
      ${s.workflows.length ? `<div class="wf-grid">${s.workflows.map(workflowCard).join('')}</div>` : ''}
      ${count(k) ? '' : `<p class="muted small">${t('workflows.section_empty')}</p>`}
    </section>`;
  }).join('');
  wireWorkflowDefinitions(box);
}

// The step list collapsed into one line of step chips (gates dashed); a long flow shows its first
// steps and how many more (its last steps in the file are often failure branches, not the end).
// A step of a workflow definition as people read it (#245): its YAML `display`, else its id made
// readable (the same in stepList, for agents too); the id stays in the tooltip.
function stepFlow(w) {
  const steps = w.steps || [];
  const wfReadable = (id, def) => def?.display || (typeof displayName === 'function' ? displayName(id) : String(id || ''));
  const chip = (s) => `<span class="step-chip ${s.type === 'human_approval' ? 'human' : ''}" title="${esc(s.type === 'human_approval' ? t('workflows.id_human_approval', { id: s.id }) : s.id)}">${esc(wfReadable(s.id, s))}</span>`;
  const shown = steps.length > 7 ? steps.slice(0, 6) : steps;
  return `${shown.map(chip).join('<span class="arrow">›</span>')}${shown.length < steps.length ? `<span class="muted small">${t('workflows.value_more', { value: steps.length - shown.length })}</span>` : ''}`;
}

function workflowCard(w) {
  const open = wfDefs.open.has(w.file);
  const agents = Object.entries(w.agents || {});
  const avatars = agents.slice(0, 6).map(([n, a]) => `<span class="wf-av" title="${esc(`${n} · ${a.provider}${a.model ? `/${a.model}` : ''}`)}">${robotAvatar(a.provider, a.model, 'idle', w.name, n)}</span>`).join('')
    + (agents.length > 6 ? `<span class="wf-av wf-av-more" title="${esc(agents.slice(6).map(([n, a]) => `${n} · ${a.provider}/${a.model}`).join('\n'))}">+${agents.length - 6}</span>` : '');
  const mode = Array.isArray(w.inputs?.mode?.enum) ? w.inputs.mode : null;
  const modes = mode ? mode.enum.map((m) => `<span class="pill pill-idle" title="${esc(`${m === mode.default ? t('workflows.default_mode') : ''}${mode.description || ''}`)}">${esc(WorkflowInputs.optionLabel(mode, m))}</span>`).join('') : '';
  const outputs = Object.entries(w.outputs || {}).map(([o, d]) => `<span class="badge wf-out" title="${esc(`${d?.description ? `${d.description} ` : ''}${t('workflows.declared_output_tip')}`)}">⇢ ${esc(o)}</span>`).join('');
  const usedIn = wfDefs.pipelines.filter((p) => p.stages.some((s) => s.workflow === w.file));
  const used = usedIn.map((p) => {
    const i = p.stages.findIndex((s) => s.workflow === w.file);
    const role = i === 0 ? t('workflows.starts_it') : t('workflows.stage_of_total', { stage: i + 1, total: p.stages.length });
    return `<button class="link-btn" data-goto-pipe="${esc(p.file)}" title="${esc(`${p.name}: ${role}`)}">${esc(p.name)}</button> <span class="muted">(${role})</span>`;
  }).join(', ');
  // #319: what it needs beyond Claude Code and Git (the Setup hides the unpicked ones)
  const model = typeof SetupModel === 'undefined' ? null : SetupModel;
  const needs = (model ? model.requirementBadges(w.requirements) : []).map((b) => `<span class="badge" title="${t('workflows.the_clis_it_needs_with_its')}">${esc(b)}</span>`).join('');
  const repo = w.origin === 'repository';
  const actions = repo ? repositoryWorkflowActions() : workspaceWorkflowActions();
  const diff = repo ? repositoryWorkflowDiff() : '';
  return `
    <article class="wf-card${w.origin === 'custom' ? ' custom' : ''}" data-file="${esc(w.file)}" data-testid="${repo ? 'repository-workflow' : 'workflow-card'}"${repo ? ` data-project="${esc(w.projectId)}" data-commit="${esc(w.commit)}"` : ''} tabindex="-1">
      <div class="wf-card-head">
        <div class="wf-card-title">
          <h3 title="${esc(w.name)}">${esc(w.name)} ${w.version ? `<span class="muted small">v${esc(w.version)}</span>` : ''}</h3>
          <div class="badges">${originBadge(w)} <span class="badge mono wf-file" title="${esc(w.file)}">${esc(w.file)}</span></div>
        </div>
        ${avatars ? `<div class="wf-avs">${avatars}</div>` : ''}
      </div>
      <p class="muted small wf-desc" title="${esc(w.error ? t('workflows.error_error', { error: w.error }) : w.description || '')}">${esc(w.error ? t('workflows.error_error', { error: w.error }) : w.description || '')}</p>
      ${(w.warnings || []).map((m) => `<p class="small warn-text wf-warning" role="status" data-testid="workflow-warning">${t('workflows.warning')} ${esc(m)}</p>`).join('')}
      ${modes || outputs || needs ? `<div class="wf-tags">${modes}${outputs}${needs}</div>` : ''}
      ${(w.steps || []).length ? `<button class="wf-flow steps-mini" data-flow aria-expanded="${open}" title="${open ? t('workflows.hide_the_steps') : t('workflows.show_every_step')}"><span class="badge">${t('workflows.steps_count', { count: w.steps.length })}</span>${stepFlow(w)}<span class="wf-flow-caret" aria-hidden="true">${open ? '▴' : '▾'}</span></button>` : ''}
      ${open ? `<ol class="wf-steps">${stepList(w)}</ol>` : ''}
      ${used ? `<p class="small wf-used"><span class="muted">${t('workflows.used_in')}</span> ${used}</p>` : ''}
      ${diff}
      <div class="row wf-actions">
        ${actions}
      </div>
    </article>`;

  // a workspace workflow's actions: restore, whether Start offers it (#319), the builder and Run
  function workspaceWorkflowActions() {
    const builderTip = t(w.origin !== 'custom' ? 'workflows.builder_tip_bundled' : w.builder ? 'workflows.builder_tip_edit' : 'workflows.builder_tip_agents_only');
    const shown = !model || !(state.settings?.hiddenWorkflows || []).includes(model.workflowId(w.file));
    return `${w.restorable ? `<button class="btn ghost sm" data-restore title="${t('workflows.move_your_edited_copy_to_the')}">${t('workflows.restore_default')}</button>` : ''}
        <label class="wf-show-start small" title="${t('workflows.off_start_does_not_offer_it')}"><label class="switch"><input type="checkbox" data-show-start data-testid="workflow-show-in-start" aria-label="${t('workflows.show_in_start_name', { name: esc(w.name) })}" ${shown ? 'checked' : ''} /><span></span></label>${t('workflows.show_in_start')}</label>
        <span class="spacer"></span>
        <button class="btn ghost sm" data-builder ${w.error ? 'disabled' : ''} title="${esc(builderTip)}">${t('workflows.open_in_builder')}</button>
        <button class="btn primary sm" data-run ${w.error ? 'disabled' : ''}>${t('workflows.run')}</button>`;
  }

  // #485: a repository's workflow, read-only and off until accepted for its commit: no Run
  function repositoryWorkflowActions() {
    return `<span class="badge ${w.accepted ? 'ok' : 'warn'}" data-testid="workflow-acceptance">${t(w.accepted ? 'workflows.accepted' : 'workflows.not_accepted')}</span>
        ${w.accepted ? '' : `<button class="btn primary sm" data-accept data-testid="workflow-accept" title="${t('workflows.accept_tip')}">${t('workflows.accept')}</button>`}
        <span class="spacer"></span>
        <button class="btn ghost sm" data-clone data-testid="workflow-clone" ${w.error ? 'disabled' : ''}>${t('workflows.clone')}</button>
        <button class="btn ghost sm" data-builder data-testid="workflow-open-builder" ${w.error ? 'disabled' : ''} title="${t('workflows.builder_tip_bundled')}">${t('workflows.open_in_builder')}</button>`;
  }

  // #485: what changed in a repository workflow since the commit the owner last accepted
  function repositoryWorkflowDiff() {
    if (!w.diff || w.accepted) return '';
    return `<details class="wf-diff small"><summary>${t('workflows.changes_since', { commit: esc(String(w.acceptedCommit || '').slice(0, 7)) })}</summary><pre class="mono">${esc(w.diff)}</pre></details>`;
  }
}

// A pipeline (#135): its workflows connected, each arrow with the outputs it maps into the next
// workflow's inputs (map: { input: output }) and its condition; a Product Owner or queue stage ends it.
function pipelineCard(p) {
  const stages = p.stages.map((s, i) => {
    const w = s.workflow ? wfByFile(s.workflow) : null;
    const map = Object.entries(s.map || {}).map(([input, output]) => `<span class="badge" title="${esc(t('workflows.output_output_of_the_previous_workflow', { output, input }))}">${esc(output === '@run' ? t('workflows.the_run') : output)} → ${esc(input)}</span>`).join('');
    const link = i ? `<div class="wf-link"><span class="wf-link-arrow" aria-hidden="true">→</span>${map}<span class="muted small">${t('workflows.on')} ${esc(s.on || s.when || 'success')}</span></div>` : '';
    if (s.target === 'product_owner') {
      return `${link}<span class="wf-stage wf-stage-target" data-testid="pipeline-stage" title="${t('workflows.the_product_owner_places_the_produced')}"><b>${t('workflows.product_owner')}</b><span class="badge">${t('workflows.roadmap')}</span></span>`;
    }
    return `${link}<button class="wf-stage" data-testid="pipeline-stage" data-goto="${esc(s.workflow)}" title="${esc(w ? `${s.target === 'queue' ? t('workflows.produced_issues_queued_for') : ''}${w.name} (${s.workflow})` : t('workflows.workflow_not_in_the_workflows_folder', { workflow: s.workflow }))}">
      <b>${s.target === 'queue' ? t('workflows.queue') : ''}${esc(w?.name || s.workflow)}</b>
      ${w ? `<span class="badge cat-${esc(wfSectionOf(w.category))}">${esc(wfSectionName(wfSectionOf(w.category)))}</span>` : `<span class="badge warn">${t('workflows.missing')}</span>`}
    </button>`;
  }).join('');
  const files = p.stages.map((s) => s.workflow || '').join('|');
  return `
    <article class="wf-pipe" data-testid="pipeline-card" data-pipe="${esc(p.file)}" data-files="${esc(files)}" tabindex="-1">
      <div class="wf-pipe-head">
        <span class="badge">${t('workflows.pipeline')}</span>
        <h3 title="${esc(p.name)}">${esc(p.name)}</h3>
        <span class="muted small wf-desc" data-testid="pipeline-description" title="${esc(p.error ? t('workflows.error_error', { error: p.error }) : p.description || '')}">${esc(p.error ? t('workflows.error_error', { error: p.error }) : p.description || '')}</span>
        <span class="spacer"></span>
        ${p.origin ? originBadge(p) : ''}
        <span class="badge mono wf-file" title="${esc(p.file)}">${esc(p.file)}</span>
        ${p.restorable ? `<button class="btn ghost sm" data-restore-pipe title="${t('workflows.move_your_edited_copy_to_the')}">${t('workflows.restore_default')}</button>` : ''}
        <button class="btn primary sm" data-run-pipe ${p.error || !wfByFile(p.stages[0]?.workflow) ? 'disabled' : ''} title="${t('workflows.opens_the_start_drawer_on_the')}">${t('workflows.run_pipeline')}</button>
      </div>
      ${p.error ? `<p class="error small wf-pipe-error">${esc(p.error)}</p>` : ''}
      ${stages ? `<div class="wf-pipe-stages">${stages}</div>` : ''}
    </article>`;
}

function wireWorkflowDefinitions(box) {
  const cardOf = (el) => el.closest('.wf-card').dataset.file;
  const focus = (el) => { if (!el) return; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 1500); };
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => openDrawer({ workflow: cardOf(b) })));
  // #485: a repository card carries its project and commit; the builder opens it read-only
  const repoOf = (el) => { const c = el.closest('.wf-card'); return { projectId: c.dataset.project, file: c.dataset.file, commit: c.dataset.commit }; };
  box.querySelectorAll('[data-builder]').forEach((b) => (b.onclick = () => window.openInBuilder?.(cardOf(b), { projectId: b.closest('.wf-card').dataset.project || null })));
  box.querySelectorAll('[data-accept]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api.acceptWorkflow(repoOf(b)); } catch (e) { b.disabled = false; return showToast(t('workflows.accept_failed'), errMsg(e)); }
    refreshWorkflows();
  }));
  box.querySelectorAll('[data-clone]').forEach((b) => (b.onclick = async () => {
    const { projectId, file } = repoOf(b);
    try {
      const r = await api.cloneRepositoryWorkflow({ projectId, file });
      showToast(t('builder.workflow_cloned'), t('builder.file_your_own_copy_you_can', { file: r.file }));
    } catch (e) { return showToast(t('workflows.could_not_save'), errMsg(e)); }
    refreshWorkflows();
  }));
  // #319: Show in Start, the way back from the Setup's Workflows step (settings.hiddenWorkflows)
  box.querySelectorAll('[data-show-start]').forEach((b) => (b.onchange = async () => {
    const id = SetupModel.workflowId(cardOf(b));
    const hidden = (state.settings.hiddenWorkflows || []).filter((x) => x !== id);
    try {
      state.settings = await api.setSettings({ hiddenWorkflows: b.checked ? hidden : [...hidden, id] });
    } catch (e) {
      b.checked = !b.checked;
      showToast(t('workflows.could_not_save'), errMsg(e));
    }
  }));
  box.querySelectorAll('[data-flow]').forEach((b) => (b.onclick = () => {
    const file = cardOf(b);
    if (!wfDefs.open.delete(file)) wfDefs.open.add(file);
    renderWorkflowDefinitions();
    box.querySelector(`.wf-card[data-file="${CSS.escape(file)}"] [data-flow]`)?.focus({ preventScroll: true });
  }));
  box.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = async () => {
    const file = cardOf(b);
    if (!(await confirmDialog(t('workflows.restore_default'), t('workflows.move_your_edited_file_to_the', { file }), t('workflows.restore')))) return;
    try { await api.restoreWorkflow(file); } catch (e) { showToast(t('workflows.restore_failed'), e.message); }
    refreshWorkflows();
  }));
  box.querySelectorAll('[data-goto-pipe]').forEach((b) => (b.onclick = () => focus(box.querySelector(`.wf-pipe[data-pipe="${CSS.escape(b.dataset.gotoPipe)}"]`))));
  box.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => focus(box.querySelector(`.wf-card[data-file="${CSS.escape(b.dataset.goto)}"]`))));
  // the Start drawer on the pipeline (#135): it asks for the first stage's inputs, then runPipeline
  box.querySelectorAll('[data-run-pipe]').forEach((b) => (b.onclick = () => {
    const p = wfDefs.pipelines.find((x) => x.file === b.closest('.wf-pipe').dataset.pipe);
    return api.runPipeline ? openDrawer({ pipeline: p.file }) : openDrawer({ workflow: p.stages[0].workflow });
  }));
  box.querySelectorAll('[data-restore-pipe]').forEach((b) => (b.onclick = async () => {
    const file = b.closest('.wf-pipe').dataset.pipe;
    if (!(await confirmDialog(t('workflows.restore_default'), t('workflows.move_your_edited_file_to_the_2', { file }), t('workflows.restore')))) return;
    try { await api.restorePipeline(file); } catch (e) { showToast(t('workflows.restore_failed'), errMsg(e)); }
    refreshWorkflows();
  }));
  // hovering a workflow lights up its pipelines, hovering a pipeline (or a "Used in" link) its workflows
  const light = (on, files, pipes) => {
    box.querySelectorAll('.wf-card').forEach((c) => c.classList.toggle('linked', on && files.includes(c.dataset.file)));
    box.querySelectorAll('.wf-pipe').forEach((p) => p.classList.toggle('linked', on && pipes.includes(p.dataset.pipe)));
  };
  const pipesOf = (file) => wfDefs.pipelines.filter((p) => p.stages.some((s) => s.workflow === file)).map((p) => p.file);
  box.querySelectorAll('.wf-card').forEach((c) => {
    c.onmouseenter = () => light(true, [], pipesOf(c.dataset.file));
    c.onmouseleave = () => light(false, [], []);
  });
  box.querySelectorAll('.wf-pipe').forEach((p) => {
    p.onmouseenter = () => light(true, p.dataset.files.split('|'), []);
    p.onmouseleave = () => light(false, [], []);
  });
}

// The whole step list of a workflow card, when its flow is expanded.
function stepList(w) {
  const wfReadable = (id, def) => def?.display || (typeof displayName === 'function' ? displayName(id) : String(id || ''));
  return (w.steps || []).map((s, i) => {
    const human = s.type === 'human_approval';
    const names = s.agents || [s.agent];
    const who = names.map((n) => `<span title="${esc(n)}">${esc(wfReadable(n, w.agents?.[n]))}</span>${w.agents?.[n] ? ` · <span class="mono">${esc(w.agents[n].model)}</span>` : ''}`).join(s.agents ? '<br>' : '');
    const skillNames = [...new Set([...(s.skills || []), ...names.flatMap((n) => w.agents?.[n]?.skills || [])])];
    const others = s.next.filter((n) => n !== w.steps[i + 1]?.id);
    return `<li class="wf-step ${human ? 'human' : ''}">
      <span class="wf-step-n">${i + 1}</span>
      <div class="wf-step-body">
        <div class="wf-step-head" title="${esc(s.id)}"><b>${esc(wfReadable(s.id, s))}</b>
          ${s.agents ? `<span class="badge">${t('workflows.parallel')}</span>` : ''}${s.goal ? `<span class="badge">${t('workflows.goal')}</span>` : ''}${s.loop ? `<span class="badge">${t('workflows.loop')}</span>` : ''}
          ${skillNames.map((k) => `<span class="badge" title="${t('workflows.skill')}">⚡ ${esc(k.replace(/\{\{\s*inputs\.(\w+)\s*\}\}/g, '‹$1›'))}</span>`).join('')}</div>
        <div class="muted small">${human ? t('workflows.human_approval') : s.type === 'screenshots' ? t('workflows.screenshots_no_agent') : s.type === 'suite' ? t('workflows.test_suite_no_agent') : s.type === 'test_ids' ? t('workflows.test_id_check_no_agent') : s.type === 'check' ? t('workflows.rule_checks_no_agent') : s.type === 'release_version' ? t('workflows.release_version_no_agent') : s.type === 'project_map' ? t('workflows.project_map_no_agent') :s.type === 'workflow' ? `${t('workflows.runs_workflow', { workflow: esc(s.workflow || t('workflows.a_workflow')) })}${s.foreach ? t(s.max_parallel ? 'workflows.for_each_item_at_a_time' : 'workflows.for_each_item', { n: esc(String(s.max_parallel)) }) : ''}` : who}</div>
        ${others.length ? `<div class="wf-step-next small">↳ ${others.map((n) => `<span title="${esc(n)}">${esc(wfReadable(n, w.steps.find((x) => x.id === n)))}</span>`).join(', ')}</div>` : ''}
      </div>
    </li>`;
  }).join('');
}

// Where a workflow file comes from (see src/seed.js): the bundled default, edited by the user or user-created.
function originBadge(w) {
  const badges = {
    default: `<span class="badge" title="${t('workflows.default_bundled_with_the_app_updated')}">${t('workflows.default')}</span>`,
    modified: `<span class="badge warn" title="${t('workflows.bundled_default_edited_by_you_app')}">${t('workflows.modified')}</span>`,
    custom: `<span class="badge cat-build" title="${t('workflows.created_by_you')}">${t('workflows.custom')}</span>`,
    // #485: the repository's workflow at the commit it was read from
    repository: `<span class="badge cat-plan mono" data-testid="workflow-origin-badge" title="${esc(t('workflows.repository_tip', { project: (state.projects || []).find((p) => p.id === w.projectId)?.name || w.projectId || '' }))}">${t('workflows.repository_at', { commit: esc(String(w.commit || '').slice(0, 7)) })}</span>`,
  };
  const update = w.updateAvailable
    ? `<span class="badge warn" title="${t('workflows.the_app_ships_a_newer_default')}">${t('workflows.newer_default')}${w.bundledVersion ? ` v${esc(w.bundledVersion)}` : ''}</span>`
    : '';
  return (badges[w.origin] || '') + update;
}

// Opens a run in Workflows › Runs, expanded: the list loads up to it (an older run is past the first
// page) and scrolls there.
function showRunInList(runId) {
  state.workflowsTab = 'runs';
  state.wr.filter = 'all';
  state.wr.showSim = true;
  state.wr.q = '';
  state.wr.workflow = '';
  state.wr.upTo = runId;
  state.wr.expanded.add(runId);
  showView('workflows');
}

// Opens a workflow in Workflows › Definitions, scrolled to and focused (the Agents menu's
// "Open in workflow").
function showWorkflowDefinition(file) {
  state.workflowsTab = 'definitions';
  // the card may be filtered out
  wfDefs.section = 'all';
  wfDefs.query = '';
  const search = document.querySelector('#wf-search');
  if (search) search.value = '';
  showView('workflows');
  setTimeout(() => {
    const card = document.querySelector(`.wf-card[data-file="${CSS.escape(file)}"]`);
    card?.scrollIntoView({ block: 'center' });
    card?.focus?.();
  }, 600);
}

registerView({
  id: 'workflows',
  // #254: one menu entry per tab, under the menu's Workflows group
  nav: [
    { label: 'Definitions', order: 60, group: 'workflows', tab: 'definitions', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>' },
    { label: 'Runs', order: 61, group: 'workflows', tab: 'runs', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m10 8.5 5.5 3.5-5.5 3.5z" /></svg>' },
    { label: 'Builder', order: 62, group: 'workflows', tab: 'builder', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="12" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.5 6H12a3 3 0 0 1 3 3v.5M8.5 18H12a3 3 0 0 0 3-3v-.5" /></svg>' },
    { label: 'Pipelines', order: 63, group: 'workflows', tab: 'pipelines', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="5" height="6" rx="1.5" /><rect x="16" y="9" width="5" height="6" rx="1.5" /><path d="M8 12h8" /><path d="m13 9.5 2.5 2.5-2.5 2.5" /></svg>' },
  ],
  markup: () => `
      <section id="view-workflows" class="view hidden">
        <div class="page-head">
          <div>
            <h1>${t('workflows.workflows')} <span class="muted">›</span> <span id="workflows-page-title">${t('workflows.runs')}</span></h1>
            <p class="muted small"><span id="workflows-page-hint"></span> ${t('workflows.folder')} <span id="workflows-dir" class="mono"></span> ${t('workflows.defaults_bundled_with_the_app_are')}</p>
          </div>
          <div class="row keep-awake-head">
            <div id="workflows-keep-awake" class="keep-awake">
              <div class="keep-awake-top">
                <b>${t('workflows.keep_awake')}</b>
                <span class="badge keep-awake-status" data-keep-awake-status></span>
                <label class="switch" title="${t('workflows.keep_awake')}"><input type="checkbox" data-keep-awake-toggle aria-label="${t('workflows.keep_awake')}" /><span></span></label>
              </div>
              <span class="muted small">${t('workflows.keeps_this_computer_from_sleeping_while')}</span>
              <span class="error small" data-keep-awake-error></span>
            </div>
            <button id="btn-workflows-folder" class="btn ghost">${t('workflows.open_folder')}</button>
          </div>
        </div>
        <div class="tabs page-tabs" role="tablist" aria-label="${t('workflows.workflows')}">
          <button type="button" class="tab" role="tab" data-wtab="definitions">${t('workflows.definitions')}</button>
          <button type="button" class="tab" role="tab" data-wtab="runs">${t('workflows.runs')}</button>
          <button type="button" class="tab" role="tab" data-wtab="builder">${t('workflows.builder')}</button>
          <button type="button" class="tab" role="tab" data-wtab="pipelines">${t('workflows.pipelines')}</button>
        </div>
        <div data-wpage="runs">
          <div class="pr-toolbar">
            <!-- #254: the runs' artifacts (views/artifacts/) are a tab of Runs -->
            <div class="seg sm" role="tablist" aria-label="${t('workflows.runs')}">
              <button type="button" class="active" role="tab" aria-selected="true">${t('workflows.all_runs')}</button>
              <button type="button" role="tab" id="wf-tab-artifacts" aria-selected="false" title="${t('workflows.the_files_the_runs_produced_a')}">${t('workflows.artifacts')}</button>
            </div>
            <div id="workflow-run-filters" class="chips"></div>
            <!-- #310: the runs of one workflow (run-list.js fills it) -->
            <select id="workflow-run-workflow" data-testid="runs-workflow-filter" aria-label="${t('workflows.workflow')}" title="${t('workflows.show_the_runs_of_one_workflow')}"></select>
            <span class="spacer"></span>
            <input type="text" id="workflow-run-search" class="pr-search" placeholder="${t('workflows.search_runs')}" aria-label="${t('workflows.search_runs')}" spellcheck="false" />
            <label class="check small"><input type="checkbox" id="workflow-show-sim" /><span>${t('workflows.show_simulated')}</span></label>
            <button id="btn-workflow-runs-refresh" class="btn sm ghost">${t('workflows.refresh')}</button>
          </div>
          <p id="workflow-runs-error" class="error small"></p>
          <div id="workflow-runs" class="pr-list"></div>
        </div>
        <div data-wpage="definitions" class="hidden">
          <div class="pr-toolbar wf-toolbar">
            <div id="wf-sections" class="chips" role="group" aria-label="${t('workflows.section')}"></div>
            <span class="spacer"></span>
            <input type="text" id="wf-search" class="wf-search" placeholder="${t('workflows.search_workflows_and_pipelines')}" aria-label="${t('workflows.search_workflows_and_pipelines')}" spellcheck="false" />
          </div>
          <!-- #474: workflows, skills and seeds are code -->
          <p class="small warn-text" role="note" data-testid="workflows-code-notice">${t('workflows.code_notice')}</p>
          <div id="workflows-list" class="wf-list"></div>
        </div>
        <div data-wpage="builder" class="hidden">
          <div id="wb" class="wb">
            <div class="wb-bar">
              <input type="text" id="wb-name" class="wb-name" placeholder="${t('workflows.workflow_name')}" aria-label="${t('workflows.workflow_name')}" spellcheck="false" />
              <select id="wb-category" aria-label="${t('workflows.category')}"></select>
              <span class="spacer"></span>
              <select id="wb-open" aria-label="${t('workflows.open_a_workflow_in_the_builder')}"></select>
              <button id="wb-new" class="btn ghost sm" type="button">${t('workflows.new')}</button>
              <button id="wb-clone" class="btn ghost sm hidden" type="button" title="${t('workflows.make_your_own_copy_of_this')}">${t('workflows.clone')}</button>
              <button id="wb-save" class="btn sm" type="button">${t('common.save')}</button>
              <button id="wb-run" class="btn primary sm" type="button" title="${t('workflows.save_and_open_the_start_panel')}">${t('workflows.run')}</button>
            </div>
            <textarea id="wb-description" class="wb-description" rows="2" placeholder="${t('workflows.what_it_does_shown_when_you')}" aria-label="${t('workflows.description')}"></textarea>
            <p id="wb-banner" class="wb-banner small hidden"></p>
            <div class="wb-meta muted small"><span class="mono" id="wb-file"></span><span id="wb-dirty" class="badge warn hidden">${t('workflows.unsaved')}</span>
              <span class="spacer"></span>
              <button id="wb-add-desk" class="btn ghost sm" type="button" title="${t('workflows.add_an_agent_desk_after_the')}">${t('workflows.desk')}</button>
              <button id="wb-add-gate" class="btn ghost sm" type="button" title="${t('workflows.add_an_approval_gate_after_the')}">${t('workflows.approval_gate')}</button>
            </div>
            <div class="wb-main">
              <div id="wb-canvas" class="wb-canvas" aria-label="${t('workflows.steps_in_order')}"></div>
              <aside id="wb-panel" class="wb-panel"></aside>
            </div>
            <p id="wb-error" class="error small wb-error"></p>
          </div>
        </div>
        <!-- #409: the Supervisor, on every tab (views/supervisor/ draws its robot and unseen dot) -->
        <button id="btn-wf-sup-fab" class="po-fab sup-fab" type="button" data-testid="supervisor-fab" title="${t('workflows.ask_the_supervisor_about_workflows_and')}" aria-label="${t('workflows.supervisor')}"></button>
      </section>`,
  modals: () => `
  <!-- Workflows > ${t('workflows.builder_the_skills_of_a_desk')}
  <div id="wb-skills-modal" class="modal hidden">
    <div class="modal-card wide" role="dialog" aria-labelledby="wb-skills-title">
      <h3 id="wb-skills-title">${t('workflows.skills_of_this_agent')} <span id="wb-skill-count" class="muted small"></span></h3>
      <input type="text" id="wb-skill-search" placeholder="${t('workflows.filter_skills')}" aria-label="${t('workflows.filter_skills')}" />
      <div id="wb-skill-list" class="ag-skills wb-skill-list"></div>
      <div class="modal-actions">
        <button type="button" id="btn-wb-skills-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="button" id="btn-wb-skills-ok" class="btn primary">${t('workflows.apply')}</button>
      </div>
    </div>
  </div>
  <!-- Workflows > ${t('workflows.builder_import_an_agent_agents_menu')}
  <div id="wb-agents-modal" class="modal hidden">
    <div class="modal-card wb-agents-card" role="dialog" aria-labelledby="wb-agents-title">
      <h3 id="wb-agents-title">${t('workflows.import_an_agent')}</h3>
      <p class="muted small">${t('workflows.its_look_prompt_and_skills_go')}</p>
      <div id="wb-agents-list" class="card-grid agents-grid wb-agents-list"></div>
      <div class="modal-actions">
        <button type="button" id="btn-wb-agents-manage" class="btn ghost">${t('workflows.manage_agents')}</button>
        <span class="spacer"></span>
        <button type="button" id="btn-wb-agents-cancel" class="btn ghost">${t('common.cancel')}</button>
      </div>
    </div>
  </div>
  <!-- #474: Workflows > Builder, the first save of a workflow not bundled with the app -->
  <div id="wb-trust-modal" class="modal hidden">
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="wb-trust-title" data-testid="code-trust-warning">
      <h3 id="wb-trust-title">${t('workflows.code_warning_title')}</h3>
      <p id="wb-trust-text" class="small"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-wb-trust-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="button" id="btn-wb-trust-ok" class="btn primary">${t('workflows.code_warning_confirm')}</button>
      </div>
    </div>
  </div>`,
  mount() {
    $('#btn-workflows-folder').onclick = () => api.openPath(state.ws.workflows);
    // #264, #409: the Supervisor's chat, a drawer over this screen (views/supervisor/)
    $('[data-testid="supervisor-fab"]').onclick = () => window.openSupervisorChat();
    window.renderSupervisorFab?.();
    document.querySelectorAll('[data-wtab]').forEach((b) => (b.onclick = () => showWorkflowsTab(b.dataset.wtab)));
    $('#wf-tab-artifacts').onclick = () => showView('artifacts');
    $('#btn-workflow-runs-refresh').onclick = () => loadWorkflowRuns();
    $('#workflow-show-sim').onchange = (e) => { state.wr.showSim = e.target.checked; loadWorkflowRuns(); };
    // #310: kept in state.wr for the session, never saved
    $('#workflow-run-workflow').onchange = (e) => { state.wr.workflow = e.target.value; renderWorkflowRuns(); loadWorkflowRuns(); };
    let wrSearchTimer = null;
    $('#workflow-run-search').oninput = (e) => {
      clearTimeout(wrSearchTimer);
      wrSearchTimer = setTimeout(() => { state.wr.q = e.target.value.trim(); loadWorkflowRuns(); }, 250);
    };
    $('#wf-search').oninput = (e) => { wfDefs.query = e.target.value; renderWorkflowDefinitions(); };
  },
  show: () => showWorkflowsTab(state.workflowsTab),
});
