/* global api */
// The UI shell. Every screen is a folder of views/ that registers itself (view-registry.js) and
// wires its own controls in its mount(); init() runs once they are all in place. What stays here,
// and why (each is used by several screens or by the frame around them):
// - formatting and error helpers ($, esc, fmtDur, errMsg…) and CATEGORIES: every screen uses them;
// - the shared run state: `state`, each run the window knows as a view rebuilt from its events
//   (`state.runs`, onEvent, hydrateRun, viewOf, openPastRun), the runs in progress and their gates from the engine (`loadActiveRuns`
//   over runs:active, on load, focus, reconnect and after run events, so the sidebar's "waiting
//   for you" survives a reload) and how a run is opened (selectRun, showRun, openGateOf);
// - navigation: init(), showView, the sidebar's Run item and runs menu (renderNavRuns), the top
//   bar (renderHeader) and render(), which also draws the Run screen while it shows;
// - what the frame shows over any screen: desktop notifications' context, developer mode, the
//   confirm dialog, toasts.
// Shared pieces with a file of their own: start-drawer.js, usage-widget.js, gate-panel.js,
// run-list.js, run-meta.js (run titles, issues and PRs), artifact-render.js, supervisor-drawer.js,
// resume-dialog.js, code-banner.js, term-dock.js, account.js, chat-models.js, kept-work-dialog.js,
// toast.js (the toast's countdown and its action).
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// numbers, costs and dates in the interface language (#329, shared/i18n.js); English stays en-US
const uiLocale = () => { const l = window.I18n?.getLanguage(); return !l || l === 'en' ? 'en-US' : l; };
const fmtNum = (n) => (n || 0).toLocaleString(uiLocale());
const fmtCost = (n, approx = false) => (n == null ? '—' : `${approx ? '≈ ' : ''}${uiLocale() === 'en-US' ? `$${Number(n).toFixed(4)}` : window.I18n.formatCost(n, uiLocale(), 4)}`);
function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}m` : m ? `${m}m${String(r).padStart(2, '0')}s` : `${r}s`;
}
// in the workspace's time zone (#273, time-zone.js); TimeZone.titleOf names the zone for a tooltip
const timeOf = (iso) => new Date(iso).toLocaleTimeString(uiLocale(), { timeZone: TimeZone.current() });
const dateOf = (iso) => new Date(iso).toLocaleString(uiLocale(), { dateStyle: 'short', timeStyle: 'short', timeZone: TimeZone.current() });
// how long ago, in the interface language: just now, N min ago, N h ago, else the local date
function fmtRelative(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return t('common.ago_now');
  if (s < 3600) return t('common.ago_minutes', { n: Math.floor(s / 60) });
  if (s < 86400) return t('common.ago_hours', { n: Math.floor(s / 3600) });
  return new Date(iso).toLocaleDateString(uiLocale(), { timeZone: TimeZone.current() });
}
const USAGE_SCOPE_KEY = 'craftorio.usageScope';
const RUN_VIEW_KEY = 'craftorio.runView';
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
  get plan() { return t('app.category_plan'); },
  get build() { return t('app.category_build'); },
  get monitor() { return t('app.category_monitor'); },
};

// ---------------------------------------------------------------------------
/** @type {Record<string, any>} */ // each screen adds its own fields
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
  // runs), by run id; runId is the one the Run screen and the Run item show. state.run, sessions,
  // steps, orchLog, events, selected and openDetails read the selected run (defined below).
  runs: new Map(),
  runId: null,
  // run id → { title, customTitle, pr } (#84): what every list shows of a run, so they agree; from
  // runs:list, runs:active, the project's runs and 'run:meta' (PR state changes, a title set)
  runMeta: new Map(),
  tab: 'artifacts', // the Run screen's details tab: a run opens on its Artifacts (#410)
  workflowsTab: 'runs', // 'definitions' | 'runs' | 'builder' | 'pipelines' (the Workflows screen's tabs, each a menu entry)
  pendingProject: null, // project to preselect in the panel on open
  mainKey: null,      // the Start drawer's main free-text input (usually `task`), never remembered
  starting: false,    // a startRun() request is pending: both start buttons stay disabled
  usage: null,        // last api.getUsage() result
  usageError: null,
  actionsUsage: null, // last api.getActionsUsage() result (GitHub Actions minutes)
  art: { runs: null, error: null, projectId: "", q: "", showSim: false, sel: null, doc: null, mode: "rendered", reveal: null },
  sup: { runId: null, question: '', loading: false, result: null, error: null, recMsgs: {}, watch: null, watchError: null }, // supervisor panel
  pv: null,           // project detail view: { id, project, runs, error, filter, showSim, expanded, msgs }
  wr: { runs: null, error: null, filter: 'all', showSim: false, q: '', workflow: '', expanded: new Set(), msgs: new Map() }, // Workflows > Runs
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
//   lastSeq: the highest event `seq` applied (a live event at or below it was already replayed)
//   past: a finished run opened from disk (openPastRun): read-only, no live events expected
const newRunView = () => ({
  run: null, sessions: new Map(), steps: new Map(), orchLog: [], events: [], selected: null, openDetails: new Set(), approvals: new Map(),
  trail: null, groups: [], openGroups: new Map(), allSteps: false, lastSeq: 0, past: false,
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

// Makes a run the selected one and, with `open`, opens it in the remembered run view (showRun).
// Another run opens on its Artifacts tab (#410; renderRunScreen syncs the tabs to state.tab).
function selectRun(runId, { open = true } = {}) {
  if (!state.runs.has(runId)) return;
  if (runId !== state.runId) state.tab = 'artifacts';
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
// own chat screens), or its Run screen; a past run this window does not follow is loaded from disk
// into the Run screen (openPastRun). `running`: a run just started (resumed) whose first event may
// not be here yet.
function showRun(runId, { workflow, running } = {}) {
  const v = state.runs.get(runId);
  if (v && runId !== state.runId) state.tab = 'artifacts';
  if (v) state.runId = runId;
  const live = running ?? isRunLive(runId);
  if (state.runView === 'chat' && window.openRunChat) {
    window.openRunChat({ runId, workflow: workflow || v?.run?.workflow, running: live });
  } else if (v || live) {
    showView('run');
  } else {
    openPastRun(runId);
  }
  scheduleRender();
}
window.showRun = showRun;

// A run this window does not follow (finished, or from before the window opened): its recorded
// events are replayed into the same view as a live run (hydrateRun), read-only: no Stop, no gates.
// A run with nothing recorded opens in Workflows › Runs instead.
async function openPastRun(runId) {
  if (!state.runs.has(runId)) {
    const v = newRunView();
    v.past = true;
    v.run = { id: runId, status: 'loading', startedAt: Date.now(), workflow: null, inputs: {} };
    state.runs.set(runId, v);
  }
  if (runId !== state.runId) state.tab = 'artifacts';
  state.runId = runId;
  showView('run');
  await hydrateRun(runId);
  const v = state.runs.get(runId);
  if (v?.past && !v.events.length) {
    state.runs.delete(runId);
    if (state.runId === runId) state.runId = liveRuns()[0]?.run.id || null;
    window.showRunInList?.(runId);
  }
  scheduleRender();
}
window.openPastRun = openPastRun;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
async function init() {
  // #412: Stop and Pause sit on the Run screen's tab row (run.js mount)
  $('#nav-run-gates').onclick = (e) => { e.stopPropagation(); openNextGate(); };

  // navigation (delegated: one listener for the static entries and those views/ added with registerView)
  $('nav.sidebar').addEventListener('click', (e) => {
    const b = e.target.closest('.nav-item');
    if (!b) return;
    // a Workflows entry opens its tab (#254: Definitions, Runs, Builder, Pipelines)
    if (b.dataset.view === 'workflows') state.workflowsTab = b.dataset.tab || 'runs';
    // the Run item opens the run shown in the top bar in the remembered view
    if (b.dataset.view === 'run' && state.runs.has(state.runId)) { selectRun(state.runId); return; }
    viewRegistry.get(b.dataset.view)?.fromMenu?.();
    showView(b.dataset.view);
  });
  refreshUnpushed();
  refreshWorkflowsAcceptance();

  initStartDrawer();
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // the layer on top takes this Esc: the views' own Esc (the city's mode, #440) leaves it alone
    if (document.querySelector('.modal:not(.hidden), #sup-drawer.open, #usage-pop:not(.hidden)')) e.preventDefault();
    if (!$('#usage-pop').classList.contains('hidden')) return closeUsagePopover();
    if ($('#sup-drawer').classList.contains('open')) return closeSupervisor();
    if (!$('#budget-modal').classList.contains('hidden')) return closeModal('#budget-modal');
    // the Setup (#319): Esc is its Skip, which asks first (once: not while that question shows)
    if (window.Setup?.isOpen()) return $('#confirm-modal').classList.contains('hidden') ? window.Setup.skip() : undefined;
    if (!$('#skill-modal').classList.contains('hidden')) return closeModal('#skill-modal');
    if (!$('#agent-modal').classList.contains('hidden')) return closeModal('#agent-modal');
    if (!$('#wb-skills-modal').classList.contains('hidden')) return $('#btn-wb-skills-cancel').click();
    if (!$('#wb-agents-modal').classList.contains('hidden')) return $('#btn-wb-agents-cancel').click();
    if (!$('#wb-trust-modal').classList.contains('hidden')) return $('#btn-wb-trust-cancel').click();
    if (!$('#drawer').classList.contains('open')) return;
    closeDrawer();
  });

  // the Run screen wires its own controls (views/run/); the shared drawers and widgets here
  initSupervisorDrawer();
  initAccount();
  initUsageWidget();

  api.onEvent(onEvent);
  api.onRunMeta?.(onRunMeta);
  // a run's PR link opens the PR in the browser, and its title's pencil edits it, without
  // selecting or expanding the run row (or sidebar entry) around them
  document.addEventListener('click', (e) => {
    const link = e.target.closest?.('[data-pr-url]');
    const edit = link ? null : e.target.closest?.('[data-title-edit]');
    if (!link && !edit) return;
    e.preventDefault();
    e.stopPropagation();
    if (link) window.open(link.dataset.prUrl, '_blank', 'noopener');
    else editRunTitle(edit);
  }, true);
  api.onWatch(onWatch);
  initNotifications();
  initTerminalDock();
  // the screens' hooks the shell drives (here, in onEvent, render, renderTicking) are the fronts'
  // globals: a composition may leave their front out (#579), so each is called when it exists
  window.initFullTextPopover?.();
  setInterval(renderTicking, 1000);
  setInterval(tickRunLists, 60e3); // #320: the run lists' Next turn minutes (run-list.js)
  const askSlowReads = deferSlowReads(10000); // #389: once Home is drawn (usage-widget.js)

  state.ws = await api.getWorkspace();
  state.settings = await api.getSettings();
  window.InterfaceLanguage.apply(state.settings); // #329: the saved interface language (interface-language.js)
  TimeZone.notify(); // #273: what was drawn before the settings arrived redraws in the saved zone
  const appInfo = await api.appInfo();
  state.simulationOnly = !!appInfo.simulationOnly;
  $('#sim-only-badge').classList.toggle('hidden', !state.simulationOnly);
  applyDeveloperMode();
  [state.workflows, state.projects, state.skills] = await Promise.all([api.listWorkflows(), api.listProjects(), api.listSkills()]);
  window.CurrentProject.refresh(); // #794: reads the workflows waiting for acceptance too
  renderWorkspacePaths();
  await loadActiveRuns();
  initCodeBanner();
  initKeepAwake();
  renderDashboard();
  askSlowReads();
  // a Run App copy opens on the screen the change is about (#119)
  if (viewRegistry.has(appInfo.startView)) showView(appInfo.startView);

  // #319: a new workspace opens the first-run Setup once (under the sign-in screen while it shows);
  // `=== false`: a workspace whose settings say nothing (an old one, a test double) never does
  if (state.settings.setupDone === false) window.Setup.open();
  // the Start drawer lists what the chosen workflow lacks (start-drawer.js renderEnvStatus)
  loadCliStatus();
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
  noteRunMeta(list);
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
    if (Array.isArray(a.gates)) {
      v.approvals = new Map(a.gates.map((g) => [g.approval_id, { type: 'approval.requested', ...g, run_id: a.runId }]));
      // an answered card goes once the engine no longer lists its gate, its push lost or not (#603)
      for (const id of [...(v.answered?.keys() || [])]) if (!v.approvals.has(id)) v.answered.delete(id);
    }
    // #368: pausing after the current turn, as the engine says (a reloaded window included)
    if (v.run && a.pause !== undefined) v.run.pause = a.pause;
  }
  for (const [runId, v] of state.runs) {
    if (live.has(runId) || v.run?.status !== 'running' || hydrating.has(runId)) continue;
    v.run.status = 'interrupted';
    v.approvals.clear();
    v.answered?.clear();
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
  const def = viewRegistry.get(view);
  // a screen drawn in another one's section (#254: the Roadmap, in the Backlog's)
  const section = def?.section || view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${section}`));
  def?.show?.();
  paintNav();
  reportNotifyContext();
}
// The open screen's menu entry (a screen without one names it in `menu`); a Workflows entry is its tab's.
function paintNav() {
  const lit = viewRegistry.get(state.view)?.menu || state.view;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active',
    b.dataset.view === lit && (!b.dataset.tab || b.dataset.tab === state.workflowsTab)));
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
  // the Agents window (#263) and the mockup editor window (#625) never speak for the main window's screen
  if (window.AgentsWindow?.isWindowPage?.() || window.MockupEditor?.isWindowPage?.()) return;
  if (notifyContextTimer) return;
  notifyContextTimer = setTimeout(() => {
    notifyContextTimer = null;
    api.setNotifyContext({
      focused: document.hasFocus() && !document.hidden,
      runId: shownRunId(),
      terminalId: state.view === 'sessions' ? window.SessionsView?.shownTerminalId() || null : null,
      // #149: the Product Owner's answers are not notified while its drawer shows them
      poProjectId: ['backlog', 'roadmap'].includes(state.view) ? window.BacklogPO?.openProjectId() || null : null,
    });
  }, 0);
}
window.reportNotifyContext = reportNotifyContext;

