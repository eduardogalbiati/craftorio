/* global api */
// The Start drawer (right side): a category, a workflow and a project, the workflow's inputs
// (remembered per workflow, the project's folder filling the path inputs) and Start / Start
// another (startRun). openDrawer opens it, prefilled or not: the top bar, Projects, Project,
// Backlog and Workflows. initStartDrawer() wires it from app.js's init(). Uses app.js globals ($,
// esc, state, api, errMsg, CATEGORIES, liveRuns, renderHeader, selectRun, wantsSimulation…).

const LS_KEY = 'multiagent.inputs';
// Inputs filled with the chosen project's folder.
const isPathInput = (key) => /path|dir/i.test(key);

// Right drawer: start workflow
// `inputs` prefills fields of the picked workflow (e.g. the Backlog's New issue sets git_platform).
async function openDrawer({ category = null, workflow = null, project = null, inputs = null } = {}) {
  state.category = category;
  state.pendingProject = project;
  [state.workflows, state.projects, state.settings] = await Promise.all([api.listWorkflows(), api.listProjects(), api.getSettings()]);
  applyDeveloperMode();
  $('#start-error').textContent = '';
  renderDrawerCategories();
  renderWorkflowOptions(workflow || state.settings.lastWorkflow);
  if (inputs && (!workflow || state.wf?.file === workflow)) {
    for (const [k, v] of Object.entries(inputs)) {
      const el = document.getElementById(`in-${k}`);
      if (el) el.value = v;
    }
  }
  renderProjectOptions(project || state.settings.lastProject);
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer-backdrop').classList.remove('hidden');
  setTimeout(() => (mainField() || $('#wf-select')).focus(), 200);
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
    renderWorkflowOptions(state.wf?.file);
  }));
}

function renderWorkflowOptions(preferred) {
  const list = state.workflows.filter((w) => !state.category || w.category === state.category);
  const sel = $('#wf-select');
  sel.disabled = !list.length;
  sel.innerHTML = list.map((w) => `<option value="${esc(w.file)}">${esc(w.name)}${w.version ? ' v' + esc(w.version) : ''}${w.error ? ' (error)' : ''}</option>`).join('');
  if (!list.length) {
    state.wf = null;
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
  const pick = list.find((w) => w.file === preferred) || list[0];
  sel.value = pick.file;
  selectWorkflow(pick.file);
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
}

function selectWorkflow(file) {
  const wf = state.workflows.find((w) => w.file === file);
  state.wf = wf;
  $('#wf-desc').textContent = wf.error ? `Error: ${wf.error}` : wf.description || '';
  $('#wf-steps-mini').innerHTML = (wf.steps || []).map((s) =>
    `<span class="step-chip ${s.type === 'human_approval' ? 'human' : ''}" title="${esc(s.type === 'human_approval' ? 'human approval' : s.agent)}">${esc(s.id)}</span>`).join('<span class="arrow">›</span>');
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
  const field = ([key, def], main) => {
    // a run id is not remembered: the default ("latest") is usually what is wanted next time;
    // nor is the main field: each run starts from an empty task (entries saved before included)
    const val = (def.type === 'run' || main ? null : saved[key]) ?? def.default ?? '';
    const label = `<label for="in-${key}">${main ? 'Input' : esc(key)} ${def.required ? '<span class="req">*</span>' : ''}</label>`;
    const hint = def.description ? `<div class="hint">${esc(def.description)}</div>` : '';
    let control;
    if (def.enum) {
      control = `<select id="in-${key}" name="${key}">${def.enum.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (def.type === 'run') {
      control = `<input type="text" id="in-${key}" name="${key}" value="${esc(val)}" placeholder="latest" spellcheck="false" class="mono" />`;
    } else if (main || def.multiline) {
      control = `<textarea id="in-${key}" name="${key}" rows="${main ? 7 : 4}" placeholder="${main ? 'Describe what needs to be done…' : ''}">${esc(val)}</textarea>`;
    } else {
      control = `<input type="text" id="in-${key}" name="${key}" value="${esc(val)}" />`;
    }
    return `<div class="field">${label}${control}${hint}</div>`;
  };
  // a workflow's `mode` (e.g. auto | validated) changes how the run goes: shown next to the task, not in Advanced
  const upfront = (k) => k === 'mode' && k !== mainKey;
  $('#inputs-form').innerHTML = entries.filter(([k]) => k === mainKey || upfront(k)).map((e) => field(e, e[0] === mainKey)).join('');
  $('#adv-form').innerHTML = entries.filter(([k]) => k !== mainKey && !upfront(k)).map((e) => field(e, false)).join('');

  // a folder input with `required: false` (e.g. writer-reviewer's project_path) makes the project optional
  const needsProject = Object.entries(wf.inputs || {}).some(([k, def]) => isPathInput(k) && def.required !== false);
  $('#project-req').classList.toggle('hidden', !needsProject);
  setStartDisabled(!!wf.error || oneRunAtATime());
}

// Without concurrent runs (Settings › Execution) a second run can't start; with them, the engine
// says when the limit is reached.
const oneRunAtATime = () => !state.settings.concurrentRuns?.enabled && liveRuns().length > 0;

function readInputs() {
  const out = {};
  for (const form of ['#inputs-form', '#adv-form']) new FormData($(form)).forEach((v, k) => (out[k] = String(v).trim()));
  return out;
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
    const { runId } = await api.startRun({ file: wf.file, inputs, mock: wantsSimulation($('#mock-toggle')) });
    state.settings = await api.setSettings({ lastWorkflow: wf.file, lastProject: project?.id || null });
    const view = state.runs.get(runId);
    if (view?.run && project) view.run.project = project.name;
    const main = mainField();
    if (main) main.value = state.wf?.inputs?.[state.mainKey]?.default ?? '';
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
    main?.focus();
  } catch (e) {
    $('#start-error').textContent = errMsg(e);
  } finally {
    state.starting = false;
    renderHeader();
  }
}

function initStartDrawer() {
  $('#btn-drawer-close').onclick = closeDrawer;
  $('#drawer-backdrop').onclick = closeDrawer;
  $('#wf-select').onchange = () => selectWorkflow($('#wf-select').value);
  $('#project-select').onchange = renderProjectInfo;
  $('#btn-drawer-new-project').onclick = () => openProjectModal(null, { fromDrawer: true });
  $('#btn-start').onclick = () => startRun();
  $('#btn-start-another').onclick = () => startRun({ keepOpen: true });
}
