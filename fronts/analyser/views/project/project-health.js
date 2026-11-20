// A project's Health tab (#730: the git facts and the Oracle's findings, in place of the Architecture
// tab's Facts and of the Refactor tab), written for a human reader (#386, the pure parts in
// packages/shared/architecture-facts-view.js). A lead row answers "how is this project?" (the report's
// verdict in one line, the top 3 risks with their 0-100 score, the Danger Zone count, the languages as
// GitHub's bar and legend). Then, on top, the git facts (architecture:facts, free, no model; numbers
// from packages/shared/architecture-model.js), titled with an ⓘ that opens what the numbers cannot
// tell: the commit, window, mass changes and shallow clone, the project's own quality gate as one row of
// chips, the exclusions in one line (editable, architecture:setExclude), the complexity in one line
// whose "How to measure" names the code languages not measured and how to install lizard (#385), the
// hotspot table (file, lines, commits, rank, top co-changing file; complexity, worst function and
// quadrant when measured, "—" for a file not measured, never 0), the Danger Zone scatter, its formula
// and the monthly frames on demand. Below them the latest Oracle report (or the one picked): its summary,
// the verdict per area as chips (data-testid="architecture-verdict"), the findings ranked by score, one
// line each (score on a bar coloured by severity, target, one sentence, new / kept) with "Read more" for
// the evidence and the refactor, filters by severity and new / kept with their counts, the gone ones
// folded. A finding becomes an issue (#730, architecture:createIssue): "Create issue" files a refactor
// issue with the finding's text, files and evidence; "Create issue and prioritize" also adds it to the
// roadmap's waiting stage (#435); once filed the finding shows its issue's link and its stage instead of
// the buttons. "Create issues" files the findings shown (the filters' selection), one after the other,
// not prioritized. A finding's Refactor proposal of before #730 stays readable under it.
// Last, "Run the report again" (architecture:analyze, the Oracle's turn only, the city is the City
// tab's) with its estimate (architecture:estimate, past real analyses).
// Controls: the report picker, the From / To range and the mass-change toggle. States: not a git
// repository, no commits in the range, never analysed, a report (with "N runs since this analysis") and
// an error with its message. The city's "Open in Facts" opens this tab with its hotspot row marked
// (focus(id, file)).
// Drawn into the box project.js gives it (show), its clicks and changes routed from the project page's
// listeners (onClick, onChange). Uses app.js globals at call time: api, esc, errMsg, fmtNum, fmtUsd
// (usage-widget.js), showToast, state (simulationOnly). Browser: window.ProjectHealth.
(() => {
  const TABLE_ROWS = 40;
  const STALE_RUNS = 5;
  const LIMITS = [
    'Churn from a planned migration looks like instability: a file moved to a new API in ten commits is not unstable.',
    'Complexity tools disagree with each other: one metric per chart, from one tool, and never compared across tools.',
    'Code moved between files resets both metrics: the new file starts with no history and the old one disappears.',
    'Churn says nothing about bugs unless it is joined with fix commits: a busy file is not a buggy file.',
  ];
  // the project on screen: { id, box, facts, view, reports, estimate, error, loadError, loading, reportId, since, until, includeMass,
  // editing, seq, filter, expanded, caveats, creating (a Create issue in flight), rerunning, focusFile (a City card's file) }
  let cur = null;
  let pendingFocus = null; // { id, file }: the file the city's "Open in Facts" asked to mark

  const plural = (n, key) => t(key, { count: n });
  const day = (iso) => String(iso || '').slice(0, 10);
  const short = (sha) => String(sha || '').slice(0, 10);

  // ---------- the report and its findings (#386: ArchitectureFactsView) ----------

  const dangerZone = () => cur.facts?.model?.danger_zone || [];
  const ranked = () => ArchitectureFactsView.rankFindings(cur.view?.findings || [], dangerZone());
  const shownFindings = () => ArchitectureFactsView.filterFindings(ranked(), cur.filter);
  const severityClass = (s) => (['high', 'medium', 'low'].includes(s) ? `sev-${s}` : 'sev-low');
  const filePaths = (f) => (f.files || []).map((x) => x.path).join(', ');
  const target = (f) => {
    const files = f.files || [];
    return files.length ? `${files[0].path}${files.length > 1 ? ` +${files.length - 1}` : ''}` : f.kind || '';
  };
  const findingSummary = (f) => ArchitectureFactsView.firstSentence(f.title || f.evidence || f.kind);
  // a finding's new / kept / gone in the interface language (#447)
  const statusLabel = (s) => ({ gone: t('project_architecture.status_gone'), kept: t('project_architecture.status_kept'), new: t('project_architecture.status_new') })[s] ?? esc(s || '');
  // where a filed finding is on the roadmap (#435): its stage, '' when not prioritized
  const stageText = (filed) => (filed?.stage == null ? '' : t(filed.waiting ? 'common.refactor_where_waiting' : 'common.refactor_where', { issue: filed.issue, stage: filed.stage }));

  // Create issue / Create issue and prioritize; once filed, the issue's link and its stage (#730)
  function issueHtml(f) {
    if (!f.filed) {
      const busy = cur.creating ? 'disabled' : '';
      return `<button type="button" class="btn sm" data-testid="architecture-create-issue" data-arch-create="${f.index}" ${busy} title="${esc(t('project_architecture.create_issue_title'))}">${t('project_architecture.create_issue')}</button>`
        + `<button type="button" class="btn sm" data-testid="architecture-create-issue-prioritize" data-arch-create="${f.index}" data-prioritize ${busy} title="${esc(t('project_architecture.create_issue_prioritize_title'))}">${t('project_architecture.create_issue_prioritize')}</button>`;
    }
    const n = `#${f.filed.issue}`;
    const link = f.filed.issueUrl ? `<a class="small arch-sent-where" data-testid="architecture-finding-issue" href="${esc(f.filed.issueUrl)}" target="_blank" rel="noopener">${esc(n)}</a>`
      : `<span class="small arch-sent-where" data-testid="architecture-finding-issue">${esc(n)}</span>`;
    const stage = stageText(f.filed);
    return link + (stage ? `<span class="badge" data-testid="architecture-finding-stage" title="${esc(stage)}">${esc(stage)}</span>` : '');
  }

  // a Refactor proposal made from this finding before #730, readable until migrated
  // (#435: its issue as a link, and its roadmap stage when it has one)
  function proposalHtml(p) {
    if (!p) return '';
    const where = esc(stageText(p.where) || `#${p.issue}`);
    const link = p.issueUrl ? `<a data-testid="architecture-refactor-where" href="${esc(p.issueUrl)}" target="_blank" rel="noopener" title="${where}">${where}</a>` : `<span data-testid="architecture-refactor-where">${where}</span>`;
    const issue = p.issue ? ` <span data-testid="refactor-proposal-where">${link}</span>` : '';
    return `<div class="small muted arch-finding-proposal" data-testid="architecture-finding-proposal">${t('project_architecture.finding_proposal')} <span title="${esc(p.title)}">${esc(p.title)}</span> <span class="badge">${esc(p.status || '')}</span>${issue}</div>`;
  }

  // a finding: one line (its score on a bar coloured by its severity, its target, one sentence,
  // new / kept), "Read more" opens the evidence and the refactor
  function findingHtml(f, key) {
    const gone = f.status === 'gone';
    const open = cur.expanded.has(key);
    const files = (f.files || []).map((x) => `<span class="mono" title="${esc(x.path)}">${esc(x.lines ? `${x.path}:${x.lines}` : x.path)}</span>`).join(', ');
    return `<li class="arch-finding arch-row ${severityClass(f.severity)}${gone ? ' arch-gone' : ''}" data-testid="${gone ? 'architecture-finding-gone' : 'architecture-finding'}">
      <span class="arch-score" data-testid="architecture-finding-score" title="${esc(`${f.severity || 'no'} severity. ${ArchitectureFactsView.SCORE_FORMULA}`)}">${f.score}</span>
      <div class="arch-finding-body">
        <div class="arch-finding-line"><span class="mono arch-target" title="${esc(filePaths(f))}">${esc(target(f))}</span>
          <span class="arch-finding-summary" data-testid="architecture-finding-summary" title="${esc(f.title || '')}">${esc(findingSummary(f))}</span>
          <span class="badge${f.status === 'new' ? ' live' : ''}" data-testid="architecture-finding-status">${statusLabel(f.status)}</span>
          <button type="button" class="link-btn" data-testid="architecture-finding-more" data-arch-more="${esc(key)}" aria-expanded="${open}">${open ? t('project_architecture.read_less') : t('project_architecture.read_more')}</button>${gone ? '' : issueHtml(f)}</div>
        ${proposalHtml(f.proposal)}
        <div class="arch-finding-details small${open ? '' : ' hidden'}" data-testid="architecture-finding-details">
          <div class="row"><span class="badge${f.severity === 'high' ? ' warn' : ''}">${esc(f.severity)}</span><span class="badge mono">${esc(f.kind)}</span>${files}</div>
          <p class="muted">${esc(f.evidence)}</p>
          <p><b>${t('project_architecture.refactor')}</b> ${esc(f.refactor)}</p>
        </div>
      </div>
    </li>`;
  }

  // the filters by severity and by new / kept, with their counts, and "Create issues" for the ones shown
  function findingsToolbarHtml(all) {
    const counts = ArchitectureFactsView.findingCounts(all);
    const b = (dim, key, n) => {
      const on = key === 'all' ? !cur.filter.severity && !cur.filter.status : cur.filter[dim] === key;
      return `<button type="button" class="${on ? 'active' : ''}" data-arch-filter="${dim}:${key}" data-testid="architecture-filter-${key}" aria-pressed="${on}">${key === 'all' ? t('project_architecture.all') : key.charAt(0).toUpperCase() + key.slice(1)} <span class="muted">${n}</span></button>`;
    };
    const left = shownFindings().filter((f) => !f.filed).length;
    const title = left ? t('project_architecture.create_issues_title', { count: left }) : t('project_architecture.create_issues_none_left');
    return `<div class="row arch-toolbar">
      <div class="seg" role="group" aria-label="${t('project_architecture.filter_by_severity')}">${b('', 'all', all.length)}${['high', 'medium', 'low'].map((k) => b('severity', k, counts.severity[k])).join('')}</div>
      <div class="seg" role="group" aria-label="${t('project_architecture.filter_by_new_or_kept')}">${['new', 'kept'].map((k) => b('status', k, counts.status[k])).join('')}</div>
      <span class="spacer"></span>
      <button type="button" class="btn sm" data-testid="architecture-create-issues" data-arch-create-all ${left && !cur.creating ? '' : 'disabled'} title="${esc(title)}">${t('project_architecture.create_issues')}</button>
    </div>`;
  }

  function reportMeta(saved, view) {
    const cost = saved.simulated ? `<span class="badge p-mock">${t('project_architecture.simulated')}</span>` : saved.costUsd != null ? `<span class="badge" title="${t('project_architecture.the_real_cost_of_this_analysis')}">${esc(fmtUsd(saved.costUsd))}</span>` : '';
    const tokens = saved.tokens && Object.keys(saved.tokens).length ? `<span class="badge" title="${t('project_architecture.tokens_tokens', { tokens: esc(JSON.stringify(saved.tokens)) })}">${fmtNum(Object.values(saved.tokens).reduce((s, n) => s + (Number(n) || 0), 0))} ${t('project_architecture.tokens')}</span>` : '';
    const since = view.runsSince ? `<span class="badge${STALE_RUNS <= view.runsSince ? ' warn' : ''}" data-testid="architecture-runs-since">${plural(view.runsSince, 'project_architecture.runs_since_this_analysis')}</span>` : '';
    return `<div class="row small muted arch-meta">${t('project_architecture.analysed_date_at', { date: esc(day(saved.date)) })} ${esc(short(saved.head?.commit))} ${cost}${tokens}${since}</div>`;
  }

  function reportHtml() {
    const view = cur.view;
    const saved = view.report;
    const areas = (saved.report.areas || []).map((a) => `<span class="arch-area-chip" data-testid="architecture-verdict" title="${esc(`${a.area}: ${a.verdict}`)}"><b>${esc(a.area)}</b> ${esc(a.verdict)}</span>`).join('');
    const all = ranked();
    const shown = shownFindings();
    const findings = shown.map((f) => findingHtml(f, `f${f.index}`)).join('') || `<li class="muted">${all.length ? t('project_architecture.no_finding_matches_the_filter') : t('project_architecture.no_finding')}</li>`;
    const goneList = ArchitectureFactsView.rankFindings(view.gone, dangerZone());
    const gone = goneList.length ? `<details class="arch-gone-list"><summary class="small muted">${t('project_architecture.gone_since_the_previous_report_length', { length: goneList.length })}</summary><ul class="arch-findings">${goneList.map((f) => findingHtml(f, `g${f.index}`)).join('')}</ul></details>` : '';
    return `<section class="card arch-report" data-testid="architecture-report">
      ${reportMeta(saved, view)}
      <p class="arch-summary" data-testid="architecture-report-summary" title="${esc(saved.report.summary)}">${esc(saved.report.summary)}</p>
      ${areas ? `<div class="row arch-areas small">${areas}</div>` : ''}
      ${findingsToolbarHtml(all)}
      <ul class="arch-findings" data-testid="architecture-findings">${findings}</ul>
      ${gone}
    </section>`;
  }

  function stateHtml() {
    if (cur.view?.report) return reportHtml();
    return `<div class="empty-state" data-testid="architecture-state-never"><b>${t('project_architecture.never_analysed')}</b><p class="muted">${t('project_architecture.the_facts_above_come_from_git')}</p></div>`;
  }

  // "Run the report again": the Oracle's turn on the saved city, with its estimate (#730)
  function rerunHtml() {
    const e = cur.estimate;
    const estimate = e ? `≈ US$ ${Number(e.usd).toFixed(2)}` : t('project_architecture.no_estimate_yet');
    const title = e ? t('project_architecture.estimate_oracle', { count: e.basis, usd: Number(e.usd).toFixed(2) }) : t('project_architecture.rerun_title');
    const error = cur.error ? `<div class="usage-unavailable" role="alert" data-testid="architecture-state-error">${esc(cur.error)}</div>` : '';
    return `<section class="arch-action" data-testid="architecture-rerun">
      <div class="row"><button type="button" class="btn" data-testid="architecture-rerun-report" data-arch-rerun ${cur.rerunning ? 'disabled' : ''} title="${esc(title)}">${t(cur.rerunning ? 'project_architecture.rerunning' : 'project_architecture.rerun_report')} <span class="arch-estimate" data-testid="architecture-rerun-estimate">${esc(estimate)}</span></button></div>
      ${error}
    </section>`;
  }

  // ---------- the lead row (#386): the verdict, the top 3 risks, the Danger Zone count, the languages ----------

  function languagesHtml(languages) {
    const shares = ArchitectureFactsView.languageShares(languages);
    if (!shares.length) return `<p class="small muted">${t('project_architecture.no_code_counted')}</p>`;
    const tip = (s) => `${fmtNum(s.lines)} lines${s.others?.length ? ` (${s.others.join(', ')})` : ''}`;
    const segments = shares.map((s) => `<span class="arch-lang-seg" data-testid="architecture-language-segment" style="width:${s.percent}%;background-color:${s.color}" title="${esc(`${s.language} ${s.percent}%`)}"></span>`).join('');
    const legend = shares.map((s) => `<li data-testid="architecture-language-entry" title="${esc(tip(s))}"><span class="arch-lang-dot" style="background-color:${s.color}"></span><span>${esc(s.language)}</span> <span class="muted">${s.percent}%</span></li>`).join('');
    return `<div class="arch-lang-bar" data-testid="architecture-languages-bar" role="img" aria-label="${esc(`Languages: ${shares.map((s) => `${s.language} ${s.percent}%`).join(', ')}`)}">${segments}</div>
      <ul class="arch-lang-legend small" data-testid="architecture-language-legend">${legend}</ul>`;
  }

  function verdictHtml() {
    const summary = cur.view?.report?.report?.summary;
    if (!summary) return `<p class="arch-verdict muted" data-testid="architecture-verdict">${t('project_architecture.not_analysed_yet_run_the_report')}</p>`;
    return `<p class="arch-verdict" data-testid="architecture-verdict" title="${esc(summary)}">${esc(ArchitectureFactsView.firstSentence(summary))}</p>`;
  }

  function overviewHtml(model) {
    const cards = ranked().slice(0, 3).map((f) => `<div class="arch-risk-card ${severityClass(f.severity)}" data-testid="architecture-risk-card" title="${esc(f.title || '')}">
      <span class="arch-score" data-testid="architecture-risk-score" title="${esc(ArchitectureFactsView.SCORE_FORMULA)}">${f.score}</span>
      <div class="arch-risk-text"><span class="arch-risk-title">${esc(findingSummary(f))}</span><span class="mono small muted">${esc(target(f))}</span></div></div>`).join('');
    const measured = model?.complexity?.status === 'measured';
    const count = measured ? `<b class="arch-ov-num">${fmtNum(model.danger_zone.length)}</b> <span class="small muted">${t('project_architecture.files_in_the_danger_zone')}</span>`
      : `<b class="arch-ov-num">—</b> <span class="small muted">${t('project_architecture.danger_zone_complexity_not_measured')}</span>`;
    return `<section class="arch-overview" data-testid="architecture-overview">
      ${verdictHtml()}
      <div class="arch-ov-row">
        <div class="arch-risks">${cards || `<p class="small muted">${t('project_architecture.no_risk_yet_the_report_s')}</p>`}</div>
        ${model ? `<div class="card arch-ov-tile" data-testid="architecture-danger-count" title="${t('project_architecture.files_both_complex_and_changing_often')}">${count}</div>
        <div class="card arch-ov-tile arch-ov-langs">${languagesHtml(model.languages)}</div>` : ''}
      </div>
    </section>`;
  }

  function controlsHtml() {
    const reports = cur.reports || [];
    const picker = reports.length ? `<label class="an-date small muted">${t('project_architecture.report')} <select data-arch-report data-testid="architecture-report-picker">${reports.map((r) => `<option value="${esc(r.id)}" ${r.id === (cur.view?.report?.id) ? 'selected' : ''}>${esc(day(r.date))} · ${plural(r.findings, 'project_architecture.findings_count')}${r.simulated ? ` (${t('project_architecture.simulated')})` : ''}</option>`).join('')}</select></label>` : '';
    return `<div class="row pcm-controls" data-testid="architecture-controls">
      ${picker}
      ${window.DateRange.fields({ testid: 'architecture-date-range', from: cur.since || '', to: cur.until || '', fromAttrs: 'data-arch-since', toAttrs: 'data-arch-until' })}
      <label class="check small" title="${t('project_architecture.commits_that_touched_more_than_25')}"><input type="checkbox" data-arch-mass ${cur.includeMass ? 'checked' : ''} /><span>${t('project_architecture.count_mass_changes')}</span></label>
      <button type="button" class="btn" data-arch-refresh ${cur.loading ? 'disabled' : ''}>${t('project_architecture.refresh')}</button>
    </div>`;
  }

  // ---------- the git facts ----------

  function complexityCells(r, measured) {
    if (!measured) return '';
    return `<td class="num">${r.complexity ?? '—'}</td><td class="num">${r.worst ?? '—'}</td><td>${r.quadrant ? `<span class="${window.ArchitectureModel.quadrantBadge(r.quadrant)}">${esc(r.quadrant)}</span>` : '—'}</td>`;
  }

  function hotspotsHtml(model) {
    const measured = model.complexity.status === 'measured';
    // the file a City card opened: marked, and listed even below the top rows
    const top = model.files.slice(0, TABLE_ROWS);
    const focus = cur.focusFile && !top.some((r) => r.file === cur.focusFile) ? model.files.filter((r) => r.file === cur.focusFile) : [];
    const rows = [...top, ...focus].map((r) => `<tr data-arch-file="${esc(r.file)}"${r.file === cur.focusFile ? ' class="arch-focus" data-testid="architecture-focus-row"' : ''}>
      <td class="an-title"><span class="an-file mono" title="${esc(r.file)}">${esc(r.file)}</span> <span class="muted small">${esc(r.language)}</span></td>
      <td class="num">${fmtNum(r.lines)}</td><td class="num">${r.commits}</td><td class="num">${r.rank}</td>
      <td>${r.co_change ? `<span class="mono small" title="${esc(r.co_change.file)}">${esc(r.co_change.file)}</span> <span class="badge">${Math.round(r.co_change.share * 100)}%</span>` : `<span class="muted small">${t('project_architecture.none')}</span>`}</td>
      ${complexityCells(r, measured)}</tr>`).join('');
    const head = `<th>${t('project_architecture.file')}</th><th class="num">${t('project_architecture.lines')}</th><th class="num">${t('project_architecture.commits')}</th><th class="num" title="${t('project_architecture.lines_commits_highest_first')}">${t('project_architecture.hotspot_rank')}</th><th>${t('project_architecture.changes_most_with')}</th>${measured ? `<th class="num">${t('project_architecture.complexity')}</th><th class="num">${t('project_architecture.worst_function')}</th><th>${t('project_architecture.quadrant')}</th>` : ''}`;
    const more = model.files.length > TABLE_ROWS ? `<p class="muted small">${t('project_architecture.the_top_table_rows_of_length', { TABLE_ROWS, length: model.files.length })}</p>` : '';
    return `<h3 class="arch-sub">${t('project_architecture.hotspots')}</h3><div class="card table-wrap"><table class="u-table an-sessions an-files" data-testid="architecture-hotspots"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${more}`;
  }

  function scatterHtml(model) {
    const rows = model.files.filter((r) => r.quadrant);
    const maxU = Math.max(0, ...rows.map((r) => Math.log1p(r.complexity)));
    const maxV = Math.max(0, ...rows.map((r) => Math.log1p(r.commits)));
    const x = (r) => 20 + 360 * (maxV ? Math.log1p(r.commits) / maxV : 0);
    const y = (r) => 200 - 180 * (maxU ? Math.log1p(r.complexity) / maxU : 0);
    const dots = rows.map((r) => `<circle cx="${x(r).toFixed(1)}" cy="${y(r).toFixed(1)}" r="4" class="${r.quadrant === 'Danger Zone' ? 'arch-dot-danger' : 'arch-dot'}"><title>${esc(t('project_architecture.file_complexity_complexity_commits_commits_quadr', { file: r.file, complexity: r.complexity, commits: r.commits, quadrant: r.quadrant }))}</title></circle>`).join('');
    const frames = (model.frames || []).filter((f) => f.entered.length || f.left.length).map((f) => `<li><b>${esc(f.month)}</b> ${f.entered.length ? `entered: ${f.entered.map((n) => `<span class="mono">${esc(n)}</span>`).join(', ')}` : ''}${f.left.length ? ` left: ${f.left.map((n) => `<span class="mono">${esc(n)}</span>`).join(', ')}` : ''}</li>`).join('');
    return `<h3 class="arch-sub" title="${esc(t('project_architecture.metric_complexity_from_tool', { metric: model.complexity.metric, tool: model.complexity.tool }))}">${t('project_architecture.quadrants')}</h3>
      <svg class="arch-scatter" viewBox="0 0 400 220" role="img" aria-label="${t('project_architecture.commits_against_complexity_log1p_axes')}"><line x1="20" y1="200" x2="390" y2="200" class="arch-axis"/><line x1="20" y1="10" x2="20" y2="200" class="arch-axis"/>${dots}<text x="390" y="214" text-anchor="end" class="arch-label">${t('project_architecture.commits_2')}</text><text x="24" y="16" class="arch-label">${t('project_architecture.complexity_2')}</text></svg>
      <details class="small muted"><summary>${t('project_architecture.how_the_quadrants_are_computed')}</summary><p>${t('project_architecture.split_at_the_medians_danger_zone')} <span class="mono">${t('project_architecture.score_u_v')}</span>${t('project_architecture.u_log1p_complexity_its_maximum_v')}</p></details>
      ${frames ? `<details class="small"><summary class="muted">${t('project_architecture.monthly_frames_files_that_entered_or')}</summary><p class="muted">${t('project_architecture.each_frame_uses_the_churn_up')}</p>
      <ul class="small arch-frames" data-testid="architecture-frames">${frames}</ul></details>` : ''}`;
  }

  // the languages measured: those with a file a parser or tool measured
  function complexityText(model) {
    const measured = new Set(model.files.filter((r) => r.complexity != null).map((r) => r.language));
    return ArchitectureFactsView.complexityLine(model.complexity, model.languages.filter((l) => measured.has(l.language)));
  }

  // The complexity note in one line (#386); the code languages no file of which is measured and how
  // to measure them (#385: JavaScript and TypeScript are measured inside the app, the others need
  // lizard, which needs Python) open from "How to measure"
  function complexityHtml(model) {
    const c = model.complexity;
    const line = esc(complexityText(model));
    // #847: the title and the "how to measure" texts from i18n
    const title = esc(c.status === 'measured' ? t('project_architecture.metric_complexity_from_tool', { metric: c.metric, tool: c.tool })
      : t('project_architecture.complexity_not_measured_meanwhile', { reason: c.reason || t('project_architecture.not_measured') }));
    if (!c.unmeasured?.length) return `<p class="small muted" data-testid="architecture-complexity" title="${title}">${line}</p>`;
    const names = c.unmeasured.map((l) => `<span class="badge" data-testid="architecture-unmeasured-language">${esc(l)}</span>`).join(' ');
    const how = c.install
      ? `${t('project_architecture.to_measure_install_lizard')} <span class="mono">${esc(c.install)}</span> ${t('project_architecture.lizard_needs_python')}`
      : t('project_architecture.they_need_tools', { tools: esc((c.needed || []).join(', ') || 'lizard'), reason: c.reason ? ` (${esc(c.reason)})` : '' });
    return `<details class="small muted arch-measure" data-testid="architecture-measure-note"><summary title="${title}"><span data-testid="architecture-complexity">${line}</span> · <span class="link-btn">${t('project_architecture.how_to_measure')}</span></summary>
      <p>${t('project_architecture.complexity_not_measured_for_names_their', { names })} ${how}</p></details>`;
  }

  // #847: the exclusion groups' labels, i18n keys
  const EXCLUDED_LABELS = {
    build: 'project_architecture.excluded_build',
    generated: 'project_architecture.excluded_generated',
    lock: 'project_architecture.excluded_lock',
    project: 'project_architecture.excluded_project',
    tests: 'project_architecture.excluded_tests',
    vendored: 'project_architecture.excluded_vendored',
  };

  function excludeHtml(model) {
    const groups = Object.entries(model.excluded).filter(([, n]) => n).map(([g, n]) => `${esc(EXCLUDED_LABELS[g] ? t(EXCLUDED_LABELS[g]) : g)} ${fmtNum(n)}`).join(' · ') || t('project_architecture.excluded_nothing');
    const list = cur.facts.exclude || [];
    if (cur.editing) {
      return `<div class="card arch-edit" data-testid="architecture-exclude-form"><label class="field">${t('project_architecture.excluded_paths_one_pattern_per_line')}<textarea rows="4" data-arch-exclude-text spellcheck="false">${esc(list.join('\n'))}</textarea></label>
        <p class="hint">${t('project_architecture.gitignore_style_patterns_docs_generated_ts')}</p>
        <div class="row"><button type="button" class="btn primary" data-arch-exclude-save>${t('common.save')}</button><button type="button" class="btn ghost" data-arch-exclude-cancel>${t('common.cancel')}</button></div></div>`;
    }
    return `<p class="small muted arch-excluded">${t('project_architecture.excluded')} ${groups} <button type="button" class="link-btn" data-arch-exclude-edit data-testid="architecture-exclude-edit">${list.length ? t('project_architecture.edit_the_project_s_list_length', { length: list.length }) : t('project_architecture.exclude_more_paths')}</button></p>`;
  }

  // the project's own quality gate as one row of chips (#386): measured ✓ with its value, pending or missing
  function gateHtml(gate) {
    if (!Array.isArray(gate)) return '';
    const chips = ArchitectureFactsView.qualityGateRow(gate).map((c) => `<span class="badge arch-gate-chip gate-${c.state}" data-testid="architecture-gate-chip" title="${esc(c.title)}">${esc(c.label)}</span>`).join('');
    return `<div class="row arch-gate" data-testid="architecture-gate"><span class="small muted">${t('project_architecture.quality_gate')}</span>${chips}</div>`;
  }

  function factsHtml() {
    const f = cur.facts;
    // a partial model (an older facts file) reads as "nothing measured", not as a crash
    const model = { mass_changes: [], window: {}, files: [], complexity: {}, excluded: {}, languages: [], ...f.model };
    const mass = model.mass_changes.length ? plural(model.mass_changes.length, model.include_mass ? 'project_architecture.mass_changes_counted' : 'project_architecture.mass_changes_not_counted') : t('project_architecture.no_mass_change');
    const window = model.window.since || model.window.until ? t('project_architecture.window_range', { since: esc(day(model.window.since) || t('project_architecture.the_start')), until: esc(day(model.window.until) || t('project_architecture.now')) }) : t('project_architecture.the_whole_history');
    return `<div class="arch-facts" data-testid="architecture-facts">
      <p class="small muted">${esc(model.branch)} ${t('project_architecture.at')} <span class="mono">${esc(short(model.head?.commit))}</span> (${esc(day(model.head?.date))}) · ${window} · ${plural(model.commits, 'project_architecture.commits_count')} · ${mass}${model.shallow ? ` · <span class="badge warn">${t('project_architecture.shallow_clone_history_cut')}</span>` : ''}</p>
      ${gateHtml(f.gate)}
      ${excludeHtml(model)}
      ${complexityHtml(model)}
      ${hotspotsHtml(model)}
      ${model.complexity.status === 'measured' ? scatterHtml(model) : ''}
    </div>`;
  }

  // the facts' title with an ⓘ that opens what the numbers can't tell (#386: not printed on the page)
  const factsHeadHtml = () => `<h3 class="arch-sub arch-facts-title">${t('project_architecture.facts')} <button type="button" class="icon-btn arch-info" data-testid="architecture-caveats" data-arch-caveats aria-expanded="${!!cur.caveats}" aria-label="${t('project_architecture.what_the_numbers_can_t_tell_2')}" title="${t('project_architecture.what_the_numbers_can_t_tell')}">ⓘ</button></h3>
    <div class="card arch-limits small${cur.caveats ? '' : ' hidden'}" data-testid="architecture-limits"><b>${t('project_architecture.what_the_numbers_can_t_tell')}</b><ul>${LIMITS.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;

  function bodyHtml() {
    if (cur.loadError) return `<div class="usage-unavailable" role="alert" data-testid="architecture-state-error">${t('project_architecture.could_not_read_the_facts')} ${esc(cur.loadError)}</div>`;
    if (!cur.facts) return `<p class="muted" role="status">${t('project_architecture.loading')}</p>`;
    if (cur.facts.state === 'not-git') {
      return `<div class="empty-state" data-testid="architecture-state-not-git"><b>${t('project_architecture.not_a_git_repository')}</b><p class="muted">${t('project_architecture.the_project_folder_is_not_a')}</p></div>`;
    }
    const noCommits = cur.facts.state === 'no-commits' ? `<div class="empty-state" data-testid="architecture-state-no-commits"><b>${t('project_architecture.no_commits_in_this_range')}</b><p class="muted">${t('project_architecture.widen_the_from_to_range_churn')}</p></div>` : '';
    const model = cur.facts.model;
    const lead = model || cur.view?.report ? overviewHtml(model) : '';
    return `${controlsHtml()}${lead}${noCommits}${factsHeadHtml()}${model ? factsHtml() : ''}${stateHtml()}${rerunHtml()}`;
  }

  function render() {
    if (!cur?.box) return;
    cur.box.innerHTML = `<div data-testid="project-health">${bodyHtml()}</div>`;
    if (cur.focusFile) cur.box.querySelector('.arch-focus')?.scrollIntoView?.({ block: 'center' });
  }

  const range = () => ({ since: cur.since ? `${cur.since}T00:00:00Z` : null, until: cur.until ? `${cur.until}T23:59:59Z` : null, includeMass: cur.includeMass });

  async function load(refresh = false) {
    const c = cur;
    if (!c) return;
    const seq = ++c.seq;
    Object.assign(c, { loading: true, loadError: null });
    render();
    const [facts, view, reports, estimate] = await Promise.allSettled([
      api.architectureFacts(c.id, { ...range(), refresh }),
      api.architectureReport(c.id, { reportId: c.reportId }),
      api.listArchitectureReports(c.id),
      api.architectureEstimate(c.id),
    ]);
    if (cur !== c || seq !== c.seq) return;
    c.loading = false;
    const value = (r) => (r.status === 'fulfilled' ? r.value : null);
    c.facts = value(facts);
    if (!c.facts) c.loadError = facts.status === 'rejected' ? errMsg(facts.reason) : 'the service gave no answer';
    c.view = value(view);
    c.reports = value(reports) || [];
    c.estimate = value(estimate)?.estimate || null;
    render();
  }

  // Create issue (and prioritize) for one finding; the finding then shows its issue (#730)
  async function createIssue(index, prioritize) {
    const c = cur;
    const reportId = c?.view?.report?.id;
    if (!reportId || c.creating) return;
    c.creating = true;
    render();
    try {
      const { filed } = await api.createFindingIssue(c.id, reportId, index, { prioritize });
      if (c.view.findings[index]) c.view.findings[index].filed = filed;
      showToast(t(prioritize ? 'project_architecture.issue_created_prioritized' : 'project_architecture.issue_created', { issue: filed.issue, where: stageText(filed) }));
    } catch (e) {
      c.error = errMsg(e);
    }
    c.creating = false;
    if (cur === c) render();
  }

  // "Create issues": the findings shown (the filter's) not filed yet, one after the other, not prioritized
  async function createAll() {
    const c = cur;
    const reportId = c?.view?.report?.id;
    if (!reportId || c.creating) return;
    const list = shownFindings().filter((f) => !f.filed);
    c.creating = true;
    render();
    let made = 0;
    for (const f of list) {
      try {
        const { filed } = await api.createFindingIssue(c.id, reportId, f.index, { prioritize: false });
        if (c.view.findings[f.index]) c.view.findings[f.index].filed = filed;
        made++;
      } catch (e) {
        c.error = errMsg(e);
        break;
      }
    }
    c.creating = false;
    showToast(plural(made, 'project_architecture.issues_created'));
    if (cur === c) render();
  }

  // the Oracle's report again (architecture:analyze), then the tab read again
  async function rerun() {
    const c = cur;
    if (!c || c.rerunning) return;
    Object.assign(c, { rerunning: true, error: null });
    render();
    try {
      await api.analyzeArchitecture(c.id, { mock: !!(typeof state !== 'undefined' && state.simulationOnly) });
      c.reportId = null;
    } catch (e) {
      c.error = errMsg(e);
    }
    c.rerunning = false;
    if (cur === c) load();
  }

  // a filter button: "all" clears both, another toggles its own
  function setFilter(spec) {
    const [dim, key] = spec.split(':');
    if (key === 'all') cur.filter = { severity: null, status: null };
    else cur.filter[dim] = cur.filter[dim] === key ? null : key;
    render();
  }

  function toggleMore(key) {
    if (!cur.expanded.delete(key)) cur.expanded.add(key);
    render();
  }

  async function saveExclude() {
    const c = cur;
    const text = c.box.querySelector('[data-arch-exclude-text]')?.value || '';
    try {
      await api.setArchitectureExclude(c.id, text.split('\n').map((s) => s.trim()).filter(Boolean));
      c.editing = false;
      load(true);
    } catch (e) {
      c.error = errMsg(e);
      render();
    }
  }

  /** Marks `file`'s hotspot row on project `id`'s next show (the city's "Open in Facts"). */
  function focus(id, file) {
    pendingFocus = { id, file };
    if (cur?.id === id) cur.focusFile = file;
  }

  /** Draws the tab of project `id` into `box`: read on the first show of a project, kept until Refresh. */
  function show(id, box) {
    if (cur?.id !== id) {
      cur = { id, box, facts: null, view: null, reports: [], estimate: null, error: null, loadError: null, loading: false, reportId: null, since: '', until: '', includeMass: true, editing: false, seq: 0,
        filter: { severity: null, status: null }, expanded: new Set(), caveats: false, creating: false, rerunning: false, focusFile: null };
    }
    if (pendingFocus?.id === id) { cur.focusFile = pendingFocus.file; pendingFocus = null; }
    cur.box = box;
    if (!cur.facts && !cur.loading && !cur.loadError) load();
    else render();
  }

  // a click → its action, or null
  function clickAction(e) {
    const create = e.target.closest('[data-arch-create]');
    if (create) return () => createIssue(+create.dataset.archCreate, create.dataset.prioritize !== undefined);
    if (e.target.closest('[data-arch-create-all]')) return createAll;
    if (e.target.closest('[data-arch-rerun]')) return rerun;
    const filter = e.target.closest('[data-arch-filter]');
    if (filter) return () => setFilter(filter.dataset.archFilter);
    const more = e.target.closest('[data-arch-more]');
    if (more) return () => toggleMore(more.dataset.archMore);
    if (e.target.closest('[data-arch-caveats]')) return () => { cur.caveats = !cur.caveats; render(); };
    if (e.target.closest('[data-arch-refresh]')) return () => load(true);
    if (e.target.closest('[data-arch-exclude-edit]')) return () => { cur.editing = true; render(); };
    if (e.target.closest('[data-arch-exclude-cancel]')) return () => { cur.editing = false; render(); };
    if (e.target.closest('[data-arch-exclude-save]')) return saveExclude;
    return null;
  }

  /** A click inside the tab; true when it was the tab's. */
  function onClick(e) {
    if (!cur?.box?.contains(e.target)) return false;
    const action = clickAction(e);
    if (!action) return false;
    action();
    return true;
  }

  /** A change of the range, the mass toggle or the report picker; true when it was the tab's. */
  function onChange(e) {
    if (!cur?.box?.contains(e.target)) return false;
    const el = e.target;
    if (el.matches('[data-arch-since]')) cur.since = el.value;
    else if (el.matches('[data-arch-until]')) cur.until = el.value;
    else if (el.matches('[data-arch-mass]')) cur.includeMass = el.checked;
    else if (el.matches('[data-arch-report]')) {
      cur.reportId = el.value || null;
      cur.expanded.clear();
    }
    else return false;
    load();
    return true;
  }

  window.ProjectHealth = {
    focus,
    languagesHtml, // #781: the wizard's review draws the same bar
    onChange,
    onClick,
    show,
  };
})();