// Where a notification leads (desktop click or the notification center): its terminal, the
// project's Backlog (a push conflict; with the Product Owner's drawer open for its answer, #149),
// or its run; an Oracle's action under Night watch (#123) opens the Oracle.
function openNotificationTarget(t) {
  if (t.terminalId) { window.SessionsView?.focusTerminal(t.terminalId); return; }
  if (t.openOracle) { window.OracleChat?.open(); return; }
  // a Night watch's morning summary (#172)
  if (t.view === 'nightwatch') { showView('nightwatch'); return; }
  // (a roadmap's notice opens the Roadmap screen, #254)
  if (t.view === 'backlog' || t.view === 'roadmap') {
    window.BacklogActions?.focusProject(t.projectId);
    showView(t.view);
    if (t.openPO) window.BacklogPO?.open();
    return;
  }
  if (t.runId) showRun(t.runId, { workflow: t.workflow });
}

function initNotifications() {
  window.addEventListener('focus', reportNotifyContext);
  // gates answered or requested while the window was in the background, or while the browser UI
  // was disconnected (its events are lost)
  window.addEventListener('focus', () => loadActiveRuns());
  // #794: a pull made outside the app may have changed a repository workflow (once per 5 s)
  window.addEventListener('focus', () => refreshWorkflowsAcceptanceOnFocus());
  api.onReconnect?.(() => loadActiveRuns());
  // the browser client's pushed channel down: "Disconnected, reconnecting…" until it is back (#603;
  // nothing before the first connection, so the page's start does not flash it)
  api.onConnectionChange?.((up) => $('#connection-status')?.classList.toggle('hidden', up !== false));
  window.addEventListener('blur', reportNotifyContext);
  document.addEventListener('visibilitychange', reportNotifyContext);
  api.onNotificationClick((target) => openNotificationTarget(target || {}));
  reportNotifyContext();
}

