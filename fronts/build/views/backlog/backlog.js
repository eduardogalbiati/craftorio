// Backlog screen: a project's issues synced from its git platform (packages/engine/domains/backlog/backlog.js), as a list or a
// kanban (To do / In progress / Waiting for approval / Done). Shows the last sync right away and
// syncs again in the background each time the screen opens. The platform is the project's (#745,
// window.Platforms.projectPlatform: its host or the platform stored on it), shown as a badge; the
// select appears only for a host that can't tell it, and its pick is saved on the project.
// Selected To do issues can be assigned to a workflow: Add to roadmap plans them as a new last
// roadmap stage (#446, no plain queue any more), as separate items or one item for all of them (one
// branch, one PR/MR); its "Run now" starts that stage on its own (#141). Issues link to the runs
// working on them. The Assign dialog's "When it finishes" (#134, chain-picker.js) chains each run.
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
// The third mode, Roadmap, is backlog-roadmap.js (ordered stages of runs); assigning an issue the
// roadmap already plans asks first.
// The Product Owner's drawer (backlog-po.js) applies a proposed group through window.BacklogActions.
// Send to Product Owner (n) (#169), next to Assign workflow…, attaches the selection to the drawer's
// question (window.BacklogPO.attach); the selection is kept.
// Alerts (#270, alerts.js): what the page has to say sits at its top, above the filter row, one at a
// time (renderAlerts): a roadmap paused by an item (an error), a stale Backlog
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
// assign / push dialogs; mount() wires them and adds the sidebar's unpushed badge.
// Uses app.js globals ($, esc, state, errMsg, dateOf, markdownHtml, showView, openModal,
// closeModal, devMode, wantsSimulation, openGateOf, openNextGate, selectRun, confirmDialog).
/* global api */
(() => {
  // The platform adapters (packages/shared/platforms/, #351; platformOf: GitHub's when unknown) plus Bitbucket (soon = no sync yet), as in packages/engine/domains/backlog/issues.js.
  const { DEFAULT_PLATFORM, platformOrDefault: platformOf, requestRef } = window.Platforms;
  const PLATFORMS = { ...Object.fromEntries(window.Platforms.PLATFORMS.map((p) => [p.id, { label: p.label }])), bitbucket: { label: 'Bitbucket', soon: true } };
  window.BACKLOG_PLATFORMS = PLATFORMS;
  const MODE_KEY = 'multiagent.backlogMode';
  // #217: the Board tab's last view (list or kanban) and the Roadmap's Show all (#268: its Planned |
  // All switch, All when set) with its date range
  const BOARD_KEY = 'multiagent.backlogBoard';
  const SHOW_ALL_KEY = 'multiagent.roadmapShowAll';
  const SINCE_KEY = 'multiagent.roadmapSince';
  const RELEASE_KEY = 'multiagent.roadmapRelease'; // #291: the Releases filter ('' all, 'next', a version)
  const WORKFLOW_KEY = 'multiagent.backlogWorkflow';
  const INPUTS_KEY = 'multiagent.backlogInputs.'; // + project id + workflow file: the Assign dialog's last values (#446)
  const LABELS_KEY = 'multiagent.backlogLabels.'; // + project id
  const SORT_KEY = 'multiagent.backlogSort';
  const SORTS = ['complexity', 'impact', 'updated'];
  // #238: the one-time banner of the issues still labelled with the retired `deprioritized` (per project)
  const DEPRIORITIZED_KEY = 'multiagent.backlogDeprioritized';
  const ISSUE_TRACKER = 'issue.yaml'; // #648: issue-tracker.yaml became issue.yaml
  const REFRESH = 'backlog-refresh.yaml';
  // the one-off seed of #138: the Product Owner proposes epics for the open issues (same text as its chip)
  const ORGANIZE = 'Organize the open issues into epics';
  // #238: Archived = closed with the `archived` label; Closed shows the other closed issues
  const FILTERS = ['open', 'closed', 'archived', 'all'];
  // 'local': merged into the local base by a local workflow, not pushed yet (shown when there is any)
  const COLUMNS = ['todo', 'in_progress', 'waiting', 'local', 'done'];

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
  // #745: the header project's platform id (github / gitlab) when its host or its stored platform tells it, else null
  const knownPlatform = () => window.Platforms.projectPlatform?.(project())?.id || null;
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
    // #745: the project's platform (its host, or the one stored on it), never a global setting
    bl.platform = knownPlatform() || bl.data?.platform || DEFAULT_PLATFORM;
    render();
    // the stage openStage was asked for before this read
    const stage = stageToShow;
    stageToShow = null;
    if (stage && bl.data && state.view === 'roadmap') openStage(stage);
    if (project()?.repo && !PLATFORMS[bl.platform]?.soon) sync();
  }

  // what the screen shows, to tell an automatic refresh that changes nothing (#214)
  let shownData = '';
  let busyChecked = null; // (#491: the light state's mark and backlogChanged's answer)
  // (`edit`, #281: the id a save answers with for its Undo toast, is not something the screen shows:
  // with it in the key, the backlog:changed that follows every edit redrew the same list once more)
  const dataKey = (id, data) => `${id}:${JSON.stringify(data ? { ...data, edit: undefined } : null)}`;
  // (#491: merged from the light state, its key waits for a full read to compare: it is megabytes)
  function setData(data, { merged = false } = {}) {
    bl.data = data;
    shownData = merged ? null : dataKey(bl.projectId, data);
    busyChecked = null;
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

  // Re-reads the cached issues with their runs and roadmap (cheap, no sync). An automatic refresh
  // whose data is the same as what is shown renders nothing (#214: no flicker under the owner).
  // #491: the scroll read right before the DOM is replaced; `reload.merged`: liveReload's merged state
  async function reload() {
    const id = bl.projectId;
    const merged = reload.merged;
    reload.merged = null;
    if (!id || bl.syncing) return;
    try {
      const data = merged || await api.getBacklog(id);
      if (!data || bl.projectId !== id || bl.syncing) return;
      if (!merged && dataKey(id, data) === (shownData ??= dataKey(id, bl.data))) return;
      renderKeepingScroll(() => setData(data, { merged: !!merged }));
    } catch { /* keep what is shown */ }
  }
  function renderKeepingScroll(change) { // the screen redrawn where it is: its scroll read before `change` (new data, #491) and the draw, then put back (#748)
    const view = $b('#view-backlog'), top = view?.scrollTop;
    if (typeof change === 'function') change();
    render(); if (view && top != null) view.scrollTop = top;
  }

  // Runs start, move between steps, stop at gates and end while the screen is open (#214): only the
  // events that change an item's status, progress ring (#194) or waiting badge refresh the screen,
  // at most once per RUN_THROTTLE_MS, and through liveReload (never under an open Edit form). Session
  // messages (several a second) refresh only the Roadmap, whose cost meters follow them (#615).
  const RUN_THROTTLE_MS = 2000;
  const RUN_STATUS_EVENTS = /^(workflow\.(started|finished)|step\.(started|finished|waiting)|approval\.(requested|resolved))$/;
  let runTimer = null;
  let runLast = 0;
  api.onEvent((ev) => {
    if (ev?.type && !RUN_STATUS_EVENTS.test(ev.type) && !(ev.type === 'session.message_received' && bl.mode === 'roadmap')) return;
    if (!visible() || runTimer) return;
    runTimer = setTimeout(() => { runTimer = null; runLast = Date.now(); liveReload(); }, Math.max(0, runLast + RUN_THROTTLE_MS - Date.now()));
  });
  // A live roadmap's refill (#164) changes without run events. Also the file watch's fallback (#204) and a running roadmap
  // item's cost meter (#615: its run may be in another app): the Roadmap screen is polled every 5 s.
  let watching = true;
  api.backlogWatching?.().then((w) => { watching = w !== false; }).catch(() => {});
  setInterval(() => {
    const busy = bl.data?.issues?.some((i) => i.runs?.[0]?.status === 'running') || bl.data?.roadmap?.live || bl.data?.refresh?.running || (bl.mode === 'roadmap' && bl.data?.roadmap?.stages?.some((s) => (s.items || []).some((x) => x.status === 'running')));
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
  // #491: one live reload in flight at a time (`running`), the requests made meanwhile run once after
  // it; the Roadmap merges the light state (backlog-live.js readLight), `shownState` its last key.
  let shownState = '';
  async function liveReload() {
    if (!visible() || document.hidden) return;
    if (liveReload.running) { liveReload.again = true; return liveReload.running; }
    liveReload.running = (async () => {
      if (ownerBusy()) {
        // read each time (#287): the notice says what changed since the form opened
        if (!(await backlogChanged()) && !pendingReload) return;
        staleNotice();
        pendingReload ??= setInterval(() => { if (!ownerBusy()) { clearInterval(pendingReload); pendingReload = null; liveReload(); } }, 1000);
        return;
      }
      const id = bl.projectId;
      if (bl.mode === 'roadmap' && bl.data?.roadmap && api.getBacklogState && window.BacklogLive && !bl.syncing) {
        const { light, key } = await window.BacklogLive.readLight(api, id);
        if (light && bl.projectId === id && key === shownState) return;
        const merged = light && bl.projectId === id && !bl.syncing && window.BacklogRoadmap.mergeState(bl.data, light);
        shownState = merged ? key : '';
        reload.merged = merged || null;
      }
      await reload();
    })().finally(() => { liveReload.running = null; });
    await liveReload.running;
    if (liveReload.again) { liveReload.again = false; await liveReload(); }
  }
  // whether the Backlog differs from what is shown (bl.latest); #491: read whole only when the mark moved
  async function backlogChanged() {
    const id = bl.projectId;
    if (!id) return false;
    try {
      let mark = null;
      if (bl.mode === 'roadmap' && api.getBacklogState && window.BacklogLive) {
        ({ mark } = await window.BacklogLive.readLight(api, id));
        if (mark && busyChecked?.mark === mark) return busyChecked.changed;
      }
      const data = await api.getBacklog(id);
      const changed = !!data && bl.projectId === id && dataKey(id, data) !== (shownData ??= dataKey(id, bl.data));
      bl.latest = changed ? data : null;
      busyChecked = mark ? { mark, changed } : null;
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
    p.innerHTML = `<span data-bl-stale-text data-testid="roadmap-changed-notice" role="status">${text}</span> <button type="button" class="link-btn small" data-bl-stale-reload>${t('backlog.reload')}</button>`;
    p.querySelector('button').addEventListener('click', () => {
      window.BacklogRoadmap?.closeEdit();
      document.activeElement?.blur?.();
      shownData = ''; busyChecked = null; // the closed form is re-rendered even when the data changed back
      liveReload();
    });
    form.prepend(p);
  }
  api.onBacklogChanged?.((ev) => {
    if (ev?.watching === false) { watching = false; return; }
    watching = true;
    if (ev?.projectId && ev.projectId === bl.projectId) liveReload();
  });
  // #465: the base check's card follows its start and end
  api.onBaseCheckChanged?.((ev) => { if (!ev?.projectId || ev.projectId === bl.projectId) liveReload(); });

  // Opens a run in the remembered run view (Chat or Details, showRun in app.js).
  function openRun(el) {
    window.showRun(el.dataset.run, { workflow: el.dataset.workflow });
  }

  // "Enrich" (#103; #648: write-doc in the Documents editor, window.writeDocForCard): the prompt is the issue (DuoIssue.issuePrompt)
  function enrichIssue(number) {
    const issue = bl.data?.issues?.find((i) => i.number === number);
    if (!issue) return;
    const full = { number: issue.number, title: issue.title, url: issue.url, body: issue.body || '', labels: issue.labels || [] };
    window.writeDocForCard({
      projectId: bl.projectId,
      title: issue.title,
      issue: { number: issue.number, url: issue.url, title: issue.title },
      prompt: window.DuoIssue?.issuePrompt(full) || '',
    }).catch((e) => { bl.error = errMsg(e); render(); });
  }

  // New issue (#81): the Start drawer on the issue workflow, for this project and platform;
  // the owner writes the request and starts it. The issue shows here after the next sync.
  function newIssue() {
    if (!project()?.repo) return;
    openDrawer({ workflow: ISSUE_TRACKER, project: bl.projectId, inputs: { git_platform: platformOf(bl.platform).short } });
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
    const saved = savedInputs(wf?.file);
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
    strip.innerHTML = pipe ? `<div class="drawer-pipeline-head"><span class="chain-banner-title">${t('backlog.pipeline')}</span><span class="badge">${pipe.stages.length} ${t('backlog.stages')}</span></div>
      ${ChainModel.pipelineStagesHtml(pipe, { names: Object.fromEntries((bl.chainWorkflows || []).map((w) => [w.file, w.name])), current: 0 })}
      <p class="muted small">${t('backlog.each_issue_s_run_is_the')}</p>` : '';
    updateAssignNote();
  }
  // The dialog's "When it finishes" (#134): every workflow can follow, not only those with a task.
  let chainPicker = null;
  const assignChain = () => (chainPicker ??= ChainPicker.mount($b('#assign-chain'), {
    workflows: () => bl.chainWorkflows || [], source: () => (bl.chainWorkflows || []).find((w) => w.file === $b('#assign-workflow').value) || null,
  }));
  // The values to send: the YAML values (an enum's value, a switch as true/false).
  const assignInputs = () => WorkflowInputs.read($b('#assign-inputs'));
  // #446: the values last sent for this project and workflow (the plain queue remembered them before)
  const savedInputs = (file) => { try { return JSON.parse(load(`${INPUTS_KEY}${bl.projectId}.${file}`) || '{}') || {}; } catch { return {}; } };
  // #262: the Agents section's choices, only what differs from the workflow (null when none)
  const assignAgentOverrides = () => {
    const o = window.AgentOverrides?.read($b('#assign-agents-list')) || {};
    return Object.keys(o).length ? o : null;
  };

  // Selected issues that already have work in flight: an open PR/MR, or a run in progress or waiting.
  const prName = (p) => requestRef(bl.data?.platform, p.number);
  function inFlight(i) {
    const why = (i.pullRequests || []).map((p) => t(p.draft ? 'backlog.open_pr_draft' : 'backlog.open_pr', { pr: prName(p) }));
    const r = i.runs?.[0];
    if (r && (r.waiting || r.status === 'running')) why.push(t(r.waiting ? 'backlog.run_waiting_for_approval' : 'backlog.run_in_progress', { workflow: r.workflow || 'workflow' }));
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
    const count = busy.length;
    box.innerHTML = `
      <span class="warn-text small"><b>${t('backlog.selected_issues_in_flight', { count })}</b> ${t('backlog.starting_again_may_duplicate', { count })}</span>
      <ul class="small">${busy.map((i) => `<li>#${i.number} ${esc(i.title)}: ${esc(inFlight(i).join(', '))}</li>`).join('')}</ul>
      <label class="check"><input type="checkbox" id="assign-skip-busy" checked /><span>${t('backlog.skip_busy_uncheck_to_assign_anyway', { count })}</span></label>`;
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
    const runCount = { count: runs }; // a plural catalog entry ({ one, other }) picked by the number of runs
    $b('#assign-grouping').classList.toggle('hidden', n < 2);
    $b('#btn-assign-ok').disabled = !n || tooMany;
    const note = $b('#assign-note');
    note.className = `small ${n && !tooMany ? 'muted' : 'warn-text'}`;
    const what = group ? `${t('backlog.assign_group_closing', { n, request: platformOf(bl.data?.platform).request.short, numbers: numbers.map((x) => `#${x}`).join(', ') })} ` : '';
    note.textContent = !n ? t('backlog.nothing_to_start_every_selected_issue')
      : tooMany ? t('backlog.one_run_takes_at_most_value', { value: maxGroup() })
        : mock ? t('backlog.assign_simulated_runs_note', { ...runCount, what })
          : t('backlog.assign_real_runs_note', { ...runCount, what });
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
    const options = DefaultWorkflow.projectFirst(bl.workflows).map((w) => `<option value="${esc(w.file)}">${esc(w.name)}</option>`).join('');
    sel.innerHTML = bl.pipelines.length
      ? `<optgroup label="Workflows">${options}</optgroup><optgroup label="Pipelines">${bl.pipelines.map((p) => `<option value="${esc(PIPE + p.file)}">⛓ ${esc(p.name)}</option>`).join('')}</optgroup>`
      : options;
    const files = [...bl.workflows.map((w) => w.file), ...bl.pipelines.map((p) => PIPE + p.file)];
    // nothing remembered: the default development workflow (#195, Settings › General › Backlog; #486: the project's own first, its set first in the list)
    sel.value = [prefill?.workflow, load(WORKFLOW_KEY), DefaultWorkflow.current().file, files[0]].find((f) => f && files.includes(f));
    // real runs by default: Simulation is opt-in (checked only where real runs are refused anyway)
    $b('#assign-mock').checked = !!state.simulationOnly;
    // #446: several issues go as one roadmap item by default (when they fit one run), as the Product Owner's groups
    const together = prefill ? !!prefill.group : issues.length > 1 && issues.length <= maxGroup();
    document.querySelector(`input[name="assign-group"][value="${together ? 'group' : 'separate'}"]`).checked = true;
    $b('#assign-run-now').checked = false;
    renderAssignBusy();
    assignChain().set(null);
    renderAssignInputs();
    for (const [k, v] of Object.entries(prefill?.inputs || {})) WorkflowInputs.set($b('#assign-inputs'), k, v);
    // #216: what the Product Owner chose, as the same pills as its card (the Settings below edit them)
    const proposed = prefill?.inputs ? WorkflowInputs.inputPills(bl.workflows.find((w) => w.file === prefill.workflow) || null, prefill.inputs, { defaults: true }) : '';
    $b('#assign-proposed').innerHTML = proposed ? `<span class="muted">${t('backlog.product_owner_s_choices')}</span> ${proposed}` : '';
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
    if (inRoadmap.length && !await confirmDialog(t('backlog.already_in_the_roadmap'), t(inRoadmap.length > 1 ? 'backlog.planned_in_roadmap_many' : 'backlog.planned_in_roadmap_one', { list: inRoadmap.map((i) => t('backlog.number_stage', { number: i.number, stage: i.roadmap.stage })).join(', ') }), t('backlog.assign_anyway'))) return;
    const btn = $b('#btn-assign-ok');
    btn.disabled = true;
    try {
      const mock = wantsSimulation($b('#assign-mock'));
      // a pipeline's chain is the service's (pipeline: its file), not the dialog's "When it finishes"
      const then = pipe ? null : assignChain().value();
      const pipeline = pipe?.file || null;
      // #262: each run's provider / model / effort per agent (a pipeline keeps its workflows')
      const agentOverrides = pipe ? null : assignAgentOverrides();
      // #446: a new last roadmap stage; Run now starts it on its own (#141)
      const runNow = $b('#assign-run-now').checked;
      let data = await api.assignWorkflow(bl.projectId, numbers, workflow, inputs, mock, grouped(), false, then, pipeline, agentOverrides, runNow);
      // an ended run kept work for these issues (#170): resume that run, or start from scratch
      if (data?.kept) {
        const kept = await keptWorkDialog(data.kept);
        if (kept === 'resume') closeModal('#assign-modal');
        if (kept !== 'scratch') return;
        data = await api.assignWorkflow(bl.projectId, numbers, workflow, inputs, mock, grouped(), true, then, pipeline, agentOverrides, runNow);
      }
      save(WORKFLOW_KEY, choice);
      save(`${INPUTS_KEY}${bl.projectId}.${workflow}`, JSON.stringify(inputs || {}));
      bl.selected.clear();
      closeModal('#assign-modal');
      showRoadmap(data);
    } catch (err) {
      $b('#assign-error').textContent = errMsg(err);
    } finally {
      btn.disabled = false;
    }
  }
  const roadmapCtx = () => ({
    projectId: bl.projectId, setData, setError: (msg) => { bl.error = msg; },
    render: renderKeepingScroll, // #748: the scroll stays
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

  const issueOf = (number) => (bl.data?.issues || []).find((i) => i.number === number); // the loaded issue numbered `number`

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
  const noMatch = () => `<div class="empty-state"><b>${t('backlog.no_issues_match_the_filters')}</b>
    <p class="muted">${bl.epic ? t('backlog.epic_value', { value: esc(bl.epic === NO_EPIC ? t('backlog.no_epic') : epicById(bl.epic)?.title || bl.epic) }) : ''}${bl.labels.length ? t('backlog.labels_value', { value: esc(bl.labels.join(', ')) }) : ''}${bl.q ? t('backlog.search_q', { q: esc(bl.q) }) : ''}</p>
    <button class="btn sm ghost" type="button" data-clear-filters>${t('backlog.clear_filters')}</button></div>`;

  const colorStyle = (color) => (color ? ` style="--lc:${esc(color)}"` : '');
  // A label chip toggles its label in the filter (`on` while selected).
  const labelChip = (l) => {
    const on = hasLabel(bl.labels, l.name);
    return `<button class="bl-label${on ? ' on' : ''}" type="button" data-label="${esc(l.name)}" title="${on ? t('backlog.remove_from_the_label_filter') : t('backlog.filter_by_this_label')}"${colorStyle(l.color)}>${esc(l.name)}</button>`;
  };
  const labels = (i) => i.labels.map(labelChip).join('');
  // Impact and complexity from the triage labels, as two compact badges (none without the labels).
  const triage = (i) => {
    const s = triageScores(i);
    return [['impact', 'I', 'Impact'], ['complexity', 'C', 'Complexity']].filter(([k]) => s[k] != null)
      .map(([k, short, name]) => `<span class="badge bl-triage bl-${k} lvl-${s[k]}" title="${t('backlog.name_value_5_issue_triage', { name, value: s[k] })}">${short}${s[k]}</span>`).join('');
  };
  // Its epic (#138) as a small badge that filters by it (an epic issue already shows its `epic` label).
  const epicBadge = (i) => {
    const e = i.epic && epicById(i.epic);
    return e ? `<button class="badge bl-epic${bl.epic === e.id ? ' on' : ''}" type="button" data-epic-filter="${esc(e.id)}" title="${esc(t('backlog.epic_id_title_show_only_its', { id: e.id, title: e.title }))}">${esc(e.title)}</button>` : '';
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
    sel.innerHTML = `<option value="">${t('backlog.all_epics')}</option>${epicChoices(issues).map((o) => `<option value="${esc(o.id)}">${esc(o.title)} (${o.count})</option>`).join('')}`;
    sel.value = bl.epic;
    sel.classList.toggle('active', !!bl.epic);
  }

  // The Epics view (#138): each epic with its progress and members, then the issues in no epic.
  function renderEpics(issues) {
    const epics = bl.data?.epics || [];
    const bar = `<div class="bl-queue bl-epics-bar">
        <span><b>${t('backlog.epics')}</b> <span class="muted small">${epics.length} · ${esc(platformOf(bl.data?.platform).epicHelp)}</span></span>
        ${bl.data?.epicsError ? `<span class="warn-text small" title="${esc(bl.data.epicsError)}">${t('backlog.members_could_not_be_read_last')}</span>` : ''}
        <span class="spacer"></span>
        <label class="check small" title="${t('backlog.a_new_issue_the_product_owner')}"><input type="checkbox" data-auto-epic${bl.data?.autoEpic ? ' checked' : ''} /><span>${t('backlog.auto_place_new_issues')}</span></label>
        <button class="btn sm ghost" type="button" data-organize title="${t('backlog.ask_the_product_owner_to_propose')}">${t('backlog.organize_into_epics')}</button>
      </div>`;
    if (!epics.length) {
      return `${bar}<div class="empty-state"><b>${t('backlog.no_epics_yet')}</b><p class="muted">${t('backlog.an_epic_groups_the_issues_of')}</p>
        <button class="btn sm primary" type="button" data-organize>${t('backlog.organize_into_epics')}</button></div>`;
    }
    const byNumber = new Map(issues.map((i) => [i.number, i]));
    const member = (n) => {
      const i = byNumber.get(n);
      if (!i) return `<li class="bl-epic-member muted"><span class="bl-num mono">#${n}</span> ${t('backlog.not_synced')}</li>`;
      return `<li class="bl-epic-member" title="${esc(`#${i.number} ${i.title}`)}"><span class="bl-state ${i.state}"></span><span class="bl-num mono">#${i.number}</span><a class="bl-epic-member-title" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>${window.BacklogRoadmap.badge(i)}</li>`;
    };
    const cards = epics.map((e) => {
      const p = epicProgress(e, issues);
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      return `<section class="bl-epic-card" data-epic="${esc(e.id)}" data-testid="backlog-epic">
        <div class="bl-epic-head">
          <span class="bl-state ${e.state}"></span>
          ${e.url ? `<a class="bl-epic-title" href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(`${e.id} ${e.title}`)}">${esc(e.title)}</a>` : `<b class="bl-epic-title" title="${esc(e.title)}">${esc(e.title)}</b>`}
          <span class="badge" title="${e.kind === 'group' ? t('backlog.a_gitlab_group_epic') : t('backlog.the_epic_issue')}">${esc(e.id)}</span>
          <span class="spacer"></span>
          <span class="bl-tasks" title="${t('backlog.done_of_total_members_done_closed', { done: p.done, total: p.total })}"><span class="bl-bar"><span style="width:${pct}%"></span></span><span class="mono small">${p.done}/${p.total}</span></span>
        </div>
        <div class="small muted">${p.open} ${t('backlog.open_closed_closed_roadmapdone_done_in', { closed: p.closed, roadmapDone: p.roadmapDone })}${p.inRoadmap > p.roadmapDone ? t('backlog.value_planned', { value: p.inRoadmap - p.roadmapDone }) : ''}</div>
        ${e.members.length ? `<ul class="bl-epic-members">${e.members.map(member).join('')}</ul>` : `<p class="muted small">${t('backlog.no_members_yet')}</p>`}
        ${e.members.length ? `<button class="link-btn small" type="button" data-epic-filter="${esc(e.id)}">${t('backlog.show_its_issues_in_the_list')}</button>` : ''}
      </section>`;
    }).join('');
    const loose = issues.filter((i) => i.state === 'open' && matchesEpic(i, NO_EPIC));
    const none = `<section class="bl-epic-card bl-epic-none">
        <div class="bl-epic-head"><b class="bl-epic-title">${t('backlog.no_epic')}</b><span class="spacer"></span><span class="muted small">${t('backlog.open_issues_count', { count: loose.length })}</span></div>
        ${loose.length ? `<button class="link-btn small" type="button" data-epic-filter="${NO_EPIC}">${t('backlog.show_them_in_the_list')}</button>` : `<p class="muted small">${t('backlog.every_open_issue_is_in_an')}</p>`}
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
    btn.textContent = bl.labels.length ? t('backlog.labels_length', { length: bl.labels.length }) : t('backlog.labels');
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
      `<button class="bl-label on" type="button" data-label="${esc(name)}" title="${t('backlog.remove_from_the_label_filter')}"${colorStyle(color.get(name.toLowerCase()))}>${esc(name)} ×</button>`).join('')}
      <button class="link-btn small" type="button" data-label-clear title="${t('backlog.remove_every_label_from_the_filter')}">${t('backlog.clear')}</button>` : '';
  }
  const tasks = (i) => {
    if (!i.tasks?.total) return '';
    const pct = Math.round((i.tasks.done / i.tasks.total) * 100);
    return `<span class="bl-tasks" title="${t('backlog.done_of_total_tasks_done', { done: i.tasks.done, total: i.tasks.total })}"><span class="bl-bar"><span style="width:${pct}%"></span></span><span class="mono small">${i.tasks.done}/${i.tasks.total}</span></span>`;
  };
  // the run's readable status (#266), its title and its PR (#84: state icon, #n link opening the PR, not the run)
  const runLink = (r) => `<button class="bl-run" type="button" data-testid="run-chip" data-run="${esc(r.runId)}" data-workflow="${esc(r.workflow || '')}" title="${t('backlog.open_run_runid_value', { runId: esc(r.runId), value: esc(r.workflow || 'workflow') })}">
      ${StatusPill.statusPill(r.status, { waiting: r.waiting })}<span>${esc(window.runTitle ? runTitle(r) : r.workflow || 'workflow')}</span>${window.runPrBadge ? runPrBadge(r, { compact: true }) : ''}${r.mock ? `<span class="badge p-mock">${t('backlog.simulated')}</span>` : ''}</button>`;
  // Open PRs/MRs that refer to the issue, each a link to it.
  const prBadges = (i) => (i.pullRequests || []).map((p) =>
    `<a class="badge bl-pr${p.draft ? ' draft' : ''}" href="${esc(p.url)}" target="_blank" rel="noopener" title="${esc(t(p.draft ? 'backlog.open_draft_p_title' : 'backlog.open_p_title', { p: prName(p), title: p.title }))}">${esc(prName(p))}</a>`).join('');
  // The other issues of the same run (a group sent as one run: one branch, one PR/MR).
  const groupBadge = (others) => (others?.length
    ? `<span class="badge bl-group" title="${t('backlog.one_run_one_branch_and_one')}">${t('backlog.grouped_with')} ${esc(others.map((n) => `#${n}`).join(', '))}</span>` : '');
  const checkbox = (i) => (selectable(i) ? `<input type="checkbox" class="bl-check" data-sel="${i.number}" aria-label="${t('backlog.select_number', { number: i.number })}"${bl.selected.has(i.number) ? ' checked' : ''} />` : '');
  // What the automation is doing with the issue: its roadmap place, its latest run, the gate waiting for you.
  function status(i) {
    // its place in the roadmap ("Roadmap: stage 2", backlog-roadmap.js)
    const rm = window.BacklogRoadmap.badge(i);
    const e = enriching(i);
    const r = i.runs?.find((x) => !x.enrich);
    if (!r) return rm + e;
    const notPushed = i.column === 'local'
      ? `<span class="badge bl-notpushed" title="${t('backlog.merged_into_the_local_value_the', { value: esc(r.localMerge?.base || 'base') })}">${t('backlog.not_pushed')}</span>` : '';
    const recovered = r.recovery ? `<span class="badge bl-recovered" title="${esc(t('backlog.supervisor_recovery', { recovery: r.recovery }))}">${t('backlog.sent_back_after_a_failed_merge')}</span>` : '';
    const watch = r.status === 'running' && isRunLive(r.runId)
      ? `<button class="btn sm ghost sup-btn" type="button" data-watch="${esc(r.runId)}" data-workflow="${esc(r.workflow || '')}" title="${t('backlog.the_supervisor_follows_this_run_and')}"><span class="sup-mark">◆</span> ${t('backlog.watch')}</button>` : '';
    return `${rm}${runLink(r)}${notPushed}${recovered}${groupBadge(r.groupedWith)}${r.waiting ? `<button class="btn sm primary" type="button" data-gate>${t('backlog.review_approval')}</button>` : ''}${watch}${e}`;
  }
  // Its latest Write & Review run (#103): "being enriched" while it runs or waits, "enriched" once
  // accepted; a link to the run (the Write & Review chat, with Save to issue).
  function enriching(i) {
    const r = i.runs?.find((x) => x.enrich);
    if (!r || ['failed', 'cancelled', 'interrupted'].includes(r.status)) return '';
    const label = r.status === 'success' ? 'enriched' : 'being enriched';
    return `<button class="badge bl-enrich" type="button" data-run="${esc(r.runId)}" data-workflow="${esc(r.workflow || '')}" title="${esc(t('backlog.write_review_run_runid_value_open', { runId: r.runId, value: r.mock ? ' (simulated)' : '' }))}">${label}${r.mock ? t('backlog.simulated_2') : ''}</button>`;
  }

  // Updated by the last Backlog Refresh run (#161), for a day after it ended.
  const refreshedBadge = (i) => (i.refreshed
    ? `<span class="badge bl-refreshed" title="${esc(t('backlog.paths_lines_or_tasks_updated_by', { value: bl.data?.refresh?.lastRun?.runId || '' }))}">${t('backlog.refreshed')}</span>` : '');

  // The issue's actions (#238), right of a row / top right of a card: an open issue's ⋯ menu (#748: the shared
  // menu.js) has Enrich in Write & Review (#103: prefilled, nothing starts by itself), Show on map and Archive
  // (refused, its reason in its tooltip, while planned or running); an archived issue has Restore.
  function issueMenu(i) {
    if (isArchived(i)) return `<button class="btn sm ghost" type="button" data-restore="${i.number}" data-testid="backlog-restore" title="${t('backlog.reopen_it_on_the_platform_and')}">${t('backlog.restore')}</button>`;
    if (i.state !== 'open') return '';
    const [open, label, n] = [bl.menu === i.number, t('backlog.actions_for_number', { number: i.number }), i.number];
    return `<span class="bl-menu-wrap"><button class="btn sm ghost" type="button" data-menu="${n}" data-testid="backlog-issue-menu" aria-haspopup="menu" aria-expanded="${open}" aria-label="${label}" title="${esc(t('backlog.actions'))}">⋯</button>${open ? Menu.menuHtml([
      { id: 'enrich', label: t('backlog.enrich_in_documents'), title: t('backlog.enrich_this_issue_in_write_review'), testid: 'backlog-enrich', attrs: `data-enrich="${n}"` },
      { id: 'map', label: t('backlog.show_on_the_map'), title: t('backlog.open_the_project_city_with_the'), testid: 'show-on-map', attrs: `data-show-map="${n}"` }, { divider: true },
      { id: 'archive', label: t('backlog.archive'), title: t('backlog.close_it_as_not_planned_on'), disabledReason: archiveBlockReason(i), testid: 'backlog-archive', attrs: `data-archive="${n}"` },
    ], { className: 'bl-menu', label }) : ''}</span>`;
  }
  let issueMenuBinding = null; // #748: the open card menu's keys and outside click (Menu.bindMenu), bound after the render
  function bindIssueMenu() {
    issueMenuBinding?.close(); const el = bl.menu == null ? null : $b('#bl-list').querySelector('.bl-menu[role="menu"]');
    issueMenuBinding = el ? Menu.bindMenu(el, { anchor: el.previousElementSibling, onClose: () => { if (bl.menu != null) { bl.menu = null; render(); } } }) : null; el?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
  }

  // Filed from a discovery card (#258, the service's `discoveryCard`): the card's title; a click opens
  // the card on the Discovery board, read-only.
  const discoveryBadge = (i) => (i.discoveryCard
    ? `<button class="badge bl-discovery" type="button" data-testid="issue-discovery-card" data-discovery-card="${esc(i.discoveryCard.id)}" title="${esc(t('backlog.filed_from_the_discovery_card_title', { title: i.discoveryCard.title }))}">${t('backlog.card')} ${esc(i.discoveryCard.title)}</button>` : '');

  function issueRow(i) {
    const open = bl.expanded.has(i.number);
    const host = PLATFORMS[bl.data?.platform]?.label || 'the platform';
    const st = issueState(i);
    return `
      <div class="pr-run bl-issue${open ? ' open' : ''}${bl.selected.has(i.number) ? ' selected' : ''}" data-n="${i.number}" data-testid="backlog-issue">
        <div class="bl-row" data-act="toggle">
          <span class="bl-sel">${checkbox(i)}</span>
          <span class="bl-state ${st}" title="${st === 'open' ? t('backlog.open') : st === 'archived' ? t('backlog.archived') : t('backlog.closed')}"></span>
          <span class="bl-num mono">#${i.number}</span>
          <div class="bl-main">
            <div class="bl-title">${esc(i.title)}</div>
            <div class="bl-labels">${refreshedBadge(i)}${discoveryBadge(i)}${epicBadge(i)}${triage(i)}${labels(i)}</div>
          </div>
          <span class="bl-status">${prBadges(i)}${status(i)}</span>
          ${tasks(i) || '<span></span>'}
          <span class="pr-meta"><label>${t('backlog.updated')}</label>${esc(dateOf(i.updatedAt))}</span>
          <span class="bl-actions">${issueMenu(i)}</span>
        </div>
        ${open ? `
        <div class="pr-body">
          <div class="muted small">${t('backlog.opened_by_value_on', { value: esc(i.author || 'unknown') })} ${esc(dateOf(i.createdAt))}${i.assignees.length ? t('backlog.assigned_to_value', { value: esc(i.assignees.join(', ')) }) : ''}</div>
          ${i.pullRequests?.length ? `<div class="bl-prs"><span class="muted small">${t('backlog.open_short_s', { short: platformOf(bl.data?.platform).request.short })}</span>${i.pullRequests.map((p) => `<span class="small">${prBadges({ pullRequests: [p] })} ${esc(p.title)}</span>`).join('')}</div>` : ''}
          ${i.runs?.length ? `<div class="bl-runs"><span class="muted small">${t('backlog.runs')}</span>${i.runs.map(runLink).join('')}</div>` : ''}
          <div class="md bl-md">${i.body.trim() ? markdownHtml(i.body) : `<p class="muted">${t('backlog.no_description')}</p>`}</div>
          <div class="row"><a class="btn sm ghost" href="${esc(i.url)}" target="_blank" rel="noopener">${t('backlog.open_on')} ${esc(host)}</a></div>
        </div>` : ''}
      </div>`;
  }

  const card = (i) => `
    <div class="bl-card${bl.selected.has(i.number) ? ' selected' : ''}" data-n="${i.number}">
      <div class="bl-card-head">${checkbox(i)}<span class="bl-num mono">#${i.number}</span><a class="bl-card-title" href="${esc(i.url)}" target="_blank" rel="noopener" title="${t('backlog.open_on_value', { value: esc(PLATFORMS[bl.data?.platform]?.label || 'the platform') })}">${esc(i.title)}</a>${issueMenu(i)}</div>
      <div class="bl-labels">${refreshedBadge(i)}${discoveryBadge(i)}${epicBadge(i)}${triage(i)}${labels(i)}</div>
      ${tasks(i)}<button type="button" class="btn sm ghost bl-card-map" data-show-map="${i.number}" data-testid="show-on-map" title="${t('backlog.open_the_project_city_with_the_2')}">${t('backlog.show_on_the_map')}</button>
      ${prBadges(i) || status(i) ? `<div class="bl-card-run">${prBadges(i)}${status(i)}</div>` : ''}
    </div>`;

  function renderList(issues) {
    const shown = sortIssues(issues.filter(isShown), bl.sort);
    return shown.length ? shown.map(issueRow).join('') : filtering() ? noMatch() : `<p class="muted">${t('backlog.no_issues_match')}</p>`;
  }

  function renderKanban(issues) {
    const shown = sortIssues(issues.filter(isShown), bl.sort);
    const withLocal = bl.data?.local?.ahead > 0 || issues.some((i) => i.column === 'local');
    const columns = COLUMNS.filter((col) => col !== 'local' || withLocal);
    return `${!shown.length && issues.length && filtering() ? noMatch() : ''}<div class="bl-board${withLocal ? ' with-local' : ''}" data-testid="backlog-board">${columns.map((col) => {
      const items = shown.filter((i) => (i.column || (i.state === 'closed' ? 'done' : 'todo')) === col);
      return `<section class="bl-col bl-col-${col}">
        <h3>${t(`backlog.column_${col}`)} <span class="muted">${items.length}</span></h3>
        <div class="bl-col-body">${items.map(card).join('') || `<p class="muted small">${t('backlog.nothing_here')}</p>`}</div>
      </section>`;
    }).join('')}</div>`;
  }


  // Archive (#238): closes the issues as not planned on the platform and labels them archived, after a
  // confirm naming them. Issues that cannot be archived (archiveBlockReason) are left out of it; a
  // refusal or a failure is reported per issue and the others still go through. True when it was sent.
  async function archive(numbers) {
    const issues = (bl.data?.issues || []).filter((i) => numbers.includes(i.number));
    const blocked = issues.filter((i) => archiveBlockReason(i)).map((i) => `#${i.number}: ${archiveBlockReason(i)}`);
    const ok = issues.filter((i) => !archiveBlockReason(i)).map((i) => i.number);
    if (!ok.length) { bl.error = blocked.length ? t('backlog.not_archived', { reasons: blocked.join(' · ') }) : null; render(); return false; }
    if (!await confirmDialog(t('backlog.archive_issues_title', { count: ok.length }), archiveConfirmText(ok, bl.data?.platform || bl.platform), t('backlog.archive'))) return false;
    try {
      const out = await api.archiveIssues(bl.projectId, ok);
      if (out.backlog) setData(out.backlog);
      const failed = out.results.filter((r) => !r.ok).map((r) => `#${r.number}: ${r.error}`);
      bl.error = failed.length || blocked.length ? t('backlog.not_archived', { reasons: [...blocked, ...failed].join(' · ') }) : null;
    } catch (err) { bl.error = errMsg(err); }
    render();
    return true;
  }

  // Restore (#238): reopens an archived issue and removes its label, after a confirm.
  async function restore(number) {
    const host = PLATFORMS[bl.data?.platform]?.label || 'the platform';
    if (!await confirmDialog(t('backlog.restore_issue'), t('backlog.reopen_number_on_host_and_remove', { number, host }), t('backlog.restore'))) return;
    try {
      const out = await api.restoreIssues(bl.projectId, [number]);
      if (out.backlog) setData(out.backlog);
      const failed = out.results.filter((r) => !r.ok).map((r) => `#${r.number}: ${r.error}`);
      bl.error = failed.length ? t('backlog.not_restored', { reasons: failed.join(' · ') }) : null;
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
      title: t('backlog.deprioritized_still_carry', { count: list.length, issues: list.map((i) => `#${i.number}`).join(', ') }),
      text: t('backlog.archive_replaces_deprioritized'),
      dismissible: false,
      actions: [
        {
          label: t('backlog.archive_length', { length: list.length }),
          primary: true,
          title: list.map((i) => `#${i.number} ${i.title}`).join('\n'),
          attrs: { 'data-testid': 'backlog-deprioritized-archive' },
          onClick: async () => { if (await archive(list.map((i) => i.number))) { save(deprioritizedKey(), '1'); render(); } },
        },
        // its click is handled on the alerts box (bind), where the dismissal is remembered
        { label: t('common.dismiss'), attrs: { 'data-deprioritized-dismiss': '', 'data-testid': 'backlog-deprioritized-dismiss' } },
      ],
    }];
  }

  // The Backlog Refresh alert (#161, packages/engine/domains/backlog/backlog-refresh.js; a warning, #270): on every view when the
  // last refresh is older than Settings › General › Backlog's interval and the base got merges since
  // (or none ever ran); "Refreshing…" (an info) with a link while a refresh run is live. Never starts
  // a run by itself. "Dismiss for today" is remembered by the service; × hides it until it is due again.
  const ago = (h) => (h >= 48 ? t('backlog.days_ago', { days: Math.floor(h / 24) }) : t('backlog.hours_ago', { hours: h }));
  function refreshAlert() {
    const r = bl.data?.refresh;
    if (!project()?.repo || !r || !(r.running || r.due)) return [];
    if (r.running) {
      return [{
        id: `refreshing:${bl.projectId}`,
        level: 'info',
        title: t('backlog.refreshing_the_backlog'),
        text: t('backlog.a_backlog_refresh_run_is_in_progress'),
        dismissible: true,
        actions: [{ label: t('backlog.open_the_run'), onClick: () => openRun({ dataset: { run: r.running.runId, workflow: r.running.workflow || '' } }) }],
      }];
    }
    const when = r.lastRun ? t('backlog.backlog_refreshed_ago', { ago: ago(r.hoursAgo), merges: r.merges != null ? t('backlog.merges_since', { count: r.merges }) : '' }) : t('backlog.backlog_never_refreshed');
    return [{
      id: `refresh:${bl.projectId}`,
      level: 'warning',
      title: when,
      text: `${t('backlog.issues_may_cite_moved_files')}${r.lastRun ? t('backlog.last_backlog_refresh_run', { runId: r.lastRun.runId, date: dateOf(r.lastRun.startedAt) }) : ''}`,
      dismissible: true,
      actions: [
        { label: t('backlog.refresh_now'), primary: true, title: t('backlog.opens_the_start_panel_for_the'), attrs: { 'data-refresh-now': '' }, onClick: refreshNow },
        {
          label: t('backlog.dismiss_for_today'),
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
    const inputs = { git_platform: platformOf(bl.platform).short };
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
  // The project's local <base> has commits origin/<base> has not: what they close and Push (an info
  // alert, #270; the auto-push left with #630, Local mode's push is the workflow's push_main step); a
  // push status that could not be read is a warning with "Check again".
  const issueRefs = (numbers) => numbers.map((n) => `#${n}`).join(', ');
  function localAlert() {
    const l = bl.data?.local;
    if (!l) return [];
    if (l.ahead > 0) {
      const commits = t('backlog.commits_on_the_local_base', { count: l.ahead, base: l.base });
      return [{
        id: `push:${bl.projectId}`,
        level: 'info',
        title: t('backlog.not_pushed_2'),
        text: [
          `${commits}${l.issues?.length ? t('backlog.closes_issues_when_pushed', { issues: issueRefs(l.issues) }) : ''}`,
          l.behind > 0 ? t('backlog.origin_has_new_commits_push_updates_first', { count: l.behind, base: l.base }) : '',
          l.fetchError ? t('backlog.origin_not_reached_last_known_state') : '',
        ].filter(Boolean).join(' · '),
        dismissible: true,
        actions: [
          { label: t('backlog.push_2'), primary: true, attrs: { 'data-push': '' }, onClick: openPush },
        ],
      }];
    }
    if (!l.error || !(bl.data?.issues || []).some((i) => i.column === 'local')) return [];
    return [{
      id: `push-unknown:${bl.projectId}`,
      level: 'warning',
      title: t('backlog.push_status_unknown'),
      text: l.error,
      dismissible: true,
      actions: [{
        label: t('backlog.check_again'),
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
  // On top of the Board, the Epics view and the Roadmap, above the filter row, one at a time: a roadmap paused by
  // an item (an error; the plain queue's alert left with the queue, #446), a stale Backlog Refresh and the retired
  // deprioritized label (warnings), local merges not pushed (an info). Set on every render: it leaves when its cause clears.
  let pageAlerts = null;
  function renderAlerts() {
    pageAlerts ||= window.Alerts.mount($b('#bl-alerts'));
    pageAlerts.set([
      ...(window.BacklogRoadmap?.alerts(bl.data, roadmapCtx(), { shown: onRoadmapTab() }) || []),
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
    $b('#push-title').textContent = t('backlog.push_commits_to_origin', { count: l.ahead, base: l.base });
    $b('#push-message').textContent = `${t('backlog.push_message', { base: l.base, repo: l.repo || p?.folder || t('backlog.the_project_s_repository') })}${l.issues?.length ? t('backlog.platform_closes_issues', { issues: issueRefs(l.issues) }) : ''}`;
    $b('#push-commits').innerHTML = (l.commits || []).map((c) => `<li><span class="mono">${esc(c.sha.slice(0, 8))}</span> ${esc(c.subject)}${c.issues.length ? ` <span class="muted">${t('backlog.closes_issues', { issues: esc(issueRefs(c.issues)) })}</span>` : ''}</li>`).join('');
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
    $b('#push-error').textContent = update ? t('backlog.updating_from_origin_then_pushing') : t('backlog.pushing');
    try {
      const r = update ? await api.updateAndPushLocal(bl.projectId) : await api.pushLocal(bl.projectId);
      if (r.backlog) setData(r.backlog);
      else if (bl.data) bl.data.local = r.local;
      window.refreshUnpushed?.();
      if (r.pushed || (!r.rejected && !r.conflict && !r.local?.ahead)) { closeModal('#push-modal'); render(); return; }
      if (r.conflict) {
        // handed to a run of the local workflow (its developer resolves it, as in resolve_merge)
        $b('#push-error').textContent = t('backlog.error_resolve_in_a_run_starts', { error: r.error, value: bl.data?.local?.base || '', value2: r.files.join(', ') });
        bl.conflictFiles = r.files;
        $b('#btn-push-update').classList.add('hidden');
        $b('#btn-push-ok').classList.add('hidden');
        $b('#btn-push-resolve').classList.remove('hidden');
        $b('#push-resolve-mock-wrap').classList.toggle('hidden', !devMode());
      } else if (r.rejected) {
        $b('#push-error').textContent = t('backlog.the_push_was_rejected_origin_moved', { value: r.error || '' });
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
    $b('#bl-title').textContent = roadmap ? t('backlog.roadmap') : t('backlog.backlog');
    $b('#bl-hint').textContent = roadmap
      ? t('backlog.ordered_stages_of_runs_each_stage')
      : t('backlog.a_project_s_issues_synced_from');
    $b('#bl-tabs').classList.toggle('hidden', roadmap);
    // #269: the Roadmap draws its own filter row (the epic with its view filters), above its bar
    $b('#bl-toolbar').classList.toggle('hidden', roadmap);
    const plat = $b('#bl-platform');
    plat.innerHTML = Object.entries(PLATFORMS).map(([id, p]) => `<option value="${id}">${esc(p.label)}${p.soon ? ' (soon)' : ''}</option>`).join('');
    plat.value = bl.platform || DEFAULT_PLATFORM;
    // #745: a known platform as a badge; the select only for a host the URL can't tell (saved on the project)
    const known = knownPlatform(), badge = $b('#bl-platform-badge');
    plat.classList.toggle('hidden', !!known);
    badge.classList.toggle('hidden', !known);
    Object.assign(badge, { textContent: known ? PLATFORMS[known]?.label || known : '', title: known ? t('backlog.platform_of_the_project') : '' });

    const p = project();
    const btn = $b('#btn-bl-sync');
    btn.disabled = !p?.repo || bl.syncing || !!PLATFORMS[bl.platform]?.soon;
    btn.textContent = bl.syncing ? t('backlog.syncing') : t('backlog.sync');
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
    $b('#bl-count').textContent = tab === 'board' && bl.data ? t('backlog.issues_count', { count: shownCount }) : '';
    const n = shownSelected().length;
    $b('#btn-bl-assign').classList.toggle('hidden', !n);
    $b('#btn-bl-assign').textContent = t('backlog.assign_workflow_n', { n });
    // #169: busy while the Product Owner answers (backlog-po.js renderButton keeps it in step)
    $b('#btn-bl-send-po').classList.toggle('hidden', !n);
    $b('#btn-bl-send-po').dataset.n = String(n);
    $b('#btn-bl-send-po').textContent = t('backlog.send_to_product_owner_n', { n });
    window.BacklogPO?.syncSendButton();
    // #238: disabled (with the reasons) when no selected issue can be archived
    $b('#btn-bl-archive').classList.toggle('hidden', !n);
    $b('#btn-bl-archive').textContent = t('backlog.archive_n', { n });
    const blocked = (bl.data?.issues || []).filter((i) => shownSelected().includes(i.number) && archiveBlockReason(i));
    $b('#btn-bl-archive').disabled = !!n && blocked.length === n;
    $b('#btn-bl-archive').title = blocked.length
      ? blocked.map((i) => `#${i.number}: ${archiveBlockReason(i)}`).join('\n')
      : t('backlog.close_the_selected_issues_as_not');
    $b('#btn-bl-clear').classList.toggle('hidden', !n);

    const issues = bl.data?.issues || [];
    // #253: the Board's counts and filters leave the epics out, like its list and kanban (matches)
    const board = issues.filter((i) => !i.isEpic);
    const count = (f) => board.filter((i) => f === 'all' || issueState(i) === f).length;
    const filters = $b('#bl-filters');
    filters.classList.toggle('hidden', bl.mode !== 'list');
    filters.innerHTML = FILTERS.map((f) =>
      `<button class="chip${bl.filter === f ? ' active' : ''}" data-f="${f}" data-testid="backlog-state-${f}">${t(`backlog.filter_${f}`)} <span class="muted">${count(f)}</span></button>`).join('');
    renderLabelFilter(board);
    renderEpicFilter(board);
    // (after renderLabelFilter, which shows the labels button whenever there are labels)
    for (const id of ['#bl-search', '#bl-label-active']) $b(id).classList.toggle('hidden', tab === 'roadmap');
    if (tab === 'roadmap') $b('#bl-labels-wrap').classList.add('hidden');
    $b('#bl-synced').textContent = bl.syncing ? t('backlog.syncing') : bl.data ? t('backlog.synced_syncedat_from_value', { syncedAt: dateOf(bl.data.syncedAt), value: PLATFORMS[bl.data.platform]?.label || bl.data.platform }) : '';
    const prError = bl.data?.pullRequestsError ? `Open ${platformOf(bl.data.platform).request.short}s could not be read: ${bl.data.pullRequestsError}` : '';
    $b('#bl-error').textContent = bl.error || prError;
    // (#269: an empty error line takes no room between the alerts, the filter row and the list)
    $b('#bl-error').classList.toggle('hidden', !(bl.error || prError));
    renderAlerts();
    renderLive();

    const list = $b('#bl-list');
    if (!bl.projects.length) {
      list.innerHTML = `<div class="empty-state"><b>${t('backlog.no_projects_yet')}</b><p class="muted">${t('backlog.create_a_project_with_a_repository')}</p></div>`;
    } else if (!p?.repo) {
      list.innerHTML = `<div class="empty-state"><b>${t('backlog.this_project_has_no_repository')}</b><p class="muted">${t('backlog.add_a_repository_url_to_the')}</p></div>`;
    } else if (PLATFORMS[bl.platform]?.soon) {
      list.innerHTML = `<div class="empty-state"><b>${esc(PLATFORMS[bl.platform].label)} ${t('backlog.sync_is_not_available_yet')}</b><p class="muted">${t('backlog.pick_github_or_gitlab')}</p></div>`;
    } else if (!bl.data) {
      list.innerHTML = bl.syncing ? `<p class="muted">${t('backlog.loading_issues')}</p>` : `<p class="muted">${t('backlog.not_synced_yet')}</p>`;
    } else {
      // (#491: the Roadmap keeps its item rows when only their content changed)
      if (bl.mode === 'roadmap') window.BacklogRoadmap.patch(list, window.BacklogRoadmap.html(bl.data, render, { epic: bl.epic, epicOptions: epicChoices(board), showAll: bl.showAll, since: bl.since, release: bl.release, project: bl.projectId, synced: $b('#bl-synced').textContent }));
      else { list.innerHTML = bl.mode === 'epics' ? renderEpics(issues) : bl.mode === 'kanban' ? renderKanban(board) : renderList(board); bindIssueMenu(); } // #748: an open card menu, redrawn, bound again
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
  const PO_DRAWER = () => `
    <div id="po-backdrop" class="drawer-backdrop sup-backdrop hidden"></div>
    <aside id="po-drawer" class="drawer sup-drawer po-drawer" aria-hidden="true" aria-label="${t('backlog.product_owner')}" data-testid="po-drawer">
      <div class="drawer-head">
        <div class="po-head">
          <span id="po-avatar" class="po-avatar" aria-hidden="true"></span>
          <div class="sup-head">
            <h2 class="drawer-title">${t('backlog.product_owner')}</h2>
            <div id="po-for" class="po-for small" data-testid="po-for"></div>
            <div id="po-sub" class="muted small"></div>
          </div>
        </div>
        <div class="row">
          <select id="po-calib-chip" class="po-calib-chip" aria-label="${t('backlog.calibration_of_the_next_answer')}"></select>
          <select id="po-cost-chip" class="po-calib-chip" aria-label="${t('backlog.cost_of_the_next_answer')}"></select>
          <button id="btn-po-settings" class="icon-btn" type="button" title="${t('backlog.calibrate_the_product_owner')}" aria-label="${t('backlog.calibrate_the_product_owner')}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3M11 7h9M4 17h9M17 17h3" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></svg>
          </button>
          <button id="btn-po-clear" class="btn sm ghost" type="button" title="${t('backlog.forget_this_project_s_conversation')}">${t('backlog.clear_2')}</button>
          <button class="icon-btn" type="button" data-agents-window="product-owner" data-testid="agent-chat-open-window" title="${t('backlog.open_in_a_window_ctrl_shift')}" aria-label="${t('backlog.open_the_product_owner_in_a')}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="14" height="14" rx="2" /><path d="M9 3h12v12M21 3l-9 9" /></svg></button>
          <button id="btn-po-close" class="icon-btn" title="${t('backlog.close_esc')}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
          </button>
        </div>
      </div>
      <!-- #274: the conversation and its text box, driven by the agents' shared chat (agent-chat.js marks them) -->
      <div id="po-chat" class="agent-chat-flat">
      <div id="po-log" class="drawer-body po-log"></div>
      <div class="drawer-foot po-foot">
        <div id="po-sim" class="po-sim hidden" role="group" aria-label="${t('backlog.simulated_scenario')}" title="${t('backlog.simulation_only_not_part_of_the')}">
          <span class="po-sim-label">${t('backlog.simulated_scenario')}</span><span id="po-scenario" class="po-sim-opts"></span>
        </div>
        <button id="btn-po-plan" class="link-btn small hidden" type="button" data-testid="po-back-to-plan">${t('backlog.back_to_planning')}</button>
        <div id="po-chips" class="chips po-chips"></div>
        <div id="po-files" class="po-files hidden"></div>
        <div id="po-attached" class="po-files po-attached hidden" aria-label="${t('backlog.attached_issues')}"></div>
        <!-- #234: the turn in flight, where the click happened; a click with no project says why nothing was sent -->
        <div id="po-working" class="po-working small hidden" data-testid="po-working" role="status" aria-live="polite"></div>
        <p id="po-notice" class="error small hidden" data-testid="po-notice" role="alert"></p>
        <div class="row po-ask">
          <textarea id="po-question" rows="2" placeholder="${t('backlog.ask_about_the_backlog_which_issues')}" aria-label="${t('backlog.message_to_product_owner')}"></textarea>
          <button id="btn-po-attach" class="icon-btn hidden" type="button" title="${t('backlog.attach_screenshots_or_files_you_can')}" aria-label="${t('backlog.attach_files')}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5" /></svg>
          </button>
          <button id="btn-po-ask" class="btn primary" type="button">${t('backlog.ask')}</button>
          <input id="po-file-input" type="file" multiple hidden />
        </div>
        <p id="po-note" class="muted small"></p>
      </div>
      </div>
      ${window.BacklogPoSettingsPanel.html()}
    </aside>
`;

  // ---- events --------------------------------------------------------------------------------
  function mount() {
    (window.ViewRegistry?.draw || ((box, html) => box.insertAdjacentHTML('beforeend', html())))($b('.shell'), PO_DRAWER);
    // the sidebar entry's count of commits merged locally and not pushed (app.js refreshUnpushed)
    $b('nav.sidebar [data-view="backlog"]').insertAdjacentHTML('beforeend', '<span id="nav-backlog-unpushed" class="nav-badge warn hidden"></span>');
    $b('#bl-platform').onchange = (e) => {
      bl.platform = e.target.value;
      const p = project(); // #745: saved on the project (its host doesn't tell the platform): the Backlog never asks again
      if (p && !PLATFORMS[bl.platform]?.soon) { p.platform = bl.platform; Promise.resolve(api.updateProject?.(p.id, { platform: bl.platform })).catch((err) => { bl.error = errMsg(err); render(); }); }
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
      const enrich = e.target.closest('[data-enrich]'), onMap = e.target.closest('[data-show-map]'); // #375: the issue's impact preview on its project's city
      if (onMap) { bl.menu = null; window.ProjectCityImpact?.showIssue(bl.projectId, issueOf(Number(onMap.dataset.showMap))); return; } if (enrich) { bl.menu = null; render(); enrichIssue(Number(enrich.dataset.enrich)); return; }
      // #238: an issue's actions menu, its Archive, and Restore
      const menu = e.target.closest('[data-menu]'), arch = e.target.closest('[data-archive]'), back = e.target.closest('[data-restore]');
      if (menu) { bl.menu = bl.menu === Number(menu.dataset.menu) ? null : Number(menu.dataset.menu); render(); return; }
      if (arch) { if (arch.getAttribute('aria-disabled') === 'true') return; bl.menu = null; render(); await archive([Number(arch.dataset.archive)]); return; }
      if (back) { await restore(Number(back.dataset.restore)); return; }
      if (e.target.closest('.bl-menu, a')) return;
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
    $b('#btn-assign-cancel').onclick = () => closeModal('#assign-modal');
  }

  registerView({
    id: 'backlog',
    nav: { label: 'Backlog', order: 40, group: 'build', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 6 1.5 1.5L8 5" /><path d="m4 12 1.5 1.5L8 11" /><path d="m4 18 1.5 1.5L8 17" /><path d="M11 6h9M11 12h9M11 18h9" /></svg>' },
    markup: () => `
      <section id="view-backlog" class="view hidden">
        <div class="page-head">
          <div>
            <h1 id="bl-title">${t('backlog.backlog')}</h1>
            <p class="muted small"><span id="bl-hint">${t('backlog.a_project_s_issues_synced_from')}</span> ${t('backlog.the_last_sync_is_kept_in')} <span id="backlog-dir" class="mono"></span></p>
          </div>
          <div class="row">
            <span id="bl-platform-badge" class="badge hidden" data-testid="backlog-platform"></span>
            <select id="bl-platform" aria-label="${t('backlog.platform')}" data-testid="backlog-platform-select"></select>
            <button id="btn-bl-sync" class="btn primary nowrap">${t('backlog.sync')}</button>
            <button id="btn-bl-new-issue" class="btn ghost nowrap" type="button" title="${t('backlog.describe_a_problem_or_an_idea')}">${t('backlog.new_issue')}</button>
          </div>
        </div>
        <div id="bl-tabs" class="tabs page-tabs" role="tablist" aria-label="${t('backlog.backlog')}">
          <button type="button" class="tab" role="tab" data-bl-tab="board" title="${t('backlog.the_issues_as_a_list_or')}">${t('backlog.board')}</button>
          <button type="button" class="tab" role="tab" data-bl-tab="epics" data-mode="epics" title="${t('backlog.the_epics_themes_of_issues_with')}">${t('backlog.epics')}</button>
        </div>
        <div id="bl-alerts" class="hidden"></div>
        <div class="pr-toolbar" id="bl-toolbar" data-testid="filter-row">
          <span id="bl-mode" class="seg sm" role="group" aria-label="${t('backlog.board_view')}">
            <button type="button" data-mode="list">${t('backlog.list')}</button>
            <button type="button" data-mode="kanban">${t('backlog.kanban')}</button>
          </span>
          <span id="bl-count" class="small muted" data-testid="backlog-count"></span>
          <div id="bl-filters" class="chips"></div>
          <input type="text" id="bl-search" placeholder="${t('backlog.search_issues_labels')}" aria-label="${t('backlog.search')}" />
          <div id="bl-labels-wrap" class="bl-labels-wrap">
            <button id="btn-bl-labels" class="btn sm ghost" type="button" aria-haspopup="true" title="${t('backlog.filter_by_labels_labels_of_different')}">${t('backlog.labels')}</button>
            <div id="bl-labels-pop" class="bl-labels-pop hidden" role="menu" aria-label="${t('backlog.labels')}"></div>
          </div>
          <span id="bl-label-active" class="bl-label-active"></span>
          <select id="bl-epic" class="hidden" aria-label="${t('backlog.epic')}" title="${t('backlog.show_the_issues_of_one_epic')}"></select>
          <select id="bl-sort" aria-label="${t('backlog.sort')}" title="${t('backlog.sort_by_the_triage_labels_impact')}">
            <option value="updated">${t('backlog.recently_updated')}</option>
            <option value="impact">${t('backlog.impact_highest_first')}</option>
            <option value="complexity">${t('backlog.complexity_smallest_first')}</option>
          </select>
          <button id="btn-bl-assign" class="btn sm primary hidden" type="button">${t('backlog.assign_workflow')}</button>
          <button id="btn-bl-send-po" class="btn sm ghost hidden" type="button" title="${t('backlog.ask_the_product_owner_about_the')}">${t('backlog.send_to_product_owner')}</button>
          <button id="btn-bl-archive" class="btn sm ghost hidden" type="button" data-testid="backlog-archive-selection">${t('backlog.archive')}</button>
          <button id="btn-bl-clear" class="btn sm ghost hidden" type="button">${t('backlog.clear_selection')}</button>
          <span class="spacer"></span>
          <span id="bl-synced" class="muted small"></span>
        </div>
        <div id="bl-live" class="bl-live hidden" role="status"></div>
        <p id="bl-error" class="error small"></p>
        <div id="bl-list" class="pr-list" data-testid="backlog-list"></div>
        <button id="btn-bl-po" class="po-fab" type="button" title="${t('backlog.ask_the_product_owner_which_issues')}" aria-label="${t('backlog.product_owner')}"></button>
      </section>`,
    modals: () => `
  <div id="push-modal" class="modal hidden">
    <div class="modal-card">
      <h3 id="push-title">${t('backlog.push_the_local_merges')}</h3>
      <p id="push-message" class="muted small"></p>
      <ul id="push-commits" class="bl-push-commits small"></ul>
      <p id="push-error" class="error small"></p>
      <div class="modal-actions">
        <label id="push-resolve-mock-wrap" class="check small hidden" title="${t('backlog.developer_mode_the_run_is_simulated')}"><input type="checkbox" id="push-resolve-mock" /><span>${t('backlog.simulate')}</span></label>
        <button type="button" id="btn-push-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="button" id="btn-push-resolve" class="btn primary hidden" title="${t('backlog.start_a_run_of_the_local')}">${t('backlog.resolve_in_a_run')}</button>
        <button type="button" id="btn-push-update" class="btn hidden">${t('backlog.update_and_push')}</button>
        <button type="button" id="btn-push-ok" class="btn primary">${t('backlog.push')}</button>
      </div>
    </div>
  </div>
  <div id="cut-line-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="cut-line-title" data-testid="cut-line-modal">
    <form id="cut-line-form" class="modal-card">
      <h3 id="cut-line-title">${t('backlog.release_here')}</h3>
      <p class="muted small">${t('backlog.a_cut_line_after_this_stage')}</p><div id="cut-line-recent"></div>
      <div class="field">
        <label for="cut-line-name">${t('backlog.release_name')}</label>
        <div class="rel-version-row"><input type="text" id="cut-line-name" placeholder="e.g. v1.4" autocomplete="off" /><span id="cut-line-suggest"></span></div>
        <div class="hint">${t('backlog.a_name_or_a_version_ship')}</div><div id="cut-line-why"></div>
      </div>
      <p id="cut-line-error" class="error small" role="alert" data-testid="cut-line-error"></p>
      <div class="modal-actions">
        <button type="button" id="btn-cut-line-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="submit" id="btn-cut-line-ok" class="btn primary">${t('backlog.add_cut_line')}</button>
      </div>
    </form>
  </div>
  <div id="rm-versions-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="rm-versions-title">
    <div class="modal-card">
      <h3 id="rm-versions-title">${t('backlog.restore_an_earlier_version')}</h3>
      <p class="muted small">${t('backlog.the_roadmap_as_it_was_before')}</p>
      <ul id="rm-versions" class="rm-versions" data-testid="roadmap-versions"></ul>
      <p id="rm-versions-error" class="error small" role="alert"></p>
      <div class="modal-actions">
        <button type="button" id="btn-rm-versions-close" class="btn ghost">${t('common.close')}</button>
      </div>
    </div>
  </div>
  <div id="assign-modal" class="modal hidden" data-testid="assign-modal">
    <form id="assign-form" class="modal-card">
      <h3 id="assign-title">${t('backlog.assign_a_workflow')}</h3>
      <div class="assign-body">
        <ul id="assign-issues" class="assign-issues" aria-label="${t('backlog.issues')}"></ul>
        <div id="assign-busy" class="bl-busy hidden"></div>
        <fieldset id="assign-grouping" class="bl-grouping hidden">
          <legend class="small">${t('backlog.send_them_as')}</legend>
          <label class="check"><input type="radio" name="assign-group" value="separate" checked /><span>${t('backlog.separate_runs_one_per_issue_one')}</span></label>
          <label class="check"><input type="radio" name="assign-group" value="group" /><span>${t('backlog.one_run_for_all_one_branch')}</span></label>
        </fieldset>
        <div class="field">
          <label for="assign-workflow">${t('backlog.workflow')}</label>
          <select id="assign-workflow"></select>
          <div id="assign-wf-desc" class="hint"></div>
          <details id="assign-wf-about" class="assign-about"><summary>${t('backlog.about_this_workflow')}</summary><p id="assign-wf-about-text"></p></details>
          <div id="assign-proposed" class="small hidden"></div>
        </div>
        <fieldset id="assign-settings" class="assign-settings">
          <legend>${t('backlog.settings')}</legend>
          <div id="assign-inputs" class="wi-grid" data-wi-scope></div>
        </fieldset>
        <details id="assign-agents" class="adv hidden"><summary>${t('backlog.agents')}</summary><div id="assign-agents-list"></div></details>
        <div id="assign-chain"></div>
        <div id="assign-pipeline" class="drawer-pipeline hidden"></div>
        <label class="check" title="${t('backlog.run_now_hint')}"><input type="checkbox" id="assign-run-now" data-testid="assign-run-now" /><span>${t('backlog.run_now')}</span></label>
        <label class="check dev-only"><input type="checkbox" id="assign-mock" /><span>${t('backlog.simulation_no_cli_is_called_nothing')}</span></label>
      </div>
      <div class="assign-foot">
        <p id="assign-note" class="small"></p>
        <p id="assign-error" class="error small"></p>
        <div class="modal-actions">
          <button type="button" id="btn-assign-cancel" class="btn ghost">${t('common.cancel')}</button>
          <button type="submit" id="btn-assign-ok" class="btn primary" data-testid="assign-add-to-roadmap">${t('backlog.add_to_roadmap')}</button>
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
    nav: { label: 'Roadmap', order: 45, group: 'build', title: 'Ordered stages of runs: each stage starts when the previous one has finished and merged', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4" /><path d="M5 4h12l-2.5 4 2.5 4H5" /></svg>' },
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
