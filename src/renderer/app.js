/* global api */
// The UI shell: navigation, the Run screen (steps, sessions, events, the gate card), the
// dashboard, the start drawer, Projects, Workflows › Runs, the usage widget, the terminal dock and toasts.
// Each run the window knows is a view rebuilt from its events (`state.runs`); the runs in progress
// and the gates they wait at come from the engine (`loadActiveRuns` over runs:active, on load,
// focus, reconnect and after run events), so the sidebar's "waiting for you" survives a reload.
// Other screens live in their own files (backlog.js, sessions.js, run-chat.js, duo.js, arena.js…)
// or in a folder of views/ that registers itself (view-registry.js): Settings, Usage.
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
const RUN_VIEW_KEY = 'multiagent.runView';
// A channel or method the running main process (or server) doesn't have: the code on disk is newer
// than the process (#83). The error says so and the restart banner shows.
const NEEDS_RESTART = 'This feature needs an app restart (the app was updated while running).';
const missingChannel = (msg) => /No handler registered for '|Unknown channel: |\bapi\.\w+ is not a function/.test(msg);
const errMsg = (e) => {
  const msg = String(e?.message || e);
  if (missingChannel(msg)) { window.showCodeBanner?.(); return NEEDS_RESTART; }
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
};

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
  tab: 'detail',
  workflowsTab: 'runs', // 'runs' | 'definitions' | 'builder' (sub-items of Workflows in the sidebar)
  pendingProject: null, // project to preselect in the panel on open
  usage: null,        // last api.getUsage() result
  usageError: null,
  actionsUsage: null, // last api.getActionsUsage() result (GitHub Actions minutes)
  art: { runs: null, error: null, projectId: "", q: "", showSim: false, sel: null, doc: null, mode: "rendered", reveal: null },
  sup: { runId: null, question: '', loading: false, result: null, error: null, recMsgs: {}, watch: null, watchError: null }, // supervisor panel
  pv: null,           // project detail view: { id, project, runs, error, filter, showSim, expanded, msgs }
  wr: { runs: null, error: null, filter: 'all', showSim: false, expanded: new Set(), msgs: new Map() }, // Workflows > Runs
  usageScope: (() => { try { return localStorage.getItem(USAGE_SCOPE_KEY) === 'machine' ? 'machine' : 'orchestrator'; } catch { return 'orchestrator'; } })(),
  // how runs open: 'details' (the Run screen) or 'chat' (the run chat), the last one the owner picked
  runView: (() => { try { return localStorage.getItem(RUN_VIEW_KEY) === 'chat' ? 'chat' : 'details'; } catch { return 'details'; } })(),
};

// What the window knows of one run, rebuilt from its events.
//   run: { id, status, startedAt, finishedAt, mock, workflow, project, issue, inputs }
//   sessions: id -> { ...snapshot, turnLog: Map, localOpenedAt }; steps: id -> { id, type, agent, visits, status }
//   approvals: approval id -> approval.requested event (gates waiting)
//   trail: RunProgress.StepTrail from workflow.started on (null for a run picked up mid-way),
//   groups: the workflow's `groups:`, openGroups: group name -> open, as toggled in the sidebar
const newRunView = () => ({
  run: null, sessions: new Map(), steps: new Map(), orchLog: [], events: [], selected: null, openDetails: new Set(), approvals: new Map(),
  trail: null, groups: [], openGroups: new Map(), allSteps: false,
});
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
// The issues a run implements (Backlog; several for a group) and their "#53, #65" label. Runs
// recorded before groups have a single `issue`.
const issuesOfRun = (r) => r?.issues || (r?.issue ? [r.issue] : []);
const issueRefs = (r) => issuesOfRun(r).map((i) => `#${i.number}`).join(', ');
const runLabel = (r) => [r?.workflow || 'workflow', r?.project, issueRefs(r) || null].filter(Boolean).join(' · ');

// Shows a run in the top bar and, with `open`, opens it in the remembered run view (showRun).
function selectRun(runId, { open = true } = {}) {
  if (!state.runs.has(runId)) return;
  state.runId = runId;
  if (open) showRun(runId);
  scheduleRender();
}

// The Chat / Details choice, global and saved per window: set by the toggles and "Open chat".
function setRunView(view) {
  state.runView = view === 'chat' ? 'chat' : 'details';
  try { localStorage.setItem(RUN_VIEW_KEY, state.runView); } catch { /* storage unavailable */ }
}

// Opens a run the way runs were last looked at: its chat (Write & Review and AI Arena runs their
// own chat screens), or its Run screen, or Workflows › Runs for a past run this window does not
// follow. `running`: a run just started (resumed) whose first event may not be here yet.
function showRun(runId, { workflow, running } = {}) {
  const v = state.runs.get(runId);
  if (v) state.runId = runId;
  const live = running ?? isRunLive(runId);
  if (state.runView === 'chat' && window.openRunChat) {
    window.openRunChat({ runId, workflow: workflow || v?.run?.workflow, running: live });
  } else if (v || live) {
    showView('run');
  } else {
    showRunInList(runId);
  }
  scheduleRender();
}
window.showRun = showRun;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
async function init() {
  // top bar
  $('#btn-stop').onclick = stopRun;
  $('#btn-open-dir').onclick = () => api.openRunDir(state.run?.id);
  $('#btn-quick-start').onclick = () => openDrawer();
  $('#run-meta').onclick = () => state.run && selectRun(state.run.id);
  $('#nav-run-gates').onclick = (e) => { e.stopPropagation(); openNextGate(); };

  // navigation (delegated: views/ add their sidebar entries with registerView after this runs)
  $('nav.sidebar').addEventListener('click', (e) => {
    const b = e.target.closest('.nav-item');
    if (!b) return;
    // Workflows opens on Runs; Definitions and Builder are its sub-items
    if (b.dataset.view === 'workflows') state.workflowsTab = 'runs';
    // the Run item opens the run shown in the top bar in the remembered view
    if (b.dataset.view === 'run' && state.runs.has(state.runId)) { selectRun(state.runId); return; }
    showView(b.dataset.view);
  });
  document.querySelectorAll('.dash-card').forEach((b) => (b.onclick = () => openDrawer({ category: b.dataset.category })));
  refreshUnpushed();

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
    if (!$('#wb-skills-modal').classList.contains('hidden')) return $('#btn-wb-skills-cancel').click();
    if (!$('#wb-agents-modal').classList.contains('hidden')) return $('#btn-wb-agents-cancel').click();
    if (!$('#drawer').classList.contains('open')) return;
    closeDrawer();
  });

  // run
  $('#run-gates').onclick = onRunGateClick;
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
  $('#sup-watch-on').onchange = (e) => setWatch(e.target.checked);
  $('#sup-watch-model').onchange = (e) => { const [provider, model] = e.target.value.split('|'); saveWatchPick({ provider, model }); };
  $('#sup-watch-effort').onclick = (e) => {
    const b = e.target.closest('[data-effort]');
    if (b && !b.disabled) { saveWatchPick({ effort: b.dataset.effort }); renderWatch(); }
  };
  $('#btn-sup-watch-ask').onclick = askWatch;
  $('#sup-watch-q').onkeydown = (e) => { if (e.key === 'Enter') askWatch(); };

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
  document.querySelectorAll('[data-wtab]').forEach((b) => (b.onclick = () => { state.workflowsTab = b.dataset.wtab; showView('workflows'); }));
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
  document.querySelectorAll('[data-scope]').forEach((b) => (b.onclick = () => setUsageScope(b.dataset.scope)));
  renderScopeToggles();

  api.onEvent(onEvent);
  api.onWatch(onWatch);
  initNotifications();
  initTerminalDock();
  initFullTextPopover();
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
  initCodeBanner();
  renderDashboard();

  const env = await api.checkEnv();
  $('#env-status').innerHTML = ['claude', 'codex'].map((k) =>
    env[k] ? `<span class="ok">✓ ${k}</span>`
           : `<span class="missing">✗ ${k} not found in PATH (use simulation mode)</span>`).join('');
}