// Developer mode (Settings › Execution): the Simulation checkboxes (.dev-only) are shown and checked
// by default; without it they are hidden and every run is real. Simulation only (automated checks,
// CRAFTORIO_SIMULATION_ONLY) behaves as developer mode: the engine refuses real runs anyway.
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
  if (state.view === 'artifacts') window.renderArtifactList?.(); // simulated runs are listed only in developer mode
}

function openModal(sel) { $(sel).classList.remove('hidden'); }
function closeModal(sel) { $(sel).classList.add('hidden'); }

function confirmDialog(title, message, yes = t('common.confirm')) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-details').classList.add('hidden');
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

const runSessionStatus = (st) => ({ running: 'active', success: 'success', failed: 'failed', interrupted: 'failed', cancelled: 'cancelled', paused: 'cancelled' })[st] || 'idle';
// a run's status as people read it (#266, StatusPill): "Running (simulation)", "Succeeded", "Idle" without a run
const statusLabel = (r) => `${StatusPill.statusLabel(r?.status || 'idle')}${r?.status === 'running' && r.mock ? t('app.simulation_suffix') : ''}`;

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
  badge.title = list.map((x) => t('app.commits_not_pushed_on', { name: x.name, count: x.ahead, base: x.base })).join('\n');
}
window.refreshUnpushed = refreshUnpushed;
// #794: the count of repository workflows waiting for acceptance lives in workflows-acceptance.js
const refreshWorkflowsAcceptance = () => window.refreshWorkflowsAcceptance?.();

// What adds a file to a run's artifacts (handoff notes, the decision log, saved documents,
// screenshots of the evidence step): its panels reload.
const ARTIFACT_EVENTS = new Set(['decision.logged', 'file.saved', 'handoff.saved', 'step.finished', 'workflow.finished']);

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
  window.focusRunGate?.();
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

const hydrating = new Map(); // run id -> live events held back while hydrateRun reads the recorded ones

// One engine event into its run's view (applyRunEvent) and the app's state (the Run screen's run,
// the runs kept). `live` is false for an event replayed from disk (hydrateRun): no Run screen switch
// and no side effects. { v, effects } for runEventEffects; null when held back or applied already.
function reduceEvent(ev, live) {
  if (ev.type === 'workflow.started' || ev.type === 'workflow.finished') reportNotifyContext();
  if (live) scheduleActiveSync();
  const v = viewOf(ev);
  if (live && hydrating.has(ev.run_id)) { hydrating.get(ev.run_id).push(ev); return null; }
  const effects = applyRunEvent(v, ev);
  if (!effects) return null;
  if (ev.type === 'workflow.started') {
    // a new run takes the Run screen only from a run that is over
    if (live && (!isRunLive(state.runId) || state.runId === ev.run_id)) state.runId = ev.run_id;
    pruneRuns();
  }
  // the Run screen moves on to a run still in progress when the one it showed ends elsewhere
  if (ev.type === 'workflow.finished' && state.runId === ev.run_id && state.view !== 'run' && liveRuns().length) state.runId = liveRuns()[0].run.id;
  return { v, effects };
}

