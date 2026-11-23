/* global api */
// The Start drawer (right side): a category, a workflow and a project, the workflow's inputs
// (remembered per workflow, the project's folder filling the path inputs) and Start / Start
// another (startRun). openDrawer opens it, prefilled or not: the top bar, Projects, Project,
// Backlog and Workflows; with a project and no workflow it opens on the project's default (#27). initStartDrawer() wires it from app.js's init(). Uses app.js globals ($,
// esc, state, api, errMsg, CATEGORIES, liveRuns, renderHeader, selectRun, wantsSimulation…). The
// inputs other than the main one are drawn by WorkflowInputs (workflow-inputs.js, #116): human
// labels, pills / switches, show_if, and the chosen project's detected language and branches.
// "When it finishes" (#134) is the ChainPicker (chain-picker.js) under the inputs: its then goes with the start.
// Saved pipelines (#135) are listed after the workflows (option value `pipe:<file>`): picking one
// asks for its first stage's inputs (its fixed ones set), shows the whole chain with a cost estimate
// instead of the ChainPicker, and Start calls api.runPipeline.
// An analysis workflow (ANALYSIS_WORKFLOWS, analyze-project.yaml, #378/#631) shows its model turn's
// estimate from api.architectureEstimate (#wf-estimate) before the start; #846: its Start is refused
// (#start-error) while the project's onboarding still runs (window.ProjectWizard.analyzing, the build front).

const LS_KEY = 'craftorio.inputs';
const PIPE = 'pipe:';
// Inputs filled with the chosen project's folder.
const isPathInput = (key) => /path|dir/i.test(key);
// The select's value for what is chosen: a workflow file, or `pipe:<file>` for a pipeline.
const drawerChoice = () => (state.pipeline ? `${PIPE}${state.pipeline.file}` : state.wf?.file);

// Right drawer: start workflow
// `inputs` prefills fields of the picked workflow (e.g. the Backlog's New issue sets git_platform).
// `pipeline`: a saved pipeline's file to start (Workflows › Definitions' Run pipeline).
async function openDrawer({ category = null, workflow = null, project = null, inputs = null, pipeline = null } = {}) {
  state.category = category;
  state.pendingProject = project;
  // a workflow asked for by name is listed even when the Setup hid it from Start (#319)
  state.drawerForced = workflow;
  [state.workflows, state.projects, state.settings, state.pipelines] = await Promise.all([
    api.listWorkflows(), api.listProjects(), api.getSettings(),
    (api.listPipelines ? api.listPipelines() : Promise.resolve([])).catch(() => []),
  ]);
  applyDeveloperMode();
  $('#start-error').textContent = '';
  renderDrawerCategories();
  // #27: with a project (given or the header's) and no workflow, the project's default before lastWorkflow
  const rec = state.projects.find((p) => p.id === (project || window.CurrentProject.get()));
  const projectDefault = rec && window.DefaultWorkflow?.projectDefault?.(rec, rec.manifest?.default);
  // only when Start offers it: a default the Setup hid (#319) falls back to lastWorkflow, not the first listed
  const defaultFile = projectDefault && `${projectDefault}.yaml`;
  const offered = state.workflows.some((w) => w.file === defaultFile && !hiddenFromStart(w));
  renderWorkflowOptions(pipeline ? `${PIPE}${pipeline}` : workflow || (offered ? defaultFile : state.settings.lastWorkflow));
  if (inputs && (!workflow || state.wf?.file === workflow)) {
    for (const [k, v] of Object.entries(inputs)) WorkflowInputs.set($('#drawer'), k, v);
  }
  // (#254: with no project given, the app's, chosen in the header)
  renderProjectOptions(project || window.CurrentProject.get() || state.settings.lastProject);
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer-backdrop').classList.remove('hidden');
  setTimeout(() => (mainField() || $('#wf-select')).focus({ preventScroll: true }), 200);
}

// The drawer's main free-text field (usually `task`), picked by selectWorkflow()
const mainField = () => (state.mainKey ? document.getElementById(`in-${state.mainKey}`) : null);

// Both start buttons follow the same rules (no workflow, a workflow error, a start in progress, one run at a time).
// A pending start (state.starting) keeps them disabled whatever the caller computed, e.g. renderHeader() on a run update.
function setStartDisabled(disabled) {
  const off = disabled || !!state.starting;
  $('#btn-start').disabled = off;
  $('#btn-start-another').disabled = off;
}

function closeDrawer() {
  $('#start-info').textContent = '';
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawer-backdrop').classList.add('hidden');
}