// The runs in progress and the gates they wait at, from the engine (runs:active): read when the
// window loads or reloads, when it regains focus, when the browser UI's connection comes back and
// after run events. The engine is the source of truth for gates: a gate is shown until the engine
// no longer lists it, never only because its event was seen live (a reload loses those). Runs not
// seen yet are listed in the Run menu from the start; their details are replayed from their
// recorded events. A run this window thought was running that the engine no longer has (an app or
// server restart) shows as interrupted, with no gate.
async function loadActiveRuns() {
  let list = null;
  try { list = await api.listActiveRuns?.(); } catch { return; }
  if (!Array.isArray(list)) return;
  const live = new Set(list.map((a) => a.runId));
  for (const a of list) {
    let v = state.runs.get(a.runId);
    if (!v) {
      v = newRunView();
      v.run = { ...runInfo(a), status: 'running' };
      state.runs.set(a.runId, v);
      if (!state.runId) state.runId = a.runId;
      hydrateRun(a.runId);
    }
    if (Array.isArray(a.gates)) v.approvals = new Map(a.gates.map((g) => [g.approval_id, { type: 'approval.requested', ...g, run_id: a.runId }]));
  }
  for (const [runId, v] of state.runs) {
    if (live.has(runId) || v.run?.status !== 'running' || hydrating.has(runId)) continue;
    v.run.status = 'interrupted';
    v.approvals.clear();
  }
  scheduleRender();
}
// after run events: one read for a burst of them
let activeSyncTimer = null;
function scheduleActiveSync() {
  if (activeSyncTimer) return;
  activeSyncTimer = setTimeout(() => { activeSyncTimer = null; loadActiveRuns(); }, 1000);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function showView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === (view === 'project' ? 'projects' : view)));
  $('#nav-workflows-sub').classList.toggle('hidden', view !== 'workflows');
  if (view === 'sessions') window.SessionsView?.show();
  if (view === 'dashboard') renderDashboard();
  if (view === 'projects') refreshProjects();
  if (view === 'project') { renderProjectView(); loadProjectRuns(); }
  if (view === 'backlog') window.refreshBacklog?.();
  if (view === 'artifacts') { renderArtifacts(); loadArtifacts(); }
  if (view === 'workflows') showWorkflowsTab(state.workflowsTab);
  if (view === 'agents') window.refreshAgents?.();
  if (view === 'skills') refreshSkills();
  if (view === 'analytics') window.refreshAnalytics?.();
  if (view === 'run') scheduleRender();
  viewRegistry.get(view)?.show?.();
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
  // gates answered or requested while the window was in the background, or while the browser UI
  // was disconnected (its events are lost)
  window.addEventListener('focus', () => loadActiveRuns());
  api.onReconnect?.(() => loadActiveRuns());
  window.addEventListener('blur', reportNotifyContext);
  document.addEventListener('visibilitychange', reportNotifyContext);
  api.onNotificationClick((target) => {
    if (target?.terminalId) { window.SessionsView?.focusTerminal(target.terminalId); return; }
    if (!target?.runId) return;
    showRun(target.runId, { workflow: target.workflow });
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
  for (const sel of ['#mock-toggle', '#duo-mock', '#arena-mock', '#resume-mock']) {
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
      <span><b>${esc(r.workflow || 'workflow')}</b>${r.project ? ` · ${esc(r.project)}` : ''}${issueRefs(r) ? ` · ${esc(issueRefs(r))}` : ''} <span class="muted">— ${esc(statusLabel(r))}${approvals.size ? ' · waiting for approval' : ''}</span></span>
      <button class="btn sm ghost" data-run="${esc(r.id)}">View run</button></div>`).join('');
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => selectRun(b.dataset.run)));
  // pending approvals: every gate waiting across runs, each one opening its run (answered there)
  const gates = pendingGates();
  const gbox = $('#dash-gates');
  gbox.classList.toggle('hidden', !gates.length);
  gbox.innerHTML = gates.length ? `<div class="dash-gates-title"><b>Waiting for your approval</b> <span class="nav-gates">${gates.length}</span></div>${gates.map((g) => {
    const r = state.runs.get(g.run_id)?.run;
    return `<div class="dash-run-row">
      <span class="status st-waiting"><span class="status-dot"></span></span>
      <span><b>${esc(r?.workflow || 'workflow')}</b>${r?.project ? ` · ${esc(r.project)}` : ''}${issueRefs(r) ? ` · ${esc(issueRefs(r))}` : ''} <span class="muted">— step ${esc(g.step_id)}</span></span>
      <button class="btn sm primary" data-gate-run="${esc(g.run_id)}">Open run</button></div>`;
  }).join('')}` : '';
  gbox.querySelectorAll('[data-gate-run]').forEach((b) => (b.onclick = () => openGateOf(b.dataset.gateRun)));
}

const runSessionStatus = (st) => ({ running: 'active', success: 'success', failed: 'failed', interrupted: 'failed', cancelled: 'cancelled' })[st] || 'idle';
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
  // a workflow's `mode` (e.g. auto | validated) changes how the run goes: shown next to the task, not in Advanced
  const upfront = (k) => k === 'mode' && k !== mainKey;
  $('#inputs-form').innerHTML = entries.filter(([k]) => k === mainKey || upfront(k)).map((e) => field(e, e[0] === mainKey)).join('');
  $('#adv-form').innerHTML = entries.filter(([k]) => k !== mainKey && !upfront(k)).map((e) => field(e, false)).join('');

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
// Sidebar: commits merged locally (local workflows) and not pushed yet, over every project, from
// the service's last checks (no git call here). The Backlog pushes them.
async function refreshUnpushed() {
  let list = [];
  try { list = await api.listUnpushed(); } catch { /* no workspace yet */ }
  const total = list.reduce((a, x) => a + x.ahead, 0);
  const badge = $('#nav-backlog-unpushed');
  badge.textContent = String(total);
  badge.classList.toggle('hidden', !total);
  badge.title = list.map((x) => `${x.name}: ${x.ahead} commit${x.ahead === 1 ? '' : 's'} not pushed on ${x.base}`).join('\n');
}
window.refreshUnpushed = refreshUnpushed;

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
      if (state.pv === pv) { pv.project = res.project || pv.project; pv.local = res.local || null; pv.runs = res.runs || []; pv.error = null; }
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
    // the Run screen shows the selected run: select this one, not whichever run was on screen
    if (b.dataset.runAct === 'view') showRun(r.runId, { workflow: r.workflow });
    // "Open chat" switches to the chat explicitly, and the chat becomes the remembered view
    if (b.dataset.runAct === 'chat') { setRunView('chat'); window.openRunChat?.({ runId: r.runId, workflow: r.workflow, running: r.current && r.status === 'running' }); }
    if (b.dataset.runAct === 'sup' || b.dataset.runAct === 'watch') {
      openSupervisor({ runId: r.runId, workflow: r.workflow, status: r.status, error: r.error, mock: r.mock, issues: issuesOfRun(r) }, { watch: b.dataset.runAct === 'watch' });
    }
    if (b.dataset.runAct === 'resume') openResumeDialog(r.runId);
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
        ${runProgressStrip(r)}
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

// Opens a workflow in Workflows › Definitions, scrolled to and focused (the Agents menu's
// "Open in workflow").
function showWorkflowDefinition(file) {
  state.workflowsTab = 'definitions';
  showView('workflows');
  setTimeout(() => {
    const card = document.querySelector(`.wf-card[data-file="${CSS.escape(file)}"]`);
    card?.scrollIntoView({ block: 'center' });
    card?.focus?.();
  }, 600);
}

function projectRunBody(r, pv) {
  const sessions = r.sessions || [];
  return `<div class="pr-body">
    <div class="row">
      <button class="btn sm ghost" data-run-act="logs">Open logs</button>
      <button class="btn sm ghost sup-btn" data-run-act="sup"><span class="sup-mark">◆</span> Ask the supervisor</button>
      ${r.current && r.status === 'running' ? `<button class="btn sm ghost sup-btn" data-run-act="watch" title="${WATCH_TITLE}"><span class="sup-mark">◆</span> Watch with the supervisor</button>` : ''}
      ${canResume(r) ? '<button class="btn sm ghost" data-run-act="resume" title="Start a new run from a step of this one, keeping the previous outputs (no supervisor call)">Resume from step…</button>' : ''}
      <button class="btn sm" data-run-act="chat" title="${esc(CHAT_TITLES[r.workflow] || 'See the agents, the orchestrator and the human gates as a chat')}">Open chat</button>
      ${r.current || state.runs.has(r.runId) ? '<button class="btn sm" data-run-act="view">View run</button>' : ''}
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
      <thead><tr><th>Agent</th><th>Provider · model</th><th>Status</th><th class="num">Turns</th><th class="num">Tokens</th><th class="num">Cost</th><th></th></tr></thead>
      <tbody>${[...sessions].sort((a, b) => isOrchSession(b) - isOrchSession(a)).map((s) => {
        const m = pv.msgs.get(`${r.runId}:${s.id}`);
        return `<tr data-session="${esc(s.id)}" data-agent="${esc(s.agent)}">
          <td><b title="${esc(s.agent)}">${esc(agentLabel(s.agent, r.agentNames))}</b> <span class="muted small mono">${esc(s.id)}</span></td>
          <td><span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span> <span class="mono small">${esc(s.model || '')}</span></td>
          <td><span class="status st-${esc(s.status)}"><span class="status-dot"></span>${esc(s.status)}</span></td>
          <td class="num mono">${fmtNum(s.turns)}</td>
          ${tokensCell(s.tokens)}
          ${sessionCostCell(s)}
          <td class="pr-term">
            <span class="small ${m?.error ? 'error' : 'muted'}" data-term-msg>${esc(m?.text || '')}</span>
            ${termButtons('live', isOrchSession(s) ? 'Follow the orchestrator log in a terminal' : '')}
            ${termButtons('cli', '', s.cliAvailable ? '' : s.cliReason || 'Not available')}
          </td>
        </tr>`;
      }).join('')}</tbody>
      ${sessionsTotalRow(sessions)}
    </table>` : '<p class="muted small">No agent sessions in this run.</p>'}
  </div>`;
}

// A session's tokens (sessionView: input + output + cache read + cache write, as on the Usage
// screen): the compact total, the exact breakdown on hover; — when the session has none (the engine).
const TOKEN_PARTS = [['input', 'Input'], ['output', 'Output'], ['cache_read', 'Cache read'], ['cache_write', 'Cache write'], ['reasoning', 'Reasoning (counted in output)']];
function tokensCell(t) {
  if (!t?.total) return '<td class="num mono muted">—</td>';
  const tip = TOKEN_PARTS.map(([k, label]) => `${label}: ${fmtNum(t[k])}`).join('\n');
  return `<td class="num mono" title="${esc(tip)}">${fmtTok(t.total)}</td>`;
}
// Tokens with no cost: a model with no price (Codex, unpriced models), not a free session.
function sessionCostCell(s) {
  if (!s.costUsd && s.tokens?.total && s.provider !== 'mock') return '<td class="num mono muted" title="No price for this model: see Usage › Prices">—</td>';
  return `<td class="num mono">${fmtUsd(s.costUsd)}</td>`;
}
function sessionsTotalRow(sessions) {
  const sum = (f) => sessions.reduce((a, s) => a + (f(s) || 0), 0);
  const tokens = Object.fromEntries([...TOKEN_PARTS.map(([k]) => [k, sum((s) => s.tokens?.[k])]), ['total', sum((s) => s.tokens?.total)]]);
  return `<tfoot><tr class="pr-total"><td colspan="3">Total</td><td class="num mono">${fmtNum(sum((s) => s.turns))}</td>
    ${tokensCell(tokens)}<td class="num mono">${fmtUsd(sum((s) => s.costUsd))}</td><td></td></tr></tfoot>`;
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
  $('#pj-lp-install').value = p?.localPreview?.install || '';
  $('#pj-lp-command').value = p?.localPreview?.command || '';
  $('#pj-lp-url').value = p?.localPreview?.url || '';
  $('#pj-folder').required = !!p;
  $('#pj-folder-hint').classList.toggle('hidden', !!p);
  $('#pj-error').textContent = '';
  openModal('#project-modal');
  $('#pj-name').focus();
}

async function saveProject(e) {
  e.preventDefault();
  const { lp_install: install, lp_command: command, lp_url: url, ...data } = Object.fromEntries(new FormData($('#project-form')));
  data.localPreview = { install, command, url };
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
const WORKFLOW_PAGES = {
  runs: 'Every run, live or finished.',
  definitions: 'Workflows are YAML files in the workflows folder.',
  builder: 'Draw a workflow: desks in a line, each with an agent, and approval gates. Saved as YAML in the workflows folder.',
};
function showWorkflowsTab(tab) {
  if (!WORKFLOW_PAGES[tab]) tab = 'runs';
  state.workflowsTab = tab;
  if (state.view !== 'workflows') return showView('workflows');
  document.querySelectorAll('[data-wtab]').forEach((b) => {
    const on = b.dataset.wtab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  document.querySelectorAll('[data-wpage]').forEach((p) => p.classList.toggle('hidden', p.dataset.wpage !== tab));
  $('#workflows-page-title').textContent = { runs: 'Runs', definitions: 'Definitions', builder: 'Builder' }[tab];
  $('#workflows-page-hint').textContent = WORKFLOW_PAGES[tab];
  if (tab === 'definitions') refreshWorkflows();
  if (tab === 'runs') { renderWorkflowRuns(); loadWorkflowRuns(); }
  if (tab === 'builder') window.showBuilder?.();
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
          ${Array.isArray(w.inputs?.mode?.enum) ? `<p class="small wf-modes"><b>Modes:</b> ${w.inputs.mode.enum.map((m) => `<span class="badge mono">${esc(m)}${m === w.inputs.mode.default ? ' (default)' : ''}</span>`).join(' ')} <span class="muted">${esc(w.inputs.mode.description || '')}</span></p>` : ''}
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
          <button class="btn ghost sm" data-builder ${w.error ? 'disabled' : ''} title="${esc(w.origin !== 'custom' ? 'See it in the visual builder (read-only: clone it to change it)' : w.builder ? 'Edit it in the visual builder' : 'See it in the visual builder: its agents and prompts can be changed there, its steps stay as they are')}">Send to builder</button>
          <button class="btn primary sm" data-run ${w.error ? 'disabled' : ''}>Run</button>
        </div>
      </div>
      <ol class="wf-steps">${steps}</ol>
    </article>`;
  }).join('');
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => openDrawer({ workflow: b.closest('.wf-card').dataset.file })));
  box.querySelectorAll('[data-builder]').forEach((b) => (b.onclick = () => window.openInBuilder?.(b.closest('.wf-card').dataset.file)));
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

// Highest used % (0..100) across the plan's rate-limit windows, or null.
function planWorst(p) {
  const v = (p.plan?.windows || []).map((w) => w.usedPercent).filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
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

// The gates waiting in the run the Run screen shows, asked inline above its steps (never in a
// dialog over the app): which run and step they belong to, the message, the choices and the
// optional feedback field. Rebuilt only when the gates change, so a feedback being typed stays.
function renderRunGates() {
  const v = selectedView();
  const box = $('#run-gates');
  const gates = [...v.approvals.values()];
  box.classList.toggle('hidden', !gates.length);
  const key = `${gates.map((g) => `${g.run_id}:${g.approval_id}`).join('|')}:${runLabel(v.run)}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = gates.map((g) => {
    const buttons = g.choices
      ? g.choices.map((c, i) => `<button type="button" class="btn sm ${i === 0 ? 'primary' : 'ghost'}" data-choice="${esc(c.id)}"${c.feedback_required ? ' data-needs-text="1"' : ''}>${esc(c.label)}</button>`).join('')
      : '<button type="button" class="btn sm ghost" data-answer="false">Reject</button><button type="button" class="btn sm primary" data-answer="true">Approve</button>';
    const field = g.feedback ? `<label class="duo-ask-label">${esc(g.feedback.label || 'Instructions (optional)')}</label>
      <textarea class="duo-ask-text run-gate-feedback" rows="3" placeholder="${esc(g.feedback.placeholder || '')}"></textarea>` : '';
    return `<div class="run-gate" data-approval="${esc(g.approval_id)}" data-run="${esc(g.run_id)}">
      <div class="run-gate-head"><b>Approval required</b><span class="muted small mono">${esc(`${v.run ? `${runLabel(v.run)} · ` : ''}step: ${g.step_id}`)}</span></div>
      <pre class="run-gate-message">${esc(g.message || '')}</pre>${gateToolsHtml(g)}${field}<div class="row run-gate-actions">${buttons}</div></div>`;
  }).join('');
}

// A click on a gate card's button answers that gate (true/false or a choice id) with the run's id,
// so it works for any run in progress; the card goes away with approval.resolved. A choice that
// needs the feedback text (feedback_required) is not sent without one.
function onRunGateClick(e) {
  const tool = e.target.closest('[data-gate-tool]');
  if (tool) { onGateTool(e, tool.closest('.run-gate')?.dataset.run); return; }
  const b = e.target.closest('button[data-answer], button[data-choice]');
  const card = b?.closest('.run-gate');
  if (!card) return;
  const answer = b.dataset.choice !== undefined ? b.dataset.choice : b.dataset.answer === 'true';
  const text = card.querySelector('.run-gate-feedback');
  if (b.dataset.needsText && !text?.value.trim()) { showToast('Write your request first', `"${b.textContent}" sends the text to the agent.`); text?.focus(); return; }
  const buttons = card.querySelectorAll('button');
  buttons.forEach((x) => (x.disabled = true));
  Promise.resolve(api.resolveApproval(card.dataset.approval, answer, text?.value || '', card.dataset.run))
    .then((ok) => { if (ok === false) { buttons.forEach((x) => (x.disabled = false)); showToast('The gate did not accept the answer', 'It needs a text, or it was already answered.'); } })
    .catch((err) => { buttons.forEach((x) => (x.disabled = false)); showToast('Could not answer the gate', errMsg(err)); });
}

// What a gate offers besides its answers (Run screen and run chat); none of them answers it:
// Run locally (#70: `local_preview` on the gate, the project's or workflow's command in the run's
// worktree, stopped when the gate is answered), the worktree's folder, a terminal there and its diff
// (`diff_base` on the gate).
// g: the approval.requested event (local_preview, work_dir, diff_base) or a run chat gate (localPreview, workDir, diffBase).
function gateToolsHtml(g, { disabled = false } = {}) {
  const lp = g.local_preview || g.localPreview || null;
  const dir = g.work_dir || g.workDir || null;
  const base = dir ? g.diff_base || g.diffBase || null : null;
  if (!lp && !dir) return '';
  const off = disabled ? ' disabled' : '';
  const how = lp ? `${lp.install ? `${lp.install} (when dependencies are missing or the lockfile changed), then ` : ''}${lp.command}` : '';
  const run = lp ? `<button type="button" class="btn sm ghost" data-gate-tool="preview" title="${esc(`${how} in ${dir}. Runs in simulation only, on a scratch copy of your workspace.`)}"${off}>▶ Run locally</button>
    <button type="button" class="btn sm ghost" data-gate-tool="stop" title="Stop this run's local preview"${off}>■ Stop</button>
    <label class="muted small" title="The copy uses your real workspace (projects, runs, settings) instead of a scratch copy. Still simulation only."><input type="checkbox" data-gate-real${off}> real workspace</label>
    ${lp.url ? `<a class="small" href="${esc(lp.url)}" target="_blank" rel="noopener">${esc(lp.url)}</a>` : ''}` : '';
  const open = dir ? `<button type="button" class="btn sm ghost" data-gate-tool="folder" title="${esc(dir)}"${off}>Open the worktree</button>
    <button type="button" class="btn sm ghost" data-gate-tool="shell" title="A terminal in ${esc(dir)}"${off}>Terminal there</button>` : '';
  const diff = base ? `<button type="button" class="btn sm ghost" data-gate-tool="diff" title="${esc(`The branch's changes since ${base} (git diff ${base}...HEAD in the worktree)`)}"${off}>Show the diff</button>` : '';
  return `<div class="row gate-tools" data-dir="${esc(dir || '')}" data-approval="${esc(g.approval_id || g.approvalId)}">${run}${diff}${open}</div>`;
}

async function onGateTool(e, runId) {
  const b = e.target.closest('[data-gate-tool]');
  const box = b?.closest('.gate-tools');
  if (!box || b.disabled) return;
  const { dir, approval } = box.dataset;
  try {
    if (b.dataset.gateTool === 'folder') await api.openPath(dir);
    else if (b.dataset.gateTool === 'shell') {
      await openTerminal({ kind: 'shell', runId, sessionId: dir, label: 'Worktree', open: (cols, rows) => api.termOpen({ kind: 'shell', folder: dir, cols, rows }) });
    } else if (b.dataset.gateTool === 'diff') {
      await openTerminal({ kind: 'diff', runId, sessionId: `diff-${approval}`, label: 'Diff', open: (cols, rows) => api.termOpen({ kind: 'diff', runId, approvalId: approval, cols, rows }) });
    } else if (b.dataset.gateTool === 'stop') {
      if (!await api.stopLocalPreview(runId)) showToast('No local preview', 'This run has no local preview running.');
    } else if (b.dataset.gateTool === 'preview') {
      const real = !!box.querySelector('[data-gate-real]')?.checked;
      if (real && !(await confirmDialog('Run on your real workspace?', 'The local copy will use your REAL workspace (projects, runs, settings) instead of a scratch copy. It stays in simulation only, but anything it writes lands in your workspace.', 'Run on it'))) return;
      await openTerminal({ kind: 'preview', runId, sessionId: approval, label: 'Local preview', open: (cols, rows) => api.startLocalPreview(runId, approval, real, cols, rows) });
    }
  } catch (err) {
    showToast('Could not do it', errMsg(err));
  }
}

// Brings the Run screen's gate card into view and focuses its first answer.
function focusRunGate() {
  requestAnimationFrame(() => {
    const card = $('#run-gates .run-gate');
    card?.scrollIntoView({ block: 'nearest' });
    card?.querySelector('.run-gate-actions button')?.focus();
  });
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
  if (ev) openGateOf(ev.run_id);
}
window.openNextGate = openNextGate;

// Opens a run's gate inside the run, in the remembered run view: its chat asks the question inline
// (answered with the run's id, so it works after a reload); Details (or no chat screen), the Run
// screen's gate card.
function openGateOf(runId) {
  const v = state.runs.get(runId);
  if (!v) return;
  selectRun(runId, { open: false });
  if (state.runView === 'chat' && window.openRunChat) { window.openRunChat({ runId, workflow: v.run?.workflow, running: isRunLive(runId) }); return; }
  showView('run');
  focusRunGate();
}
window.openGateOf = openGateOf;

function getTurn(sess, n) {
  if (!sess.turnLog.has(n)) sess.turnLog.set(n, { n, items: [], prompt: null, result: null, stepId: null, startedAt: null });
  return sess.turnLog.get(n);
}

// The view of an event's run. A run that started before this window opened (or reconnected) is
// picked up from its next event, and rebuilt from its events.jsonl (hydrateRun).
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
      hydrateRun(ev.run_id);
    }
  }
  return v;
}

// Runs picked up mid-way: their steps, sessions, trail and gates so far are replayed from the
// recorded events; the live events that come in while the file is read wait in `hydrating`.
const hydrating = new Map(); // run id -> live events held back
let replaying = false;       // no toasts, dialogs or Run screen switches for past events
async function hydrateRun(runId) {
  if (hydrating.has(runId)) return;
  hydrating.set(runId, []);
  let recorded = [];
  try { recorded = (await api.runEvents?.(runId)) || []; } catch { /* the live events only */ }
  const live = hydrating.get(runId);
  hydrating.delete(runId);
  const v = state.runs.get(runId);
  if (!v) return;
  const replay = RunProgress.hydrationEvents(recorded, live);
  if (replay.length > live.length) {
    const { run } = v;
    Object.assign(v, newRunView());
    v.run = run; // runs:active details until workflow.started is replayed
  }
  replaying = true;
  try { for (const ev of replay) onEvent(ev); } finally { replaying = false; }
}

// Workflow, project and issue of a run, from workflow.started or from runs:active.
function runInfo(x) {
  const inputs = x.inputs || {};
  const project = state.projects.find((p) => p.id === (x.project_id || x.projectId)) || state.projects.find((p) => Object.values(inputs).includes(p.folder));
  return {
    id: x.run_id || x.runId, startedAt: Date.parse(x.ts || x.startedAt) || Date.now(), mock: !!x.mock, workflow: x.workflow,
    version: x.version, inputs, issues: issuesOfRun(x), project: project?.name || null,
    agentNames: x.agent_names || null, // agents from the Agents menu: key → their own name
  };
}

// An agent's readable name (display-name.js); the slug stays in tooltips.
const agentLabel = (slug, names) => (window.displayName ? displayName(slug, names) : String(slug || ''));

// Finished runs that are not shown are forgotten (their chat and files keep everything).
function pruneRuns() {
  for (const [id, v] of state.runs) {
    if (state.runs.size <= 8) return;
    if (id !== state.runId && v.run?.status !== 'running') state.runs.delete(id);
  }
}

function onEvent(ev) {
  if (ev.type === 'workflow.started' || ev.type === 'workflow.finished') reportNotifyContext();
  if (!replaying) scheduleActiveSync();
  const v = viewOf(ev);
  if (!replaying && hydrating.has(ev.run_id)) { hydrating.get(ev.run_id).push(ev); return; }
  v.events.push(ev);
  const sess = ev.session_id ? v.sessions.get(ev.session_id) : null;

  switch (ev.type) {
    case 'workflow.started':
      v.run = { ...runInfo(ev), status: 'running' };
      v.events = [ev];
      v.steps = new Map((ev.steps || []).map((s) => [s.id, { ...s, visits: 0, status: 'pending' }]));
      v.trail = new RunProgress.StepTrail();
      v.groups = ev.groups || [];
      // a new run takes the Run screen only from a run that is over
      if (!replaying && (!isRunLive(state.runId) || state.runId === ev.run_id)) state.runId = ev.run_id;
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
      // the Run screen moves on to a run still in progress when the one it showed ends elsewhere
      if (state.runId === ev.run_id && state.view !== 'run' && liveRuns().length) state.runId = liveRuns()[0].run.id;
      if (liveRuns().length && !replaying) showToast(`${runLabel(v.run)}: ${statusLabel(v.run)}`, ev.error, ev.run_id);
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
      // asked inside its run (the Run screen's gate card, the run chats); elsewhere a badge, a toast
      // and the pending approvals list say it waits: nothing covers the screen
      const shown = state.view === 'run' && state.runId === ev.run_id;
      if (replaying || shown) break;
      if (!window.duoShowsRun?.(ev.run_id) && !window.arenaShowsRun?.(ev.run_id) && !window.runChatShowsRun?.(ev.run_id)) {
        showToast(`Approval waiting: ${runLabel(v.run)}`, `Step ${ev.step_id}. Click to open its run.`, ev.run_id, ev);
      }
      break;
    }

    case 'approval.resolved':
      v.approvals.delete(ev.approval_id);
      // the owner's time at the gates, shown apart from agent time (Details, the Time KPI)
      if (v.run && ev.wait_ms) v.run.gateWaitMs = (v.run.gateWaitMs || 0) + ev.wait_ms;
      if (ev.choice !== undefined) orch(ev, `human decision: ${ev.choice} (${ev.by})`, 'transition');
      else orch(ev, `approval ${ev.approved ? 'granted' : 'denied'} (${ev.by})`, ev.approved ? 'transition' : 'warn');
      break;

    case 'action.executed':
      orch(ev, `$ ${ev.command} ${ev.skipped ? '(not executed — simulation)' : `→ exit ${ev.exit_code}`}`);
      break;

    case 'local_preview.started':
      orch(ev, `local preview started at ${ev.step_id}: ${ev.command} in ${ev.dir}`);
      break;

    case 'local_preview.stopped':
      orch(ev, `local preview stopped${ev.reason ? ` (${ev.reason})` : ev.exit_code != null ? ` (exit ${ev.exit_code})` : ''}`);
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
      if (!replaying) showToast(`◆ Supervisor on "${ev.step_id}"${liveRuns().length > 1 ? ` (${runLabel(v.run)})` : ''}: ${SUP_ACTIONS[ev.action] || ev.action}`, ev.explanation, ev.run_id);
      break;
    }
  }
  // the run's row in the runs lists follows its steps from here, without a reload
  if (v.trail?.apply(ev)) renderRunListsSoon();
  if (PROJECT_REFRESH_EVENTS.has(ev.type)) { loadProjectRunsThrottled(); loadWorkflowRunsThrottled(); }
  if (ev.type === 'workflow.finished' || ev.type === 'file.saved') loadArtifactsThrottled();
  // the service re-checks the project's commits not pushed right after a local merge
  if (ev.type === 'worktree.merged' || ev.type === 'workflow.finished') setTimeout(refreshUnpushed, 1500);
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
  renderRunGates();
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
  $('#kpi-time').title = r?.gateWaitMs ? `Of which ${fmtDur(r.gateWaitMs)} waiting for you at gates` : '';
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
// workflow, project/issue and gates waiting; the badge counts the gates across runs. A run waiting
// at a gate is always listed, in the "waiting for you" state with the gate's step, until the
// engine no longer lists the gate (loadActiveRuns); clicking it opens the gate in its run.
function renderNavRuns() {
  const gates = pendingGates().length;
  const badge = $('#nav-run-gates');
  badge.classList.toggle('hidden', !gates);
  badge.textContent = String(gates);
  badge.title = `${gates} approval${gates === 1 ? '' : 's'} waiting: click to review`;
  // failed or interrupted runs stay listed: they need attention (resume, supervisor) and are otherwise unreachable here
  const list = [...state.runs.values()].filter((v) => v.run && (['running', 'failed', 'interrupted'].includes(v.run.status) || v.run.id === state.runId));
  const box = $('#nav-runs');
  const show = list.length > 1 || !!gates;
  box.classList.toggle('hidden', !show);
  if (!show) { box.innerHTML = ''; return; }
  const html = list.map(({ run: r, approvals }) => {
    const gate = [...approvals.values()][0];
    const where = [r.project, issueRefs(r) || null].filter(Boolean).join(' · ');
    const sub = gate ? `waiting for you · ${gate.step_id}` : `${where || statusLabel(r)} · ${new Date(r.startedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    const title = gate ? `${runLabel(r)} — waiting for you at ${gate.step_id}: click to answer` : `${runLabel(r)} — ${statusLabel(r)}`;
    return `<button type="button" class="nav-run-item st-${gate ? 'waiting' : runSessionStatus(r.status)}${r.id === state.runId ? ' selected' : ''}" data-run="${esc(r.id)}"${gate ? ' data-gate="1"' : ''} title="${esc(title)}">
      <span class="status-dot"></span>
      <span class="nav-run-text"><span class="nav-run-wf">${esc(gate && where ? `${r.workflow || 'workflow'} · ${where}` : r.workflow || 'workflow')}</span><span class="nav-run-sub">${esc(sub)}</span></span>
      ${approvals.size ? `<span class="nav-gates" title="Approval waiting">${approvals.size}</span>` : ''}
    </button>`;
  }).join('');
  if (box.dataset.html === html) return;
  box.dataset.html = html;
  box.innerHTML = html;
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => (b.dataset.gate ? openGateOf(b.dataset.run) : selectRun(b.dataset.run))));
}

function renderRunSummary() {
  const r = state.run;
  if (!r) return;
  const inputs = Object.entries(r.inputs || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length));
  const html = `
    <div class="run-summary-name"><b>${esc(r.workflow || '')}</b>${r.version ? ` <span class="muted small">v${esc(r.version)}</span>` : ''}</div>
    ${r.project ? `<div class="small">Project: <b>${esc(r.project)}</b></div>` : ''}
    ${r.gateWaitMs ? `<div class="small" title="Time the run waited for your answers at its human gates: no agent works (or costs) meanwhile">Waiting for you at gates: <b>${esc(fmtDur(r.gateWaitMs))}</b></div>` : ''}
    <dl class="kv run-inputs">${inputs.map(([k, v]) => `<dt title="${esc(k)}">${esc(k)}</dt>${inputValueCell(v)}`).join('')}</dl>
    <div class="row">
      <button class="btn sm ghost sup-btn" id="btn-run-sup" title="Ask the AI supervisor to explain this run and suggest how to continue"><span class="sup-mark">◆</span> Ask the supervisor</button>
      ${r.status === 'running' ? `<button class="btn sm ghost sup-btn" id="btn-run-watch" title="${WATCH_TITLE}"><span class="sup-mark">◆</span> Watch</button>` : ''}
      ${canResume(r) ? '<button class="btn sm ghost" id="btn-run-resume" title="Start a new run from a step of this one, keeping the previous outputs (no supervisor call)">Resume from step…</button>' : ''}
    </div>`;
  // rendered on every event: rebuilt only when it changes, so a hover popover over an input stays open
  const box = $('#run-summary');
  if (box._html === html) return;
  box._html = html;
  box.innerHTML = html;
  $('#btn-run-sup').onclick = () => openSupervisorForCurrent();
  if ($('#btn-run-watch')) $('#btn-run-watch').onclick = () => openSupervisorForCurrent({ watch: true });
  if ($('#btn-run-resume')) $('#btn-run-resume').onclick = () => openResumeDialog(r.id);
}

// A run input in the Details panel: one line cut with an ellipsis (paths keep their end), the full
// text on hover (a scrollable popover for long values). Arrays read as a list (issue URLs as #N).
const ISSUE_URL_RE = /\/(?:issues|pull|merge_requests|-\/issues)\/(\d+)\/?$/;
function inputText(v) {
  if (Array.isArray(v)) {
    const items = v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x)));
    const refs = items.map((x) => ISSUE_URL_RE.exec(x)?.[1]);
    return { line: refs.every(Boolean) ? refs.map((n) => `#${n}`).join(', ') : items.join(', '), full: items.join('\n') };
  }
  if (v && typeof v === 'object') return { line: JSON.stringify(v), full: JSON.stringify(v, null, 2) };
  const s = String(v);
  return { line: s.replace(/\s*\n\s*/g, ' ⏎ '), full: s };
}
const looksLikePath = (s) => !/\n/.test(s) && /^(?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/])/.test(s);
function inputValueCell(v) {
  const { line, full } = inputText(v);
  const long = full.length > 200 || full.includes('\n');
  const text = looksLikePath(line) ? `<span class="kv-path"><bdi>${esc(line)}</bdi></span>` : esc(line);
  return long ? `<dd class="kv-line" data-full="${esc(full)}">${text}</dd>` : `<dd class="kv-line" title="${esc(full)}">${text}</dd>`;
}

// One floating popover for elements with data-full (long run inputs): scrollable, stays open while
// the mouse moves into it, so a task of thousands of characters stays readable.
function initFullTextPopover() {
  const pop = document.createElement('div');
  pop.className = 'full-pop hidden';
  document.body.appendChild(pop);
  let owner = null;
  let timer = null;
  const hide = () => { clearTimeout(timer); timer = setTimeout(() => { pop.classList.add('hidden'); owner = null; }, 200); };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[data-full]');
    if (el || pop.contains(e.target)) clearTimeout(timer);
    if (!el || el === owner) return;
    owner = el;
    pop.textContent = el.dataset.full;
    pop.classList.remove('hidden');
    const b = el.getBoundingClientRect();
    const w = Math.min(560, window.innerWidth - 24);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(12, Math.min(b.left, window.innerWidth - w - 12))}px`;
    const below = window.innerHeight - b.bottom - 12;
    pop.style.maxHeight = `${Math.max(below, b.top - 12, 120)}px`;
    if (below >= Math.min(pop.scrollHeight, 240) || below >= b.top) { pop.style.top = `${b.bottom + 4}px`; pop.style.bottom = ''; }
    else { pop.style.top = ''; pop.style.bottom = `${window.innerHeight - b.top + 4}px`; }
  });
  document.addEventListener('mouseout', (e) => {
    const from = e.target.closest?.('[data-full]') || (pop.contains(e.target) ? pop : null);
    if (!from) return;
    const to = e.relatedTarget;
    if (to && (pop.contains(to) || to.closest?.('[data-full]') === owner)) return;
    hide();
  });
}

function renderRunBanner() {
  const r = state.run;
  const box = $('#run-fail-banner');
  const show = r?.status === 'failed';
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const key = `${r.id}:${issueRefs(r)}:${r.error || ''}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = `<div class="fail-banner-text"><b>The workflow failed: ${esc(runLabel(r))}</b><span class="muted small mono">${esc(r.id)}</span>${r.error ? `<span class="mono small" title="${esc(r.error)}">${esc(r.error)}</span>` : ''}</div>
    <button class="btn sm sup-btn solid" id="btn-banner-sup"><span class="sup-mark">◆</span> Ask the supervisor</button>`;
  $('#btn-banner-sup').onclick = () => openSupervisorForCurrent();
}