// The run view's reducer: updates the view (run, steps, sessions, approvals, orchestrator log,
// trail) and returns the side effects the event calls for, as data (RUN_EVENT_REDUCERS);
// null for an event already applied (its `seq`).
function applyRunEvent(v, ev) {
  if (ev.seq) {
    if (ev.seq <= v.lastSeq) return null; // replayed from disk already
    v.lastSeq = ev.seq;
  }
  v.events.push(ev);
  const effects = [];
  const sess = ev.session_id ? v.sessions.get(ev.session_id) : null;
  if (Object.hasOwn(RUN_EVENT_REDUCERS, ev.type)) RUN_EVENT_REDUCERS[ev.type](v, ev, sess, effects);
  // the run's row in the runs lists follows its steps from here, without a reload
  if (v.trail?.apply(ev)) effects.push({ renderRunLists: true });
  return effects;
}

// #350: a run recorded before per-turn costs (#233) is read through the run record's upgrade
// (packages/shared/run-record.js), as the services read past runs: the events so far, upgraded, end with
// this one (a turn's own cost, its session's corrected snapshot) and what it stands for (an old
// `attempt N/M failed` log line: the stopped attempt after it)
const upgradedTail = (v, ev) => (v.run?.costPerTurn ? [ev]
  : RunRecord.upgradeRunRecord({ events: v.events.filter((e) => e.type !== 'session.stream') }).events.slice(-2));
const takeSnapshot = (v, ev, sess) => { if (sess) Object.assign(sess, upgradedTail(v, ev).at(-1).session); };

