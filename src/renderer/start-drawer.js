/* global api */
// The Start drawer (right side): a category, a workflow and a project, the workflow's inputs
// (remembered per workflow, the project's folder filling the path inputs) and Start / Start
// another (startRun). openDrawer opens it, prefilled or not: the top bar, Projects, Project,
// Backlog and Workflows. initStartDrawer() wires it from app.js's init(). Uses app.js globals ($,
// esc, state, api, errMsg, CATEGORIES, liveRuns, renderHeader, selectRun, wantsSimulation…). The
// inputs other than the main one are drawn by WorkflowInputs (workflow-inputs.js, #116): human
// labels, pills / switches, show_if, and the chosen project's detected language and branches.
// "When it finishes" (#134) is the ChainPicker (chain-picker.js) under the inputs: its then goes with the start.
// Saved pipelines (#135) are listed after the workflows (option value `pipe:<file>`): picking one
// asks for its first stage's inputs (its fixed ones set), shows the whole chain with a cost estimate
// instead of the ChainPicker, and Start calls api.runPipeline.

const LS_KEY = 'multiagent.inputs';
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
  [state.workflows, state.projects, state.settings, state.pipelines] = await Promise.all([
    api.listWorkflows(), api.listProjects(), api.getSettings(),
    (api.listPipelines ? api.listPipelines() : Promise.resolve([])).catch(() => []),
  ]);
  applyDeveloperMode();
  $('#start-error').textContent = '';
  renderDrawerCategories();
  renderWorkflowOptions(pipeline ? `${PIPE}${pipeline}` : workflow || state.settings.lastWorkflow);
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
  const chips = [[null, 'All'], ...Object.entries(CATEGORIES)];
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

function renderWorkflowOptions(preferred) {
  const list = state.workflows.filter((w) => !state.category || w.category === state.category);
  const pipes = startablePipelines().filter((p) => !state.category || p.category === state.category);
  const sel = $('#wf-select');
  sel.disabled = !list.length && !pipes.length;
  const options = list.map((w) => `<option value="${esc(w.file)}">${esc(w.name)}${w.version ? ' v' + esc(w.version) : ''}${w.error ? ' (error)' : ''}</option>`).join('');
  sel.innerHTML = pipes.length
    ? `<optgroup label="Workflows">${options}</optgroup><optgroup label="Pipelines">${pipes.map((p) => `<option value="${esc(PIPE + p.file)}">⛓ ${esc(p.name)}</option>`).join('')}</optgroup>`
    : options;
  if (!list.length && !pipes.length) {
    state.wf = null;
    state.pipeline = null;
    $('#drawer-pipeline').classList.add('hidden');
    $('#wf-desc').textContent = state.category
      ? `No ${CATEGORIES[state.category]} workflows yet. Add a .yaml with "category: ${state.category}" to workflows/.`
      : 'No .yaml files found in workflows/.';
    $('#wf-steps-mini').innerHTML = '';
    $('#inputs-form').innerHTML = '';
    $('#adv-form').innerHTML = '';
    $('#wf-agents').innerHTML = '';
    state.mainKey = null;
    setStartDisabled(true);
    return;
  }
  const values = [...list.map((w) => w.file), ...pipes.map((p) => PIPE + p.file)];
  const pick = values.includes(preferred) ? preferred : values[0];
  sel.value = pick;
  selectWorkflow(pick);
}

