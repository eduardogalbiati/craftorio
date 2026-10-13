// A project's Conflict map tab (#354): one table merging the Roadmap's former Conflict map panel
// (#150: the saved map of src/conflict-map.js, the Backlog payload's `conflictMap`, read-only) and
// Analytics › Performance's former "Files most runs edit" (#159, channel analytics:performance,
// src/repo-performance.js). A row per file, ranked by how many runs edited it: its run count and
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
  const plural = (n, unit) => `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`;

  // more than half of the map's newest 20 runs (src/conflict-map.js hotSpots)
  function isHot(map, runIds) {
    const recent = new Set((map?.runIds || []).slice(0, HOT_WINDOW));
    const n = (runIds || []).filter((id) => recent.has(id)).length;
    return recent.size > 0 && n > 1 && n / recent.size > 0.5;
  }

  // the newer half of the map's runs against the older half
  function trend(map, runIds) {
    const all = map?.runIds || [];
    const half = Math.floor(all.length / 2);
    if (half < 2 || !runIds) return 'Trend: not enough runs in the conflict map yet';
    const newer = new Set(all.slice(0, half));
    const older = new Set(all.slice(half, half * 2));
    const count = (set) => runIds.filter((id) => set.has(id)).length;
    return `Trend: ${count(older)} of the older ${half} → ${count(newer)} of the newest ${half} runs`;
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
    const day = (n) => `<button type="button" class="${view.days === n ? 'active' : ''}" data-pcm-days="${n}" aria-pressed="${view.days === n}">${n} days</button>`;
    return `<div class="row pcm-controls" data-testid="project-conflict-controls">
      <div class="seg sm" role="group" aria-label="Quick range">${day(7)}${day(30)}${day(90)}</div>
      <label class="an-date small muted">From <input type="date" data-pcm-from value="${esc(r.from)}" /></label>
      <label class="an-date small muted">To <input type="date" data-pcm-to value="${esc(r.to)}" /></label>
      <label class="an-date small muted" title="A date (YYYY-MM-DD) or a commit of the repository: the range's numbers are split into before and after it">Before/after <input type="text" class="an-marker" data-pcm-marker value="${esc(view.marker)}" placeholder="date or commit" /></label>
      <button type="button" class="btn" data-pcm-refresh ${cur?.loading ? 'disabled' : ''}>Refresh</button>
      ${over ? `<button type="button" class="btn" data-pcm-plan data-testid="pcm-plan" ${cur.planning ? 'disabled' : ''} title="The supervisor suggests a plan for the ${over} file(s) over ${pct(cur.perf.sharedLimit)} (a real model call: it asks first)">${cur.planning ? 'Asking…' : 'Ask for a plan'}</button>` : ''}
    </div>`;
  }

  function planHtml() {
    if (cur.planning) return '<div class="card an-card an-report"><p class="muted">The supervisor is reading the files over the limit… this can take a few minutes.</p></div>';
    if (cur.planError) return `<div class="usage-unavailable" role="alert">The plan failed: ${esc(cur.planError)}</div>`;
    if (!cur.plan) return '';
    return `<div class="card an-card an-report"><div class="md">${markdownHtml(cur.plan.markdown || '')}</div>${cur.plan.reportPath ? `<p class="muted small">Saved in ${esc(cur.plan.reportPath)}${cur.plan.costUsd ? ` · ${fmtUsd(cur.plan.costUsd)}` : ''}</p>` : ''}</div>`;
  }

  // #197: what to do with a file over the shared limit, and its issue (open or to create)
  const REC_LABEL = { generated: 'Generated', registry: 'Registry', large: 'Large file', stylesheet: 'Stylesheet', doc: 'Doc', test: 'Test file', hotspot: 'Hot spot' };
  function recommendationHtml(f) {
    const r = f?.recommendation;
    if (!r) return '';
    const issue = (cur.issues || []).find((i) => `${i.title || ''}\n${i.body || ''}`.includes(f.file));
    const action = issue
      ? `<a href="#" class="link-btn" data-pr-url="${esc(issue.url || '')}" title="${esc(issue.title || '')}">Open issue #${esc(issue.number)}</a>`
      : `<button type="button" class="btn sm ghost" data-pcm-issue="${esc(f.file)}" data-testid="pcm-create-issue">Create issue</button>`;
    return `<div class="an-rec" data-testid="pcm-recommendation"><span class="badge warn">${esc(REC_LABEL[r.kind] || r.kind)}</span> <span>${esc(r.text)}</span><div class="an-rec-actions">${action}</div></div>`;
  }

  function detailHtml(r) {
    const map = cur.map;
    const runIds = r.map?.runIds || null;
    const lines = (map?.lines || []).filter((l) => l.file === r.file);
    const runs = runIds?.length
      ? `<div class="pcm-ids">${runIds.map((id) => `<span class="badge mono" title="${esc(id)}">${esc(id)}</span>`).join('')}</div>`
      : '<span class="muted">The saved conflict map has no run of this file (the count is the range\'s).</span>';
    const lineList = lines.length
      ? `<ul class="pcm-lines">${lines.map((l) => `<li><span class="mono">${esc(`${l.file}:${l.line}`)}</span> <span class="mono muted pcm-line-text" title="${esc(l.text || '')}">${esc(l.text || '')}</span> <span class="badge">${plural((l.runIds || []).length, 'runs')}</span></li>`).join('')}</ul>`
      : '<span class="muted">No single line of this file was changed by several runs.</span>';
    return `<tr class="pcm-detail-row"><td colspan="5"><div class="pcm-detail small" data-testid="project-conflict-detail">
      <div><b>Runs behind the count</b> <span class="muted">(the saved conflict map${map?.runs ? `, last ${plural(map.runs, 'finished runs')}` : ''})</span>${runs}</div>
      <div><b>Lines most changed</b>${lineList}</div>
      <div class="muted">${esc(trend(map, runIds))}</div>
      ${recommendationHtml(r.perf)}
    </div></td></tr>`;
  }

  function tableHtml(rows, limit) {
    const map = cur.map;
    return `<table class="u-table an-sessions an-files pcm-table"><thead><tr><th>File</th><th class="num" title="In the range; a file only the saved conflict map has counts the map's runs">Runs that edited it</th><th class="num">% of runs</th><th>Merge conflicts</th><th class="num">Lines now</th></tr></thead><tbody>
      ${rows.map((r) => {
        const open = cur.open === r.file;
        const hot = isHot(map, r.map?.runIds);
        const over = r.perf && r.runs > 1 && r.share > limit;
        return `<tr class="pcm-row" data-testid="project-conflict-row" data-pcm-row="${esc(r.file)}" aria-expanded="${open}" tabindex="0" title="${esc(r.file)}: click to see the runs, the lines and the trend">
          <td class="an-title"><span class="an-file mono">${esc(r.file)}</span>${hot ? ' <span class="badge warn" title="Changed by more than half of the newest runs: the Product Owner sends groups that touch it to different stages">hot</span>' : ''}${r.perf?.generated ? ' <span class="badge" title="A tool writes this file (a generated list)">generated</span>' : ''}</td>
          <td class="num">${r.runs}</td>
          <td class="num">${over ? `<span class="badge warn" title="More than ${pct(limit)} of the runs edit it">${pct(r.share)}</span>` : pct(r.share)}</td>
          <td>${r.conflicts ? `<span class="badge" title="Merge conflicts that named this file">${plural(r.conflicts, 'conflicts')}</span>` : '<span class="muted small">none</span>'}</td>
          <td class="num">${r.perf ? (r.perf.lines == null ? '<span class="badge" title="No longer in the repository">deleted</span>' : fmtNum(r.perf.lines)) : '—'}</td>
        </tr>${open ? detailHtml(r) : ''}`;
      }).join('')}</tbody></table>`;
  }

  function bodyHtml() {
    if (cur.error) return `<div class="usage-unavailable" role="alert">Could not load the conflict map: ${esc(cur.error)}</div>`;
    const p = cur.perf;
    if (cur.loading || !p) return '<p class="muted" role="status">Loading…</p>';
    if (!p.project) return '<div class="empty-state"><b>No project</b><p class="muted">Add a project with a git repository: its runs\' commits are measured here.</p></div>';
    const notGit = p.project.isGit === false ? `<div class="usage-unavailable">${esc(p.project.name)}'s folder is not a git repository: the files runs edit cannot be read.</div>` : '';
    const mapNote = cur.mapError ? `<p class="muted small">The saved conflict map could not be read: ${esc(cur.mapError)}</p>` : '';
    const rows = mergeRows(p.empty ? null : p, cur.map);
    if (!rows.length) {
      return `${notGit}${mapNote}${p.project.isGit === false ? '' : '<div class="empty-state"><b>No runs with commits on this repository in this range</b><p class="muted">Runs count once their work is merged (a local merge or a merged PR/MR); simulated runs never count. Try a longer range.</p></div>'}`;
    }
    const of = `${p.empty ? 'No run with commits in this range: the counts are the saved conflict map\'s' : `Of ${plural(p.runsWithCommits, 'runs with commits')}, ${esc(p.from)} to ${esc(p.to)}; each run counts once per file`}`;
    return `${notGit}${mapNote}<p class="muted small">${of}${cur.map?.runs ? ` · the conflict map covers the last ${plural(cur.map.runs, cur.map.source === 'git' ? 'commits of the branch' : 'finished runs')}` : ''}</p>
      <div id="pcm-plan-box">${planHtml()}</div>
      <div class="card table-wrap">${tableHtml(rows, p.sharedLimit)}</div>`;
  }

  function render() {
    if (!cur?.box) return;
    const over = cur.perf && !cur.loading && !cur.error ? (cur.perf.files || []).filter((f) => f.recommendation).length : 0;
    cur.box.innerHTML = `${controlsHtml(over)}${bodyHtml()}`;
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
    if (!window.confirm(`The supervisor (Claude Code) will read the ${files.length} file(s) over the limit and their recommendations, and suggest a plan. This calls a real model and costs money. Continue?`)) return;
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
    return `<p class="pcm-link small"><button type="button" class="link-btn" data-testid="conflict-map-link" data-pcm-link="${esc(p.id)}" title="The files runs collide on moved to the project's page">Conflict map: in Projects › ${esc(p.name)}</button></p>`;
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