// One reducer per event type: (view, event, its session, effects) updates the view and pushes the
// side effects as data: { toast: showToast's arguments }, { gateToast: the approval }, { saveToIssue },
// { openSaveToIssue }, { loadUsage }, { loadUsageThrottled } ({ renderRunLists }: applyRunEvent).
const RUN_EVENT_REDUCERS = {
  'workflow.started': (v, ev) => {
    v.run = { ...runInfo(ev), status: 'running', costPerTurn: ev.cost_accounting === 'per_turn' };
    v.events = [ev];
    v.steps = new Map((ev.steps || []).map((s) => [s.id, { ...s, visits: 0, status: 'pending' }]));
    v.trail = new RunProgress.StepTrail();
    v.groups = ev.groups || [];
    orch(ev, `workflow "${ev.workflow}" started ${ev.mock ? '(simulation)' : ''}`);
  },
  // #368: pausing after the current turn (the Run screen's pause line), or the pause taken back
  'run.pausing': (v, ev) => onPauseEvent(v, ev),
  'run.pause_cancelled': (v, ev) => onPauseEvent(v, ev),
  // the chain edited while the run goes (#134): the Run screen's chain banner
  'run.then': (v, ev) => { if (v.run) v.run.chain = ChainModel.withThen(v.run.chain, ev.then); },
  // a `type: workflow` step's child runs (#174): the Run screen links them
  'workflow.child_started': (v, ev) => {
    if (v.run && ev.child_run_id) {
      v.run.childRuns = [...(v.run.childRuns || []).filter((c) => c.run_id !== ev.child_run_id), { run_id: ev.child_run_id, step_id: ev.step_id, index: ev.index, label: ev.label, workflow: ev.workflow, status: ev.reused ? 'success' : 'running', resumed_from: ev.resumed_from, reused: ev.reused }];
    }
    // a resumed parent reuses the children that succeeded and resumes the others (#175)
    orch(ev, `child run ${ev.child_run_id} ${ev.reused ? 'reused' : ev.resumed_from ? `resumed from ${ev.resumed_from}` : 'started'} (${ev.workflow}${ev.label ? `: ${ev.label}` : ''})`, 'transition');
  },
  'workflow.child_finished': (v, ev) => {
    const c = v.run?.childRuns?.find((x) => x.run_id && x.run_id === ev.child_run_id);
    if (c) Object.assign(c, { status: ev.status, cost_usd: ev.cost_usd || 0, ...(ev.cost_approx ? { cost_approx: true } : {}) });
    orch(ev, `child run ${ev.child_run_id || '(not started)'} ${ev.status}${ev.label ? ` (${ev.label})` : ''}${ev.error ? `: ${ev.error}` : ''}`, ev.status === 'success' ? 'transition' : 'error');
  },
  'workflow.finished': (v, ev, sess, effects) => {
    v.run.status = ev.status;
    v.run.finishedAt = Date.parse(ev.ts);
    v.run.error = ev.error || null;
    v.run.pause = finishedPause(ev);
    // #396: the run went on without a green suite (views/run/run.js "Not tested green")
    v.run.tested = ev.summary?.tested || null;
    v.run.testedFailures = ev.summary?.tested_failures || null;
    // what the chain did is read again once the service acted on it (#134, views/run/run.js)
    v.chainLoaded = false;
    v.steps.forEach((s) => { if (s.status !== 'pending') s.status = 'done'; });
    v.approvals.clear();
    v.answered?.clear(); // no answered card outlives its run, approval.resolved lost or not (#603)
    orch(ev, `workflow finished: ${ev.status}${ev.error ? ' — ' + ev.error : ''}`, ev.status === 'success' ? 'transition' : 'error');
    if (liveRuns().length) effects.push({ toast: [`${runLabel(v.run)}: ${statusLabel(v.run)}`, ev.error, ev.run_id] });
    if (v.saveToIssue) effects.push({ openSaveToIssue: true });
    effects.push({ loadUsage: true });
  },
  'session.opened': (v, ev) => {
    v.sessions.set(ev.session_id, { ...ev.session, turnLog: new Map(), localOpenedAt: Date.parse(ev.ts) });
    if (!v.selected) v.selected = ev.session_id;
    if (ev.session_id !== 'orchestrator') orch(ev, `session ${ev.session_id} opened: ${ev.session.agent} (${ev.session.provider} · ${ev.session.model})`);
  },
  'session.status': (v, ev, sess) => { if (sess) sess.status = ev.status; },
  'session.closed': (v, ev, sess) => {
    takeSnapshot(v, ev, sess);
    if (ev.session_id !== 'orchestrator') orch(ev, `session ${ev.session_id} closed (${ev.status})`);
  },
  'session.message_sent': (v, ev, sess) => {
    if (!sess) return;
    const turn = getTurn(sess, ev.turn);
    turn.prompt = ev.prompt; turn.stepId = ev.step_id; turn.startedAt = Date.parse(ev.ts);
    sess.turns_count = ev.turn;
    orch(ev, `→ ${ev.session_id} turn ${ev.turn} (${ev.step_id})`);
  },
  'session.stream': (v, ev, sess) => {
    if (!sess) return;
    if (ev.item.kind === 'session' && ev.item.sessionId) sess.provider_session_id = ev.item.sessionId;
    if (ev.item.kind !== 'usage' && ev.item.kind !== 'session') getTurn(sess, ev.turn).items.push(ev.item);
  },
  'session.message_received': (v, ev, sess, effects) => {
    if (sess) {
      const own = upgradedTail(v, ev).at(-1);
      getTurn(sess, ev.turn).result = { usage: ev.usage, cost: own.cost_usd, ...(own.cost_source === 'unknown' ? { unknown: true } : {}), duration: ev.duration_ms };
      Object.assign(sess, own.session);
      orch(ev, `← ${ev.session_id} replied in ${fmtDur(ev.duration_ms)}`);
    }
    if (v.run?.status === 'running') effects.push({ loadUsageThrottled: true });
  },
  // #233: an attempt stopped before its result: its estimated cost is in the session's snapshot
  'session.attempt_stopped': takeSnapshot,
  // #320: the snapshot after a persistent agent's whole turn: its note saved, its cache state
  'session.updated': takeSnapshot,
  'step.started': (v, ev) => {
    const s = v.steps.get(ev.step_id);
    if (s) { s.status = 'running'; s.visits = ev.visit; }
    orch(ev, `▶ step ${ev.step_id} (visit ${ev.visit})`, 'transition');
  },
  'step.finished': (v, ev) => {
    const s = v.steps.get(ev.step_id);
    if (s) s.status = 'done';
  },
  'step.waiting': (v, ev) => {
    const s = v.steps.get(ev.step_id);
    if (s) s.status = 'waiting';
    orch(ev, `⏳ ${ev.step_id}: /loop, next check in ${fmtDur(ev.interval_ms)}`);
  },
  'step.goal': (v, ev) => orch(ev, `🎯 /goal ${ev.met ? 'met' : 'pending'}: ${ev.goal} (iteration ${ev.iteration})`, ev.met ? 'transition' : ''),
  'step.transition': (v, ev) => orch(ev, `${ev.from} → ${ev.to}   [${ev.when}]`, 'transition'),
  'approval.requested': (v, ev, sess, effects) => {
    v.approvals.set(ev.approval_id, ev);
    orch(ev, `? approval requested at ${ev.step_id}`, 'warn');
    effects.push({ gateToast: ev });
  },
  'approval.resolved': (v, ev, sess, effects) => {
    v.approvals.delete(ev.approval_id);
    v.answered?.delete(ev.approval_id); // the push confirms the answered card (#603)
    // the owner's time at the gates, shown apart from agent time (Details, the Time KPI)
    if (v.run && ev.wait_ms) v.run.gateWaitMs = (v.run.gateWaitMs || 0) + ev.wait_ms;
    // "Accept and save to issue #n" (#125): the preview opens when the run ends (workflow.finished)
    if (ev.intent === 'save_to_issue') effects.push({ saveToIssue: true });
    if (ev.choice !== undefined) orch(ev, `human decision: ${ev.choice}${ev.intent ? ` (${ev.intent})` : ''} (${ev.by})`, 'transition');
    else orch(ev, `approval ${ev.approved ? 'granted' : 'denied'} (${ev.by})`, ev.approved ? 'transition' : 'warn');
  },
  'action.executed': (v, ev) => orch(ev, `$ ${ev.command} ${ev.skipped ? '(not executed — simulation)' : `→ exit ${ev.exit_code}`}`),
  'pr.monitor': (v, ev) => { v.prMonitor = ev; }, // #809: the PR monitor's last read (pr-monitor-card.js)
  'pr.merge': (v, ev) => { v.prMerge = ev; }, // #810: the last merge tried from the card (pr-monitor-card.js)
  'pr.fix': (v, ev) => { v.prFixes = [...(v.prFixes || []), ev]; }, // #811: the fix rounds' events (pr-monitor-card.js)
  'local_preview.started': (v, ev) => {
    v.preview = { status: 'running', approval: ev.approval_id, url: ev.url || null, command: ev.command };
    orch(ev, `local preview started at ${ev.step_id}: ${ev.command} in ${ev.dir}`);
  },
  'local_preview.stopped': (v, ev) => {
    // exited by itself with an error: failed; stopped by the owner, the gate or the run: stopped
    const failed = !ev.reason && ev.exit_code != null && ev.exit_code !== 0;
    v.preview = { ...(v.preview || {}), status: failed ? 'failed' : 'stopped', approval: ev.approval_id, error: failed ? `The app exited with code ${ev.exit_code}: see its terminal.` : null };
    orch(ev, `local preview stopped${ev.reason ? ` (${ev.reason})` : ev.exit_code != null ? ` (exit ${ev.exit_code})` : ''}`);
  },
  'limit.exceeded': (v, ev) => orch(ev, `limit exceeded: ${ev.limit}`, 'error'),
  // #276: the memory guard stopped a process of this run / held a suite for low memory
  'process.killed': (v, ev) => orch(ev, ev.message || `memory guard stopped ${ev.command_line}`, 'warn'),
  'memory.hold': (v, ev) => orch(ev, `${ev.step_id || 'a step'} waited ${Math.round((ev.waited_ms || 0) / 1000)} s for memory${ev.recovered ? '' : ' (started anyway)'}`, 'warn'),
  'file.saved': (v, ev) => orch(ev, `💾 ${ev.step_id}${ev.agent ? ` (${ev.agent})` : ''} saved to ${ev.path}`),
  'budget.exceeded': (v, ev) => orch(ev, `💸 ${ev.provider} reached its monthly budget${ev.blocked ? ': turn blocked' : ' (not blocking)'}`, ev.blocked ? 'error' : 'warn'),
  'decision.logged': (v, ev) => orch(ev, `📝 ${ev.agent} logged ${ev.count} decision(s) in ${ev.path}`),
  log: (v, ev) => {
    orch(ev, ev.message, ev.level);
    // #233: a run recorded before costs were estimated: its agent's stopped attempt cost was never
    // recorded (the upgrade's stopped attempt after the line)
    const stopped = ev.level === 'error' && upgradedTail(v, ev).find((e) => e.type === 'session.attempt_stopped' && e.ts === ev.ts);
    const owner = stopped && v.sessions.get(stopped.session_id);
    if (owner) owner.costNotRecorded = true;
  },
  'supervisor.started': (v, ev) => orch(ev, `◆ supervisor called on ${ev.step_id}: ${ev.error || 'step failed'}`, 'supervisor'),
  'supervisor.decision': (v, ev, sess, effects) => effects.push(onSupervisorDecision(v, ev)),
};

