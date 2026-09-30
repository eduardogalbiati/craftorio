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
// Uses app.js globals ($, esc, state, errMsg, dateOf, markdownHtml, showView, openModal,
// closeModal, devMode, wantsSimulation, openApproval, selectRun).
/* global api */
(() => {
  // Must match PLATFORMS in src/backlog.js (soon = no sync yet).
  const PLATFORMS = { github: { label: 'GitHub' }, gitlab: { label: 'GitLab' }, bitbucket: { label: 'Bitbucket', soon: true } };
  window.BACKLOG_PLATFORMS = PLATFORMS;
  const PROJECT_KEY = 'multiagent.backlogProject';
  const MODE_KEY = 'multiagent.backlogMode';
  const WORKFLOW_KEY = 'multiagent.backlogWorkflow';
  const FILTERS = [['open', 'Open'], ['closed', 'Closed'], ['all', 'All']];
  // 'local': merged into the local base by a local workflow, not pushed yet (shown when there is any)
  const COLUMNS = [['todo', 'To do'], ['in_progress', 'In progress'], ['waiting', 'Waiting for approval'], ['local', 'Merged locally'], ['done', 'Done']];

  const load = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const save = (key, v) => { try { localStorage.setItem(key, v); } catch { /* storage unavailable */ } };

  const bl = {
    projects: [], projectId: null, platform: null, data: null, error: null, syncing: false,
    mode: load(MODE_KEY) === 'kanban' ? 'kanban' : 'list', filter: 'open', q: '', expanded: new Set(), seq: 0,
    selected: new Set(), workflows: [],
  };
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
    if (id) save(PROJECT_KEY, id);
    if (!id) { render(); return; }
    try { bl.data = await api.getBacklog(id); } catch (e) { bl.error = errMsg(e); }
    bl.platform = bl.data?.platform || state.settings.backlogPlatform || 'github';
    render();
    if (project()?.repo && !PLATFORMS[bl.platform]?.soon) sync();
  }

  function setData(data) {
    bl.data = data;
    // selected issues that left To do (assigned, closed) are dropped from the selection
    const ok = new Set((data?.issues || []).filter(selectable).map((i) => i.number));
    for (const n of [...bl.selected]) if (!ok.has(n)) bl.selected.delete(n);
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

  // Opens a run as a chat, live when it is in progress (its Details button leads to
  // Workflows › Runs).
  function openRun(el) {
    const runId = el.dataset.run;
    window.openRunChat({ runId, workflow: el.dataset.workflow, running: isRunLive(runId) });
  }

  // A waiting card opens the chat of its run, where the gate is answered (or its Run screen).
  function openGate(el) {
    const run = el.closest('[data-n]')?.querySelector('[data-run]');
    if (run && isRunLive(run.dataset.run)) openRun(run);
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
  const busySelected = () => (bl.data?.issues || []).filter((i) => bl.selected.has(i.number) && inFlight(i).length);
  // The issues the assignment sends: without the busy ones unless the user assigns them anyway.
  function assignNumbers() {
    const skip = $b('#assign-skip-busy')?.checked ? new Set(busySelected().map((i) => i.number)) : new Set();
    return [...bl.selected].filter((n) => !skip.has(n));
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

  async function openAssign() {
    if (!bl.selected.size) return;
    $b('#assign-error').textContent = '';
    try { bl.workflows = (await api.listWorkflows()).filter((w) => !w.error && w.inputs?.task); } catch (e) { bl.error = errMsg(e); render(); return; }
    if (!bl.workflows.length) { bl.error = 'No workflow has a task input to receive the issues.'; render(); return; }
    // in the order selected (the order the runs start, or the order of a group's task)
    const issues = [...bl.selected].map((n) => (bl.data?.issues || []).find((i) => i.number === n)).filter(Boolean);
    $b('#assign-issues').textContent = issues.map((i) => `#${i.number} ${i.title}`).join(' · ');
    const sel = $b('#assign-workflow');
    sel.innerHTML = bl.workflows.map((w) => `<option value="${esc(w.file)}">${esc(w.name)}</option>`).join('');
    const files = bl.workflows.map((w) => w.file);
    sel.value = [load(WORKFLOW_KEY), 'software-development.yaml', files[0]].find((f) => f && files.includes(f));
    // real runs by default: Simulation is opt-in (checked only where real runs are refused anyway)
    $b('#assign-mock').checked = !!state.simulationOnly;
    document.querySelector('input[name="assign-group"][value="separate"]').checked = true;
    renderAssignBusy();
    renderAssignInputs();
    openModal('#assign-modal');
  }

  async function submitAssign(e) {
    e.preventDefault();
    const workflow = $b('#assign-workflow').value;
    const inputs = {};
    document.querySelectorAll('#assign-inputs [data-input]').forEach((el) => { if (el.value.trim() !== '') inputs[el.dataset.input] = el.value.trim(); });
    const numbers = assignNumbers();
    if (!numbers.length) return;
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
    if (!bl.q) return true;
    const hay = `#${i.number} ${i.title} ${i.labels.map((l) => l.name).join(' ')} ${i.author || ''} ${i.assignees.join(' ')}`.toLowerCase();
    return hay.includes(bl.q.toLowerCase());
  };

  const labels = (i) => i.labels.map((l) => `<span class="bl-label"${l.color ? ` style="--lc:${esc(l.color)}"` : ''}>${esc(l.name)}</span>`).join('');
  const tasks = (i) => {
    if (!i.tasks.total) return '';
    const pct = Math.round((i.tasks.done / i.tasks.total) * 100);
    return `<span class="bl-tasks" title="${i.tasks.done} of ${i.tasks.total} tasks done"><span class="bl-bar"><span style="width:${pct}%"></span></span><span class="mono small">${i.tasks.done}/${i.tasks.total}</span></span>`;
  };
  const runLink = (r) => `<button class="bl-run" type="button" data-run="${esc(r.runId)}" data-workflow="${esc(r.workflow || '')}" title="Open run ${esc(r.runId)} as a chat">
      <span class="pill pill-${esc(r.status)}">${esc(r.waiting ? 'waiting' : r.status)}</span><span>${esc(r.workflow || 'workflow')}</span>${r.mock ? '<span class="badge p-mock">simulated</span>' : ''}</button>`;
  // Open PRs/MRs that refer to the issue, each a link to it.
  const prBadges = (i) => (i.pullRequests || []).map((p) =>
    `<a class="badge bl-pr${p.draft ? ' draft' : ''}" href="${esc(p.url)}" target="_blank" rel="noopener" title="${esc(`Open ${p.draft ? 'draft ' : ''}${prName(p)}: ${p.title}`)}">${esc(prName(p))}</a>`).join('');
  // The other issues of the same run (a group sent as one run: one branch, one PR/MR).
  const groupBadge = (others) => (others?.length
    ? `<span class="badge bl-group" title="One run, one branch and one PR/MR for these issues">grouped with ${esc(others.map((n) => `#${n}`).join(', '))}</span>` : '');
  const checkbox = (i) => (selectable(i) ? `<input type="checkbox" class="bl-check" data-sel="${i.number}" aria-label="Select #${i.number}"${bl.selected.has(i.number) ? ' checked' : ''} />` : '');
  // What the automation is doing with the issue: queued, its latest run, the gate waiting for you.
  function status(i) {
    if (i.queued) {
      return `<span class="bl-queued"><span class="badge">queued #${i.queued.position}</span><span class="small">${esc(i.queued.workflow)}</span>${i.queued.mock ? '<span class="badge p-mock">simulated</span>' : ''}${groupBadge(i.queued.groupedWith)}
        <button class="link-btn small" type="button" data-unqueue="${i.number}" title="Take it out of the queue">remove</button></span>`;
    }
    const r = i.runs?.[0];
    if (!r) return '';
    const notPushed = i.column === 'local'
      ? `<span class="badge bl-notpushed" title="Merged into the local ${esc(r.localMerge?.base || 'base')}; the issue closes when it is pushed (Push, above)">not pushed</span>` : '';
    const recovered = r.recovery ? `<span class="badge bl-recovered" title="${esc(`Supervisor: ${r.recovery}`)}">sent back after a failed merge</span>` : '';
    const watch = r.status === 'running' && isRunLive(r.runId)
      ? `<button class="btn sm ghost sup-btn" type="button" data-watch="${esc(r.runId)}" data-workflow="${esc(r.workflow || '')}" title="The supervisor follows this run and explains it in a chat (opt-in: it costs tokens)"><span class="sup-mark">◆</span> Watch</button>` : '';
    return `${runLink(r)}${notPushed}${recovered}${groupBadge(r.groupedWith)}${i.column === 'waiting' ? '<button class="btn sm primary" type="button" data-gate>Review approval</button>' : ''}${watch}`;
  }

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
            <div class="bl-labels">${labels(i)}</div>
          </div>
          <span class="bl-status">${prBadges(i)}${status(i)}</span>
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
          <div><a class="btn sm ghost" href="${esc(i.url)}" target="_blank" rel="noopener">Open on ${esc(host)}</a></div>
        </div>` : ''}
      </div>`;
  }

  const card = (i) => `
    <div class="bl-card${bl.selected.has(i.number) ? ' selected' : ''}" data-n="${i.number}">
      <div class="bl-card-head">${checkbox(i)}<span class="bl-num mono">#${i.number}</span><a class="bl-card-title" href="${esc(i.url)}" target="_blank" rel="noopener" title="Open on ${esc(PLATFORMS[bl.data?.platform]?.label || 'the platform')}">${esc(i.title)}</a></div>
      <div class="bl-labels">${labels(i)}</div>
      ${tasks(i)}
      ${prBadges(i) || status(i) ? `<div class="bl-card-run">${prBadges(i)}${status(i)}</div>` : ''}
    </div>`;

  function renderList(issues) {
    const shown = issues.filter((i) => (bl.filter === 'all' || i.state === bl.filter) && matches(i));
    return shown.length ? shown.map(issueRow).join('') : '<p class="muted">No issues match.</p>';
  }

  function renderKanban(issues) {
    const shown = issues.filter(matches);
    const withLocal = bl.data?.local?.ahead > 0 || issues.some((i) => i.column === 'local');
    const columns = COLUMNS.filter(([col]) => col !== 'local' || withLocal);
    return `<div class="bl-board${withLocal ? ' with-local' : ''}">${columns.map(([col, title]) => {
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

    document.querySelectorAll('#bl-mode [data-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === bl.mode);
      b.setAttribute('aria-selected', String(b.dataset.mode === bl.mode));
    });
    const n = bl.selected.size;
    $b('#btn-bl-assign').classList.toggle('hidden', !n);
    $b('#btn-bl-assign').textContent = `Assign workflow… (${n})`;
    $b('#btn-bl-clear').classList.toggle('hidden', !n);

    const issues = bl.data?.issues || [];
    const count = (f) => issues.filter((i) => f === 'all' || i.state === f).length;
    const filters = $b('#bl-filters');
    filters.classList.toggle('hidden', bl.mode === 'kanban');
    filters.innerHTML = FILTERS.map(([f, label]) =>
      `<button class="chip${bl.filter === f ? ' active' : ''}" data-f="${f}">${label} <span class="muted">${count(f)}</span></button>`).join('');
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
      list.innerHTML = bl.mode === 'kanban' ? renderKanban(issues) : renderList(issues);
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
  $b('#btn-bl-assign').onclick = openAssign;
  $b('#btn-bl-clear').onclick = () => { bl.selected.clear(); render(); };
  $b('#bl-search').oninput = (e) => { bl.q = e.target.value.trim(); render(); };
  $b('#bl-mode').onclick = (e) => {
    const mode = e.target.closest('[data-mode]')?.dataset.mode;
    if (mode) { bl.mode = mode; save(MODE_KEY, mode); render(); }
  };
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
  $b('#bl-list').onclick = async (e) => {
    const check = e.target.closest('[data-sel]');
    if (check) {
      const n = Number(check.dataset.sel);
      if (check.checked) bl.selected.add(n); else bl.selected.delete(n);
      render();
      return;
    }
    const watch = e.target.closest('[data-watch]');
    if (watch) { window.watchWithSupervisor({ runId: watch.dataset.watch, workflow: watch.dataset.workflow, status: 'running', mock: !!watch.closest('[data-n]')?.querySelector('.p-mock') }); return; }
    const run = e.target.closest('[data-run]');
    if (run) { openRun(run); return; }
    const gate = e.target.closest('[data-gate]');
    if (gate) { openGate(gate); return; }
    const out = e.target.closest('[data-unqueue]');
    if (out) { await removeQueued(Number(out.dataset.unqueue)); return; }
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
  $b('#btn-assign-cancel').onclick = () => closeModal('#assign-modal');

  window.refreshBacklog = refreshBacklog;
})();
