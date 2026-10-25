// The run list shared by Projects › Project (views/project/) and Workflows › Runs
// (views/workflows/): filter chips, one row per run (status, title, PR, duration, tokens, cost,
// progress strip) and, expanded, its actions, its agent sessions (tokens and cost per session, a
// total row) and two columns (#289): Artifacts, with the Details tab's filter (ArtifactsPanel:
// Produced / Show all, category and kind chips, "n of m", the step as a label per file), and
// Repository (the branch and its base, a state badge, the totals, the run's commits newest first,
// "Review changes" and a click on a commit opening DiffViewer). Also the progress strip of a row
// (runProgressStrip: the groups a run visited, with their agents' robots) and renderRunListsSoon
// (run events). An expanded card's action row (#409): the run id at the left, then at the right
// Resume from step… (resumable runs), ◆ Send to supervisor (the Supervisor's chat with the run
// attached, disabled while it answers) and Open run (the Run screen, always on its Details).
// Uses app.js globals ($, esc, state, fmtDur, fmtNum, dateOf, timeOf, runTitleHtml, prBadge, runPr,
// setRunView, showRun…), fmtTok / fmtUsd (usage-widget.js), termAction (term-dock.js), canResume
// (resume-dialog.js), openSupervisorChat (views/supervisor/), openArtifactsAt, ArtifactsPanel, DiffViewer.
//
// The lists come in pages from the service (#200: runs:list / projects:runs with { offset, limit,
// filter, showSim, q, workflow, upTo }): the filter chips, "Show simulated", the search and the
// workflow filter (#310, a `#<prefix>-run-workflow` select; Workflows › Runs) ask the service again, the next page loads when the "Loading more…" row scrolls into view (loadRunListPage), and a
// row's artifacts (artifacts:list { runId }, ART_PAGE at a time) and changes (run:diff, the commits
// and the files' counts, never a file's contents) load when it opens; the filter is per card and
// goes back to Produced when the card is reopened. A run event updates its own row (refreshRunRow:
// runs:list { ids }); a running run's commits are read again when its row refreshes.

// The filter chips (id, catalog key, read when drawn); the service filters and counts (packages/engine/service/areas/run-lists.js RUN_FILTERS).
const RUN_FILTERS = [
  ['all', 'run_list.filter_all'],
  ['running', 'run_list.filter_running'],
  ['success', 'run_list.filter_success'],
  ['failed', 'run_list.filter_failed'],
];
const RUN_PAGE = 30;
const ART_PAGE = 50;

// Loads the list's runs: mode 'reset' (the first page: opening the list, a filter or the search
// changed), 'more' (the next page) or 'refresh' (the pages already loaded, again: live updates keep
// the scroll and the open rows). fetchPage(opts) is the service call; returns its answer, null when it
// failed or a newer load replaced it.
async function loadRunListPage(rl, fetchPage, mode = 'reset') {
  const seq = (rl.seq = (rl.seq || 0) + 1);
  const opts = { filter: rl.filter || 'all', showSim: !!rl.showSim, q: rl.q || '', workflow: rl.workflow || '', offset: 0, limit: RUN_PAGE };
  if (mode === 'more') opts.offset = rl.nextOffset || 0;
  if (mode === 'refresh') opts.limit = Math.max(RUN_PAGE, rl.nextOffset || 0);
  if (mode === 'reset' && rl.upTo) opts.upTo = rl.upTo;
  if (mode === 'more') rl.moreError = null;
  try {
    const res = await fetchPage(opts);
    if (seq !== rl.seq) return null;
    const got = res.runs || [];
    if (mode === 'more') {
      const have = new Set((rl.runs || []).map((r) => r.runId));
      rl.runs = [...(rl.runs || []), ...got.filter((r) => !have.has(r.runId))];
    } else rl.runs = got;
    rl.counts = res.counts || null;
    rl.workflows = res.workflows || [];
    rl.hiddenSim = res.hiddenSim || 0;
    rl.hasMore = !!res.hasMore;
    rl.nextOffset = res.nextOffset || 0;
    rl.error = null;
    return res;
  } catch (e) {
    if (seq !== rl.seq) return null;
    if (mode === 'more') rl.moreError = errMsg(e);
    else rl.error = errMsg(e);
    return null;
  }
}