// A live event's side effects (a replay has none: hydrateRun reloads and renders once, at its end).
function runEventEffects(v, ev, effects) {
  for (const fx of effects) {
    if (fx.toast) showToast(...fx.toast);
    if (fx.gateToast) showGateToast(v, fx.gateToast);
    if (fx.saveToIssue) v.saveToIssue = true;
    if (fx.openSaveToIssue) openSaveAfterAccept(v);
    if (fx.loadUsage) loadUsage();
    if (fx.loadUsageThrottled) loadUsageThrottled();
    if (fx.renderRunLists) renderRunListsSoon();
  }
  if (PROJECT_REFRESH_EVENTS.has(ev.type)) { window.loadProjectRunsThrottled?.(); window.loadWorkflowRunsThrottled?.(); }
  if (RUN_ROW_EVENTS.has(ev.type)) refreshRunRow(ev.run_id);
  if (ev.type === 'workflow.finished' || ev.type === 'file.saved') window.loadArtifactsThrottled?.();
  if (ARTIFACT_EVENTS.has(ev.type)) window.ArtifactsPanel?.refreshRun(ev.run_id);
  if (ev.type.startsWith('local_preview.')) paintGateApps();
  // the service re-checks the project's commits not pushed right after a local merge
  if (ev.type === 'worktree.merged' || ev.type === 'workflow.finished') setTimeout(refreshUnpushed, 1500);
  scheduleRender();
}

// A gate asked: inside its run (the Run screen's gate card, the run chats) it asks there; elsewhere a
// badge, a toast and the pending approvals list say it waits: nothing covers the screen
function showGateToast(v, ev) {
  const shown = state.view === 'run' && state.runId === ev.run_id;
  if (shown || window.duoShowsRun?.(ev.run_id) || window.arenaShowsRun?.(ev.run_id) || window.runChatShowsRun?.(ev.run_id)) return;
  // the gate's "What happened" line (#213)
  showToast(t('app.approval_waiting_run', { run: runLabel(v.run) }), t('app.gate_toast_click_to_open', { what: ev.brief?.headline || t('app.step_id', { step: ev.step_id }) }), ev.run_id, ev);
}

// Runs picked up mid-way (a reload, a window opened while runs are in progress) and past runs
// opened from disk: their steps, sessions, orchestrator log, trail and gates so far are replayed
// from the recorded events through reduceEvent, the reducer of live events, without their side
// effects; the live events that come in while the file is read wait in `hydrating` and follow in
// order. Every event has a `seq`: the view keeps the last one applied (lastSeq), so a live event
// already replayed is ignored. The replay reduces without rendering and renders once at the end;
// the streamed CLI output comes compacted (runs:events `activity`: tool calls and thinking, what
// Details shows of a turn).
async function hydrateRun(runId) {
  if (hydrating.has(runId)) return;
  hydrating.set(runId, []);
  let recorded = [];
  try { recorded = (await api.runEvents?.(runId, { activity: true })) || []; } catch { /* the live events only */ }
  const live = hydrating.get(runId);
  hydrating.delete(runId);
  const v = state.runs.get(runId);
  if (!v) return;
  const replay = RunProgress.hydrationEvents(recorded, live);
  if (replay.length > live.length) {
    const { run, past } = v;
    Object.assign(v, newRunView());
    v.run = run; // runs:active details until workflow.started is replayed
    v.past = past;
  }
  for (const ev of replay) reduceEvent(ev, false);
  // a past run still "running" after its events: in progress in the engine after all (followed
  // from now on), or it ended with the app (interrupted, no gate)
  if (v.past && v.run?.status === 'running') {
    let active = [];
    try { active = (await api.listActiveRuns?.()) || []; } catch { /* treated as not active */ }
    if (active.some((a) => a.runId === runId)) { v.past = false; loadActiveRuns(); } else { v.run.status = 'interrupted'; v.approvals.clear(); }
  }
  // the gates it still waits at say so, as when they were asked (the badge and gate card read v.approvals)
  const shown = (state.view === 'run' && state.runId === runId) || window.duoShowsRun?.(runId) || window.arenaShowsRun?.(runId) || window.runChatShowsRun?.(runId);
  if (!v.past && !shown) {
    for (const g of v.approvals.values()) showToast(t('app.approval_waiting_run', { run: runLabel(v.run) }), t('app.step_step_id_click_to_open', { step_id: agentLabel(g.step_id, v.run?.stepNames) }), runId, g);
  }
  renderRunListsSoon();
  scheduleRender();
}