// The Run screen's steps: only those that ran, one collapsible section per workflow group (the
// current step's group open), a step in no group on its own; "Show all steps" adds the others.
function renderSteps() {
  const v = selectedView();
  const all = [...v.steps.values()];
  const shown = v.allSteps ? all : all.filter((s) => s.visits > 0);
  const groupOf = new Map(v.groups.flatMap((g) => g.steps.map((id) => [id, g.name])));
  const current = v.trail?.steps.at(-1)?.step || all.find((s) => s.status === 'running' || s.status === 'waiting')?.id;
  const item = (s) => `
    <li class="${s.status}">
      <span class="dot"></span>
      <span>${esc(s.id)}<br><span class="kind"${s.agent ? ` title="${esc(s.agent)}"` : ''}>${s.type === 'human_approval' ? 'human approval' : esc(agentLabel(s.agent, v.run?.agentNames))}</span></span>
      <span class="visits">${s.visits ? '×' + s.visits : ''}</span>
    </li>`;
  // in the workflow's step order: a group where its first shown step is
  const sections = [];
  const byGroup = new Map();
  for (const s of shown) {
    const name = groupOf.get(s.id);
    if (name == null) { sections.push({ steps: [s] }); continue; }
    if (!byGroup.has(name)) { byGroup.set(name, { name, steps: [] }); sections.push(byGroup.get(name)); }
    byGroup.get(name).steps.push(s);
  }
  const html = sections.map((sec) => {
    if (sec.name == null) return `<ol class="steps">${item(sec.steps[0])}</ol>`;
    const open = v.openGroups.get(sec.name) ?? sec.steps.some((s) => s.id === current);
    const st = sec.steps.some((s) => s.status === 'running') ? 'running' : sec.steps.some((s) => s.status === 'waiting') ? 'waiting' : sec.steps.some((s) => s.visits) ? 'done' : 'pending';
    return `<details class="step-group ${st}" data-group="${esc(sec.name)}" ${open ? 'open' : ''}>
      <summary><span class="dot"></span><b>${esc(sec.name)}</b><span class="muted small">${sec.steps.filter((s) => s.visits).length}/${sec.steps.length}</span></summary>
      <ol class="steps">${sec.steps.map(item).join('')}</ol>
    </details>`;
  }).join('');
  const hidden = all.length - all.filter((s) => s.visits > 0).length;
  const toggle = hidden ? `<button type="button" class="link-btn small" data-all-steps>${v.allSteps ? 'Hide the steps that did not run' : `Show all steps (${hidden} not run)`}</button>` : '';
  const box = $('#steps');
  const out = (html || '<p class="muted small">No step has run yet.</p>') + toggle;
  if (box.dataset.html === out) return;
  box.dataset.html = out;
  box.innerHTML = out;
  box.querySelectorAll('.step-group > summary').forEach((sum) => (sum.onclick = () => {
    v.openGroups.set(sum.parentElement.dataset.group, !sum.parentElement.open);
  }));
  const btn = box.querySelector('[data-all-steps]');
  if (btn) btn.onclick = () => { v.allSteps = !v.allSteps; renderSteps(); };
}

