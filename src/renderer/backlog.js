// Backlog screen: a project's issues synced from its git platform (src/backlog.js), as a list or a
// kanban (To do / In progress / Done). Shows the last sync right away and syncs again in the
// background each time the screen opens. The platform defaults to Settings › General › Backlog
// and can be switched here. Issues link to the runs working on them (a run whose task mentions
// the issue); "In progress" = open with such a run.
// Uses app.js globals ($, esc, state, errMsg, dateOf, markdownHtml, showView).
/* global api */
(() => {
  // Must match PLATFORMS in src/backlog.js (soon = no sync yet).
  const PLATFORMS = { github: { label: 'GitHub' }, gitlab: { label: 'GitLab' }, bitbucket: { label: 'Bitbucket', soon: true } };
  window.BACKLOG_PLATFORMS = PLATFORMS;
  const PROJECT_KEY = 'multiagent.backlogProject';
  const MODE_KEY = 'multiagent.backlogMode';
  const FILTERS = [['open', 'Open'], ['closed', 'Closed'], ['all', 'All']];
  const COLUMNS = [['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']];

  const load = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const save = (key, v) => { try { localStorage.setItem(key, v); } catch { /* storage unavailable */ } };

  const bl = {
    projects: [], projectId: null, platform: null, data: null, error: null, syncing: false,
    mode: load(MODE_KEY) === 'kanban' ? 'kanban' : 'list', filter: 'open', q: '', expanded: new Set(), seq: 0,
  };
  const $b = (sel) => document.querySelector(sel);
  const project = () => bl.projects.find((p) => p.id === bl.projectId) || null;
  const visible = () => state.view === 'backlog';

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
    if (id) save(PROJECT_KEY, id);
    if (!id) { render(); return; }
    try { bl.data = await api.getBacklog(id); } catch (e) { bl.error = errMsg(e); }
    bl.platform = bl.data?.platform || state.settings.backlogPlatform || 'github';
    render();
    if (project()?.repo && !PLATFORMS[bl.platform]?.soon) sync();
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
      if (seq === bl.seq && bl.projectId === p.id) bl.data = data;
    } catch (e) {
      if (seq === bl.seq) bl.error = errMsg(e);
    } finally {
      if (seq === bl.seq) bl.syncing = false;
      render();
    }
  }

  // Runs start and end while the screen is open: re-reads the cached issues (cheap, no sync).
  let runTimer = null;
  api.onEvent(() => {
    if (!visible() || !bl.projectId || runTimer) return;
    runTimer = setTimeout(async () => {
      runTimer = null;
      const id = bl.projectId;
      try {
        const data = await api.getBacklog(id);
        if (data && bl.projectId === id && !bl.syncing) { bl.data = data; render(); }
      } catch { /* keep what is shown */ }
    }, 3000);
  });

  // Opens a run in Workflows › Runs, expanded.
  function openRun(runId) {
    state.workflowsTab = 'runs';
    state.wr.filter = 'all';
    state.wr.expanded.add(runId);
    showView('workflows');
    setTimeout(() => document.querySelector(`.pr-run[data-run="${CSS.escape(runId)}"]`)?.scrollIntoView({ block: 'center' }), 600);
  }

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
  // The latest run on the issue, as a link (all of them when expanded).
  const runLink = (r) => `<button class="bl-run" type="button" data-run="${esc(r.runId)}" title="Open run ${esc(r.runId)}">
      <span class="pill pill-${esc(r.status)}">${esc(r.status)}</span><span>${esc(r.workflow || 'workflow')}</span></button>`;

  function issueRow(i) {
    const open = bl.expanded.has(i.number);
    const host = PLATFORMS[bl.data?.platform]?.label || 'the platform';
    return `
      <div class="pr-run bl-issue${open ? ' open' : ''}" data-n="${i.number}">
        <div class="bl-row" data-act="toggle">
          <span class="bl-state ${i.state}" title="${i.state === 'open' ? 'Open' : 'Closed'}"></span>
          <span class="bl-num mono">#${i.number}</span>
          <div class="bl-main">
            <div class="bl-title">${esc(i.title)}</div>
            <div class="bl-labels">${labels(i)}</div>
          </div>
          <span>${i.runs?.[0] ? runLink(i.runs[0]) : ''}</span>
          ${tasks(i) || '<span></span>'}
          <span class="pr-meta"><label>Updated</label>${esc(dateOf(i.updatedAt))}</span>
          <span class="pr-chev">${open ? '▾' : '▸'}</span>
        </div>
        ${open ? `
        <div class="pr-body">
          <div class="muted small">Opened by ${esc(i.author || 'unknown')} on ${esc(dateOf(i.createdAt))}${i.assignees.length ? ` · assigned to ${esc(i.assignees.join(', '))}` : ''}</div>
          ${i.runs?.length ? `<div class="bl-runs"><span class="muted small">Runs</span>${i.runs.map(runLink).join('')}</div>` : ''}
          <div class="md bl-md">${i.body.trim() ? markdownHtml(i.body) : '<p class="muted">No description.</p>'}</div>
          <div><a class="btn sm ghost" href="${esc(i.url)}" target="_blank" rel="noopener">Open on ${esc(host)}</a></div>
        </div>` : ''}
      </div>`;
  }

  const card = (i) => `
    <div class="bl-card">
      <div class="bl-card-head"><span class="bl-num mono">#${i.number}</span><a class="bl-card-title" href="${esc(i.url)}" target="_blank" rel="noopener" title="Open on ${esc(PLATFORMS[bl.data?.platform]?.label || 'the platform')}">${esc(i.title)}</a></div>
      <div class="bl-labels">${labels(i)}</div>
      ${tasks(i)}
      ${i.runs?.[0] ? `<div class="bl-card-run">${runLink(i.runs[0])}</div>` : ''}
    </div>`;

  function renderList(issues) {
    const shown = issues.filter((i) => (bl.filter === 'all' || i.state === bl.filter) && matches(i));
    return shown.length ? shown.map(issueRow).join('') : '<p class="muted">No issues match.</p>';
  }

  function renderKanban(issues) {
    const shown = issues.filter(matches);
    return `<div class="bl-board">${COLUMNS.map(([col, title]) => {
      const items = shown.filter((i) => (i.column || (i.state === 'closed' ? 'done' : 'todo')) === col);
      return `<section class="bl-col bl-col-${col}">
        <h3>${title} <span class="muted">${items.length}</span></h3>
        <div class="bl-col-body">${items.map(card).join('') || '<p class="muted small">Nothing here.</p>'}</div>
      </section>`;
    }).join('')}</div>`;
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
    const issues = bl.data?.issues || [];
    const count = (f) => issues.filter((i) => f === 'all' || i.state === f).length;
    const filters = $b('#bl-filters');
    filters.classList.toggle('hidden', bl.mode === 'kanban');
    filters.innerHTML = FILTERS.map(([f, label]) =>
      `<button class="chip${bl.filter === f ? ' active' : ''}" data-f="${f}">${label} <span class="muted">${count(f)}</span></button>`).join('');
    $b('#bl-synced').textContent = bl.syncing ? 'Syncing…' : bl.data ? `Synced ${dateOf(bl.data.syncedAt)} from ${PLATFORMS[bl.data.platform]?.label || bl.data.platform}` : '';
    $b('#bl-error').textContent = bl.error || '';

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
  $b('#bl-search').oninput = (e) => { bl.q = e.target.value.trim(); render(); };
  $b('#bl-mode').onclick = (e) => {
    const mode = e.target.closest('[data-mode]')?.dataset.mode;
    if (mode) { bl.mode = mode; save(MODE_KEY, mode); render(); }
  };
  $b('#bl-filters').onclick = (e) => {
    const f = e.target.closest('[data-f]')?.dataset.f;
    if (f) { bl.filter = f; render(); }
  };
  $b('#bl-list').onclick = (e) => {
    const run = e.target.closest('[data-run]');
    if (run) { openRun(run.dataset.run); return; }
    if (e.target.closest('a')) return;
    const row = e.target.closest('[data-act="toggle"]');
    if (!row) return;
    const n = Number(row.closest('.bl-issue').dataset.n);
    if (bl.expanded.has(n)) bl.expanded.delete(n); else bl.expanded.add(n);
    render();
  };

  window.refreshBacklog = refreshBacklog;
})();