// Workflow, project and issue of a run, from workflow.started or from runs:active.
function runInfo(x) {
  const inputs = x.inputs || {};
  const project = state.projects.find((p) => p.id === (x.project_id || x.projectId)) || state.projects.find((p) => Object.values(inputs).includes(p.folder));
  return {
    id: x.run_id || x.runId, startedAt: Date.parse(x.ts || x.startedAt) || Date.now(), mock: !!x.mock, workflow: x.workflow,
    version: x.version, inputs, issues: issuesOfRun(x), project: project?.name || null, projectId: project?.id || null,
    // agent key → name: the YAML's display (#245), the Agents menu's own names winning
    agentNames: x.display?.agents || x.agent_names ? { ...x.display?.agents, ...x.agent_names } : null,
    // step id → name (#245); #41: read at each use, its workflow's names in the interface language winning
    get stepNames() {
      const wf = (state.workflows || []).find((w) => w && (w.file === x.workflow || w.name === x.workflow));
      return window.WorkflowInputs ? WorkflowInputs.stepNamesOf(x.display?.steps, wf) : x.display?.steps || null;
    },
    chain: ChainModel.runChain(x), // its chain (#134)
    // `type: workflow` steps (#174): the run that started this one, the runs this one started
    parentRun: x.parent_run || x.parentRun || null, childRuns: [...(x.childRuns || [])],
  };
}

// "Accept and save to issue #n" was chosen at a gate (#125): when the run ends with success, the Save to
// issue preview opens (views/duo/); the issue changes only once the owner confirms it there. Cancelling
// keeps the document accepted and Save to issue available later (Write & Review chat, Run Details).
function openSaveAfterAccept(v) {
  v.saveToIssue = false;
  const issue = v.run?.issues?.[0];
  if (!issue) return;
  if (v.run.status !== 'success') {
    showToast(t('app.not_saved_to_issue_number', { number: issue.number }), t('app.the_run_ended_status_the_document', { status: v.run.status }), v.run.id);
    return;
  }
  if (typeof window.openDuoSaveToIssue !== 'function') return;
  // the service lets the run go just after its last event: the preview reads it as a finished run
  setTimeout(() => window.openDuoSaveToIssue({ runId: v.run.id, issue, mock: v.run.mock, docSkill: v.run.inputs?.document_skill || '' }), 500);
}

// An agent's readable name (display-name.js); the slug stays in tooltips. A step's too (#245), with
// the run's stepNames.
const agentLabel = (slug, names) => (window.displayName ? displayName(slug, names) : String(slug || ''));

// Finished runs that are not shown are forgotten (their chat and files keep everything).
function pruneRuns() {
  for (const [id, v] of state.runs) {
    if (state.runs.size <= 8) return;
    if (id !== state.runId && v.run?.status !== 'running') state.runs.delete(id);
  }
}

// The supervisor's decision on a step: the orchestrator's line; returns its toast's effect (shown while live).
function onSupervisorDecision(v, ev) {
  const target = ev.action === 'goto' && ev.goto ? ` ${ev.goto}` : '';
  // #71: it answered the gate itself, so nobody was asked
  const what = ev.kind === 'escalation' && ev.action === 'route' ? t('app.supervisor_answered_gate', { step: ev.step_id, answer: ev.route }) : `supervisor → ${ev.action}${target}`;
  orch(ev, `◆ ${what}${ev.cause_class ? ` [${ev.cause_class}]` : ''} — ${ev.explanation || ''}${ev.note ? ` (${ev.note})` : ''}`, 'supervisor');
  const params = { step: ev.step_id, run: runLabel(v.run), action: SUP_ACTIONS[ev.action] || ev.action };
  return { toast: [liveRuns().length > 1 ? t('app.supervisor_on_step_of_run', params) : t('app.supervisor_on_step', params), ev.explanation, ev.run_id] };
}

// #368: run.pausing / run.pause_cancelled → the run's pause (the Run screen's pause line) and the orchestrator's line.
function onPauseEvent(v, ev) {
  const pausing = ev.type === 'run.pausing';
  if (v.run) v.run.pause = pausing ? { state: 'pausing', step: ev.step_id, agents: ev.agents, command: ev.command, at: ev.ts } : null;
  orch(ev, pausing ? `pausing after the current turn${ev.step_id ? ` (${ev.step_id})` : ''}` : 'pause cancelled: the run goes on', 'transition');
}

// #368: where a paused run stopped and whose turn is next (its Resume continues there); null for any other end.
const finishedPause = (ev) => (ev.status === 'paused' && ev.paused ? { state: 'paused', ...ev.paused } : null);

// A live engine event (window.api): its run's view (reduceEvent), then its side effects.
function onEvent(ev) {
  // #794: a live merge may have changed a repository workflow, whether or not its run is known here yet
  // (a run being hydrated holds its events back: no effects for them)
  if (ev.type === 'worktree.merged') setTimeout(refreshWorkflowsAcceptance, 1500);
  const applied = reduceEvent(ev, true);
  if (applied) runEventEffects(applied.v, ev, applied.effects);
}

// a run starting or ending reloads the lists' loaded pages (throttled); the rest updates the run's own row (#200)
const PROJECT_REFRESH_EVENTS = new Set(['workflow.started', 'workflow.finished']);
const RUN_ROW_EVENTS = new Set(['session.closed', 'session.opened', 'session.status', 'step.finished', 'step.started', 'workflow.finished']);

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
  if (state.view === 'run') window.renderRunScreen?.();
}

function renderTicking() {
  if (liveRuns().length) renderHeader();
  if (state.run?.status === 'running' && state.view === 'run') window.renderSessions?.();
}

function totals(sessions = state.sessions) {
  const { usd: cost, approx } = SessionCost.runCost([...sessions.values()], state.usage?.prices); // #72
  const t = { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, cost, approx };
  sessions.forEach((s) => {
    for (const k of ['input', 'output', 'cache_read', 'cache_write', 'reasoning']) t[k] += s.tokens?.[k] || 0;
  });
  return t;
}

// #412: the bar no longer shows a run (its status, KPIs, Stop live on the Run screen): the sidebar's
// runs, the Start drawer's button and the dashboard
function renderHeader() {
  renderNavRuns();
  const blocked = oneRunAtATime();
  setStartDisabled(blocked || !state.wf || !!state.wf.error);
  $('#btn-start').textContent = blocked ? t('app.a_workflow_is_already_running') : state.pipeline ? t('app.start_pipeline') : t('app.start_workflow');
  if (state.view === 'dashboard') renderDashboard();
}