// ---------------------------------------------------------------------------
// Run progress in the runs lists: the groups a run visited, with their agents' avatars
// ---------------------------------------------------------------------------
let runListsFrame = 0;
function renderRunListsSoon() {
  if (runListsFrame) return;
  runListsFrame = requestAnimationFrame(() => {
    runListsFrame = 0;
    if (workflowRunsVisible() && state.wr.runs) renderWorkflowRuns();
    if (state.view === 'project' && state.pv?.runs) renderProjectView();
  });
}

// Robot SVGs are large: one per provider/model/state, reused. A workflow agent with a look saved
// in Agents (`workflow` + `agent`) gets its own entry, dropped when a look changes.
const avatarCache = new Map();
document.addEventListener('robots:changed', (e) => { if (e.detail?.name === 'workflow-agents') avatarCache.clear(); });
function robotAvatar(provider, model, st, workflow, agent) {
  const look = window.AgentLooks?.forWorkflow(workflow, agent);
  const key = look ? `look|${workflow}/${agent}|${st}` : `${provider}|${model}|${st}`;
  if (!avatarCache.has(key)) {
    const variant = look || (window.Robots ? Robots.variantFor(window.RunChatModel?.providerType(provider, model) || provider, model || '') : null);
    avatarCache.set(key, variant ? Robots.svg(variant, st, { bubble: false, plaque: '' }) : '');
  }
  return avatarCache.get(key);
}
const PERSON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="currentColor"/><path d="M4.5 21c0-4.2 3.4-7 7.5-7s7.5 2.8 7.5 7z" fill="currentColor"/></svg>';
const ENGINE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const CHIP_ROBOT_STATE = { running: 'thinking', waiting: 'waiting', failed: 'error', stopped: 'sleeping', done: 'idle' };
const MAX_CHIPS = 8;

