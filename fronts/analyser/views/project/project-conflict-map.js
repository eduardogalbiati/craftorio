// A project's Conflict map tab (#354): one table merging the Roadmap's former Conflict map panel
// (#150: the saved map of packages/engine/domains/project/conflict-map.js, the Backlog payload's `conflictMap`, read-only) and
// Analytics › Performance's former "Files most runs edit" (#159, channel analytics:performance,
// packages/engine/domains/project/repo-performance.js). A row per file, ranked by how many runs edited it: its run count and
// share of runs, the "hot" badge past the Product Owner's threshold (more than half of the map's
// newest 20 runs), the merge conflicts that named it. A click on a row opens the runs behind the
// count, the single lines most changed in that file and the trend (the newer half of the map's runs
// against the older half), with the file's recommendation and its "Create issue" (#197). Controls:
// 7 / 30 / 90 days or From-To (remembered), the before/after marker, Refresh and "Ask for a plan"
// (a real model call: it asks first).
// Also the one-line link "Conflict map: in Projects › <project>" that replaced the panel on the
// Roadmap (backlog-roadmap.js) and the table on Analytics › Performance (analytics.js): linkHtml()
// draws it, onLinkClick(e) opens the project's page on this tab (openProjectView, project.js).
// Drawn into the box project.js gives it (show), its clicks and changes routed from the project
// page's listeners (onClick, onChange).
// Uses app.js globals at call time: api, esc, errMsg, fmtNum, fmtUsd, markdownHtml, state, openDrawer.
// Browser: window.ProjectConflictMap.
(() => {
  const LS = 'multiagent.projectConflictMap';
  const DAY = 864e5;
  const HOT_WINDOW = 20;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } })();
  const view = { days: saved.days === undefined ? 30 : saved.days, from: saved.from || null, to: saved.to || null, marker: saved.marker || '' };
  // the project on screen: { id, box, perf, map, mapError, error, loading, open, issues, plan, planError, planning, seq }
  let cur = null;

  const persist = () => {
    try { localStorage.setItem(LS, JSON.stringify(view)); } catch { /* storage unavailable */ }
  };
  // the owner's local days (time-zone.js; without it, UTC days), as Analytics counts them
  const today = () => (window.TimeZone ? window.TimeZone.dayKey(Date.now(), window.TimeZone.current()) : new Date().toISOString().slice(0, 10));
  const daysBack = (n) => (window.TimeZone ? window.TimeZone.shiftDay(today(), 1 - n) : new Date(Date.now() - (n - 1) * DAY).toISOString().slice(0, 10));
  const range = () => (view.days ? { from: daysBack(view.days), to: today() } : { from: view.from || daysBack(30), to: view.to || today() });
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const plural = (n, key) => t(key, { count: n });

  // more than half of the map's newest 20 runs (packages/engine/domains/project/conflict-map.js hotSpots)
  function isHot(map, runIds) {
    const recent = new Set((map?.runIds || []).slice(0, HOT_WINDOW));
    const n = (runIds || []).filter((id) => recent.has(id)).length;
    return recent.size > 0 && n > 1 && n / recent.size > 0.5;
  }

  // the newer half of the map's runs against the older half
  function trend(map, runIds) {
    const all = map?.runIds || [];
    const half = Math.floor(all.length / 2);
    if (half < 2 || !runIds) return t('project_conflict_map.trend_not_enough_runs');
    const newer = new Set(all.slice(0, half));
    const older = new Set(all.slice(half, half * 2));
    const count = (set) => runIds.filter((id) => set.has(id)).length;
    return t('project_conflict_map.trend_older_newer', { older: count(older), newer: count(newer), half });
  }

  /** The files of both sources, one row each, ranked by how many runs edited them (the range's count, else the map's). */
  function mergeRows(perf, map) {
    const byFile = new Map();
    const row = (file) => {
      if (!byFile.has(file)) byFile.set(file, { file, runs: 0, share: null, conflicts: 0, perf: null, map: null });
      return byFile.get(file);
    };
    const named = (file) => (perf?.conflicts || []).filter((c) => (c.files || []).includes(file)).length;
    for (const f of perf?.files || []) Object.assign(row(f.file), { runs: f.runs, share: f.share, perf: f, conflicts: named(f.file) });
    for (const f of map?.files || []) {
      const r = row(f.file);
      r.map = f;
      r.conflicts = Math.max(r.conflicts, f.conflicts || 0);
      if (!r.perf) Object.assign(r, { runs: f.runs, share: map.runs ? f.runs / map.runs : null });
    }
    return [...byFile.values()].sort((a, b) => b.runs - a.runs || a.file.localeCompare(b.file));
  }

  function controlsHtml(over) {
    const r = range();
    const day = (n) => `<button type="button" class="${view.days === n ? 'active' : ''}" data-pcm-days="${n}" aria-pressed="${view.days === n}">${n} ${t('project_conflict_map.days')}</button>`;
    return `<div class="row pcm-controls" data-testid="project-conflict-controls">
      <div class="seg sm" role="group" aria-label="${t('project_conflict_map.quick_range')}">${day(7)}${day(30)}${day(90)}</div>
      ${window.DateRange.fields({ testid: 'conflict-map-date-range', from: r.from, to: r.to, fromAttrs: 'data-pcm-from', toAttrs: 'data-pcm-to' })}
      <label class="an-date small muted" title="${t('project_conflict_map.a_date_yyyy_mm_dd_or')}">${t('project_conflict_map.before_after')} <input type="text" class="an-marker" data-pcm-marker value="${esc(view.marker)}" placeholder="${t('project_conflict_map.date_or_commit')}" /></label>
      <button type="button" class="btn" data-pcm-refresh ${cur?.loading ? 'disabled' : ''}>${t('project_conflict_map.refresh')}</button>
      ${over ? `<button type="button" class="btn" data-pcm-plan data-testid="pcm-plan" ${cur.planning ? 'disabled' : ''} title="${t('project_conflict_map.the_supervisor_suggests_a_plan_for', { over, sharedLimit: pct(cur.perf.sharedLimit) })}">${cur.planning ? t('project_conflict_map.asking') : t('project_conflict_map.ask_for_a_plan')}</button>` : ''}
    </div>`;
  }

  function planHtml() {
    if (cur.planning) return `<div class="card an-card an-report"><p class="muted">${t('project_conflict_map.the_supervisor_is_reading_the_files')}</p></div>`;
    if (cur.planError) return `<div class="usage-unavailable" role="alert">${t('project_conflict_map.the_plan_failed')} ${esc(cur.planError)}</div>`;
    if (!cur.plan) return '';
    return `<div class="card an-card an-report"><div class="md">${markdownHtml(cur.plan.markdown || '')}</div>${cur.plan.reportPath ? `<p class="muted small">${t('project_conflict_map.saved_in')} ${esc(cur.plan.reportPath)}${cur.plan.costUsd ? ` · ${fmtUsd(cur.plan.costUsd)}` : ''}</p>` : ''}</div>`;
  }

  // #197: what to do with a file over the shared limit, and its issue (open or to create)
  const REC_LABEL = { generated: 'rec_generated', registry: 'rec_registry', large: 'rec_large', stylesheet: 'rec_stylesheet', doc: 'rec_doc', test: 'rec_test', hotspot: 'rec_hotspot' };
  function recommendationHtml(f) {
    const r = f?.recommendation;
    if (!r) return '';
    const issue = (cur.issues || []).find((i) => `${i.title || ''}\n${i.body || ''}`.includes(f.file));
    const action = issue
      ? `<a href="#" class="link-btn" data-pr-url="${esc(issue.url || '')}" title="${esc(issue.title || '')}">${t('project_conflict_map.open_issue')}${esc(issue.number)}</a>`
      : `<button type="button" class="btn sm ghost" data-pcm-issue="${esc(f.file)}" data-testid="pcm-create-issue">${t('project_conflict_map.create_issue')}</button>`;
    return `<div class="an-rec" data-testid="pcm-recommendation"><span class="badge warn">${esc(REC_LABEL[r.kind] ? t(`project_conflict_map.${REC_LABEL[r.kind]}`) : r.kind)}</span> <span>${esc(r.text)}</span><div class="an-rec-actions">${action}</div></div>`;
  }

  function detailHtml(r) {
    const map = cur.map;
    const runIds = r.map?.runIds || null;
    const lines = (map?.lines || []).filter((l) => l.file === r.file);
    const runs = runIds?.length
      ? `<div class="pcm-ids" data-testid="conflict-map-runs">${runIds.map((id) => `<span class="badge mono" title="${esc(id)}">${esc(id)}</span>`).join('')}</div>`
      : `<span class="muted">${t('project_conflict_map.the_saved_conflict_map_has_no')}</span>`;
    const lineList = lines.length
      ? `<ul class="pcm-lines">${lines.map((l) => `<li data-testid="conflict-map-line" aria-label="${esc(`${l.file}:${l.line}, ${plural((l.runIds || []).length, 'project_conflict_map.runs_count')}`)}"><span class="mono">${esc(`${l.file}:${l.line}`)}</span> <span class="mono muted pcm-line-text" title="${esc(l.text || '')}">${esc(l.text || '')}</span> <span class="badge">${plural((l.runIds || []).length, 'project_conflict_map.runs_count')}</span></li>`).join('')}</ul>`
      : `<span class="muted">${t('project_conflict_map.no_single_line_of_this_file')}</span>`;
    return `<tr class="pcm-detail-row"><td colspan="5"><div class="pcm-detail small" data-testid="project-conflict-detail">
      <div><b>${t('project_conflict_map.runs_behind_the_count')}</b> <span class="muted">${map?.runs ? plural(map.runs, 'project_conflict_map.saved_map_last_finished_runs') : t('project_conflict_map.saved_map')}</span>${runs}</div>
      <div><b>${t('project_conflict_map.lines_most_changed')}</b>${lineList}</div>
      <div class="muted">${esc(trend(map, runIds))}</div>
      ${recommendationHtml(r.perf)}
    </div></td></tr>`;
  }

  function tableHtml(rows, limit) {
    const map = cur.map;
    return `<table class="u-table an-sessions an-files pcm-table"><thead><tr><th>${t('project_conflict_map.file')}</th><th class="num" title="${t('project_conflict_map.in_the_range_a_file_only')}">${t('project_conflict_map.runs_that_edited_it')}</th><th class="num">${t('project_conflict_map.of_runs')}</th><th>${t('project_conflict_map.merge_conflicts')}</th><th class="num">${t('project_conflict_map.lines_now')}</th></tr></thead><tbody>
      ${rows.map((r) => {
        const open = cur.open === r.file;
        const hot = isHot(map, r.map?.runIds);
        const over = r.perf && r.runs > 1 && r.share > limit;
        return `<tr class="pcm-row" data-testid="project-conflict-row" data-pcm-row="${esc(r.file)}" aria-expanded="${open}" tabindex="0" title="${t('project_conflict_map.file_click_to_see_the_runs', { file: esc(r.file) })}">
          <td class="an-title" data-testid="conflict-map-file" aria-label="${esc(`${r.file}, ${plural(r.runs, 'project_conflict_map.runs_count')}`)}"><span class="an-file mono">${esc(r.file)}</span>${hot ? ` <span class="badge warn" title="${t('project_conflict_map.changed_by_more_than_half_of')}">${t('project_conflict_map.hot')}</span>` : ''}${r.perf?.generated ? ` <span class="badge" title="${t('project_conflict_map.a_tool_writes_this_file_a')}">${t('project_conflict_map.generated')}</span>` : ''}</td>
          <td class="num">${r.runs}</td>
          <td class="num">${over ? `<span class="badge warn" title="${t('project_conflict_map.more_than_limit_of_the_runs', { limit: pct(limit) })}">${pct(r.share)}</span>` : pct(r.share)}</td>
          <td>${r.conflicts ? `<span class="badge" title="${t('project_conflict_map.merge_conflicts_that_named_this_file')}">${plural(r.conflicts, 'project_conflict_map.conflicts_count')}</span>` : `<span class="muted small">${t('project_conflict_map.none')}</span>`}</td>
          <td class="num">${r.perf ? (r.perf.lines == null ? `<span class="badge" title="${t('project_conflict_map.no_longer_in_the_repository')}">${t('project_conflict_map.deleted')}</span>` : fmtNum(r.perf.lines)) : '—'}</td>
        </tr>${open ? detailHtml(r) : ''}`;
      }).join('')}</tbody></table>`;
  }

  function bodyHtml() {
    if (cur.error) return `<div class="usage-unavailable" role="alert">${t('project_conflict_map.could_not_load_the_conflict_map')} ${esc(cur.error)}</div>`;
    const p = cur.perf;
    if (cur.loading || !p) return `<p class="muted" role="status">${t('project_conflict_map.loading')}</p>`;
    if (!p.project) return `<div class="empty-state"><b>${t('project_conflict_map.no_project')}</b><p class="muted">${t('project_conflict_map.add_a_project_with_a_git')}</p></div>`;
    const notGit = p.project.isGit === false ? `<div class="usage-unavailable">${esc(p.project.name)}${t('project_conflict_map.s_folder_is_not_a_git')}</div>` : '';
    const mapNote = cur.mapError ? `<p class="muted small">${t('project_conflict_map.the_saved_conflict_map_could_not')} ${esc(cur.mapError)}</p>` : '';
    const rows = mergeRows(p.empty ? null : p, cur.map);
    if (!rows.length) {
      return `${notGit}${mapNote}${p.project.isGit === false ? '' : `<div class="empty-state" data-testid="conflict-map-empty"><b>${t('project_conflict_map.no_runs_with_commits_on_this')}</b><p class="muted">${t('project_conflict_map.runs_count_once_their_work_is')}</p></div>`}`;
    }
    const of = p.empty ? t('project_conflict_map.no_run_with_commits_in_range') : t('project_conflict_map.of_runs_with_commits', { count: p.runsWithCommits, from: esc(p.from), to: esc(p.to) });
    return `${notGit}${mapNote}<p class="muted small">${of}${cur.map?.runs ? plural(cur.map.runs, cur.map.source === 'git' ? 'project_conflict_map.covers_last_branch_commits' : 'project_conflict_map.covers_last_finished_runs') : ''}</p>
      <div id="pcm-plan-box">${planHtml()}</div>
      <div class="card table-wrap">${tableHtml(rows, p.sharedLimit)}</div>`;
  }

  function render() {
    if (!cur?.box) return;
    const over = cur.perf && !cur.loading && !cur.error ? (cur.perf.files || []).filter((f) => f.recommendation).length : 0;
    cur.box.innerHTML = `${controlsHtml(over)}<div data-testid="conflict-map">${bodyHtml()}</div>`;
  }

  async function load() {
    if (!cur) return;
    const c = cur;
    const seq = ++c.seq;
    Object.assign(c, { loading: true, error: null });
    render();
    const [perf, backlog] = await Promise.allSettled([
      (async () => api.getRepositoryPerformance({ projectId: c.id, marker: view.marker, ...range() }))(),
      (async () => api.getBacklog(c.id))(),
    ]);
    if (cur !== c || seq !== c.seq) return;
    c.loading = false;
    if (perf.status === 'fulfilled') c.perf = perf.value; else { c.perf = null; c.error = errMsg(perf.reason); }
    if (backlog.status === 'fulfilled') { c.map = backlog.value?.conflictMap || null; c.mapError = null; } else { c.map = null; c.mapError = errMsg(backlog.reason); }
    // the open issues, so a file over the limit that has one links to it instead of "Create issue"
    c.issues = backlog.status === 'fulfilled' ? (backlog.value?.issues || []).filter((i) => !i.state || String(i.state).toLowerCase() === 'open') : null;
    render();
  }

  /** Draws the tab of project `id` into `box`: read on the first show of a project, kept until Refresh or another range. */
  function show(id, box) {
    if (cur?.id !== id) cur = { id, box, perf: null, map: null, mapError: null, error: null, loading: false, open: null, issues: null, plan: null, planError: null, planning: false, seq: 0 };
    cur.box = box;
    if (!cur.perf && !cur.loading && !cur.error) load();
    else render();
  }

  function createIssue(file) {
    const f = cur?.perf?.files?.find((x) => x.file === file);
    if (!f?.recommendation) return;
    const r = f.recommendation;
    const p = cur.perf;
    const request = `Stop parallel runs colliding on ${file}: ${r.text}\n\nEvidence (Projects › ${p.project?.name || cur.id} › Conflict map, ${p.from} to ${p.to}): edited by ${pct(r.evidence.share)} of the runs with commits (${r.evidence.runs} of ${p.runsWithCommits})${r.evidence.lines != null ? `, ${r.evidence.lines} lines now` : ''}, named by ${r.evidence.conflicts} merge conflict(s). The shared limit is ${pct(p.sharedLimit)} of the runs.`;
    openDrawer({ workflow: 'issue-tracker.yaml', project: cur.id, inputs: { request } });
  }

  async function askPlan() {
    const c = cur;
    const files = (c?.perf?.files || []).filter((f) => f.recommendation).map((f) => f.file);
    if (!files.length || c.planning) return;
    if (!window.confirm(t('project_conflict_map.confirm_ask_plan', { count: files.length }))) return;
    Object.assign(c, { planning: true, planError: null });
    render();
    try { c.plan = await api.askPerformancePlan({ projectId: c.id, files, mock: false }); } catch (e) { c.planError = errMsg(e); }
    c.planning = false;
    if (cur === c) render();
  }

  /** A click inside the tab; true when it was the tab's. */
  function onClick(e) {
    if (!cur) return false;
    const days = e.target.closest('[data-pcm-days]');
    if (days) { Object.assign(view, { days: +days.dataset.pcmDays, from: null, to: null }); persist(); load(); return true; }
    if (e.target.closest('[data-pcm-refresh]')) { load(); return true; }
    if (e.target.closest('[data-pcm-plan]')) { askPlan(); return true; }
    const issue = e.target.closest('[data-pcm-issue]');
    if (issue) { createIssue(issue.dataset.pcmIssue); return true; }
    const row = e.target.closest('[data-pcm-row]');
    if (row) { cur.open = cur.open === row.dataset.pcmRow ? null : row.dataset.pcmRow; render(); return true; }
    return false;
  }

  /** A change of the range's dates or of the marker; true when it was the tab's. */
  function onChange(e) {
    const from = e.target.closest('[data-pcm-from]');
    const to = e.target.closest('[data-pcm-to]');
    if (from || to) {
      const r = range();
      Object.assign(view, { days: null, from: from ? e.target.value || null : r.from, to: to ? e.target.value || null : r.to });
    } else if (e.target.closest('[data-pcm-marker]')) view.marker = e.target.value.trim();
    else return false;
    persist();
    load();
    return true;
  }

  /** The one-line link to project `id`'s Conflict map tab (the header's project by default); '' with no project. */
  function linkHtml(id = window.CurrentProject?.get()) {
    const p = (state.projects || []).find((x) => x.id === id);
    if (!p) return '';
    return `<p class="pcm-link small"><button type="button" class="link-btn" data-testid="conflict-map-link" data-pcm-link="${esc(p.id)}" title="${t('project_conflict_map.the_files_runs_collide_on_moved')}">${t('project_conflict_map.conflict_map_in_projects')} ${esc(p.name)}</button></p>`;
  }

  /** A click on the link opens the project's page on its Conflict map tab; true when it was the link. */
  function onLinkClick(e) {
    const link = e.target.closest('[data-pcm-link]');
    if (!link) return false;
    openProjectView(link.dataset.pcmLink, { tab: 'conflicts' });
    return true;
  }

  window.ProjectConflictMap = {
    linkHtml,
    mergeRows,
    onChange,
    onClick,
    onLinkClick,
    show,
  };
})();
