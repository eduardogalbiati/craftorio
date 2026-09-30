/* global api */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtNum = (n) => (n || 0).toLocaleString('en-US');
const fmtCost = (n) => (n == null ? '—' : `$${Number(n).toFixed(4)}`);
function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}m` : m ? `${m}m${String(r).padStart(2, '0')}s` : `${r}s`;
}
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US');
const dateOf = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
const LS_KEY = 'multiagent.inputs';
const USAGE_SCOPE_KEY = 'multiagent.usageScope';
const errMsg = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const CATEGORIES = {
  plan: 'Plan & Design',
  build: 'Code & Build',
  monitor: 'Monitor & Improve',
};
// Inputs filled with the chosen project's folder.
const isPathInput = (key) => /path|dir/i.test(key);

// ---------------------------------------------------------------------------
const state = {
  view: 'dashboard',
  ws: null,
  settings: {},
  workflows: [],
  projects: [],
  skills: [],
  wf: null,           // workflow selected in the start panel
  category: null,     // panel category filter (null = all)
  // Runs followed in this window (several can be in progress: Settings › Execution › Concurrent
  // runs), by run id; runId is the one the Run screen and the top bar show. state.run, sessions,
  // steps, orchLog, events, selected and openDetails read the selected run (defined below).
  runs: new Map(),
  runId: null,
  approval: null,     // the gate shown in the approval dialog (approval.requested event)
  tab: 'detail',
  workflowsTab: 'runs', // 'runs' | 'definitions'
  pendingProject: null, // project to preselect in the panel on open
  usage: null,        // last api.getUsage() result
  usageError: null,
  art: { runs: null, error: null, projectId: "", q: "", showSim: false, sel: null, doc: null, mode: "rendered", reveal: null },
  sup: { runId: null, question: '', loading: false, result: null, error: null, recMsgs: {} }, // supervisor panel
  pv: null,           // project detail view: { id, project, runs, error, filter, showSim, expanded, msgs }
  wr: { runs: null, error: null, filter: 'all', showSim: false, expanded: new Set(), msgs: new Map() }, // Workflows > Runs
  usageScope: (() => { try { return localStorage.getItem(USAGE_SCOPE_KEY) === 'machine' ? 'machine' : 'orchestrator'; } catch { return 'orchestrator'; } })(),
};

// What the window knows of one run, rebuilt from its events.
//   run: { id, status, startedAt, finishedAt, mock, workflow, project, issue, inputs }
//   sessions: id -> { ...snapshot, turnLog: Map, localOpenedAt }; steps: id -> { id, type, agent, visits, status }
//   approvals: approval id -> approval.requested event (gates waiting)
const newRunView = () => ({ run: null, sessions: new Map(), steps: new Map(), orchLog: [], events: [], selected: null, openDetails: new Set(), approvals: new Map() });
const NO_RUN = newRunView();
const selectedView = () => state.runs.get(state.runId) || NO_RUN;
for (const key of ['run', 'sessions', 'steps', 'orchLog', 'events', 'openDetails']) {
  Object.defineProperty(state, key, { get: () => selectedView()[key] });
}
Object.defineProperty(state, 'selected', { get: () => selectedView().selected, set: (v) => { selectedView().selected = v; } });
const isRunLive = (runId) => state.runs.get(runId)?.run?.status === 'running';
const liveRuns = () => [...state.runs.values()].filter((v) => v.run?.status === 'running');
const pendingGates = () => [...state.runs.values()].flatMap((v) => [...v.approvals.values()]);
// "workflow · project · #issue" of a run, for lists, toasts and dialogs
const runLabel = (r) => [r?.workflow || 'workflow', r?.project, r?.issue ? `#${r.issue.number}` : null].filter(Boolean).join(' · ');

// Shows a run on the Run screen and in the top bar.
function selectRun(runId, { open = true } = {}) {
  if (!state.runs.has(runId)) return;
  state.runId = runId;
  if (open) showView('run');
  scheduleRender();
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
async function init() {
  // top bar
  $('#btn-stop').onclick = stopRun;
  $('#btn-open-dir').onclick = () => api.openRunDir(state.run?.id);
  $('#btn-quick-start').onclick = () => openDrawer();
  $('#run-meta').onclick = () => state.run && showView('run');
  $('#nav-run-gates').onclick = (e) => { e.stopPropagation(); openNextGate(); };

  // navigation
  document.querySelectorAll('.nav-item').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
  document.querySelectorAll('.dash-card').forEach((b) => (b.onclick = () => openDrawer({ category: b.dataset.category })));

  // right drawer
  $('#btn-drawer-close').onclick = closeDrawer;
  $('#drawer-backdrop').onclick = closeDrawer;
  $('#wf-select').onchange = () => selectWorkflow($('#wf-select').value);
  $('#project-select').onchange = renderProjectInfo;
  $('#btn-drawer-new-project').onclick = () => openProjectModal(null, { fromDrawer: true });
  $('#btn-start').onclick = startRun;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#usage-pop').classList.contains('hidden')) return closeUsagePopover();
    if ($('#sup-drawer').classList.contains('open')) return closeSupervisor();
    if (!$('#budget-modal').classList.contains('hidden')) return closeModal('#budget-modal');
    if (!$('#project-modal').classList.contains('hidden')) return closeModal('#project-modal');
    if (!$('#skill-modal').classList.contains('hidden')) return closeModal('#skill-modal');
    if (!$('#agent-modal').classList.contains('hidden')) return closeModal('#agent-modal');
    if (!$('#drawer').classList.contains('open')) return;
    closeDrawer();
  });

  // run
  $('#btn-approve').onclick = () => resolveApproval(true);
  $('#btn-reject').onclick = () => resolveApproval(false);
  document.querySelectorAll('.tab[data-tab]').forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
  $('#tab-detail').addEventListener('toggle', (e) => {
    const key = e.target.dataset?.key;
    if (!key) return;
    e.target.open ? state.openDetails.add(key) : state.openDetails.delete(key);
  }, true);

  // projects
  $('#btn-new-project').onclick = () => openProjectModal(null);
  $('#btn-projects-folder').onclick = () => api.openPath(state.ws.projects);
  $('#project-form').onsubmit = saveProject;
  $('#btn-pj-cancel').onclick = () => closeModal('#project-modal');
  $('#btn-pj-pick').onclick = async () => { const d = await api.pickFolder(); if (d) $('#pj-folder').value = d; };

  // supervisor
  $('#btn-sup-close').onclick = closeSupervisor;
  $('#sup-backdrop').onclick = closeSupervisor;
  $('#btn-sup-analyze').onclick = analyzeRun;
  $('#btn-sup-chat').onclick = supervisorChat;
  $('#sup-question').oninput = (e) => { state.sup.question = e.target.value; };

  // artifacts
  $('#btn-art-refresh').onclick = () => loadArtifacts();
  $('#art-project').onchange = (e) => { state.art.projectId = e.target.value; renderArtifactList(); };
  $('#art-search').oninput = (e) => { state.art.q = e.target.value; renderArtifactList(); };
  $('#art-show-sim').onchange = (e) => { state.art.showSim = e.target.checked; renderArtifactList(); };

  // project detail
  $('#btn-project-back').onclick = () => showView('projects');
  $('#btn-project-refresh').onclick = () => loadProjectRuns();
  $('#project-show-sim').onchange = (e) => { if (state.pv) { state.pv.showSim = e.target.checked; renderProjectView(); } };

  // workflows
  $('#btn-workflows-folder').onclick = () => api.openPath(state.ws.workflows);
  document.querySelectorAll('[data-wtab]').forEach((b) => (b.onclick = () => showWorkflowsTab(b.dataset.wtab)));
  $('#btn-workflow-runs-refresh').onclick = () => loadWorkflowRuns();
  $('#workflow-show-sim').onchange = (e) => { state.wr.showSim = e.target.checked; renderWorkflowRuns(); };

  // skills
  $('#btn-new-skill').onclick = () => openSkillModal(null);
  $('#btn-skills-folder').onclick = () => api.openPath(state.ws.skills);
  $('#skill-form').onsubmit = saveSkill;
  $('#btn-sk-cancel').onclick = () => closeModal('#skill-modal');

  // account
  initAccount();

  // usage
  $('#usage-widget').onclick = toggleUsagePopover;
  $('#usage-pop-open').onclick = () => { closeUsagePopover(); showView('usage'); };
  document.addEventListener('mousedown', (e) => {
    if (!$('#usage-pop').classList.contains('hidden') && !e.target.closest('.usage-wrap')) closeUsagePopover();
  });
  $('#btn-usage-refresh').onclick = loadUsage;
  document.querySelectorAll('[data-scope]').forEach((b) => (b.onclick = () => setUsageScope(b.dataset.scope)));
  renderScopeToggles();
  $('#budget-form').onsubmit = saveBudget;
  $('#btn-bd-cancel').onclick = () => closeModal('#budget-modal');

  // settings
  document.querySelectorAll('.settings-tab').forEach((b) => (b.onclick = () => showSettingsTab(b.dataset.stab)));
  $('#btn-ws-open').onclick = () => api.openWorkspace();
  $('#btn-ws-change').onclick = changeWorkspace;
  $('#btn-tools-refresh').onclick = renderTools;
  document.querySelectorAll('[data-setting]').forEach((el) => (el.onchange = async () => {
    state.settings = await api.setSettings({ [el.dataset.setting]: el.checked });
    if (el.dataset.setting === 'developerMode') applyDeveloperMode();
  }));
  $('#set-backlog-platform').onchange = async (e) => { state.settings = await api.setSettings({ backlogPlatform: e.target.value }); };
  for (const sel of ['#set-cr-enabled', '#set-cr-max', '#set-cr-project', '#set-cr-sims']) $(sel).onchange = saveConcurrency;

  api.onEvent(onEvent);
  initNotifications();
  initTerminalDock();
  setInterval(renderTicking, 1000);
  loadUsage();

  state.ws = await api.getWorkspace();
  state.settings = await api.getSettings();
  state.simulationOnly = !!(await api.appInfo()).simulationOnly;
  $('#sim-only-badge').classList.toggle('hidden', !state.simulationOnly);
  applyDeveloperMode();
  [state.workflows, state.projects, state.skills] = await Promise.all([api.listWorkflows(), api.listProjects(), api.listSkills()]);
  renderWorkspacePaths();
  await loadActiveRuns();
  renderDashboard();

  const env = await api.checkEnv();
  $('#env-status').innerHTML = ['claude', 'codex'].map((k) =>
    env[k] ? `<span class="ok">✓ ${k}</span>`
           : `<span class="missing">✗ ${k} not found in PATH (use simulation mode)</span>`).join('');
}

// Runs already in progress when the window opens (a reload, or the UI in a browser): listed in
// the Run menu from the start; their details fill in from their next events.
async function loadActiveRuns() {
  let list = [];
  try { list = (await api.listActiveRuns?.()) || []; } catch { return; }
  for (const a of list) {
    if (state.runs.has(a.runId)) continue;
    const v = newRunView();
    v.run = { ...runInfo(a), status: 'running' };
    state.runs.set(a.runId, v);
    if (!state.runId) state.runId = a.runId;
  }
  scheduleRender();
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function showView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === (view === 'project' ? 'projects' : view)));
  if (view === 'sessions') window.SessionsView?.show();
  if (view === 'dashboard') renderDashboard();
  if (view === 'projects') refreshProjects();
  if (view === 'project') { renderProjectView(); loadProjectRuns(); }
  if (view === 'backlog') window.refreshBacklog?.();
  if (view === 'artifacts') { renderArtifacts(); loadArtifacts(); }
  if (view === 'workflows') showWorkflowsTab(state.workflowsTab);
  if (view === 'agents') window.refreshAgents?.();
  if (view === 'skills') refreshSkills();
  if (view === 'usage') { renderUsage(); loadUsage(); }
  if (view === 'settings') renderSettings();
  if (view === 'run') scheduleRender();
  // gates never pop up over the rest of the app: the Run screen of their run asks them
  if (view === 'run' && $('#approval-modal').classList.contains('hidden')) openApproval();
  reportNotifyContext();
}

// ---------------------------------------------------------------------------
// Desktop notifications: the engine skips those about the run or session this window shows while
// it is focused, so it is told what that is; clicking a notification opens its run or terminal.
// ---------------------------------------------------------------------------
function shownRunId() {
  if (state.view === 'run') return state.run?.id || null;
  if (state.view === 'runchat') return window.runChatShownRunId?.() || null;
  if (state.view === 'duo') return window.duoShownRunId?.() || null;
  if (state.view === 'arena') return window.arenaShownRunId?.() || null;
  return null;
}

// After the current task: the screens set the run they show right after switching to it.
let notifyContextTimer = null;
function reportNotifyContext() {
  if (notifyContextTimer) return;
  notifyContextTimer = setTimeout(() => {
    notifyContextTimer = null;
    api.setNotifyContext({
      focused: document.hasFocus() && !document.hidden,
      runId: shownRunId(),
      terminalId: state.view === 'sessions' ? window.SessionsView?.shownTerminalId() || null : null,
    });
  }, 0);
}
window.reportNotifyContext = reportNotifyContext;

function initNotifications() {
  window.addEventListener('focus', reportNotifyContext);
  window.addEventListener('blur', reportNotifyContext);
  document.addEventListener('visibilitychange', reportNotifyContext);
  api.onNotificationClick((target) => {
    if (target?.terminalId) { window.SessionsView?.focusTerminal(target.terminalId); return; }
    if (!target?.runId) return;
    const running = isRunLive(target.runId);
    window.openRunChat?.({ runId: target.runId, workflow: target.workflow, running });
  });
  reportNotifyContext();
}

// Developer mode (Settings › Execution): the Simulation checkboxes (.dev-only) are shown and checked
// by default; without it they are hidden and every run is real. Simulation only (automated checks,
// MULTIAGENT_SIMULATION_ONLY) behaves as developer mode: the engine refuses real runs anyway.
const devMode = () => !!state.settings.developerMode || !!state.simulationOnly;
// Whether a start is simulated, from its Simulation checkbox. Checked while it can't apply (developer
// mode off) fails instead of silently starting a real run.
function wantsSimulation(box) {
  if (!box?.checked) return false;
  if (!devMode()) throw new Error('Simulation is checked but Developer mode is off (Settings › Execution): turn it on or uncheck Simulation.');
  return true;
}
function applyDeveloperMode() {
  document.body.classList.toggle('dev-mode', devMode());
  for (const sel of ['#mock-toggle', '#duo-mock', '#arena-mock']) {
    const box = $(sel);
    if (!box) continue;
    box.checked = devMode();
    box.dispatchEvent(new Event('change'));
  }
  if (state.view === 'artifacts') renderArtifactList(); // simulated runs are listed only in developer mode
}

function openModal(sel) { $(sel).classList.remove('hidden'); }
function closeModal(sel) { $(sel).classList.add('hidden'); }

function confirmDialog(title, message, yes = 'Confirm') {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#btn-confirm-yes').textContent = yes;
  openModal('#confirm-modal');
  return new Promise((resolve) => {
    $('#btn-confirm-yes').onclick = () => { closeModal('#confirm-modal'); resolve(true); };
    $('#btn-confirm-no').onclick = () => { closeModal('#confirm-modal'); resolve(false); };
  });
}