function renderDrawerCategories() {
  const chips = [[null, t('start_drawer.all')], ...Object.entries(CATEGORIES)];
  $('#drawer-categories').innerHTML = chips.map(([id, label]) =>
    `<button type="button" class="chip ${state.category === id ? 'active' : ''}" data-cat="${id ?? ''}">${esc(label)}</button>`).join('');
  $('#drawer-categories').querySelectorAll('.chip').forEach((c) => (c.onclick = () => {
    state.category = c.dataset.cat || null;
    renderDrawerCategories();
    renderWorkflowOptions(drawerChoice());
  }));
}

// The pipelines that can start here: loaded without error, their first workflow in the list.
const startablePipelines = () => (state.pipelines || []).filter((p) => !p.error && state.workflows.some((w) => w.file === p.stages[0]?.workflow && !w.error));

// #319: the workflows the first-run Setup left unpicked (settings.hiddenWorkflows) are not offered
const hiddenFromStart = (w) => typeof SetupModel !== 'undefined' && (state.settings?.hiddenWorkflows || []).includes(SetupModel.workflowId(w.file)) && w.file !== state.drawerForced;

function renderWorkflowOptions(preferred) {
  const list = state.workflows.filter((w) => (!state.category || w.category === state.category) && !hiddenFromStart(w));
  const pipes = startablePipelines().filter((p) => !state.category || p.category === state.category);
  const sel = $('#wf-select');
  sel.disabled = !list.length && !pipes.length;
  const options = list.map((w) => `<option value="${esc(w.file)}">${esc(w.name)}${w.version ? ' v' + esc(w.version) : ''}${w.error ? t('start_drawer.error_suffix') : ''}</option>`).join('');
  sel.innerHTML = pipes.length
    ? `<optgroup label="${t('start_drawer.workflows')}">${options}</optgroup><optgroup label="${t('start_drawer.pipelines')}">${pipes.map((p) => `<option value="${esc(PIPE + p.file)}">⛓ ${esc(p.name)}</option>`).join('')}</optgroup>`
    : options;
  if (!list.length && !pipes.length) {
    state.wf = null;
    state.pipeline = null;
    $('#drawer-pipeline').classList.add('hidden');
    const hidden = state.workflows.some((w) => (!state.category || w.category === state.category) && hiddenFromStart(w));
    $('#wf-desc').textContent = hidden
      ? (state.category ? t('start_drawer.every_category_workflow_is_hidden', { category: CATEGORIES[state.category] }) : t('start_drawer.every_workflow_is_hidden'))
      : state.category
      ? t('start_drawer.no_value_workflows_yet_add_a', { value: CATEGORIES[state.category], category: state.category })
      : t('start_drawer.no_yaml_files_found_in_workflows');
    $('#wf-steps-mini').innerHTML = '';
    $('#inputs-form').innerHTML = '';
    $('#adv-form').innerHTML = '';
    $('#wf-agents').innerHTML = '';
    $('#env-status').innerHTML = '';
    state.mainKey = null;
    setStartDisabled(true);
    return;
  }
  const values = [...list.map((w) => w.file), ...pipes.map((p) => PIPE + p.file)];
  // #630: a remembered old workflow name picks its new workflow
  const aliased = window.DefaultWorkflow?.aliasOf?.(preferred)?.file;
  const pick = values.includes(preferred) ? preferred : values.includes(aliased) ? aliased : values[0];
  sel.value = pick;
  selectWorkflow(pick);
}

