// Backlog screen: a project's issues synced from its git platform (src/backlog.js), as a list or a
// kanban (To do / In progress / Waiting for approval / Done). Shows the last sync right away and
// syncs again in the background each time the screen opens. The platform defaults to
// Settings › General › Backlog and can be switched here.
// Selected To do issues can be assigned to a workflow: they are queued and the service runs them
// one at a time (the run records its issues), as separate runs or, when asked, as one run for all
// of them (one branch, one PR/MR). Issues link to the runs working on them.
// Work a local workflow merged into the local base but did not push shows in "Merged locally"; the
// bar above the list pushes it (and updates from origin first when origin moved); a conflict on
// the update goes to a run of the local workflow, whose developer resolves it.
// The list narrows by state, by text and by labels (the rule is in backlog-labels.js: AND across
// label groups, OR within one); the selected labels are remembered per project and a label chip
// on an issue toggles its label. Selection and assignment only count the issues shown.
// Issues filed by the issue tracker (#81) carry `impact:<1-5>` / `complexity:<1-5>` labels: shown as
// badges, sortable (backlog-labels.js sortIssues), filterable like any label. New issue opens the
// Start drawer on the issue-tracker workflow for the selected project and platform.
// The third mode, Roadmap, is backlog-roadmap.js (ordered stages of runs); the assign dialog's
// "Add to roadmap" plans the selection as a new stage, and assigning an issue the roadmap plans asks first.
// The Product Owner's drawer (backlog-po.js) applies a proposed group through window.BacklogActions.
// Uses app.js globals ($, esc, state, errMsg, dateOf, markdownHtml, showView, openModal,
// closeModal, devMode, wantsSimulation, openGateOf, openNextGate, selectRun, confirmDialog).
/* global api */
(() => {
  // Must match PLATFORMS in src/backlog.js (soon = no sync yet).
  const PLATFORMS = { github: { label: 'GitHub' }, gitlab: { label: 'GitLab' }, bitbucket: { label: 'Bitbucket', soon: true } };
  window.BACKLOG_PLATFORMS = PLATFORMS;
  const PROJECT_KEY = 'multiagent.backlogProject';
  const MODE_KEY = 'multiagent.backlogMode';
  const WORKFLOW_KEY = 'multiagent.backlogWorkflow';
  const LABELS_KEY = 'multiagent.backlogLabels.'; // + project id
  const SORT_KEY = 'multiagent.backlogSort';
  const SORTS = ['complexity', 'impact', 'updated'];
  const ISSUE_TRACKER = 'issue-tracker.yaml';
  const FILTERS = [['open', 'Open'], ['closed', 'Closed'], ['all', 'All']];
  // 'local': merged into the local base by a local workflow, not pushed yet (shown when there is any)
  const COLUMNS = [['todo', 'To do'], ['in_progress', 'In progress'], ['waiting', 'Waiting for approval'], ['local', 'Merged locally'], ['done', 'Done']];

  const load = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const save = (key, v) => { try { localStorage.setItem(key, v); } catch { /* storage unavailable */ } };

  const bl = {
    projects: [], projectId: null, platform: null, data: null, error: null, syncing: false,
    mode: ['kanban', 'roadmap'].includes(load(MODE_KEY)) ? load(MODE_KEY) : 'list', filter: 'open', q: '', expanded: new Set(), seq: 0,
    selected: new Set(), workflows: [], labels: [], labelsOpen: false,
    sort: SORTS.includes(load(SORT_KEY)) ? load(SORT_KEY) : 'updated',
  };
  const {
    hasLabel,
    labelOptions,
    matchesLabels,
    pruneLabels,
    sortIssues,
    toggleLabel,
    triageScores,
  } = window.BacklogLabels;
  const $b = (sel) => document.querySelector(sel);
  const project = () => bl.projects.find((p) => p.id === bl.projectId) || null;
  const visible = () => state.view === 'backlog';
  const selectable = (i) => i.state === 'open' && i.column === 'todo';

  async function refreshBacklog() {
    try {
      [bl.projects, state.settings, state.ws] = await Promise.all([api.listProjects(), api.getSettings(), api.getWorkspace()]);
    } catch (e) {
      bl.error = errMsg(e);
      render();
      return;
    }
    $b('#backlog-dir').textContent = state.ws?.backlog || '';
    const ids = bl.projects.map((p) => p.id);
    const withRepo = bl.projects.find((p) => p.repo)?.id;
    bl.projectId = [bl.projectId, load(PROJECT_KEY), state.settings.lastProject, withRepo, ids[0]].find((id) => id && ids.includes(id)) || null;
    await selectProject(bl.projectId);
  }

  async function selectProject(id) {
    bl.projectId = id;
    bl.seq++; // a sync still running for the previous project is ignored
    bl.syncing = false;
    bl.data = null;
    bl.error = null;
    bl.expanded.clear();
    bl.selected.clear();
    bl.labels = loadLabels(id);
    bl.labelsOpen = false;
    if (id) save(PROJECT_KEY, id);
    if (!id) { render(); return; }
    try { setData(await api.getBacklog(id)); } catch (e) { bl.error = errMsg(e); }
    bl.platform = bl.data?.platform || state.settings.backlogPlatform || 'github';
    render();
    if (project()?.repo && !PLATFORMS[bl.platform]?.soon) sync();
  }

  function setData(data) {
    bl.data = data;
    // selected issues that left To do (assigned, closed) are dropped from the selection
    const ok = new Set((data?.issues || []).filter(selectable).map((i) => i.number));
    for (const n of [...bl.selected]) if (!ok.has(n)) bl.selected.delete(n);
    // labels no synced issue has any more leave the filter
    if (data?.issues) setLabels(pruneLabels(bl.labels, data.issues));
    // the cards' run titles and PRs, shared with the other run lists (app.js); the latest run of
    // each card has its PR state read when the service has not yet
    const runs = (data?.issues || []).flatMap((i) => i.runs || []);
    window.noteRunMeta?.(runs);
    window.askPrStates?.((data?.issues || []).map((i) => i.runs?.[0]).filter(Boolean));
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

  // Re-reads the cached issues with their runs and queue (cheap, no sync).
  async function reload() {
    const id = bl.projectId;
    if (!id || bl.syncing) return;
    try {
      const data = await api.getBacklog(id);
      if (data && bl.projectId === id && !bl.syncing) { setData(data); render(); }
    } catch { /* keep what is shown */ }
  }

  // Runs start, stop at gates and end while the screen is open.
  let runTimer = null;
  api.onEvent(() => {
    if (!visible() || runTimer) return;
    runTimer = setTimeout(() => { runTimer = null; reload(); }, 1500);
  });
  // The queue also changes without run events (a start that fails, the next issue starting).
  setInterval(() => {
    const busy = bl.data?.queue?.items?.length || bl.data?.issues?.some((i) => i.runs?.[0]?.status === 'running');
    if (visible() && busy) reload();
  }, 5000);

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

  function renderAssignInputs() {
    const wf = bl.workflows.find((w) => w.file === $b('#assign-workflow').value);
    $b('#assign-wf-desc').textContent = wf?.description || '';
    const saved = bl.data?.queue?.inputs?.[wf?.file] || {};
    const fields = Object.entries(wf?.inputs || {}).filter(([k, def]) => !skipInput(k, def || {}));
    $b('#assign-inputs').innerHTML = fields.map(([k, def = {}]) => {
      const value = saved[k] ?? def.default ?? '';
      const label = `<label for="ai-${esc(k)}">${esc(k)}${def.required ? ' <span class="req">*</span>' : ''}</label>`;
      const ctrl = Array.isArray(def.enum)
        ? `<select id="ai-${esc(k)}" data-input="${esc(k)}">${def.enum.map((o) => `<option value="${esc(o)}"${String(o) === String(value) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : `<input type="text" id="ai-${esc(k)}" data-input="${esc(k)}" value="${esc(value)}" />`;
      return `<div class="field">${label}${ctrl}${def.description ? `<div class="hint">${esc(def.description)}</div>` : ''}</div>`;
    }).join('');
    updateAssignNote();
  }

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
    try { bl.workflows = (await api.listWorkflows()).filter((w) => !w.error && w.inputs?.task); } catch (e) { bl.error = errMsg(e); render(); return; }
    if (!bl.workflows.length) { bl.error = 'No workflow has a task input to receive the issues.'; render(); return; }
    // in the order selected (the order the runs start, or the order of a group's task)
    const issues = shownSelected().map((n) => (bl.data?.issues || []).find((i) => i.number === n)).filter(Boolean);
    $b('#assign-issues').textContent = issues.map((i) => `#${i.number} ${i.title}`).join(' · ');
    const sel = $b('#assign-workflow');
    sel.innerHTML = bl.workflows.map((w) => `<option value="${esc(w.file)}">${esc(w.name)}</option>`).join('');
    const files = bl.workflows.map((w) => w.file);
    sel.value = [prefill?.workflow, load(WORKFLOW_KEY), 'software-development.yaml', files[0]].find((f) => f && files.includes(f));
    // real runs by default: Simulation is opt-in (checked only where real runs are refused anyway)
    $b('#assign-mock').checked = !!state.simulationOnly;
    document.querySelector(`input[name="assign-group"][value="${prefill?.group ? 'group' : 'separate'}"]`).checked = true;
    renderAssignBusy();
    renderAssignInputs();
    for (const [k, v] of Object.entries(prefill?.inputs || {})) {
      const el = document.querySelector(`#assign-inputs [data-input="${CSS.escape(k)}"]`);
      if (el && v != null) el.value = String(v);
    }
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
    if (bl.mode === 'roadmap') { bl.mode = 'list'; save(MODE_KEY, bl.mode); }
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

  async function roadmapGroup({ issues, workflow, inputs }) {
    const list = issues.map((n) => (bl.data?.issues || []).find((i) => i.number === n)).filter(Boolean);
    const skipped = issues.filter((n) => !list.some((i) => i.number === n));
    if (!list.length) return skipped;
    const wf = (await api.listWorkflows()).find((w) => w.file === workflow);
    await window.BacklogRoadmap.addStage(roadmapCtx(), bl.data, {
      issues: list, workflow, workflowName: wf?.name || workflow, inputs: inputs || {}, mock: !!state.simulationOnly, group: list.length > 1,
    });
    showRoadmap();
    return skipped;
  }

  // After a roadmap change from outside the screen (the Product Owner's "Add all to the roadmap").
  function showRoadmap(data) {
    if (data) setData(data);
    bl.mode = 'roadmap';
    save(MODE_KEY, bl.mode);
    render();
  }

  // Selected issues the roadmap already plans (not started): assigning them takes them out of it.
  const planned = (numbers) => (bl.data?.issues || []).filter((i) => numbers.includes(i.number) && ['planned', 'failed'].includes(i.roadmap?.status));
  async function submitAssign(e) {
    e.preventDefault();
    const workflow = $b('#assign-workflow').value;
    const inputs = {};
    document.querySelectorAll('#assign-inputs [data-input]').forEach((el) => { if (el.value.trim() !== '') inputs[el.dataset.input] = el.value.trim(); });
    const numbers = assignNumbers();
    if (!numbers.length) return;
    const inRoadmap = planned(numbers);
    if (inRoadmap.length && !await confirmDialog('Already in the roadmap', `${inRoadmap.map((i) => `#${i.number} (stage ${i.roadmap.stage})`).join(', ')} ${inRoadmap.length > 1 ? 'are' : 'is'} planned in the roadmap. Assigning takes ${inRoadmap.length > 1 ? 'them' : 'it'} out of the roadmap and into the queue.`, 'Assign anyway')) return;
    const btn = $b('#btn-assign-ok');
    btn.disabled = true;
    try {
      const data = await api.assignWorkflow(bl.projectId, numbers, workflow, inputs, wantsSimulation($b('#assign-mock')), grouped());
      save(WORKFLOW_KEY, workflow);
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
    const inputs = {};
    document.querySelectorAll('#assign-inputs [data-input]').forEach((el) => { if (el.value.trim() !== '') inputs[el.dataset.input] = el.value.trim(); });
    const numbers = assignNumbers();
    if (!numbers.length) return;
    const issues = numbers.map((n) => (bl.data?.issues || []).find((i) => i.number === n)).filter(Boolean);
    const btn = $b('#btn-assign-roadmap');
    btn.disabled = true;
    try {
      const wf = bl.workflows.find((w) => w.file === workflow);
      await window.BacklogRoadmap.addStage(roadmapCtx(), bl.data, {
        issues, workflow, workflowName: wf?.name || workflow, inputs, mock: wantsSimulation($b('#assign-mock')), group: grouped(),
      });
      save(WORKFLOW_KEY, workflow);
      bl.selected.clear();
      bl.mode = 'roadmap';
      save(MODE_KEY, bl.mode);
      closeModal('#assign-modal');
      render();
    } catch (err) {
      $b('#assign-error').textContent = errMsg(err);
    } finally {
      btn.disabled = false;
    }
  }
  const roadmapCtx = () => ({ projectId: bl.projectId, setData, render, setError: (msg) => { bl.error = msg; } });

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
    if (!matchesLabels(i, bl.labels)) return false;
    if (!bl.q) return true;
    const hay = `#${i.number} ${i.title} ${i.labels.map((l) => l.name).join(' ')} ${i.author || ''} ${i.assignees.join(' ')}`.toLowerCase();
    return hay.includes(bl.q.toLowerCase());
  };
  // The state chips only apply to the list (the kanban shows every state in its columns).
  const inState = (i) => bl.mode === 'kanban' || bl.filter === 'all' || i.state === bl.filter;
  const isShown = (i) => inState(i) && matches(i);
  // Selected issues the filters hide stay selected, but are neither counted nor assigned.
  function shownSelected() {
    const shown = new Set((bl.data?.issues || []).filter(isShown).map((i) => i.number));
    return [...bl.selected].filter((n) => shown.has(n));
  }
  const filtering = () => !!bl.q || bl.labels.length > 0;
  const noMatch = () => `<div class="empty-state"><b>No issues match the filters</b>
    <p class="muted">${bl.labels.length ? `Labels: ${esc(bl.labels.join(', '))}. ` : ''}${bl.q ? `Search: “${esc(bl.q)}”.` : ''}</p>
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
    if (!i.tasks.total) return '';
    const pct = Math.round((i.tasks.done / i.tasks.total) * 100);
    return `<span class="bl-tasks" title="${i.tasks.done} of ${i.tasks.total} tasks done"><span class="bl-bar"><span style="width:${pct}%"></span></span><span class="mono small">${i.tasks.done}/${i.tasks.total}</span></span>`;
  };
  // the run's title and its PR (#84: state icon, #n link opening the PR, not the run)
  const runLink = (r) => `<button class="bl-run" type="button" data-run="${esc(r.runId)}" data-workflow="${esc(r.workflow || '')}" title="Open run ${esc(r.runId)} (${esc(r.workflow || 'workflow')})">
      <span class="pill pill-${esc(r.status)}">${esc(r.waiting ? 'waiting' : r.status)}</span><span>${esc(window.runTitle ? runTitle(r) : r.workflow || 'workflow')}</span>${window.runPrBadge ? runPrBadge(r, { compact: true }) : ''}${r.mock ? '<span class="badge p-mock">simulated</span>' : ''}</button>`;
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
      return `${rm}<span class="bl-queued"><span class="badge">queued #${i.queued.position}</span><span class="small">${esc(i.queued.workflow)}</span>${i.queued.mock ? '<span class="badge p-mock">simulated</span>' : ''}${groupBadge(i.queued.groupedWith)}
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
  // Opens Write & Review prefilled with the issue (nothing starts by itself).
  const enrichBtn = (i, cls = 'link-btn small') => (i.state === 'open'
    ? `<button class="${cls}" type="button" data-enrich="${i.number}" title="Enrich this issue in Write & Review (e.g. into a fuller issue or an RFC), then save the result back to it">Enrich in Write &amp; Review</button>` : '');

  function issueRow(i) {
    const open = bl.expanded.has(i.number);
    const host = PLATFORMS[bl.data?.platform]?.label || 'the platform';
    return `
      <div class="pr-run bl-issue${open ? ' open' : ''}${bl.selected.has(i.number) ? ' selected' : ''}" data-n="${i.number}">
        <div class="bl-row" data-act="toggle">
          <span class="bl-sel">${checkbox(i)}</span>
          <span class="bl-state ${i.state}" title="${i.state === 'open' ? 'Open' : 'Closed'}"></span>
          <span class="bl-num mono">#${i.number}</span>
          <div class="bl-main">
            <div class="bl-title">${esc(i.title)}</div>
            <div class="bl-labels">${triage(i)}${labels(i)}</div>
          </div>
          <span class="bl-status">${prBadges(i)}${status(i)}${enrichBtn(i)}</span>
          ${tasks(i) || '<span></span>'}
          <span class="pr-meta"><label>Updated</label>${esc(dateOf(i.updatedAt))}</span>
          <span class="pr-chev">${open ? '▾' : '▸'}</span>
        </div>
        ${open ? `
        <div class="pr-body">
          <div class="muted small">Opened by ${esc(i.author || 'unknown')} on ${esc(dateOf(i.createdAt))}${i.assignees.length ? ` · assigned to ${esc(i.assignees.join(', '))}` : ''}</div>
          ${i.pullRequests?.length ? `<div class="bl-prs"><span class="muted small">Open ${bl.data?.platform === 'gitlab' ? 'MRs' : 'PRs'}</span>${i.pullRequests.map((p) => `<span class="small">${prBadges({ pullRequests: [p] })} ${esc(p.title)}</span>`).join('')}</div>` : ''}
          ${i.runs?.length ? `<div class="bl-runs"><span class="muted small">Runs</span>${i.runs.map(runLink).join('')}</div>` : ''}
          <div class="md bl-md">${i.body.trim() ? markdownHtml(i.body) : '<p class="muted">No description.</p>'}</div>
          <div class="row"><a class="btn sm ghost" href="${esc(i.url)}" target="_blank" rel="noopener">Open on ${esc(host)}</a>${enrichBtn(i, 'btn sm ghost')}</div>
        </div>` : ''}
      </div>`;
  }

  const card = (i) => `
    <div class="bl-card${bl.selected.has(i.number) ? ' selected' : ''}" data-n="${i.number}">
      <div class="bl-card-head">${checkbox(i)}<span class="bl-num mono">#${i.number}</span><a class="bl-card-title" href="${esc(i.url)}" target="_blank" rel="noopener" title="Open on ${esc(PLATFORMS[bl.data?.platform]?.label || 'the platform')}">${esc(i.title)}</a></div>
      <div class="bl-labels">${triage(i)}${labels(i)}</div>
      ${tasks(i)}
      ${prBadges(i) || status(i) ? `<div class="bl-card-run">${prBadges(i)}${status(i)}</div>` : ''}
      ${enrichBtn(i) ? `<div class="bl-card-actions">${enrichBtn(i)}</div>` : ''}
    </div>`;

  function renderList(issues) {
    const shown = sortIssues(issues.filter(isShown), bl.sort);
    return shown.length ? shown.map(issueRow).join('') : filtering() ? noMatch() : '<p class="muted">No issues match.</p>';
  }

  function renderKanban(issues) {
    const shown = sortIssues(issues.filter(isShown), bl.sort);
    const withLocal = bl.data?.local?.ahead > 0 || issues.some((i) => i.column === 'local');
    const columns = COLUMNS.filter(([col]) => col !== 'local' || withLocal);
    return `${!shown.length && issues.length && filtering() ? noMatch() : ''}<div class="bl-board${withLocal ? ' with-local' : ''}">${columns.map(([col, title]) => {
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
      ${q.error ? `<span class="error small">${esc(q.error)}</span>` : ''}
      ${skips}
      <span class="spacer"></span>
      <button class="btn sm${q.paused ? ' primary' : ' ghost'}" type="button" data-pause="${q.paused ? 'off' : 'on'}">${q.paused ? 'Resume' : 'Pause'}</button>`;
  }

  // ---- local merges not pushed (software-development-local-hero) ---------------------------
  // The project's local <base> has commits origin/<base> has not: what they close, Push, auto-push.
  const issueRefs = (numbers) => numbers.map((n) => `#${n}`).join(', ');
  function renderLocal() {
    const box = $b('#bl-local');
    const l = bl.data?.local;
    const localIssues = (bl.data?.issues || []).filter((i) => i.column === 'local');
    const show = l && (l.ahead > 0 || (l.error && localIssues.length));
    box.classList.toggle('hidden', !show);
    if (!show) { box.innerHTML = ''; return; }
    const commits = `${l.ahead} commit${l.ahead === 1 ? '' : 's'}`;
    box.innerHTML = l.ahead > 0 ? `
      <span><b>Not pushed</b> ${commits} on the local ${esc(l.base)}${l.issues?.length ? ` · closes ${esc(issueRefs(l.issues))} when pushed` : ''}</span>
      ${l.behind > 0 ? `<span class="warn-text small">origin/${esc(l.base)} has ${l.behind} new commit${l.behind === 1 ? '' : 's'}: the push updates first</span>` : ''}
      ${l.fetchError ? `<span class="warn-text small" title="${esc(l.fetchError)}">origin not reached: last known state</span>` : ''}
      <span class="spacer"></span>
      <label class="check small" title="Push the local ${esc(l.base)} after every successful local merge"><input type="checkbox" data-autopush${bl.data?.autoPush ? ' checked' : ''} /><span>Auto-push</span></label>
      <button class="btn sm primary" type="button" data-push>Push…</button>`
      : `<span><b>Push status unknown</b> <span class="error small">${esc(l.error)}</span></span><span class="spacer"></span>
      <button class="btn sm ghost" type="button" data-check>Check again</button>`;
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
    const sel = $b('#bl-project');
    sel.innerHTML = bl.projects.length
      ? bl.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.repo ? '' : ' (no repository)'}</option>`).join('')
      : '<option value="">No projects</option>';
    sel.value = bl.projectId || '';
    const plat = $b('#bl-platform');
    plat.innerHTML = Object.entries(PLATFORMS).map(([id, p]) => `<option value="${id}">${esc(p.label)}${p.soon ? ' (soon)' : ''}</option>`).join('');
    plat.value = bl.platform || state.settings.backlogPlatform || 'github';

    const p = project();
    const btn = $b('#btn-bl-sync');
    btn.disabled = !p?.repo || bl.syncing || !!PLATFORMS[bl.platform]?.soon;
    btn.textContent = bl.syncing ? 'Syncing…' : 'Sync';
    $b('#btn-bl-new-issue').disabled = !p?.repo || !!PLATFORMS[bl.platform]?.soon;
    $b('#bl-sort').value = bl.sort;
    $b('#bl-sort').classList.toggle('hidden', bl.mode === 'roadmap');

    document.querySelectorAll('#bl-mode [data-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === bl.mode);
      b.setAttribute('aria-selected', String(b.dataset.mode === bl.mode));
    });
    const n = shownSelected().length;
    $b('#btn-bl-assign').classList.toggle('hidden', !n);
    $b('#btn-bl-assign').textContent = `Assign workflow… (${n})`;
    $b('#btn-bl-clear').classList.toggle('hidden', !n);

    const issues = bl.data?.issues || [];
    const count = (f) => issues.filter((i) => f === 'all' || i.state === f).length;
    const filters = $b('#bl-filters');
    filters.classList.toggle('hidden', bl.mode !== 'list');
    filters.innerHTML = FILTERS.map(([f, label]) =>
      `<button class="chip${bl.filter === f ? ' active' : ''}" data-f="${f}">${label} <span class="muted">${count(f)}</span></button>`).join('');
    renderLabelFilter(issues);
    $b('#bl-synced').textContent = bl.syncing ? 'Syncing…' : bl.data ? `Synced ${dateOf(bl.data.syncedAt)} from ${PLATFORMS[bl.data.platform]?.label || bl.data.platform}` : '';
    const prError = bl.data?.pullRequestsError ? `Open ${bl.data.platform === 'gitlab' ? 'MRs' : 'PRs'} could not be read: ${bl.data.pullRequestsError}` : '';
    $b('#bl-error').textContent = bl.error || prError;
    renderLocal();
    renderQueue();

    const list = $b('#bl-list');
    if (!bl.projects.length) {
      list.innerHTML = '<div class="empty-state"><b>No projects yet</b><p class="muted">Create a project with a repository in Projects to see its issues here.</p></div>';
    } else if (!p?.repo) {
      list.innerHTML = '<div class="empty-state"><b>This project has no repository</b><p class="muted">Add a repository URL to the project in Projects to sync its issues.</p></div>';
    } else if (PLATFORMS[bl.platform]?.soon) {
      list.innerHTML = `<div class="empty-state"><b>${esc(PLATFORMS[bl.platform].label)} sync is not available yet</b><p class="muted">Pick GitHub or GitLab.</p></div>`;
    } else if (!bl.data) {
      list.innerHTML = bl.syncing ? '<p class="muted">Loading issues…</p>' : '<p class="muted">Not synced yet.</p>';
    } else {
      list.innerHTML = bl.mode === 'roadmap' ? window.BacklogRoadmap.html(bl.data) : bl.mode === 'kanban' ? renderKanban(issues) : renderList(issues);
    }
  }

  // ---- events --------------------------------------------------------------------------------
  $b('#bl-project').onchange = (e) => selectProject(e.target.value || null);
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
  $b('#btn-bl-clear').onclick = () => { bl.selected.clear(); render(); };
  $b('#bl-search').oninput = (e) => { bl.q = e.target.value.trim(); render(); };
  $b('#bl-mode').onclick = (e) => {
    const mode = e.target.closest('[data-mode]')?.dataset.mode;
    if (mode) { bl.mode = mode; save(MODE_KEY, mode); render(); }
  };
  function clearFilters() {
    bl.q = '';
    $b('#bl-search').value = '';
    setLabels([]);
    render();
  }
  const flipLabel = (name) => { setLabels(toggleLabel(bl.labels, name)); render(); };
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
    try { setData(await api.pauseQueue(bl.projectId, b.dataset.pause === 'on')); } catch (err) { bl.error = errMsg(err); }
    render();
  };
  $b('#bl-local').onclick = async (e) => {
    if (e.target.closest('[data-push]')) { openPush(); return; }
    const auto = e.target.closest('[data-autopush]');
    if (auto) {
      try {
        await api.setAutoPush(bl.projectId, auto.checked);
        if (bl.data) bl.data.autoPush = auto.checked;
      } catch (err) { bl.error = errMsg(err); render(); }
      return;
    }
    const check = e.target.closest('[data-check]');
    if (!check) return;
    check.disabled = true;
    try {
      const r = await api.checkLocal(bl.projectId);
      if (r.backlog) setData(r.backlog);
      window.refreshUnpushed?.();
    } catch (err) { bl.error = errMsg(err); }
    render();
  };
  $b('#btn-push-ok').onclick = () => doPush(false);
  $b('#btn-push-update').onclick = () => doPush(true);
  $b('#btn-push-resolve').onclick = resolveInRun;
  $b('#btn-push-cancel').onclick = () => closeModal('#push-modal');
  // Roadmap mode: its buttons, fields and drags (backlog-roadmap.js); its run links open the run below
  $b('#bl-list').addEventListener('change', (e) => { if (bl.mode === 'roadmap') window.BacklogRoadmap.onChange(e, roadmapCtx(), bl.data); });
  $b('#bl-list').addEventListener('dragstart', (e) => { if (bl.mode === 'roadmap') window.BacklogRoadmap.onDragStart(e); });
  $b('#bl-list').addEventListener('dragover', (e) => { if (bl.mode === 'roadmap') window.BacklogRoadmap.onDragOver(e); });
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
    if (e.target.closest('[data-clear-filters]')) { clearFilters(); return; }
    const run = e.target.closest('[data-run]');
    if (run) { openRun(run); return; }
    const gate = e.target.closest('[data-gate]');
    if (gate) { openGate(gate); return; }
    const out = e.target.closest('[data-unqueue]');
    if (out) { await removeQueued(Number(out.dataset.unqueue)); return; }
    const enrich = e.target.closest('[data-enrich]');
    if (enrich) { enrichIssue(Number(enrich.dataset.enrich)); return; }
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

  window.refreshBacklog = refreshBacklog;
  // a run's title or PR state changed (app.js onRunMeta): the cards draw it from the shared data
  window.renderBacklogCards = () => { if (visible() && bl.data) render(); };
  window.BacklogActions = {
    assignGroup,
    data: () => bl.data,
    projectId: () => bl.projectId,
    roadmapGroup,
    showRoadmap,
  };
})();