function progressAvatar(a, chip, names, workflow) {
  const tip = a.human
    ? `${a.steps.join(', ')} · You (human gate)${a.durationMs ? ` · ${fmtDur(a.durationMs)}` : ''}`
    : `${a.steps.join(', ')} · ${agentLabel(a.agent, names)} (${a.agent})${a.provider ? ` · ${a.provider}${a.model ? `/${a.model}` : ''}` : ''}${a.durationMs ? ` · ${fmtDur(a.durationMs)}` : ''} · ${fmtUsd(a.cost)}`;
  // the last chip's working agents show the run's state; the others rest
  const st = chip.status === 'done' ? 'idle' : CHIP_ROBOT_STATE[chip.status];
  const art = a.human ? PERSON_SVG : a.provider ? robotAvatar(a.provider, a.model, st, workflow, a.agent) : ENGINE_SVG;
  return `<span class="rp-av${a.human ? ' human' : a.provider ? '' : ' engine'}" title="${esc(tip)}">${art}</span>`;
}

function progressChip(c, names, workflow) {
  const label = {
    done: '✓',
    running: `${c.current}…`,
    waiting: 'waiting for you',
    failed: `✕ ${c.current}`,
    stopped: `stopped at ${c.current}`,
  }[c.status];
  const agents = c.agents.length ? c.agents : [{ agent: 'orchestrator', steps: c.steps.map((e) => e.step), cost: 0, durationMs: 0 }];
  const avs = agents.slice(0, 4).map((a) => progressAvatar(a, c, names, workflow)).join('') + (agents.length > 4 ? `<span class="rp-av rp-more" title="${esc(agents.slice(4).map((a) => agentLabel(a.agent, names)).join(', '))}">+${agents.length - 4}</span>` : '');
  return `<div class="rp-chip st-${c.status}${c.status === 'done' ? ' still' : ''}">
    <div class="rp-avs">${avs}</div>
    <div class="rp-name${c.grouped ? '' : ' mono'}">${esc(c.name)}${c.round > 1 ? ` <span class="rp-round">×${c.round}</span>` : ''}</div>
    <div class="rp-state" title="${esc(c.steps.map((e) => e.step).join(' › '))}">${esc(label)}</div>
  </div>`;
}