function renderWorkspacePaths() {
  const ws = state.ws;
  $('#projects-dir').textContent = ws.projects;
  $('#skills-dir').textContent = ws.skills;
  $('#agents-dir').textContent = ws.agents || '';
  $('#workflows-dir').textContent = ws.workflows;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function renderDashboard() {
  document.querySelectorAll('[data-count]').forEach((el) => {
    const n = state.workflows.filter((w) => w.category === el.dataset.count).length;
    el.textContent = n ? `${n} workflow${n > 1 ? 's' : ''}` : 'no workflows yet';
    el.classList.toggle('none', !n);
  });
  // the runs in progress, or the selected one once it is over
  const list = liveRuns().length ? liveRuns() : state.run ? [selectedView()] : [];
  const box = $('#dash-run');
  box.classList.toggle('hidden', !list.length);
  box.innerHTML = list.map(({ run: r, approvals }) => `<div class="dash-run-row">
      <span class="status st-${esc(runSessionStatus(r.status))}"><span class="status-dot"></span></span>
      <span><b>${esc(r.workflow || 'workflow')}</b>${r.project ? ` · ${esc(r.project)}` : ''}${r.issue ? ` · #${esc(r.issue.number)}` : ''} <span class="muted">— ${esc(statusLabel(r))}${approvals.size ? ' · waiting for approval' : ''}</span></span>
      <button class="btn sm ghost" data-run="${esc(r.id)}">View run</button></div>`).join('');
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => selectRun(b.dataset.run)));
}

const runSessionStatus = (st) => ({ running: 'active', success: 'success', failed: 'failed', cancelled: 'cancelled' })[st] || 'idle';
const statusLabel = (r) => ({ idle: 'idle', running: r?.mock ? 'running (simulation)' : 'running', success: 'completed', failed: 'failed', cancelled: 'cancelled' })[r?.status || 'idle'] || r.status;

// ---------------------------------------------------------------------------
// Right drawer: start workflow
// ---------------------------------------------------------------------------
async function openDrawer({ category = null, workflow = null, project = null } = {}) {
  state.category = category;
  state.pendingProject = project;
  [state.workflows, state.projects, state.settings] = await Promise.all([api.listWorkflows(), api.listProjects(), api.getSettings()]);
  applyDeveloperMode();
  $('#start-error').textContent = '';
  renderDrawerCategories();
  renderWorkflowOptions(workflow || state.settings.lastWorkflow);
  renderProjectOptions(project || state.settings.lastProject);
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer-backdrop').classList.remove('hidden');
  setTimeout(() => ($('#in-task') || $('#wf-select')).focus(), 200);
}

function closeDrawer() {
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
    $('#btn-start').disabled = true;
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
  const field = ([key, def], main) => {
    // a run id is not remembered: the default ("latest") is usually what is wanted next time
    const val = (def.type === 'run' ? null : saved[key]) ?? def.default ?? '';
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
  $('#inputs-form').innerHTML = entries.filter(([k]) => k === mainKey).map((e) => field(e, true)).join('');
  $('#adv-form').innerHTML = entries.filter(([k]) => k !== mainKey).map((e) => field(e, false)).join('');

  // a folder input with `required: false` (e.g. writer-reviewer's project_path) makes the project optional
  const needsProject = Object.entries(wf.inputs || {}).some(([k, def]) => isPathInput(k) && def.required !== false);
  $('#project-req').classList.toggle('hidden', !needsProject);
  $('#btn-start').disabled = !!wf.error || oneRunAtATime();
}

// Without concurrent runs (Settings › Execution) a second run can't start; with them, the engine
// says when the limit is reached.
const oneRunAtATime = () => !state.settings.concurrentRuns?.enabled && liveRuns().length > 0;

function readInputs() {
  const out = {};
  for (const form of ['#inputs-form', '#adv-form']) new FormData($(form)).forEach((v, k) => (out[k] = String(v).trim()));
  return out;
}

async function startRun() {
  $('#start-error').textContent = '';
  const wf = state.wf;
  if (!wf) return;
  const project = state.projects.find((p) => p.id === $('#project-select').value);
  const pathKeys = Object.keys(wf.inputs || {}).filter(isPathInput);
  if (pathKeys.some((k) => wf.inputs[k].required !== false) && !project) return ($('#start-error').textContent = 'Select a project: its folder is used as the workflow repository.');
  if (project && !project.exists) return ($('#start-error').textContent = `The project folder does not exist: ${project.folder}`);

  const inputs = readInputs();
  try { localStorage.setItem(`${LS_KEY}.${wf.file}`, JSON.stringify(inputs)); } catch { /* ignore */ }
  if (project) for (const k of pathKeys) inputs[k] = project.folder;

  $('#btn-start').disabled = true;
  try {
    const { runId } = await api.startRun({ file: wf.file, inputs, mock: wantsSimulation($('#mock-toggle')) });
    state.settings = await api.setSettings({ lastWorkflow: wf.file, lastProject: project?.id || null });
    const view = state.runs.get(runId);
    if (view?.run && project) view.run.project = project.name;
    closeDrawer();
    // the run started here is the one shown
    if (view) selectRun(runId, { open: state.settings.openRunOnStart });
  } catch (e) {
    $('#start-error').textContent = errMsg(e);
  } finally {
    renderHeader();
  }
}

// Stops the run shown in the top bar (only that one).
async function stopRun() {
  const r = state.run;
  if (r?.status !== 'running') return;
  if (state.settings.confirmStop && !(await confirmDialog('Stop workflow', `Running sessions of ${runLabel(r)} will be closed. Stop this run?`, 'Stop'))) return;
  api.stopRun(r.id);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
async function refreshProjects() {
  state.projects = await api.listProjects();
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

// ---------------------------------------------------------------------------
// Project detail: runs of one project and their sessions
// ---------------------------------------------------------------------------
const RUN_FILTERS = [
  ['all', 'All', () => true],
  ['running', 'Running', (r) => r.status === 'running'],
  ['success', 'Success', (r) => r.status === 'success'],
  ['failed', 'Failed', (r) => ['failed', 'cancelled', 'interrupted'].includes(r.status)],
];

function openProjectView(id) {
  if (state.pv?.id !== id) {
    state.pv = { id, project: state.projects.find((p) => p.id === id) || null, runs: null, error: null, filter: 'all', showSim: false, expanded: new Set(), msgs: new Map() };
  }
  showView('project');
}

let pvLoading = null;
let pvLastLoad = 0;
let pvTimer = null;
function loadProjectRuns() {
  const pv = state.pv;
  if (!pv) return;
  if (pvLoading) return pvLoading;
  pvLoading = (async () => {
    try {
      const res = await api.listProjectRuns(pv.id);
      if (state.pv === pv) { pv.project = res.project || pv.project; pv.runs = res.runs || []; pv.error = null; }
    } catch (e) {
      if (state.pv === pv) pv.error = errMsg(e);
    }
    pvLoading = null;
    pvLastLoad = Date.now();
    if (state.view === 'project') renderProjectView();
  })();
  return pvLoading;
}

// At most one reload every 3 s from run events while the view is visible.
function loadProjectRunsThrottled() {
  if (pvTimer || state.view !== 'project') return;
  const wait = Math.max(0, 3000 - (Date.now() - pvLastLoad));
  pvTimer = setTimeout(() => { pvTimer = null; if (state.view === 'project') loadProjectRuns(); }, wait);
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
  });
}

// Run list shared by Projects > Project and Workflows > Runs. `rl` is the list state
// ({ runs, error, filter, showSim, expanded, msgs, id? }), `id` being the project when the
// list belongs to one; otherwise each run shows its own project.
function renderRunList(rl, { prefix, box: boxSel, empty, start, rerender }) {
  $(`#${prefix}-show-sim`).checked = rl.showSim;
  $(`#${prefix}-runs-error`).textContent = rl.error ? `Could not load runs: ${rl.error}` : '';

  const all = rl.runs || [];
  const visible = all.filter((r) => rl.showSim || !r.mock);
  const filters = $(`#${prefix}-run-filters`);
  filters.innerHTML = RUN_FILTERS.map(([id, label, fn]) =>
    `<button type="button" class="chip ${rl.filter === id ? 'active' : ''}" data-filter="${id}" ${id === 'failed' ? 'title="Failed, cancelled or interrupted"' : ''}>${label} <span class="muted">${visible.filter(fn).length}</span></button>`).join('');
  filters.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { rl.filter = b.dataset.filter; rerender(); }));

  const box = $(boxSel);
  if (rl.runs == null) {
    box.innerHTML = rl.error ? '' : '<p class="muted">Loading…</p>';
    return;
  }
  const hiddenSim = all.length - visible.length;
  const simNote = hiddenSim ? `<p class="muted small">${hiddenSim} simulated run${hiddenSim > 1 ? 's' : ''} hidden.</p>` : '';
  if (!all.length || !visible.length) {
    box.innerHTML = `<div class="empty-state"><b>${esc(empty)}</b>${simNote}<button class="btn primary" data-empty-start>Start workflow</button></div>`;
    box.querySelector('[data-empty-start]').onclick = start;
    return;
  }
  const fn = RUN_FILTERS.find(([id]) => id === rl.filter)?.[2] || (() => true);
  const runs = visible.filter(fn);
  box.innerHTML = (runs.map((r) => runListRow(r, rl)).join('') || '<p class="muted pr-none">No runs match this filter.</p>') + simNote;

  box.querySelectorAll('.pr-row').forEach((row) => (row.onclick = () => {
    const id = row.closest('.pr-run').dataset.run;
    rl.expanded.has(id) ? rl.expanded.delete(id) : rl.expanded.add(id);
    rerender();
  }));
  box.querySelectorAll('[data-run-act]').forEach((b) => (b.onclick = () => {
    const r = rl.runs.find((x) => x.runId === b.closest('.pr-run').dataset.run);
    if (b.dataset.runAct === 'logs') api.openPath(r.runDir);
    if (b.dataset.runAct === 'view') showView('run');
    if (b.dataset.runAct === 'chat') window.openRunChat?.({ runId: r.runId, workflow: r.workflow, running: r.current && r.status === 'running' });
    if (b.dataset.runAct === 'sup') openSupervisor({ runId: r.runId, workflow: r.workflow, status: r.status, error: r.error, mock: r.mock });
  }));
  box.querySelectorAll('[data-art]').forEach((b) => (b.onclick = () => {
    const r = rl.runs.find((x) => x.runId === b.closest('.pr-run').dataset.run);
    openArtifactsAt({ projectId: rl.id || r.project?.id, runId: r.runId, path: b.dataset.art, mock: r.mock });
  }));
  box.querySelectorAll('[data-term]').forEach((b) => (b.onclick = async () => {
    const runId = b.closest('.pr-run').dataset.run;
    const row = b.closest('[data-session]');
    const sid = row.dataset.session;
    const key = `${runId}:${sid}`;
    rl.msgs.set(key, await termAction(b, { sessionId: sid, runId, label: row.dataset.agent }));
    const msg = b.closest('[data-session]').querySelector('[data-term-msg]');
    if (msg) { msg.textContent = rl.msgs.get(key).text; msg.classList.toggle('error', rl.msgs.get(key).error); }
  }));
}

function runListRow(r, pv) {
  const open = pv.expanded.has(r.runId);
  const task = String(r.task || '').trim();
  const firstLine = task.split('\n')[0];
  const dur = r.status === 'running' && r.startedAt ? Date.now() - Date.parse(r.startedAt) : r.durationMs;
  return `
    <div class="pr-run ${open ? 'open' : ''}" data-run="${esc(r.runId)}">
      <div class="pr-row" title="${open ? 'Hide' : 'Show'} sessions">
        <span class="pill pill-${esc(r.status)}">${esc(r.status)}</span>
        <div class="pr-main">
          <div><b>${esc(r.workflow || r.file || 'workflow')}</b>${r.version ? ` <span class="muted small">v${esc(r.version)}</span>` : ''}${r.mock ? ' <span class="badge p-mock">simulated</span>' : ''}${r.current ? ' <span class="badge live">this window</span>' : ''}${!pv.id && r.project ? ` <span class="badge" title="project">${esc(r.project.name)}</span>` : ''}</div>
          <div class="muted small pr-task" title="${esc(task)}">${esc(firstLine || 'No task')}</div>
        </div>
        <span class="pr-meta"><label>started</label>${r.startedAt ? esc(dateOf(r.startedAt)) : '—'}</span>
        <span class="pr-meta"><label>duration</label>${fmtDur(dur)}</span>
        <span class="pr-meta"><label>tokens</label>${fmtTok(r.tokens?.total)}</span>
        <span class="pr-meta"><label>cost</label>${fmtUsd(r.costUsd)}</span>
        <span class="pr-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>
      </div>
      ${open ? projectRunBody(r, pv) : ''}
    </div>`;
}

const CHAT_TITLES = {
  'writer-reviewer': 'See the writer, reviewer and supervisor conversation',
  'ai-arena': 'See the contenders, the synthesis and the supervisor as a chat',
};

// Opens a run in Workflows › Runs, expanded.
function showRunInList(runId) {
  state.workflowsTab = 'runs';
  state.wr.filter = 'all';
  state.wr.showSim = true;
  state.wr.expanded.add(runId);
  showView('workflows');
  setTimeout(() => document.querySelector(`.pr-run[data-run="${CSS.escape(runId)}"]`)?.scrollIntoView({ block: 'center' }), 600);
}