function renderProjectOptions(preferred) {
  const sel = $('#project-select');
  sel.innerHTML = state.projects.length
    ? `<option value="">${t('start_drawer.select_a_project')}</option>${state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.exists ? '' : t('start_drawer.folder_not_found')}</option>`).join('')}`
    : `<option value="">${t('start_drawer.no_projects_click')}</option>`;
  if (state.projects.some((p) => p.id === preferred)) sel.value = preferred;
  renderProjectInfo();
}

function renderProjectInfo() {
  const p = state.projects.find((x) => x.id === $('#project-select').value);
  $('#project-info').textContent = p ? `${p.folder}${p.repo ? `\n${p.repo}` : ''}` : '';
  applyProjectHints();
  window.renderAnalysisEstimate?.();
}

// #378: a workflow whose analysis is a real model call (#631: Analyze project, the old Refactor
// proposals) shows, under its description, the Architecture tab's estimate for the chosen project
// (api.architectureEstimate: the mean cost of its last real analyses, the workflow's runs included)
const ANALYSIS_WORKFLOWS = ['analyze-project.yaml'];
function renderAnalysisEstimate() {
  const el = $('#wf-estimate');
  if (!el) return;
  const wf = state.wf;
  const projectId = $('#project-select').value;
  const on = !state.pipeline && ANALYSIS_WORKFLOWS.includes(wf?.file) && !!api.architectureEstimate;
  el.classList.toggle('hidden', !on);
  if (!on) { el.textContent = ''; return; }
  if (!projectId) { el.textContent = t('start_drawer.the_analysis_is_a_real_model'); return; }
  el.textContent = t('start_drawer.estimating_the_analysis');
  api.architectureEstimate(projectId).then(({ estimate }) => {
    if (state.wf !== wf || $('#project-select').value !== projectId) return;
    el.textContent = estimate
      ? t('start_drawer.analysis_estimate', { cost: Number(estimate.usd).toFixed(2), count: estimate.basis })
      : t('start_drawer.the_analysis_is_a_real_model_3');
  }).catch(() => { el.textContent = ''; el.classList.add('hidden'); });
}

// `file`: a workflow file, or `pipe:<file>` for a pipeline (its first stage's workflow is drawn).
function selectWorkflow(file) {
  const pipeline = String(file || '').startsWith(PIPE) ? (state.pipelines || []).find((p) => PIPE + p.file === file) || null : null;
  state.pipeline = pipeline;
  const wf = state.workflows.find((w) => w.file === (pipeline ? pipeline.stages[0].workflow : file));
  state.wf = wf;
  // #28: a bundled workflow's description, stations and inputs drawn in the interface language (state.wf keeps the file's)
  const shown = WorkflowInputs.localized(wf);
  $('#drawer .drawer-title').textContent = pipeline ? t('start_drawer.start_pipeline') : t('start_drawer.start_workflow');
  $('#wf-desc').textContent = pipeline ? pipeline.description || '' : wf.error ? t('start_drawer.error_error', { error: wf.error }) : [shown.description || '', ...(wf.warnings || []).map((m) => `Warning: ${m}.`)].filter(Boolean).join(' ');
  $('#wf-steps-mini').innerHTML = (shown.steps || []).map((s) =>
    `<span class="step-chip ${s.type === 'human_approval' ? 'human' : ''}" title="${esc(`${s.id}${s.type === 'human_approval' ? ' (human approval)' : s.agent ? ` · ${s.agent}` : ''}`)}">${esc(s.display || (typeof displayName === 'function' ? displayName(s.id) : s.id))}</span>`).join('<span class="arrow">›</span>');
  // #262: each agent's provider, model and effort for this run (the workflow's as defaults, never
  // remembered), with what it may use (capabilities) and how its conversation is kept (session);
  // a pipeline's stages keep their workflows' agents
  $('#wf-agents').innerHTML = pipeline ? '' : window.AgentOverrides?.html(wf, { prefix: 'start-ao' }) || '';

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(`${LS_KEY}.${wf.file}`) || '{}'); } catch { /* ignore */ }

  const entries = Object.entries(shown.inputs || {}).filter(([key]) => !isPathInput(key));
  // the main field is a free-text one: never a run id or a fixed list
  const textual = entries.filter(([, d]) => d.type !== 'run' && !d.enum);
  const mainKey = textual.find(([k]) => k === 'task')?.[0] || textual.find(([, d]) => d.required)?.[0] || textual[0]?.[0];
  state.mainKey = mainKey || null;
  // a run id is not remembered: the default ("latest") is usually what is wanted next time;
  // nor is the main field: each run starts from an empty task (entries saved before included)
  const values = {};
  for (const [key, def] of entries) values[key] = (def.type === 'run' || key === mainKey ? null : saved[key]) ?? def.default ?? '';
  // the other inputs: human labels and the control that fits each (workflow-inputs.js, #116)
  const field = ([key, def]) => WorkflowInputs.fieldHtml(key, def, { value: values[key], id: `in-${key}`, attrs: `name="${esc(key)}"`, context: values });
  const mainHtml = ([key, def]) => `<div class="field"><label for="in-${key}">${t('start_drawer.input')} ${def.required ? '<span class="req">*</span>' : ''}</label>`
    + `<textarea id="in-${key}" name="${key}" data-testid="start-main-input" data-wi-input="${esc(key)}" rows="7" placeholder="${t('start_drawer.describe_what_needs_to_be_done')}">${esc(values[key])}</textarea>`
    + `${def.description ? `<div class="hint">${esc(def.description)}</div>` : ''}</div>`;
  // a workflow's `mode` (e.g. auto | validated) and its tests (#203: unit_tests, e2e_tests, about
  // half of a run's cost) and its screenshots (#205) change how the run goes: shown next to the task, not in Advanced;
  // #759: `validation` (auto | validated, the old `mode` renamed by #630) stays next to the task too
  const upfront = (k) => [
    'e2e_tests',
    'mode',
    'screenshots',
    'unit_tests',
    'validation',
  ].includes(k) && k !== mainKey;
  $('#inputs-form').innerHTML = entries.filter(([k]) => k === mainKey || upfront(k)).map((e) => (e[0] === mainKey ? mainHtml(e) : field(e))).join('');
  $('#adv-form').innerHTML = entries.filter(([k]) => k !== mainKey && !upfront(k)).map(field).join('');
  applyProjectHints();

  // a folder input with `required: false` (e.g. writer-reviewer's project_path) makes the project optional
  const needsProject = Object.entries(wf.inputs || {}).some(([k, def]) => isPathInput(k) && def.required !== false);
  $('#project-req').classList.toggle('hidden', !needsProject);
  setStartDisabled(!!wf.error || oneRunAtATime());
  drawerChain().refresh();
  renderDrawerPipeline();
  window.renderAnalysisEstimate?.();
  window.renderEnvStatus?.(); // through window: the drawer's unit tests load selectWorkflow on its own
}

// #319: each CLI's state ('ready' | 'signed-out' | 'missing'), from env:details (Settings and the
// Setup refresh it too), and the tools themselves for their install and sign-in commands.
function setCliStates(tools) {
  state.cliTools = tools || [];
  state.cliStates = Object.fromEntries(state.cliTools.map((t) => [t.id, SetupModel.statusBadge(t).state]));
  if (state.wf) renderEnvStatus();
}

async function loadCliStatus() {
  try { setCliStates(await api.envDetails()); } catch { /* the drawer shows no CLI line */ }
  return state.cliTools || [];
}

// The Start drawer's line under the inputs: the chosen workflow's requirement badges ("Needs Codex")
// and only what this computer lacks for it, with its install or sign-in command.
function renderEnvStatus() {
  const box = $('#env-status');
  const reqs = state.wf?.requirements;
  if (!reqs || typeof SetupModel === 'undefined') { box.innerHTML = ''; return; }
  const badges = SetupModel.requirementBadges(reqs).map((b) => `<span class="badge">${esc(b)}</span>`).join('');
  const missing = state.cliStates ? SetupModel.missingRequirements(reqs, state.cliStates) : [];
  const tool = (id) => (state.cliTools || []).find((t) => t.id === id);
  const action = (t) => {
    if (!t || !canRunCommands()) return '';
    if (!t.path) return t.installCommand ? commandHint(t.installCommand) : '';
    return t.signInCommand ? commandHint(t.signInCommand, { signIn: true }) : '';
  };
  const lines = missing.map((id) => {
    if (id === 'forge') return `<span class="missing">${I18n.t('start_drawer.needs_the_github_cli_or_the')}</span>`;
    const t = tool(id);
    const why = state.cliStates[id] === 'signed-out' ? 'not signed in' : 'not installed';
    return `<span class="missing">✗ ${esc(SetupModel.toolName(id))}: ${why}</span>${action(t)}`;
  });
  if (lines.length) lines.push(`<span class="muted">${devMode() ? t('start_drawer.simulation_runs_it_without_them') : t('start_drawer.a_real_run_of_this_workflow')}</span>`);
  box.innerHTML = [badges, ...lines].filter(Boolean).join('');
}

// The drawer's "When it finishes" (#134), mounted once; it follows the chosen workflow.
let chainPicker = null;
const drawerChain = () => (chainPicker ??= ChainPicker.mount($('#drawer-chain'), { workflows: () => state.workflows, source: () => state.wf }));

// A pipeline (#135) instead of "When it finishes": its fixed first-stage inputs set, its stages
// with what each one maps, and a rough cost from past runs (an estimate, api.pipelineEstimate).
function renderDrawerPipeline() {
  const p = state.pipeline;
  const box = $('#drawer-pipeline');
  if (!oneRunAtATime()) $('#btn-start').textContent = p ? t('start_drawer.start_pipeline') : t('start_drawer.start_workflow');
  $('#drawer-chain').classList.toggle('hidden', !!p);
  box.classList.toggle('hidden', !p);
  if (!p) { box.innerHTML = ''; return; }
  for (const [k, v] of Object.entries(p.stages[0].inputs || {})) WorkflowInputs.set($('#drawer'), k, v);
  const names = Object.fromEntries(state.workflows.map((w) => [w.file, w.name]));
  box.innerHTML = `<div class="drawer-pipeline-head"><span class="chain-banner-title">${t('start_drawer.pipeline')}</span><span class="badge">${t('start_drawer.stages_count', { count: p.stages.length })}</span></div>
    ${ChainModel.pipelineStagesHtml(p, { names, current: 0 })}
    <p class="muted small">${t('start_drawer.you_give_the_first_stage_s')}</p>
    <p class="muted small" data-pipe-estimate>${t('start_drawer.estimating_the_cost')}</p>`;
  if (!api.pipelineEstimate) { box.querySelector('[data-pipe-estimate]').remove(); return; }
  api.pipelineEstimate(p.file).then((est) => {
    const el = box.querySelector('[data-pipe-estimate]');
    if (!el || state.pipeline !== p) return;
    el.textContent = `${est.text || t('start_drawer.no_past_runs_to_estimate_from')}${est.productOwner ? t('start_drawer.the_product_owner_places_the_issues') : ''}`;
  }).catch(() => box.querySelector('[data-pipe-estimate]')?.remove());
}

// Without concurrent runs (Settings › Execution) a second run can't start; with them, the engine
// says when the limit is reached.
const oneRunAtATime = () => !state.settings.concurrentRuns?.enabled && liveRuns().length > 0;

// The inputs as the workflow takes them: enum values, switches as true/false (workflow-inputs.js).
function readInputs() {
  return { ...WorkflowInputs.read($('#inputs-form'), { all: true }), ...WorkflowInputs.read($('#adv-form'), { all: true }) };
}

// The images pasted into the inputs' text fields (#130, paste-image.js), as run:start takes them:
// { <input>: [{ path, name }] }, or null when nothing was pasted (the request stays as before).
const pasteFields = () => [...$('#drawer').querySelectorAll('textarea[id^="in-"]')];
async function pastedImages() {
  const out = {};
  for (const ta of pasteFields()) {
    await PasteImage.settle(ta);
    const list = PasteImage.attachments(ta);
    if (list.length) out[ta.id.slice('in-'.length)] = list;
  }
  return Object.keys(out).length ? out : null;
}

// What the app knows about the chosen project (its detected language, its local branches) fills
// the inputs the owner has not changed; the drawer's remembered values are per workflow, not per
// project, so the project's own language wins over them.
function applyProjectHints() {
  const projectId = $('#project-select').value;
  if (state.wf && projectId) WorkflowInputs.applyHints($('#drawer'), state.wf.inputs, projectId);
}

// #805: what run:start's baseCheck says, in the interface's language
function baseNoticeText({ base, behind, state: where }) {
  return t(where === 'diverged' ? 'start_drawer.base_diverged' : 'start_drawer.base_behind', { count: behind, base });
}

// #805: for the screens that do not ask (Docs, Write & Review, AI Arena): the run went on from such a base
function baseStartedToast(check) {
  showToast(t('start_drawer.base_started'), baseNoticeText(check));
}

// #805: nothing started: a local run's base is behind origin or diverged, and the person chooses here. Each choice
// starts again with the same form; a diverged base has no update (never moved: the Backlog's Update and push).
function showBaseNotice(check, keepOpen) {
  const { canUpdate } = check;
  const text = baseNoticeText(check);
  const info = $('#start-info');
  info.innerHTML = `<div role="status" data-testid="start-base-notice"><p class="warn-text">${esc(text)}</p><div class="row">${canUpdate ? `<button type="button" class="btn sm primary" data-testid="start-base-update">${esc(t('start_drawer.base_update'))}</button>` : ''}<button type="button" class="btn sm ghost" data-testid="start-base-continue">${esc(t('start_drawer.base_continue'))}</button></div></div>`;
  const choice = (id, baseChoice) => {
    const button = info.querySelector(`[data-testid="${id}"]`);
    if (button) button.onclick = () => startRun({ keepOpen, baseChoice });
  };
  choice('start-base-update', 'update');
  choice('start-base-continue', 'continue');
}

// What Start sends: the chosen pipeline, or the run with the panel's images, agents and base choice
async function sendStart({ wf, inputs, mock, project, baseChoice }) {
  const attachments = await pastedImages();
  // #262: this run's provider / model / effort per agent (only what differs from the workflow)
  const agentOverrides = window.AgentOverrides?.read($('#wf-agents')) || {};
  if (state.pipeline) return api.runPipeline(state.pipeline.file, inputs, mock, project?.id || null, ...(baseChoice ? [baseChoice] : []));
  return api.startRun({ file: wf.file, workspace: true, inputs, mock, then: drawerChain().value(), ...(attachments ? { attachments } : {}), ...(Object.keys(agentOverrides).length ? { agentOverrides } : {}), ...(baseChoice ? { baseChoice } : {}) });
}

// `keepOpen` (Start and create another): the drawer stays open on the same workflow, project and
// parameters, with the main field cleared, and the shown run does not change.
// #805 `baseChoice`: the answer to the notice below, for a local run whose base is behind origin.
async function startRun({ keepOpen = false, baseChoice = null } = {}) {
  $('#start-error').textContent = '';
  $('#start-info').textContent = '';
  const wf = state.wf;
  if (!wf) return;
  const project = state.projects.find((p) => p.id === $('#project-select').value);
  const pathKeys = Object.keys(wf.inputs || {}).filter(isPathInput);
  if (pathKeys.some((k) => wf.inputs[k].required !== false) && !project) return ($('#start-error').textContent = t('start_drawer.select_a_project_its_folder_is'));
  if (project && !project.exists) return ($('#start-error').textContent = t('start_drawer.the_project_folder_does_not_exist', { folder: project.folder }));
  // #846: the project's onboarding still clones or analyses it (the Imports tray): a second paid analysis is refused
  if (project && window.ProjectWizard?.analyzing?.(project.id) && ANALYSIS_WORKFLOWS.includes(wf.file)) return ($('#start-error').textContent = t('start_drawer.analysis_already_running', { project: project.name }));

  const inputs = readInputs();
  // the main field is not remembered: the next run starts from an empty task
  const { [state.mainKey]: _main, ...remembered } = inputs;
  try { localStorage.setItem(`${LS_KEY}.${wf.file}`, JSON.stringify(remembered)); } catch { /* ignore */ }
  if (project) for (const k of pathKeys) inputs[k] = project.folder;

  state.starting = true;
  setStartDisabled(true);
  try {
    const mock = wantsSimulation($('#mock-toggle'));
    const out = await sendStart({ wf, inputs, mock, project, baseChoice });
    if (out?.confirm && out.baseCheck) return showBaseNotice(out.baseCheck, keepOpen);
    const { runId } = out;
    state.settings = await api.setSettings({ lastWorkflow: wf.file, lastProject: project?.id || null });
    const view = state.runs.get(runId);
    if (view?.run && project) view.run.project = project.name;
    const main = mainField();
    if (main) main.value = state.wf?.inputs?.[state.mainKey]?.default ?? '';
    pasteFields().forEach(PasteImage.clear);
    if (!keepOpen) {
      closeDrawer();
      // the run started here is the one shown
      if (view) selectRun(runId, { open: state.settings.openRunOnStart });
      return;
    }
    // what started, and a way to open it, while the drawer stays on the next one
    const info = $('#start-info');
    info.innerHTML = `<button type="button" class="link-btn" title="${t('start_drawer.open_this_run')}">${t('start_drawer.started')} ${esc(runLabel(view?.run || { workflow: wf.name, project: project?.name }))}</button>`;
    info.querySelector('button').onclick = () => { closeDrawer(); selectRun(runId, { open: true }); };
    if (oneRunAtATime()) info.insertAdjacentHTML('beforeend', `<br>${t('start_drawer.turn_on_concurrent_runs_in_settings')}`);
    main?.focus({ preventScroll: true });
  } catch (e) {
    $('#start-error').textContent = errMsg(e);
  } finally {
    state.starting = false;
    renderHeader();
  }
}

function initStartDrawer() {
  // show_if reads the inputs of both forms (the mode next to the task, the rest in Advanced)
  $('#drawer').setAttribute('data-wi-scope', '');
  $('#btn-drawer-close').onclick = closeDrawer;
  $('#drawer-backdrop').onclick = closeDrawer;
  $('#wf-select').onchange = () => selectWorkflow($('#wf-select').value);
  $('#project-select').onchange = renderProjectInfo;
  $('#btn-drawer-new-project').onclick = () => window.Actions.call('openProjectWizard'); // #741: the wizard only
  $('#btn-start').onclick = () => startRun();
  $('#btn-start-another').onclick = () => startRun({ keepOpen: true });
}
