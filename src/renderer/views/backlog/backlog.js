// Backlog screen: a project's issues synced from its git platform (src/backlog.js), as a list or a
// kanban (To do / In progress / Waiting for approval / Done). Shows the last sync right away and
// syncs again in the background each time the screen opens. The platform defaults to
// Settings › General › Backlog and can be switched here.
// Selected To do issues can be assigned to a workflow: they are queued and the service runs them
// one at a time (the run records its issues), as separate runs or, when asked, as one run for all
// of them (one branch, one PR/MR). Issues link to the runs working on them. The Assign dialog's
// "When it finishes" (#134, chain-picker.js) chains each run to what follows it.
// Work a local workflow merged into the local base but did not push shows in "Merged locally"; the
// "Not pushed" alert pushes it (and updates from origin first when origin moved); a conflict on
// the update goes to a run of the local workflow, whose developer resolves it.
// Archive (#238, rules in backlog-archive.js): the selection bar's Archive (n) and each open issue's
// menu close issues as not planned with the `archived` label; the Archived chip lists them, with Restore.
// The list narrows by state, by text and by labels (the rule is in backlog-labels.js: AND across
// label groups, OR within one); the selected labels are remembered per project and a label chip
// on an issue toggles its label. Selection and assignment only count the issues shown.
// Issues filed by the issue tracker (#81) carry `impact:<1-5>` / `complexity:<1-5>` labels: shown as
// badges, sortable (backlog-labels.js sortIssues), filterable like any label. New issue opens the
// Start drawer on the issue-tracker workflow for the selected project and platform.
// The third mode, Roadmap, is backlog-roadmap.js (ordered stages of runs); the assign dialog's
// "Add to roadmap" plans the selection as a new stage, and assigning an issue the roadmap plans asks first.
// The Product Owner's drawer (backlog-po.js) applies a proposed group through window.BacklogActions.
// Send to Product Owner (n) (#169), next to Assign workflow…, attaches the selection to the drawer's
// question (window.BacklogPO.attach); the selection is kept.
// Alerts (#270, alerts.js): what the page has to say sits at its top, above the filter row, one at a
// time (renderAlerts): a roadmap paused by an item and the queue's error (errors), a stale Backlog
// Refresh and the retired deprioritized label (warnings), local merges not pushed (an info).
// Backlog Refresh (#161): an alert suggests a refresh run when the last one is stale
// and the base got merges since (Refresh now opens the Start drawer prefilled; Dismiss for today);
// issues the last refresh updated carry a "refreshed" badge for a day.
// Epics (#138): each card shows its epic as a badge (a click filters by it); the epic select narrows
// the list and the kanban to one epic or to "No epic" (rule in backlog-epics.js, AND with the labels
// and the search); the fourth mode, Epics, lists the epics with their progress (closed, done in the
// roadmap) and members, the "Auto-place new issues" option (project.autoEpic) and "Organize into
// epics…", which asks the Product Owner (window.BacklogPO).
// Page tabs (#217): Board (the list or the kanban, a List / Kanban switch, with the state, search,
// label and sort filters) and Epics; the tab and the Board's view are remembered. The epic select is
// one choice for the Board and the Roadmap.
// The Roadmap is a screen of its own (#254, Code & Build › Roadmap: open work by default, Show all
// remembered): the second view this file registers, drawn in the Backlog's section (the registry's
// `section`) with the same data, alerts and Product Owner drawer; bl.mode is 'roadmap' on it.
// The project is the app's, chosen in the header (#254, window.CurrentProject).
// Epics are not work (#253): an issue with `isEpic` is left out of the Board (list, kanban, their
// counts and filters), cannot be selected, assigned or planned, and shows only in the Epics view.
// Registers itself with registerView (view-registry.js), with the Product Owner drawer and the
// assign / push / unqueue dialogs; mount() wires them and adds the sidebar's unpushed badge.
// Uses app.js globals ($, esc, state, errMsg, dateOf, markdownHtml, showView, openModal,
// closeModal, devMode, wantsSimulation, openGateOf, openNextGate, selectRun, confirmDialog).
/* global api */
(() => {
  // Must match PLATFORMS in src/backlog.js (soon = no sync yet).
  const PLATFORMS = { github: { label: 'GitHub' }, gitlab: { label: 'GitLab' }, bitbucket: { label: 'Bitbucket', soon: true } };
  window.BACKLOG_PLATFORMS = PLATFORMS;
  const MODE_KEY = 'multiagent.backlogMode';
  // #217: the Board tab's last view (list or kanban) and the Roadmap's Show all (#268: its Planned |
  // All switch, All when set) with its date range
  const BOARD_KEY = 'multiagent.backlogBoard';
  const SHOW_ALL_KEY = 'multiagent.roadmapShowAll';
  const SINCE_KEY = 'multiagent.roadmapSince';
  const RELEASE_KEY = 'multiagent.roadmapRelease'; // #291: the Releases filter ('' all, 'next', a version)
  const WORKFLOW_KEY = 'multiagent.backlogWorkflow';
  const LABELS_KEY = 'multiagent.backlogLabels.'; // + project id
  const SORT_KEY = 'multiagent.backlogSort';
  const SORTS = ['complexity', 'impact', 'updated'];
  // #238: the one-time banner of the issues still labelled with the retired `deprioritized` (per project)
  const DEPRIORITIZED_KEY = 'multiagent.backlogDeprioritized';
  const ISSUE_TRACKER = 'issue-tracker.yaml';
  const REFRESH = 'backlog-refresh.yaml';
  // the one-off seed of #138: the Product Owner proposes epics for the open issues (same text as its chip)
  const ORGANIZE = 'Organize the open issues into epics';
  // #238: Archived = closed with the `archived` label; Closed shows the other closed issues
  const FILTERS = [['open', 'Open'], ['closed', 'Closed'], ['archived', 'Archived'], ['all', 'All']];
  // 'local': merged into the local base by a local workflow, not pushed yet (shown when there is any)
  const COLUMNS = [['todo', 'To do'], ['in_progress', 'In progress'], ['waiting', 'Waiting for approval'], ['local', 'Merged locally'], ['done', 'Done']];

  const load = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const save = (key, v) => { try { localStorage.setItem(key, v); } catch { /* storage unavailable */ } };

  const bl = {
    projects: [], projectId: null, platform: null, data: null, error: null, syncing: false,
    mode: 'list', filter: 'open', q: '', expanded: new Set(), seq: 0,
    selected: new Set(), workflows: [], labels: [], labelsOpen: false, epic: '', menu: null,
    sort: SORTS.includes(load(SORT_KEY)) ? load(SORT_KEY) : 'updated',
    board: load(BOARD_KEY) === 'kanban' || (load(BOARD_KEY) == null && load(MODE_KEY) === 'kanban') ? 'kanban' : 'list',
    showAll: load(SHOW_ALL_KEY) === '1',
    since: load(SINCE_KEY) || '',
    release: load(RELEASE_KEY) || '',
    latest: null, // #287: the Backlog read while the owner is busy, newer than what is shown (backlogChanged)
  };
  // #217: the page tab of a mode (Board: list / kanban); 'roadmap' is the Roadmap screen's (#254)
  const tabOf = (mode) => (mode === 'roadmap' || mode === 'epics' ? mode : 'board');
  const onRoadmapTab = () => bl.mode === 'roadmap';
  // the Backlog screen's remembered tab: Epics, or the Board in its last view
  const backlogMode = () => (load(MODE_KEY) === 'epics' ? 'epics' : bl.board);
  bl.mode = backlogMode();
  function setMode(mode) {
    bl.mode = mode;
    save(MODE_KEY, mode);
    if (tabOf(mode) === 'board') { bl.board = mode; save(BOARD_KEY, mode); }
  }
  // #254: the Backlog and the Roadmap screens show one project's backlog. Opened from the menu, a
  // screen reads and syncs it again; a switch this file makes (keepData) keeps what is loaded.
  let keepData = false;
  // Home's flow strip (#255) opens the board's columns for one visit (asked, then shown): the next
  // opening shows the remembered mode again
  let columns = null;
  // the roadmap stage openStage was asked for before the backlog was read: shown by the read
  let stageToShow = null;
  function openScreen(roadmap) {
    stageToShow = null;
    if (roadmap) bl.mode = 'roadmap';
    else if (columns === 'asked') { bl.mode = 'kanban'; columns = 'shown'; }
    else if (bl.mode === 'roadmap' || columns === 'shown') { bl.mode = backlogMode(); columns = null; }
    if (keepData && bl.data) render(); else refreshBacklog();
    keepData = false;
  }
  function switchScreen(view) {
    keepData = true;
    showView(view);
  }
  const {
    hasLabel,
    labelOptions,
    matchesLabels,
    pruneLabels,
    sortIssues,
    toggleLabel,
    triageScores,
  } = window.BacklogLabels;
  const {
    epicOptions,
    epicProgress,
    matchesEpic,
    NONE: NO_EPIC,
    pruneEpic,
  } = window.BacklogEpics;
  const {
    archiveBlockReason,
    archiveConfirmText,
    deprioritizedIssues,
    isArchived,
    issueState,
  } = window.BacklogArchive;
  const $b =(sel) => document.querySelector(sel);
  const project = () => bl.projects.find((p) => p.id === bl.projectId) || null;
  const visible = () => state.view === 'backlog' || state.view === 'roadmap';
  // #253: an epic groups issues, it is never work to assign
  const selectable = (i) => i.state === 'open' && i.column === 'todo' && !i.isEpic;

  async function refreshBacklog() {
    try {
      [bl.projects, state.settings, state.ws] = await Promise.all([api.listProjects(), api.getSettings(), api.getWorkspace()]);
    } catch (e) {
      bl.error = errMsg(e);
      render();
      return;
    }
    $b('#backlog-dir').textContent = state.ws?.backlog || '';
    // #254: the app's project, chosen in the header (current-project.js)
    await selectProject(window.CurrentProject.refresh(bl.projects));
  }

  async function selectProject(id) {
    bl.projectId = id;
    // the Product Owner's drawer, open for another project (the header stays reachable): this one's conversation
    if (window.BacklogPO?.openProjectId() && window.BacklogPO.openProjectId() !== id) window.BacklogPO.open();
    bl.seq++; // a sync still running for the previous project is ignored
    bl.syncing = false;
    bl.data = null;
    bl.error = null;
    bl.expanded.clear();
    bl.selected.clear();
    bl.labels = loadLabels(id);
    bl.labelsOpen = false;
    bl.epic = '';
    if (!id) { render(); return; }
    try { setData(await api.getBacklog(id)); } catch (e) { bl.error = errMsg(e); }
    bl.platform = bl.data?.platform || state.settings.backlogPlatform || 'github';
    render();
    // the stage openStage was asked for before this read
    const stage = stageToShow;
    stageToShow = null;
    if (stage && bl.data && state.view === 'roadmap') openStage(stage);
    if (project()?.repo && !PLATFORMS[bl.platform]?.soon) sync();
  }

  // what the screen shows, to tell an automatic refresh that changes nothing (#214)
  let shownData = '';
  // (`edit`, #281: the id a save answers with for its Undo toast, is not something the screen shows:
  // with it in the key, the backlog:changed that follows every edit redrew the same list once more)
  const dataKey = (id, data) => `${id}:${JSON.stringify(data ? { ...data, edit: undefined } : null)}`;
  function setData(data) {
    bl.data = data;
    shownData = dataKey(bl.projectId, data);
    // selected issues that left To do (assigned, closed) are dropped from the selection
    const ok = new Set((data?.issues || []).filter(selectable).map((i) => i.number));
    for (const n of [...bl.selected]) if (!ok.has(n)) bl.selected.delete(n);
    // labels no synced issue has any more leave the filter
    if (data?.issues) setLabels(pruneLabels(bl.labels, data.issues));
    bl.epic = pruneEpic(bl.epic, data?.epics);
    // the cards' run titles and PRs, shared with the other run lists (app.js); the latest run of
    // each card has its PR state read when the service has not yet
    const runs = (data?.issues || []).flatMap((i) => i.runs || []);
    window.noteRunMeta?.(runs);
    window.askPrStates?.((data?.issues || []).map((i) => i.runs?.[0]).filter(Boolean));
    // the Product Owner's drawer redraws its groups' applied state (backlog-po.js, #140)
    document.dispatchEvent(new CustomEvent('backlog:data'));
  }

  function loadLabels(id) {
    if (!id) return [];
    try {
      const v = JSON.parse(load(LABELS_KEY + id) || '[]');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch { return []; }
  }
  function setLabels(list) {
    bl.labels = list;
    if (bl.projectId) save(LABELS_KEY + bl.projectId, JSON.stringify(list));
  }

  async function sync() {
    const p = project();
    if (!p || bl.syncing) return;
    const seq = ++bl.seq;
    bl.syncing = true;
    bl.error = null;
    render();
    try {
      const data = await api.syncBacklog(p.id, bl.platform);
      if (seq === bl.seq && bl.projectId === p.id) setData(data);
    } catch (e) {
      if (seq === bl.seq) bl.error = errMsg(e);
    } finally {
      if (seq === bl.seq) bl.syncing = false;
      render();
    }
  }

  // Re-reads the cached issues with their runs and queue (cheap, no sync). An automatic refresh
  // whose data is the same as what is shown renders nothing (#214: no flicker under the owner).
  async function reload() {
    const id = bl.projectId;
    if (!id || bl.syncing) return;
    try {
      const data = await api.getBacklog(id);
      if (!data || bl.projectId !== id || bl.syncing) return;
      if (dataKey(id, data) === shownData) return;
      setData(data);
      render();
    } catch { /* keep what is shown */ }
  }

  // Runs start, move between steps, stop at gates and end while the screen is open (#214): only the
  // events that change an item's status, progress ring (#194) or waiting badge refresh the screen,
  // at most once per RUN_THROTTLE_MS, and through liveReload (never under an open Edit form). The
  // session messages agents send several times a second refresh nothing.
  const RUN_THROTTLE_MS = 2000;
  const RUN_STATUS_EVENTS = /^(workflow\.(started|finished)|step\.(started|finished|waiting)|approval\.(requested|resolved))$/;
  let runTimer = null;
  let runLast = 0;
  api.onEvent((ev) => {
    if (ev?.type && !RUN_STATUS_EVENTS.test(ev.type)) return;
    if (!visible() || runTimer) return;
    runTimer = setTimeout(() => { runTimer = null; runLast = Date.now(); liveReload(); }, Math.max(0, runLast + RUN_THROTTLE_MS - Date.now()));
  });
  // The queue also changes without run events (a start that fails, the next issue starting), and a
  // live roadmap's refill (#164) with none. Also the fallback of the file watch (#204): while the
  // service cannot watch backlog/, the Roadmap screen is polled every 5 s.
  let watching = true;
  api.backlogWatching?.().then((w) => { watching = w !== false; }).catch(() => {});
  setInterval(() => {
    const busy = bl.data?.queue?.items?.length || bl.data?.issues?.some((i) => i.runs?.[0]?.status === 'running') || bl.data?.roadmap?.live || bl.data?.refresh?.running;
    if (visible() && (busy || (!watching && bl.mode === 'roadmap'))) liveReload();
  }, 5000);
  // #272: the Roadmap cards' run timers move every second (their text only: nothing is redrawn)
  setInterval(() => {
    if (visible() && !document.hidden && bl.mode === 'roadmap') window.BacklogRoadmap.tick($b('#bl-list'));
  }, 1000);

  // #204: the screen follows the backlog/ files live (the service watches the folder and pushes
  // backlog:changed, debounced). The owner is never disturbed: while they type in a field of the
  // screen, drag, or edit a roadmap item or a stage's note, the reload waits until they are done
  // (the Edit form says "The roadmap changed"); the scroll position and expanded rows are kept.
  let pendingReload = null;
  const ownerBusy = () => {
    const el = document.activeElement;
    const typing = el?.closest?.('#view-backlog') && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.closest('.modal');
    return !!typing || (bl.mode === 'roadmap' && !!window.BacklogRoadmap?.busy());
  };
  // Every automatic refresh (run events, the 5 s poll, backlog:changed) goes through liveReload; a
  // direct reload() is only for the owner's own actions (Sync, Reload, after Save). While the owner
  // is busy nothing replaces the DOM (#214): the notice is added once, and only when the data differs.
  async function liveReload() {
    if (!visible() || document.hidden) return;
    if (ownerBusy()) {
      // read each time (#287): the notice says what changed since the form opened
      if (!(await backlogChanged()) && !pendingReload) return;
      staleNotice();
      pendingReload ??= setInterval(() => { if (!ownerBusy()) { clearInterval(pendingReload); pendingReload = null; liveReload(); } }, 1000);
      return;
    }
    const view = $b('#view-backlog');
    const top = view?.scrollTop;
    await reload();
    if (view && top != null) view.scrollTop = top;
  }
  // whether the Backlog now differs from what is shown (kept in bl.latest for the notice)
  async function backlogChanged() {
    const id = bl.projectId;
    if (!id) return false;
    try {
      const data = await api.getBacklog(id);
      const changed = !!data && bl.projectId === id && dataKey(id, data) !== shownData;
      bl.latest = changed ? data : null;
      return changed;
    } catch { return false; }
  }
  // the open Edit form tells the owner the file changed under it, and what changed (#287: "1 item
  // updated elsewhere", against what is shown, updated on each change); Save applies only the form's
  // edit to the roadmap as it is now; Reload drops the unsaved values
  function staleNotice() {
    const form = $b('#view-backlog .rm-form');
    if (!form) return;
    const what = bl.latest ? window.BacklogRoadmap?.changedElsewhere?.(bl.data?.roadmap, bl.latest.roadmap) || '' : '';
    const text = `The roadmap changed${what ? `: ${what}` : ''}.`;
    const shown = form.querySelector('[data-bl-stale]');
    if (shown) {
      if (bl.latest) shown.querySelector('[data-bl-stale-text]').textContent = text;
      return;
    }
    const p = document.createElement('p');
    p.className = 'small muted bl-stale';
    p.dataset.blStale = '';
    // (the text is counts and fixed words only, never data from the files)
    p.innerHTML = `<span data-bl-stale-text data-testid="roadmap-changed-notice" role="status">${text}</span> <button type="button" class="link-btn small" data-bl-stale-reload>Reload</button>`;
    p.querySelector('button').addEventListener('click', () => {
      window.BacklogRoadmap?.closeEdit();
      document.activeElement?.blur?.();
      shownData = ''; // the closed form is re-rendered even when the data changed back
      liveReload();
    });
    form.prepend(p);
  }
  api.onBacklogChanged?.((ev) => {
    if (ev?.watching === false) { watching = false; return; }
    watching = true;
    if (ev?.projectId && ev.projectId === bl.projectId) liveReload();
  });

  // Opens a run in the remembered run view (Chat or Details, showRun in app.js).
  function openRun(el) {
    window.showRun(el.dataset.run, { workflow: el.dataset.workflow });
  }

  // "Enrich in Write & Review" (#103): the Write & Review screen prefilled with the issue (an enriched
  // issue by default), in this project, read-only; the owner edits and starts it.
  function enrichIssue(number) {
    const issue = bl.data?.issues?.find((i) => i.number === number);
    if (!issue) return;
    window.openDuoForIssue({
      projectId: bl.projectId,
      platform: bl.data.platform,
      issue: { number: issue.number, title: issue.title, url: issue.url, body: issue.body || '', labels: issue.labels || [] },
    });
  }

  // New issue (#81): the Start drawer on the issue-tracker workflow, for this project and platform;
  // the owner writes the request and starts it. The issue shows here after the next sync.
  function newIssue() {
    if (!project()?.repo) return;
    openDrawer({ workflow: ISSUE_TRACKER, project: bl.projectId, inputs: { git_platform: bl.platform === 'gitlab' ? 'gl' : 'gh' } });
  }

  // "Review approval" opens its run, where the gate is answered (the run chat, or the Run screen's
  // gate card): never a dialog over the Backlog.
  function openGate(el) {
    const run = el.closest('[data-n]')?.querySelector('[data-run]');
    if (run && state.runs.has(run.dataset.run)) openGateOf(run.dataset.run);
    else if (run && isRunLive(run.dataset.run)) openRun(run);
    else openNextGate();
  }

  // ---- assign a workflow -------------------------------------------------------------------
  const skipInput = (k, def) => k === 'task' || k === 'issue' || k === 'issues' || def.type === 'run' || ((def.type || 'string') === 'string' && /path|dir/i.test(k));

  // The workflow's one-line summary (its first sentence) under the select; all of it in "About this workflow".
  const firstSentence = (s) => (String(s || '').match(/^.*?[.!?](?=\s|$)/)?.[0] || String(s || '')).trim();

  // The workflow's inputs (WorkflowInputs, #116): human labels, pills / switches, show_if; the values
  // remembered for this project and workflow, else the project's detected language and default branch.
  // A saved pipeline (#135) is an option `pipe:<file>`: its first workflow receives the issues (its
  // inputs drawn here, its fixed ones set), the rest of the pipeline follows each run instead of
  // "When it finishes".
  const PIPE = 'pipe:';
  const assignPipeline = () => (bl.pipelines || []).find((p) => PIPE + p.file === $b('#assign-workflow').value) || null;
  function renderAssignInputs() {
    const pipe = assignPipeline();
    const wf = bl.workflows.find((w) => w.file === (pipe ? pipe.stages[0].workflow : $b('#assign-workflow').value));
    const about = (pipe ? pipe.description : wf?.description) || '';
    $b('#assign-wf-desc').textContent = firstSentence(about);
    $b('#assign-wf-desc').title = about;
    $b('#assign-wf-about-text').textContent = about;
    $b('#assign-wf-about').classList.toggle('hidden', !about || firstSentence(about) === about.trim());
    const saved = bl.data?.queue?.inputs?.[wf?.file] || {};
    const defs = Object.fromEntries(Object.entries(wf?.inputs || {}).filter(([k, def]) => !skipInput(k, def || {})));
    const box = $b('#assign-inputs');
    box.innerHTML = WorkflowInputs.formHtml(defs, { values: saved, id: (k) => `ai-${k}`, attrs: (k) => `data-input="${esc(k)}"` });
    $b('#assign-settings').classList.toggle('hidden', !Object.keys(defs).length);
    // #262: each agent's provider / model / effort for these runs; a pipeline keeps its workflows'
    const agentsBox = $b('#assign-agents-list');
    if (agentsBox) {
      agentsBox.innerHTML = !pipe && wf && window.AgentOverrides ? AgentOverrides.html(wf, { prefix: 'assign-ao', hideLegend: true }) : '';
      $b('#assign-agents').classList.toggle('hidden', !agentsBox.innerHTML);
    }
    WorkflowInputs.applyHints(box, defs, bl.projectId, { keep: Object.keys(saved) });
    for (const [k, v] of Object.entries(pipe?.stages[0].inputs || {})) if (defs[k]) WorkflowInputs.set(box, k, v);
    assignChain().refresh();
    $b('#assign-chain').classList.toggle('hidden', !!pipe);
    const strip = $b('#assign-pipeline');
    strip.classList.toggle('hidden', !pipe);
    strip.innerHTML = pipe ? `<div class="drawer-pipeline-head"><span class="chain-banner-title">Pipeline</span><span class="badge">${pipe.stages.length} stages</span></div>
      ${ChainModel.pipelineStagesHtml(pipe, { names: Object.fromEntries((bl.chainWorkflows || []).map((w) => [w.file, w.name])), current: 0 })}
      <p class="muted small">Each issue's run is the first stage; the next stages follow it when it succeeds. A failed or stopped stage pauses its pipeline.</p>` : '';
    // a roadmap stage runs one workflow: a pipeline is assigned, not planned
    const toRoadmap = $b('#btn-assign-roadmap');
    if (toRoadmap) {
      toRoadmap.disabled = !!pipe;
      toRoadmap.title = pipe ? 'A roadmap stage runs one workflow: assign the pipeline instead' : 'Plan it instead: a new stage at the end of the roadmap, started with the roadmap';
    }
    updateAssignNote();
  }
  // The dialog's "When it finishes" (#134): every workflow can follow, not only those with a task.
  let chainPicker = null;
  const assignChain = () => (chainPicker ??= ChainPicker.mount($b('#assign-chain'), {
    workflows: () => bl.chainWorkflows || [], source: () => (bl.chainWorkflows || []).find((w) => w.file === $b('#assign-workflow').value) || null,
  }));
  // The values to send: the YAML values (an enum's value, a switch as true/false).
  const assignInputs = () => WorkflowInputs.read($b('#assign-inputs'));
  // #262: the Agents section's choices, only what differs from the workflow (null when none)
  const assignAgentOverrides = () => {
    const o = window.AgentOverrides?.read($b('#assign-agents-list')) || {};
    return Object.keys(o).length ? o : null;
  };

  // Selected issues that already have work in flight: an open PR/MR, or a run in progress or waiting.
  const prName = (p) => `${bl.data?.platform === 'gitlab' ? 'MR !' : 'PR #'}${p.number}`;
  function inFlight(i) {
    const why = (i.pullRequests || []).map((p) => `open ${prName(p)}${p.draft ? ' (draft)' : ''}`);
    const r = i.runs?.[0];
    if (r && (r.waiting || r.status === 'running')) why.push(`run ${r.waiting ? 'waiting for approval' : 'in progress'} (${r.workflow || 'workflow'})`);
    return why;
  }
  const busySelected = () => (bl.data?.issues || []).filter((i) => bl.selected.has(i.number) && isShown(i) && inFlight(i).length);
  // The issues the assignment sends: without the busy ones unless the user assigns them anyway.
  function assignNumbers() {
    const skip = $b('#assign-skip-busy')?.checked ? new Set(busySelected().map((i) => i.number)) : new Set();
    return shownSelected().filter((n) => !skip.has(n));
  }

  function renderAssignBusy() {
    const busy = busySelected();
    const box = $b('#assign-busy');
    box.classList.toggle('hidden', !busy.length);
    if (!busy.length) { box.innerHTML = ''; return; }
    const plural = busy.length > 1;
    box.innerHTML = `
      <span class="warn-text small"><b>${busy.length} of the selected issues ${plural ? 'already have' : 'already has'} work in flight.</b> Starting ${plural ? 'them' : 'it'} again may duplicate it.</span>
      <ul class="small">${busy.map((i) => `<li>#${i.number} ${esc(i.title)}: ${esc(inFlight(i).join(', '))}</li>`).join('')}</ul>
      <label class="check"><input type="checkbox" id="assign-skip-busy" checked /><span>Skip ${plural ? 'them' : 'it'} (uncheck to assign anyway)</span></label>`;
    $b('#assign-skip-busy').onchange = updateAssignNote;
  }

  // Two or more issues can go as separate runs (default) or as one run: one branch, one PR/MR.
  const maxGroup = () => state.settings?.backlogMaxGroup || 5;
  const grouped = () => assignNumbers().length > 1 && document.querySelector('input[name="assign-group"]:checked')?.value === 'group';

  function updateAssignNote() {
    const numbers = assignNumbers();
    const n = numbers.length;
    const group = grouped();
    const runs = group ? 1 : n;
    const tooMany = group && n > maxGroup();
    const mock = $b('#assign-mock').checked;
    const plural = runs > 1 ? 's' : '';
    $b('#assign-grouping').classList.toggle('hidden', n < 2);
    $b('#btn-assign-ok').disabled = !n || tooMany;
    $b('#btn-assign-ok').textContent = `${mock ? 'Simulate' : 'Start'} ${runs} run${plural}`;
    const note = $b('#assign-note');
    note.className = `small ${n && !tooMany ? 'muted' : 'warn-text'}`;
    const what = group ? `${n} issues → 1 run, 1 ${bl.data?.platform === 'gitlab' ? 'MR' : 'PR'} closing ${numbers.map((x) => `#${x}`).join(', ')}.` : '';
    note.textContent = !n ? 'Nothing to start: every selected issue is skipped.'
      : tooMany ? `One run takes at most ${maxGroup()} issues (Settings › General › Backlog): select fewer or send them as separate runs.`
        : mock ? `${what ? `${what} ` : ''}${runs} simulated run${plural}: no CLI is called and nothing is spent.`
          : `${what ? `${what} ` : ''}${runs} real run${plural}: ${runs > 1 ? 'they use' : 'it uses'} your CLI subscriptions. Human gates still wait for you.`;
  }

  // prefill: the Product Owner's proposed group (assignGroup): { workflow, inputs, group }
  async function openAssign(prefill = null) {
    if (!shownSelected().length) return;
    $b('#assign-error').textContent = '';
    try {
      bl.chainWorkflows = (await api.listWorkflows()).filter((w) => !w.error);
      bl.workflows = bl.chainWorkflows.filter((w) => w.inputs?.task);
      // the pipelines whose first workflow can receive the issues (#135)
      const pipes = api.listPipelines ? await api.listPipelines().catch(() => []) : [];
      bl.pipelines = pipes.filter((p) => !p.error && bl.workflows.some((w) => w.file === p.stages[0]?.workflow));
    } catch (e) { bl.error = errMsg(e); render(); return; }
    if (!bl.workflows.length) { bl.error = 'No workflow has a task input to receive the issues.'; render(); return; }
    // in the order selected (the order the runs start, or the order of a group's task)
    const issues = shownSelected().map((n) => (bl.data?.issues || []).find((i) => i.number === n)).filter(Boolean);
    $b('#assign-issues').innerHTML = issues.map((i) => `<li title="${esc(`#${i.number} ${i.title}`)}"><span class="num">#${i.number}</span><span class="title">${esc(i.title)}</span></li>`).join('');
    const sel = $b('#assign-workflow');
    const options = bl.workflows.map((w) => `<option value="${esc(w.file)}">${esc(w.name)}</option>`).join('');
    sel.innerHTML = bl.pipelines.length
      ? `<optgroup label="Workflows">${options}</optgroup><optgroup label="Pipelines">${bl.pipelines.map((p) => `<option value="${esc(PIPE + p.file)}">⛓ ${esc(p.name)}</option>`).join('')}</optgroup>`
      : options;
    const files = [...bl.workflows.map((w) => w.file), ...bl.pipelines.map((p) => PIPE + p.file)];
    // nothing remembered: the default development workflow (#195, Settings › General › Backlog)
    sel.value = [prefill?.workflow, load(WORKFLOW_KEY), DefaultWorkflow.current().file, files[0]].find((f) => f && files.includes(f));
    // real runs by default: Simulation is opt-in (checked only where real runs are refused anyway)
    $b('#assign-mock').checked = !!state.simulationOnly;
    document.querySelector(`input[name="assign-group"][value="${prefill?.group ? 'group' : 'separate'}"]`).checked = true;
    renderAssignBusy();
    assignChain().set(null);
    renderAssignInputs();
    for (const [k, v] of Object.entries(prefill?.inputs || {})) WorkflowInputs.set($b('#assign-inputs'), k, v);
    // #216: what the Product Owner chose, as the same pills as its card (the Settings below edit them)
    const proposed = prefill?.inputs ? WorkflowInputs.inputPills(bl.workflows.find((w) => w.file === prefill.workflow) || null, prefill.inputs, { defaults: true }) : '';
    $b('#assign-proposed').innerHTML = proposed ? `<span class="muted">Product Owner's choices:</span> ${proposed}` : '';
    $b('#assign-proposed').classList.toggle('hidden', !proposed);
    openModal('#assign-modal');
  }

  // ---- the Product Owner's proposals (backlog-po.js) ------------------------------------------
  // Only on the owner's click: a proposed group in the assign dialog (its To do issues selected, the
  // filters cleared if they hide one, one run, its workflow and inputs), or as a new roadmap stage.
  // Both return the issues left out (not To do any more, or not synced).
  async function assignGroup({ issues, workflow, inputs }) {
    const todo = (bl.data?.issues || []).filter(selectable);
    const numbers = issues.filter((n) => todo.some((i) => i.number === n));
    const skipped = issues.filter((n) => !numbers.includes(n));
    if (!numbers.length) return skipped;
    // from the Roadmap screen (the Product Owner's drawer there): to the Board, where the selection shows
    if (bl.mode === 'roadmap') { bl.mode = bl.board; switchScreen('backlog'); }
    if (numbers.some((n) => !isShown(todo.find((i) => i.number === n)))) {
      bl.q = '';
      $b('#bl-search').value = '';
      setLabels([]);
      bl.filter = 'open';
    }
    bl.selected.clear();
    for (const n of numbers) bl.selected.add(n);
    render();
    await openAssign({ workflow, inputs, group: numbers.length > 1 });
    return skipped;
  }

  async function roadmapGroup({ issues, workflow, inputs, reason, modeReason, origin, cost }) {
    // (#253: an epic is left out, like an issue that is not synced)
    const list = issues.map((n) => (bl.data?.issues || []).find((i) => i.number === n)).filter((i) => i && !i.isEpic);
    const skipped = issues.filter((n) => !list.some((i) => i.number === n));
    if (!list.length) return skipped;
    const wf = (await api.listWorkflows()).find((w) => w.file === workflow);
    await window.BacklogRoadmap.addStage(roadmapCtx(), bl.data, {
      issues: list, workflow, workflowName: wf?.name || workflow, inputs: inputs || {}, mock: !!state.simulationOnly, group: list.length > 1, reason, modeReason, origin, cost,
    });
    showRoadmap();
    return skipped;
  }

  // The Roadmap screen (#254), after a roadmap change made elsewhere (the Product Owner's "Add all to
  // the roadmap", the assign dialog's Add to roadmap): drawn at once with what is loaded.
  function showRoadmap(data) {
    if (data) setData(data);
    if (state.view === 'roadmap') render(); else switchScreen('roadmap');
  }

  // The Roadmap scrolled to stage `n` (1-based; an applied group's badge in the Product Owner's drawer, #140).
  // Asked before the backlog was read in this window (Home's "Open roadmap", #255): shown once it is drawn.
  function openStage(n) {
    showRoadmap();
    if (!bl.data) { stageToShow = n; return; }
    const el = document.querySelector(`#bl-list .rm-stage[data-stage="${Number(n) - 1}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  // Selected issues the roadmap already plans (not started): assigning them takes them out of it.
  const planned = (numbers) => (bl.data?.issues || []).filter((i) => numbers.includes(i.number) && ['planned', 'failed'].includes(i.roadmap?.status));
  async function submitAssign(e) {
    e.preventDefault();
    const choice = $b('#assign-workflow').value;
    const pipe = assignPipeline();
    const workflow = pipe ? pipe.stages[0].workflow : choice;
    const inputs = assignInputs();
    const numbers = assignNumbers();
    if (!numbers.length) return;
    const inRoadmap = planned(numbers);
    if (inRoadmap.length && !await confirmDialog('Already in the roadmap', `${inRoadmap.map((i) => `#${i.number} (stage ${i.roadmap.stage})`).join(', ')} ${inRoadmap.length > 1 ? 'are' : 'is'} planned in the roadmap. Assigning takes ${inRoadmap.length > 1 ? 'them' : 'it'} out of the roadmap and into the queue.`, 'Assign anyway')) return;
    const btn = $b('#btn-assign-ok');
    btn.disabled = true;
    try {
      const mock = wantsSimulation($b('#assign-mock'));
      // a pipeline's chain is the service's (pipeline: its file), not the dialog's "When it finishes"
      const then = pipe ? null : assignChain().value();
      const pipeline = pipe?.file || null;
      // #262: each run's provider / model / effort per agent (a pipeline keeps its workflows')
      const agentOverrides = pipe ? null : assignAgentOverrides();
      let data = await api.assignWorkflow(bl.projectId, numbers, workflow, inputs, mock, grouped(), false, then, pipeline, agentOverrides);
      // an ended run kept work for these issues (#170): resume that run, or start from scratch
      if (data?.kept) {
        const kept = await keptWorkDialog(data.kept);
        if (kept === 'resume') closeModal('#assign-modal');
        if (kept !== 'scratch') return;
        data = await api.assignWorkflow(bl.projectId, numbers, workflow, inputs, mock, grouped(), true, then, pipeline, agentOverrides);
      }
      save(WORKFLOW_KEY, choice);
      bl.selected.clear();
      setData(data);
      closeModal('#assign-modal');
      render();
    } catch (err) {
      $b('#assign-error').textContent = errMsg(err);
    } finally {
      btn.disabled = false;
    }
  }

  // The dialog's issues, workflow and inputs as a new stage at the end of the roadmap (planned: the
  // roadmap's Start runs it after the stages before it).
  async function addToRoadmap() {
    const workflow = $b('#assign-workflow').value;
    const inputs = assignInputs();
    const numbers = assignNumbers();
    if (!numbers.length) return;
    const issues = numbers.map((n) => (bl.data?.issues || []).find((i) => i.number === n)).filter(Boolean);
    const btn = $b('#btn-assign-roadmap');
    btn.disabled = true;
    try {
      const wf = bl.workflows.find((w) => w.file === workflow);
      await window.BacklogRoadmap.addStage(roadmapCtx(), bl.data, {
        issues, workflow, workflowName: wf?.name || workflow, inputs, mock: wantsSimulation($b('#assign-mock')), group: grouped(), then: assignChain().value(),
        agentOverrides: assignAgentOverrides(),
      });
      save(WORKFLOW_KEY, workflow);
      bl.selected.clear();
      closeModal('#assign-modal');
      showRoadmap();
    } catch (err) {
      $b('#assign-error').textContent = errMsg(err);
    } finally {
      btn.disabled = false;
    }
  }
  const roadmapCtx = () => ({
    projectId: bl.projectId, setData, render, setError: (msg) => { bl.error = msg; },
    // #269: the filter row's epic (the Board's choice too); #270: "Open the Roadmap" of the Board's alert
    setEpic: (id) => { bl.epic = String(id || ''); render(); },
    showRoadmap: () => showRoadmap(),
    // #281: whether the screen still shows this project (an Undo clicked after the project changed)
    current: ((id) => () => bl.projectId === id)(bl.projectId),
    // #217, #268: the Roadmap's Planned | All switch (All when on) and its date range (remembered)
    setShowAll: (on) => { bl.showAll = !!on; save(SHOW_ALL_KEY, bl.showAll ? '1' : ''); render(); },
    setSince: (id) => { bl.since = String(id || ''); save(SINCE_KEY, bl.since); render(); },
    setRelease: (id) => { bl.release = String(id || ''); save(RELEASE_KEY, bl.release); render(); },
  });

  // An issue of a queued group: remove it from the group (the others still go as one run) or
  // cancel the whole group. Resolves 'one', 'all' or null (keep it).
  function askUnqueue(i) {
    const others = i.queued.groupedWith.map((n) => `#${n}`).join(', ');
    $b('#unqueue-message').textContent = `#${i.number} is queued as one run with ${others}. Remove only #${i.number} (the others still go as one run), or cancel the whole group?`;
    openModal('#unqueue-modal');
    return new Promise((resolve) => {
      const done = (v) => { closeModal('#unqueue-modal'); resolve(v); };
      $b('#btn-unqueue-one').onclick = () => done('one');
      $b('#btn-unqueue-all').onclick = () => done('all');
      $b('#btn-unqueue-keep').onclick = () => done(null);
    });
  }

  async function removeQueued(number) {
    const issue = (bl.data?.issues || []).find((i) => i.number === number);
    let cancelGroup = false;
    if (issue?.queued?.groupedWith?.length) {
      const how = await askUnqueue(issue);
      if (!how) return;
      cancelGroup = how === 'all';
    }
    try { setData(await api.unqueueIssue(bl.projectId, number, cancelGroup)); } catch (err) { bl.error = errMsg(err); }
    render();
  }

  // ---- rendering ---------------------------------------------------------------------------
  const matches = (i) => {
    // #253: an epic is never on the Board, whatever the filters (the Epics view lists it)
    if (i.isEpic) return false;
    if (!matchesLabels(i, bl.labels) || !matchesEpic(i, bl.epic)) return false;
    if (!bl.q) return true;
    const hay = `#${i.number} ${i.title} ${i.labels.map((l) => l.name).join(' ')} ${i.author || ''} ${i.assignees.join(' ')}`.toLowerCase();
    return hay.includes(bl.q.toLowerCase());
  };
  // The state chips only apply to the list (the kanban shows every state in its columns, archived
  // issues aside: they only show under the Archived chip, #238).
  const inState = (i) => (bl.mode === 'kanban' ? issueState(i) !== 'archived' : bl.filter === 'all' || issueState(i) === bl.filter);
  const isShown = (i) => inState(i) && matches(i);
  // Selected issues the filters hide stay selected, but are neither counted nor assigned.
  function shownSelected() {
    const shown = new Set((bl.data?.issues || []).filter(isShown).map((i) => i.number));
    return [...bl.selected].filter((n) => shown.has(n));
  }
  const filtering = () => !!bl.q || bl.labels.length > 0 || !!bl.epic;
  const epicById = (id) => (bl.data?.epics || []).find((e) => e.id === id) || null;
  const noMatch = () => `<div class="empty-state"><b>No issues match the filters</b>
    <p class="muted">${bl.epic ? `Epic: ${esc(bl.epic === NO_EPIC ? 'No epic' : epicById(bl.epic)?.title || bl.epic)}. ` : ''}${bl.labels.length ? `Labels: ${esc(bl.labels.join(', '))}. ` : ''}${bl.q ? `Search: “${esc(bl.q)}”.` : ''}</p>
    <button class="btn sm ghost" type="button" data-clear-filters>Clear filters</button></div>`;

  const colorStyle = (color) => (color ? ` style="--lc:${esc(color)}"` : '');
  // A label chip toggles its label in the filter (`on` while selected).
  const labelChip = (l) => {
    const on = hasLabel(bl.labels, l.name);
    return `<button class="bl-label${on ? ' on' : ''}" type="button" data-label="${esc(l.name)}" title="${on ? 'Remove from the label filter' : 'Filter by this label'}"${colorStyle(l.color)}>${esc(l.name)}</button>`;
  };
  const labels = (i) => i.labels.map(labelChip).join('');
  // Impact and complexity from the triage labels, as two compact badges (none without the labels).
  const triage = (i) => {
    const s = triageScores(i);
    return [['impact', 'I', 'Impact'], ['complexity', 'C', 'Complexity']].filter(([k]) => s[k] != null)
      .map(([k, short, name]) => `<span class="badge bl-triage bl-${k} lvl-${s[k]}" title="${name} ${s[k]}/5 (issue triage)">${short}${s[k]}</span>`).join('');
  };
  // Its epic (#138) as a small badge that filters by it (an epic issue already shows its `epic` label).
  const epicBadge = (i) => {
    const e = i.epic && epicById(i.epic);
    return e ? `<button class="badge bl-epic${bl.epic === e.id ? ' on' : ''}" type="button" data-epic-filter="${esc(e.id)}" title="${esc(`Epic ${e.id}: ${e.title}. Show only its issues`)}">${esc(e.title)}</button>` : '';
  };

  // The epic filter (#138): every epic with how many issues the other filters show, then "No epic".
  // Hidden when the backlog has no epic, and in the Epics view. One choice for the Board and the
  // Roadmap (#217); on the Roadmap it counts the issues the roadmap plans.
  // (#269: on the Roadmap the choices are drawn in its own filter row, backlog-roadmap.js)
  function epicChoices(issues) {
    const epics = bl.data?.epics || [];
    if (!epics.length) return [];
    return epicOptions(epics, onRoadmapTab() ? issues.filter((i) => i.roadmap) : issues.filter((i) => inState(i) && matchesLabels(i, bl.labels)));
  }
  function renderEpicFilter(issues) {
    const sel = $b('#bl-epic');
    const epics = bl.data?.epics || [];
    sel.classList.toggle('hidden', !epics.length || bl.mode === 'epics');
    if (!epics.length) return;
    sel.innerHTML = `<option value="">All epics</option>${epicChoices(issues).map((o) => `<option value="${esc(o.id)}">${esc(o.title)} (${o.count})</option>`).join('')}`;
    sel.value = bl.epic;
    sel.classList.toggle('active', !!bl.epic);
  }

  // The Epics view (#138): each epic with its progress and members, then the issues in no epic.
  function renderEpics(issues) {
    const epics = bl.data?.epics || [];
    const platform = bl.data?.platform === 'gitlab' ? 'GitLab: a group epic, or an issue labelled epic whose members carry epic::<name>' : 'GitHub: an issue labelled epic, whose sub-issues are its members';
    const bar = `<div class="bl-queue bl-epics-bar">
        <span><b>Epics</b> <span class="muted small">${epics.length} · ${esc(platform)}</span></span>
        ${bl.data?.epicsError ? `<span class="warn-text small" title="${esc(bl.data.epicsError)}">members could not be read: last known</span>` : ''}
        <span class="spacer"></span>
        <label class="check small" title="A new issue the Product Owner registers joins the existing epic it clearly matches, with no extra click. Creating an epic always asks."><input type="checkbox" data-auto-epic${bl.data?.autoEpic ? ' checked' : ''} /><span>Auto-place new issues</span></label>
        <button class="btn sm ghost" type="button" data-organize title="Ask the Product Owner to propose epics for the open issues: nothing is created until you apply a proposal">Organize into epics…</button>
      </div>`;
    if (!epics.length) {
      return `${bar}<div class="empty-state"><b>No epics yet</b><p class="muted">An epic groups the issues of one theme. Ask the Product Owner to organize the open issues into epics: you review each proposal and apply it with a click.</p>
        <button class="btn sm primary" type="button" data-organize>Organize into epics…</button></div>`;
    }
    const byNumber = new Map(issues.map((i) => [i.number, i]));
    const member = (n) => {
      const i = byNumber.get(n);
      if (!i) return `<li class="bl-epic-member muted"><span class="bl-num mono">#${n}</span> not synced</li>`;
      return `<li class="bl-epic-member" title="${esc(`#${i.number} ${i.title}`)}"><span class="bl-state ${i.state}"></span><span class="bl-num mono">#${i.number}</span><a class="bl-epic-member-title" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>${window.BacklogRoadmap.badge(i)}</li>`;
    };
    const cards = epics.map((e) => {
      const p = epicProgress(e, issues);
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      return `<section class="bl-epic-card" data-epic="${esc(e.id)}" data-testid="backlog-epic">
        <div class="bl-epic-head">
          <span class="bl-state ${e.state}"></span>
          ${e.url ? `<a class="bl-epic-title" href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(`${e.id} ${e.title}`)}">${esc(e.title)}</a>` : `<b class="bl-epic-title" title="${esc(e.title)}">${esc(e.title)}</b>`}
          <span class="badge" title="${e.kind === 'group' ? 'A GitLab group epic' : 'The epic issue'}">${esc(e.id)}</span>
          <span class="spacer"></span>
          <span class="bl-tasks" title="${p.done} of ${p.total} members done (closed, or done in the roadmap)"><span class="bl-bar"><span style="width:${pct}%"></span></span><span class="mono small">${p.done}/${p.total}</span></span>
        </div>
        <div class="small muted">${p.open} open · ${p.closed} closed · ${p.roadmapDone} done in the roadmap${p.inRoadmap > p.roadmapDone ? ` · ${p.inRoadmap - p.roadmapDone} planned` : ''}</div>
        ${e.members.length ? `<ul class="bl-epic-members">${e.members.map(member).join('')}</ul>` : '<p class="muted small">No members yet.</p>'}
        ${e.members.length ? `<button class="link-btn small" type="button" data-epic-filter="${esc(e.id)}">Show its issues in the list</button>` : ''}
      </section>`;
    }).join('');
    const loose = issues.filter((i) => i.state === 'open' && matchesEpic(i, NO_EPIC));
    const none = `<section class="bl-epic-card bl-epic-none">
        <div class="bl-epic-head"><b class="bl-epic-title">No epic</b><span class="spacer"></span><span class="muted small">${loose.length} open issue${loose.length === 1 ? '' : 's'}</span></div>
        ${loose.length ? `<button class="link-btn small" type="button" data-epic-filter="${NO_EPIC}">Show them in the list</button>` : '<p class="muted small">Every open issue is in an epic.</p>'}
      </section>`;
    return `${bar}<div class="bl-epics">${cards}${none}</div>`;
  }

  // The label filter: every label of the synced issues, with how many the state filter shows.
  // Hidden when no issue has a label.
  function renderLabelFilter(issues) {
    const options = labelOptions(issues, issues.filter(inState));
    $b('#bl-labels-wrap').classList.toggle('hidden', !options.length);
    if (!options.length) bl.labelsOpen = false;
    const btn = $b('#btn-bl-labels');
    btn.textContent = bl.labels.length ? `Labels (${bl.labels.length})` : 'Labels';
    btn.classList.toggle('primary', bl.labels.length > 0);
    btn.classList.toggle('ghost', !bl.labels.length);
    btn.setAttribute('aria-expanded', String(bl.labelsOpen));
    const pop = $b('#bl-labels-pop');
    pop.classList.toggle('hidden', !bl.labelsOpen);
    pop.innerHTML = bl.labelsOpen ? options.map((l) => `<label class="bl-label-opt" role="menuitemcheckbox">
        <input type="checkbox" data-label-opt="${esc(l.name)}"${hasLabel(bl.labels, l.name) ? ' checked' : ''} />
        <span class="bl-label"${colorStyle(l.color)}>${esc(l.name)}</span><span class="muted small">${l.count}</span></label>`).join('') : '';
    const color = new Map(options.map((l) => [l.name.toLowerCase(), l.color]));
    $b('#bl-label-active').innerHTML = bl.labels.length ? `${bl.labels.map((name) =>
      `<button class="bl-label on" type="button" data-label="${esc(name)}" title="Remove from the label filter"${colorStyle(color.get(name.toLowerCase()))}>${esc(name)} ×</button>`).join('')}
      <button class="link-btn small" type="button" data-label-clear title="Remove every label from the filter">clear</button>` : '';
  }
  const tasks = (i) => {
    if (!i.tasks?.total) return '';
    const pct = Math.round((i.tasks.done / i.tasks.total) * 100);
    return `<span class="bl-tasks" title="${i.tasks.done} of ${i.tasks.total} tasks done"><span class="bl-bar"><span style="width:${pct}%"></span></span><span class="mono small">${i.tasks.done}/${i.tasks.total}</span></span>`;
  };
  // the run's readable status (#266), its title and its PR (#84: state icon, #n link opening the PR, not the run)
  const runLink = (r) => `<button class="bl-run" type="button" data-testid="run-chip" data-run="${esc(r.runId)}" data-workflow="${esc(r.workflow || '')}" title="Open run ${esc(r.runId)} (${esc(r.workflow || 'workflow')})">
      ${StatusPill.statusPill(r.status, { waiting: r.waiting })}<span>${esc(window.runTitle ? runTitle(r) : r.workflow || 'workflow')}</span>${window.runPrBadge ? runPrBadge(r, { compact: true }) : ''}${r.mock ? '<span class="badge p-mock">Simulated</span>' : ''}</button>`;
  // Open PRs/MRs that refer to the issue, each a link to it.
  const prBadges = (i) => (i.pullRequests || []).map((p) =>
    `<a class="badge bl-pr${p.draft ? ' draft' : ''}" href="${esc(p.url)}" target="_blank" rel="noopener" title="${esc(`Open ${p.draft ? 'draft ' : ''}${prName(p)}: ${p.title}`)}">${esc(prName(p))}</a>`).join('');
  // The other issues of the same run (a group sent as one run: one branch, one PR/MR).
  const groupBadge = (others) => (others?.length
    ? `<span class="badge bl-group" title="One run, one branch and one PR/MR for these issues">grouped with ${esc(others.map((n) => `#${n}`).join(', '))}</span>` : '');
  const checkbox = (i) => (selectable(i) ? `<input type="checkbox" class="bl-check" data-sel="${i.number}" aria-label="Select #${i.number}"${bl.selected.has(i.number) ? ' checked' : ''} />` : '');
  // What the automation is doing with the issue: queued, its latest run, the gate waiting for you.
  function status(i) {
    // its place in the roadmap ("Roadmap: stage 2", backlog-roadmap.js)
    const rm = window.BacklogRoadmap.badge(i);
    if (i.queued) {
      return `${rm}<span class="bl-queued"><span class="badge">queued #${i.queued.position}</span><span class="small">${esc(i.queued.workflow)}</span>${i.queued.mock ? '<span class="badge p-mock">Simulated</span>' : ''}${groupBadge(i.queued.groupedWith)}
        <button class="link-btn small" type="button" data-unqueue="${i.number}" title="Take it out of the queue">remove</button></span>`;
    }
    const e = enriching(i);
    const r = i.runs?.find((x) => !x.enrich);
    if (!r) return rm + e;
    const notPushed = i.column === 'local'
      ? `<span class="badge bl-notpushed" title="Merged into the local ${esc(r.localMerge?.base || 'base')}; the issue closes when it is pushed (Push, above)">not pushed</span>` : '';
    const recovered = r.recovery ? `<span class="badge bl-recovered" title="${esc(`Supervisor: ${r.recovery}`)}">sent back after a failed merge</span>` : '';
    const watch = r.status === 'running' && isRunLive(r.runId)
      ? `<button class="btn sm ghost sup-btn" type="button" data-watch="${esc(r.runId)}" data-workflow="${esc(r.workflow || '')}" title="The supervisor follows this run and explains it in a chat (opt-in: it costs tokens)"><span class="sup-mark">◆</span> Watch</button>` : '';
    return `${rm}${runLink(r)}${notPushed}${recovered}${groupBadge(r.groupedWith)}${r.waiting ? '<button class="btn sm primary" type="button" data-gate>Review approval</button>' : ''}${watch}${e}`;
  }
  // Its latest Write & Review run (#103): "being enriched" while it runs or waits, "enriched" once
  // accepted; a link to the run (the Write & Review chat, with Save to issue).
  function enriching(i) {
    const r = i.runs?.find((x) => x.enrich);
    if (!r || ['failed', 'cancelled', 'interrupted'].includes(r.status)) return '';
    const label = r.status === 'success' ? 'enriched' : 'being enriched';
    return `<button class="badge bl-enrich" type="button" data-run="${esc(r.runId)}" data-workflow="${esc(r.workflow || '')}" title="${esc(`Write & Review run ${r.runId}${r.mock ? ' (simulated)' : ''}: open it`)}">${label}${r.mock ? ' · simulated' : ''}</button>`;
  }

  // Updated by the last Backlog Refresh run (#161), for a day after it ended.
  const refreshedBadge = (i) => (i.refreshed
    ? `<span class="badge bl-refreshed" title="${esc(`Paths, lines or tasks updated by the Backlog Refresh run ${bl.data?.refresh?.lastRun?.runId || ''}`)}">refreshed</span>` : '');

  // The issue's actions (#238), at the right of a row and the top right of a card: an open issue has
  // a ⋯ menu with Enrich in Write & Review (#103: Write & Review prefilled with the issue, nothing
  // starts by itself) and Archive (disabled, with the reason shown, while it is planned in the roadmap
  // or has a run in progress); an archived issue has Restore.
  function issueMenu(i) {
    if (isArchived(i)) return `<button class="btn sm ghost" type="button" data-restore="${i.number}" data-testid="backlog-restore" title="Reopen it on the platform and remove its archived label">Restore</button>`;
    if (i.state !== 'open') return '';
    const why = archiveBlockReason(i);
    const open = bl.menu === i.number;
    return `<span class="bl-menu-wrap">
        <button class="btn sm ghost" type="button" data-menu="${i.number}" data-testid="backlog-issue-menu" aria-haspopup="menu" aria-expanded="${open}" aria-label="Actions for #${i.number}" title="Actions">⋯</button>
        ${open ? `<div class="bl-menu" role="menu" aria-label="Actions for #${i.number}">
          <button type="button" role="menuitem" data-enrich="${i.number}" data-testid="backlog-enrich" title="Enrich this issue in Write & Review (e.g. into a fuller issue or an RFC), then save the result back to it">Enrich in Write &amp; Review</button>
          <button type="button" role="menuitem" data-archive="${i.number}" data-testid="backlog-archive"${why ? ' disabled' : ''} title="${esc(why || 'Close it as not planned on the platform and label it archived')}">Archive</button>
          ${why ? `<p class="muted small bl-menu-why">${esc(why)}</p>` : ''}
        </div>` : ''}
      </span>`;
  }

  // Filed from a discovery card (#258, the service's `discoveryCard`): the card's title; a click opens
  // the card on the Discovery board, read-only.
  const discoveryBadge = (i) => (i.discoveryCard
    ? `<button class="badge bl-discovery" type="button" data-testid="issue-discovery-card" data-discovery-card="${esc(i.discoveryCard.id)}" title="${esc(`Filed from the discovery card "${i.discoveryCard.title}": open it (read-only)`)}">card: ${esc(i.discoveryCard.title)}</button>` : '');

  function issueRow(i) {
    const open = bl.expanded.has(i.number);
    const host = PLATFORMS[bl.data?.platform]?.label || 'the platform';
    const st = issueState(i);
    return `
      <div class="pr-run bl-issue${open ? ' open' : ''}${bl.selected.has(i.number) ? ' selected' : ''}" data-n="${i.number}" data-testid="backlog-issue">
        <div class="bl-row" data-act="toggle">
          <span class="bl-sel">${checkbox(i)}</span>
          <span class="bl-state ${st}" title="${st === 'open' ? 'Open' : st === 'archived' ? 'Archived' : 'Closed'}"></span>
          <span class="bl-num mono">#${i.number}</span>
          <div class="bl-main">
            <div class="bl-title">${esc(i.title)}</div>
            <div class="bl-labels">${refreshedBadge(i)}${discoveryBadge(i)}${epicBadge(i)}${triage(i)}${labels(i)}</div>
          </div>
          <span class="bl-status">${prBadges(i)}${status(i)}</span>
          ${tasks(i) || '<span></span>'}
          <span class="pr-meta"><label>Updated</label>${esc(dateOf(i.updatedAt))}</span>
          <span class="bl-actions">${issueMenu(i)}</span>
        </div>
        ${open ? `
        <div class="pr-body">
          <div class="muted small">Opened by ${esc(i.author || 'unknown')} on ${esc(dateOf(i.createdAt))}${i.assignees.length ? ` · assigned to ${esc(i.assignees.join(', '))}` : ''}</div>
          ${i.pullRequests?.length ? `<div class="bl-prs"><span class="muted small">Open ${bl.data?.platform === 'gitlab' ? 'MRs' : 'PRs'}</span>${i.pullRequests.map((p) => `<span class="small">${prBadges({ pullRequests: [p] })} ${esc(p.title)}</span>`).join('')}</div>` : ''}
          ${i.runs?.length ? `<div class="bl-runs"><span class="muted small">Runs</span>${i.runs.map(runLink).join('')}</div>` : ''}
          <div class="md bl-md">${i.body.trim() ? markdownHtml(i.body) : '<p class="muted">No description.</p>'}</div>
          <div class="row"><a class="btn sm ghost" href="${esc(i.url)}" target="_blank" rel="noopener">Open on ${esc(host)}</a></div>
        </div>` : ''}
      </div>`;
  }

  const card = (i) => `
    <div class="bl-card${bl.selected.has(i.number) ? ' selected' : ''}" data-n="${i.number}">
      <div class="bl-card-head">${checkbox(i)}<span class="bl-num mono">#${i.number}</span><a class="bl-card-title" href="${esc(i.url)}" target="_blank" rel="noopener" title="Open on ${esc(PLATFORMS[bl.data?.platform]?.label || 'the platform')}">${esc(i.title)}</a>${issueMenu(i)}</div>
      <div class="bl-labels">${refreshedBadge(i)}${discoveryBadge(i)}${epicBadge(i)}${triage(i)}${labels(i)}</div>
      ${tasks(i)}
      ${prBadges(i) || status(i) ? `<div class="bl-card-run">${prBadges(i)}${status(i)}</div>` : ''}
    </div>`;

  function renderList(issues) {
    const shown = sortIssues(issues.filter(isShown), bl.sort);
    return shown.length ? shown.map(issueRow).join('') : filtering() ? noMatch() : '<p class="muted">No issues match.</p>';
  }

  function renderKanban(issues) {
    const shown = sortIssues(issues.filter(isShown), bl.sort);
    const withLocal = bl.data?.local?.ahead > 0 || issues.some((i) => i.column === 'local');
    const columns = COLUMNS.filter(([col]) => col !== 'local' || withLocal);
    return `${!shown.length && issues.length && filtering() ? noMatch() : ''}<div class="bl-board${withLocal ? ' with-local' : ''}" data-testid="backlog-board">${columns.map(([col, title]) => {
      const items = shown.filter((i) => (i.column || (i.state === 'closed' ? 'done' : 'todo')) === col);
      return `<section class="bl-col bl-col-${col}">
        <h3>${title} <span class="muted">${items.length}</span></h3>
        <div class="bl-col-body">${items.map(card).join('') || '<p class="muted small">Nothing here.</p>'}</div>
      </section>`;
    }).join('')}</div>`;
  }

  function renderQueue() {
    const box = $b('#bl-queue');
    const q = bl.data?.queue;
    const n = q?.items?.length || 0;
    const skipped = q?.skipped || [];
    box.classList.toggle('hidden', !n && !q?.error && !skipped.length);
    if (!n && !q?.error && !skipped.length) { box.innerHTML = ''; return; }
    const mode = q.paused ? '<span class="badge warn">paused</span>' : '<span class="badge live">active</span>';
    // issues taken out right before their start, with why (removing one dismisses it)
    const skips = skipped.map((s) => `<span class="bl-skipped small"><span class="warn-text">Skipped #${s.number}: ${esc(s.reason)}</span>
      <button class="link-btn small" type="button" data-unqueue="${s.number}" title="Dismiss">dismiss</button></span>`).join('');
    box.innerHTML = `
      <span><b>Queue</b> ${mode} ${n ? `${n} run${n > 1 ? 's' : ''} waiting · next ${esc((q.items[0].issues || [q.items[0]]).map((x) => `#${x.number}`).join(', '))} (${esc(q.items[0].workflowName || q.items[0].workflow)})` : 'empty'}</span>
      ${skips}
      <span class="spacer"></span>
      <button class="btn sm${q.paused ? ' primary' : ' ghost'}" type="button" data-pause="${q.paused ? 'off' : 'on'}">${q.paused ? 'Resume' : 'Pause'}</button>`;
  }

  // Archive (#238): closes the issues as not planned on the platform and labels them archived, after a
  // confirm naming them. Issues that cannot be archived (archiveBlockReason) are left out of it; a
  // refusal or a failure is reported per issue and the others still go through. True when it was sent.
  async function archive(numbers) {
    const issues = (bl.data?.issues || []).filter((i) => numbers.includes(i.number));
    const blocked = issues.filter((i) => archiveBlockReason(i)).map((i) => `#${i.number}: ${archiveBlockReason(i)}`);
    const ok = issues.filter((i) => !archiveBlockReason(i)).map((i) => i.number);
    if (!ok.length) { bl.error = blocked.length ? `Not archived: ${blocked.join(' · ')}` : null; render(); return false; }
    if (!await confirmDialog(`Archive ${ok.length === 1 ? 'issue' : `${ok.length} issues`}`, archiveConfirmText(ok, bl.data?.platform || bl.platform), 'Archive')) return false;
    try {
      const out = await api.archiveIssues(bl.projectId, ok);
      if (out.backlog) setData(out.backlog);
      const failed = out.results.filter((r) => !r.ok).map((r) => `#${r.number}: ${r.error}`);
      bl.error = failed.length || blocked.length ? `Not archived: ${[...blocked, ...failed].join(' · ')}` : null;
    } catch (err) { bl.error = errMsg(err); }
    render();
    return true;
  }

  // Restore (#238): reopens an archived issue and removes its label, after a confirm.
  async function restore(number) {
    const host = PLATFORMS[bl.data?.platform]?.label || 'the platform';
    if (!await confirmDialog('Restore issue', `Reopen #${number} on ${host} and remove its archived label?`, 'Restore')) return;
    try {
      const out = await api.restoreIssues(bl.projectId, [number]);
      if (out.backlog) setData(out.backlog);
      const failed = out.results.filter((r) => !r.ok).map((r) => `#${r.number}: ${r.error}`);
      bl.error = failed.length ? `Not restored: ${failed.join(' · ')}` : null;
    } catch (err) { bl.error = errMsg(err); }
    render();
  }

  // The retired `deprioritized` label (#238): its open issues get a one-time alert (a warning, #270)
  // offering to archive them; Archive or Dismiss hides it for good (per project).
  const deprioritizedKey = () => `${DEPRIORITIZED_KEY}.${bl.projectId}`;
  function deprioritizedAlert() {
    const list = load(deprioritizedKey()) ? [] : deprioritizedIssues(bl.data?.issues || []);
    if (!list.length) return [];
    return [{
      id: `deprioritized:${bl.projectId}`,
      level: 'warning',
      title: `${list.map((i) => `#${i.number}`).join(', ')} still ${list.length === 1 ? 'carries' : 'carry'} the retired deprioritized label.`,
      text: 'Archive replaces it: closed as not planned, labelled archived, restorable from the Archived chip.',
      dismissible: false,
      actions: [
        {
          label: `Archive (${list.length})`,
          primary: true,
          title: list.map((i) => `#${i.number} ${i.title}`).join('\n'),
          attrs: { 'data-testid': 'backlog-deprioritized-archive' },
          onClick: async () => { if (await archive(list.map((i) => i.number))) { save(deprioritizedKey(), '1'); render(); } },
        },
        // its click is handled on the alerts box (bind), where the dismissal is remembered
        { label: 'Dismiss', attrs: { 'data-deprioritized-dismiss': '', 'data-testid': 'backlog-deprioritized-dismiss' } },
      ],
    }];
  }

  // The Backlog Refresh alert (#161, src/backlog-refresh.js; a warning, #270): on every view when the
  // last refresh is older than Settings › General › Backlog's interval and the base got merges since
  // (or none ever ran); "Refreshing…" (an info) with a link while a refresh run is live. Never starts
  // a run by itself. "Dismiss for today" is remembered by the service; × hides it until it is due again.
  const ago = (h) => (h >= 48 ? `${Math.floor(h / 24)} days ago` : `${h} h ago`);
  function refreshAlert() {
    const r = bl.data?.refresh;
    if (!project()?.repo || !r || !(r.running || r.due)) return [];
    if (r.running) {
      return [{
        id: `refreshing:${bl.projectId}`,
        level: 'info',
        title: 'Refreshing the backlog…',
        text: 'A Backlog Refresh run is in progress.',
        dismissible: true,
        actions: [{ label: 'Open the run', onClick: () => openRun({ dataset: { run: r.running.runId, workflow: r.running.workflow || '' } }) }],
      }];
    }
    const when = r.lastRun ? `Backlog refreshed ${ago(r.hoursAgo)}${r.merges != null ? ` · ${r.merges} merge${r.merges === 1 ? '' : 's'} since` : ''}` : 'Backlog never refreshed';
    return [{
      id: `refresh:${bl.projectId}`,
      level: 'warning',
      title: when,
      text: `Issues may cite moved files or tasks already done.${r.lastRun ? ` Last Backlog Refresh: run ${r.lastRun.runId}, ${dateOf(r.lastRun.startedAt)}.` : ''}`,
      dismissible: true,
      actions: [
        { label: 'Refresh now', primary: true, title: 'Opens the Start panel for the Backlog Refresh workflow, prefilled; nothing starts until you press Start', attrs: { 'data-refresh-now': '' }, onClick: refreshNow },
        {
          label: 'Dismiss for today',
          attrs: { 'data-refresh-dismiss': '' },
          onClick: async () => {
            try { setData(await api.dismissBacklogRefresh(bl.projectId)); } catch (err) { bl.error = errMsg(err); }
            render();
          },
        },
      ],
    }];
  }

  // Refresh now: the Start drawer on backlog-refresh, prefilled with the project, its platform, the
  // base and `since` = the last refresh's start (the owner presses Start; developer mode starts it simulated).
  function refreshNow() {
    const r = bl.data?.refresh;
    const inputs = { git_platform: bl.platform === 'gitlab' ? 'gl' : 'gh' };
    if (r?.base) inputs.base_branch = r.base;
    if (r?.since) inputs.since = r.since;
    openDrawer({ workflow: REFRESH, project: bl.projectId, inputs });
  }

  // The live roadmap's banner (#164, backlog-roadmap.js liveBanner): on top of every view while it is on.
  function renderLive() {
    const box = $b('#bl-live');
    const html = window.BacklogRoadmap?.liveBanner(bl.data?.roadmap) || '';
    box.classList.toggle('hidden', !html);
    box.innerHTML = html;
  }

  // ---- local merges not pushed (software-development-local-hero) ---------------------------
  // The project's local <base> has commits origin/<base> has not: what they close, Push, auto-push
  // (an info alert, #270); a push status that could not be read is a warning with "Check again".
  const issueRefs = (numbers) => numbers.map((n) => `#${n}`).join(', ');
  function localAlert() {
    const l = bl.data?.local;
    if (!l) return [];
    if (l.ahead > 0) {
      const commits = `${l.ahead} commit${l.ahead === 1 ? '' : 's'}`;
      return [{
        id: `push:${bl.projectId}`,
        level: 'info',
        title: 'Not pushed',
        text: [
          `${commits} on the local ${l.base}${l.issues?.length ? ` · closes ${issueRefs(l.issues)} when pushed` : ''}`,
          l.behind > 0 ? `origin/${l.base} has ${l.behind} new commit${l.behind === 1 ? '' : 's'}: the push updates first` : '',
          l.fetchError ? 'origin not reached: last known state' : '',
        ].filter(Boolean).join(' · '),
        dismissible: true,
        actions: [
          {
            label: 'Auto-push',
            pressed: !!bl.data?.autoPush,
            title: `Push the local ${l.base} after every successful local merge`,
            attrs: { 'data-autopush': '' },
            onClick: async () => {
              const on = !bl.data?.autoPush;
              try {
                await api.setAutoPush(bl.projectId, on);
                if (bl.data) bl.data.autoPush = on;
              } catch (err) { bl.error = errMsg(err); }
              render();
            },
          },
          { label: 'Push…', primary: true, attrs: { 'data-push': '' }, onClick: openPush },
        ],
      }];
    }
    if (!l.error || !(bl.data?.issues || []).some((i) => i.column === 'local')) return [];
    return [{
      id: `push-unknown:${bl.projectId}`,
      level: 'warning',
      title: 'Push status unknown',
      text: l.error,
      dismissible: true,
      actions: [{
        label: 'Check again',
        attrs: { 'data-check': '' },
        onClick: async () => {
          try {
            const r = await api.checkLocal(bl.projectId);
            if (r.backlog) setData(r.backlog);
            window.refreshUnpushed?.();
          } catch (err) { bl.error = errMsg(err); }
          render();
        },
      }],
    }];
  }

  // ---- the page's alerts (#270, alerts.js) ---------------------------------------------------
  // On top of the Board, the Epics view and the Roadmap, above the filter row, one at a time: a roadmap
  // paused by an item and the queue's error (errors), a stale Backlog Refresh and the retired
  // deprioritized label (warnings), local merges not pushed (an info). Set on every render: an alert
  // leaves when its condition clears.
  let pageAlerts = null;
  function renderAlerts() {
    pageAlerts ||= window.Alerts.mount($b('#bl-alerts'));
    const q = bl.data?.queue;
    pageAlerts.set([
      ...(window.BacklogRoadmap?.alerts(bl.data, roadmapCtx(), { shown: onRoadmapTab() }) || []),
      ...(q?.error ? [{ id: `queue:${bl.projectId}`, level: 'error', title: 'Queue', text: q.error, dismissible: false, actions: [] }] : []),
      ...refreshAlert(),
      ...deprioritizedAlert(),
      ...localAlert(),
    ]);
  }

  // What the push sends (the commits and the issues they close), then the push; a rejected push
  // (origin moved) offers Update and push; a conflict shows the files and leaves the base as it was.
  function openPush() {
    const l = bl.data?.local;
    if (!l?.ahead) return;
    const p = project();
    $b('#push-title').textContent = `Push ${l.ahead} commit${l.ahead === 1 ? '' : 's'} to origin/${l.base}`;
    $b('#push-message').textContent = `git push origin ${l.base} in ${l.repo || p?.folder || 'the project\'s repository'} (never forced).${l.issues?.length ? ` GitHub/GitLab closes ${issueRefs(l.issues)}.` : ''}`;
    $b('#push-commits').innerHTML = (l.commits || []).map((c) => `<li><span class="mono">${esc(c.sha.slice(0, 8))}</span> ${esc(c.subject)}${c.issues.length ? ` <span class="muted">(closes ${esc(issueRefs(c.issues))})</span>` : ''}</li>`).join('');
    $b('#push-error').textContent = '';
    bl.conflictFiles = null;
    $b('#btn-push-resolve').classList.add('hidden');
    $b('#push-resolve-mock-wrap').classList.add('hidden');
    // origin already moved (last fetch): straight to Update and push
    $b('#btn-push-update').classList.toggle('hidden', !(l.behind > 0));
    $b('#btn-push-ok').classList.toggle('hidden', l.behind > 0);
    openModal('#push-modal');
  }

  async function doPush(update) {
    const btns = [$b('#btn-push-ok'), $b('#btn-push-update')];
    btns.forEach((b) => { b.disabled = true; });
    $b('#push-error').textContent = update ? 'Updating from origin, then pushing…' : 'Pushing…';
    try {
      const r = update ? await api.updateAndPushLocal(bl.projectId) : await api.pushLocal(bl.projectId);
      if (r.backlog) setData(r.backlog);
      else if (bl.data) bl.data.local = r.local;
      window.refreshUnpushed?.();
      if (r.pushed || (!r.rejected && !r.conflict && !r.local?.ahead)) { closeModal('#push-modal'); render(); return; }
      if (r.conflict) {
        // handed to a run of the local workflow (its developer resolves it, as in resolve_merge)
        $b('#push-error').textContent = `${r.error} Resolve in a run starts the local workflow: its developer merges origin/${bl.data?.local?.base || ''} into the local commits and resolves ${r.files.join(', ')}; once reviewed, tested and merged locally, push again.`;
        bl.conflictFiles = r.files;
        $b('#btn-push-update').classList.add('hidden');
        $b('#btn-push-ok').classList.add('hidden');
        $b('#btn-push-resolve').classList.remove('hidden');
        $b('#push-resolve-mock-wrap').classList.toggle('hidden', !devMode());
      } else if (r.rejected) {
        $b('#push-error').textContent = `The push was rejected: origin moved since the last sync. Update and push rebases the local commits onto it first. (${r.error || ''})`;
        $b('#btn-push-ok').classList.add('hidden');
        $b('#btn-push-update').classList.remove('hidden');
      }
      render();
    } catch (err) {
      $b('#push-error').textContent = errMsg(err);
    } finally {
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  async function resolveInRun() {
    const btn = $b('#btn-push-resolve');
    btn.disabled = true;
    try {
      const { runId } = await api.resolvePushConflict(bl.projectId, bl.conflictFiles || [], wantsSimulation($b('#push-resolve-mock')));
      closeModal('#push-modal');
      selectRun(runId);
    } catch (err) {
      $b('#push-error').textContent = errMsg(err);
    } finally {
      btn.disabled = false;
    }
  }

  function render() {
    // #254: the Backlog screen (Board and Epics tabs) or the Roadmap screen, in the same section
    const roadmap = onRoadmapTab();
    $b('#bl-title').textContent = roadmap ? 'Roadmap' : 'Backlog';
    $b('#bl-hint').textContent = roadmap
      ? 'Ordered stages of runs: each stage starts when the previous one has finished and merged.'
      : 'A project\'s issues, synced from its git platform.';
    $b('#bl-tabs').classList.toggle('hidden', roadmap);
    // #269: the Roadmap draws its own filter row (the epic with its view filters), above its bar
    $b('#bl-toolbar').classList.toggle('hidden', roadmap);
    const plat = $b('#bl-platform');
    plat.innerHTML = Object.entries(PLATFORMS).map(([id, p]) => `<option value="${id}">${esc(p.label)}${p.soon ? ' (soon)' : ''}</option>`).join('');
    plat.value = bl.platform || state.settings.backlogPlatform || 'github';

    const p = project();
    const btn = $b('#btn-bl-sync');
    btn.disabled = !p?.repo || bl.syncing || !!PLATFORMS[bl.platform]?.soon;
    btn.textContent = bl.syncing ? 'Syncing…' : 'Sync';
    $b('#btn-bl-new-issue').disabled = !p?.repo || !!PLATFORMS[bl.platform]?.soon;
    $b('#bl-sort').value = bl.sort;
    $b('#bl-sort').classList.toggle('hidden', bl.mode === 'roadmap' || bl.mode === 'epics');

    // #217: the page tabs (Board / Epics) and the Board's List / Kanban switch; the search and the
    // labels belong to the Board (and the Epics view), the epic filter to the Board and the Roadmap
    const tab = tabOf(bl.mode);
    document.querySelectorAll('#bl-tabs [data-bl-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.blTab === tab);
      b.setAttribute('aria-selected', String(b.dataset.blTab === tab));
    });
    $b('#bl-mode').classList.toggle('hidden', tab !== 'board');
    document.querySelectorAll('#bl-mode [data-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === bl.mode);
      b.setAttribute('aria-pressed', String(b.dataset.mode === bl.mode));
    });
    const shownCount = (bl.data?.issues || []).filter(isShown).length;
    $b('#bl-count').textContent = tab === 'board' && bl.data ? `${shownCount} issue${shownCount === 1 ? '' : 's'}` : '';
    const n = shownSelected().length;
    $b('#btn-bl-assign').classList.toggle('hidden', !n);
    $b('#btn-bl-assign').textContent = `Assign workflow… (${n})`;
    // #169: busy while the Product Owner answers (backlog-po.js renderButton keeps it in step)
    $b('#btn-bl-send-po').classList.toggle('hidden', !n);
    $b('#btn-bl-send-po').dataset.n = String(n);
    $b('#btn-bl-send-po').textContent = `Send to Product Owner (${n})`;
    window.BacklogPO?.syncSendButton();
    // #238: disabled (with the reasons) when no selected issue can be archived
    $b('#btn-bl-archive').classList.toggle('hidden', !n);
    $b('#btn-bl-archive').textContent = `Archive (${n})`;
    const blocked = (bl.data?.issues || []).filter((i) => shownSelected().includes(i.number) && archiveBlockReason(i));
    $b('#btn-bl-archive').disabled = !!n && blocked.length === n;
    $b('#btn-bl-archive').title = blocked.length
      ? blocked.map((i) => `#${i.number}: ${archiveBlockReason(i)}`).join('\n')
      : 'Close the selected issues as not planned on the platform and label them archived (restorable from the Archived chip)';
    $b('#btn-bl-clear').classList.toggle('hidden', !n);

    const issues = bl.data?.issues || [];
    // #253: the Board's counts and filters leave the epics out, like its list and kanban (matches)
    const board = issues.filter((i) => !i.isEpic);
    const count = (f) => board.filter((i) => f === 'all' || issueState(i) === f).length;
    const filters = $b('#bl-filters');
    filters.classList.toggle('hidden', bl.mode !== 'list');
    filters.innerHTML = FILTERS.map(([f, label]) =>
      `<button class="chip${bl.filter === f ? ' active' : ''}" data-f="${f}" data-testid="backlog-state-${f}">${label} <span class="muted">${count(f)}</span></button>`).join('');
    renderLabelFilter(board);
    renderEpicFilter(board);
    // (after renderLabelFilter, which shows the labels button whenever there are labels)
    for (const id of ['#bl-search', '#bl-label-active']) $b(id).classList.toggle('hidden', tab === 'roadmap');
    if (tab === 'roadmap') $b('#bl-labels-wrap').classList.add('hidden');
    $b('#bl-synced').textContent = bl.syncing ? 'Syncing…' : bl.data ? `Synced ${dateOf(bl.data.syncedAt)} from ${PLATFORMS[bl.data.platform]?.label || bl.data.platform}` : '';
    const prError = bl.data?.pullRequestsError ? `Open ${bl.data.platform === 'gitlab' ? 'MRs' : 'PRs'} could not be read: ${bl.data.pullRequestsError}` : '';
    $b('#bl-error').textContent = bl.error || prError;
    // (#269: an empty error line takes no room between the alerts, the filter row and the list)
    $b('#bl-error').classList.toggle('hidden', !(bl.error || prError));
    renderAlerts();
    renderLive();
    renderQueue();

    const list = $b('#bl-list');
    if (!bl.projects.length) {
      list.innerHTML = '<div class="empty-state"><b>No projects yet</b><p class="muted">Create a project with a repository (New project… in the header, or Settings › Projects) to see its issues here.</p></div>';
    } else if (!p?.repo) {
      list.innerHTML = '<div class="empty-state"><b>This project has no repository</b><p class="muted">Add a repository URL to the project in Settings › Projects to sync its issues, or choose another project in the header.</p></div>';
    } else if (PLATFORMS[bl.platform]?.soon) {
      list.innerHTML = `<div class="empty-state"><b>${esc(PLATFORMS[bl.platform].label)} sync is not available yet</b><p class="muted">Pick GitHub or GitLab.</p></div>`;
    } else if (!bl.data) {
      list.innerHTML = bl.syncing ? '<p class="muted">Loading issues…</p>' : '<p class="muted">Not synced yet.</p>';
    } else {
      list.innerHTML = bl.mode === 'roadmap' ? window.BacklogRoadmap.html(bl.data, render, { epic: bl.epic, epicOptions: epicChoices(board), showAll: bl.showAll, since: bl.since, release: bl.release, project: bl.projectId, synced: $b('#bl-synced').textContent }) :bl.mode === 'epics' ? renderEpics(issues) : bl.mode === 'kanban' ? renderKanban(board) : renderList(board);
      // the open item's "When it finishes" (#134); the next page when its "Loading…" row comes near (#268)
      if (bl.mode === 'roadmap') {
        window.BacklogRoadmap.mountChain(bl.data);
        window.BacklogRoadmap.mounted(list, render, ownerBusy);
      }
    }
  }

  // the toolbar's and the list's filters
  function clearFilters() {
    bl.q = '';
    $b('#bl-search').value = '';
    setLabels([]);
    bl.epic = '';
    render();
  }
  // an epic's badge or "Show its issues": that epic in the list (the Epics view switches to the list)
  function filterEpic(id) {
    bl.epic = bl.epic === id && bl.mode !== 'epics' ? '' : id;
    if (bl.mode === 'epics') setMode(bl.board);
    render();
  }
  const flipLabel = (name) => { setLabels(toggleLabel(bl.labels, name)); render(); };

  // the Product Owner's drawer (backlog-po.js): inside the app shell, like the other drawers
  const PO_DRAWER = `
    <div id="po-backdrop" class="drawer-backdrop sup-backdrop hidden"></div>
    <aside id="po-drawer" class="drawer sup-drawer po-drawer" aria-hidden="true" aria-label="Product Owner" data-testid="po-drawer">
      <div class="drawer-head">
        <div class="po-head">
          <span id="po-avatar" class="po-avatar" aria-hidden="true"></span>
          <div class="sup-head">
            <h2 class="drawer-title">Product Owner</h2>
            <div id="po-for" class="po-for small" data-testid="po-for"></div>
            <div id="po-sub" class="muted small"></div>
          </div>
        </div>
        <div class="row">
          <select id="po-calib-chip" class="po-calib-chip" aria-label="Calibration of the next answer"></select>
          <select id="po-cost-chip" class="po-calib-chip" aria-label="Cost of the next answer"></select>
          <button id="btn-po-settings" class="icon-btn" type="button" title="Calibrate the Product Owner" aria-label="Calibrate the Product Owner">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3M11 7h9M4 17h9M17 17h3" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></svg>
          </button>
          <button id="btn-po-clear" class="btn sm ghost" type="button" title="Forget this project's conversation">Clear</button>
          <button class="icon-btn" type="button" data-agents-window="product-owner" data-testid="agent-chat-open-window" title="Open in a window (Ctrl+Shift+A)" aria-label="Open the Product Owner in a window"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="14" height="14" rx="2" /><path d="M9 3h12v12M21 3l-9 9" /></svg></button>
          <button id="btn-po-close" class="icon-btn" title="Close (Esc)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
          </button>
        </div>
      </div>
      <!-- #274: the conversation and its text box, driven by the agents' shared chat (agent-chat.js marks them) -->
      <div id="po-chat" class="agent-chat-flat">
      <div id="po-log" class="drawer-body po-log"></div>
      <div class="drawer-foot po-foot">
        <div id="po-sim" class="po-sim hidden" role="group" aria-label="Simulated scenario" title="Simulation only, not part of the app: forces the simulated Product Owner's next answers">
          <span class="po-sim-label">Simulated scenario</span><span id="po-scenario" class="po-sim-opts"></span>
        </div>
        <div id="po-mode" class="seg sm" role="group" aria-label="What to do with the Product Owner">
          <button type="button" data-po-mode="plan">Plan the backlog</button>
          <button type="button" data-po-mode="issue">Register an issue</button>
        </div>
        <div id="po-chips" class="chips po-chips"></div>
        <!-- #235: the workflow a plan question is for, and that workflow's own options -->
        <div id="po-wf-row" class="po-wf-row hidden">
          <label class="po-wf-pick small"><span class="muted">Plan with</span>
            <select id="po-workflow" class="po-wf" data-testid="po-workflow" aria-label="Workflow the Product Owner plans with"></select>
          </label>
          <div id="po-workflow-options" class="po-wf-options" data-testid="po-workflow-options"></div>
        </div>
        <div id="po-files" class="po-files hidden"></div>
        <div id="po-attached" class="po-files po-attached hidden" aria-label="Attached issues"></div>
        <!-- #234: the turn in flight, where the click happened; a click with no project says why nothing was sent -->
        <div id="po-working" class="po-working small hidden" data-testid="po-working" role="status" aria-live="polite"></div>
        <p id="po-notice" class="error small hidden" data-testid="po-notice" role="alert"></p>
        <div class="row po-ask">
          <textarea id="po-question" rows="2" placeholder="Ask about the backlog: which issues should go first?" aria-label="Message to Product Owner"></textarea>
          <button id="btn-po-attach" class="icon-btn hidden" type="button" title="Attach screenshots or files (you can also paste or drop them)" aria-label="Attach files">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5" /></svg>
          </button>
          <button id="btn-po-ask" class="btn primary" type="button">Ask</button>
          <input id="po-file-input" type="file" multiple hidden />
        </div>
        <p id="po-note" class="muted small"></p>
      </div>
      </div>
      <!-- #189: the Product Owner's settings (backlog-po-settings.js), over the conversation -->
      <div id="po-settings" class="po-settings hidden" role="region" aria-label="Calibrate the Product Owner">
        <div class="po-settings-head">
          <button id="btn-po-settings-back" class="icon-btn" type="button" title="Back to the conversation" aria-label="Back to the conversation">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <h2 class="drawer-title">Calibrate the Product Owner</h2>
        </div>
        <div class="po-settings-body">
          <div class="field">
            <label for="po-set-calibration">Speed ↔ Quality</label>
            <div id="po-set-calibration-box"></div>
            <p class="hint">What this changes: how many runs share a stage, how big a run gets, which issues stop for your look and where an issue goes, in every plan answer and live roadmap refill.</p>
          </div>
          <div class="field">
            <label for="po-set-cost">Cost: Economy ↔ Generous</label>
            <div id="po-set-cost-box"></div>
            <p class="hint">What this changes: how many issues share a run, which tests and screenshots the planned items take and, where a workflow allows it, cheaper agents. When it disagrees with Speed ↔ Quality, cost wins.</p>
          </div>
          <div class="row">
            <div class="field">
              <label for="po-set-model">Model <span class="muted">(Claude Code)</span></label>
              <input type="text" id="po-set-model" list="po-set-model-list" maxlength="80" placeholder="claude-opus-5-5" />
              <datalist id="po-set-model-list"></datalist>
            </div>
            <div class="field">
              <label>Effort</label>
              <div id="po-set-effort" class="seg sm" role="group" aria-label="Effort"></div>
            </div>
          </div>
          <p id="po-set-status" class="po-settings-status muted small">Applies to the next answer.</p>
        </div>
      </div>
    </aside>
`;

  // ---- events --------------------------------------------------------------------------------
  function mount() {
    $b('.shell').insertAdjacentHTML('beforeend', PO_DRAWER);
    // the sidebar entry's count of commits merged locally and not pushed (app.js refreshUnpushed)
    $b('nav.sidebar [data-view="backlog"]').insertAdjacentHTML('beforeend', '<span id="nav-backlog-unpushed" class="nav-badge warn hidden"></span>');
    $b('#bl-platform').onchange = (e) => {
      bl.platform = e.target.value;
      bl.seq++;
      bl.syncing = false;
      bl.error = null;
      render();
      if (!PLATFORMS[bl.platform]?.soon) sync();
    };
    $b('#btn-bl-sync').onclick = sync;
    $b('#btn-bl-new-issue').onclick = newIssue;
    $b('#bl-sort').onchange = (e) => { bl.sort = e.target.value; save(SORT_KEY, bl.sort); render(); };
    $b('#btn-bl-assign').onclick = () => openAssign();
    // #169: the selection stays selected; the drawer only attaches it
    $b('#btn-bl-send-po').onclick = () => window.BacklogPO.attach(shownSelected());
    $b('#btn-bl-archive').onclick = () => archive(shownSelected());
    $b('#btn-bl-clear').onclick = () => { bl.selected.clear(); render(); };
    $b('#bl-search').oninput = (e) => { bl.q = e.target.value.trim(); render(); };
    $b('#bl-mode').onclick = (e) => {
      const mode = e.target.closest('[data-mode]')?.dataset.mode;
      if (mode) { setMode(mode); render(); }
    };
    // #217: the Board tab opens its last view (list or kanban)
    $b('#bl-tabs').onclick = (e) => {
      const tab = e.target.closest('[data-bl-tab]')?.dataset.blTab;
      if (tab) { setMode(tab === 'board' ? bl.board : tab); render(); }
    };
    $b('#bl-epic').onchange = (e) => { bl.epic = e.target.value; render(); };
    $b('#btn-bl-labels').onclick = () => { bl.labelsOpen = !bl.labelsOpen; render(); };
    $b('#bl-labels-pop').onchange = (e) => {
      const opt = e.target.closest('[data-label-opt]');
      if (opt) flipLabel(opt.dataset.labelOpt);
    };
    $b('#bl-label-active').onclick = (e) => {
      if (e.target.closest('[data-label-clear]')) { setLabels([]); render(); return; }
      const chip = e.target.closest('[data-label]');
      if (chip) flipLabel(chip.dataset.label);
    };
    // the label menu closes on a click outside it
    document.addEventListener('click', (e) => {
      if (bl.labelsOpen && e.target.isConnected && !e.target.closest('#bl-labels-wrap')) { bl.labelsOpen = false; render(); }
      // an issue's actions menu (#238) too
      if (bl.menu != null && e.target.isConnected && !e.target.closest('.bl-menu-wrap')) { bl.menu = null; render(); }
      // the Roadmap bar's ⋮ menu (#269) too (a click inside the Roadmap closes it there)
      if (bl.mode === 'roadmap' && e.target.isConnected && !e.target.closest('#bl-list') && window.BacklogRoadmap.closeMenu()) render();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && bl.menu != null && visible()) { bl.menu = null; render(); }
      // #269: the Roadmap bar's ⋮ menu (Escape closes it, the arrows move in it)
      if (bl.mode === 'roadmap' && visible()) window.BacklogRoadmap.onKeyDown(e, roadmapCtx());
    });
    // the deprioritized alert's Dismiss (#238, #270): remembered per project (its Archive remembers it too)
    $b('#bl-alerts').addEventListener('click', (e) => {
      if (e.target.closest('[data-deprioritized-dismiss]')) { save(deprioritizedKey(), '1'); render(); }
    });
    $b('#bl-filters').onclick = (e) => {
      const f = e.target.closest('[data-f]')?.dataset.f;
      if (f) { bl.filter = f; render(); }
    };
    $b('#bl-queue').onclick = async (e) => {
      const out = e.target.closest('[data-unqueue]');
      if (out) {
        try { setData(await api.unqueueIssue(bl.projectId, Number(out.dataset.unqueue))); } catch (err) { bl.error = errMsg(err); }
        render();
        return;
      }
      const b = e.target.closest('[data-pause]');
      if (!b) return;
      b.disabled = true;
      try {
        let out = await api.pauseQueue(bl.projectId, b.dataset.pause === 'on');
        // the next item would redo an ended run's kept work (#170): resume that run, or start it from scratch
        if (out?.kept && await keptWorkDialog(out.kept) === 'scratch') out = await api.pauseQueue(bl.projectId, false, true);
        setData(out);
      } catch (err) { bl.error = errMsg(err); }
      render();
    };
    $b('#bl-live').onclick = async (e) => {
      const off = e.target.closest('[data-live-off]');
      if (!off) return;
      off.disabled = true;
      try { setData(await api.setRoadmapLive(bl.projectId, false)); } catch (err) { bl.error = errMsg(err); }
      render();
    };
    $b('#btn-push-ok').onclick = () => doPush(false);
    $b('#btn-push-update').onclick = () => doPush(true);
    $b('#btn-push-resolve').onclick = resolveInRun;
    $b('#btn-push-cancel').onclick = () => closeModal('#push-modal');
    // Roadmap mode: its buttons, fields and drags (backlog-roadmap.js); its run links open the run below
    $b('#bl-list').addEventListener('change', (e) => { if (bl.mode === 'roadmap') window.BacklogRoadmap.onChange(e, roadmapCtx(), bl.data); });
    $b('#bl-list').addEventListener('dragstart', (e) => { if (bl.mode === 'roadmap') window.BacklogRoadmap.onDragStart(e); });
    $b('#bl-list').addEventListener('dragover', (e) => { if (bl.mode === 'roadmap') window.BacklogRoadmap.onDragOver(e, bl.data); });
    $b('#bl-list').addEventListener('dragend', () => { if (bl.mode === 'roadmap') window.BacklogRoadmap.onDragEnd(); });
    $b('#bl-list').addEventListener('drop', (e) => { if (bl.mode === 'roadmap') window.BacklogRoadmap.onDrop(e, roadmapCtx(), bl.data); });
    $b('#bl-list').onclick = async (e) => {
      if (bl.mode === 'roadmap' && await window.BacklogRoadmap.onClick(e, roadmapCtx(), bl.data)) return;
      const check = e.target.closest('[data-sel]');
      if (check) {
        const n = Number(check.dataset.sel);
        if (check.checked) bl.selected.add(n); else bl.selected.delete(n);
        render();
        return;
      }
      const watch = e.target.closest('[data-watch]');
      if (watch) { window.watchWithSupervisor({ runId: watch.dataset.watch, workflow: watch.dataset.workflow, status: 'running', mock: !!watch.closest('[data-n]')?.querySelector('.p-mock') }); return; }
      const label = e.target.closest('[data-label]');
      if (label) { flipLabel(label.dataset.label); return; }
      const epic = e.target.closest('[data-epic-filter]');
      if (epic) { filterEpic(epic.dataset.epicFilter); return; }
      const auto = e.target.closest('[data-auto-epic]');
      if (auto) {
        try {
          await api.setAutoEpic(bl.projectId, auto.checked);
          if (bl.data) bl.data.autoEpic = auto.checked;
        } catch (err) { bl.error = errMsg(err); render(); }
        return;
      }
      if (e.target.closest('[data-organize]')) { window.BacklogPO?.ask(ORGANIZE); return; }
      if (e.target.closest('[data-clear-filters]')) { clearFilters(); return; }
      const run = e.target.closest('[data-run]');
      if (run) { openRun(run); return; }
      const fromCard = e.target.closest('[data-discovery-card]');
      if (fromCard) { window.DiscoveryActions?.openCard(fromCard.dataset.discoveryCard); return; }
      const gate = e.target.closest('[data-gate]');
      if (gate) { openGate(gate); return; }
      const out = e.target.closest('[data-unqueue]');
      if (out) { await removeQueued(Number(out.dataset.unqueue)); return; }
      const enrich = e.target.closest('[data-enrich]');
      if (enrich) { bl.menu = null; render(); enrichIssue(Number(enrich.dataset.enrich)); return; }
      // #238: an issue's actions menu, its Archive, and Restore
      const menu = e.target.closest('[data-menu]');
      if (menu) { bl.menu = bl.menu === Number(menu.dataset.menu) ? null : Number(menu.dataset.menu); render(); return; }
      const arch = e.target.closest('[data-archive]');
      if (arch) { bl.menu = null; render(); if (!arch.disabled) await archive([Number(arch.dataset.archive)]); return; }
      const back = e.target.closest('[data-restore]');
      if (back) { await restore(Number(back.dataset.restore)); return; }
      if (e.target.closest('.bl-menu')) return;
      if (e.target.closest('a')) return;
      const row = e.target.closest('[data-act="toggle"]');
      if (!row) return;
      const n = Number(row.closest('.bl-issue').dataset.n);
      if (bl.expanded.has(n)) bl.expanded.delete(n); else bl.expanded.add(n);
      render();
    };
    $b('#assign-workflow').onchange = renderAssignInputs;
    $b('#assign-mock').onchange = updateAssignNote;
    $b('#assign-grouping').onchange = updateAssignNote;
    $b('#assign-form').onsubmit = submitAssign;
    $b('#btn-assign-roadmap').onclick = addToRoadmap;
    $b('#btn-assign-cancel').onclick = () => closeModal('#assign-modal');
  }

  registerView({
    id: 'backlog',
    nav: { label: 'Backlog', order: 40, group: 'code', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 6 1.5 1.5L8 5" /><path d="m4 12 1.5 1.5L8 11" /><path d="m4 18 1.5 1.5L8 17" /><path d="M11 6h9M11 12h9M11 18h9" /></svg>' },
    markup: `
      <section id="view-backlog" class="view hidden">
        <div class="page-head">
          <div>
            <h1 id="bl-title">Backlog</h1>
            <p class="muted small"><span id="bl-hint">A project's issues, synced from its git platform.</span> The last sync is kept in <span id="backlog-dir" class="mono"></span></p>
          </div>
          <div class="row">
            <select id="bl-platform" aria-label="Platform"></select>
            <button id="btn-bl-sync" class="btn primary nowrap">Sync</button>
            <button id="btn-bl-new-issue" class="btn ghost nowrap" type="button" title="Describe a problem or an idea in a few words: the issue-tracker workflow analyses the code, rates impact and complexity, drafts the issue and files it once you approve">New issue…</button>
          </div>
        </div>
        <div id="bl-tabs" class="tabs page-tabs" role="tablist" aria-label="Backlog">
          <button type="button" class="tab" role="tab" data-bl-tab="board" title="The issues as a list or a kanban">Board</button>
          <button type="button" class="tab" role="tab" data-bl-tab="epics" data-mode="epics" title="The epics: themes of issues, with their progress and members">Epics</button>
        </div>
        <div id="bl-alerts" class="hidden"></div>
        <div class="pr-toolbar" id="bl-toolbar" data-testid="filter-row">
          <span id="bl-mode" class="seg sm" role="group" aria-label="Board view">
            <button type="button" data-mode="list">List</button>
            <button type="button" data-mode="kanban">Kanban</button>
          </span>
          <span id="bl-count" class="small muted" data-testid="backlog-count"></span>
          <div id="bl-filters" class="chips"></div>
          <input type="text" id="bl-search" placeholder="Search issues, labels…" aria-label="Search" />
          <div id="bl-labels-wrap" class="bl-labels-wrap">
            <button id="btn-bl-labels" class="btn sm ghost" type="button" aria-haspopup="true" title="Filter by labels. Labels of different groups (the prefix before ':') must all match; labels of the same group match any of them, e.g. bug AND (complexity:1 OR complexity:2). Whole names, any case.">Labels</button>
            <div id="bl-labels-pop" class="bl-labels-pop hidden" role="menu" aria-label="Labels"></div>
          </div>
          <span id="bl-label-active" class="bl-label-active"></span>
          <select id="bl-epic" class="hidden" aria-label="Epic" title="Show the issues of one epic, or those in no epic"></select>
          <select id="bl-sort" aria-label="Sort" title="Sort by the triage labels (impact:1-5, complexity:1-5); issues without them go last">
            <option value="updated">Recently updated</option>
            <option value="impact">Impact (highest first)</option>
            <option value="complexity">Complexity (smallest first)</option>
          </select>
          <button id="btn-bl-assign" class="btn sm primary hidden" type="button">Assign workflow…</button>
          <button id="btn-bl-send-po" class="btn sm ghost hidden" type="button" title="Ask the Product Owner about the selected issues before planning them">Send to Product Owner</button>
          <button id="btn-bl-archive" class="btn sm ghost hidden" type="button" data-testid="backlog-archive-selection">Archive</button>
          <button id="btn-bl-clear" class="btn sm ghost hidden" type="button">Clear selection</button>
          <span class="spacer"></span>
          <span id="bl-synced" class="muted small"></span>
        </div>
        <div id="bl-live" class="bl-live hidden" role="status"></div>
        <div id="bl-queue" class="bl-queue hidden"></div>
        <p id="bl-error" class="error small"></p>
        <div id="bl-list" class="pr-list" data-testid="backlog-list"></div>
        <button id="btn-bl-po" class="po-fab" type="button" title="Ask the Product Owner: which issues to run together, which not, in what order" aria-label="Product Owner"></button>
      </section>`,
    modals: `
  <div id="unqueue-modal" class="modal hidden">
    <div class="modal-card">
      <h3>Remove from a grouped run</h3>
      <p id="unqueue-message" class="muted"></p>
      <div class="modal-actions">
        <button type="button" id="btn-unqueue-keep" class="btn ghost">Keep it</button>
        <button type="button" id="btn-unqueue-one" class="btn">Remove it from the group</button>
        <button type="button" id="btn-unqueue-all" class="btn danger-solid">Cancel the group</button>
      </div>
    </div>
  </div>
  <div id="push-modal" class="modal hidden">
    <div class="modal-card">
      <h3 id="push-title">Push the local merges</h3>
      <p id="push-message" class="muted small"></p>
      <ul id="push-commits" class="bl-push-commits small"></ul>
      <p id="push-error" class="error small"></p>
      <div class="modal-actions">
        <label id="push-resolve-mock-wrap" class="check small hidden" title="Developer mode: the run is simulated, no CLI is called"><input type="checkbox" id="push-resolve-mock" /><span>Simulate</span></label>
        <button type="button" id="btn-push-cancel" class="btn ghost">Cancel</button>
        <button type="button" id="btn-push-resolve" class="btn primary hidden" title="Start a run of the local workflow: its developer merges origin into the local commits and resolves the conflict">Resolve in a run</button>
        <button type="button" id="btn-push-update" class="btn hidden">Update and push</button>
        <button type="button" id="btn-push-ok" class="btn primary">Push</button>
      </div>
    </div>
  </div>
  <div id="cut-line-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="cut-line-title" data-testid="cut-line-modal">
    <form id="cut-line-form" class="modal-card">
      <h3 id="cut-line-title">Release here</h3>
      <p class="muted small">A cut line after this stage. When the roadmap reaches it, a release run checks the whole unit and E2E suites, then you Ship or Hold; the stages after the line wait for it.</p>
      <div class="field">
        <label for="cut-line-name">Release name</label>
        <input type="text" id="cut-line-name" placeholder="e.g. v1.4" autocomplete="off" />
        <div class="hint">A name or a version: Ship tags the release with it.</div>
      </div>
      <p id="cut-line-error" class="error small"></p>
      <div class="modal-actions">
        <button type="button" id="btn-cut-line-cancel" class="btn ghost">Cancel</button>
        <button type="submit" id="btn-cut-line-ok" class="btn primary">Add cut line</button>
      </div>
    </form>
  </div>
  <div id="rm-versions-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="rm-versions-title">
    <div class="modal-card">
      <h3 id="rm-versions-title">Restore an earlier version</h3>
      <p class="muted small">The roadmap as it was before each of your last edits (the last 20 are kept), newest first. Restore puts the stages, their order and their names back; items that started since keep their runs, items added since stay, and no run is stopped.</p>
      <ul id="rm-versions" class="rm-versions" data-testid="roadmap-versions"></ul>
      <p id="rm-versions-error" class="error small" role="alert"></p>
      <div class="modal-actions">
        <button type="button" id="btn-rm-versions-close" class="btn ghost">Close</button>
      </div>
    </div>
  </div>
  <div id="assign-modal" class="modal hidden">
    <form id="assign-form" class="modal-card">
      <h3 id="assign-title">Assign a workflow</h3>
      <div class="assign-body">
        <ul id="assign-issues" class="assign-issues" aria-label="Issues"></ul>
        <div id="assign-busy" class="bl-busy hidden"></div>
        <fieldset id="assign-grouping" class="bl-grouping hidden">
          <legend class="small">Send them as</legend>
          <label class="check"><input type="radio" name="assign-group" value="separate" checked /><span>Separate runs: one per issue (one branch and one PR/MR each), in the order selected</span></label>
          <label class="check"><input type="radio" name="assign-group" value="group" /><span>One run for all: one branch and one PR/MR that closes every issue</span></label>
        </fieldset>
        <div class="field">
          <label for="assign-workflow">Workflow</label>
          <select id="assign-workflow"></select>
          <div id="assign-wf-desc" class="hint"></div>
          <details id="assign-wf-about" class="assign-about"><summary>About this workflow</summary><p id="assign-wf-about-text"></p></details>
          <div id="assign-proposed" class="small hidden"></div>
        </div>
        <fieldset id="assign-settings" class="assign-settings">
          <legend>Settings</legend>
          <div id="assign-inputs" class="wi-grid" data-wi-scope></div>
        </fieldset>
        <details id="assign-agents" class="adv hidden"><summary>Agents</summary><div id="assign-agents-list"></div></details>
        <div id="assign-chain"></div>
        <div id="assign-pipeline" class="drawer-pipeline hidden"></div>
        <label class="check dev-only"><input type="checkbox" id="assign-mock" /><span>Simulation (no CLI is called, nothing is spent)</span></label>
      </div>
      <div class="assign-foot">
        <p id="assign-note" class="small"></p>
        <p id="assign-error" class="error small"></p>
        <div class="modal-actions">
          <button type="button" id="btn-assign-cancel" class="btn ghost">Cancel</button>
          <button type="button" id="btn-assign-roadmap" class="btn ghost" title="Plan it instead: a new stage at the end of the roadmap, started with the roadmap">Add to roadmap</button>
          <button type="submit" id="btn-assign-ok" class="btn primary">Start</button>
        </div>
      </div>
    </form>
  </div>`,
    mount,
    show: () => openScreen(false),
  });
  // #254: the Roadmap, a screen of its own in the menu, drawn in the Backlog's section by this file
  registerView({
    id: 'roadmap',
    nav: { label: 'Roadmap', order: 45, group: 'code', title: 'Ordered stages of runs: each stage starts when the previous one has finished and merged', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4" /><path d="M5 4h12l-2.5 4 2.5 4H5" /></svg>' },
    section: 'backlog',
    show: () => openScreen(true),
  });

  window.refreshBacklog = refreshBacklog;
  // a run's title or PR state changed (app.js onRunMeta): the cards draw it from the shared data
  window.renderBacklogCards = () => { if (visible() && bl.data) render(); };
  window.BacklogActions = {
    assignGroup,
    data: () => bl.data,
    // one issue in the list (a #<number> link in the Oracle's answers, #171): the search "#<n> "
    // matches that number only
    focusIssue: (number) => {
      if (!number) return;
      bl.q = `#${number} `;
      if (bl.mode === 'roadmap') bl.mode = bl.board;
      const input = $b('#bl-search');
      if (input) input.value = bl.q;
    },
    // the project the next refresh shows (a notification's click, before showView('backlog')): the app's (#254)
    focusProject: (id) => {
      if (!id) return;
      bl.projectId = id;
      window.CurrentProject.set(id, { redraw: false });
    },
    openStage,
    // the header's project ({ id, name }): the Product Owner's header names it (#235)
    project: () => project() || null,
    projectId: () => bl.projectId,
    roadmapGroup,
    // the board with its columns, when the Backlog opens next (Home's flow strip, #255: the To do and
    // Merged locally counts open them), for that visit: the remembered mode is not changed
    showColumns: () => { columns = 'asked'; },
    // the backlog synced again after the Product Owner filed or updated an issue (#117)
    showData: (data) => { if (data) { setData(data); render(); } },
    showRoadmap,
  };
})();