function projectRunBody(r, pv) {
  const sessions = r.sessions || [];
  return `<div class="pr-body">
    <div class="row">
      <button class="btn sm ghost" data-run-act="logs">Open logs</button>
      <button class="btn sm ghost sup-btn" data-run-act="sup"><span class="sup-mark">◆</span> Ask the supervisor</button>
      <button class="btn sm" data-run-act="chat" title="${esc(CHAT_TITLES[r.workflow] || 'See the agents, the orchestrator and the human gates as a chat')}">Open chat</button>
      ${r.current ? '<button class="btn sm" data-run-act="view">View run</button>' : ''}
      <span class="spacer"></span>
      <span class="muted small mono">${esc(r.runId)}</span>
    </div>
    ${r.error ? `<pre class="pr-error">${esc(r.error)}</pre>` : ''}
    ${runTaskBlock(r)}
    ${r.artifacts?.length ? `<div class="pr-arts">
      <div class="pr-arts-head">Artifacts <span class="muted">${r.artifacts.length}</span></div>
      <div class="pr-arts-list">${r.artifacts.map((a) => `
        <button class="pr-art ${a.exists ? '' : 'missing'}" data-art="${esc(a.path)}" title="${esc(a.path)}">
          ${artKindIcon(a.kind)}<span class="pr-art-name">${esc(a.name)}</span>
          ${a.location === 'external' ? '<span class="badge">project copy</span>' : ''}${a.exists ? '' : '<span class="muted small">deleted</span>'}
          <span class="muted small">${esc(fmtSize(a.size))}</span>
        </button>`).join('')}</div>
    </div>` : ''}
    ${sessions.length ? `<table class="u-table pr-sessions">
      <thead><tr><th>Agent</th><th>Provider · model</th><th>Status</th><th class="num">Turns</th><th class="num">Cost</th><th></th></tr></thead>
      <tbody>${[...sessions].sort((a, b) => isOrchSession(b) - isOrchSession(a)).map((s) => {
        const m = pv.msgs.get(`${r.runId}:${s.id}`);
        return `<tr data-session="${esc(s.id)}" data-agent="${esc(s.agent)}">
          <td><b>${esc(s.agent)}</b> <span class="muted small mono">${esc(s.id)}</span></td>
          <td><span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span> <span class="mono small">${esc(s.model || '')}</span></td>
          <td><span class="status st-${esc(s.status)}"><span class="status-dot"></span>${esc(s.status)}</span></td>
          <td class="num mono">${fmtNum(s.turns)}</td>
          <td class="num mono">${fmtUsd(s.costUsd)}</td>
          <td class="pr-term">
            <span class="small ${m?.error ? 'error' : 'muted'}" data-term-msg>${esc(m?.text || '')}</span>
            ${termButtons('live', isOrchSession(s) ? 'Follow the orchestrator log in a terminal' : '')}
            ${termButtons('cli', '', s.cliAvailable ? '' : s.cliReason || 'Not available')}
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : '<p class="muted small">No agent sessions in this run.</p>'}
  </div>`;
}

function runTaskBlock(r) {
  const t = String(r.task || '').trim();
  return t.includes('\n') || t.length > 120 ? `<details class="pr-fulltask"><summary class="muted small">Full task</summary><pre>${esc(t)}</pre></details>` : '';
}

let editingProject = null;
let projectFromDrawer = false;
function openProjectModal(p, { fromDrawer = false } = {}) {
  editingProject = p;
  projectFromDrawer = fromDrawer;
  $('#project-modal-title').textContent = p ? 'Edit project' : 'New project';
  $('#btn-pj-save').textContent = p ? 'Save' : 'Create project';
  $('#pj-name').value = p?.name || '';
  $('#pj-description').value = p?.description || '';
  $('#pj-repo').value = p?.repo || '';
  $('#pj-folder').value = p?.folder || '';
  $('#pj-folder').required = !!p;
  $('#pj-folder-hint').classList.toggle('hidden', !!p);
  $('#pj-error').textContent = '';
  openModal('#project-modal');
  $('#pj-name').focus();
}

async function saveProject(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData($('#project-form')));
  const btn = $('#btn-pj-save');
  $('#pj-error').textContent = '';
  btn.disabled = true;
  const label = btn.textContent;
  if (!editingProject && data.repo) btn.textContent = 'Cloning…';
  try {
    const p = editingProject ? await api.updateProject(editingProject.id, data) : await api.createProject(data);
    closeModal('#project-modal');
    state.projects = await api.listProjects();
    if (projectFromDrawer) renderProjectOptions(p.id);
    if (state.view === 'projects') refreshProjects();
  } catch (err) {
    $('#pj-error').textContent = errMsg(err);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------
function showWorkflowsTab(tab) {
  state.workflowsTab = tab;
  document.querySelectorAll('[data-wtab]').forEach((b) => {
    const on = b.dataset.wtab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('[data-wpage]').forEach((p) => p.classList.toggle('hidden', p.dataset.wpage !== tab));
  if (tab === 'definitions') refreshWorkflows();
  if (tab === 'runs') { renderWorkflowRuns(); loadWorkflowRuns(); }
}

const workflowRunsVisible = () => state.view === 'workflows' && state.workflowsTab === 'runs';

// Every run, in the same list as Projects > Project.
function renderWorkflowRuns() {
  renderRunList(state.wr, {
    prefix: 'workflow', box: '#workflow-runs', empty: 'No workflows have run yet.',
    start: () => openDrawer(), rerender: renderWorkflowRuns,
  });
}

let wrLoading = null;
let wrLastLoad = 0;
let wrTimer = null;
function loadWorkflowRuns() {
  if (wrLoading) return wrLoading;
  const wr = state.wr;
  wrLoading = (async () => {
    try {
      wr.runs = (await api.listRuns()).runs || [];
      wr.error = null;
    } catch (e) {
      wr.error = errMsg(e);
    }
    wrLoading = null;
    wrLastLoad = Date.now();
    if (workflowRunsVisible()) renderWorkflowRuns();
  })();
  return wrLoading;
}

// At most one reload every 3 s from run events while the tab is visible.
function loadWorkflowRunsThrottled() {
  if (wrTimer || !workflowRunsVisible()) return;
  const wait = Math.max(0, 3000 - (Date.now() - wrLastLoad));
  wrTimer = setTimeout(() => { wrTimer = null; if (workflowRunsVisible()) loadWorkflowRuns(); }, wait);
}

async function refreshWorkflows() {
  state.workflows = await api.listWorkflows();
  const box = $('#workflows-list');
  if (!state.workflows.length) {
    box.innerHTML = '<div class="empty-state"><b>No workflows</b><p class="muted">Add .yaml files to the workflows folder.</p></div>';
    return;
  }
  box.innerHTML = state.workflows.map((w) => {
    const steps = (w.steps || []).map((s, i) => {
      const human = s.type === 'human_approval';
      const names = s.agents || [s.agent];
      const who = names.map((n) => `${esc(n)}${w.agents?.[n] ? ` · <span class="mono">${esc(w.agents[n].model)}</span>` : ''}`).join(s.agents ? '<br>' : '');
      const skillNames = [...new Set([...(s.skills || []), ...names.flatMap((n) => w.agents?.[n]?.skills || [])])];
      const others = s.next.filter((n) => n !== w.steps[i + 1]?.id);
      return `<li class="wf-step ${human ? 'human' : ''}">
        <span class="wf-step-n">${i + 1}</span>
        <div class="wf-step-body">
          <div class="wf-step-head"><b>${esc(s.id)}</b>
            ${s.agents ? '<span class="badge">parallel</span>' : ''}${s.goal ? '<span class="badge">/goal</span>' : ''}${s.loop ? '<span class="badge">/loop</span>' : ''}
            ${skillNames.map((k) => `<span class="badge" title="skill">⚡ ${esc(k.replace(/\{\{\s*inputs\.(\w+)\s*\}\}/g, '‹$1›'))}</span>`).join('')}</div>
          <div class="muted small">${human ? 'human approval' : who}</div>
          ${others.length ? `<div class="wf-step-next small">↳ ${others.map((n) => `<span class="mono">${esc(n)}</span>`).join(', ')}</div>` : ''}
        </div>
      </li>`;
    }).join('');
    return `
    <article class="wf-card" data-file="${esc(w.file)}">
      <div class="wf-card-head">
        <div>
          <h3>${esc(w.name)} ${w.version ? `<span class="muted small">v${esc(w.version)}</span>` : ''}</h3>
          <p class="muted small">${esc(w.error ? `Error: ${w.error}` : w.description || '')}</p>
          <div class="badges">
            <span class="badge cat-${esc(w.category)}">${esc(CATEGORIES[w.category] || w.category)}</span>
            <span class="badge">${(w.steps || []).length} steps</span>
            <span class="badge">${Object.keys(w.agents || {}).length} agents</span>
            <span class="badge mono">${esc(w.file)}</span>
            ${originBadge(w)}
          </div>
        </div>
        <div class="row">
          ${w.restorable ? '<button class="btn ghost sm" data-restore title="Move your edited copy to the trash and use the default bundled with the app">Restore default</button>' : ''}
          <button class="btn primary sm" data-run ${w.error ? 'disabled' : ''}>Run</button>
        </div>
      </div>
      <ol class="wf-steps">${steps}</ol>
    </article>`;
  }).join('');
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => openDrawer({ workflow: b.closest('.wf-card').dataset.file })));
  box.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = async () => {
    const file = b.closest('.wf-card').dataset.file;
    if (!(await confirmDialog('Restore default', `Move your edited "${file}" to the trash and restore the default bundled with the app?`, 'Restore'))) return;
    try { await api.restoreWorkflow(file); } catch (e) { showToast('Restore failed', e.message); }
    refreshWorkflows();
  }));
}

// Where a workflow file comes from (see src/seed.js): the bundled default, edited by the user or user-created.
function originBadge(w) {
  const badges = {
    default: '<span class="badge" title="Default bundled with the app; updated automatically with new app versions">default</span>',
    modified: '<span class="badge warn" title="Bundled default edited by you; app updates do not overwrite it">modified</span>',
    custom: '<span class="badge cat-build" title="Created by you">custom</span>',
  };
  const update = w.updateAvailable
    ? `<span class="badge warn" title="The app ships a newer default than the one you edited. Restore default to use it (your copy goes to the trash).">newer default${w.bundledVersion ? ` v${esc(w.bundledVersion)}` : ''}</span>`
    : '';
  return (badges[w.origin] || '') + update;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
async function refreshSkills() {
  state.skills = await api.listSkills();
  const box = $('#skills-list');
  if (!state.skills.length) {
    box.innerHTML = `<div class="empty-state"><b>No skills yet</b><p class="muted">Skills are reusable instructions (SKILL.md) that agents can follow.</p><button class="btn primary" id="empty-new-skill">New skill</button></div>`;
    $('#empty-new-skill').onclick = () => openSkillModal(null);
    return;
  }
  box.innerHTML = state.skills.map((s) => `
    <div class="card clickable" data-id="${esc(s.id)}">
      <div class="card-head">
        <span class="card-icon bolt"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg></span>
        <b class="card-title mono">${esc(s.name)}</b>
      </div>
      <p class="muted small clamp">${esc(s.error ? `Error: ${s.error}` : s.description || 'No description.')}</p>
      <div class="card-actions">
        <span class="muted small">${s.updatedAt ? `updated ${esc(dateOf(s.updatedAt))}` : ''}${s.files?.length ? ` · +${s.files.length} file(s)` : ''}</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-act="open">Folder</button>
        <button class="btn sm ghost danger" data-act="remove">Remove</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('.card').forEach((c) => (c.onclick = async (e) => {
    const s = state.skills.find((x) => x.id === c.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'open') return api.openPath(s.path);
    if (act === 'remove') {
      if (await confirmDialog('Remove skill', `Move the skill "${s.name}" to the trash?`, 'Remove')) { await api.removeSkill(s.id); refreshSkills(); }
      return;
    }
    openSkillModal(s);
  }));
}

let editingSkill = null;
function openSkillModal(s) {
  editingSkill = s;
  $('#skill-modal-title').textContent = s ? s.name : 'New skill';
  $('#sk-name-field').classList.toggle('hidden', !!s);
  $('#sk-name').value = '';
  $('#sk-description').value = s?.description || '';
  $('#sk-body').value = s?.body ?? '# Instructions\n\n- \n';
  $('#btn-sk-folder').classList.toggle('hidden', !s);
  $('#btn-sk-folder').onclick = () => s && api.openPath(s.path);
  $('#sk-error').textContent = '';
  openModal('#skill-modal');
  (s ? $('#sk-description') : $('#sk-name')).focus();
}

async function saveSkill(e) {
  e.preventDefault();
  const data = { name: $('#sk-name').value, description: $('#sk-description').value, body: $('#sk-body').value };
  try {
    if (editingSkill) await api.saveSkill(editingSkill.id, data);
    else await api.createSkill(data);
    closeModal('#skill-modal');
    refreshSkills();
  } catch (err) {
    $('#sk-error').textContent = errMsg(err);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function showSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach((b) => b.classList.toggle('active', b.dataset.stab === tab));
  document.querySelectorAll('.settings-page').forEach((p) => p.classList.toggle('hidden', p.dataset.spage !== tab));
  if (tab === 'agents') renderTools();
  if (tab === 'about') renderAbout();
}

async function renderSettings() {
  state.ws = await api.getWorkspace();
  state.settings = await api.getSettings();
  const ws = state.ws;
  $('#set-ws-path').textContent = ws.root;
  $('#set-ws-registry').textContent = ws.registry || 'MULTIAGENT_WORKSPACE environment variable (not saved)';
  const folders = [['runs', 'Run logs (one directory per run).'], ['repos', 'Repositories cloned from git URLs.'], ['projects', 'Project registry (one .json per project).'], ['skills', 'Skills (one folder with a SKILL.md per skill).']];
  $('#set-ws-folders').innerHTML = folders.map(([k, d]) => `
    <div class="s-row">
      <div class="s-label"><b>${k}/</b><span>${esc(d)}</span><code>${esc(ws[k])}</code></div>
      <div class="s-ctrl"><button class="btn sm ghost" data-open="${esc(ws[k])}">Open</button></div>
    </div>`).join('');
  $('#set-ws-folders').querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => api.openPath(b.dataset.open)));
  document.querySelectorAll('[data-setting]').forEach((el) => (el.checked = !!state.settings[el.dataset.setting]));
  const platform = $('#set-backlog-platform');
  platform.innerHTML = Object.entries(window.BACKLOG_PLATFORMS || {}).map(([id, p]) => `<option value="${id}">${esc(p.label)}${p.soon ? ' (sync not available yet)' : ''}</option>`).join('');
  platform.value = state.settings.backlogPlatform || 'github';
  renderConcurrency();
  if (!document.querySelector('[data-spage="agents"]').classList.contains('hidden')) renderTools();
}

// Settings › Execution › Concurrent runs (settings.concurrentRuns).
function renderConcurrency() {
  const c = state.settings.concurrentRuns || {};
  $('#set-cr-enabled').checked = !!c.enabled;
  $('#set-cr-max').value = c.max || 2;
  $('#set-cr-project').value = c.perProject || '';
  $('#set-cr-sims').checked = !!c.countSimulations;
  document.querySelectorAll('#set-concurrency .cr-opt').forEach((el) => el.classList.toggle('hidden', !c.enabled));
}

async function saveConcurrency() {
  const int = (sel) => { const n = Math.floor(Number($(sel).value)); return Number.isFinite(n) && n >= 1 ? Math.min(n, 20) : null; };
  const concurrentRuns = {
    enabled: $('#set-cr-enabled').checked, max: int('#set-cr-max') || 2,
    perProject: int('#set-cr-project'), countSimulations: $('#set-cr-sims').checked,
  };
  state.settings = await api.setSettings({ concurrentRuns });
  renderConcurrency();
  renderHeader();
}

async function renderTools() {
  const box = $('#set-tools');
  box.innerHTML = '<div class="s-row"><div class="s-label"><span>Checking…</span></div></div>';
  const tools = await api.envDetails();
  box.innerHTML = tools.map((t) => `
    <div class="s-row">
      <div class="s-label">
        <b>${esc(t.name)}</b>
        <span>${t.path ? esc(t.version || 'unknown version') : 'Not found in PATH.'}${t.account ? ` · account <b>${esc(t.account)}</b>` : ''}</span>
        ${t.path ? `<code>${esc(t.path)}</code>` : ''}
      </div>
      <div class="s-ctrl"><span class="conn ${t.connected ? 'on' : 'off'}"><span class="conn-dot"></span>${t.connected ? 'Connected' : t.path ? (t.auth ? 'Not signed in' : 'Error') : 'Not installed'}</span></div>
    </div>`).join('');
}

async function renderAbout() {
  const i = await api.appInfo();
  $('#set-about').innerHTML = [['App version', i.version], ['Electron', i.electron], ['Node', i.node], ['Workflows folder', i.workflowsDir]].map(([k, v]) =>
    `<div class="s-row"><div class="s-label"><b>${esc(k)}</b></div><div class="s-ctrl mono small">${esc(v)}</div></div>`).join('');
}

async function changeWorkspace() {
  $('#ws-error').textContent = '';
  try {
    state.ws = await api.changeWorkspace();
    renderWorkspacePaths();
    renderSettings();
  } catch (e) {
    $('#ws-error').textContent = errMsg(e);
  }
}

// ---------------------------------------------------------------------------
// Usage (tokens / cost / budgets per CLI)
// ---------------------------------------------------------------------------
function fmtTok(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  const short = (v, s) => `${v.toFixed(v < 100 ? 1 : 0).replace(/\.0$/, '')}${s}`;
  if (a >= 1e9) return short(n / 1e9, 'B');
  if (a >= 1e6) return short(n / 1e6, 'M');
  if (a >= 1e3) return short(n / 1e3, 'K');
  return String(Math.round(n));
}
const fmtUsd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Parses "12.5", "12,5", "$50", "1.5M", "200k" (empty -> null, invalid -> NaN).
function parseAmount(v) {
  const t = String(v ?? '').trim().replace(/[\s$_]/g, '');
  if (!t) return null;
  const m = /^(\d+(?:[.,]\d+)?)([kmb])?$/i.exec(t);
  if (!m) return NaN;
  return Number(m[1].replace(',', '.')) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1);
}
const STATUS_RANK = { ok: 0, warn: 1, over: 2 };
const STATUS_TEXT = { ok: 'Within budget', warn: 'Near limit', over: 'Over limit' };
const pctStatus = (p) => (p == null ? 'ok' : p >= 1 ? 'over' : p >= 0.8 ? 'warn' : 'ok');
const worstStatus = (providers) => (providers || []).reduce((w, p) => ((STATUS_RANK[p.status] || 0) > STATUS_RANK[w] ? p.status : w), 'ok');
function monthLabel(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  return y && m ? new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : 'this month';
}

let usageLoading = null;
let usageLastLoad = 0;
let usageTimer = null;
function loadUsage() {
  if (usageLoading) return usageLoading;
  usageLoading = (async () => {
    const scope = state.usageScope;
    try {
      const u = await api.getUsage(scope);
      if (scope === state.usageScope) { state.usage = u; state.usageError = null; }
    } catch (e) {
      if (scope === state.usageScope) state.usageError = errMsg(e);
    }
    usageLoading = null;
    usageLastLoad = Date.now();
    if (scope !== state.usageScope) return loadUsage(); // scope changed while loading
    renderUsageAll();
  })();
  return usageLoading;
}

function setUsageScope(scope) {
  if (scope !== 'machine') scope = 'orchestrator';
  if (scope === state.usageScope) return;
  state.usageScope = scope;
  try { localStorage.setItem(USAGE_SCOPE_KEY, scope); } catch { /* ignore */ }
  state.usageError = null;
  renderUsageAll();
  loadUsage();
}

function renderScopeToggles() {
  document.querySelectorAll('[data-scope]').forEach((b) => {
    const on = b.dataset.scope === state.usageScope;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// True while the data on screen belongs to the other scope (a reload is in flight).
const usageStale = () => !!state.usage && (state.usage.scope || 'orchestrator') !== state.usageScope;

// At most one load every 5 s while a run is streaming results.
function loadUsageThrottled() {
  if (usageTimer) return;
  const wait = Math.max(0, 5000 - (Date.now() - usageLastLoad));
  usageTimer = setTimeout(() => { usageTimer = null; loadUsage(); }, wait);
}

function renderUsageAll() {
  renderScopeToggles();
  renderUsageWidget();
  if (!$('#usage-pop').classList.contains('hidden')) renderUsagePopover();
  if (state.view === 'usage') renderUsage();
}

function renderUsageWidget() {
  const u = state.usage;
  const btn = $('#usage-widget');
  btn.classList.toggle('unavailable', !u && !!state.usageError);
  if (!u) {
    $('#usage-widget-text').textContent = state.usageError ? 'Usage unavailable' : '—';
    $('#usage-widget-dot').className = 'u-dot';
    $('#usage-widget-scope').classList.add('hidden');
    return;
  }
  const m = u.totals?.month || {};
  const worst = worstStatus(u.providers);
  const machine = u.scope === 'machine';
  $('#usage-widget-text').textContent = `${fmtTok(m.tokens?.total)} tok · ${fmtUsd(m.costUsd)}`;
  $('#usage-widget-dot').className = `u-dot st-${worst}`;
  $('#usage-widget-scope').classList.toggle('hidden', !machine);
  btn.title = `${machine ? 'All CLI usage on this machine' : 'Orchestrator usage'} in ${monthLabel(u.month)}: ${fmtNum(m.tokens?.total)} tokens, ${fmtUsd(m.costUsd)} — ${STATUS_TEXT[worst]}`;
}

function toggleUsagePopover() {
  if ($('#usage-pop').classList.contains('hidden')) openUsagePopover();
  else closeUsagePopover();
}

function openUsagePopover() {
  $('#usage-pop').classList.remove('hidden');
  $('#usage-widget').setAttribute('aria-expanded', 'true');
  renderUsagePopover();
  loadUsage();
}

function closeUsagePopover() {
  $('#usage-pop').classList.add('hidden');
  $('#usage-widget').setAttribute('aria-expanded', 'false');
}

function meterHtml(label, pct, used, limit, compact = false) {
  return meterRaw(label, pct, `${used} / ${limit} · ${Math.round((Number(pct) || 0) * 100)}%`, compact);
}

// pct is a 0..1+ fraction (null = unknown); detail is the right-hand text.
function meterRaw(label, pct, detail, compact = false) {
  const p = Number(pct) || 0;
  const w = Math.min(100, Math.max(0, p * 100));
  return `<div class="meter st-${pctStatus(pct)}${compact ? ' compact' : ''}">
    <div class="meter-top"><span>${esc(label)}</span><span class="mono">${esc(detail)}</span></div>
    <div class="meter-bar"><span style="width:${w.toFixed(1)}%"></span></div>
  </div>`;
}

function renderUsagePopover() {
  const u = state.usage;
  $('#usage-pop-month').textContent = u ? monthLabel(u.month) : '';
  const body = $('#usage-pop-body');
  body.classList.toggle('stale', usageStale());
  if (!u) {
    body.innerHTML = `<p class="muted small up-empty">${state.usageError ? 'Usage unavailable' : 'Loading…'}</p>`;
    return;
  }
  body.innerHTML = (u.providers || []).map((p) => {
    const m = p.month || {}, b = p.budget || {};
    const bar = p.usedPctUsd != null ? meterHtml('USD budget', p.usedPctUsd, fmtUsd(m.costUsd), fmtUsd(b.monthlyUsd), true)
      : p.usedPctTokens != null ? meterHtml('Token budget', p.usedPctTokens, fmtTok(m.tokens?.total), fmtTok(b.monthlyTokens), true)
      : '<div class="muted small">no budget</div>';
    return `<div class="up-row">
      <div class="up-line">
        <b>${esc(p.name)}</b>
        <span class="u-inst ${p.installed ? 'on' : 'off'}">${p.installed ? 'installed' : 'not installed'}</span>
        ${planWorst(p) != null ? `<span class="u-plan-pct st-${pctStatus(planWorst(p) / 100)}" title="Most used plan rate-limit window">plan ${Math.round(planWorst(p))}%</span>` : ''}
        <span class="spacer"></span>
        <span class="mono small">${fmtTok(m.tokens?.total)} tok · ${fmtUsd(m.costUsd)}</span>
      </div>
      ${bar}
    </div>`;
  }).join('') || '<p class="muted small up-empty">No providers.</p>';
}

function renderUsage() {
  const u = state.usage;
  const err = $('#usage-error');
  err.classList.toggle('hidden', !state.usageError);
  err.innerHTML = state.usageError
    ? `<b>Usage unavailable</b>${u ? ' — showing the last loaded data.' : '.'} <span class="small">${esc(state.usageError)}</span>`
    : '';
  $('#usage-extra').classList.toggle('hidden', !u);
  $('#usage-live').classList.toggle('hidden', !u?.live);
  $('#usage-sub').textContent = state.usageScope === 'machine'
    ? 'Everything the Claude Code, Codex and Grok CLIs recorded on this machine, including use outside the orchestrator'
    : "Tokens and cost of the orchestrator's runs";
  $('#usage-cards').classList.toggle('stale', usageStale());
  if (!u) {
    $('#usage-cards').innerHTML = state.usageError ? '' : '<p class="muted">Loading…</p>';
    return;
  }
  $('#usage-month').textContent = monthLabel(u.month);
  $('#usage-cards').innerHTML = (u.providers || []).map((p) => providerCard(p, u)).join('');
  $('#usage-cards').querySelectorAll('[data-budget]').forEach((b) => (b.onclick = () => openBudgetModal(b.dataset.budget)));
  // Don't wipe prices the user is typing.
  if (!$('#usage-prices').contains(document.activeElement)) renderPrices();
  renderUsageRuns();
}

// Highest used % (0..100) across the plan's rate-limit windows, or null.
function planWorst(p) {
  const v = (p.plan?.windows || []).map((w) => w.usedPercent).filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
}

const shortDate = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function planBlock(p, u) {
  const pl = p.plan;
  if (!pl) {
    return p.id === 'codex' && u.scope !== 'machine'
      ? '<p class="muted small u-note">Switch to <b>This machine</b> to see the plan\'s rate limits and credits.</p>' : '';
  }
  const c = pl.credits;
  const credits = !c ? '' : c.unlimited ? 'unlimited credits' : c.balance != null ? `credit balance ${fmtNum(c.balance)}` : c.hasCredits ? 'has credits' : 'no credits';
  return `<div class="u-plan">
    <div class="u-plan-head"><b>Plan</b>${pl.planType ? `<span class="badge">${esc(pl.planType)}</span>` : ''}${credits ? `<span class="muted small">${esc(credits)}</span>` : ''}
      <span class="spacer"></span>${pl.updatedAt ? `<span class="muted small">as of ${esc(shortDate(pl.updatedAt))}</span>` : ''}</div>
    ${pl.limitReached ? `<p class="error small u-note">Limit reached: ${esc(pl.limitReached)}</p>` : ''}
    ${(pl.windows || []).map((w) => meterRaw(w.label || 'window', w.usedPercent == null ? null : w.usedPercent / 100,
      `${w.usedPercent == null ? '—' : Math.round(w.usedPercent) + '%'}${w.resetsAt ? ' · resets ' + shortDate(w.resetsAt) : ''}`)).join('')}
  </div>`;
}

function orchestratorSplit(p) {
  const o = p.orchestrator;
  if (!o) return '';
  const total = p.month?.tokens?.total || 0;
  const part = o.tokens?.total || 0;
  const pct = total ? Math.min(100, (part / total) * 100) : 0;
  return `<div class="u-orch">
    <div class="split-bar" title="Orchestrator share of this month's tokens"><span style="width:${pct.toFixed(1)}%"></span></div>
    <span class="small muted">of which orchestrator: <b class="mono">${fmtTok(part)} tok · ${fmtUsd(o.costUsd)}</b>${total ? ` (${pct < 1 && part ? '&lt;1' : Math.round(pct)}%)` : ''}</span>
  </div>`;
}

function providerCard(p, u) {
  const m = p.month || {}, t = m.tokens || {}, b = p.budget || {};
  const meters = [];
  if (b.monthlyUsd != null) meters.push(meterHtml('Monthly USD budget', p.usedPctUsd, fmtUsd(m.costUsd), fmtUsd(b.monthlyUsd)));
  if (b.monthlyTokens != null) meters.push(meterHtml('Monthly token budget', p.usedPctTokens, fmtTok(t.total), fmtTok(b.monthlyTokens)));
  const models = (p.models || []).filter((x) => x.month?.tokens?.total || x.month?.costUsd);
  return `
    <div class="card usage-card" data-provider="${esc(p.id)}">
      <div class="card-head">
        <span class="card-icon p-${esc(p.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="5 16 10 11 5 6" /><line x1="12" y1="18" x2="19" y2="18" /></svg></span>
        <b class="card-title">${esc(p.name)}</b>
        <span class="conn ${p.installed ? 'on' : 'off'}"><span class="conn-dot"></span>${p.installed ? 'Installed' : 'Not installed'}</span>
        <span class="spacer"></span>
        ${meters.length ? `<span class="u-status st-${esc(p.status)}"><span class="u-dot st-${esc(p.status)}"></span>${esc(STATUS_TEXT[p.status] || p.status)}</span>` : ''}
      </div>
      ${p.localAvailable === false ? `<p class="muted small u-note">No local logs found${u.sources?.[p.id] ? ` at <span class="mono">${esc(u.sources[p.id])}</span>` : ''}.</p>` : ''}
      ${p.installed ? '' : `<div class="u-install"><span class="muted small">Install with</span><code>${esc(p.installHint || '')}</code></div>`}
      <div class="u-stats">
        <div class="u-stat"><label>Month tokens</label><b>${fmtTok(t.total)}</b></div>
        <div class="u-stat"><label>Month cost</label><b>${fmtUsd(m.costUsd)}</b></div>
        <div class="u-stat"><label>Cost today</label><b>${fmtUsd(p.today?.costUsd)}</b></div>
      </div>
      ${orchestratorSplit(p)}
      <div class="u-breakdown mono">
        <span>in <b>${fmtTok(t.input)}</b></span><span>out <b>${fmtTok(t.output)}</b></span>
        <span>cache read <b>${fmtTok(t.cache_read)}</b></span><span>cache write <b>${fmtTok(t.cache_write)}</b></span>
      </div>
      ${p.costReported === false ? '<p class="muted small u-note">This CLI does not report cost. Set prices per model below to estimate it, or use a token budget.</p>' : ''}
      ${m.unpricedTokens > 0 ? `<p class="warn-text small u-note">${fmtTok(m.unpricedTokens)} tokens have no reported cost and no price, so the cost shown is incomplete.</p>` : ''}
      ${meters.length ? `<div class="u-meters">${meters.join('')}</div>` : ''}
      ${planBlock(p, u)}
      ${models.length ? `<table class="u-table compact">
        <thead><tr><th>Model</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
        <tbody>${models.map((x) => `<tr><td class="mono">${esc(x.model)}</td><td class="num mono">${fmtTok(x.month?.tokens?.total)}</td><td class="num mono">${fmtUsd(x.month?.costUsd)}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="muted small">No usage this month.</p>'}
      <div class="card-actions">
        <span class="muted small">${meters.length ? (b.blockOnLimit ? 'Runs are blocked at the limit.' : 'Warning only, runs are not blocked.') : 'No budget set.'}${meters.length && b.countOutside ? '<br>Budget counts all usage on this machine.' : ''}</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-budget="${esc(p.id)}">Edit budget</button>
      </div>
    </div>`;
}

let budgetProvider = null;
function openBudgetModal(id) {
  const p = state.usage?.providers?.find((x) => x.id === id);
  if (!p) return;
  budgetProvider = id;
  const b = p.budget || {};
  $('#budget-modal-title').textContent = `Budget — ${p.name}`;
  $('#bd-usd').value = b.monthlyUsd ?? '';
  $('#bd-tokens').value = b.monthlyTokens == null ? '' : parseAmount(fmtTok(b.monthlyTokens)) === b.monthlyTokens ? fmtTok(b.monthlyTokens) : b.monthlyTokens;
  $('#bd-block').checked = !!b.blockOnLimit;
  $('#bd-outside').checked = !!b.countOutside;
  $('#bd-error').textContent = '';
  openModal('#budget-modal');
  $('#bd-usd').focus();
}

async function saveBudget(e) {
  e.preventDefault();
  const num = (sel) => {
    const n = parseAmount($(sel).value);
    if (n === null) return null;
    if (!Number.isFinite(n) || n < 0) throw new Error('Limits must be positive numbers (or empty for no limit).');
    return n;
  };
  $('#bd-error').textContent = '';
  try {
    const budget = { monthlyUsd: num('#bd-usd'), monthlyTokens: num('#bd-tokens'), blockOnLimit: $('#bd-block').checked, countOutside: $('#bd-outside').checked };
    if (budget.monthlyTokens != null) budget.monthlyTokens = Math.round(budget.monthlyTokens);
    state.usage = await api.setBudget(budgetProvider, budget, state.usageScope);
    state.usageError = null;
    closeModal('#budget-modal');
    renderUsageAll();
  } catch (err) {
    $('#bd-error').textContent = errMsg(err);
  }
}

const PRICE_KEYS = [['input', 'Input'], ['output', 'Output'], ['cache_read', 'Cache read']];
function renderPrices() {
  const u = state.usage;
  const prices = u.prices || {};
  const models = new Set(Object.keys(prices));
  (u.providers || []).filter((p) => p.costReported === false).forEach((p) => (p.models || []).forEach((m) => models.add(m.model)));
  const row = (model) => `
    <tr data-model="${esc(model)}">
      <td class="mono">${model == null ? '<input type="text" class="price-model" placeholder="model name" />' : `${esc(model)}${prices[model] ? '' : ' <span class="badge warn">no price</span>'}`}</td>
      ${PRICE_KEYS.map(([k]) => `<td class="num"><input type="text" inputmode="decimal" data-k="${k}" value="${esc(prices[model]?.[k] ?? '')}" placeholder="0.00" /></td>`).join('')}
      <td class="num"><span class="price-msg small"></span><button class="btn sm ${model == null ? '' : 'ghost'}" data-save-price>${model == null ? 'Add' : 'Save'}</button></td>
    </tr>`;
  $('#usage-prices').innerHTML = `<table class="u-table prices">
    <thead><tr><th>Model</th>${PRICE_KEYS.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th></th></tr></thead>
    <tbody>${[...models].sort().map(row).join('')}${row(null)}</tbody>
  </table>`;
  $('#usage-prices').querySelectorAll('[data-save-price]').forEach((b) => (b.onclick = () => savePrice(b.closest('tr'))));
}

async function savePrice(tr) {
  const msg = tr.querySelector('.price-msg');
  const model = tr.dataset.model ?? tr.querySelector('.price-model')?.value.trim();
  msg.className = 'price-msg small';
  if (!model) { msg.classList.add('error'); msg.textContent = 'Enter a model name.'; return; }
  const price = {};
  for (const [k] of PRICE_KEYS) {
    const n = parseAmount(tr.querySelector(`[data-k="${k}"]`).value) ?? 0;
    if (!Number.isFinite(n) || n < 0) { msg.classList.add('error'); msg.textContent = 'Invalid price.'; return; }
    price[k] = n;
  }
  try {
    state.usage = await api.setPrice(model, price, state.usageScope);
    state.usageError = null;
    renderUsageAll();
    renderPrices();
    const saved = [...$('#usage-prices').querySelectorAll('tr')].find((r) => r.dataset.model === model)?.querySelector('.price-msg');
    if (saved) { saved.textContent = 'Saved'; setTimeout(() => (saved.textContent = ''), 2000); }
  } catch (e) {
    msg.classList.add('error');
    msg.textContent = errMsg(e);
  }
}

function renderUsageRuns() {
  $('#usage-runs').innerHTML = runsTableHtml(state.usage);
}

// Recent runs table, shared by Usage > Recent runs and Workflows > Runs.
function runsTableHtml(u) {
  const runs = u.runs || [];
  if (!runs.length) return '<div class="s-row"><div class="s-label"><span>No runs recorded yet (simulation runs are not counted).</span></div></div>';
  const names = Object.fromEntries((u.providers || []).map((p) => [p.id, p.name]));
  return `<table class="u-table">
    <thead><tr><th>Date</th><th>Workflow</th><th>Status</th><th class="num">Tokens</th><th class="num">Cost</th><th>By provider</th></tr></thead>
    <tbody>${runs.map((r) => `<tr title="${esc(r.runId)}">
      <td class="nowrap">${r.startedAt ? esc(dateOf(r.startedAt)) : '—'}</td>
      <td>${esc(r.workflow || '—')}</td>
      <td><span class="pill pill-${esc(r.status)}">${esc(r.status || '—')}</span></td>
      <td class="num mono">${fmtTok(r.tokens)}</td>
      <td class="num mono">${fmtUsd(r.costUsd)}</td>
      <td><div class="u-split">${Object.entries(r.byProvider || {}).map(([id, v]) =>
        `<span class="badge p-${esc(id)}" title="${esc(names[id] || id)}">${esc(id)} ${fmtTok(v.tokens)} · ${fmtUsd(v.costUsd)}</span>`).join('')}</div></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

// answer: true/false or a choice id
function resolveApproval(answer) {
  const ev = state.approval;
  if (!ev) return;
  api.resolveApproval(ev.approval_id, answer, $('#approval-feedback-text').value, ev.run_id);
  closeApproval();
}

// Opens the approval dialog for a gate: `ev`, or the oldest gate waiting in the selected run.
// Gates never open it by themselves elsewhere in the app (a badge and a toast say they wait).
function openApproval(ev = null) {
  ev = ev || [...selectedView().approvals.values()][0];
  // the run chats (Write & Review, AI Arena, any run) ask the question inline for the run they show
  if (!ev || window.duoShowsRun?.(ev.run_id) || window.arenaShowsRun?.(ev.run_id) || window.runChatShowsRun?.(ev.run_id)) return;
  state.approval = ev;
  const r = state.runs.get(ev.run_id)?.run;
  $('#approval-step').textContent = `${r ? `${runLabel(r)} · ` : ''}step: ${ev.step_id}`;
  $('#approval-message').textContent = ev.message;
  $('#approval-binary').classList.toggle('hidden', !!ev.choices);
  $('#approval-choices').classList.toggle('hidden', !ev.choices);
  $('#approval-choices').innerHTML = (ev.choices || []).map((c, i) =>
    `<button class="btn ${i === 0 ? 'primary' : 'ghost'}" data-choice="${esc(c.id)}">${esc(c.label)}</button>`).join('');
  $('#approval-choices').querySelectorAll('[data-choice]').forEach((b) => (b.onclick = () => resolveApproval(b.dataset.choice)));
  $('#approval-feedback').classList.toggle('hidden', !ev.feedback);
  $('#approval-feedback-label').textContent = ev.feedback?.label || '';
  $('#approval-feedback-text').placeholder = ev.feedback?.placeholder || '';
  $('#approval-feedback-text').value = '';
  $('#approval-modal').classList.remove('hidden');
}

function closeApproval() {
  state.approval = null;
  $('#approval-modal').classList.add('hidden');
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $('#tab-detail').classList.toggle('hidden', tab !== 'detail');
  $('#tab-events').classList.toggle('hidden', tab !== 'events');
  scheduleRender();
}

// ---------------------------------------------------------------------------
// Engine events
// ---------------------------------------------------------------------------
// Opens the oldest gate waiting across runs, on its run (the badge on the Run menu item).
function openNextGate() {
  const ev = pendingGates()[0];
  if (!ev) return;
  selectRun(ev.run_id);
  openApproval(ev);
}
window.openNextGate = openNextGate;

function getTurn(sess, n) {
  if (!sess.turnLog.has(n)) sess.turnLog.set(n, { n, items: [], prompt: null, result: null, stepId: null, startedAt: null });
  return sess.turnLog.get(n);
}

// The view of an event's run. A run that started before this window opened (or reconnected) is
// picked up from its next event: its earlier events are in its chat and on disk.
function viewOf(ev) {
  let v = state.runs.get(ev.run_id);
  if (!v) {
    v = newRunView();
    state.runs.set(ev.run_id, v);
    if (ev.type !== 'workflow.started') {
      v.run = { id: ev.run_id, status: 'running', startedAt: Date.parse(ev.ts), workflow: null, inputs: {} };
      if (!isRunLive(state.runId)) state.runId = ev.run_id;
      api.listActiveRuns?.().then((list) => {
        const a = list.find((x) => x.runId === ev.run_id);
        if (a && v.run) Object.assign(v.run, runInfo(a), { status: v.run.status });
        scheduleRender();
      }).catch(() => {});
    }
  }
  return v;
}

// Workflow, project and issue of a run, from workflow.started or from runs:active.
function runInfo(x) {
  const inputs = x.inputs || {};
  const project = state.projects.find((p) => p.id === (x.project_id || x.projectId)) || state.projects.find((p) => Object.values(inputs).includes(p.folder));
  return {
    id: x.run_id || x.runId, startedAt: Date.parse(x.ts || x.startedAt) || Date.now(), mock: !!x.mock, workflow: x.workflow,
    version: x.version, inputs, issue: x.issue || null, project: project?.name || null,
  };
}

// Finished runs that are not shown are forgotten (their chat and files keep everything).
function pruneRuns() {
  for (const [id, v] of state.runs) {
    if (state.runs.size <= 8) return;
    if (id !== state.runId && v.run?.status !== 'running') state.runs.delete(id);
  }
}

function onEvent(ev) {
  if (ev.type === 'workflow.started' || ev.type === 'workflow.finished') reportNotifyContext();
  const v = viewOf(ev);
  v.events.push(ev);
  const sess = ev.session_id ? v.sessions.get(ev.session_id) : null;

  switch (ev.type) {
    case 'workflow.started':
      v.run = { ...runInfo(ev), status: 'running' };
      v.events = [ev];
      v.steps = new Map((ev.steps || []).map((s) => [s.id, { ...s, visits: 0, status: 'pending' }]));
      // a new run takes the Run screen only from a run that is over
      if (!isRunLive(state.runId) || state.runId === ev.run_id) state.runId = ev.run_id;
      orch(ev, `workflow "${ev.workflow}" started ${ev.mock ? '(simulation)' : ''}`);
      pruneRuns();
      break;

    case 'workflow.finished':
      v.run.status = ev.status;
      v.run.finishedAt = Date.parse(ev.ts);
      v.run.error = ev.error || null;
      v.steps.forEach((s) => { if (s.status !== 'pending') s.status = 'done'; });
      v.approvals.clear();
      orch(ev, `workflow finished: ${ev.status}${ev.error ? ' — ' + ev.error : ''}`, ev.status === 'success' ? 'transition' : 'error');
      if (state.approval?.run_id === ev.run_id) closeApproval();
      // the Run screen moves on to a run still in progress when the one it showed ends elsewhere
      if (state.runId === ev.run_id && state.view !== 'run' && liveRuns().length) state.runId = liveRuns()[0].run.id;
      if (liveRuns().length) showToast(`${runLabel(v.run)}: ${statusLabel(v.run)}`, ev.error, ev.run_id);
      loadUsage();
      break;

    case 'session.opened':
      v.sessions.set(ev.session_id, { ...ev.session, turnLog: new Map(), localOpenedAt: Date.parse(ev.ts) });
      if (!v.selected) v.selected = ev.session_id;
      if (ev.session_id !== 'orchestrator') orch(ev, `session ${ev.session_id} opened: ${ev.session.agent} (${ev.session.provider} · ${ev.session.model})`);
      break;

    case 'session.status':
      if (sess) sess.status = ev.status;
      break;

    case 'session.closed':
      if (sess) Object.assign(sess, ev.session);
      if (ev.session_id !== 'orchestrator') orch(ev, `session ${ev.session_id} closed (${ev.status})`);
      break;

    case 'session.message_sent':
      if (sess) {
        const t = getTurn(sess, ev.turn);
        t.prompt = ev.prompt; t.stepId = ev.step_id; t.startedAt = Date.parse(ev.ts);
        sess.turns_count = ev.turn;
        orch(ev, `→ ${ev.session_id} turn ${ev.turn} (${ev.step_id})`);
      }
      break;

    case 'session.stream':
      if (sess) {
        if (ev.item.kind === 'session' && ev.item.sessionId) sess.provider_session_id = ev.item.sessionId;
        if (ev.item.kind !== 'usage' && ev.item.kind !== 'session') getTurn(sess, ev.turn).items.push(ev.item);
      }
      break;

    case 'session.message_received':
      if (sess) {
        getTurn(sess, ev.turn).result = { usage: ev.usage, cost: ev.cost_usd, duration: ev.duration_ms };
        Object.assign(sess, ev.session);
        orch(ev, `← ${ev.session_id} replied in ${fmtDur(ev.duration_ms)}`);
      }
      if (v.run?.status === 'running') loadUsageThrottled();
      break;

    case 'step.started': {
      const s = v.steps.get(ev.step_id);
      if (s) { s.status = 'running'; s.visits = ev.visit; }
      orch(ev, `▶ step ${ev.step_id} (visit ${ev.visit})`, 'transition');
      break;
    }
    case 'step.finished': {
      const s = v.steps.get(ev.step_id);
      if (s) s.status = 'done';
      break;
    }
    case 'step.waiting': {
      const s = v.steps.get(ev.step_id);
      if (s) s.status = 'waiting';
      orch(ev, `⏳ ${ev.step_id}: /loop, next check in ${fmtDur(ev.interval_ms)}`);
      break;
    }
    case 'step.goal':
      orch(ev, `🎯 /goal ${ev.met ? 'met' : 'pending'}: ${ev.goal} (iteration ${ev.iteration})`, ev.met ? 'transition' : '');
      break;
    case 'step.transition':
      orch(ev, `${ev.from} → ${ev.to}   [${ev.when}]`, 'transition');
      break;

    case 'approval.requested': {
      v.approvals.set(ev.approval_id, ev);
      orch(ev, `? approval requested at ${ev.step_id}`, 'warn');
      // asked right away only on the Run screen of this run; elsewhere a badge and a toast say it waits
      const shown = state.view === 'run' && state.runId === ev.run_id;
      if (shown) openApproval(ev);
      else if (!window.duoShowsRun?.(ev.run_id) && !window.arenaShowsRun?.(ev.run_id) && !window.runChatShowsRun?.(ev.run_id)) {
        showToast(`Approval waiting: ${runLabel(v.run)}`, `Step ${ev.step_id}. Click to review it.`, ev.run_id, ev);
      }
      break;
    }

    case 'approval.resolved':
      v.approvals.delete(ev.approval_id);
      if (state.approval?.approval_id === ev.approval_id && state.approval.run_id === ev.run_id) closeApproval();
      if (ev.choice !== undefined) orch(ev, `human decision: ${ev.choice} (${ev.by})`, 'transition');
      else orch(ev, `approval ${ev.approved ? 'granted' : 'denied'} (${ev.by})`, ev.approved ? 'transition' : 'warn');
      break;

    case 'action.executed':
      orch(ev, `$ ${ev.command} ${ev.skipped ? '(not executed — simulation)' : `→ exit ${ev.exit_code}`}`);
      break;

    case 'limit.exceeded':
      orch(ev, `limit exceeded: ${ev.limit}`, 'error');
      break;

    case 'file.saved':
      orch(ev, `💾 ${ev.step_id}${ev.agent ? ` (${ev.agent})` : ''} saved to ${ev.path}`);
      break;

    case 'budget.exceeded':
      orch(ev, `💸 ${ev.provider} reached its monthly budget${ev.blocked ? ': turn blocked' : ' (not blocking)'}`, ev.blocked ? 'error' : 'warn');
      break;

    case 'decision.logged':
      orch(ev, `📝 ${ev.agent} logged ${ev.count} decision(s) in ${ev.path}`);
      break;

    case 'log':
      orch(ev, ev.message, ev.level);
      break;

    case 'supervisor.started':
      orch(ev, `◆ supervisor called on ${ev.step_id}: ${ev.error || 'step failed'}`, 'supervisor');
      break;

    case 'supervisor.decision': {
      const target = ev.action === 'goto' && ev.goto ? ` ${ev.goto}` : '';
      orch(ev, `◆ supervisor → ${ev.action}${target}${ev.cause_class ? ` [${ev.cause_class}]` : ''} — ${ev.explanation || ''}${ev.note ? ` (${ev.note})` : ''}`, 'supervisor');
      showToast(`◆ Supervisor on "${ev.step_id}"${liveRuns().length > 1 ? ` (${runLabel(v.run)})` : ''}: ${SUP_ACTIONS[ev.action] || ev.action}`, ev.explanation, ev.run_id);
      break;
    }
  }
  if (PROJECT_REFRESH_EVENTS.has(ev.type)) { loadProjectRunsThrottled(); loadWorkflowRunsThrottled(); }
  if (ev.type === 'workflow.finished' || ev.type === 'file.saved') loadArtifactsThrottled();
  scheduleRender();
}

const PROJECT_REFRESH_EVENTS = new Set(['workflow.started', 'workflow.finished', 'session.opened', 'session.closed', 'session.status', 'step.started']);

function orch(ev, text, level = '') {
  viewOf(ev).orchLog.push({ ts: ev.ts, text, level });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

function render() {
  renderHeader();
  if (state.view !== 'run') return;
  renderRunBanner();
  renderRunSummary();
  renderSteps();
  renderSessions();
  if (state.tab === 'detail') renderDetail();
  else renderEvents();
}

function renderTicking() {
  if (liveRuns().length) renderHeader();
  if (state.run?.status === 'running' && state.view === 'run') renderSessions();
}

function liveDuration(s) {
  if (s.closed_at) return s.duration_ms;
  return Date.now() - (s.localOpenedAt || Date.parse(s.opened_at));
}

function totals(sessions = state.sessions) {
  const t = { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, cost: 0 };
  sessions.forEach((s) => {
    for (const k of ['input', 'output', 'cache_read', 'cache_write', 'reasoning']) t[k] += s.tokens?.[k] || 0;
    t.cost += s.cost_usd || 0;
  });
  return t;
}

function renderHeader() {
  const r = state.run;
  const pill = $('#run-status');
  const st = r?.status || 'idle';
  pill.className = `pill pill-${st}`;
  pill.textContent = statusLabel(r);
  $('#run-meta').classList.toggle('clickable', !!r);
  $('#run-meta').title = r ? `View ${runLabel(r)}` : 'View the current run';
  $('#nav-run-dot').parentElement.className = `nav-item nav-run st-${runSessionStatus(st)}${state.view === 'run' ? ' active' : ''}${r ? '' : ' hidden'}`;
  renderNavRuns();
  $('#run-id').textContent = r?.id || '';
  $('#kpi-time').textContent = r ? fmtDur((r.finishedAt || Date.now()) - r.startedAt) : '—';
  $('#kpi-sessions').textContent = String([...state.sessions.keys()].filter((k) => k !== 'orchestrator').length);
  const t = totals();
  $('#kpi-tokens').textContent = `${fmtNum(t.input + t.cache_read)} / ${fmtNum(t.output)}`;
  $('#kpi-reasoning').textContent = fmtNum(t.reasoning);
  $('#kpi-cost').textContent = `$${t.cost.toFixed(4)}`;
  // several runs in progress: their total next to the selected run's numbers
  const live = liveRuns();
  const others = live.length > 1 || (live.length && !isRunLive(state.runId));
  $('#kpi-all').classList.toggle('hidden', !others);
  if (others) {
    const all = live.reduce((a, v) => { const x = totals(v.sessions); return { tokens: a.tokens + x.input + x.cache_read + x.output, cost: a.cost + x.cost }; }, { tokens: 0, cost: 0 });
    $('#kpi-all-value').textContent = `${live.length} · $${all.cost.toFixed(4)}`;
    $('#kpi-all').title = `${live.length} runs in progress: ${fmtNum(all.tokens)} tokens, $${all.cost.toFixed(4)} in total`;
  }
  $('#btn-stop').disabled = st !== 'running';
  $('#btn-stop').title = st === 'running' ? `Stop ${runLabel(r)} (only this run)` : '';
  const blocked = oneRunAtATime();
  $('#btn-start').disabled = blocked || !state.wf || !!state.wf.error;
  $('#btn-start').textContent = blocked ? 'A workflow is already running' : 'Start workflow';
  if (state.view === 'dashboard') renderDashboard();
}

// The Run menu item: the runs in progress (and the one shown), each with its status dot,
// workflow, project/issue and gates waiting; the badge counts the gates across runs.
function renderNavRuns() {
  const gates = pendingGates().length;
  const badge = $('#nav-run-gates');
  badge.classList.toggle('hidden', !gates);
  badge.textContent = String(gates);
  badge.title = `${gates} approval${gates === 1 ? '' : 's'} waiting: click to review`;
  const list = [...state.runs.values()].filter((v) => v.run && (v.run.status === 'running' || v.run.id === state.runId));
  const box = $('#nav-runs');
  const show = list.length > 1;
  box.classList.toggle('hidden', !show);
  if (!show) { box.innerHTML = ''; return; }
  const html = list.map(({ run: r, approvals }) => `<button type="button" class="nav-run-item st-${runSessionStatus(r.status)}${r.id === state.runId ? ' selected' : ''}" data-run="${esc(r.id)}" title="${esc(`${runLabel(r)} — ${statusLabel(r)}`)}">
      <span class="status-dot"></span>
      <span class="nav-run-text"><span class="nav-run-wf">${esc(r.workflow || 'workflow')}</span><span class="nav-run-sub">${esc([r.project, r.issue ? `#${r.issue.number}` : null].filter(Boolean).join(' · ') || statusLabel(r))} · ${esc(new Date(r.startedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))}</span></span>
      ${approvals.size ? `<span class="nav-gates" title="Approval waiting">${approvals.size}</span>` : ''}
    </button>`).join('');
  if (box.dataset.html === html) return;
  box.dataset.html = html;
  box.innerHTML = html;
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => selectRun(b.dataset.run)));
}

function renderRunSummary() {
  const r = state.run;
  if (!r) return;
  const inputs = Object.entries(r.inputs || {}).filter(([, v]) => v !== undefined && v !== '');
  $('#run-summary').innerHTML = `
    <div class="run-summary-name"><b>${esc(r.workflow || '')}</b>${r.version ? ` <span class="muted small">v${esc(r.version)}</span>` : ''}</div>
    ${r.project ? `<div class="small">Project: <b>${esc(r.project)}</b></div>` : ''}
    <dl class="kv">${inputs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v).length > 160 ? String(v).slice(0, 160) + '…' : v)}</dd>`).join('')}</dl>
    <button class="btn sm ghost sup-btn" id="btn-run-sup" title="Ask the AI supervisor to explain this run and suggest how to continue"><span class="sup-mark">◆</span> Ask the supervisor</button>`;
  $('#btn-run-sup').onclick = () => openSupervisorForCurrent();
}

function renderRunBanner() {
  const r = state.run;
  const box = $('#run-fail-banner');
  const show = r?.status === 'failed';
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const key = `${r.id}:${r.error || ''}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = `<div class="fail-banner-text"><b>The workflow failed</b>${r.error ? `<span class="mono small" title="${esc(r.error)}">${esc(r.error)}</span>` : ''}</div>
    <button class="btn sm sup-btn solid" id="btn-banner-sup"><span class="sup-mark">◆</span> Ask the supervisor</button>`;
  $('#btn-banner-sup').onclick = () => openSupervisorForCurrent();
}

function renderSteps() {
  $('#steps').innerHTML = [...state.steps.values()].map((s) => `
    <li class="${s.status}">
      <span class="dot"></span>
      <span>${esc(s.id)}<br><span class="kind">${s.type === 'human_approval' ? 'human approval' : esc(s.agent)}</span></span>
      <span class="visits">${s.visits ? '×' + s.visits : ''}</span>
    </li>`).join('');
}

function renderSessions() {
  const box = $('#sessions');
  if (!state.sessions.size) return;
  const list = [...state.sessions.values()];
  box.innerHTML = list.map((s) => {
    const isOrch = s.id === 'orchestrator';
    const t = s.tokens || {};
    return `
    <div class="session-card ${isOrch ? '' : 'child'} ${state.selected === s.id ? 'selected' : ''}" data-id="${esc(s.id)}">
      <div class="sc-head">
        <span class="name">${esc(s.agent)}</span>
        <span class="id">${esc(s.id)}</span>
        <span class="status st-${esc(s.status)}"><span class="status-dot"></span>${esc(s.status)}</span>
      </div>
      <div class="badges">
        <span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span>
        <span class="badge">${esc(s.model)}</span>
        ${isOrch ? '' : `<span class="badge">${s.turns || 0} turn(s)</span>`}
      </div>
      <div class="metrics">
        <div class="metric"><label>open</label><b>${fmtDur(liveDuration(s))}</b></div>
        ${isOrch ? `
        <div class="metric"><label>steps</label><b>${[...state.steps.values()].reduce((a, x) => a + x.visits, 0)}</b></div>
        <div class="metric"><label>child sessions</label><b>${list.length - 1}</b></div>
        <div class="metric"><label>total cost</label><b>${fmtCost(totals().cost)}</b></div>` : `
        <div class="metric"><label>active</label><b>${fmtDur(s.active_ms)}</b></div>
        <div class="metric"><label>in / out</label><b>${fmtNum((t.input || 0) + (t.cache_read || 0))} / ${fmtNum(t.output)}</b></div>
        <div class="metric"><label>cost</label><b>${fmtCost(s.cost_usd)}</b></div>`}
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('.session-card').forEach((el) => (el.onclick = () => {
    state.selected = el.dataset.id;
    if (state.tab !== 'detail') switchTab('detail'); else scheduleRender();
  }));
}

function detailsBlock(key, cls, label, body) {
  const open = state.openDetails.has(key);
  return `<details class="item ${cls}" data-key="${esc(key)}" ${open ? 'open' : ''}>
    <summary><div class="label">${label}</div></summary><pre>${esc(body)}</pre></details>`;
}

function renderItem(sid, turn, item, i) {
  const key = `${sid}:${turn}:${i}`;
  switch (item.kind) {
    case 'thinking': return detailsBlock(key, 'thinking', 'thinking', item.text);
    case 'text': return `<div class="item text"><div class="label">output</div><pre>${esc(item.text)}</pre></div>`;
    case 'tool_call': return `<div class="item tool_call"><div class="label">tool · ${esc(item.name)}</div><pre>${esc(typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2))}</pre></div>`;
    case 'tool_result': return detailsBlock(key, 'tool_result', `result${item.is_error ? ' (error)' : ''}`, item.output);
    case 'stderr': return `<div class="item stderr"><div class="label">stderr</div><pre>${esc(item.text)}</pre></div>`;
    case 'spawn': return `<div class="item spawn"><div class="label">process</div><pre>${esc(item.command)} ${esc(item.args.join(' '))}\ncwd: ${esc(item.cwd)}</pre></div>`;
    default: return `<div class="item raw"><div class="label">event</div><pre>${esc(item.text || JSON.stringify(item.event))}</pre></div>`;
  }
}

function renderDetail() {
  const box = $('#tab-detail');
  const s = state.sessions.get(state.selected);
  if (!s) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;

  let html = `
    <div class="detail-head">
      <h3>${esc(s.agent)} <span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span> <span class="badge">${esc(s.model)}</span></h3>
      <div class="detail-actions">
        ${termButtons('live', s.id === 'orchestrator' ? 'Follow the orchestrator log (steps, transitions, sessions, approvals) in a terminal' : 'Follow this session live in a terminal')}
        ${s.id === 'orchestrator' ? '' : termButtons('cli', '', cliBlocked(s))}
        ${s.id === 'orchestrator' ? '<button class="btn sm ghost sup-btn" data-sup><span class="sup-mark">◆</span> Ask the supervisor</button>' : ''}
        <span class="muted small" data-term-msg></span>
      </div>
      <dl class="kv">
        <dt>session</dt><dd>${esc(s.id)}</dd>
        <dt>provider session</dt><dd>${esc(s.provider_session_id || '—')}</dd>
        <dt>status</dt><dd>${esc(s.status)}</dd>
        <dt>opened at</dt><dd>${esc(timeOf(s.opened_at))}${s.closed_at ? ' → ' + esc(timeOf(s.closed_at)) : ''}</dd>
        <dt>duration / active / idle</dt><dd>${fmtDur(liveDuration(s))} / ${fmtDur(s.active_ms)} / ${fmtDur(s.idle_ms)}</dd>
        <dt>tokens</dt><dd>in ${fmtNum(s.tokens?.input)} · cache r/w ${fmtNum(s.tokens?.cache_read)}/${fmtNum(s.tokens?.cache_write)} · out ${fmtNum(s.tokens?.output)} · reasoning ${fmtNum(s.tokens?.reasoning)}</dd>
        <dt>cost</dt><dd>${fmtCost(s.cost_usd)}</dd>
      </dl>
    </div>`;

  if (s.id === 'orchestrator') {
    html += `<div class="orch-log">${state.orchLog.map((l) =>
      `<div class="line ${esc(l.level)}"><span class="ts">${esc(timeOf(l.ts))}</span><span>${esc(l.text)}</span></div>`).join('')}</div>`;
  } else {
    html += [...s.turnLog.values()].map((t) => `
      <div class="turn">
        <div class="turn-head">
          <span class="t">Turn ${t.n}</span><span class="muted">${esc(t.stepId || '')}</span>
          <span class="meta">${t.result ? `${fmtDur(t.result.duration)} · in ${fmtNum((t.result.usage?.input || 0) + (t.result.usage?.cache_read || 0))} · out ${fmtNum(t.result.usage?.output)} · ${fmtCost(t.result.cost)}` : 'in progress…'}</span>
        </div>
        <div class="turn-body">
          ${t.prompt != null ? detailsBlock(`${s.id}:${t.n}:prompt`, 'prompt', 'prompt sent', t.prompt) : ''}
          ${t.items.map((it, i) => renderItem(s.id, t.n, it, i)).join('')}
          ${t.result ? `<div class="usage-row">
              <span>input ${fmtNum(t.result.usage?.input)}</span><span>cache read ${fmtNum(t.result.usage?.cache_read)}</span>
              <span>cache write ${fmtNum(t.result.usage?.cache_write)}</span><span>output ${fmtNum(t.result.usage?.output)}</span>
              <span>reasoning ${fmtNum(t.result.usage?.reasoning)}</span></div>` : ''}
        </div>
      </div>`).join('') || '<p class="empty muted">Waiting for the first turn…</p>';
  }

  box.innerHTML = html;
  box.querySelector('[data-sup]')?.addEventListener('click', () => openSupervisorForCurrent());
  box.querySelectorAll('[data-term]').forEach((b) => (b.onclick = async () => {
    const msg = box.querySelector('[data-term-msg]');
    const r = await termAction(b, { sessionId: s.id, runId: state.run?.id, label: s.agent });
    if (msg) { msg.textContent = r.text; msg.classList.toggle('error', r.error); }
  }));
  if (atBottom) box.scrollTop = box.scrollHeight;
}

const CLI_TITLE = "Open the provider CLI resuming this conversation. Messages you send there become part of the agent's conversation.";

// "Live terminal" / "Open in CLI" (embedded in the dock) + "↗" (external window).
function termButtons(kind, title, blocked = '') {
  const label = kind === 'live' ? 'Live terminal' : 'Open in CLI';
  const t = blocked || title || (kind === 'cli' ? CLI_TITLE : 'Follow this session live in a terminal');
  const dis = blocked ? 'disabled' : '';
  return `<span class="term-btns"><button class="btn sm ghost" data-term="${kind}" ${dis} title="${esc(t)}">${label}</button><button class="btn sm ghost term-ext" data-term="${kind}" data-ext="1" ${dis} title="${esc(blocked || `${label} in an external window`)}">↗</button></span>`;
}

// Runs a terminal button: embedded tab or external window. Returns the inline message.
async function termAction(btn, { sessionId, runId, label }) {
  const kind = btn.dataset.term;
  try {
    if (btn.dataset.ext) {
      await api.openSessionTerminal(sessionId, kind, runId);
      return { text: 'Terminal opened in a new window.', error: false };
    }
    await openTerminal({ kind, sessionId, runId, label });
    return { text: '', error: false };
  } catch (e) {
    return { text: errMsg(e), error: true };
  }
}

// Why "Open in CLI" is not available for a session right now ('' = available).
function cliBlocked(s) {
  if (s.provider === 'mock') return 'Simulated sessions have no CLI conversation.';
  if (!s.provider_session_id) return 'Available after the first turn finishes.';
  if (s.status === 'active' || s.status === 'retrying') return 'The agent is in the middle of a turn.';
  return '';
}

function renderEvents() {
  const box = $('#tab-events');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = state.events.slice(-400).map((ev) => {
    const { seq, ts, type, run_id, ...rest } = ev;
    return `<div class="ev"><div class="ev-head"><span class="muted">#${seq}</span><span class="muted">${esc(timeOf(ts))}</span><span class="ev-type">${esc(type)}</span></div>
      <pre>${esc(JSON.stringify(rest, null, 1)).slice(0, 2000)}</pre></div>`;
  }).join('');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

// ---------------------------------------------------------------------------
// Artifacts: documents and files produced by runs
// ---------------------------------------------------------------------------
const ART_KIND = { markdown: ['MD', 'k-md'], json: ['{ }', 'k-json'], table: ['TSV', 'k-table'], text: ['TXT', 'k-text'], other: ['FILE', 'k-other'] };
const artKindIcon = (kind) => { const [l, c] = ART_KIND[kind] || ART_KIND.other; return `<span class="art-kind ${c}">${l}</span>`; };
function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

let artLoading = null;
let artLastLoad = 0;
let artTimer = null;
function loadArtifacts() {
  if (artLoading) return artLoading;
  const a = state.art;
  artLoading = (async () => {
    try {
      const [runs, projects] = await Promise.all([api.listArtifacts({}), state.projects.length ? state.projects : api.listProjects()]);
      a.runs = runs || [];
      state.projects = projects;
      a.error = null;
    } catch (e) {
      a.error = errMsg(e);
    }
    artLoading = null;
    artLastLoad = Date.now();
    if (state.view === 'artifacts') renderArtifacts();
  })();
  return artLoading;
}

function loadArtifactsThrottled() {
  if (artTimer || state.view !== 'artifacts') return;
  const wait = Math.max(0, 2000 - (Date.now() - artLastLoad));
  artTimer = setTimeout(() => { artTimer = null; if (state.view === 'artifacts') loadArtifacts(); }, wait);
}

// Opens the Artifacts view focused on one file (from the project view).
function openArtifactsAt({ projectId, path, mock }) {
  const a = state.art;
  a.projectId = projectId || '';
  a.q = '';
  if (mock) a.showSim = true;
  a.reveal = path; // opens the file's group once the list knows which run it belongs to
  showView('artifacts');
  selectArtifact(path);
}

function renderArtifacts() {
  const a = state.art;
  const sel = $('#art-project');
  sel.innerHTML = `<option value="">All projects</option>${state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
  sel.value = a.projectId;
  if (sel.value !== a.projectId) a.projectId = '';
  $('#art-search').value = a.q;
  $('#art-show-sim').checked = a.showSim;
  $('#art-error').textContent = a.error ? `Could not load artifacts: ${a.error}` : '';
  renderArtifactList();
  renderArtifactViewer();
}

// Simulated runs only exist for developer mode: without it they are never listed nor counted.
const artShowSim = () => devMode() && state.art.showSim;

function artifactRunsFiltered() {
  const a = state.art;
  const q = a.q.trim().toLowerCase();
  return (a.runs || [])
    .filter((r) => artShowSim() || !r.mock)
    .filter((r) => !a.projectId || r.project?.id === a.projectId)
    .map((r) => {
      if (!q) return r;
      const runHit = [r.workflow, r.task, r.project?.name].some((x) => String(x || '').toLowerCase().includes(q));
      return runHit ? r : { ...r, artifacts: r.artifacts.filter((f) => `${f.name} ${f.rel}`.toLowerCase().includes(q)) };
    })
    .filter((r) => r.artifacts.length);
}

function renderArtifactList() {
  const a = state.art;
  const box = $('#art-list');
  if (a.runs == null) { box.innerHTML = a.error ? '' : '<p class="muted small art-pad">Loading…</p>'; return; }
  const runs = artifactRunsFiltered();
  const hiddenSim = devMode() ? (a.runs || []).filter((r) => r.mock && !a.showSim).length : 0;
  if (!runs.length) {
    box.innerHTML = `<div class="art-pad muted small">${a.runs.length ? 'No artifacts match these filters.' : 'No run has produced documents or files yet.'}${hiddenSim ? `<br>${hiddenSim} simulated run${hiddenSim > 1 ? 's' : ''} hidden.` : ''}</div>`;
    return;
  }
  if (a.reveal) {
    const owner = runs.find((r) => r.artifacts.some((f) => f.path === a.reveal));
    if (owner) { setArtGroupOpen(owner.runId, true); a.reveal = null; }
  }
  const searching = !!a.q.trim();
  box.innerHTML = runs.map((r, i) => {
    const open = searching || artGroupOpen(r.runId, i === 0);
    return `
    <div class="art-run ${open ? 'open' : ''}" data-run="${esc(r.runId)}">
      <button class="art-run-head" title="${esc(r.task || '')}" aria-expanded="${open}">
        <div class="row"><span class="art-chev" aria-hidden="true">${open ? '▾' : '▸'}</span><b class="art-run-name">${esc(r.workflow || 'workflow')}</b><span class="pill pill-${esc(r.status)}">${esc(r.status)}</span>${r.mock ? '<span class="badge p-mock">simulated</span>' : ''}</div>
        <div class="muted small art-run-sub">${r.project ? `${esc(r.project.name)} · ` : ''}${r.startedAt ? esc(dateOf(r.startedAt)) : ''} · ${r.artifacts.length} file${r.artifacts.length > 1 ? 's' : ''}</div>
      </button>
      ${!open ? '' : r.artifacts.map((f) => `
        <button class="art-file ${a.sel === f.path ? 'active' : ''} ${f.exists ? '' : 'missing'}" data-path="${esc(f.path)}" title="${esc(f.path)}">
          ${artKindIcon(f.kind)}
          <span class="art-file-main">
            <span class="art-file-name">${esc(f.name)}${f.location === 'external' ? ' <span class="badge">project copy</span>' : ''}${f.exists ? '' : ' <span class="badge">deleted</span>'}</span>
            <span class="art-file-sub muted">${esc(f.rel || '')}${f.step ? ` · ${esc(f.step)}${f.agent ? ` · ${esc(f.agent)}` : ''}` : f.agent ? ` · ${esc(f.agent)}` : ''}</span>
          </span>
          <span class="art-file-size muted">${esc(fmtSize(f.size))}</span>
        </button>`).join('')}
    </div>`;
  }).join('') + (hiddenSim ? `<p class="muted small art-pad">${hiddenSim} simulated run${hiddenSim > 1 ? 's' : ''} hidden.</p>` : '');
  box.querySelectorAll('.art-file').forEach((b) => (b.onclick = () => selectArtifact(b.dataset.path)));
  box.querySelectorAll('.art-run-head').forEach((b) => (b.onclick = () => {
    if (searching) return; // every matching group is shown open while searching
    const g = b.closest('.art-run');
    setArtGroupOpen(g.dataset.run, !g.classList.contains('open'));
    renderArtifactList();
  }));
}

// Open/closed state of the run groups, remembered across restarts. Groups the user never
// toggled use the default: only the first one open.
const ART_GROUPS_KEY = 'multiagent.artifactGroups';
let artGroups = null;
function artGroupsState() {
  if (!artGroups) {
    try { artGroups = JSON.parse(localStorage.getItem(ART_GROUPS_KEY) || '{}') || {}; } catch { artGroups = {}; }
  }
  return artGroups;
}
function artGroupOpen(runId, fallback) {
  const v = artGroupsState()[runId];
  return typeof v === 'boolean' ? v : fallback;
}
function setArtGroupOpen(runId, open) {
  const g = artGroupsState();
  g[runId] = open;
  // Forget runs that no longer have artifacts so the stored map doesn't grow forever.
  if (state.art.runs) {
    const live = new Set(state.art.runs.map((r) => r.runId));
    for (const id of Object.keys(g)) if (!live.has(id)) delete g[id];
  }
  try { localStorage.setItem(ART_GROUPS_KEY, JSON.stringify(g)); } catch { /* ignore */ }
}

let artReadSeq = 0;
async function selectArtifact(path) {
  const a = state.art;
  a.sel = path;
  a.doc = { path, loading: true };
  document.querySelectorAll('.art-file').forEach((b) => b.classList.toggle('active', b.dataset.path === path));
  renderArtifactViewer();
  const seq = ++artReadSeq;
  let doc;
  try {
    doc = await api.readArtifact(path);
  } catch (e) {
    doc = { path, error: errMsg(e) };
  }
  if (seq !== artReadSeq) return; // a newer selection won
  a.doc = doc;
  if (state.view === 'artifacts') renderArtifactViewer();
}

function findArtifactMeta(path) {
  for (const r of state.art.runs || []) for (const f of r.artifacts) if (f.path === path) return f;
  return null;
}

function renderArtifactViewer() {
  const a = state.art;
  const bar = $('#art-toolbar');
  const body = $('#art-body');
  const d = a.doc;
  if (!d) {
    bar.classList.add('hidden');
    body.innerHTML = '<div class="art-empty muted">Select a file to preview it.</div>';
    return;
  }
  const meta = { ...(findArtifactMeta(d.path) || {}), ...d };
  const name = meta.name || d.path.split(/[\\/]/).pop();
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <div class="art-title">
      ${artKindIcon(meta.kind)}
      <div class="art-title-text"><b>${esc(name)}</b><span class="mono muted art-path" title="${esc(d.path)}">${esc(d.path)}</span></div>
    </div>
    ${meta.kind === 'markdown' && d.text != null ? `<div class="seg sm"><button type="button" data-mode="rendered" class="${a.mode === 'rendered' ? 'active' : ''}">Rendered</button><button type="button" data-mode="source" class="${a.mode === 'source' ? 'active' : ''}">Source</button></div>` : ''}
    <div class="row">
      <button class="btn sm ghost" data-art-act="open" ${meta.exists === false ? 'disabled' : ''}>Open</button>
      <button class="btn sm ghost" data-art-act="reveal" ${meta.exists === false ? 'disabled' : ''}>Show in folder</button>
      <button class="btn sm ghost" data-art-act="copy">Copy path</button>
    </div>
    <span class="muted small art-msg"></span>`;
  bar.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { a.mode = b.dataset.mode; renderArtifactViewer(); }));
  bar.querySelectorAll('[data-art-act]').forEach((b) => (b.onclick = async () => {
    const msg = bar.querySelector('.art-msg');
    try {
      if (b.dataset.artAct === 'open') { const err = await api.openArtifact(d.path); if (err) throw new Error(err); }
      if (b.dataset.artAct === 'reveal') await api.openArtifact(d.path, true);
      if (b.dataset.artAct === 'copy') { await api.clipboardWrite(d.path); msg.textContent = 'Path copied.'; }
    } catch (e) {
      msg.textContent = errMsg(e);
    }
  }));

  body.scrollTop = 0;
  if (d.loading) { body.innerHTML = '<div class="art-empty muted">Loading…</div>'; return; }
  if (d.error) { body.innerHTML = `<div class="art-empty"><p class="error">${esc(d.error)}</p></div>`; return; }
  const notice = d.truncated ? '<div class="art-notice">This file is larger than 5 MB: only the first 5 MB are shown.</div>' : '';
  if (d.binary || d.text == null || meta.kind === 'other') {
    body.innerHTML = `${notice}<div class="art-empty"><p class="muted">Preview not available for this file.</p><button class="btn primary" id="art-open-default">Open</button></div>`;
    $('#art-open-default').onclick = () => api.openArtifact(d.path).catch(() => {});
    return;
  }
  if (meta.kind === 'markdown' && a.mode === 'rendered') return renderMarkdownDoc(body, d.text, notice);
  if (meta.kind === 'markdown') { body.innerHTML = `${notice}<pre class="art-code">${esc(d.text)}</pre>`; return; }
  if (meta.kind === 'json') { body.innerHTML = `${notice}<pre class="art-code json">${renderJsonText(d.text, /\.jsonl$/i.test(d.path))}</pre>`; return; }
  if (meta.kind === 'table') { body.innerHTML = `${notice}${renderDelimited(d.text, /\.csv$/i.test(d.path) ? ',' : '\t')}`; return; }
  body.innerHTML = `${notice}<pre class="art-code">${esc(d.text)}</pre>`;
}

// ---- markdown ----
let mdHooked = false;
function sanitizeHtml(html) {
  if (!mdHooked) {
    mdHooked = true;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.getAttribute('href') && !node.getAttribute('href').startsWith('#')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  return DOMPurify.sanitize(html);
}

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

// Sanitized markdown -> HTML string (escaped text when the libraries are missing).
function markdownHtml(text) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') return `<pre class="art-code">${esc(text)}</pre>`;
  const tmp = document.createElement('div');
  tmp.innerHTML = sanitizeHtml(marked.parse(String(text || ''), { gfm: true }));
  // wide tables scroll on their own
  tmp.querySelectorAll('table').forEach((t) => { const w = document.createElement('div'); w.className = 'md-table'; t.replaceWith(w); w.appendChild(t); });
  return tmp.innerHTML;
}

function renderMarkdownDoc(body, text, notice) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    body.innerHTML = `${notice}<pre class="art-code">${esc(text)}</pre>`;
    return;
  }
  body.innerHTML = `${notice}<div class="md-wrap"><nav class="md-toc hidden"></nav><article class="md"></article></div>`;
  const doc = body.querySelector('.md');
  doc.innerHTML = markdownHtml(text);
  const used = new Set();
  const heads = [...doc.querySelectorAll('h1, h2, h3, h4')];
  heads.forEach((h) => {
    let id = slugify(h.textContent) || 'section';
    for (let i = 2; used.has(id); i++) id = `${slugify(h.textContent)}-${i}`;
    used.add(id);
    h.id = id;
  });
  const scrollTo = (id) => { const el = doc.querySelector(`[id="${CSS.escape(id)}"]`); if (el) body.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' }); };
  doc.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    e.preventDefault();
    scrollTo(decodeURIComponent(link.getAttribute('href').slice(1)));
  });
  const tocItems = heads.filter((h) => h.tagName === 'H2' || h.tagName === 'H3');
  if (heads.length >= 4 && tocItems.length) {
    const toc = body.querySelector('.md-toc');
    toc.classList.remove('hidden');
    toc.innerHTML = `<div class="md-toc-title">Contents</div>${tocItems.map((h) =>
      `<a href="#" class="${h.tagName === 'H3' ? 'sub' : ''}" data-id="${esc(h.id)}">${esc(h.textContent)}</a>`).join('')}`;
    toc.querySelectorAll('[data-id]').forEach((l) => (l.onclick = (e) => { e.preventDefault(); scrollTo(l.dataset.id); }));
  }
}

// ---- JSON ----
function highlightJson(src) {
  const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    if (m[1]) out += m[2] ? `<span class="j-key">${esc(m[1])}</span>${esc(m[2])}` : `<span class="j-str">${esc(m[1])}</span>`;
    else if (m[3]) out += `<span class="j-${m[3] === 'null' ? 'null' : 'bool'}">${m[3]}</span>`;
    else out += `<span class="j-num">${m[4]}</span>`;
    last = re.lastIndex;
  }
  return out + esc(src.slice(last));
}

function renderJsonText(text, lines) {
  if (lines) {
    return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
      try { return highlightJson(JSON.stringify(JSON.parse(l), null, 2)); } catch { return esc(l); }
    }).join('\n<span class="j-sep"></span>\n');
  }
  try { return highlightJson(JSON.stringify(JSON.parse(text), null, 2)); } catch { return esc(text); }
}

