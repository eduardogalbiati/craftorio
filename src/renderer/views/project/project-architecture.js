// A project's Architecture tab (#356), written for a human reader (#386, the pure parts in
// src/shared/architecture-facts-view.js): a lead row answers "how is this project?" (the report's
// verdict in one line, the top 3 risks with their 0-100 score, the Danger Zone count, the languages
// as GitHub's bar and legend). Then the latest Oracle report (or the one picked): its summary (three
// lines at most), the verdict per area as chips, the findings ranked by score, one line each (score
// on a bar coloured by severity, target, one sentence, new / kept) with "Read more" for the evidence
// and the refactor, filters by severity and new / kept with their counts, "Send to Refactor" per
// finding and "Send all to Refactor" for the ones shown (architecture:sendToRefactor, a proposal of
// the Refactor tab), the gone ones folded. Then the git facts (architecture:facts, numbers from
// src/shared/architecture-model.js), titled with an ⓘ that opens what the numbers cannot tell: the
// commit, window, mass changes and shallow clone, the project's own quality gate as one row of
// chips, the exclusions in one line (editable, architecture:setExclude), the complexity in one line
// whose "How to measure" names the code languages not measured and how to install lizard (#385),
// the hotspot table (file, lines, commits, rank, top co-changing file; complexity, worst function
// and quadrant when a real parser or tool measured them, "—" for a file not measured, never 0), the
// Danger Zone scatter, its formula and the monthly frames on demand.
// Controls: the report picker, the From / To range and the mass-change toggle. States: not a git
// repository, no commits in the range, never analysed, a report (with "N runs since this analysis")
// and an error with its message.
// One action (#381, workflows/project-map.yaml): "Analyze this project" starts the project map run
// (run:start, a simulation when the app runs simulations only) with the Oracle's analysis as its
// last step, no gate; its combined estimate stands next to it (chain:estimate for the map from past
// real runs, architecture:estimate for the Oracle's turn; "no estimate yet" before the first real
// run). The tab follows the run through run:event: "Analyzing this project" with the step while it
// runs, then the city and the report read again when it ends, or its error. A run started elsewhere
// (Workflows) for this project shows the same way. The advice to refresh (more than 5% of the drawn
// files match no district, or a new top-level folder) never starts anything.
// A "Facts | City" switch leads the tab (#373), remembered per window (sessionStorage MODE_KEY): City
// shows the project as a 3D city in place of all the above (views/project/project-city.js, one per
// project on screen, kept while the tab switches back and forth, with the same action and run state;
// #382: its connections panel, views/project/project-city-connections.js); a building's "Open in
// Facts" comes back here with its hotspot row marked and scrolled to. The city carries the agents of
// the project's runs in progress (#374, views/project/project-city-agents.js); openCity(id) opens
// the tab on the City view (a run's "Replay on the map").
// Also the Refactor tab's proposal list (showRefactor, refactor:proposals).
// Drawn into the box project.js gives it (show), its clicks and changes routed from the project
// page's listeners (onClick, onChange). Uses app.js globals at call time: api, esc, errMsg, fmtNum,
// fmtUsd (usage-widget.js), showToast, state (projects, simulationOnly). Browser: window.ProjectArchitecture.
(() => {
  const MAP_WORKFLOW = 'project-map.yaml';
  const MAP_NAME = 'project-map';
  const TABLE_ROWS = 40;
  const STALE_RUNS = 5;
  const LIMITS = [
    'Churn from a planned migration looks like instability: a file moved to a new API in ten commits is not unstable.',
    'Complexity tools disagree with each other: one metric per chart, from one tool, and never compared across tools.',
    'Code moved between files resets both metrics: the new file starts with no history and the old one disappears.',
    'Churn says nothing about bugs unless it is joined with fix commits: a busy file is not a buggy file.',
  ];
  // what the run is doing, by its step (workflows/project-map.yaml)
  const STEP_LABELS = {
    facts: 'reading the repository', plan: 'the cartographer writes the city plan', validate: 'validating the plan', invalid: 'the plan failed its validation',
    gate: 'the plan waits for your review', save: 'saving the plan', analyze: 'the Oracle analyses the hotspots',
  };
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

  /** Opens project `id`'s Architecture tab on its City view (#374, "Replay on the map"). */
  function openCity(id) {
    rememberMode('city');
    openProjectView(id, { tab: 'architecture' });
  }

  const modeSwitch = () => {
    const b = (m, label, title) => `<button type="button" class="${mode === m ? 'active' : ''}" data-arch-mode="${m}" data-testid="architecture-mode-${m}" aria-pressed="${mode === m}" title="${title}">${label}</button>`;
    return `<div class="seg arch-mode" role="group" aria-label="Architecture view">${b('facts', 'Facts', 'The git facts and the Oracle&#39;s report, as tables')}${b('city', 'City', 'The project as a 3D city: zones, districts and a building per file')}</div>`;
  };

  const plural = (n, unit) => `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
  const day = (iso) => String(iso || '').slice(0, 10);
  const short = (sha) => String(sha || '').slice(0, 10);
  const stepLabel = (id) => STEP_LABELS[id] || (id ? `step ${id}` : 'starting the run');

  // ---------- the one action (#381) ----------

  // the combined estimate: the map's (past real runs) plus the Oracle's turn (past real analyses)
  function estimateInfo() {
    const map = cur.mapEstimate?.items?.[0];
    const oracle = cur.estimate;
    const simulated = typeof state !== 'undefined' && state.simulationOnly ? ' This app runs simulations only: no model is called.' : '';
    const parts = [];
    let usd = 0;
    if (map?.basis) { usd += Number(map.costUsd) || 0; parts.push(`the map ≈ US$ ${(Number(map.costUsd) || 0).toFixed(2)} (from ${plural(map.basis, 'past runs')}, ~${map.minutes} min)`); }
    if (oracle) { usd += Number(oracle.usd) || 0; parts.push(`the Oracle's analysis ≈ US$ ${Number(oracle.usd).toFixed(2)} (from the last ${plural(oracle.basis, 'analyses')})`); }
    if (!parts.length) return { known: false, text: 'no estimate yet', title: `No cost estimate yet: the first real run shows its cost. One cartographer turn (up to three when its plan fails the validation), then one Oracle turn in its daily budget.${simulated}` };
    const missing = !map?.basis ? '; the map has no estimate yet (no real run)' : !oracle ? '; the Oracle\'s analysis has no estimate yet (no real analysis)' : '';
    return { known: true, text: `≈ US$ ${usd.toFixed(2)}`, title: `${parts.join('; ')}${missing}.${simulated}` };
  }

  function mapAdviceHtml(r) {
    if (!r?.suggested) return '';
    const why = [
      r.unmatchedShare > 0.05 ? `${Math.round(r.unmatchedShare * 100)}% of the drawn files match no district` : '',
      r.newFolders.length ? `new top-level ${r.newFolders.length === 1 ? 'folder' : 'folders'}: ${r.newFolders.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    return `<p class="small" role="status" data-testid="architecture-map-refresh-advised"><span class="badge warn">Refresh advised</span> ${esc(why)}. "Analyze this project" asks the cartographer for new rules (the names you saw stay); nothing starts on its own.</p>`;
  }

  function actionHtml() {
    const city = cur.cityMap;
    const hasPlan = city?.model?.grouping === 'plan';
    const planText = !city || city.state !== 'ok' ? ''
      : hasPlan ? `City plan: ${plural(city.model.districts.length, 'districts')}, ${Math.floor((city.validation?.coverage || 0) * 1000) / 10}% of the drawn files in a district.`
        : 'No city plan yet: the city groups the files by folder.';
    const e = estimateInfo();
    const running = !!cur.mapRun;
    const label = cur.mapStarting ? 'Starting…' : running ? 'Analyzing…' : 'Analyze this project';
    const title = running ? `Run ${cur.mapRun}: ${stepLabel(cur.mapStep)}` : `One run: the cartographer maps the project${hasPlan ? ' (a refresh keeps the names you saw)' : ''}, then the Oracle analyses its hotspots. ${e.title}`;
    const progress = running ? `<p class="small" role="status" data-testid="architecture-analyzing" title="${esc(cur.mapRun)}"><span class="badge live">Analyzing this project</span> ${esc(stepLabel(cur.mapStep))}…</p>` : '';
    const error = cur.error ? `<div class="usage-unavailable" role="alert" data-testid="architecture-state-error">The analysis failed: ${esc(cur.error)}</div>` : '';
    return `<section class="arch-action" data-testid="architecture-action">
      <div class="row">
        <button type="button" class="btn primary" data-testid="architecture-analyze" data-arch-analyze ${running || cur.mapStarting ? 'disabled' : ''} title="${esc(title)}">${label} <span class="arch-estimate" data-testid="architecture-estimate">${esc(e.text)}</span></button>
        <span class="small muted">${esc(planText)}</span>
      </div>
      ${progress}${error}${mapAdviceHtml(city?.refresh)}
    </section>`;
  }

  // the City view's copy of the action's state
  const analysisState = () => {
    const e = estimateInfo();
    return { running: !!cur.mapRun, step: cur.mapRun ? stepLabel(cur.mapStep) : null, error: cur.error || null, estimate: e.text, estimateTitle: e.title };
  };

  async function analyze() {
    const c = cur;
    if (!c || c.mapStarting || c.mapRun) return;
    const folder = state.projects.find((p) => p.id === c.id)?.folder;
    if (!folder) {
      c.error = 'The project has no folder: there is nothing to analyse.';
      render();
      return;
    }
    Object.assign(c, { mapStarting: true, error: null });
    render();
    try {
      const out = await api.startRun({ file: MAP_WORKFLOW, inputs: { repo_path: folder, project_id: c.id, mode: 'auto', analyze: true }, mock: !!state.simulationOnly, projectId: c.id });
      if (!out?.runId) throw new Error(out?.error || 'the run did not start');
      Object.assign(c, { mapRun: out.runId, mapStep: null });
      showToast('Analyzing this project: the cartographer maps it, then the Oracle analyses it');
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

  // ---------- the report, for a human reader (#386: ArchitectureFactsView, src/shared/architecture-facts-view.js) ----------

  const dangerZone = () => cur.facts?.model?.danger_zone || [];
  const ranked = () => ArchitectureFactsView.rankFindings(cur.view?.findings || [], dangerZone());
  const shownFindings = () => ArchitectureFactsView.filterFindings(ranked(), cur.filter);
  const severityClass = (s) => (['high', 'medium', 'low'].includes(s) ? `sev-${s}` : 'sev-low');
  const target = (f) => {
    const files = f.files || [];
    return files.length ? `${files[0].path}${files.length > 1 ? ` +${files.length - 1}` : ''}` : f.kind || '';
  };
  const findingSummary = (f) => ArchitectureFactsView.firstSentence(f.title || f.evidence || f.kind);

  // a finding: one line (its score on a bar coloured by its severity, its target, one sentence,
  // new / kept), "Read more" opens the evidence and the refactor
  function findingHtml(f, key) {
    const gone = f.status === 'gone';
    const open = cur.expanded.has(key);
    const send = gone ? '' : f.sent ? '<span class="badge" data-testid="architecture-send-refactor">Sent to Refactor</span>'
      : `<button type="button" class="btn sm" data-testid="architecture-send-refactor" data-arch-send="${f.index}">Send to Refactor</button>`;
    const files = (f.files || []).map((x) => `<span class="mono" title="${esc(x.path)}">${esc(x.lines ? `${x.path}:${x.lines}` : x.path)}</span>`).join(', ');
    return `<li class="arch-finding arch-row ${severityClass(f.severity)}${gone ? ' arch-gone' : ''}" data-testid="${gone ? 'architecture-finding-gone' : 'architecture-finding'}">
      <span class="arch-score" data-testid="architecture-finding-score" title="${esc(`${f.severity || 'no'} severity. ${ArchitectureFactsView.SCORE_FORMULA}`)}">${f.score}</span>
      <div class="arch-finding-body">
        <div class="arch-finding-line"><span class="mono arch-target" title="${esc((f.files || []).map((x) => x.path).join(', '))}">${esc(target(f))}</span>
          <span class="arch-finding-summary" data-testid="architecture-finding-summary" title="${esc(f.title || '')}">${esc(findingSummary(f))}</span>
          <span class="badge${f.status === 'new' ? ' live' : ''}">${esc(f.status || '')}</span>
          <button type="button" class="link-btn" data-testid="architecture-finding-more" data-arch-more="${esc(key)}" aria-expanded="${open}">${open ? 'Read less' : 'Read more'}</button>${send}</div>
        <div class="arch-finding-details small${open ? '' : ' hidden'}" data-testid="architecture-finding-details">
          <div class="row"><span class="badge${f.severity === 'high' ? ' warn' : ''}">${esc(f.severity)}</span><span class="badge mono">${esc(f.kind)}</span>${files}</div>
          <p class="muted">${esc(f.evidence)}</p>
          <p><b>Refactor:</b> ${esc(f.refactor)}</p>
        </div>
      </div>
    </li>`;
  }

  // the filters by severity and by new / kept, with their counts, and "Send all to Refactor"
  function findingsToolbarHtml(all) {
    const counts = ArchitectureFactsView.findingCounts(all);
    const b = (dim, key, n) => {
      const on = key === 'all' ? !cur.filter.severity && !cur.filter.status : cur.filter[dim] === key;
      return `<button type="button" class="${on ? 'active' : ''}" data-arch-filter="${dim}:${key}" data-testid="architecture-filter-${key}" aria-pressed="${on}">${key === 'all' ? 'All' : key.charAt(0).toUpperCase() + key.slice(1)} <span class="muted">${n}</span></button>`;
    };
    const unsent = shownFindings().filter((f) => !f.sent).length;
    const title = unsent ? `Sends the ${plural(unsent, 'findings')} shown and not sent yet to the Refactor tab` : 'Every finding shown was sent to the Refactor tab already';
    return `<div class="row arch-toolbar">
      <div class="seg" role="group" aria-label="Filter by severity">${b('', 'all', all.length)}${['high', 'medium', 'low'].map((k) => b('severity', k, counts.severity[k])).join('')}</div>
      <div class="seg" role="group" aria-label="Filter by new or kept">${['new', 'kept'].map((k) => b('status', k, counts.status[k])).join('')}</div>
      <span class="spacer"></span>
      <button type="button" class="btn sm" data-testid="architecture-send-all" data-arch-send-all ${unsent && !cur.sending ? '' : 'disabled'} title="${esc(title)}">Send all to Refactor</button>
    </div>`;
  }

  function reportMeta(saved, view) {
    const cost = saved.simulated ? '<span class="badge p-mock">simulated</span>' : saved.costUsd != null ? `<span class="badge" title="The real cost of this analysis">${esc(fmtUsd(saved.costUsd))}</span>` : '';
    const tokens = saved.tokens && Object.keys(saved.tokens).length ? `<span class="badge" title="Tokens: ${esc(JSON.stringify(saved.tokens))}">${fmtNum(Object.values(saved.tokens).reduce((s, n) => s + (Number(n) || 0), 0))} tokens</span>` : '';
    const since = view.runsSince ? `<span class="badge${view.runsSince >= STALE_RUNS ? ' warn' : ''}" data-testid="architecture-runs-since">${plural(view.runsSince, 'runs')} since this analysis</span>` : '';
    return `<div class="row small muted arch-meta">Analysed ${esc(day(saved.date))} at ${esc(short(saved.head?.commit))} ${cost}${tokens}${since}</div>`;
  }

  function reportHtml() {
    const view = cur.view;
    const saved = view.report;
    const areas = (saved.report.areas || []).map((a) => `<span class="arch-area-chip" title="${esc(`${a.area}: ${a.verdict}`)}"><b>${esc(a.area)}</b> ${esc(a.verdict)}</span>`).join('');
    const all = ranked();
    const shown = shownFindings();
    const findings = shown.map((f) => findingHtml(f, `f${f.index}`)).join('') || `<li class="muted">${all.length ? 'No finding matches the filter.' : 'No finding.'}</li>`;
    const goneList = ArchitectureFactsView.rankFindings(view.gone, dangerZone());
    const gone = goneList.length ? `<details class="arch-gone-list"><summary class="small muted">Gone since the previous report (${goneList.length})</summary><ul class="arch-findings">${goneList.map((f) => findingHtml(f, `g${f.index}`)).join('')}</ul></details>` : '';
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
    if (!shares.length) return '<p class="small muted">No code counted.</p>';
    const tip = (s) => `${fmtNum(s.lines)} lines${s.others?.length ? ` (${s.others.join(', ')})` : ''}`;
    const segments = shares.map((s) => `<span class="arch-lang-seg" data-testid="architecture-language-segment" style="width:${s.percent}%;background-color:${s.color}" title="${esc(`${s.language} ${s.percent}%`)}"></span>`).join('');
    const legend = shares.map((s) => `<li data-testid="architecture-language-entry" title="${esc(tip(s))}"><span class="arch-lang-dot" style="background-color:${s.color}"></span><span>${esc(s.language)}</span> <span class="muted">${s.percent}%</span></li>`).join('');
    return `<div class="arch-lang-bar" data-testid="architecture-languages-bar" role="img" aria-label="${esc(`Languages: ${shares.map((s) => `${s.language} ${s.percent}%`).join(', ')}`)}">${segments}</div>
      <ul class="arch-lang-legend small" data-testid="architecture-language-legend">${legend}</ul>`;
  }

  function verdictHtml() {
    const summary = cur.view?.report?.report?.summary;
    if (!summary) return '<p class="arch-verdict muted" data-testid="architecture-verdict">Not analysed yet: "Analyze this project" asks the Oracle for a verdict.</p>';
    return `<p class="arch-verdict" data-testid="architecture-verdict" title="${esc(summary)}">${esc(ArchitectureFactsView.firstSentence(summary))}</p>`;
  }

  function overviewHtml(model) {
    const cards = ranked().slice(0, 3).map((f) => `<div class="arch-risk-card ${severityClass(f.severity)}" data-testid="architecture-risk-card" title="${esc(f.title || '')}">
      <span class="arch-score" data-testid="architecture-risk-score" title="${esc(ArchitectureFactsView.SCORE_FORMULA)}">${f.score}</span>
      <div class="arch-risk-text"><span class="arch-risk-title">${esc(findingSummary(f))}</span><span class="mono small muted">${esc(target(f))}</span></div></div>`).join('');
    const measured = model?.complexity?.status === 'measured';
    const count = measured ? `<b class="arch-ov-num">${fmtNum(model.danger_zone.length)}</b> <span class="small muted">files in the Danger Zone</span>`
      : '<b class="arch-ov-num">—</b> <span class="small muted">Danger Zone: complexity not measured</span>';
    return `<section class="arch-overview" data-testid="architecture-overview">
      ${verdictHtml()}
      <div class="arch-ov-row">
        <div class="arch-risks">${cards || '<p class="small muted">No risk yet: the report\'s findings show here.</p>'}</div>
        ${model ? `<div class="card arch-ov-tile" data-testid="architecture-danger-count" title="Files both complex and changing often (above both medians)">${count}</div>
        <div class="card arch-ov-tile arch-ov-langs">${languagesHtml(model.languages)}</div>` : ''}
      </div>
    </section>`;
  }

  function controlsHtml() {
    const reports = cur.reports || [];
    const picker = reports.length ? `<label class="an-date small muted">Report <select data-arch-report data-testid="architecture-report-picker">${reports.map((r) => `<option value="${esc(r.id)}" ${r.id === (cur.view?.report?.id) ? 'selected' : ''}>${esc(day(r.date))} · ${plural(r.findings, 'findings')}${r.simulated ? ' (simulated)' : ''}</option>`).join('')}</select></label>` : '';
    return `<div class="row pcm-controls" data-testid="architecture-controls">
      ${picker}
      <label class="an-date small muted">From <input type="date" data-arch-since value="${esc(cur.since || '')}" /></label>
      <label class="an-date small muted">To <input type="date" data-arch-until value="${esc(cur.until || '')}" /></label>
      <label class="check small" title="Commits that touched more than 25% of the files (a reformat, a rename): counted unless unchecked"><input type="checkbox" data-arch-mass ${cur.includeMass ? 'checked' : ''} /><span>Count mass changes</span></label>
      <button type="button" class="btn" data-arch-refresh ${cur.loading ? 'disabled' : ''}>Refresh</button>
    </div>`;
  }

  function stateHtml() {
    if (cur.view?.report) return reportHtml();
    return '<div class="empty-state" data-testid="architecture-state-never"><b>Never analysed</b><p class="muted">The facts below come from git, no model. "Analyze this project" maps the project into zones and districts (the City view) and has the Oracle read the top hotspots and the files that change together with its read-only tools and write a report: a summary, a verdict per area, and findings you can send to the Refactor tab.</p></div>';
  }

  function complexityCells(r, measured) {
    if (!measured) return '';
    return `<td class="num">${r.complexity ?? '—'}</td><td class="num">${r.worst ?? '—'}</td><td>${r.quadrant ? `<span class="badge${r.quadrant === 'Danger Zone' ? ' warn' : ''}">${esc(r.quadrant)}</span>` : '—'}</td>`;
  }

  function hotspotsHtml(model) {
    const measured = model.complexity.status === 'measured';
    // the file a City card opened: marked, and listed even below the top rows
    const top = model.files.slice(0, TABLE_ROWS);
    const focus = cur.focusFile && !top.some((r) => r.file === cur.focusFile) ? model.files.filter((r) => r.file === cur.focusFile) : [];
    const rows = [...top, ...focus].map((r) => `<tr data-arch-file="${esc(r.file)}"${r.file === cur.focusFile ? ' class="arch-focus" data-testid="architecture-focus-row"' : ''}>
      <td class="an-title"><span class="an-file mono" title="${esc(r.file)}">${esc(r.file)}</span> <span class="muted small">${esc(r.language)}</span></td>
      <td class="num">${fmtNum(r.lines)}</td><td class="num">${r.commits}</td><td class="num">${r.rank}</td>
      <td>${r.co_change ? `<span class="mono small" title="${esc(r.co_change.file)}">${esc(r.co_change.file)}</span> <span class="badge">${Math.round(r.co_change.share * 100)}%</span>` : '<span class="muted small">none</span>'}</td>
      ${complexityCells(r, measured)}</tr>`).join('');
    const head = `<th>File</th><th class="num">Lines</th><th class="num">Commits</th><th class="num" title="Lines × commits, highest first">Hotspot rank</th><th>Changes most with</th>${measured ? '<th class="num">Complexity</th><th class="num">Worst function</th><th>Quadrant</th>' : ''}`;
    const more = model.files.length > TABLE_ROWS ? `<p class="muted small">The top ${TABLE_ROWS} of ${model.files.length} files.</p>` : '';
    return `<h3 class="arch-sub">Hotspots</h3><div class="card table-wrap"><table class="u-table an-sessions an-files" data-testid="architecture-hotspots"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${more}`;
  }

  function scatterHtml(model) {
    const rows = model.files.filter((r) => r.quadrant);
    const maxU = Math.max(0, ...rows.map((r) => Math.log1p(r.complexity)));
    const maxV = Math.max(0, ...rows.map((r) => Math.log1p(r.commits)));
    const x = (r) => 20 + 360 * (maxV ? Math.log1p(r.commits) / maxV : 0);
    const y = (r) => 200 - 180 * (maxU ? Math.log1p(r.complexity) / maxU : 0);
    const dots = rows.map((r) => `<circle cx="${x(r).toFixed(1)}" cy="${y(r).toFixed(1)}" r="4" class="${r.quadrant === 'Danger Zone' ? 'arch-dot-danger' : 'arch-dot'}"><title>${esc(`${r.file}: complexity ${r.complexity}, ${r.commits} commits, ${r.quadrant}`)}</title></circle>`).join('');
    const frames = (model.frames || []).filter((f) => f.entered.length || f.left.length).map((f) => `<li><b>${esc(f.month)}</b> ${f.entered.length ? `entered: ${f.entered.map((n) => `<span class="mono">${esc(n)}</span>`).join(', ')}` : ''}${f.left.length ? ` left: ${f.left.map((n) => `<span class="mono">${esc(n)}</span>`).join(', ')}` : ''}</li>`).join('');
    return `<h3 class="arch-sub" title="${esc(`${model.complexity.metric} complexity from ${model.complexity.tool}`)}">Quadrants</h3>
      <svg class="arch-scatter" viewBox="0 0 400 220" role="img" aria-label="Commits against complexity, log1p axes"><line x1="20" y1="200" x2="390" y2="200" class="arch-axis"/><line x1="20" y1="10" x2="20" y2="200" class="arch-axis"/>${dots}<text x="390" y="214" text-anchor="end" class="arch-label">commits →</text><text x="24" y="16" class="arch-label">complexity ↑</text></svg>
      <details class="small muted"><summary>How the quadrants are computed</summary><p>Split at the medians: Danger Zone (complex and changing), Cowboy Code (complex, rarely touched), Fertile Ground (simple, changing), Healthy Closure (simple, stable). The Danger Zone ranks by <span class="mono">score = √(u² + v²)</span>, u = log1p(complexity) / its maximum, v = log1p(commits) / its maximum.</p></details>
      ${frames ? `<details class="small"><summary class="muted">Monthly frames: files that entered or left the Danger Zone</summary><p class="muted">Each frame uses the churn up to that month and today's complexity, so a move reflects churn alone.</p>
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
      ? `To measure them, install lizard: <span class="mono">${esc(c.install)}</span> (lizard needs Python).`
      : `They need ${esc((c.needed || []).join(', ') || 'lizard')}${c.reason ? ` (${esc(c.reason)})` : ''}.`;
    return `<details class="small muted arch-measure" data-testid="architecture-measure-note"><summary title="${title}"><span data-testid="architecture-complexity">${line}</span> · <span class="link-btn">How to measure</span></summary>
      <p>Complexity not measured for ${names}: their files show no complexity, never 0. ${how}</p></details>`;
  }

  const EXCLUDED_LABELS = { build: 'build output', generated: 'generated', lock: 'lock files', project: 'your patterns', tests: 'tests', vendored: 'vendored' };

  function excludeHtml(model) {
    const groups = Object.entries(model.excluded).filter(([, n]) => n).map(([g, n]) => `${esc(EXCLUDED_LABELS[g] || g)} ${fmtNum(n)}`).join(' · ') || 'nothing';
    const list = cur.facts.exclude || [];
    if (cur.editing) {
      return `<div class="card arch-edit" data-testid="architecture-exclude-form"><label class="field">Excluded paths, one pattern per line<textarea rows="4" data-arch-exclude-text spellcheck="false">${esc(list.join('\n'))}</textarea></label>
        <p class="hint">Gitignore-style patterns (docs/**, *.generated.ts). Lock files, build output, tests, vendored and linguist-generated files are excluded already.</p>
        <div class="row"><button type="button" class="btn primary" data-arch-exclude-save>Save</button><button type="button" class="btn ghost" data-arch-exclude-cancel>Cancel</button></div></div>`;
    }
    return `<p class="small muted arch-excluded">Excluded: ${groups} <button type="button" class="link-btn" data-arch-exclude-edit data-testid="architecture-exclude-edit">${list.length ? `Edit the project's list (${list.length})` : 'Exclude more paths'}</button></p>`;
  }

  // the project's own quality gate as one row of chips (#386): measured ✓ with its value, pending or missing
  function gateHtml(gate) {
    if (!Array.isArray(gate)) return '';
    const chips = ArchitectureFactsView.qualityGateRow(gate).map((c) => `<span class="badge arch-gate-chip gate-${c.state}" data-testid="architecture-gate-chip" title="${esc(c.title)}">${esc(c.label)}</span>`).join('');
    return `<div class="row arch-gate" data-testid="architecture-gate"><span class="small muted">Quality gate</span>${chips}</div>`;
  }

  function factsHtml() {
    const f = cur.facts;
    const model = f.model;
    const mass = model.mass_changes.length ? `${plural(model.mass_changes.length, 'mass changes')} (${model.include_mass ? 'counted' : 'not counted'})` : 'no mass change';
    const window = model.window.since || model.window.until ? `${esc(day(model.window.since) || 'the start')} to ${esc(day(model.window.until) || 'now')}` : 'the whole history';
    return `<div class="arch-facts" data-testid="architecture-facts">
      <p class="small muted">${esc(model.branch)} at <span class="mono">${esc(short(model.head?.commit))}</span> (${esc(day(model.head?.date))}) · ${window} · ${plural(model.commits, 'commits')} · ${mass}${model.shallow ? ' · <span class="badge warn">shallow clone: history cut</span>' : ''}</p>
      ${gateHtml(f.gate)}
      ${excludeHtml(model)}
      ${complexityHtml(model)}
      ${hotspotsHtml(model)}
      ${model.complexity.status === 'measured' ? scatterHtml(model) : ''}
    </div>`;
  }

  // the facts' title with an ⓘ that opens what the numbers can't tell (#386: not printed on the page)
  const factsHeadHtml = () => `<h3 class="arch-sub arch-facts-title">Facts <button type="button" class="icon-btn arch-info" data-testid="architecture-caveats" data-arch-caveats aria-expanded="${!!cur.caveats}" aria-label="ⓘ What the numbers can't tell" title="What the numbers can't tell">ⓘ</button></h3>
    <div class="card arch-limits small${cur.caveats ? '' : ' hidden'}" data-testid="architecture-limits"><b>What the numbers can't tell</b><ul>${LIMITS.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;

  function bodyHtml() {
    if (cur.loadError) return `<div class="usage-unavailable" role="alert" data-testid="architecture-state-error">Could not read the facts: ${esc(cur.loadError)}</div>`;
    if (!cur.facts) return '<p class="muted" role="status">Loading…</p>';
    if (cur.facts.state === 'not-git') {
      return `<div class="empty-state" data-testid="architecture-state-not-git"><b>Not a git repository</b><p class="muted">The project folder is not a git repository: there are no commits to read and nothing to analyse. Point the project to a git checkout to see its hotspots.</p></div>`;
    }
    const noCommits = cur.facts.state === 'no-commits' ? '<div class="empty-state" data-testid="architecture-state-no-commits"><b>No commits in this range</b><p class="muted">Widen the From / To range: churn counts the commits of the default branch inside it.</p></div>' : '';
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
      c.box.innerHTML = `<div data-testid="architecture"><div class="row arch-mode-row">${modeSwitch()}</div><div class="usage-unavailable" role="alert">The City view did not load: the Facts view has the same numbers.</div></div>`;
      return;
    }
    c.city ||= ProjectCity.create({ projectId: c.id, name: projectName(c.id), onOpenFacts: (file) => { if (cur === c) { c.focusFile = file; setMode('facts'); } }, onAnalyze: () => { if (cur === c) analyze(); } });
    // #374: the agents of the project's runs in progress on its city (views/project/project-city-agents.js)
    c.agents ||= (window.CityAgents && window.ProjectCityAgents?.attach(c.city, { projectId: c.id })) || null;
    // #382: the most connected files, a click pins their arcs (views/project/project-city-connections.js)
    c.connections ||= (window.CityConnections && window.ProjectCityConnections?.attach(c.city)) || null;
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
      const { proposal } = await api.sendFindingToRefactor(c.id, reportId, index);
      if (c.view.findings[index]) c.view.findings[index].sent = true;
      showToast(`Sent "${proposal.title}" to the Refactor tab`);
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
      try {
        await api.sendFindingToRefactor(c.id, reportId, f.index);
      } catch (e) {
        c.error = errMsg(e);
        break;
      }
      if (c.view.findings[f.index]) c.view.findings[f.index].sent = true;
      sent++;
    }
    c.sending = false;
    showToast(sent ? `Sent ${plural(sent, 'findings')} to the Refactor tab` : 'No finding sent: every finding shown was sent already');
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

  /** The Refactor tab's proposals of project `id` in `box` (the tab's empty state stays when there is none). */
  async function showRefactor(id, box, empty) {
    let list = [];
    try { list = (await api.refactorProposals(id)) || []; } catch (e) { box.innerHTML = `<div class="usage-unavailable" role="alert">Could not read the proposals: ${esc(errMsg(e))}</div>`; return; }
    if (empty) empty.classList.toggle('hidden', list.length > 0);
    box.innerHTML = list.length ? `<h3 class="arch-sub">Proposals</h3><ul class="arch-findings" data-testid="refactor-proposals">${list.map((p) => `<li class="arch-finding" data-testid="refactor-proposal">
      <div class="row arch-finding-head"><b>${esc(p.title)}</b><span class="badge">${esc(p.source)}</span><span class="badge${p.severity === 'high' ? ' warn' : ''}">${esc(p.severity || '')}</span><span class="badge mono">${esc(p.kind || '')}</span></div>
      <div class="small">${(p.files || []).map((x) => `<span class="mono">${esc(x.path)}</span>`).join(', ')}</div>
      <div class="small"><b>Refactor:</b> ${esc(p.refactor || '')}</div></li>`).join('')}</ul>` : '';
  }

  // the runs' events reach the tab whatever screen started the run
  if (typeof api !== 'undefined' && typeof api.onEvent === 'function') api.onEvent(onRunEvent);

  window.ProjectArchitecture = {
    onChange,
    onClick,
    onRunEvent,
    openCity,
    show,
    showRefactor,
  };
})();