// The progress strip of a run's row: the live trail for a run this window follows from its start.
function runProgressStrip(r) {
  const live = r.current ? state.runs.get(r.runId) : null;
  const steps = live?.trail ? live.trail.steps : r.progress;
  if (!steps?.length) return '';
  const status = live?.trail ? live.run?.status || r.status : r.status;
  const chips = RunProgress.progressGroups(steps, r.groups || live?.groups, status);
  const skipped = chips.length - MAX_CHIPS;
  return `<div class="rp-strip">${skipped > 0 ? `<span class="rp-skip" title="${esc(chips.slice(0, skipped).map((c) => c.name).join(' › '))}">+${skipped}</span><span class="rp-sep">›</span>` : ''}${chips.slice(Math.max(0, skipped)).map((c) => progressChip(c, r.agentNames || live?.run?.agentNames, r.workflow || live?.run?.workflow)).join('<span class="rp-sep">›</span>')}</div>`;
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
        <span class="name" title="${esc(s.agent)}">${esc(agentLabel(s.agent, selectedView()?.run?.agentNames))}</span>
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
      <h3 title="${esc(s.agent)}">${esc(agentLabel(s.agent, selectedView()?.run?.agentNames))} <span class="muted small mono">${esc(s.agent)}</span> <span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span> <span class="badge">${esc(s.model)}</span></h3>
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
const ART_KIND = { markdown: ['MD', 'k-md'], json: ['{ }', 'k-json'], table: ['TSV', 'k-table'], text: ['TXT', 'k-text'], image: ['IMG', 'k-image'], other: ['FILE', 'k-other'] };
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
  if (meta.kind === 'image' && d.image) { body.innerHTML = `<div class="art-image"><img src="${esc(d.image)}" alt="${esc(name)}" /></div>`; return; }
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
const SUP_ACTIONS = { retry: 'retry the step', fix_output: 'fix the output', goto: 'go to another step', ask_human: 'ask you', fail: 'stop the run', wait: 'keep waiting', interrupt: 'interrupt the idle agent' };

const WATCH_TITLE = 'The supervisor follows this run and explains it in a chat, where you can ask questions (opt-in: it costs tokens)';

function openSupervisorForCurrent(opts) {
  const r = state.run;
  if (!r) return;
  openSupervisor({ runId: r.id, workflow: r.workflow, status: r.status, error: r.error, mock: r.mock, issues: issuesOfRun(r) }, opts);
}

// opts.watch: turn the watch mode on (the "Watch with the supervisor" buttons)
function openSupervisor(run, opts = {}) {
  const sup = state.sup;
  if (sup.runId !== run.runId) {
    Object.assign(sup, { runId: run.runId, question: '', loading: false, result: null, error: null, recMsgs: {}, watch: null, watchError: null });
  }
  loadWatch(run.runId).then(() => {
    if (opts.watch && !sup.watch?.on && sup.runId === run.runId) setWatch(true);
  });
  Object.assign(sup, { workflow: run.workflow, status: run.status, runError: run.error, mock: !!run.mock, issues: issuesOfRun(run) });
  $('#sup-question').value = sup.question;
  $('#sup-chat-msg').textContent = '';
  $('#sup-drawer').classList.add('open');
  $('#sup-drawer').setAttribute('aria-hidden', 'false');
  $('#sup-backdrop').classList.remove('hidden');
  renderSupervisor();
  renderWatch();
  setTimeout(() => $(opts.watch ? '#sup-watch-q' : '#sup-question').focus(), 200);
}
window.watchWithSupervisor = (run) => openSupervisor(run, { watch: true });

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

// Watch mode: the supervisor follows a running run and explains it in this drawer (opt-in: it costs
// tokens). Its messages arrive on api.onWatch; the model and effort picked are remembered.
const WATCH_PICK_KEY = 'supWatchPick';
function watchPick() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(WATCH_PICK_KEY) || '{}'); } catch { /* defaults */ }
  return { provider: 'claude-code', model: 'claude-opus-5-5', effort: 'default', ...p };
}
const saveWatchPick = (change) => localStorage.setItem(WATCH_PICK_KEY, JSON.stringify({ ...watchPick(), ...change }));