// The runs the sidebar lists under Run: in progress, or failed/interrupted/paused (they need attention:
// resume, supervisor, and are otherwise unreachable here), or waiting at a gate. A run that
// finished leaves the list, even when it is the one shown in the top bar.
const navRunsList = () => [...state.runs.values()].filter((v) => v.run && (['running', 'failed', 'interrupted', 'paused'].includes(v.run.status) || v.approvals.size));
// The Run item's dot (#142): what is in progress across runs, not the run shown in the top bar.
// A gate wins (it needs the owner), then a running run, then a failed/interrupted one still listed.
function navRunState(list) {
  const waiting = list.filter((v) => v.approvals.size).length;
  const running = list.filter((v) => v.run.status === 'running').length;
  const failed = list.length - list.filter((v) => v.approvals.size || v.run.status === 'running').length;
  if (waiting) return { status: 'waiting', title: t('app.runs_waiting_for_you', { count: waiting }) };
  if (running) return { status: 'active', title: t('app.runs_in_progress', { count: running }) };
  if (failed) return { status: 'failed', title: t('app.runs_failed_open_to_resume', { count: failed }) };
  return { status: 'idle', title: t('app.no_run_in_progress') };
}

// The Run menu item and the runs listed under it (navRunsList), even a single one (#113): each
// row has its status dot, its title (#84) and issues, its workflow and the step it is at or the
// gate it waits at; the selected run is highlighted. The Run item's dot sums them up (navRunState),
// a count badge shows when several are listed and the gates badge counts the gates across runs.
// A run waiting at a gate is listed until the engine no longer lists the gate (loadActiveRuns);
// clicking it opens the gate in its run. The rows are rebuilt only when their markup changes.
function renderNavRuns() {
  const gates = pendingGates().length;
  const badge = $('#nav-run-gates');
  badge.classList.toggle('hidden', !gates);
  badge.textContent = String(gates);
  badge.title = t('app.approvals_waiting_click_to_review', { count: gates });
  const list = navRunsList();
  askPrStates(list.map((v) => v.run));
  const sum = navRunState(list);
  const item = $('#nav-run');
  item.className = `nav-item nav-run st-${sum.status}${state.view === 'run' ? ' active' : ''}${state.run || list.length ? '' : ' hidden'}`;
  item.title = sum.title;
  const count = $('#nav-run-count');
  count.classList.toggle('hidden', list.length < 2);
  count.textContent = String(list.length);
  count.title = t('app.length_runs_listed_below', { length: list.length });
  const box = $('#nav-runs');
  box.classList.toggle('hidden', !list.length);
  if (!list.length) { box.innerHTML = ''; box.dataset.html = ''; return; }
  const html = list.map(({ run: r, approvals, steps }) => {
    const gate = [...approvals.values()][0];
    const refs = issueRefs(r);
    const step = [...steps].filter(([, s]) => s.status === 'running').map(([id]) => id).join(', ');
    const at = gate ? t('app.waiting_for_you_at', { step: gate.step_id }) : r.status === 'running' ? step || 'starting' : statusLabel(r); // #83
    const title = gate ? t('app.waiting_for_you_at_title', { run: runLabel(r), step: gate.step_id }) :`${runLabel(r)} — ${statusLabel(r)}${step && r.status === 'running' ? ` at ${step}` : ''}`;
    return `<button type="button" class="nav-run-item st-${gate ? 'waiting' : runSessionStatus(r.status)}${r.id === state.runId ? ' selected' : ''}" data-run="${esc(r.id)}"${gate ? ' data-gate="1"' : ''} title="${esc(refs ? `${title} · ${refs}` : title)}">
      <span class="status-dot"></span>
      <span class="nav-run-text"><span class="nav-run-title">${esc(runTitle(r))}</span><span class="nav-run-sub">${refs ? `<span class="nav-run-issues">${esc(refs)}</span>` : ''}<span class="nav-run-at">${esc(at)}</span></span>${r.workflow || runPr(r) ? `<span class="nav-run-sub">${r.workflow ? `<span class="nav-run-wf">${esc(r.workflow.replace(/\.ya?ml$/i, ''))}</span>` : ''}${prBadge(r, { compact: true })}</span>` : ''}</span>
      ${approvals.size ? `<span class="nav-gates" title="${t('app.approval_waiting')}">${approvals.size}</span>` : ''}
    </button>`;
  }).join('');
  if (box.dataset.html === html) return;
  box.dataset.html = html;
  box.innerHTML = html;
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => (b.dataset.gate ? openGateOf(b.dataset.run) : selectRun(b.dataset.run))));
}

// runId: the run it is about (a click shows it); gate: an approval.requested event to open.
// Never blocks anything: it hides by itself and its × dismisses it.
// action (#281): { label, run, done? }, a button inside the toast ("Undo"). toast.js (openToast)
// draws it, runs it and counts the toast down: 10 s with an action, 15 for a gate, 7 otherwise.
/** @param {any} title @param {any} [detail] @param {any} [runId] @param {any} [gate] @param {{ action?: { label: string, run: () => any } | null }} [options] */
function showToast(title, detail, runId = null, gate = null, { action = null } = {}) {
  const html = (head, text) => `<button type="button" class="toast-close" aria-label="${t('common.dismiss')}" title="${t('common.dismiss')}">×</button><b>${esc(head)}</b>${text ? `<span>${esc(String(text).slice(0, 220))}</span>` : ''}`;
  const onClick = (e) => {
    if (e.target.closest('.toast-close')) return; // dismissed only
    // a gate still waiting opens inside its run (its chat, or the Run screen's gate card)
    if (gate && state.runs.get(gate.run_id)?.approvals.has(gate.approval_id)) return openGateOf(gate.run_id);
    if (runId && state.runs.has(runId)) selectRun(runId);
    else if (state.run) selectRun(state.run.id);
  };
  openToast($('#toast'), { html, title, detail, action, ms: gate ? 15000 : 7000, onClick });
}

// #208: the page itself never scrolls (each view scrolls inside); a clipped root still scrolls
// programmatically (scrollIntoView, focus), which shifted the whole app sideways: undo it at once.
window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });
// #466: a file or a link dropped outside a drop zone never navigates the window to it (the zones
// handle their own); text dragged into a text box still drops there
const navigatingDrop = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'text/uri-list');
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { if (navigatingDrop(e)) e.preventDefault(); });

// The screens of views/ load after this script and register their markup as they load; the page may
// yield between scripts (an IPC reply can run then), so init starts once every screen is in place.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
