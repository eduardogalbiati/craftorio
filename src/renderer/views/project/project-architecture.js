// A project's Architecture tab (#356). What leads is the latest Oracle report (or the one picked):
// its summary, the verdict per area, the findings marked new / kept (and the gone ones), each with
// "Send to Refactor" (architecture:sendToRefactor, a proposal of the Refactor tab). Then the git
// facts (architecture:facts, numbers from src/shared/architecture-model.js): the hotspot table
// (file, lines, commits, rank, top co-changing file; complexity, worst function and quadrant when a
// real tool measured them), the Danger Zone scatter and its formula, the monthly frames, the
// languages, the exclusions (editable, architecture:setExclude), the mass changes, the commit,
// window and shallow clone, the project's own quality gate, and what the numbers cannot tell.
// Controls: "Analyze with the Oracle" with its estimate (architecture:estimate, "≈ US$ X"), the
// report picker, the From / To range and the mass-change toggle. States: not a git repository, no
// commits in the range, never analysed, analysing (the Oracle turn's progress, polled), a report
// (with "N runs since this analysis") and an error with its message.
// The project map (#372, workflows/project-map.yaml, architecture:city): "Map this project" (no saved
// city plan) or "Refresh the map" (a saved one) opens a confirmation with its estimate (chain:estimate
// from past real runs) and Start / Cancel; only Start starts the run (run:start, a simulation when the
// app runs simulations only), then the tab shows it running. The advice to refresh (more than 5% of
// the drawn files match no district, or a new top-level folder) never starts anything.
// A "Facts | City" switch leads the tab (#373), remembered per window (sessionStorage MODE_KEY): City
// shows the project as a 3D city in place of all the above (views/project/project-city.js, one per
// project on screen, kept while the tab switches back and forth); a building's "Open in Facts"
// comes back here with its hotspot row marked and scrolled to. The city carries the agents of the
// project's runs in progress (#374, views/project/project-city-agents.js); openCity(id) opens the
// tab on the City view (a run's "Replay on the map").
// Also the Refactor tab's proposal list (showRefactor, refactor:proposals).
// Drawn into the box project.js gives it (show), its clicks and changes routed from the project
// page's listeners (onClick, onChange). Uses app.js globals at call time: api, esc, errMsg, fmtNum,
// fmtUsd (usage-widget.js), showToast, state (projects, simulationOnly). Browser: window.ProjectArchitecture.
(() => {
  const POLL_MS = 1500;
  const MAP_WORKFLOW = 'project-map.yaml';
  const TABLE_ROWS = 40;
  const STALE_RUNS = 5;
  const LIMITS = [
    'Churn from a planned migration looks like instability: a file moved to a new API in ten commits is not unstable.',
    'Complexity tools disagree with each other: one metric per chart, from one tool, and never compared across tools.',
    'Code moved between files resets both metrics: the new file starts with no history and the old one disappears.',
    'Churn says nothing about bugs unless it is joined with fix commits: a busy file is not a buggy file.',
  ];
  const MODE_KEY = 'multiagent.architecture.view';
  // the project on screen: { id, box, facts, view, reports, estimate, error, loadError, loading, analyzing, progress, reportId, since, until, includeMass, editing, seq,
  // cityMap, mapEstimate, mapConfirm, mapStarting, mapRun, mapError (the project map, #372: cityMap is architecture:city's answer),
  // city, focusFile (the City view, #373: city is its ProjectCity) }
  let cur = null;
  let poll = null;
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

  function analyzeButton() {
    const e = cur.estimate;
    const estimate = e ? `≈ US$ ${Number(e.usd).toFixed(2)}` : '';
    const title = e ? `${estimate}, from the last ${plural(e.basis, 'analyses')}: one Oracle turn in its daily budget` : 'No real analysis yet: the first one shows its real cost. One Oracle turn in its daily budget.';
    return `<button type="button" class="btn primary" data-testid="architecture-analyze" data-arch-analyze ${cur.analyzing ? 'disabled' : ''} title="${esc(title)}">${cur.analyzing ? 'Analyzing…' : 'Analyze with the Oracle'}${estimate ? ` <span class="arch-estimate">${esc(estimate)}</span>` : ''}</button>`;
  }

  function controlsHtml() {
    const reports = cur.reports || [];
    const picker = reports.length ? `<label class="an-date small muted">Report <select data-arch-report data-testid="architecture-report-picker">${reports.map((r) => `<option value="${esc(r.id)}" ${r.id === (cur.view?.report?.id) ? 'selected' : ''}>${esc(day(r.date))} · ${plural(r.findings, 'findings')}${r.simulated ? ' (simulated)' : ''}</option>`).join('')}</select></label>` : '';
    return `<div class="row pcm-controls" data-testid="architecture-controls">
      ${analyzeButton()}
      ${picker}
      <label class="an-date small muted">From <input type="date" data-arch-since value="${esc(cur.since || '')}" /></label>
      <label class="an-date small muted">To <input type="date" data-arch-until value="${esc(cur.until || '')}" /></label>
      <label class="check small" title="Commits that touched more than 25% of the files (a reformat, a rename): counted unless unchecked"><input type="checkbox" data-arch-mass ${cur.includeMass ? 'checked' : ''} /><span>Count mass changes</span></label>
      <button type="button" class="btn" data-arch-refresh ${cur.loading ? 'disabled' : ''}>Refresh</button>
    </div>`;
  }

  // ---------- the project map (#372) ----------

  function mapEstimateText() {
    const item = cur.mapEstimate?.items?.[0];
    const simulated = state.simulationOnly ? ' This app runs simulations only: no model is called.' : '';
    if (item?.basis) return `≈ US$ ${Number(item.costUsd).toFixed(2)}, ~${item.minutes} min (estimate from ${plural(item.basis, 'past runs')}).${simulated}`;
    return `No cost estimate yet: no real project map run to estimate from. One cartographer turn, up to three when its plan fails the validation.${simulated}`;
  }

  function mapAdviceHtml(r) {
    if (!r?.suggested) return '';
    const why = [
      r.unmatchedShare > 0.05 ? `${Math.round(r.unmatchedShare * 100)}% of the drawn files match no district` : '',
      r.newFolders.length ? `new top-level ${r.newFolders.length === 1 ? 'folder' : 'folders'}: ${r.newFolders.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    return `<p class="small" role="status" data-testid="architecture-map-refresh-advised"><span class="badge warn">Refresh advised</span> ${esc(why)}. "Refresh the map" asks the cartographer for new rules; nothing starts on its own.</p>`;
  }

  function mapConfirmHtml(label) {
    if (!cur.mapConfirm) return '';
    const error = cur.mapError ? `<div class="usage-unavailable" role="alert">${esc(cur.mapError)}</div>` : '';
    return `<div class="card arch-edit" role="dialog" aria-label="${esc(label)}" data-testid="architecture-map-confirm">
      <p class="small"><b>${esc(label)}</b>: the cartographer reads the repository (read-only) and writes the city plan; it is validated by rules and shown at a gate before anything is saved.</p>
      <p class="small" data-testid="architecture-map-estimate">${esc(mapEstimateText())}</p>
      ${error}
      <div class="row"><button type="button" class="btn primary" data-arch-map-start data-testid="architecture-map-start" ${cur.mapStarting ? 'disabled' : ''}>${cur.mapStarting ? 'Starting…' : 'Start'}</button><button type="button" class="btn ghost" data-arch-map-cancel data-testid="architecture-map-cancel">Cancel</button></div>
    </div>`;
  }

  function mapHtml() {
    const city = cur.cityMap;
    if (!city || city.state !== 'ok') return '';
    const hasPlan = city.model?.grouping === 'plan';
    const label = hasPlan ? 'Refresh the map' : 'Map this project';
    const plan = hasPlan
      ? `City plan: ${plural(city.model.districts.length, 'districts')}, ${Math.floor((city.validation?.coverage || 0) * 1000) / 10}% of the drawn files in a district.`
      : 'No city plan yet: the city groups the files by folder.';
    const running = cur.mapRun ? `<span class="badge live" role="status" data-testid="architecture-map-running" title="${esc(cur.mapRun)}">Project map running: its plan waits at its gate</span>` : '';
    return `<section class="arch-map" data-testid="architecture-map-panel">
      <div class="row"><button type="button" class="btn" data-arch-map data-testid="architecture-map" ${cur.mapRun || cur.mapConfirm ? 'disabled' : ''}>${label}</button>${running}<span class="small muted">${esc(plan)}</span></div>
      ${mapAdviceHtml(city.refresh)}
      ${mapConfirmHtml(label)}
    </section>`;
  }

  async function startMap() {
    const c = cur;
    if (!c || c.mapStarting) return;
    const folder = state.projects.find((p) => p.id === c.id)?.folder;
    if (!folder) {
      c.mapError = 'The project has no folder: there is nothing to map.';
      render();
      return;
    }
    Object.assign(c, { mapStarting: true, mapError: null });
    render();
    try {
      const out = await api.startRun({ file: MAP_WORKFLOW, inputs: { repo_path: folder, project_id: c.id }, mock: !!state.simulationOnly, projectId: c.id });
      Object.assign(c, { mapRun: out?.runId || null, mapConfirm: false });
      showToast('Project map started: its plan waits for you at its gate');
    } catch (e) {
      c.mapError = errMsg(e);
    }
    c.mapStarting = false;
    if (cur === c) render();
  }

  function findingHtml(f, i) {
    const files = (f.files || []).map((x) => `<span class="mono" title="${esc(x.path)}">${esc(x.lines ? `${x.path}:${x.lines}` : x.path)}</span>`).join(', ');
    const gone = f.status === 'gone';
    const send = gone ? '' : f.sent ?'<span class="badge" data-testid="architecture-send-refactor">Sent to Refactor</span>'
      : `<button type="button" class="btn sm" data-testid="architecture-send-refactor" data-arch-send="${i}">Send to Refactor</button>`;
    return `<li class="arch-finding${gone ? ' arch-gone' : ''}" data-testid="${gone ? 'architecture-finding-gone' : 'architecture-finding'}">
      <div class="row arch-finding-head"><b>${esc(f.title || f.kind)}</b>
        <span class="badge${f.status === 'new' ? ' live' : ''}">${esc(f.status || '')}</span>
        <span class="badge${f.severity === 'high' ? ' warn' : ''}">${esc(f.severity)}</span>
        <span class="badge mono">${esc(f.kind)}</span><span class="spacer"></span>${send}</div>
      <div class="small">${files}</div>
      <div class="small muted">${esc(f.evidence)}</div>
      <div class="small"><b>Refactor:</b> ${esc(f.refactor)}</div>
    </li>`;
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
    const areas = (saved.report.areas || []).map((a) => `<li><b>${esc(a.area)}</b>: ${esc(a.verdict)}</li>`).join('');
    const findings = view.findings.map((f, i) => findingHtml(f, i)).join('') || '<li class="muted">No finding.</li>';
    const gone = view.gone.length ? `<h4 class="arch-sub">Gone since the previous report</h4><ul class="arch-findings">${view.gone.map((f) => findingHtml(f, -1)).join('')}</ul>` : '';
    return `<section class="card arch-report" data-testid="architecture-report">
      ${reportMeta(saved, view)}
      <p class="arch-summary" data-testid="architecture-report-summary">${esc(saved.report.summary)}</p>
      ${areas ? `<ul class="arch-areas small">${areas}</ul>` : ''}
      <ul class="arch-findings" data-testid="architecture-findings">${findings}</ul>
      ${gone}
    </section>`;
  }

  function stateHtml() {
    if (cur.analyzing) {
      const p = cur.progress;
      return `<div class="card arch-report" role="status" data-testid="architecture-state-analyzing">The Oracle is reading the hotspots and the files that change together…${p ? ` <span class="muted small">${plural(p.items, 'steps')}${p.last ? `: ${esc(p.last)}` : ''}</span>` : ''}</div>`;
    }
    const error = cur.error ? `<div class="usage-unavailable" role="alert" data-testid="architecture-state-error">The analysis failed: ${esc(cur.error)}</div>` : '';
    if (cur.view?.report) return `${error}${reportHtml()}`;
    return `${error}<div class="empty-state" data-testid="architecture-state-never"><b>Never analysed</b><p class="muted">The facts below come from git, no model. "Analyze with the Oracle" reads the top hotspots and the files that change together with its read-only tools and writes a report: a summary, a verdict per area, and findings you can send to the Refactor tab.</p></div>`;
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
    return `<h3 class="arch-sub">Quadrants (${esc(model.complexity.metric)} complexity from ${esc(model.complexity.tool)})</h3>
      <svg class="arch-scatter" viewBox="0 0 400 220" role="img" aria-label="Commits against complexity, log1p axes"><line x1="20" y1="200" x2="390" y2="200" class="arch-axis"/><line x1="20" y1="10" x2="20" y2="200" class="arch-axis"/>${dots}<text x="390" y="214" text-anchor="end" class="arch-label">commits →</text><text x="24" y="16" class="arch-label">complexity ↑</text></svg>
      <p class="small muted">Split at the medians: Danger Zone (complex and changing), Cowboy Code (complex, rarely touched), Fertile Ground (simple, changing), Healthy Closure (simple, stable). The Danger Zone ranks by <span class="mono">score = √(u² + v²)</span>, u = log1p(complexity) / its maximum, v = log1p(commits) / its maximum.</p>
      ${frames ? `<p class="small muted">Monthly frames: files that entered or left the Danger Zone. Each frame uses the churn up to that month and today's complexity, so a move reflects churn alone.</p>
      <ul class="small arch-frames" data-testid="architecture-frames">${frames}</ul>` : ''}`;
  }

  function complexityNote(c) {
    if (c.status === 'measured') return `Complexity: ${esc(c.metric)} from ${esc(c.tool)}${c.check?.longest?.length ? ` (longest functions: ${c.check.longest.map((f) => `${esc(f.file)} ${esc(f.name)} ${f.length} lines → ${f.complexity}`).join('; ')})` : ''}.`;
    const why = c.status === 'failed' ? `the tool's check failed: ${esc(c.reason)}` : esc(c.reason);
    return `Complexity not measured (${why}). It needs ${esc((c.needed || []).join(', '))}; churn and size are shown meanwhile, never a guess.`;
  }

  function excludeHtml(model) {
    const groups = Object.entries(model.excluded).filter(([, n]) => n).map(([g, n]) => `<span class="badge">${esc(g)} ${n}</span>`).join(' ') || '<span class="muted">none</span>';
    const list = cur.facts.exclude || [];
    if (cur.editing) {
      return `<div class="card arch-edit" data-testid="architecture-exclude-form"><label class="field">Excluded paths, one pattern per line<textarea rows="4" data-arch-exclude-text spellcheck="false">${esc(list.join('\n'))}</textarea></label>
        <p class="hint">Gitignore-style patterns (docs/**, *.generated.ts). Lock files, build output, tests, vendored and linguist-generated files are excluded already.</p>
        <div class="row"><button type="button" class="btn primary" data-arch-exclude-save>Save</button><button type="button" class="btn ghost" data-arch-exclude-cancel>Cancel</button></div></div>`;
    }
    return `<div class="small">Excluded: ${groups} <button type="button" class="link-btn" data-arch-exclude-edit data-testid="architecture-exclude-edit">${list.length ? `Edit the project's list (${list.length})` : 'Exclude more paths'}</button></div>`;
  }

  function gateHtml(gate) {
    if (!gate?.length) return '';
    const badge = { measured: 'live', pending: 'warn', missing: 'warn' };
    return `<h3 class="arch-sub">The project's own quality gate</h3><ul class="small arch-gate" data-testid="architecture-gate">${gate.map((g) => `<li><b>${esc(g.name)}</b> <span class="badge ${badge[g.state]}">${esc(g.state)}</span> ${g.value ? esc(g.value) : ''} <span class="muted">${esc(g.source || 'not configured: no evidence, not clean')}</span></li>`).join('')}</ul>`;
  }

  function factsHtml() {
    const f = cur.facts;
    const model = f.model;
    const mass = model.mass_changes.length ? `${plural(model.mass_changes.length, 'mass changes')} (${model.include_mass ? 'counted' : 'not counted'})` : 'no mass change';
    const window = model.window.since || model.window.until ? `${esc(day(model.window.since) || 'the start')} to ${esc(day(model.window.until) || 'now')}` : 'the whole history';
    return `<div class="arch-facts" data-testid="architecture-facts">
      <p class="small muted">${esc(model.branch)} at <span class="mono">${esc(short(model.head?.commit))}</span> (${esc(day(model.head?.date))}) · ${window} · ${plural(model.commits, 'commits')} · ${mass}${model.shallow ? ' · <span class="badge warn">shallow clone: history cut</span>' : ''}</p>
      <p class="small">${model.languages.map((l) => `<span class="badge">${esc(l.language)} ${fmtNum(l.lines)}</span>`).join(' ')}</p>
      ${excludeHtml(model)}
      <p class="small muted">${complexityNote(model.complexity)}</p>
      ${hotspotsHtml(model)}
      ${model.complexity.status === 'measured' ? scatterHtml(model) : ''}
      ${gateHtml(f.gate)}
    </div>`;
  }

  const limitsHtml = () => `<details class="arch-limits small" data-testid="architecture-limits" open><summary><b>What the numbers can't tell</b></summary><ul>${LIMITS.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>`;

  function bodyHtml() {
    if (cur.loadError) return `<div class="usage-unavailable" role="alert" data-testid="architecture-state-error">Could not read the facts: ${esc(cur.loadError)}</div>`;
    if (!cur.facts) return '<p class="muted" role="status">Loading…</p>';
    if (cur.facts.state === 'not-git') {
      return `<div class="empty-state" data-testid="architecture-state-not-git"><b>Not a git repository</b><p class="muted">The project folder is not a git repository: there are no commits to read and nothing to analyse. Point the project to a git checkout to see its hotspots.</p></div>`;
    }
    const noCommits = cur.facts.state === 'no-commits' ? '<div class="empty-state" data-testid="architecture-state-no-commits"><b>No commits in this range</b><p class="muted">Widen the From / To range: churn counts the commits of the default branch inside it.</p></div>' : '';
    return `${controlsHtml()}${stateHtml()}${mapHtml()}${noCommits}${cur.facts.model ? factsHtml() : ''}${limitsHtml()}`;
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
    c.city ||= ProjectCity.create({ projectId: c.id, name: projectName(c.id), onOpenFacts: (file) => { if (cur === c) { c.focusFile = file; setMode('facts'); } } });
    // #374: the agents of the project's runs in progress on its city (views/project/project-city-agents.js)
    c.agents ||= (window.CityAgents && window.ProjectCityAgents?.attach(c.city, { projectId: c.id })) || null;
    if (!c.box.contains(c.city.el)) {
      c.box.innerHTML = `<div data-testid="architecture" class="arch-city-mode"><div class="row arch-mode-row">${modeSwitch()}</div><div data-arch-city-slot></div></div>`;
      c.box.querySelector('[data-arch-city-slot]').appendChild(c.city.el);
    }
    c.city.update({ facts: c.facts, estimate: c.estimate });
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
    c.mapRun = c.cityMap?.mapRun || null;
    // a refresh of the facts rebuilds the city (#371): the City view reads it again
    if (refresh) c.city?.reload();
    render();
  }

  function stopPoll() {
    if (poll) clearInterval(poll);
    poll = null;
  }

  async function analyze() {
    const c = cur;
    if (!c || c.analyzing) return;
    Object.assign(c, { analyzing: true, error: null, progress: null });
    render();
    stopPoll();
    poll = setInterval(async () => {
      try { const v = await api.architectureReport(c.id, {}); if (cur === c && c.analyzing) { c.progress = v.running; render(); } } catch { /* the next tick tries again */ }
    }, POLL_MS);
    try {
      const out = await api.analyzeArchitecture(c.id, range());
      if (out?.refused) c.error = out.refused.text;
      c.reportId = null;
    } catch (e) {
      c.error = errMsg(e);
    }
    stopPoll();
    c.analyzing = false;
    if (cur === c) load();
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
      stopPoll();
      cur?.agents?.destroy();
      cur?.city?.destroy(); // another project: the previous city gives its WebGL context back
      cur = { id, box, facts: null, view: null, reports: [], estimate: null, error: null, loadError: null, loading: false, analyzing: false, progress: null, reportId: null, since: '', until: '', includeMass: true, editing: false, seq: 0,
        cityMap: null, mapEstimate: null, mapConfirm: false, mapStarting: false, mapRun: null, mapError: null, city: null, agents: null, focusFile: null };
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
    if (e.target.closest('[data-arch-analyze]')) return analyze;
    if (e.target.closest('[data-arch-refresh]')) return () => load(true);
    if (e.target.closest('[data-arch-exclude-edit]')) return () => { cur.editing = true; render(); };
    if (e.target.closest('[data-arch-exclude-cancel]')) return () => { cur.editing = false; render(); };
    if (e.target.closest('[data-arch-exclude-save]')) return saveExclude;
    if (e.target.closest('[data-arch-map]')) return () => { Object.assign(cur, { mapConfirm: true, mapError: null }); render(); };
    if (e.target.closest('[data-arch-map-start]')) return startMap;
    if (e.target.closest('[data-arch-map-cancel]')) return () => { cur.mapConfirm = false; render(); };
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
    else if (t.matches('[data-arch-report]')) cur.reportId = t.value || null;
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

  window.ProjectArchitecture = {
    onChange,
    onClick,
    openCity,
    show,
    showRefactor,
  };
})();
