// A project's Architecture tab (#356), written for a human reader (#386, the pure parts in
// packages/shared/architecture-facts-view.js): a lead row answers "how is this project?" (the report's
// verdict in one line, the top 3 risks with their 0-100 score, the Danger Zone count, the languages
// as GitHub's bar and legend). Then the latest Oracle report (or the one picked): its summary (three
// lines at most), the verdict per area as chips, the findings ranked by score, one line each (score
// on a bar coloured by severity, target, one sentence, new / kept) with "Read more" for the evidence
// and the refactor, filters by severity and new / kept with their counts, "Send to Refactor" per
// finding and "Send all to Refactor" for the ones shown (architecture:sendToRefactor, a proposal of
// the Refactor tab, its issue and the waiting stage, #435; once sent the same button, disabled,
// "Sent to Refactor", with a link to its issue and stage next to it, #447; new / kept translated),
// the gone ones folded. Then the git facts (architecture:facts, numbers from
// packages/shared/architecture-model.js), titled with an ⓘ that opens what the numbers cannot tell: the
// commit, window, mass changes and shallow clone, the project's own quality gate as one row of
// chips, the exclusions in one line (editable, architecture:setExclude), the complexity in one line
// whose "How to measure" names the code languages not measured and how to install lizard (#385),
// the hotspot table (file, lines, commits, rank, top co-changing file; complexity, worst function
// and quadrant when a real parser or tool measured them, "—" for a file not measured, never 0), the
// Danger Zone scatter, its formula and the monthly frames on demand.
// Controls: the report picker, the From / To range and the mass-change toggle. States: not a git
// repository, no commits in the range, never analysed, a report (with "N runs since this analysis")
// and an error with its message.
// One action (#381, workflows/analyze-project.yaml, #631: the old project-map): "Analyze this project" starts the project map run
// (run:start, a simulation when the app runs simulations only) with the Oracle's analysis as its
// last step, no gate; its combined estimate stands next to it (chain:estimate for the map from past
// real runs, architecture:estimate for the Oracle's turn; "no estimate yet" before the first real
// run). The tab follows the run through run:event: "Analyzing this project" with the step while it
// runs, then the city and the report read again when it ends, or its error. A run started elsewhere
// (Workflows) for this project shows the same way. The advice to refresh (more than 5% of the drawn
// files match no district, or a new top-level folder) never starts anything. The run's folder is the
// project's own (#732: the project page's project before the cached Projects list, which a project the
// onboarding just made may miss); a project without one gets a translated message and no estimate.
// A "Facts | City" switch leads the tab (#373), remembered per window (sessionStorage MODE_KEY): City
// shows the project as a 3D city in place of all the above (views/project/project-city.js, one per
// project on screen, kept while the tab switches back and forth, with the same action and run state;
// #382: its connections panel, views/project/project-city-connections.js); a building's "Open in
// Facts" comes back here with its hotspot row marked and scrolled to. The city carries the agents of
// the project's runs in progress (#374, views/project/project-city-agents.js); openCity(id) opens
// the tab on the City view, for the Project screen only: every "Show on the map" (an issue, a stage,
// a release, a run's replay) opens the city in a modal over the screen instead (#430,
// views/project/project-city-modal.js).
// Drawn into the box project.js gives it (show), its clicks and changes routed from the project
// page's listeners (onClick, onChange). Uses app.js globals at call time: api, esc, errMsg, fmtNum,
// fmtUsd (usage-widget.js), showToast, state (projects, simulationOnly). Browser: window.ProjectArchitecture.
(() => {
  const MAP_WORKFLOW = 'analyze-project.yaml';
  const MAP_NAME = 'analyze-project';
  const TABLE_ROWS = 40;
  const STALE_RUNS = 5;
  const LIMITS = [
    'Churn from a planned migration looks like instability: a file moved to a new API in ten commits is not unstable.',
    'Complexity tools disagree with each other: one metric per chart, from one tool, and never compared across tools.',
    'Code moved between files resets both metrics: the new file starts with no history and the old one disappears.',
    'Churn says nothing about bugs unless it is joined with fix commits: a busy file is not a buggy file.',
  ];
  // what the run is doing, by its step (workflows/analyze-project.yaml, its map steps)
  // the map run's steps: catalog keys project_architecture.step_<id>
  const STEP_LABELS = new Set(['facts', 'plan', 'validate', 'invalid', 'gate', 'save', 'analyze']);
  const MODE_KEY = 'multiagent.architecture.view';
  // the project on screen: { id, box, facts, view, reports, estimate, error, loadError, loading, reportId, since, until, includeMass, editing, seq,
  // cityMap, mapEstimate, mapStarting, mapRun, mapStep (the project map run, #372/#381: cityMap is architecture:city's answer),
  // city, agents, connections, focusFile (the City view, #373: city is its ProjectCity) }
  let cur = null;
  let mode = loadMode(); // 'facts' | 'city', for every project of this window

  function loadMode() {
    try { return sessionStorage.getItem(MODE_KEY) === 'city' ? 'city' : 'facts'; } catch { return 'facts'; }
  }

  function rememberMode(next) {
    mode = next;
    try { sessionStorage.setItem(MODE_KEY, next); } catch { /* remembered until the window reloads */ }
  }

  function setMode(next) {
    rememberMode(next);
    render();
  }

  /** Opens project `id`'s Architecture tab on its City view (the Project screen's own; #430: "Show on the map" opens the city modal). */
  function openCity(id) {
    rememberMode('city');
    openProjectView(id, { tab: 'architecture' });
  }

  /** Opens project `id`'s Architecture tab on its Facts (#430: the city modal's "Show the facts"). */
  function openFacts(id) {
    rememberMode('facts');
    openProjectView(id, { tab: 'architecture' });
  }

  const modeSwitch = () => {
    const b = (m, label, title) => `<button type="button" class="${mode === m ? 'active' : ''}" data-arch-mode="${m}" data-testid="architecture-mode-${m}" aria-pressed="${mode === m}" title="${title}">${label}</button>`;
    return `<div class="seg arch-mode" role="group" aria-label="${t('project_architecture.architecture_view')}">${b('facts', t('project_architecture.mode_facts'), esc(t('project_architecture.mode_facts_title')))}${b('city', t('project_architecture.mode_city'), esc(t('project_architecture.mode_city_title')))}</div>`;
  };

  const plural = (n, key) => t(key, { count: n });
  const day = (iso) => String(iso || '').slice(0, 10);
  const short = (sha) => String(sha || '').slice(0, 10);
  const stepLabel = (id) => (STEP_LABELS.has(id) ? t(`project_architecture.step_${id}`) : id ? t('project_architecture.step_id', { id }) : t('project_architecture.starting_the_run'));

  // ---------- the one action (#381) ----------

  // the combined estimate: the map's (past real runs) plus the Oracle's turn (past real analyses)
  function estimateInfo() {
    const map = cur.mapEstimate?.items?.[0];
    const oracle = cur.estimate;
    const simulated = typeof state !== 'undefined' && state.simulationOnly ? ` ${t('project_architecture.simulations_only_no_model')}` : '';
    const parts = [];
    let usd = 0;
    if (map?.basis) { usd += Number(map.costUsd) || 0; parts.push(t('project_architecture.estimate_map', { count: map.basis, usd: (Number(map.costUsd) || 0).toFixed(2), minutes: map.minutes })); }
    if (oracle) { usd += Number(oracle.usd) || 0; parts.push(t('project_architecture.estimate_oracle', { count: oracle.basis, usd: Number(oracle.usd).toFixed(2) })); }
    if (!parts.length) return { known: false, text: t('project_architecture.no_estimate_yet'), title: t('project_architecture.no_cost_estimate_yet_the_first', { simulated }) };
    const missing = !map?.basis ? `; ${t('project_architecture.estimate_map_missing')}` : !oracle ? `; ${t('project_architecture.estimate_oracle_missing')}` : '';
    return { known: true, text: `≈ US$ ${usd.toFixed(2)}`, title: `${parts.join('; ')}${missing}.${simulated}` };
  }

  function mapAdviceHtml(r) {
    if (!r?.suggested) return '';
    const why = [
      r.unmatchedShare > 0.05 ? t('project_architecture.refresh_unmatched_share', { share: Math.round(r.unmatchedShare * 100) }) : '',
      r.newFolders.length ? t('project_architecture.refresh_new_folders', { count: r.newFolders.length, folders: r.newFolders.join(', ') }) : '',
    ].filter(Boolean).join('; ');
    return `<p class="small" role="status" data-testid="architecture-map-refresh-advised"><span class="badge warn">${t('project_architecture.refresh_advised')}</span> ${esc(why)}${t('project_architecture.analyze_this_project_asks_the_cartographer')}</p>`;
  }

  function actionHtml() {
    const city = cur.cityMap;
    const hasPlan = city?.model?.grouping === 'plan';
    const planText = !city || city.state !== 'ok' ? ''
      : hasPlan ? t('project_architecture.city_plan_districts', { count: city.model.districts.length, share: Math.floor((city.validation?.coverage || 0) * 1000) / 10 })
        : t('project_architecture.no_city_plan_by_folder');
    const e = estimateInfo();
    const running = !!cur.mapRun;
    const label = t(cur.mapStarting ? 'project_architecture.starting' : running ? 'project_architecture.analyzing' : 'project_architecture.analyze_this_project');
    const title = running ? t('project_architecture.run_step', { run: cur.mapRun, step: stepLabel(cur.mapStep) }) : t(hasPlan ? 'project_architecture.analyze_title_refresh' : 'project_architecture.analyze_title', { estimate: e.title });
    const progress = running ? `<p class="small" role="status" data-testid="architecture-analyzing" title="${esc(cur.mapRun)}"><span class="badge live">${t('project_architecture.analyzing_this_project')}</span> ${esc(stepLabel(cur.mapStep))}…</p>` : '';
    const error = cur.error ? `<div class="usage-unavailable" role="alert" data-testid="architecture-state-error">${t('project_architecture.the_analysis_failed')} ${esc(cur.error)}</div>` : '';
    return `<section class="arch-action" data-testid="architecture-action">
      <div class="row">
        <button type="button" class="btn primary" data-testid="architecture-analyze" data-arch-analyze ${running || cur.mapStarting ? 'disabled' : ''} title="${esc(title)}">${label}${cur.errorKind === 'no-folder' ? '' : ` <span class="arch-estimate" data-testid="architecture-estimate">${esc(e.text)}</span>`}</button>
        <span class="small muted">${esc(planText)}</span>
      </div>
      ${progress}${error}${mapAdviceHtml(city?.refresh)}
    </section>`;
  }

  // the City view's copy of the action's state
  const analysisState = () => {
    const e = estimateInfo();
    // #732: no estimate next to a retry that cannot work (the project has no folder)
    const noFolder = cur.errorKind === 'no-folder';
    return { running: !!cur.mapRun, step: cur.mapRun ? stepLabel(cur.mapStep) : null, error: cur.error || null, estimate: noFolder ? null : e.text, estimateTitle: noFolder ? null : e.title };
  };

  // #732: the project's own folder: the project page's project (fresh, as the Overview reads it), then
  // the cached Projects list (stale until the onboarding's clone is listed again), then a fresh read
  async function folderOf(id) {
    const pv = state.pv?.id === id ? state.pv.project?.folder : null;
    const cached = (state.projects || []).find((p) => p.id === id)?.folder;
    if (pv || cached) return pv || cached;
    if (typeof api.getProject !== 'function') return null;
    try { return (await api.getProject(id))?.folder || null; } catch { return null; }
  }

  async function analyze() {
    const c = cur;
    if (!c || c.mapStarting || c.mapRun) return;
    const folder = await folderOf(c.id);
    if (c !== cur || c.mapStarting || c.mapRun) return;
    if (!folder) {
      Object.assign(c, { error: t('project_architecture.no_folder_on_this_machine'), errorKind: 'no-folder' });
      render();
      return;
    }
    Object.assign(c, { mapStarting: true, error: null, errorKind: null });
    render();
    try {
      const out = await api.startRun({ file: MAP_WORKFLOW, inputs: { repo_path: folder, project_id: c.id, mode: 'auto', analyze: true }, mock: !!state.simulationOnly, projectId: c.id });
      if (!out?.runId) throw new Error(out?.error || 'the run did not start');
      Object.assign(c, { mapRun: out.runId, mapStep: null });
      showToast(t('project_architecture.analyzing_this_project_the_cartographer_maps'));
    } catch (e) {
      c.error = errMsg(e);
    }
    c.mapStarting = false;
    if (cur === c) render();
  }

  // the run's events (run:event): the step shown while it runs; when it ends, the city and the
  // report are read again, or its error shown
  function onRunEvent(ev) {
    const c = cur;
    if (!c || !ev) return;
    if (ev.type === 'workflow.started' && !c.mapRun && ev.project_id === c.id && ev.workflow === MAP_NAME) {
      Object.assign(c, { mapRun: ev.run_id, mapStep: null, error: null });
      render();
      return;
    }
    if (!c.mapRun || ev.run_id !== c.mapRun) return;
    if (ev.type === 'step.started') {
      c.mapStep = ev.step_id;
      render();
    } else if (ev.type === 'workflow.finished') {
      Object.assign(c, { mapRun: null, mapStep: null, error: ev.status === 'success' ? null : ev.error || `the run ended ${ev.status}` });
      c.city?.reload();
      load();
    }
  }

  // ---------- the report, for a human reader (#386: ArchitectureFactsView, packages/shared/architecture-facts-view.js) ----------

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
  // where a sent finding went (#435): its issue and its roadmap stage, '' before it is filed
  const sentWhere = (to) => {
    if (!to?.issue) return '';
    if (!to.stage) return `#${to.issue}`;
    return t(to.waiting ? 'common.refactor_where_waiting' : 'common.refactor_where', { issue: to.issue, stage: to.stage });
  };
  // Send to Refactor; once sent the same button, disabled (#447), with a link to where it went next to it
  function sendHtml(f) {
    if (!f.sent) return `<button type="button" class="btn sm" data-testid="architecture-send-refactor" data-arch-send="${f.index}">${t('project_architecture.send_to_refactor')}</button>`;
    const where = sentWhere(f.sentTo);
    const title = where ? t('project_architecture.sent_to_refactor_title', { where }) : t('project_architecture.sent_to_refactor_no_issue');
    const button = `<button type="button" class="btn sm" data-testid="architecture-send-refactor" disabled title="${esc(title)}">${t('project_architecture.sent_to_refactor')}</button>`;
    const link = where && f.sentTo.issueUrl ? `<a class="small arch-sent-where" data-testid="architecture-refactor-where" href="${esc(f.sentTo.issueUrl)}" target="_blank" rel="noopener" title="${esc(title)}">${esc(where)}</a>`
      : where ? `<span class="small muted arch-sent-where" data-testid="architecture-refactor-where" title="${esc(title)}">${esc(where)}</span>` : '';
    return button + link;
  }

  // a finding: one line (its score on a bar coloured by its severity, its target, one sentence,
  // new / kept), "Read more" opens the evidence and the refactor
  function findingHtml(f, key) {
    const gone = f.status === 'gone';
    const open = cur.expanded.has(key);
    const send = gone ? '' : sendHtml(f);
    const files = (f.files || []).map((x) => `<span class="mono" title="${esc(x.path)}">${esc(x.lines ? `${x.path}:${x.lines}` : x.path)}</span>`).join(', ');
    return `<li class="arch-finding arch-row ${severityClass(f.severity)}${gone ? ' arch-gone' : ''}" data-testid="${gone ? 'architecture-finding-gone' : 'architecture-finding'}">
      <span class="arch-score" data-testid="architecture-finding-score" title="${esc(`${f.severity || 'no'} severity. ${ArchitectureFactsView.SCORE_FORMULA}`)}">${f.score}</span>
      <div class="arch-finding-body">
        <div class="arch-finding-line"><span class="mono arch-target" title="${esc(filePaths(f))}">${esc(target(f))}</span>
          <span class="arch-finding-summary" data-testid="architecture-finding-summary" title="${esc(f.title || '')}">${esc(findingSummary(f))}</span>
          <span class="badge${f.status === 'new' ? ' live' : ''}" data-testid="architecture-finding-status">${statusLabel(f.status)}</span>
          <button type="button" class="link-btn" data-testid="architecture-finding-more" data-arch-more="${esc(key)}" aria-expanded="${open}">${open ? t('project_architecture.read_less') : t('project_architecture.read_more')}</button>${send}</div>
        <div class="arch-finding-details small${open ? '' : ' hidden'}" data-testid="architecture-finding-details">
          <div class="row"><span class="badge${f.severity === 'high' ? ' warn' : ''}">${esc(f.severity)}</span><span class="badge mono">${esc(f.kind)}</span>${files}</div>
          <p class="muted">${esc(f.evidence)}</p>
          <p><b>${t('project_architecture.refactor')}</b> ${esc(f.refactor)}</p>
        </div>
      </div>
    </li>`;
  }

  // the filters by severity and by new / kept, with their counts, and "Send all to Refactor"
  function findingsToolbarHtml(all) {
    const counts = ArchitectureFactsView.findingCounts(all);
    const b = (dim, key, n) => {
      const on = key === 'all' ? !cur.filter.severity && !cur.filter.status : cur.filter[dim] === key;
      return `<button type="button" class="${on ? 'active' : ''}" data-arch-filter="${dim}:${key}" data-testid="architecture-filter-${key}" aria-pressed="${on}">${key === 'all' ? t('project_architecture.all') : key.charAt(0).toUpperCase() + key.slice(1)} <span class="muted">${n}</span></button>`;
    };
    const unsent = shownFindings().filter((f) => !f.sent).length;
    const title = unsent ? t('project_architecture.send_all_title', { count: unsent }) : t('project_architecture.send_all_none_left');
    return `<div class="row arch-toolbar">
      <div class="seg" role="group" aria-label="${t('project_architecture.filter_by_severity')}">${b('', 'all', all.length)}${['high', 'medium', 'low'].map((k) => b('severity', k, counts.severity[k])).join('')}</div>
      <div class="seg" role="group" aria-label="${t('project_architecture.filter_by_new_or_kept')}">${['new', 'kept'].map((k) => b('status', k, counts.status[k])).join('')}</div>
      <span class="spacer"></span>
      <button type="button" class="btn sm" data-testid="architecture-send-all" data-arch-send-all ${unsent && !cur.sending ? '' : 'disabled'} title="${esc(title)}">${t('project_architecture.send_all_to_refactor')}</button>
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
    const areas = (saved.report.areas || []).map((a) => `<span class="arch-area-chip" title="${esc(`${a.area}: ${a.verdict}`)}"><b>${esc(a.area)}</b> ${esc(a.verdict)}</span>`).join('');
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
    if (!summary) return `<p class="arch-verdict muted" data-testid="architecture-verdict">${t('project_architecture.not_analysed_yet_analyze_this_project')}</p>`;
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

  function stateHtml() {
    if (cur.view?.report) return reportHtml();
    return `<div class="empty-state" data-testid="architecture-state-never"><b>${t('project_architecture.never_analysed')}</b><p class="muted">${t('project_architecture.the_facts_below_come_from_git')}</p></div>`;
  }

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
    const title = esc(c.status === 'measured' ? `${c.metric} complexity from ${c.tool}` : `${c.reason || 'not measured'}: churn and size are shown meanwhile, never a guess`);
    if (!c.unmeasured?.length) return `<p class="small muted" data-testid="architecture-complexity" title="${title}">${line}</p>`;
    const names = c.unmeasured.map((l) => `<span class="badge" data-testid="architecture-unmeasured-language">${esc(l)}</span>`).join(' ');
    const how = c.install
      ? `To measure them, install lizard: <span class="mono">${esc(c.install)}</span> ${t('project_architecture.lizard_needs_python')}`
      : `They need ${esc((c.needed || []).join(', ') || 'lizard')}${c.reason ? ` (${esc(c.reason)})` : ''}.`;
    return `<details class="small muted arch-measure" data-testid="architecture-measure-note"><summary title="${title}"><span data-testid="architecture-complexity">${line}</span> · <span class="link-btn">${t('project_architecture.how_to_measure')}</span></summary>
      <p>${t('project_architecture.complexity_not_measured_for_names_their', { names })} ${how}</p></details>`;
  }

  const EXCLUDED_LABELS = { build: 'build output', generated: 'generated', lock: 'lock files', project: 'your patterns', tests: 'tests', vendored: 'vendored' };

  function excludeHtml(model) {
    const groups = Object.entries(model.excluded).filter(([, n]) => n).map(([g, n]) => `${esc(EXCLUDED_LABELS[g] || g)} ${fmtNum(n)}`).join(' · ') || 'nothing';
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
    const model = f.model;
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
    return `${actionHtml()}${controlsHtml()}${lead}${stateHtml()}${noCommits}${factsHeadHtml()}${model ? factsHtml() : ''}`;
  }

  function render() {
    if (!cur?.box) return;
    if (mode === 'city') { renderCity(); return; }
    cur.box.innerHTML = `<div data-testid="architecture"><div class="row arch-mode-row">${modeSwitch()}</div>${bodyHtml()}</div>`;
    if (cur.focusFile) cur.box.querySelector('.arch-focus')?.scrollIntoView?.({ block: 'center' });
  }

  // the project's name, as the Projects list has it (app.js state), for the city's header
  const projectName = (id) => (typeof state !== 'undefined' ? state.projects?.find((p) => p.id === id)?.name : '') || '';

  // City: the switch, then the project's city (created once, moved back into the box on each render)
  function renderCity() {
    const c = cur;
    if (!window.ProjectCity) {
      c.box.innerHTML = `<div data-testid="architecture"><div class="row arch-mode-row">${modeSwitch()}</div><div class="usage-unavailable" role="alert">${t('project_architecture.the_city_view_did_not_load')}</div></div>`;
      return;
    }
    c.city ||= ProjectCity.create({ projectId: c.id, name: projectName(c.id), onOpenFacts: (file) => { if (cur === c) { c.focusFile = file; setMode('facts'); } }, onAnalyze: () => { if (cur === c) analyze(); } });
    // #374: the agents of the project's runs in progress on its city (views/project/project-city-agents.js)
    c.agents ||= (window.CityAgents && window.ProjectCityAgents?.attach(c.city, { projectId: c.id, live: false })) || null;
    // #382: the most connected files, a click pins their arcs (views/project/project-city-connections.js)
    c.connections ||= (window.CityConnections && window.ProjectCityConnections?.attach(c.city)) || null;
    // #375: an issue's or a stage's expected footprint on its city (views/project/project-city-impact.js)
    c.impact ||= (window.CityImpact && window.ProjectCityImpact?.attach(c.city, { projectId: c.id })) || null;
    // #376: a release on its city, the previous release in grey (views/project/project-city-release.js)
    c.release ||= (window.CityRelease && window.ProjectCityRelease?.attach(c.city, { projectId: c.id })) || null;
    if (!c.box.contains(c.city.el)) {
      c.box.innerHTML = `<div data-testid="architecture" class="arch-city-mode"><div class="row arch-mode-row">${modeSwitch()}</div><div data-arch-city-slot></div></div>`;
      c.box.querySelector('[data-arch-city-slot]').appendChild(c.city.el);
    }
    c.city.update({ facts: c.facts, estimate: c.estimate, analysis: analysisState() });
  }

  const range = () => ({ since: cur.since ? `${cur.since}T00:00:00Z` : null, until: cur.until ? `${cur.until}T23:59:59Z` : null, includeMass: cur.includeMass });

  async function load(refresh = false) {
    const c = cur;
    if (!c) return;
    const seq = ++c.seq;
    Object.assign(c, { loading: true, loadError: null });
    render();
    const [facts, view, reports, estimate, city, mapEstimate] = await Promise.allSettled([
      api.architectureFacts(c.id, { ...range(), refresh }),
      api.architectureReport(c.id, { reportId: c.reportId }),
      api.listArchitectureReports(c.id),
      api.architectureEstimate(c.id),
      api.architectureCity(c.id),
      api.chainEstimate(MAP_WORKFLOW, null),
    ]);
    if (cur !== c || seq !== c.seq) return;
    c.loading = false;
    const value = (r) => (r.status === 'fulfilled' ? r.value : null);
    c.facts = value(facts);
    if (!c.facts) c.loadError = facts.status === 'rejected' ? errMsg(facts.reason) : 'the service gave no answer';
    c.view = value(view);
    c.reports = value(reports) || [];
    c.estimate = value(estimate)?.estimate || null;
    c.cityMap = value(city);
    c.mapEstimate = value(mapEstimate);
    // the run in progress, as the service sees it (a run started before this window opened too)
    if (!c.mapRun && c.cityMap?.mapRun) c.mapRun = c.cityMap.mapRun;
    // a refresh of the facts rebuilds the city (#371): the City view reads it again
    if (refresh) c.city?.reload();
    render();
  }

  async function sendToRefactor(index) {
    const c = cur;
    const reportId = c?.view?.report?.id;
    if (!reportId) return;
    try {
      const { proposal, sentTo } = await api.sendFindingToRefactor(c.id, reportId, index);
      if (c.view.findings[index]) Object.assign(c.view.findings[index], { sent: true, sentTo: sentTo || null });
      const where = sentWhere(sentTo);
      showToast(where ? t('project_architecture.sent_title_to_refactor_where', { title: proposal.title, where }) : t('project_architecture.sent_title_to_the_refactor_tab', { title: proposal.title }));
    } catch (e) {
      c.error = errMsg(e);
    }
    if (cur === c) render();
  }

  // "Send all to Refactor" (#386): the findings shown (the filter's) not sent yet, one after the other
  async function sendAll() {
    const c = cur;
    const reportId = c?.view?.report?.id;
    if (!reportId || c.sending) return;
    const list = shownFindings().filter((f) => !f.sent);
    c.sending = true;
    render();
    let sent = 0;
    for (const f of list) {
      let out;
      try {
        out = await api.sendFindingToRefactor(c.id, reportId, f.index);
      } catch (e) {
        c.error = errMsg(e);
        break;
      }
      if (c.view.findings[f.index]) Object.assign(c.view.findings[f.index], { sent: true, sentTo: out?.sentTo || null });
      sent++;
    }
    c.sending = false;
    showToast(sent ? plural(sent, 'project_architecture.sent_findings_to_refactor') : t('project_architecture.no_finding_sent_every_finding_shown'));
    if (cur === c) render();
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
      load();
    } catch (e) {
      c.error = errMsg(e);
      render();
    }
  }

  /** Draws the tab of project `id` into `box`: read on the first show of a project, kept until Refresh. */
  function show(id, box) {
    if (cur?.id !== id) {
      cur?.connections?.destroy();
      cur?.agents?.destroy();
      cur?.impact?.destroy();
      cur?.release?.destroy();
      cur?.city?.destroy(); // another project: the previous city gives its WebGL context back
      cur = { id, box, facts: null, view: null, reports: [], estimate: null, error: null, loadError: null, loading: false, reportId: null, since: '', until: '', includeMass: true, editing: false, seq: 0,
        cityMap: null, mapEstimate: null, mapStarting: false, mapRun: null, mapStep: null, city: null, agents: null, connections: null, focusFile: null,
        filter: { severity: null, status: null }, expanded: new Set(), caveats: false, sending: false };
    }
    cur.box = box;
    if (!cur.facts && !cur.loading && !cur.loadError) load();
    else render();
  }

  // a click → its action, or null
  function clickAction(e) {
    const view = e.target.closest('[data-arch-mode]');
    if (view) return () => { if (view.dataset.archMode !== mode) { cur.focusFile = null; setMode(view.dataset.archMode); } };
    const send = e.target.closest('[data-arch-send]');
    if (send) return () => sendToRefactor(+send.dataset.archSend);
    if (e.target.closest('[data-arch-send-all]')) return sendAll;
    const filter = e.target.closest('[data-arch-filter]');
    if (filter) return () => setFilter(filter.dataset.archFilter);
    const more = e.target.closest('[data-arch-more]');
    if (more) return () => toggleMore(more.dataset.archMore);
    if (e.target.closest('[data-arch-caveats]')) return () => { cur.caveats = !cur.caveats; render(); };
    if (e.target.closest('[data-arch-analyze]')) return analyze;
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
    const t = e.target;
    if (t.matches('[data-arch-since]')) cur.since = t.value;
    else if (t.matches('[data-arch-until]')) cur.until = t.value;
    else if (t.matches('[data-arch-mass]')) cur.includeMass = t.checked;
    else if (t.matches('[data-arch-report]')) {
      cur.reportId = t.value || null;
      cur.expanded.clear();
    }
    else return false;
    load();
    return true;
  }

  // the runs' events reach the tab whatever screen started the run
  if (typeof api !== 'undefined' && typeof api.onEvent === 'function') api.onEvent(onRunEvent);

  window.ProjectArchitecture = {
    onChange,
    onClick,
    onRunEvent,
    openCity,
    openFacts,
    show,
  };
})();