// ---- TSV / CSV ----
function parseDelimited(text, sep) {
  const rows = [];
  if (sep === '\t') return text.split(/\r?\n/).filter((l) => l.length).map((l) => l.split('\t'));
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function renderDelimited(text, sep) {
  const rows = parseDelimited(text, sep);
  if (!rows.length) return '<div class="art-empty muted">Empty file.</div>';
  const MAX = 2000;
  const [head, ...rest] = rows;
  return `<div class="md-table art-table"><table>
    <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rest.slice(0, MAX).map((r) => `<tr>${head.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>${rest.length > MAX ? `<p class="muted small art-pad">Showing the first ${MAX} of ${rest.length} rows.</p>` : ''}`;
}

// ---------------------------------------------------------------------------
// AI supervisor: analysis of a run, resume from a step, chat
// ---------------------------------------------------------------------------
const SUP_ACTIONS = { retry: 'retry the step', fix_output: 'fix the output', goto: 'go to another step', ask_human: 'ask you', fail: 'stop the run' };

function openSupervisorForCurrent() {
  const r = state.run;
  if (!r) return;
  openSupervisor({ runId: r.id, workflow: r.workflow, status: r.status, error: r.error, mock: r.mock });
}

function openSupervisor(run) {
  const sup = state.sup;
  if (sup.runId !== run.runId) {
    Object.assign(sup, { runId: run.runId, question: '', loading: false, result: null, error: null, recMsgs: {} });
  }
  Object.assign(sup, { workflow: run.workflow, status: run.status, runError: run.error, mock: !!run.mock });
  $('#sup-question').value = sup.question;
  $('#sup-chat-msg').textContent = '';
  $('#sup-drawer').classList.add('open');
  $('#sup-drawer').setAttribute('aria-hidden', 'false');
  $('#sup-backdrop').classList.remove('hidden');
  renderSupervisor();
  setTimeout(() => $('#sup-question').focus(), 200);
}

function closeSupervisor() {
  $('#sup-drawer').classList.remove('open');
  $('#sup-drawer').setAttribute('aria-hidden', 'true');
  $('#sup-backdrop').classList.add('hidden');
}

async function analyzeRun() {
  const sup = state.sup;
  if (!sup.runId || sup.loading) return;
  const runId = sup.runId;
  Object.assign(sup, { loading: true, error: null, recMsgs: {} });
  renderSupervisor();
  try {
    const res = await api.askSupervisor(runId, sup.question.trim() || undefined);
    if (sup.runId !== runId) return;
    sup.result = res;
  } catch (e) {
    if (sup.runId !== runId) return;
    sup.error = errMsg(e);
  } finally {
    if (sup.runId === runId) sup.loading = false;
  }
  renderSupervisor();
}

async function supervisorChat() {
  const msg = $('#sup-chat-msg');
  msg.textContent = '';
  msg.classList.remove('error');
  try {
    await openTerminal({ kind: 'supervisor', runId: state.sup.runId, label: 'supervisor' });
  } catch (e) {
    msg.textContent = errMsg(e);
    msg.classList.add('error');
  }
}

function renderSupervisor() {
  const sup = state.sup;
  $('#sup-run').innerHTML = `<span class="mono">${esc(sup.runId || '')}</span>${sup.workflow ? ` · ${esc(sup.workflow)}` : ''}${sup.status ? ` <span class="pill pill-${esc(sup.status)}">${esc(sup.status)}</span>` : ''}${sup.mock ? ' <span class="badge p-mock">simulated</span>' : ''}`;
  $('#btn-sup-analyze').disabled = sup.loading;
  $('#btn-sup-analyze').textContent = sup.result ? 'Analyze again' : 'Analyze';
  const box = $('#sup-result');
  if (sup.loading) {
    box.innerHTML = '<div class="sup-loading"><span class="spinner"></span><span>The supervisor is reading the run… (this can take a minute)</span></div>';
    return;
  }
  if (sup.error) { box.innerHTML = `<p class="error small">${esc(sup.error)}</p>`; return; }
  const res = sup.result;
  if (!res) {
    box.innerHTML = `${sup.runError ? `<div class="sup-runerror"><div class="sup-h">Error</div><pre>${esc(sup.runError)}</pre></div>` : ''}
      <p class="muted small">The supervisor reads the run's events, outputs and logs, explains what happened and suggests how to continue. You can also chat with it in a terminal.</p>`;
    return;
  }
  const a = res.analysis || {};
  const steps = res.steps || [];
  const recs = a.recommendations || [];
  box.innerHTML = `
    <div class="sup-meta muted small">
      <span>${esc(res.model || 'supervisor')}${res.costUsd != null ? ` · ${esc(fmtCost(res.costUsd))}` : ''}</span>
      ${res.artifactPath ? '<button class="link-btn small" id="sup-open-art">Open in Artifacts</button>' : ''}
    </div>
    <section class="sup-sec"><div class="sup-h">What happened</div><div class="md md-compact">${markdownHtml(a.summary || '_No summary._')}</div></section>
    ${a.root_cause ? `<section class="sup-sec"><div class="sup-h">Root cause</div><div class="md md-compact">${markdownHtml(a.root_cause)}</div></section>` : ''}
    ${recs.length ? `<section class="sup-sec"><div class="sup-h">Recommendations</div>${recs.map((r, i) => recCard(r, i, steps)).join('')}</section>` : ''}`;
  $('#sup-open-art')?.addEventListener('click', () => {
    closeSupervisor();
    openArtifactsAt({ projectId: '', path: res.artifactPath, mock: sup.mock });
    loadArtifacts().then(() => renderArtifactList());
  });
  box.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => runRecommendation(Number(b.dataset.rec))));
}