function renderProjectOptions(preferred) {
  const sel = $('#project-select');
  sel.innerHTML = state.projects.length
    ? `<option value="">— select a project —</option>${state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.exists ? '' : ' (folder not found)'}</option>`).join('')}`
    : '<option value="">No projects — click +</option>';
  if (state.projects.some((p) => p.id === preferred)) sel.value = preferred;
  renderProjectInfo();
}

function renderProjectInfo() {
  const p = state.projects.find((x) => x.id === $('#project-select').value);
  $('#project-info').textContent = p ? `${p.folder}${p.repo ? `\n${p.repo}` : ''}` : '';
  applyProjectHints();
}

// `file`: a workflow file, or `pipe:<file>` for a pipeline (its first stage's workflow is drawn).
function selectWorkflow(file) {
  const pipeline = String(file || '').startsWith(PIPE) ? (state.pipelines || []).find((p) => PIPE + p.file === file) || null : null;
  state.pipeline = pipeline;
  const wf = state.workflows.find((w) => w.file === (pipeline ? pipeline.stages[0].workflow : file));
  state.wf = wf;
  $('#drawer .drawer-title').textContent = pipeline ? 'Start pipeline' : 'Start workflow';
  $('#wf-desc').textContent = pipeline ? pipeline.description || '' : wf.error ? `Error: ${wf.error}` : wf.description || '';
  $('#wf-steps-mini').innerHTML = (wf.steps || []).map((s) =>
    `<span class="step-chip ${s.type === 'human_approval' ? 'human' : ''}" title="${esc(`${s.id}${s.type === 'human_approval' ? ' (human approval)' : s.agent ? ` · ${s.agent}` : ''}`)}">${esc(s.display || (typeof displayName === 'function' ? displayName(s.id) : s.id))}</span>`).join('<span class="arrow">›</span>');
  // what each agent may use (capabilities) and how its conversation is kept (session)
  $('#wf-agents').innerHTML = Object.entries(wf.agents || {}).map(([name, a]) => `<div class="agent-row">
      <div class="agent-row-main"><span>${esc(name)}</span><span class="model">${esc(a.provider)} · ${esc(a.model)}</span></div>
      <div class="agent-caps">${esc([`session: ${a.session || 'persistent'}${a.max_context && (a.session || 'persistent') === 'persistent' ? ` (max ${a.max_context})` : ''}`, a.capabilities, a.isolated === false ? 'not isolated' : ''].filter(Boolean).join(' · '))}</div>
    </div>`).join('');

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(`${LS_KEY}.${wf.file}`) || '{}'); } catch { /* ignore */ }

  const entries = Object.entries(wf.inputs || {}).filter(([key]) => !isPathInput(key));
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
  const mainHtml = ([key, def]) => `<div class="field"><label for="in-${key}">Input ${def.required ? '<span class="req">*</span>' : ''}</label>`
    + `<textarea id="in-${key}" name="${key}" data-testid="start-main-input" data-wi-input="${esc(key)}" rows="7" placeholder="Describe what needs to be done…">${esc(values[key])}</textarea>`
    + `${def.description ? `<div class="hint">${esc(def.description)}</div>` : ''}</div>`;
  // a workflow's `mode` (e.g. auto | validated) and its tests (#203: unit_tests, e2e_tests, about
  // half of a run's cost) and its screenshots (#205) change how the run goes: shown next to the task, not in Advanced
  const upfront = (k) => [
    'e2e_tests',
    'mode',
    'screenshots',
    'unit_tests',
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
}

// The drawer's "When it finishes" (#134), mounted once; it follows the chosen workflow.
let chainPicker = null;
const drawerChain = () => (chainPicker ??= ChainPicker.mount($('#drawer-chain'), { workflows: () => state.workflows, source: () => state.wf }));

// A pipeline (#135) instead of "When it finishes": its fixed first-stage inputs set, its stages
// with what each one maps, and a rough cost from past runs (an estimate, api.pipelineEstimate).
function renderDrawerPipeline() {
  const p = state.pipeline;
  const box = $('#drawer-pipeline');
  if (!oneRunAtATime()) $('#btn-start').textContent = p ? 'Start pipeline' : 'Start workflow';
  $('#drawer-chain').classList.toggle('hidden', !!p);
  box.classList.toggle('hidden', !p);
  if (!p) { box.innerHTML = ''; return; }
  for (const [k, v] of Object.entries(p.stages[0].inputs || {})) WorkflowInputs.set($('#drawer'), k, v);
  const names = Object.fromEntries(state.workflows.map((w) => [w.file, w.name]));
  box.innerHTML = `<div class="drawer-pipeline-head"><span class="chain-banner-title">Pipeline</span><span class="badge">${p.stages.length} stages</span></div>
    ${ChainModel.pipelineStagesHtml(p, { names, current: 0 })}
    <p class="muted small">You give the first stage's inputs; each next stage takes the previous one's outputs. A stage that fails or stops pauses the pipeline, and every gate still waits for you.</p>
    <p class="muted small" data-pipe-estimate>Estimating the cost…</p>`;
  if (!api.pipelineEstimate) { box.querySelector('[data-pipe-estimate]').remove(); return; }
  api.pipelineEstimate(p.file).then((est) => {
    const el = box.querySelector('[data-pipe-estimate]');
    if (!el || state.pipeline !== p) return;
    el.textContent = `${est.text || 'No past runs to estimate from.'}${est.productOwner ? ' The Product Owner places the issues: nothing starts until you press Start on the roadmap.' : ''}`;
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

// `keepOpen` (Start and create another): the drawer stays open on the same workflow, project and
// parameters, with the main field cleared, and the shown run does not change.
async function startRun({ keepOpen = false } = {}) {
  $('#start-error').textContent = '';
  $('#start-info').textContent = '';
  const wf = state.wf;
  if (!wf) return;
  const project = state.projects.find((p) => p.id === $('#project-select').value);
  const pathKeys = Object.keys(wf.inputs || {}).filter(isPathInput);
  if (pathKeys.some((k) => wf.inputs[k].required !== false) && !project) return ($('#start-error').textContent = 'Select a project: its folder is used as the workflow repository.');
  if (project && !project.exists) return ($('#start-error').textContent = `The project folder does not exist: ${project.folder}`);

  const inputs = readInputs();
  // the main field is not remembered: the next run starts from an empty task
  const { [state.mainKey]: _main, ...remembered } = inputs;
  try { localStorage.setItem(`${LS_KEY}.${wf.file}`, JSON.stringify(remembered)); } catch { /* ignore */ }
  if (project) for (const k of pathKeys) inputs[k] = project.folder;

  state.starting = true;
  setStartDisabled(true);
  try {
    const mock = wantsSimulation($('#mock-toggle'));
    const attachments = await pastedImages();
    const { runId } = state.pipeline
      ? await api.runPipeline(state.pipeline.file, inputs, mock, project?.id || null)
      : await api.startRun({ file: wf.file, inputs, mock, then: drawerChain().value(), ...(attachments ? { attachments } : {}) });
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
    info.innerHTML = `<button type="button" class="link-btn" title="Open this run">Started ${esc(runLabel(view?.run || { workflow: wf.name, project: project?.name }))}</button>`;
    info.querySelector('button').onclick = () => { closeDrawer(); selectRun(runId, { open: true }); };
    if (oneRunAtATime()) info.insertAdjacentHTML('beforeend', '<br>Turn on concurrent runs in Settings › Execution to start several runs in a row.');
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
  $('#btn-drawer-new-project').onclick = () => openProjectModal(null, { fromDrawer: true });
  $('#btn-start').onclick = () => startRun();
  $('#btn-start-another').onclick = () => startRun({ keepOpen: true });
}