async function loadWatch(runId) {
  try {
    const w = await api.watchState(runId);
    if (state.sup.runId === runId) { state.sup.watch = w; renderWatch(); }
  } catch { /* shown without its history */ }
}

async function setWatch(on) {
  const sup = state.sup;
  const runId = sup.runId;
  const p = watchPick();
  sup.watchError = null;
  try {
    const w = await api.watchRun(runId, on, { provider: p.provider, model: p.model, effort: p.effort === 'default' ? '' : p.effort });
    if (sup.runId === runId) sup.watch = w;
  } catch (e) {
    if (sup.runId === runId) sup.watchError = errMsg(e);
  }
  renderWatch();
}

async function askWatch() {
  const input = $('#sup-watch-q');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  state.sup.watchError = null;
  try {
    await api.askWatch(state.sup.runId, q);
  } catch (e) {
    state.sup.watchError = errMsg(e);
    input.value = q;
    renderWatch();
  }
}

function onWatch({ runId, message, watch }) {
  const sup = state.sup;
  if (sup.runId !== runId) return;
  const messages = sup.watch?.messages || [];
  // the reply to watchRun may already hold the message
  const known = message && messages.some((m) => m.ts === message.ts && m.text === message.text);
  sup.watch = { ...sup.watch, ...watch, messages: message && !known ? [...messages, message] : messages };
  renderWatch();
}

function renderWatch() {
  const sup = state.sup;
  const w = sup.watch;
  const on = !!w?.on;
  const live = on || isRunLive(sup.runId);
  $('#sup-watch').classList.toggle('hidden', !live && !w?.messages?.length);
  $('#sup-watch-on').checked = on;
  $('#sup-watch-on').disabled = !live;
  const p = watchPick();
  const sel = $('#sup-watch-model');
  if (!sel.options.length) {
    sel.innerHTML = Object.entries(window.ChatModels?.PROVIDERS || {}).map(([type, pr]) =>
      `<optgroup label="${esc(pr.label)}">${pr.models.map((m) => `<option value="${esc(`${type}|${m}`)}">${esc(m)}</option>`).join('')}</optgroup>`).join('');
  }
  sel.value = on ? `${w.provider}|${w.model}` : `${p.provider}|${p.model}`;
  sel.disabled = on;
  const effort = on ? w.effort || 'default' : p.effort;
  $('#sup-watch-effort').innerHTML = ['default', ...(window.ChatModels?.EFFORTS || [])]
    .map((e) => `<button type="button" data-effort="${e}" class="${e === effort ? 'active' : ''}"${on ? ' disabled' : ''}>${e}</button>`).join('');
  $('#sup-watch-cost').textContent = w && (on || w.costUsd) ? `watch cost ${fmtCost(w.costUsd || 0)}` : '';
  $('#sup-watch-q').disabled = !on;
  $('#btn-sup-watch-ask').disabled = !on;
  const log = $('#sup-watch-log');
  log.innerHTML = (w?.messages || []).map((m) => {
    const cls = `sup-wmsg ${esc(m.role)}${m.flag ? ' flag' : ''}${m.error ? ' error' : ''}`;
    if (m.role === 'system') return `<div class="${cls} small">${esc(m.text)}</div>`;
    const meta = `${m.role === 'user' ? 'You' : '◆ Supervisor'} · ${esc(new Date(m.ts).toLocaleTimeString())}${m.costUsd != null ? ` · ${esc(fmtCost(m.costUsd))}` : ''}`;
    return `<div class="${cls}"><div class="sup-wmsg-meta">${meta}</div><div class="md md-compact">${markdownHtml(m.text)}</div></div>`;
  }).join('')
    + (w?.busy ? '<div class="sup-loading"><span class="spinner"></span><span>The supervisor is reading the run…</span></div>' : '')
    + (sup.watchError ? `<p class="error small">${esc(sup.watchError)}</p>` : '');
  log.scrollTop = log.scrollHeight;
}

function renderSupervisor() {
  const sup = state.sup;
  $('#sup-run').innerHTML = `<span class="mono">${esc(sup.runId || '')}</span>${sup.workflow ? ` · ${esc(sup.workflow)}` : ''}${sup.issues?.length === 1 ? ` · <b>#${esc(sup.issues[0].number)}</b> ${esc(sup.issues[0].title || '')}` : sup.issues?.length ? ` · <b>${esc(issueRefs(sup))}</b>` : ''}${sup.status ? ` <span class="pill pill-${esc(sup.status)}">${esc(sup.status)}</span>` : ''}${sup.mock ? ' <span class="badge p-mock">simulated</span>' : ''}`;
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
    ctrl = `${resumeFields(`rec-${i}`, steps.map((s) => ({ id: s })), pre, r.instruction || '')}
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
  const step = r.action === 'resume' ? $(`#rec-${i}-step`).value : steps[0];
  const instruction = r.action === 'resume' ? $(`#rec-${i}-ins`).value.trim() : r.instruction || '';
  const btn = document.querySelector(`[data-rec="${i}"]`);
  if (btn) btn.disabled = true;
  sup.recMsgs[i] = { text: 'Starting…', error: false };
  try {
    const { runId } = await api.resumeRun(sup.runId, step, instruction || undefined);
    sup.recMsgs = {};
    closeSupervisor();
    showRun(runId, { running: true });
  } catch (e) {
    sup.recMsgs[i] = { text: errMsg(e), error: true };
    renderSupervisor();
  }
}

// ---------------------------------------------------------------------------
// Resume from step…: the owner restarts a finished, failed, cancelled or interrupted run from any
// step, with no supervisor analysis (runs:resume, the channel the recommendations use too). The
// service refuses a step past a human gate the run decided; every gate reached again asks again.
const canResume = (r) => !!r && !r.current && !['running', 'pending', 'waiting'].includes(r.status);

// The step select and the instruction, shared by the dialog and the supervisor's resume card.
// options: [{ id, label?, disabled? }]
function resumeFields(id, options, pre, instruction = '') {
  return `<div class="field"><label for="${id}-step">Resume from step</label>
      <select id="${id}-step">${options.map((o) => `<option value="${esc(o.id)}"${o.id === pre ? ' selected' : ''}${o.disabled ? ' disabled' : ''}>${esc(o.label || o.id)}</option>`).join('')}</select></div>
    <div class="field"><label for="${id}-ins">Instruction for the agents <span class="muted small">(optional)</span></label>
      <textarea id="${id}-ins" rows="4" placeholder="e.g. The app was restarted: go on with the same task.">${esc(instruction)}</textarea></div>`;
}

function resumeStepLabel(o, s) {
  const where = s.id === o.stoppedAt ? (o.status === 'failed' && s.id === o.failedStep ? 'failed here' : 'stopped here')
    : s.id === o.failedStep ? 'failed' : s.visits ? 'reached' : '';
  return [s.id, s.gate ? 'human gate' : '', where, s.blockedBy ? `after the decided gate ${s.blockedBy}` : ''].filter(Boolean).join(' · ');
}

// What the resume keeps and what runs again, for the chosen step.
function resumeEffects(o, stepId) {
  const at = o.steps.findIndex((s) => s.id === stepId);
  if (at < 0) return '';
  const before = o.steps.slice(0, at).filter((s) => s.visits && !s.gate).map((s) => s.id);
  const again = o.steps.slice(at).filter((s) => s.visits).map((s) => s.id);
  const gates = o.steps.slice(at).filter((s) => s.gate && (s.visits || s.id === stepId)).map((s) => s.id);
  const wt = o.worktree;
  const kept = [
    before.length ? `the outputs of ${before.map((s) => `<b>${esc(s)}</b>`).join(', ')}` : 'no earlier outputs (it starts at the beginning)',
    o.sessions.length || o.handoffs.length ? `the agents' sessions and handoff notes (${esc([...new Set([...o.sessions, ...o.handoffs])].join(', '))})` : '',
    wt ? (wt.exists ? `the worktree and branch <span class="mono">${esc(wt.branch || '')}</span> <span class="muted mono">${esc(wt.dir)}</span>` : 'not the worktree: it was removed, so the run starts a new one from the base') : '',
  ].filter(Boolean);
  return `<div><b>Kept:</b> ${kept.join('; ')}.</div>
    <div><b>Runs again:</b> <b>${esc(stepId)}</b> and the steps its transitions lead to${again.length > 1 ? ` (reached before: ${again.slice(1).map(esc).join(', ')})` : ''}.</div>
    <div><b>Human gates ask again</b> when the run reaches them${gates.length ? ` (${gates.map(esc).join(', ')}${o.steps[at].gate ? '; this step is one' : ''})` : ''}: none is treated as already approved.</div>`;
}