function recCard(r, i, steps) {
  const m = state.sup.recMsgs[i];
  const msg = m ? `<span class="small ${m.error ? 'error' : 'muted'}">${esc(m.text)}</span>` : '';
  let ctrl = '';
  if (r.action === 'resume') {
    const pre = steps.includes(r.step) ? r.step : steps[0];
    ctrl = `<div class="field"><label for="rec-step-${i}">Resume from step</label>
        <select id="rec-step-${i}">${steps.map((s) => `<option ${s === pre ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div class="field"><label for="rec-ins-${i}">Instruction for the agents</label>
        <textarea id="rec-ins-${i}" rows="4">${esc(r.instruction || '')}</textarea></div>
      <div class="row"><button class="btn sm primary" data-rec="${i}">Resume from this step</button>${msg}</div>`;
  } else if (r.action === 'rerun') {
    ctrl = `${r.instruction ? `<p class="small muted sup-ins">${esc(r.instruction)}</p>` : ''}<div class="row"><button class="btn sm" data-rec="${i}">Run again</button>${msg}</div>`;
  } else if (r.instruction) {
    ctrl = `<p class="small muted sup-ins">${esc(r.instruction)}</p>`;
  }
  const tag = { resume: 'resume', rerun: 'run again', none: 'advice' }[r.action] || r.action;
  return `<div class="sup-rec"><div class="sup-rec-head"><b>${esc(r.title || 'Recommendation')}</b><span class="badge">${esc(tag)}</span></div>${ctrl}</div>`;
}

async function runRecommendation(i) {
  const sup = state.sup;
  const res = sup.result;
  const r = res?.analysis?.recommendations?.[i];
  if (!r) return;
  const steps = res.steps || [];
  const step = r.action === 'resume' ? $(`#rec-step-${i}`).value : steps[0];
  const instruction = r.action === 'resume' ? $(`#rec-ins-${i}`).value.trim() : r.instruction || '';
  const btn = document.querySelector(`[data-rec="${i}"]`);
  if (btn) btn.disabled = true;
  sup.recMsgs[i] = { text: 'Starting…', error: false };
  try {
    await api.resumeRun(sup.runId, step, instruction || undefined);
    sup.recMsgs = {};
    closeSupervisor();
    showView('run');
  } catch (e) {
    sup.recMsgs[i] = { text: errMsg(e), error: true };
    renderSupervisor();
  }
}

let toastTimer = null;
// runId: the run it is about (a click shows it); gate: an approval.requested event to open.
function showToast(title, detail, runId = null, gate = null) {
  const el = $('#toast');
  el.innerHTML = `<b>${esc(title)}</b>${detail ? `<span>${esc(String(detail).slice(0, 220))}</span>` : ''}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), gate ? 15000 : 7000);
  el.onclick = () => {
    el.classList.add('hidden');
    if (runId && state.runs.has(runId)) selectRun(runId);
    else if (state.run) showView('run');
    if (gate && state.runs.get(gate.run_id)?.approvals.has(gate.approval_id)) openApproval(gate);
  };
}

// ---------------------------------------------------------------------------
// Terminal dock (xterm tabs; the process lives in the main process)
// ---------------------------------------------------------------------------
const TERM_HEIGHT_KEY = 'multiagent.termHeight';
const IS_MAC = (api.platform || navigator.platform || '').toLowerCase().startsWith('mac') || api.platform === 'darwin';
const isOrchSession = (s) => s.id === 'orchestrator' || s.agent === 'orchestrator';
const dock = {
  tabs: [],            // { key, id, kind, runId, sessionId, title, term, fit, pane, exited, lastPaste }
  active: null,
  collapsed: false,
  pending: new Map(),  // backend id -> [{ data } | { exitCode }] received before term:open resolved
};

function initTerminalDock() {
  let h = 280;
  try { h = Number(localStorage.getItem(TERM_HEIGHT_KEY)) || h; } catch { /* ignore */ }
  setDockHeight(h, false);
  $('#btn-term-collapse').onclick = () => setDockCollapsed(!dock.collapsed);
  $('#btn-term-popout').onclick = popOutActive;

  // drag handle
  $('#term-resize').addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (dock.collapsed) setDockCollapsed(false);
    const startY = e.clientY, startH = $('#term-dock').getBoundingClientRect().height;
    document.body.classList.add('resizing-dock');
    const move = (ev) => setDockHeight(startH + (startY - ev.clientY), false);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing-dock');
      setDockHeight($('#term-dock').getBoundingClientRect().height, true);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // terminals live in the dock or in the Sessions screen (sessions.js)
  const findTab = (id) => dock.tabs.find((x) => x.id === id) || window.SessionsView?.findTab(id);
  api.onTermData?.(({ id, data }) => {
    const t = findTab(id);
    if (t) t.term.write(data);
    else queuePending(id, { data });
  });
  api.onTermExit?.(({ id, exitCode }) => {
    const t = findTab(id);
    if (t) markExited(t, exitCode);
    else queuePending(id, { exitCode });
  });

  window.addEventListener('resize', () => { setDockHeight(dock.height, false); fitActive(); });
  if (window.ResizeObserver) new ResizeObserver(() => fitActive()).observe($('#term-body'));
}

function queuePending(id, item) {
  if (!dock.pending.has(id)) dock.pending.set(id, []);
  dock.pending.get(id).push(item);
  if (dock.pending.size > 50) dock.pending.delete(dock.pending.keys().next().value);
}

function setDockHeight(h, persist) {
  const max = Math.round(window.innerHeight * 0.7);
  dock.height = Math.max(120, Math.min(max, Math.round(h)));
  $('#term-dock').style.height = dock.collapsed ? '' : `${dock.height}px`;
  if (persist) { try { localStorage.setItem(TERM_HEIGHT_KEY, String(dock.height)); } catch { /* ignore */ } }
}

function setDockCollapsed(c) {
  dock.collapsed = c;
  $('#term-dock').classList.toggle('collapsed', c);
  $('#btn-term-collapse').title = c ? 'Expand the terminal panel' : 'Collapse the terminal panel';
  setDockHeight(dock.height, false);
  if (!c) requestAnimationFrame(() => { fitActive(); dock.active?.term.focus(); });
}

function xtermTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
  const accent = v('--accent', '#7c9cff');
  const m = /^#([0-9a-f]{6})$/i.exec(accent);
  const sel = m ? `rgba(${parseInt(m[1].slice(0, 2), 16)},${parseInt(m[1].slice(2, 4), 16)},${parseInt(m[1].slice(4, 6), 16)},0.35)` : 'rgba(124,156,255,0.35)';
  return {
    background: v('--bg', '#0e1014'),
    foreground: v('--text', '#e6e8ee'),
    cursor: accent,
    cursorAccent: v('--bg', '#0e1014'),
    selectionBackground: sel,
  };
}

// Opens (or focuses) an embedded terminal. Throws with a readable message on failure.
async function openTerminal({ kind, sessionId, runId, label }) {
  if (typeof Terminal === 'undefined') throw new Error('The terminal component failed to load.');
  runId = runId || state.run?.id;
  const key = `${kind}:${runId || 'current'}:${sessionId}`;
  const existing = dock.tabs.find((t) => t.key === key);
  if (existing) { showDock(); activateTab(existing); return existing; }

  const pane = document.createElement('div');
  pane.className = 'term-pane';
  $('#term-body').appendChild(pane);
  const { term, fit } = createXterm(kind);
  const tab = { key, id: null, kind, runId, sessionId, title: `${label || sessionId} · ${kind}`, term, fit, pane, exited: false, lastPaste: 0, sent: 0 };
  dock.tabs.push(tab);
  showDock();
  term.open(pane);
  wireTerminal(tab);
  activateTab(tab);

  try {
    const res = await api.termOpen({ kind, runId, sessionId, cols: term.cols, rows: term.rows });
    tab.id = res.id;
    if (res.windowsPty) term.options.windowsPty = res.windowsPty;
    if (res.title) tab.title = res.title;
    renderTermTabs();
    replayPending(tab);
    fitActive();
    return tab;
  } catch (e) {
    closeTab(tab, { kill: false });
    throw e;
  }
}

// What arrived for a terminal before term:open answered with its id.
function replayPending(tab) {
  for (const item of dock.pending.get(tab.id) || []) {
    if ('data' in item) tab.term.write(item.data);
    else markExited(tab, item.exitCode);
  }
  dock.pending.delete(tab.id);
}

// An xterm with the app's theme and a fit addon (not opened yet). Live terminals are read-only.
function createXterm(kind) {
  const css = getComputedStyle(document.documentElement);
  const term = new Terminal({
    theme: xtermTheme(),
    fontFamily: css.getPropertyValue('--mono').trim() || 'Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.2,
    cursorBlink: kind !== 'live',
    cursorStyle: kind === 'live' ? 'underline' : 'block',
    cursorInactiveStyle: 'none',
    scrollback: 5000,
    convertEol: false,
    allowProposedApi: false,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  return { term, fit };
}

function wireTerminal(tab) {
  const { term, pane } = tab;
  term.onData((d) => {
    if (tab.kind === 'live' || tab.exited || !tab.id) return; // live tabs are read-only
    tab.sent++;
    api.termInput(tab.id, d);
  });
  // One resize after the size settles: every resize makes a full-screen CLI redraw, and dragging
  // the window or the dock produces dozens.
  let resizeTimer = null;
  term.onResize(({ cols, rows }) => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (tab.id && !tab.exited) api.termResize(tab.id, cols, rows); }, 120);
  });
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'c' && (e.shiftKey || term.hasSelection())) {
      e.preventDefault();
      copyFromTerm(tab);
      return false;
    }
    if ((mod && k === 'v') || (e.shiftKey && e.key === 'Insert')) {
      e.preventDefault();
      pasteIntoTerm(tab);
      return false;
    }
    return true;
  });
  // The keyboard path above does the paste; swallow the browser's native paste event so it
  // never pastes a second time. A paste that did not come from our key handler (e.g. an Edit
  // menu accelerator) is handled here instead, once.
  pane.addEventListener('paste', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (Date.now() - tab.lastPaste < 800) return;
    const text = e.clipboardData?.getData('text/plain');
    if (text) { tab.lastPaste = Date.now(); term.paste(text); }
  }, true);
  pane.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (term.hasSelection()) copyFromTerm(tab);
    else pasteIntoTerm(tab);
  });
  pane.addEventListener('mousedown', () => (tab.onFocus ? tab.onFocus() : activateTab(tab)));
}

async function copyFromTerm(tab) {
  const text = tab.term.getSelection();
  if (!text) return;
  tab.term.clearSelection();
  const flash = tab.flash || flashTermMsg;
  try { await api.clipboardWrite(text); flash('Copied.'); } catch (e) { flash(errMsg(e), true); }
}

async function pasteIntoTerm(tab) {
  tab.lastPaste = Date.now();
  try {
    const text = await api.clipboardRead();
    tab.lastPaste = Date.now();
    if (!text) return;
    if (tab.kind === 'live') (tab.flash || flashTermMsg)('This terminal is read-only.');
    tab.term.paste(text); // onData ignores it for live tabs
  } catch (e) {
    (tab.flash || flashTermMsg)(errMsg(e), true);
  }
}

let termMsgTimer = null;
function flashTermMsg(text, error = false) {
  const el = $('#term-msg');
  el.textContent = text;
  el.classList.toggle('error', error);
  clearTimeout(termMsgTimer);
  termMsgTimer = setTimeout(() => (el.textContent = ''), 2500);
}

function markExited(tab, exitCode) {
  if (tab.exited) return;
  tab.exited = true;
  tab.term.write(`\r\n\x1b[90m[process exited with code ${exitCode ?? '?'}]\x1b[0m\r\n`);
  if (tab.onChange) tab.onChange();
  else renderTermTabs();
}

function showDock() {
  $('#term-dock').classList.remove('hidden');
  if (dock.collapsed) setDockCollapsed(false);
}

function activateTab(tab) {
  if (dock.active === tab && tab.pane.classList.contains('active')) return;
  dock.active = tab;
  dock.tabs.forEach((t) => t.pane.classList.toggle('active', t === tab));
  renderTermTabs();
  requestAnimationFrame(() => { fitActive(); tab.term.focus(); });
}

function fitActive() {
  const t = dock.active;
  if (!t || dock.collapsed || $('#term-dock').classList.contains('hidden')) return;
  try { t.fit.fit(); } catch { /* not visible yet */ }
}

function closeTab(tab, { kill = true } = {}) {
  const i = dock.tabs.indexOf(tab);
  if (i < 0) return;
  if (kill && tab.id && !tab.exited) api.termKill(tab.id).catch(() => {});
  dock.tabs.splice(i, 1);
  tab.term.dispose();
  tab.pane.remove();
  if (dock.active === tab) {
    dock.active = null;
    const next = dock.tabs[i] || dock.tabs[i - 1];
    if (next) activateTab(next);
  }
  if (!dock.tabs.length) $('#term-dock').classList.add('hidden');
  renderTermTabs();
}

function renderTermTabs() {
  const box = $('#term-tabs');
  box.innerHTML = dock.tabs.map((t, i) => `
    <div class="term-tab ${t === dock.active ? 'active' : ''}" data-i="${i}" role="tab" aria-selected="${t === dock.active}" title="${esc(t.title)}${t.kind === 'live' ? ' (read-only)' : ''}">
      <span class="term-dot ${t.exited ? 'exited' : t.id ? 'running' : 'starting'}"></span>
      <span class="term-title">${esc(t.title)}</span>
      <button class="term-close" data-close="${i}" title="Close (ends the process)" aria-label="Close">×</button>
    </div>`).join('');
  box.querySelectorAll('.term-tab').forEach((el) => (el.onclick = (e) => {
    const t = dock.tabs[Number(el.dataset.i)];
    if (e.target.closest('[data-close]')) closeTab(t);
    else activateTab(t);
  }));
  box.querySelectorAll('.term-tab').forEach((el) => (el.onauxclick = (e) => { if (e.button === 1) closeTab(dock.tabs[Number(el.dataset.i)]); }));
  $('#btn-term-popout').disabled = !dock.active || dock.active.kind === 'supervisor';
}

async function popOutActive() {
  const t = dock.active;
  if (!t) return;
  try {
    await api.openSessionTerminal(t.sessionId, t.kind, t.runId);
    flashTermMsg('Opened in an external window.');
  } catch (e) {
    flashTermMsg(errMsg(e), true);
  }
}

// ---------------------------------------------------------------------------
// Account: sign-in screen and the trial chip in the top bar
// ---------------------------------------------------------------------------
function initAccount() {
  $('#account-btn').onclick = () => {
    const open = $('#account-pop').classList.toggle('hidden') === false;
    $('#account-btn').setAttribute('aria-expanded', String(open));
  };
  document.addEventListener('mousedown', (e) => {
    if (!$('#account-pop').classList.contains('hidden') && !e.target.closest('.account-wrap')) $('#account-pop').classList.add('hidden');
  });
  $('#btn-sign-out').onclick = async () => {
    $('#account-pop').classList.add('hidden');
    renderAccount(await api.signOut());
  };
  $('#btn-login-cancel').onclick = () => api.cancelSignIn();
  api.onAuthChange(renderAccount);
  api.authState().then(renderAccount);
}

async function signIn(provider) {
  $('#login-error').textContent = '';
  try {
    renderAccount(await api.signIn(provider));
  } catch (e) {
    const msg = errMsg(e);
    if (msg !== 'Sign-in cancelled.') $('#login-error').textContent = msg;
  }
}

function trialLabel(ent) {
  if (!ent) return { text: '…', cls: 'pill-idle' };
  if (ent.error) return { text: 'Account unavailable', cls: 'pill-trial-ended' };
  if (ent.plan === 'pro') return { text: 'Pro', cls: 'pill-pro' };
  if (!ent.active) return { text: 'Trial ended', cls: 'pill-trial-ended' };
  const days = ent.daysLeft === 1 ? '1 day' : `${ent.daysLeft} days`;
  return { text: `Trial · ${days} left`, cls: ent.daysLeft <= 2 ? 'pill-trial-low' : 'pill-trial' };
}

function renderAccount(s) {
  if (!s) return;
  state.account = s;
  // sign-in screen: when runs need an account and nobody is signed in
  const needsLogin = s.required && !s.user;
  $('#login-screen').classList.toggle('hidden', !needsLogin);
  $('#login-waiting').classList.toggle('hidden', !s.signingIn);
  $('#login-providers').innerHTML = s.providers.map((p) => `<button class="btn ${p.enabled ? '' : 'ghost'}" type="button" data-provider="${esc(p.id)}" ${p.enabled && !s.signingIn ? '' : 'disabled'}>Continue with ${esc(p.name)}${p.enabled ? '' : ' <span class="soon">coming soon</span>'}</button>`).join('');
  $('#login-providers').querySelectorAll('[data-provider]').forEach((b) => (b.onclick = () => signIn(b.dataset.provider)));
  if (needsLogin && !s.configured) $('#login-error').textContent = 'Sign-in is not configured in this build.';

  // top bar chip
  $('#account-wrap').classList.toggle('hidden', !s.user);
  if (!s.user) return;
  const ent = s.entitlement;
  const label = trialLabel(ent);
  $('#account-avatar').textContent = (s.user.name || s.user.email || '?').trim()[0].toUpperCase();
  $('#account-trial').textContent = label.text;
  $('#account-trial').className = `pill ${label.cls}`;
  $('#account-btn').title = s.user.email || '';
  $('#account-name').textContent = s.user.name || s.user.email || 'Signed in';
  $('#account-email').textContent = s.user.name ? s.user.email || '' : '';
  $('#account-plan').textContent = !ent ? 'Checking your subscription…'
    : ent.error ? ent.error
    : ent.plan === 'pro' ? 'Pro plan.'
    : ent.active ? `Free trial until ${new Date(ent.trialEndsAt).toLocaleString()}.${ent.offline ? ' (offline: last check)' : ''}`
    : 'Your free trial has ended. You can still browse your projects, runs and artifacts; simulations still run.';
}

init();