// Run list shared by Projects > Project and Workflows > Runs. `rl` is the list state
// ({ runs, error, filter, showSim, q, expanded, msgs, counts, hiddenSim, hasMore, arts, id? }), `id`
// being the project when the list belongs to one; otherwise each run shows its own project.
// reload(): the first page again (filters changed); loadMore(): the next page.
function renderRunList(rl, { prefix, box: boxSel, empty, start, rerender, reload, loadMore }) {
  $(`#${prefix}-show-sim`).checked = rl.showSim;
  const search = $(`#${prefix}-run-search`);
  if (search && document.activeElement !== search) search.value = rl.q || '';
  $(`#${prefix}-runs-error`).textContent = rl.error ? t('run_list.could_not_load_runs_error', { error: rl.error }) : '';

  const filters = $(`#${prefix}-run-filters`);
  filters.innerHTML = RUN_FILTERS.map(([id, label]) =>
    `<button type="button" class="chip ${rl.filter === id ? 'active' : ''}" data-filter="${id}" ${id === 'failed' ? `title="${t('run_list.failed_cancelled_or_interrupted')}"` : ''}>${t(label)} <span class="muted">${rl.counts ? rl.counts[id] ?? 0 : ''}</span></button>`).join('');
  filters.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { rl.filter = b.dataset.filter; rerender(); reload(); }));
  // the workflow filter (#310, a list that has one): the workflows with runs, named as the rows name them;
  // the picked one stays an option when it has none
  const wfSelect = $(`#${prefix}-run-workflow`);
  if (wfSelect) {
    const list = [...(rl.workflows || [])];
    if (rl.workflow && !list.some((w) => w.workflow === rl.workflow)) list.push({ workflow: rl.workflow, count: 0 });
    const label = (file) => stepName(String(file).replace(/\.ya?ml$/i, ''));
    wfSelect.innerHTML = `<option value="">${t('run_list.all_workflows')}</option>${list.map((w) =>
      `<option value="${esc(w.workflow)}" title="${esc(w.workflow)}"${w.workflow === rl.workflow ? ' selected' : ''}>${esc(label(w.workflow))} (${w.count})</option>`).join('')}`;
    wfSelect.value = rl.workflow || '';
  }

  const box = $(boxSel);
  // a run's title being edited stays until it is saved or cancelled (which renders again)
  if (box.contains(document.activeElement) && document.activeElement.classList.contains('run-title-input')) return;
  rl.observer?.disconnect();
  if (rl.runs == null) {
    box.innerHTML = rl.error ? '' : `<p class="muted">${t('run_list.loading')}</p>`;
    return;
  }
  const hiddenSim = rl.hiddenSim || 0;
  const simNote = hiddenSim ? `<p class="muted small">${t('run_list.simulated_runs_hidden', { count: hiddenSim })}</p>` : '';
  if (!rl.runs.length && !rl.counts?.all && !rl.q && !rl.workflow) {
    box.innerHTML = `<div class="empty-state"><b>${esc(empty)}</b>${simNote}<button class="btn primary" data-empty-start>${t('run_list.start_workflow')}</button></div>`;
    box.querySelector('[data-empty-start]').onclick = start;
    return;
  }
  const runs = rl.runs;
  // the open rows' artifacts (again when their count changed) and changes load before the rows are drawn
  for (const r of runs) if (rl.expanded.has(r.runId)) { ensureRunArtifacts(rl, r, rerender); ensureRunRepo(rl, r, rerender); }
  const more = !rl.hasMore ? '' : rl.moreError
    ? `<div class="pr-more" data-more><span class="error small">${t('run_list.could_not_load_more_runs')} ${esc(rl.moreError)}</span> <button type="button" class="btn sm ghost" data-more-retry>${t('run_list.retry')}</button></div>`
    : `<div class="pr-more muted small" data-more>${t('run_list.loading_more')}</div>`;
  box.innerHTML = (nestChildRuns(runs).map((r) => runListRow(r, rl)).join('') || `<p class="muted pr-none">${rl.q ? t('run_list.no_runs_match_this_search') : t('run_list.no_runs_match_this_filter')}</p>`) + more + simNote;
  askPrStates(runs);

  // infinite scroll: the next page when the "Loading more…" row comes near the screen
  const sentinel = box.querySelector('[data-more]');
  if (sentinel && !rl.moreError && typeof IntersectionObserver === 'function') {
    rl.observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '300px' });
    rl.observer.observe(sentinel);
  }
  box.querySelector('[data-more-retry]')?.addEventListener('click', () => { rl.moreError = null; rerender(); loadMore(); });

  // #384: "Resumed → …" opens the run that resumed this one (not the row's sessions)
  box.querySelectorAll('[data-testid="run-resumed-link"]').forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = rl.runs.find((x) => x.runId === a.closest('.pr-run').dataset.run);
    showRun(a.dataset.run, { workflow: r?.workflow });
  }));
  box.querySelectorAll('.pr-row').forEach((row) => (row.onclick = () => {
    const id = row.closest('.pr-run').dataset.run;
    if (rl.expanded.has(id)) {
      rl.expanded.delete(id);
      // a reopened card starts on Produced and its first pages again (#289)
      const e = rl.arts?.get(id);
      if (e) { e.filter = null; e.shown = ART_PAGE; }
      const p = rl.repo?.get(id);
      if (p) p.shown = REPO_PAGE;
    } else rl.expanded.add(id);
    rerender();
  }));
  box.querySelectorAll('[data-art-more]').forEach((b) => (b.onclick = () => {
    const e = rl.arts?.get(b.closest('.pr-run').dataset.run);
    if (e) e.shown += ART_PAGE;
    rerender();
  }));
  box.querySelectorAll('[data-art-retry]').forEach((b) => (b.onclick = () => {
    rl.arts?.delete(b.closest('.pr-run').dataset.run);
    rerender();
  }));
  // #289: the Artifacts column's filter (the Details tab's switch and chips), per card
  box.querySelectorAll('.pr-arts [data-artifact-filter], .pr-arts [data-artifact-category], .pr-arts [data-artifact-kind]').forEach((b) => (b.onclick = () => {
    const e = rl.arts?.get(b.closest('.pr-run').dataset.run);
    if (e && ArtifactsPanel.onFilterClick(artifactFilter(e), b)) { e.shown = ART_PAGE; rerender(); }
  }));
  box.querySelectorAll('[data-art-show-all]').forEach((b) => (b.onclick = () => {
    const e = rl.arts?.get(b.closest('.pr-run').dataset.run);
    if (e) { artifactFilter(e).show = 'all'; rerender(); }
  }));
  // #289: the Repository column
  box.querySelectorAll('[data-repo-retry]').forEach((b) => (b.onclick = () => {
    rl.repo?.delete(b.closest('.pr-run').dataset.run);
    rerender();
  }));
  box.querySelectorAll('[data-repo-more]').forEach((b) => (b.onclick = () => {
    const e = rl.repo?.get(b.closest('.pr-run').dataset.run);
    if (e) e.shown += REPO_PAGE;
    rerender();
  }));
  box.querySelectorAll('[data-repo-review], .pr-commit[data-sha]').forEach((b) => (b.onclick = () => {
    const r = rl.runs.find((x) => x.runId === b.closest('.pr-run').dataset.run);
    if (!r || !window.DiffViewer) return;
    window.DiffViewer.open({ runId: r.runId, title: runDiffTitle(r), ...(b.dataset.sha ? { commit: b.dataset.sha } : {}) });
  }));
  box.querySelectorAll('[data-run-act]').forEach((b) => (b.onclick = () => {
    const r = rl.runs.find((x) => x.runId === b.closest('.pr-run').dataset.run);
    // #409: Open run selects this run on the Run screen, always on its Details (not the remembered view)
    if (b.dataset.runAct === 'open') { setRunView('details'); showRun(r.runId, { workflow: r.workflow }); }
    // #409: the Supervisor's chat with this run attached; nothing is sent until the person sends
    if (b.dataset.runAct === 'send-sup') {
      window.openSupervisorChat?.({ run: { runId: r.runId, workflow: r.workflow, status: r.status, error: r.error, mock: r.mock, issues: issuesOfRun(r) } });
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

// A run that started while its issues could not be read from the platform (#168): the cache or the
// planned copy was used, named here and in the run's log.
function issueFallbackBadge(r) {
  const used = issuesOfRun(r).filter((i) => i.fallback);
  if (!used.length) return '';
  const what = used.map((i) => `#${i.number}: ${i.fallback === 'cache' ? `the cache of ${i.cachedAt ? dateOf(i.cachedAt) : 'the last sync'}` : 'the copy saved with the planned item'}`).join('; ');
  return ` <span class="badge warn" title="${esc(t('run_list.the_platform_could_not_be_read', { what }))}">${t('run_list.issue_from_cache')}</span>`;
}

// Child runs of a `type: workflow` step (#174) right under their parent (by item, then start), marked
// `nested`; a child whose parent is not in the list stays where it is.
function nestChildRuns(list) {
  const ids = new Set(list.map((r) => r.runId));
  const under = new Map();
  for (const r of list) {
    const p = r.parentRun?.run_id;
    if (p && p !== r.runId && ids.has(p)) (under.get(p) || under.set(p, []).get(p)).push(r);
  }
  const order = (a, b) => (a.parentRun.index ?? 0) - (b.parentRun.index ?? 0) || String(a.startedAt).localeCompare(String(b.startedAt));
  const out = [];
  const add = (r, depth) => {
    out.push(depth ? { ...r, nested: depth } : r);
    if (depth < 3) (under.get(r.runId) || []).sort(order).forEach((c) => add(c, depth + 1));
  };
  list.filter((r) => !(r.parentRun?.run_id && ids.has(r.parentRun.run_id) && r.parentRun.run_id !== r.runId)).forEach((r) => add(r, 0));
  return out;
}

// The badges of a run linked by a `type: workflow` step (#174): its parent, or how many runs it started.
function childRunBadges(r) {
  const p = r.parentRun;
  const kids = r.childRuns || [];
  const parent = p?.run_id ? ` <span class="badge" title="${esc(p.workflow ? t('run_list.started_by_run_of_workflow', { run: p.run_id, workflow: p.workflow, step: p.step_id || '?' }) : t('run_list.started_by_run', { run: p.run_id, step: p.step_id || '?' }))}">${t('run_list.child')}${Number.isInteger(p.index) ? t('run_list.item_value', { value: p.index + 1 }) : ''}</span>` : '';
  const waiting = kids.filter((c) => c.status === 'running').length;
  const children = kids.length ? ` <span class="badge" title="${esc(kids.map((c) => `${c.run_id}: ${c.status}`).join('\n'))}">${t('run_list.child_runs_count', { count: kids.length })}${waiting ? t('run_list.waiting_running', { waiting }) : ''}</span>` : '';
  return parent + children;
}

function runListRow(r, pv) {
  const open = pv.expanded.has(r.runId);
  const task = String(r.task || '').trim();
  const firstLine = task.split('\n')[0];
  const dur = r.status === 'running' && r.startedAt ? Date.now() - Date.parse(r.startedAt) : r.durationMs;
  return `
    <div class="pr-run ${open ? 'open' : ''}${r.nested ? ' pr-child' : ''}" data-testid="run-list-row" data-run="${esc(r.runId)}"${r.nested ? ` style="--nest:${r.nested}"` : ''}>
      <div class="pr-row" title="${t(open ? 'run_list.hide_sessions' : 'run_list.show_sessions')}">
        ${StatusPill.runPill(r.status, r.resumedBy)}
        <div class="pr-main">
          <div><b>${runTitleHtml(r)}</b>${StatusPill.resumedLink(r.resumedBy)}${prBadge(r)} <span class="muted small" title="${esc(t('run_list.workflow_value', { value: r.workflow || r.file || '' }))}">${esc(stepName(String(r.workflow || r.file || 'workflow').replace(/\.ya?ml$/i, '')))}${r.version ? ` v${esc(r.version)}` : ''}</span>${r.mock ? ` <span class="badge p-mock">${t('run_list.simulated')}</span>` : ''}${r.current ? ` <span class="badge live">${t('run_list.this_window')}</span>` : ''}${r.runningElsewhere ? ` <span class="badge" title="${t('run_list.another_app_process_on_this_workspace')}">${t('run_list.another_window')}</span>` : ''}${r.retryOf ? ` <span class="badge" title="${t('run_list.started_by_a_retry_of_the')}">${t('run_list.retry_of')} ${esc(String(r.retryOf).slice(9))}</span>` : ''}${issueFallbackBadge(r)}${r.chain && window.ChainModel ? ` ${ChainModel.chainBadgesHtml(r.chain)}` : ''}${childRunBadges(r)}${!pv.id && r.project ? ` <span class="badge" title="${t('run_list.project')}">${esc(r.project.name)}</span>` : ''}</div>
          <div class="muted small pr-task" title="${esc(task)}">${esc(firstLine || t('run_list.no_task'))}</div>
        </div>
        <span class="pr-meta"><label>${t('run_list.started')}</label>${r.startedAt ? `<span data-testid="run-list-started"${typeof TimeZone !== 'undefined' ? ` title="${esc(TimeZone.titleOf(r.startedAt, TimeZone.current()))}"` : ''}>${esc(dateOf(r.startedAt))}</span>` : '—'}</span>
        <span class="pr-meta"><label>${t('run_list.duration')}</label>${fmtDur(dur)}</span>
        <span class="pr-meta"><label>${t('run_list.tokens')}</label>${fmtTok(r.tokens?.total)}</span>
        <span class="pr-meta"><label>${t('run_list.cost')}</label>${fmtUsd(r.costUsd)}${r.childrenCostUsd ? ` <span class="muted small" title="${t('run_list.what_its_child_runs_cost_their')}">${t('run_list.childrencostusd_child_runs', { childrenCostUsd: fmtUsd(r.childrenCostUsd) })}</span>` : ''}</span>
        <span class="pr-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>
        ${runProgressStrip(r)}
      </div>
      ${open ? projectRunBody(r, pv) : ''}
    </div>`;
}

// The card's Send to supervisor (#409): its label and title, busy while the Supervisor answers
// (views/supervisor/ syncs the shown buttons when that changes).
function sendToSupervisorHtml(busy) {
  return busy ? t('run_list.supervisor_is_answering') : `<span class="sup-mark">◆</span> ${t('run_list.send_to_supervisor')}`;
}
function sendToSupervisorTitle(busy) {
  return busy ? t('run_list.supervisor_is_answering_wait') : t('run_list.send_to_supervisor_title');
}

function projectRunBody(r, pv) {
  const sessions = r.sessions || [];
  const busy = !!window.supervisorChatBusy?.();
  // #409: the run id at the left, two actions at the right (Resume before them on a resumable run)
  return `<div class="pr-body">
    <div class="row">
      <span class="muted small mono" data-testid="run-id">${esc(r.runId)}</span>
      <span class="spacer"></span>
      <div class="row" data-testid="run-card-actions">
        ${canResume(r) ? `<button class="btn sm ghost" data-run-act="resume" title="${t('run_list.start_a_new_run_from_a')}">${t('run_list.resume_from_step')}</button>` : ''}
        <button class="btn sm ghost sup-btn" data-run-act="send-sup" title="${esc(sendToSupervisorTitle(busy))}"${busy ? ' disabled' : ''}>${sendToSupervisorHtml(busy)}</button>
        <button class="btn sm" data-run-act="open" title="${r.current || state.runs.has(r.runId) ? t('run_list.open_its_run_screen_details') : t('run_list.open_its_run_screen_details_rebuilt')}">${t('run_list.open_run')}</button>
      </div>
    </div>
    ${r.error ? `<pre class="pr-error">${esc(r.error)}</pre>` : ''}
    ${runTaskBlock(r)}
    ${sessions.length ? `<table class="u-table pr-sessions">
      <thead><tr><th>${t('run_list.agent')}</th><th>${t('run_list.provider_model')}</th><th>${t('run_list.status')}</th><th class="num">${t('run_list.turns')}</th><th class="num">${t('run_list.tokens_2')}</th><th class="num">${t('run_list.cost_2')}</th><th>${t('run_list.next_turn')}</th><th></th></tr></thead>
      <tbody>${[...sessions].sort((a, b) => isOrchSession(b) - isOrchSession(a)).map((s) => {
        const m = pv.msgs.get(`${r.runId}:${s.id}`);
        return `<tr data-session="${esc(s.id)}" data-agent="${esc(s.agent)}" data-testid="run-session-card">
          <td><b title="${esc(s.agent)}">${esc(agentLabel(s.agent, r.agentNames))}</b> <span class="muted small mono">${esc(s.id)}</span></td>
          <td>${sessionProviderCell(s)}</td>
          <td><span class="status st-${esc(s.status)}" data-status="${esc(s.status)}"><span class="status-dot"></span>${esc(StatusPill.statusLabel(s.status))}</span></td>
          <td class="num mono">${fmtNum(s.turns)}</td>
          ${tokensCell(s.tokens)}
          ${sessionCostCell(s)}
          ${nextTurnCell(s)}
          <td class="pr-term">
            <span class="small ${m?.error ? 'error' : 'muted'}" data-term-msg>${esc(m?.text || '')}</span>
            ${termButtons('live', isOrchSession(s) ? t('run_list.follow_the_orchestrator_log') : '')}
            ${termButtons('cli', '', s.cliAvailable ? '' : s.cliReason || t('run_list.not_available'))}
          </td>
        </tr>`;
      }).join('')}</tbody>
      ${sessionsTotalRow(sessions)}
    </table>` : `<p class="muted small">${t('run_list.no_agent_sessions_in_this_run')}</p>`}
    ${runColumnsBlock(r, pv)}
  </div>`;
}

// An open row's artifacts (#200): loaded once (artifacts:list { runId }), again when the row's count
// changes; the entry { status: loading | ok | error, files, error, count, shown } lives in rl.arts.
function ensureRunArtifacts(rl, r, rerender) {
  if (!r.artifactCount) return;
  const arts = rl.arts || (rl.arts = new Map());
  const cur = arts.get(r.runId);
  if (cur && (cur.pending || cur.status === 'error' || cur.count === r.artifactCount)) return;
  // a reload keeps showing the files it has until the new list arrives
  const entry = { status: cur?.status === 'ok' ? 'ok' : 'loading', files: cur?.files || null, error: null, count: r.artifactCount, shown: cur?.shown || ART_PAGE, pending: true };
  arts.set(r.runId, entry);
  api.listArtifacts({ runId: r.runId })
    .then(([x] = []) => { entry.files = x?.artifacts || []; entry.status = 'ok'; }, (e) => { entry.status = 'error'; entry.error = errMsg(e); })
    .finally(() => { entry.pending = false; if (arts.get(r.runId) === entry) rerender(); });
}

// Artifacts by the step that saved them (in their order), then the run folder's other files and the
// project copies: [[label, files]]. The expanded card groups by category since #289 (the step is a
// label on the row): no caller here any more; kept as the step grouping its tests read from this file.
function groupArtifacts(files) {
  const groups = new Map();
  for (const f of files) {
    const label = f.step || (f.location === 'external' ? 'Project copies' : 'Other files');
    (groups.get(label) || groups.set(label, []).get(label)).push(f);
  }
  const last = ['Other files', 'Project copies'];
  return [...groups].sort((a, b) => last.indexOf(a[0]) - last.indexOf(b[0]));
}

// ---- the expanded card's two columns (#289) ------------------------------------------------------
// Artifacts (the Details tab's filter: Produced / Show all, category and kind chips, from
// ArtifactsPanel) and Repository (the run's branch, its state, its commits from run:diff, Review
// changes). Side by side when the card is at least 900px wide (a container query), stacked below.
const REPO_PAGE = 5;
const artifactFilter = (e) => (e.filter || (e.filter = ArtifactsPanel.newFilter()));
const countBy = (files, fn) => files.reduce((acc, f) => { acc[fn(f)] = (acc[fn(f)] || 0) + 1; return acc; }, {});
const newestFirst = (a, b) => String(b.mtime || '').localeCompare(String(a.mtime || ''));
const shortSha = (sha) => String(sha || '').slice(0, 7);

function runColumnsBlock(r, pv) {
  const arts = runArtifactsColumn(r, pv);
  return `<div class="pr-cols${arts ? '' : ' pr-cols-one'}">${arts}${runRepositoryColumn(r, pv)}</div>`;
}

// The Artifacts column: '' when the run has no file (the Repository column takes the width).
function runArtifactsColumn(r, pv) {
  const e = pv.arts?.get(r.runId);
  if (!r.artifactCount && !e?.files?.length) return '';
  if (e?.status === 'ok' && !e.files.length) return '';
  const head = (n, m) => `<div class="pr-arts-head">${t('run_list.artifacts')}${n == null ? '' : ` <span class="muted">${n} ${t('run_list.of')} ${m}</span>`}</div>`;
  const wrap = (html) => `<div class="pr-arts pr-col" data-testid="run-card-artifacts">${html}</div>`;
  if (!e || e.status === 'loading') return wrap(`${head()}<p class="muted small">${t('run_list.loading')}</p>`);
  if (e.status === 'error') return wrap(`${head()}<p class="error small">${t('run_list.could_not_load_the_artifacts')} ${esc(e.error)} <button type="button" class="btn sm ghost" data-art-retry>${t('run_list.retry')}</button></p>`);
  const AP = ArtifactsPanel;
  const f = artifactFilter(e);
  const listed = AP.filterFiles(e.files, { show: 'all', category: null, kind: null }); // every file but the internal ones
  const inView = AP.filterFiles(e.files, f, { ignoreCategory: true });
  const files = AP.filterFiles(e.files, f);
  const counts = countBy(inView, AP.categoryOf);
  const kinds = countBy(AP.filterFiles(e.files, { ...f, kind: null }, { ignoreCategory: true }), AP.chipKindOf);
  const shown = files.slice(0, e.shown);
  const left = files.length - shown.length;
  const filters = `<div data-testid="run-card-artifact-filter">${AP.filtersHtml(f, counts, kinds)}</div>`;
  if (!files.length) {
    const nothing = f.show === 'produced' && !f.category && !f.kind;
    return wrap(`${head(0, listed.length)}${filters}<div class="pr-arts-empty">
      <b>${nothing ? t('run_list.nothing_produced_yet') : t('run_list.nothing_matches_this_filter')}</b>
      ${nothing ? `<p class="muted small">${t('run_list.its_handoff_notes_decision_log_and')}</p><button type="button" class="btn sm ghost" data-art-show-all>${t('run_list.show_all_length', { length: listed.length })}</button>` : `<p class="muted small">${t('run_list.choose_another_chip')}</p>`}
    </div>`);
  }
  const sections = AP.CATEGORIES.map(([id, label]) => {
    const list = shown.filter((x) => AP.categoryOf(x) === id).sort(newestFirst);
    return list.length ? `<div class="pr-arts-cat" data-category="${id}"><div class="pr-arts-cat-head muted small">${esc(label)} <span>${list.length}</span></div>
      <div class="pr-arts-list">${list.map(artifactRowHtml).join('')}</div></div>` : '';
  }).join('');
  return wrap(`${head(files.length, listed.length)}${filters}${sections}
    ${left > 0 ? `<button type="button" class="btn sm ghost pr-arts-more" data-art-more>${t('run_list.show_left_more', { left: Math.min(left, ART_PAGE) })}${left > ART_PAGE ? ` <span class="muted">${t('run_list.left_left', { left })}</span>` : ''}</button>` : ''}`);
}

// One file row: its kind, its name, the step that saved it (a small label), its size.
function artifactRowHtml(a) {
  return `<button type="button" class="pr-art ${a.exists ? '' : 'missing'}" data-testid="run-card-artifact" data-art="${esc(a.path)}" title="${esc(a.path)}">
    ${artKindIcon(a.kind)}<span class="pr-art-name">${esc(a.name)}</span>
    ${a.step ? `<span class="pr-art-step mono muted small" title="${t('run_list.the_step_that_saved_it')}">${esc(a.step)}</span>` : ''}
    ${a.location === 'external' ? `<span class="badge">${t('run_list.project_copy')}</span>` : ''}${a.exists ? '' : `<span class="muted small">${t('run_list.deleted')}</span>`}
    <span class="muted small">${esc(fmtSize(a.size))}</span>
  </button>`;
}

// The Repository column: what the run did to the code, from run:diff (the same data the diff viewer
// lists its commits from; no file contents).
function runRepositoryColumn(r, pv) {
  const e = pv.repo?.get(r.runId);
  const wrap = (html, { reviewable = false, why = '' } = {}) => `<div class="pr-repo pr-col" data-testid="run-card-repository">
    <div class="pr-arts-head pr-repo-head">${t('run_list.repository')} <button type="button" class="btn sm" data-testid="run-card-review-changes" data-repo-review${reviewable ? '' : ' disabled'} title="${esc(reviewable ? t('run_list.the_changed_files_and_the_commits') : why)}">${t('run_list.review_changes')}</button></div>
    ${html}</div>`;
  if (r.mock) return wrap(`<p class="muted small">${t('run_list.simulated_nothing_was_committed')}</p>`, { why: t('run_list.a_simulated_run_commits_nothing') });
  if (!e || e.status === 'loading') return wrap(`<p class="muted small">${t('run_list.loading')}</p>`, { why: t('run_list.loading_the_run_changes') });
  if (e.status === 'error') return wrap(`<p class="error small">${t('run_list.could_not_load_the_changes')} ${esc(e.error)} <button type="button" class="btn sm ghost" data-repo-retry>${t('run_list.retry')}</button></p>`, { why: t('run_list.the_run_changes_could_not_be_read', { error: e.error }) });
  const d = e.data;
  const commits = d.commits || [];
  const files = d.files || [];
  if (d.simulated) return wrap(`<p class="muted small">${t('run_list.simulated_nothing_was_committed')}</p>`, { why: t('run_list.a_simulated_run_commits_nothing') });
  if (d.unavailable && !commits.length) {
    const gone = !!d.branchGone || /\bgone\b/i.test(d.unavailable);
    return wrap(`${repoBranchHtml(r, d)}<p class="muted small">${gone ? t('run_list.the_branch_is_gone_nothing_is') : esc(d.unavailable)}</p>`, { reviewable: files.length > 0, why: t('run_list.this_run_has_no_changes_to_show') });
  }
  if (!commits.length) return wrap(`${repoBranchHtml(r, d)}<p class="muted small">${t('run_list.this_run_made_no_commits')}</p>`, { reviewable: files.length > 0, why: t('run_list.this_run_made_no_commits_title') });
  const added = files.reduce((n, f) => n + (f.added || 0), 0);
  const deleted = files.reduce((n, f) => n + (f.deleted || 0), 0);
  const shown = commits.slice(0, e.shown);
  const left = commits.length - shown.length;
  const when = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? timeOf(iso).replace(/:\d\d (AM|PM)$/, ' $1') : ''; };
  return wrap(`${repoBranchHtml(r, d)}
    <div class="muted small pr-repo-totals" data-testid="run-card-repo-totals">${t('run_list.commits_count', { count: commits.length })} · ${t('run_list.files_count', { count: files.length })} · <span class="pr-add">+${added}</span> <span class="pr-del">−${deleted}</span></div>
    <ul class="pr-commits" data-testid="run-card-commits" aria-label="${t('run_list.commits_of_this_run_newest_first')}">${shown.map((c) => `
      <li><button type="button" class="pr-commit" data-testid="run-card-commit" data-sha="${esc(c.sha)}" aria-label="${esc(`${c.short || shortSha(c.sha)} ${c.subject}`)}" title="${esc(`${c.subject}\n${c.author || ''} · ${c.date ? dateOf(c.date) : ''}`)}">
        <span class="mono pr-commit-sha">${esc(c.short || shortSha(c.sha))}</span><span class="pr-commit-subject">${esc(c.subject)}</span><span class="muted small pr-commit-time">${esc(when(c.date))}</span>
      </button></li>`).join('')}</ul>
    ${left > 0 ? `<button type="button" class="btn sm ghost" data-testid="run-card-commits-more" data-repo-more>${t('run_list.show_left_more', { left: Math.min(left, REPO_PAGE) })}${left > REPO_PAGE ? ` <span class="muted">${t('run_list.left_left', { left })}</span>` : ''}</button>` : ''}`, { reviewable: true });
}

// The branch (mono), its base and the state badge: merged (the PR), pushed (the PR link), merged
// locally at its merge commit, or not merged.
function repoBranchHtml(r, d) {
  const pr = runPr(r);
  const merge = r.localMerge || r.summary?.local_merge;
  const branch = d.branch || merge?.branch || r.branch || '';
  const base = d.base || merge?.base || r.base || '';
  const state = pr?.state === 'merged' ? `<span class="badge st-success" data-testid="run-card-repo-state">${t('run_list.merged')}${pr.number ? ` · #${esc(String(pr.number))}` : ''}</span>`
    : pr?.url ? `<a class="badge" data-testid="run-card-repo-state" href="${esc(pr.url)}" target="_blank" rel="noopener" title="${t('run_list.pushed_its_pull_request')}">${t('run_list.pushed')} ${esc(pr.number ? `#${pr.number}` : t('run_list.pr'))}</a>`
    : merge?.commit ? `<span class="badge st-success" data-testid="run-card-repo-state" title="${t('run_list.merged_into_value_on_this_machine', { value: esc(merge.base || base || 'the base') })}">${t('run_list.merged_locally_at')} <span class="mono">${esc(shortSha(merge.commit))}</span></span>`
    : (d.commits || []).length ? `<span class="badge" data-testid="run-card-repo-state">${t('run_list.not_merged')}</span>` : '';
  return `<div class="pr-repo-branch"><span class="mono" data-testid="run-card-repo-branch" title="${esc(branch ? t('run_list.the_run_s_branch') : t('run_list.the_run_s_branch_is_not'))}">${esc(branch || t('run_list.branch_not_recorded'))}</span>${base ? ` <span class="muted small">← ${esc(base)}</span>` : ''} ${state}</div>`;
}

// An open row's changes (#289): run:diff once, as a summary (the commits, the changed files' counts;
// no patch is computed or sent), again for a run in progress when its row was refreshed by a run
// event; the entry { status: loading | ok | error, data, error, shown, pending } lives in rl.repo.
function ensureRunRepo(rl, r, rerender) {
  if (r.mock) return;
  const repo = rl.repo || (rl.repo = new Map());
  const cur = repo.get(r.runId);
  const stale = cur?.status === 'ok' && r.status === 'running' && cur.item !== r && Date.now() - cur.at > 5000;
  if (cur && (cur.pending || cur.status === 'error' || !stale)) return;
  const entry = { status: cur?.status === 'ok' ? 'ok' : 'loading', data: cur?.data || null, error: null, shown: cur?.shown || REPO_PAGE, pending: true, item: r, at: Date.now() };
  repo.set(r.runId, entry);
  Promise.resolve().then(() => api.runDiff(r.runId, null, null, true))
    .then((d) => { entry.data = d || { commits: [], files: [] }; entry.status = 'ok'; }, (e) => { entry.status = 'error'; entry.error = errMsg(e); })
    .finally(() => { entry.pending = false; entry.at = Date.now(); if (repo.get(r.runId) === entry) rerender(); });
}

// The title the changes viewer shows for a run (its first task line).
const runDiffTitle = (r) => String(r.task || r.runId || '').split('\n')[0].slice(0, 80);

// A run event updates that run's row (#200): the row again from the service (runs:list { ids }), at
// most once a second per run, in whichever list has it loaded; the full reloads are throttled apart.
const rowTimers = new Map();
function refreshRunRow(runId) {
  if (!runId || rowTimers.has(runId)) return;
  if (![state.wr, state.pv].some((rl) => rl?.runs?.some((r) => r.runId === runId))) return;
  rowTimers.set(runId, setTimeout(async () => {
    rowTimers.delete(runId);
    let item = null;
    try { [item = null] = (await api.listRuns({ ids: [runId] })).runs || []; } catch { return; }
    if (!item) return;
    for (const rl of [state.wr, state.pv]) {
      const i = rl?.runs ? rl.runs.findIndex((r) => r.runId === runId) : -1;
      if (i >= 0) rl.runs[i] = item;
    }
    noteRunMeta([item]);
    renderRunListsSoon();
  }, 1000));
}

// A session's tokens (sessionView: input + output + cache read + cache write, as on the Usage
// screen): the compact total, the exact breakdown on hover; — when the session has none (the engine).
const TOKEN_PARTS = [['input', 'Input'], ['output', 'Output'], ['cache_read', 'Cache read'], ['cache_write', 'Cache write'], ['reasoning', 'Reasoning (counted in output)']];
function tokensCell(t) {
  if (!t?.total) return '<td class="num mono muted">—</td>';
  const tip = TOKEN_PARTS.map(([k, label]) => `${label}: ${fmtNum(t[k])}`).join('\n');
  return `<td class="num mono" title="${esc(tip)}">${fmtTok(t.total)}</td>`;
}
// #233: a cost that includes an estimate (attempts stopped before their result, priced from their
// model calls), or that misses a stopped attempt of a run recorded before costs were estimated.
// The one badge pair for it: the run lists, the Run screen (views/run/run.js) and Analytics' Run tab.
function costMarks(estimatedUsd, notRecorded) {
  return `${estimatedUsd > 0 ? ` <span class="badge" title="${esc(t('run_list.estimatedusd_of_it_estimated_from_the', { estimatedUsd: fmtUsd(estimatedUsd) }))}">${t('run_list.estimated')}</span>` : ''}${notRecorded ? ` <span class="badge warn" title="${t('run_list.an_attempt_stopped_before_its_result')}">${t('run_list.cost_not_recorded')}</span>` : ''}`;
}
// The Run screen's top-bar cost (app.js renderHeader): the run's sessions' marks after the total.
function sessionsCostMarks(sessions) {
  const estimated = sessions.reduce((a, s) => a + (Number(s.estimated_cost_usd) || 0), 0);
  return costMarks(estimated, sessions.some((s) => s.cost_not_recorded || s.costNotRecorded));
}
// #262: the provider and model that answered (a simulated session shows its workflow provider) and,
// for the session an agent fell back to, the provider · model it left and why.
const providerModel = (entry) => String(entry || '').replace(':', ' · ');
function sessionProviderCell(s) {
  const provider = s.simulates || s.provider;
  const fb = s.fallbackFrom;
  return `<span class="badge p-${esc(provider)}"${s.simulates ? ` title="${t('run_list.simulated_no_model_was_called')}"` : ''}>${esc(provider)}</span> <span class="mono small">${esc(s.model || '')}</span>${s.account ? ` <span class="badge" data-testid="run-session-account" title="${t('run_list.account')}">${esc(s.account)}</span>` : ''}${fb
    ? `<div class="pr-fallback small" data-testid="run-session-fallback" title="${esc(fb.reason || '')}"><span class="badge warn">${t('run_list.fallback')}</span> ${t('run_list.from')} <span class="mono">${esc(providerModel(fb.from))}</span>: ${esc(String(fb.reason || '').slice(0, 80))}</div>` : ''}`;
}
// #369: a session on a model the installed Claude Code does not know (estimate: the snapshot's
// cost_estimate): its cost estimated from tokens, or none with no price for the model; the CLI's own
// figure (at another model's rates) only on hover. The one note for the run lists and the Run screen.
function costEstimateNote(estimate) {
  if (!estimate) return '';
  const model = estimate.model || 'the model';
  const why = `Claude Code${estimate.cli_version ? ` ${estimate.cli_version}` : ''} does not know ${model}: it priced the turns at another model's rates (${fmtUsd(estimate.cli_cost_usd)}). Update it with \`claude update\`.`;
  return estimate.source === 'unknown'
    ? ` <span class="badge warn" data-testid="session-cost-note" title="${esc(t('run_list.why_add_a_price_for_model', { why, model }))}">${t('run_list.no_price_for')} ${esc(model)}</span>`
    : ` <span class="badge" data-testid="session-cost-note" title="${esc(why)}">${t('run_list.estimated_from_tokens')}</span>`;
}
// Tokens with no cost: a model with no price (Codex, unpriced models), not a free session.
function sessionCostCell(s) {
  if (s.costEstimate?.source === 'unknown') return `<td class="num mono muted" data-testid="session-cost">—${costEstimateNote(s.costEstimate)}</td>`;
  if (!s.costUsd && s.tokens?.total && s.provider !== 'mock' && !s.costNotRecorded) return `<td class="num mono muted" data-testid="session-cost" title="${t('run_list.no_price_for_this_model_see')}">—</td>`;
  return `<td class="num mono" data-testid="session-cost">${fmtUsd(s.costUsd)}${costMarks(s.costEstimatedUsd, s.costNotRecorded)}${costEstimateNote(s.costEstimate)}</td>`;
}
function sessionsTotalRow(sessions) {
  const sum = (f) => sessions.reduce((a, s) => a + (f(s) || 0), 0);
  const tokens = Object.fromEntries([...TOKEN_PARTS.map(([k]) => [k, sum((s) => s.tokens?.[k])]), ['total', sum((s) => s.tokens?.total)]]);
  return `<tfoot><tr class="pr-total"><td colspan="3">${t('run_list.total')}</td><td class="num mono">${fmtNum(sum((s) => s.turns))}</td>
    ${tokensCell(tokens)}<td class="num mono" data-testid="run-total-cost">${fmtUsd(sum((s) => s.costUsd))}${costMarks(sum((s) => s.costEstimatedUsd), sessions.some((s) => s.costNotRecorded))}</td><td></td><td></td></tr></tfoot>`;
}
// #320: how the session's next turn starts (apps/desktop/renderer/session-cache.js): the text leads, the
// colour follows (warm green, cold orange); — for a closed session. Run screen too (views/run/run.js).
function nextTurnCell(s, now = Date.now()) {
  const t = SessionCache.currentTurn(s, now);
  return `<td class="next-turn small"${t ? ` data-next-turn="${esc(t.kind)}"` : ''} data-testid="session-next-turn" title="${esc(SessionCache.turnTitle(t))}">${esc(SessionCache.turnText(t, now))}</td>`;
}

function runTaskBlock(r) {
  const t = String(r.task || '').trim();
  return t.includes('\n') || t.length > 120 ? `<details class="pr-fulltask"><summary class="muted small">${I18n.t('run_list.full_task')}</summary><pre>${esc(t)}</pre></details>` : '';
}

// Run progress in the runs lists: the groups a run visited, with their agents' avatars
let runListsFrame = 0;
function renderRunListsSoon() {
  if (runListsFrame) return;
  runListsFrame = requestAnimationFrame(() => {
    runListsFrame = 0;
    // the screens' own painters, when their front is shipped (#579)
    if (typeof workflowRunsVisible === 'function' && workflowRunsVisible() && state.wr.runs) renderWorkflowRuns();
    if (state.view === 'project' && state.pv?.runs) window.renderProjectView?.();
  });
}
// #320: the Next turn column's minutes left move on: the lists again (app.js, once a minute) while a run is expanded
function tickRunLists() {
  if ([state.wr, state.pv].some((rl) => rl?.expanded?.size)) renderRunListsSoon();
}

// Robot SVGs are large: one per provider/model/colour/state, reused. A workflow agent with a look
// saved in Agents (`workflow` + `agent`) gets its own entry, dropped when a look changes. Without a
// saved look the provider's robot is painted in the agent's colour (#227, agent-colors.js): the
// progress strip, the roadmap and the workflows list draw the same robot.
const avatarCache = new Map();
document.addEventListener('robots:changed', (e) => { if (e.detail?.name === 'workflow-agents') avatarCache.clear(); });
function robotAvatar(provider, model, st, workflow, agent) {
  const look = window.AgentLooks?.forWorkflow(workflow, agent);
  const color = !look && agent && window.AgentColors ? AgentColors.hexFor(agent, AgentColors.defIn(state.workflows, workflow, agent)) : '';
  const key = look ? `look|${workflow}/${agent}|${st}` : `${provider}|${model}|${color}|${st}`;
  if (!avatarCache.has(key)) {
    const variant = look || (window.Robots ? Robots.variantFor(window.RunChatModel?.providerType(provider, model) || provider, model || '') : null);
    avatarCache.set(key, variant ? Robots.svg(variant, st, { bubble: false, plaque: '', ...(color ? { color } : {}) }) : '');
  }
  return avatarCache.get(key);
}
const PERSON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="currentColor"/><path d="M4.5 21c0-4.2 3.4-7 7.5-7s7.5 2.8 7.5 7z" fill="currentColor"/></svg>';
const ENGINE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const CHIP_ROBOT_STATE = { running: 'thinking', waiting: 'waiting', failed: 'error', stopped: 'sleeping', done: 'idle' };
const MAX_CHIPS = 8;

// A step as people read it (#245): the run's own name for it (`stepNames`, from its workflow.started
// display), else its id made readable; the id itself stays for the tooltips.
const stepName = (id, stepNames) => (typeof displayName === 'function' ? displayName(id, stepNames) : String(id || ''));
const stepsTip = (ids, stepNames) => ids.map((s) => `${stepName(s, stepNames)} (${s})`).join(', ');

function progressAvatar(a, chip, names, workflow, stepNames) {
  const tip = a.human
    ? `${stepsTip(a.steps, stepNames)} · You (human gate)${a.durationMs ? ` · ${fmtDur(a.durationMs)}` : ''}`
    : `${stepsTip(a.steps, stepNames)} · ${agentLabel(a.agent, names)} (${a.agent})${a.provider ? ` · ${a.provider}${a.model ? `/${a.model}` : ''}` : ''}${a.durationMs ? ` · ${fmtDur(a.durationMs)}` : ''} · ${fmtUsd(a.cost)}`;
  // the last chip's working agents show the run's state; the others rest
  const st = chip.status === 'done' ? 'idle' : CHIP_ROBOT_STATE[chip.status];
  // the agent's fixed colour (#224): its robot is painted in it (#227), the engine's gear is drawn in it
  const def = !a.human && window.AgentColors ? AgentColors.defIn(state.workflows, workflow, a.agent) : null;
  const color = !a.human && window.AgentColors ? AgentColors.colorFor(a.agent, def) : '';
  const art = a.human ? PERSON_SVG : a.provider ? robotAvatar(a.provider, a.model, st, workflow, a.agent) : ENGINE_SVG;
  // the hover card: the agent's name with its role chip (#227), then the steps, provider, time and cost
  // (#236: the human gate's too; never a native title, which would open over the card)
  const card = a.human
    ? `<span class="rp-card" role="tooltip"><span><b>${t('run_list.you_human_gate')}</b></span><span class="muted">${esc(tip)}</span></span>`
    : `<span class="rp-card" role="tooltip"><span><b>${esc(agentLabel(a.agent, names))}</b>${window.AgentColors ? AgentColors.roleChip(a.agent, def) : ''}</span><span class="muted">${esc(tip)}</span></span>`;
  return `<span class="rp-av${a.human ? ' human' : a.provider ? '' : ' engine'}" data-testid="progress-agent"${color ? ` style="--agent-color:${esc(color)}"` : ''} tabindex="0" aria-label="${esc(tip)}">${art}${card}</span>`;
}

// A small app tooltip (#236) for the strip's "+N" badges: the names it folds, as a card.
const foldCard = (text) => `<span class="rp-card" role="tooltip"><span class="muted">${esc(text)}</span></span>`;

// stepNames (#245): step id → the run's name for it; a grouped chip keeps its group's name
function progressChip(c, names, workflow, stepNames) {
  const current = c.current ? stepName(c.current, stepNames) : c.current;
  const label = {
    done: '✓',
    running: `${current}…`,
    waiting: StatusPill.statusLabel('waiting'),
    failed: `✕ ${current}`,
    stopped: `Stopped at ${current}`,
  }[c.status];
  const agents = c.agents.length ? c.agents : [{ agent: 'orchestrator', steps: c.steps.map((e) => e.step), cost: 0, durationMs: 0 }];
  const avs = agents.slice(0, 4).map((a) => progressAvatar(a, c, names, workflow, stepNames)).join('') + (agents.length > 4 ? (() => {
    const more = `Also: ${agents.slice(4).map((a) => agentLabel(a.agent, names)).join(', ')}`;
    return `<span class="rp-av rp-more" tabindex="0" aria-label="${esc(more)}">+${agents.length - 4}${foldCard(more)}</span>`;
  })() : '');
  return `<div class="rp-chip st-${c.status}${c.status === 'done' ? ' still' : ''}">
    <div class="rp-avs">${avs}</div>
    <div class="rp-name">${esc(c.grouped ? c.name : stepName(c.name, stepNames))}${c.round > 1 ? ` <span class="rp-round">×${c.round}</span>` : ''}</div>
    <div class="rp-state">${esc(label)}</div>
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
  const stepNames = r.stepNames || live?.run?.stepNames;
  const folded = skipped > 0 ? `Earlier steps: ${chips.slice(0, skipped).map((c) => (c.grouped ? c.name : stepName(c.name, stepNames))).join(' › ')}` : '';
  return `<div class="rp-strip" data-testid="run-progress-strip">${skipped > 0 ? `<span class="rp-skip" tabindex="0" aria-label="${esc(folded)}">+${skipped}${foldCard(folded)}</span><span class="rp-sep">›</span>` : ''}${chips.slice(Math.max(0, skipped)).map((c) => progressChip(c, r.agentNames || live?.run?.agentNames, r.workflow || live?.run?.workflow, stepNames)).join('<span class="rp-sep">›</span>')}</div>`;
}

// #236: the app's tooltips stay on screen. The agent card (.rp-card) and the Roadmap's steps popover
// (.rm-steps) are placed in the window as they show (position: fixed, so no scrolling container
// clips them), next to what opened them, moved left or flipped up when there is no room; long lines
// wrap within their max width (style.css). Without this (before the first hover) the CSS places them.
// select.js places its search list with it too (#383).
const POP_EDGE = 6;
function placePopover(pop, anchor, { gap = 4, alignRight = false } = {}) {
  if (!pop || !anchor || !pop.getClientRects().length) return;
  const a = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  Object.assign(pop.style, { position: 'fixed', left: '0px', top: '0px', right: 'auto', bottom: 'auto', maxWidth: `${Math.max(120, vw - 2 * POP_EDGE)}px` });
  const r = pop.getBoundingClientRect();
  const left = Math.min(Math.max(POP_EDGE, alignRight ? a.right - r.width : a.left), Math.max(POP_EDGE, vw - r.width - POP_EDGE));
  const below = a.bottom + gap;
  const top = below + r.height <= vh - POP_EDGE || a.top - gap - r.height < POP_EDGE ? below : a.top - gap - r.height;
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(POP_EDGE, Math.min(top, vh - r.height - POP_EDGE))}px`;
}
function placeShown(from) {
  const progress = from?.closest?.('.rm-progress');
  const av = from?.closest?.('.rp-av, .rp-skip');
  requestAnimationFrame(() => {
    // the popover first: the card inside it is placed from where the popover now is
    if (progress) placePopover(progress.querySelector(':scope > .rm-steps'), progress, { gap: 6, alignRight: true });
    if (av) placePopover(av.querySelector(':scope > .rp-card'), av);
  });
}
document.addEventListener('mouseover', (e) => placeShown(e.target));
document.addEventListener('focusin', (e) => placeShown(e.target));
// a pinned popover (the ring's click) follows its ring when the page scrolls
document.addEventListener('scroll', () => {
  for (const p of document.querySelectorAll('.rm-progress.open, .rm-progress:hover, .rm-progress:focus-within')) placeShown(p);
}, true);