async function openResumeDialog(runId) {
  const body = $('#resume-body');
  const msg = $('#resume-msg');
  const yes = $('#btn-resume-yes');
  const box = $('#resume-mock');
  $('#resume-run').innerHTML = `<span class="mono">${esc(runId)}</span>`;
  body.innerHTML = '<div class="sup-loading"><span class="spinner"></span><span>Reading the run…</span></div>';
  msg.textContent = '';
  msg.className = 'small';
  yes.disabled = true;
  $('#btn-resume-no').onclick = () => closeModal('#resume-modal');
  openModal('#resume-modal');
  let o;
  try { o = await api.resumeOptions(runId); } catch (e) { body.innerHTML = `<p class="error small">${esc(errMsg(e))}</p>`; return; }
  $('#resume-run').innerHTML = `<span class="mono">${esc(o.runId)}</span> · ${esc(o.workflow || '')} <span class="pill pill-${esc(o.status)}">${esc(o.status)}</span>${o.mock ? ' <span class="badge p-mock">simulated</span>' : ''}`;
  if (o.active) { body.innerHTML = '<p class="error small">The run is still active: it can be resumed once it ends.</p>'; return; }
  body.innerHTML = `${resumeFields('resume', o.steps.map((s) => ({ id: s.id, label: resumeStepLabel(o, s), disabled: !!s.blockedBy })), o.suggested)}
    <div id="resume-effects" class="resume-effects small"></div>`;
  const sel = $('#resume-step');
  const effects = () => { $('#resume-effects').innerHTML = resumeEffects(o, sel.value); };
  sel.onchange = effects;
  effects();
  // a simulated run resumes as one; simulation-only (automated checks) never resumes a real run
  box.checked = o.mock || devMode();
  box.disabled = o.mock || !!state.simulationOnly;
  yes.disabled = !o.suggested;
  yes.onclick = async () => {
    yes.disabled = true;
    msg.className = 'small muted';
    msg.textContent = 'Starting…';
    try {
      const { runId } = await api.resumeRun(o.runId, sel.value, $('#resume-ins').value.trim() || undefined, o.mock || wantsSimulation(box));
      closeModal('#resume-modal');
      showRun(runId, { running: true });
    } catch (e) {
      msg.className = 'small error';
      msg.textContent = errMsg(e);
      yes.disabled = false;
    }
  };
}
window.openResumeDialog = openResumeDialog;

// ---------------------------------------------------------------------------
// The code changed on disk while the app runs (#83): a pull or a merge updated src/ and a reload
// (Ctrl+R) runs the new UI against the old main process (or server), where new channels are
// missing. Checked when the window loads and gets the focus; a banner offers a safe restart.
// ---------------------------------------------------------------------------
const RESTART_KEY = 'multiagent.restartInterrupted';
const codeState = { running: null, changed: false, reload: false };

async function checkCodeVersion() {
  let v = null;
  try {
    // a main process older than this check has no such channel: it is older than the page
    v = typeof api.codeVersion === 'function' ? await api.codeVersion() : { changed: true };
  } catch (e) {
    v = missingChannel(String(e?.message || e)) ? { changed: true } : null;
  }
  if (!v) return;
  // the browser UI: the server restarted with other code than the page loaded
  if (codeState.running && v.running && v.running !== codeState.running) codeState.reload = true;
  codeState.running = codeState.running || v.running || null;
  if (v.changed || codeState.reload) showCodeBanner();
}

const runningStepsOf = (runId) => [...(state.runs.get(runId)?.steps.values() || [])].filter((s) => s.status === 'running').map((s) => s.id).join(', ');

async function showCodeBanner() {
  codeState.changed = true;
  let runs = [];
  try { runs = await api.listActiveRuns(); } catch { /* the count is left out */ }
  const n = runs.length;
  const inProgress = n ? ` (${n} run${n > 1 ? 's' : ''} in progress will be interrupted and can be resumed)` : '';
  const desktop = api.platform !== 'browser' && typeof api.relaunchApp === 'function';
  const text = codeState.reload ? 'The server restarted with other code. Reload the page to use it.'
    : desktop ? `The app's code changed on disk. Restart to use it${inProgress}.`
      : api.platform === 'browser' ? `The app's code changed on disk. Restart the server (npm run serve) and reload the page to use it${inProgress}.`
        : `The app's code changed on disk. Close and open the app to use it${inProgress}.`;
  const el = $('#code-banner');
  el.innerHTML = `<span>${esc(text)}</span>
    ${codeState.reload ? '<button class="btn sm primary" type="button" data-code="reload">Reload</button>' : desktop ? '<button class="btn sm primary" type="button" data-code="restart">Restart</button>' : ''}
    <button class="btn sm ghost" type="button" data-code="dismiss" title="Hide until the next check">Later</button>`;
  el.classList.remove('hidden');
}
window.showCodeBanner = showCodeBanner;

// Warns with the runs in progress (and the step each is on), then restarts: main refuses again if
// a run started meanwhile and the user did not confirm it.
async function restartApp() {
  let runs = [];
  try { runs = await api.listActiveRuns(); } catch { /* main still refuses with runs in progress */ }
  if (runs.length) {
    const lines = runs.map((r) => `• ${r.workflow} (${r.runId}): ${r.waiting ? 'waiting for approval' : runningStepsOf(r.runId) || 'in progress'}`);
    const ok = await confirmDialog('Restart and interrupt runs?',
      `${runs.length} run${runs.length > 1 ? 's' : ''} in progress will be interrupted:\n${lines.join('\n')}\n\nThe Backlog queues are paused. After the restart the interrupted runs are listed with Resume.`, 'Restart');
    if (!ok) return;
  }
  try { localStorage.setItem(RESTART_KEY, JSON.stringify(runs.map((r) => ({ runId: r.runId, workflow: r.workflow })))); } catch { /* storage unavailable */ }
  try {
    await api.relaunchApp(runs.length > 0);
  } catch (e) {
    try { localStorage.removeItem(RESTART_KEY); } catch { /* storage unavailable */ }
    showToast('Restart refused', errMsg(e));
  }
}

// After a restart: the runs it interrupted, each with Resume (a new run from a step, #74-#76).
function showRestartInterrupted() {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(RESTART_KEY) || '[]');
    localStorage.removeItem(RESTART_KEY);
  } catch { return; }
  if (!Array.isArray(list) || !list.length) return;
  const el = $('#code-banner');
  el.innerHTML = `<span>The restart interrupted ${list.length} run${list.length > 1 ? 's' : ''}:</span>
    ${list.map((r) => `<span class="code-banner-run"><span class="mono small">${esc(r.workflow || 'workflow')} ${esc(r.runId)}</span>
      <button class="btn sm primary" type="button" data-code="resume" data-run="${esc(r.runId)}">Resume…</button></span>`).join('')}
    <button class="btn sm ghost" type="button" data-code="dismiss">Dismiss</button>`;
  el.classList.remove('hidden');
}

function initCodeBanner() {
  $('#code-banner').onclick = (e) => {
    const b = e.target.closest('[data-code]');
    if (!b) return;
    if (b.dataset.code === 'restart') restartApp();
    if (b.dataset.code === 'reload') location.reload();
    if (b.dataset.code === 'resume') openResumeDialog(b.dataset.run);
    if (b.dataset.code === 'dismiss') $('#code-banner').classList.add('hidden');
  };
  showRestartInterrupted();
  checkCodeVersion();
  window.addEventListener('focus', checkCodeVersion);
  api.onReconnect?.(checkCodeVersion);
}

let toastTimer = null;
// runId: the run it is about (a click shows it); gate: an approval.requested event to open.
// Never blocks anything: it hides by itself and its × dismisses it.
function showToast(title, detail, runId = null, gate = null) {
  const el = $('#toast');
  el.innerHTML = `<button type="button" class="toast-close" aria-label="Dismiss" title="Dismiss">×</button><b>${esc(title)}</b>${detail ? `<span>${esc(String(detail).slice(0, 220))}</span>` : ''}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), gate ? 15000 : 7000);
  el.onclick = (e) => {
    el.classList.add('hidden');
    if (e.target.closest('.toast-close')) return; // dismissed only
    // a gate still waiting opens inside its run (its chat, or the Run screen's gate card)
    if (gate && state.runs.get(gate.run_id)?.approvals.has(gate.approval_id)) return openGateOf(gate.run_id);
    if (runId && state.runs.has(runId)) selectRun(runId);
    else if (state.run) selectRun(state.run.id);
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
    // xterm draws its own scrollbar: the same colours as the app's (style.css :root)
    scrollbarSliderBackground: v('--scrollbar-thumb', 'rgba(138,145,163,0.3)'),
    scrollbarSliderHoverBackground: v('--scrollbar-thumb-hover', 'rgba(138,145,163,0.5)'),
    scrollbarSliderActiveBackground: v('--scrollbar-thumb-active', 'rgba(138,145,163,0.7)'),
  };
}

// Opens (or focuses) an embedded terminal. Throws with a readable message on failure.
// open(cols, rows): starts it another way than term:open (e.g. a gate's local preview).
async function openTerminal({ kind, sessionId, runId, label, open }) {
  if (typeof Terminal === 'undefined') throw new Error('The terminal component failed to load.');
  runId = runId || state.run?.id;
  const key = `${kind}:${runId || 'current'}:${sessionId}`;
  const existing = dock.tabs.find((t) => t.key === key);
  // a finished program started another way (a local preview that stopped) starts again in a fresh tab
  if (existing && open && existing.exited) closeTab(existing, { kill: false });
  else if (existing) { showDock(); activateTab(existing); return existing; }

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
    const res = await (open ? open(term.cols, term.rows) : api.termOpen({ kind, runId, sessionId, cols: term.cols, rows: term.rows }));
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
