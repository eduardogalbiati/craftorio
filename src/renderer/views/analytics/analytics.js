// Analytics: tokens and session metrics over a date range (default the last 30 days), for the
// orchestrator's runs or every CLI session on this machine (the same scopes as Usage). Charts are
// plain SVG/CSS. "Ask the supervisor" writes a report on the range (a real model call: it asks first).
// Two tabs (the selected one is remembered with the scope and range): Usage (the above) and Repository
// performance (#159: per project, the files most runs edit, the runs that hit a merge conflict, the
// runs at once, split before/after a marker; channel analytics:performance, src/repo-performance.js).
// #197: the analysed project is picked at the top of that tab (remembered per window), and each file
// over the shared limit has a recommendation, "Create issue" (or its open issue) and "Ask for a plan".
// More tabs register in window.AnalyticsTabs before this file loads: Run (#228, analytics-run.js) and
// 24/7 (#188, analytics-occupancy.js), each { id, label, order, load(), render(body), sub(), context() }.
// window.openAnalytics({ tab, runId }) opens a tab (the top bar's 24/7 chip, "Open in Analytics").
// Registers itself with registerView (view-registry.js).
// Uses app.js globals: api, esc, fmtTok, fmtUsd, fmtDur, fmtNum, dateOf, errMsg, markdownHtml, state, window.showRun, openDrawer.
(() => {
  const $a = (sel) => document.querySelector(sel);
  const LS = 'multiagent.analytics';
  // the analysed project is remembered per window (#197)
  const SS_PROJECT = 'multiagent.analytics.project';
  const extraTabs = () => Object.values(window.AnalyticsTabs || {}).sort((a, b) => (a.order || 0) - (b.order || 0));
  const extraTab = (id) => (window.AnalyticsTabs || {})[id] || null;
  const TAB_IDS = () => ['usage', 'performance', ...extraTabs().map((t) => t.id)];
  const DAY = 864e5;
  const PROVIDER_COLOR = { claude: 'var(--orange)', codex: 'var(--green)', grok: 'var(--purple)' };
  const PROVIDER_LABEL = { claude: 'Claude', codex: 'Codex', grok: 'Grok' };
  const TOOL_COLOR = { read: 'var(--accent)', edit: 'var(--green)', shell: 'var(--orange)', web: 'var(--purple)', agent: 'var(--yellow)', other: 'var(--muted)' };
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } })();
  const ax = {
    scope: saved.scope === 'machine' ? 'machine' : 'orchestrator',
    days: saved.days || 30, // quick range; null = custom from/to
    from: null, to: null,
    data: null, error: null, loading: false,
    report: null, reportError: null, analyzing: false,
    sortKey: 'tokens',
    // inline (not TAB_IDS): the Supervisor's context test evaluates this literal on its own
    tab: ['usage', 'performance', ...Object.keys(window.AnalyticsTabs || {})].includes(saved.tab) ? saved.tab : 'usage',
    project: (() => { try { return sessionStorage.getItem(SS_PROJECT) || saved.project || null; } catch { return saved.project || null; } })(),
    marker: saved.marker || '',
    perf: null, perfError: null, perfLoading: false, perfSort: 'runs',
    perfIssues: null, plan: null, planError: null, planning: false,
  };
  const persist = () => {
    try {
      localStorage.setItem(LS, JSON.stringify({ scope: ax.scope, days: ax.days, tab: ax.tab, project: ax.project, marker: ax.marker }));
      if (ax.project) sessionStorage.setItem(SS_PROJECT, ax.project);
    } catch { /* ignore */ }
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const daysBack = (n) => new Date(Date.now() - (n - 1) * DAY).toISOString().slice(0, 10);
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const val = (x, f = fmtNum) => (x == null ? '—' : f(x));

  function range() {
    if (ax.days) return { from: daysBack(ax.days), to: today() };
    return { from: ax.from || daysBack(30), to: ax.to || today() };
  }

  async function load() {
    if (ax.tab === 'performance') return loadPerf();
    const extra = extraTab(ax.tab);
    if (extra) {
      renderControls();
      await extra.load();
      if (ax.tab === extra.id) render();
      return;
    }
    ax.loading = true;
    renderControls();
    try {
      ax.data = await api.getAnalytics({ scope: ax.scope, ...range() });
      ax.error = null;
    } catch (e) { ax.error = errMsg(e); }
    ax.loading = false;
    render();
  }

  async function analyze() {
    if (!ax.data || ax.analyzing) return;
    const ok = window.confirm('The supervisor (Claude Code) will read a summary of these sessions and write a report. This calls a real model and costs money. Continue?');
    if (!ok) return;
    ax.analyzing = true; ax.reportError = null;
    renderReport(); renderControls();
    try { ax.report = await api.analyzeAnalytics({ scope: ax.scope, ...range() }); } catch (e) { ax.reportError = errMsg(e); }
    ax.analyzing = false;
    renderReport(); renderControls();
  }

  async function loadPerf() {
    ax.perfLoading = true;
    renderControls();
    try {
      ax.perf = await api.getRepositoryPerformance({ projectId: ax.project, marker: ax.marker, ...range() });
      if (ax.project !== (ax.perf.project?.id || null)) ax.plan = null;
      ax.project = ax.perf.project?.id || null;
      ax.perfError = null;
      persist();
    } catch (e) { ax.perfError = errMsg(e); }
    ax.perfLoading = false;
    render();
    loadPerfIssues();
  }

  // the project's open issues, so a file that already has one links to it instead of "Create issue"
  async function loadPerfIssues() {
    const id = ax.project;
    if (!id || !ax.perf?.files?.some((f) => f.recommendation) || !api.getBacklog) return;
    try {
      const data = await api.getBacklog(id);
      if (ax.project !== id) return;
      ax.perfIssues = (data?.issues || []).filter((i) => !i.state || String(i.state).toLowerCase() === 'open');
      if (ax.tab === 'performance' && $a('#an-files')) $a('#an-files').innerHTML = filesTable(ax.perf.files, ax.perf.sharedLimit);
    } catch { ax.perfIssues = null; }
  }

  function renderControls() {
    const r = range();
    const perf = ax.tab === 'performance';
    const extra = extraTab(ax.tab);
    document.querySelectorAll('#view-analytics [data-an-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.anTab === ax.tab);
      b.setAttribute('aria-selected', String(b.dataset.anTab === ax.tab));
    });
    document.querySelectorAll('#view-analytics .an-usage-only').forEach((el) => el.classList.toggle('hidden', perf || !!extra));
    document.querySelectorAll('#view-analytics .an-perf-only').forEach((el) => el.classList.toggle('hidden', !perf));
    document.querySelectorAll('#view-analytics .an-range').forEach((el) => el.classList.toggle('hidden', !!extra));
    if (extra) {
      $a('#an-sub').textContent = extra.sub();
      return;
    }
    if (perf) {
      if (document.activeElement !== $a('#an-marker')) $a('#an-marker').value = ax.marker;
      $a('#an-from').value = r.from;
      $a('#an-to').value = r.to;
      $a('#an-refresh').disabled = ax.perfLoading;
      $a('#an-sub').textContent = `Files runs collide on and merge conflicts${ax.perf?.project ? ` in ${ax.perf.project.name}` : ''}, ${r.from} to ${r.to}${ax.perfLoading ? ' — loading…' : ''}`;
      return;
    }
    document.querySelectorAll('#view-analytics [data-an-scope]').forEach((b) => b.classList.toggle('active', b.dataset.anScope === ax.scope));
    document.querySelectorAll('#view-analytics [data-an-days]').forEach((b) => b.classList.toggle('active', +b.dataset.anDays === ax.days));
    $a('#an-from').value = r.from;
    $a('#an-to').value = r.to;
    $a('#an-refresh').disabled = ax.loading;
    $a('#an-analyze').disabled = ax.analyzing || !ax.data;
    $a('#an-analyze').textContent = ax.analyzing ? 'Analyzing…' : 'Ask the supervisor';
    $a('#an-sub').textContent = `${ax.scope === 'machine' ? 'Every Claude Code, Codex and Grok session on this machine' : 'The sessions of the orchestrator\'s runs'}, ${r.from} to ${r.to}${ax.loading ? ' — loading…' : ''}`;
  }

  // ---- charts ---------------------------------------------------------------------------
  // Tokens per day, stacked by provider.
  function dayChart(days) {
    const max = Math.max(1, ...days.map((d) => d.tokens));
    const W = 900, H = 180, pad = 2, bw = W / days.length;
    const bars = days.map((d, i) => {
      let y = H;
      const parts = Object.entries(d.byProvider).map(([p, t]) => {
        const h = (t / max) * (H - 10);
        y -= h;
        return `<rect x="${(i * bw + pad).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 2 * pad).toFixed(1)}" height="${h.toFixed(1)}" style="fill:${PROVIDER_COLOR[p] || 'var(--muted)'}"><title>${esc(d.day)} · ${esc(PROVIDER_LABEL[p] || p)}: ${fmtTok(t)} tokens</title></rect>`;
      }).join('');
      return `<g>${parts}<rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" class="an-hit"><title>${esc(d.day)}: ${fmtTok(d.tokens)} tokens, ${fmtUsd(d.costUsd)}</title></rect></g>`;
    }).join('');
    const every = Math.ceil(days.length / 10);
    const labels = days.map((d, i) => (i % every === 0 ? `<span style="left:${((i + 0.5) / days.length) * 100}%">${esc(d.day.slice(5))}</span>` : '')).join('');
    return `<div class="an-chart"><div class="an-ymax muted small">${fmtTok(max)}</div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Tokens per day">${bars}</svg><div class="an-xlabels">${labels}</div></div>`;
  }

  // Horizontal bars: [{ label, value, sub, color }]
  function barList(items, { empty = 'No data in this range.', limit = 10 } = {}) {
    const list = items.filter((x) => x.value > 0).slice(0, limit);
    if (!list.length) return `<p class="muted small">${empty}</p>`;
    const max = Math.max(...list.map((x) => x.value));
    return `<div class="an-bars">${list.map((x) => `
      <div class="an-bar" title="${esc(x.label)}">
        <span class="an-bar-label">${esc(x.label)}</span>
        <span class="an-bar-track"><span style="width:${Math.max(1, (x.value / max) * 100)}%;background:${x.color || 'var(--accent)'}"></span></span>
        <span class="an-bar-val">${esc(x.sub)}</span>
      </div>`).join('')}</div>`;
  }

  // One stacked bar with a legend: { key: n }
  function stack(mix, colors) {
    const total = Object.values(mix).reduce((a, b) => a + b, 0);
    if (!total) return '<p class="muted small">None recorded.</p>';
    const parts = Object.entries(mix).filter(([, v]) => v > 0);
    return `<div class="an-stack">${parts.map(([k, v]) => `<span style="flex:${v};background:${colors[k] || 'var(--muted)'}" title="${esc(k)}: ${fmtNum(v)}"></span>`).join('')}</div>
      <div class="an-legend">${parts.map(([k, v]) => `<span><i style="background:${colors[k] || 'var(--muted)'}"></i>${esc(k)} <b>${fmtNum(v)}</b> <span class="muted">${pct(v / total)}</span></span>`).join('')}</div>`;
  }

  const stat = (label, value, title = '') => `<div class="u-stat"${title ? ` title="${esc(title)}"` : ''}><label>${esc(label)}</label><b>${value}</b></div>`;

  function render() {
    renderControls();
    if (ax.tab === 'performance') { renderPerf(); return; }
    if (extraTab(ax.tab)) { extraTab(ax.tab).render($a('#an-body')); return; }
    const body = $a('#an-body');
    if (ax.error) { body.innerHTML = `<div class="usage-unavailable">Could not load analytics: ${esc(ax.error)}</div>`; return; }
    const a = ax.data;
    if (!a) { body.innerHTML = '<p class="muted">Loading…</p>'; return; }
    const m = a.metrics;
    const t = a.totals;
    const missing = a.scope === 'machine' && a.localAvailable && !Object.values(a.localAvailable).some(Boolean);
    body.innerHTML = `
      ${missing ? '<div class="usage-unavailable">No CLI transcripts found on this machine (~/.claude/projects, ~/.codex/sessions, ~/.grok/sessions).</div>' : ''}
      <div class="an-totals">
        ${stat('Tokens', fmtTok(t.tokens.total), `${fmtNum(t.tokens.total)} tokens: input ${fmtNum(t.tokens.input)}, output ${fmtNum(t.tokens.output)}, cache read ${fmtNum(t.tokens.cache_read)}, cache write ${fmtNum(t.tokens.cache_write)}`)}
        ${stat('Cost', fmtUsd(t.costUsd), t.unpricedTokens ? `${fmtNum(t.unpricedTokens)} tokens have no price (set per-model prices in Usage)` : '')}
        ${stat('Sessions', fmtNum(t.sessions))}
        ${stat('Cache hit rate', pct(t.cacheHitRate), 'cache read / (input + cache read + cache write)')}
        ${stat('Active time', fmtDur(m.activeMs), `wall-clock ${fmtDur(m.durationMs)}; pauses over 5 minutes are idle time`)}
        ${stat('Tool calls', val(m.toolCalls), m.toolCalls == null ? 'Recorded in the CLIs\' transcripts, which these sessions do not have on this machine' : '')}
      </div>
      ${t.unpricedTokens ? `<p class="muted small an-note">${fmtTok(t.unpricedTokens)} tokens have no cost (the CLI does not report it and the model has no price in Usage).</p>` : ''}
      <div class="card an-card"><div class="row an-card-head"><h3>Tokens per day</h3><div class="an-legend">${Object.entries(PROVIDER_LABEL).map(([k, v]) => `<span><i style="background:${PROVIDER_COLOR[k]}"></i>${v}</span>`).join('')}</div></div>${dayChart(a.byDay)}</div>
      <div class="an-grid">
        <div class="card an-card"><h3>By provider</h3>${barList(a.byProvider.map((p) => ({ label: p.name, value: p.tokens, sub: `${fmtTok(p.tokens)} · ${fmtUsd(p.costUsd)} · ${p.sessions} sessions`, color: PROVIDER_COLOR[p.id] })))}</div>
        <div class="card an-card"><h3>By model</h3>${barList(a.byModel.map((x) => ({ label: x.model, value: x.tokens, sub: `${fmtTok(x.tokens)} · ${fmtUsd(x.costUsd)}`, color: PROVIDER_COLOR[x.provider] })))}</div>
        <div class="card an-card"><h3>By project</h3>${barList(a.byProject.map((p) => ({ label: p.name, value: p.tokens, sub: `${fmtTok(p.tokens)} · ${p.sessions} sessions` })))}</div>
      </div>
      <div class="an-grid">
        <div class="card an-card"><h3>Tool calls</h3>${stack(m.toolMix, TOOL_COLOR)}
          <div class="u-breakdown an-facts"><span>failed <b>${val(m.failedToolCalls)}</b></span><span>permission denials <b>${val(m.permissionDenials)}</b></span><span>interrupts <b>${val(m.interrupts)}</b></span><span>compactions <b>${val(m.compactions)}</b></span></div></div>
        <div class="card an-card"><h3>Work</h3><div class="u-breakdown an-facts">
          <span>prompts <b>${val(m.userPrompts)}</b></span><span>assistant turns <b>${val(m.assistantTurns)}</b></span>
          <span>files touched <b>${val(m.filesTouched)}</b></span><span>lines <b>${m.linesAdded == null ? '—' : `+${fmtNum(m.linesAdded)} −${fmtNum(m.linesRemoved)}`}</b></span>
          <span>avg session <b>${fmtDur(m.avgDurationMs)}</b> (active <b>${fmtDur(m.avgActiveMs)}</b>)</span><span>peak context <b>${val(m.peakContext, fmtTok)}</b></span></div>
          <h4 class="small muted">Complexity${m.avgComplexity != null ? ` (average ${Math.round(m.avgComplexity)}/100)` : ''}</h4>${stack(m.complexity, { low: 'var(--green)', medium: 'var(--yellow)', high: 'var(--red)' })}</div>
        <div class="card an-card"><h3>Session types <span class="muted small" title="From the first prompt and the tool mix; ask the supervisor for a finer classification">(heuristic)</span></h3>${stack(m.intents, { coding: 'var(--green)', debugging: 'var(--red)', review: 'var(--purple)', docs: 'var(--yellow)', research: 'var(--accent)', other: 'var(--muted)' })}
          ${a.runs.total ? `<h4 class="small muted">Runs</h4><div class="u-breakdown an-facts"><span>runs <b>${a.runs.total}</b></span>${Object.entries(a.runs.byStatus).map(([k, v]) => `<span>${esc(k)} <b>${v}</b></span>`).join('')}<span>waiting <b>${fmtDur(a.runs.waitingMs)}</b></span><span>supervisor turns <b>${a.runs.supervisorTurns}</b></span></div>` : ''}</div>
      </div>
      <div id="an-report"></div>
      <h3 class="s-subtitle">Sessions${a.sessionsTruncated ? ` <span class="muted small">(the ${a.sessions.length} largest)</span>` : ''}</h3>
      <div class="card table-wrap">${sessionsTable(a.sessions)}</div>`;
    renderReport();
  }

  const SORTS = {
    tokens: (s) => s.tokens.total, start: (s) => Date.parse(s.start || 0), active: (s) => s.activeMs || 0,
    tools: (s) => s.toolCallsTotal || 0, complexity: (s) => s.complexity || 0, cost: (s) => s.costUsd || 0,
  };
  function sessionsTable(list) {
    if (!list.length) return '<p class="muted small an-empty">No sessions in this range.</p>';
    const rows = [...list].sort((a, b) => SORTS[ax.sortKey](b) - SORTS[ax.sortKey](a)).slice(0, 100);
    const th = (key, label) => `<th class="num an-sort${ax.sortKey === key ? ' active' : ''}" data-an-sort="${key}">${label}</th>`;
    return `<table class="u-table an-sessions"><thead><tr><th>Session</th><th>Project</th>${th('start', 'Start')}${th('active', 'Active')}<th class="num">Prompts</th>${th('tools', 'Tools')}<th class="num">Files</th>${th('tokens', 'Tokens')}<th class="num">Cache</th>${th('cost', 'Cost')}${th('complexity', 'Complexity')}</tr></thead><tbody>
      ${rows.map((s) => `<tr>
        <td class="an-title"><span class="pill" style="color:${PROVIDER_COLOR[s.provider]}">${esc(PROVIDER_LABEL[s.provider] || s.provider)}</span> <span title="${esc(s.title || s.id || '')}">${esc(s.title || (s.run ? `${s.run.workflow || 'run'} · ${s.run.agent || ''}` : s.id || '—'))}</span>
          <div class="muted small">${esc(s.model || '')} · ${esc(s.intent)}${s.run ? ` · run ${esc(s.run.runId)}` : ''}</div></td>
        <td>${esc(s.project || '—')}</td>
        <td class="num nowrap">${s.start ? esc(dateOf(s.start)) : '—'}</td>
        <td class="num nowrap" title="wall-clock ${esc(fmtDur(s.durationMs))}">${fmtDur(s.activeMs)}</td>
        <td class="num">${val(s.userPrompts)}</td>
        <td class="num" title="${esc(Object.entries(s.toolCalls || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', '))}">${val(s.toolCallsTotal)}${s.failedToolCalls ? ` <span class="muted">(${s.failedToolCalls} failed)</span>` : ''}</td>
        <td class="num">${val(s.filesTouched)}</td>
        <td class="num">${fmtTok(s.tokens.total)}</td>
        <td class="num">${pct(s.cacheHitRate)}</td>
        <td class="num">${s.unpricedTokens && !s.costUsd ? '—' : fmtUsd(s.costUsd)}</td>
        <td class="num"><span class="an-cx cx-${esc(s.complexityLevel || 'none')}">${val(s.complexity)}</span></td>
      </tr>`).join('')}</tbody></table>`;
  }

  function renderReport() {
    const box = $a('#an-report');
    if (!box) return;
    if (ax.analyzing) { box.innerHTML = '<div class="card an-card an-report"><p class="muted">The supervisor is reading the sessions… this can take a few minutes.</p></div>'; return; }
    if (ax.reportError) { box.innerHTML = `<div class="usage-unavailable">The supervisor's report failed: ${esc(ax.reportError)}</div>`; return; }
    if (!ax.report) { box.innerHTML = ''; return; }
    const r = ax.report;
    box.innerHTML = `<div class="card an-card an-report"><div class="md">${markdownHtml(r.markdown)}</div>
      <p class="muted small">Saved in ${esc(r.reportPath)}${r.costUsd ? ` · ${fmtUsd(r.costUsd)}` : ''}</p></div>`;
  }

  // ---- Repository performance (#159) ------------------------------------------------------
  const PERF_SORTS = { runs: (f) => f.runs, lines: (f) => f.lines ?? -1, file: null };
  function filesTable(files, limit) {
    if (!files.length) return '<p class="muted small an-empty">No run with commits in this range.</p>';
    const sort = PERF_SORTS[ax.perfSort];
    const rows = [...files].sort(sort ? (a, b) => sort(b) - sort(a) || a.file.localeCompare(b.file) : (a, b) => a.file.localeCompare(b.file));
    const th = (key, label, num = true) => `<th class="${num ? 'num ' : ''}an-sort${ax.perfSort === key ? ' active' : ''}" data-an-psort="${key}">${label}</th>`;
    return `<table class="u-table an-sessions an-files"><thead><tr>${th('file', 'File', false)}${th('runs', 'Runs that edited it')}<th class="num">% of runs</th>${th('lines', 'Lines now')}<th>Recommendation</th></tr></thead><tbody>
      ${rows.map((f) => `<tr>
        <td class="an-title"><span class="an-file" title="${esc(f.file)}">${esc(f.file)}</span>${f.generated ? ' <span class="badge" title="A tool writes this file (a generated list): runs edit it through the generator">generated</span>' : ''}${f.lines == null ? ' <span class="badge" title="No longer in the repository">deleted</span>' : ''}</td>
        <td class="num">${f.runs}</td>
        <td class="num">${f.runs > 1 && f.share > limit ? `<span class="badge warn" title="More than ${pct(limit)} of the runs edit it">${pct(f.share)}</span>` : pct(f.share)}</td>
        <td class="num">${f.lines == null ? '—' : fmtNum(f.lines)}</td>
        <td class="an-rec-cell">${recommendationCell(f)}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  // #197: what to do with a file over the shared limit, its evidence, and its issue (open or to create)
  const REC_LABEL = { generated: 'Generated', registry: 'Registry', large: 'Large file', stylesheet: 'Stylesheet', doc: 'Doc', test: 'Test file', hotspot: 'Hot spot' };
  const evidenceText = (e) => `${pct(e.share)} of the runs (${e.runs})${e.lines != null ? ` · ${fmtNum(e.lines)} lines now` : ''} · ${e.conflicts ? `named by ${e.conflicts} merge conflict${e.conflicts === 1 ? '' : 's'}` : 'no conflict named it'}`;
  function openIssueFor(file) {
    return (ax.perfIssues || []).find((i) => `${i.title || ''}\n${i.body || ''}`.includes(file)) || null;
  }
  function recommendationCell(f) {
    const r = f.recommendation;
    if (!r) return '<span class="muted small">—</span>';
    const issue = openIssueFor(f.file);
    const action = issue
      ? `<a href="#" class="link-btn" data-pr-url="${esc(issue.url || '')}" title="${esc(issue.title || '')}">Open issue #${esc(issue.number)}</a>`
      : `<button type="button" class="btn sm ghost" data-an-issue="${esc(f.file)}" data-testid="an-create-issue">Create issue</button>`;
    return `<div class="an-rec" data-testid="an-recommendation"><span class="badge warn">${esc(REC_LABEL[r.kind] || r.kind)}</span> <span>${esc(r.text)}</span>
      <div class="muted small">${esc(evidenceText(r.evidence))}</div><div class="an-rec-actions">${action}</div></div>`;
  }
  function createIssue(file) {
    const f = ax.perf?.files.find((x) => x.file === file);
    if (!f?.recommendation || typeof openDrawer !== 'function') return;
    const r = f.recommendation;
    const request = `Stop parallel runs colliding on ${file}: ${r.text}\n\nEvidence (Analytics › Repository performance, ${ax.perf.from} to ${ax.perf.to}): edited by ${pct(r.evidence.share)} of the runs with commits (${r.evidence.runs} of ${ax.perf.runsWithCommits})${r.evidence.lines != null ? `, ${r.evidence.lines} lines now` : ''}, named by ${r.evidence.conflicts} merge conflict(s). The shared limit is ${pct(ax.perf.sharedLimit)} of the runs.`;
    openDrawer({ workflow: 'issue-tracker.yaml', project: ax.project, inputs: { request } });
  }

  async function askPlan() {
    const files = (ax.perf?.files || []).filter((f) => f.recommendation).map((f) => f.file);
    if (!files.length || ax.planning) return;
    if (!window.confirm(`The supervisor (Claude Code) will read the ${files.length} file(s) over the limit and their recommendations, and suggest a plan. This calls a real model and costs money. Continue?`)) return;
    ax.planning = true; ax.planError = null;
    renderPlan();
    try { ax.plan = await api.askPerformancePlan({ projectId: ax.project, files, mock: false }); } catch (e) { ax.planError = errMsg(e); }
    ax.planning = false;
    renderPlan();
  }
  function renderPlan() {
    const box = $a('#an-plan-box');
    if (!box) return;
    const btn = $a('#an-plan');
    if (btn) { btn.disabled = ax.planning; btn.textContent = ax.planning ? 'Asking…' : 'Ask for a plan'; }
    if (ax.planning) { box.innerHTML = '<div class="card an-card an-report"><p class="muted">The supervisor is reading the files over the limit… this can take a few minutes.</p></div>'; return; }
    if (ax.planError) { box.innerHTML = `<div class="usage-unavailable" role="alert">The plan failed: ${esc(ax.planError)}</div>`; return; }
    box.innerHTML = ax.plan ? `<div class="card an-card an-report"><div class="md">${markdownHtml(ax.plan.markdown || '')}</div>${ax.plan.reportPath ? `<p class="muted small">Saved in ${esc(ax.plan.reportPath)}${ax.plan.costUsd ? ` · ${fmtUsd(ax.plan.costUsd)}` : ''}</p>` : ''}</div>` : '';
  }

  // #197: the analysed project, at the top of the tab, and what the page counts
  function projectHeader(p) {
    const list = p.projects || [];
    const selected = p.project?.id || ax.project;
    const options = list.map((x) => `<option value="${esc(x.id)}" title="${esc(x.folder || 'No folder')}"${x.id === selected ? ' selected' : ''}${x.isGit ? '' : ' disabled'}>${esc(x.name)}${x.isGit ? '' : ` — ${esc(x.reason || 'not a git repository')}`}</option>`).join('');
    const pr = p.project;
    const summary = pr ? `<b>${esc(pr.name)}</b> · ${fmtNum(p.runs || 0)} run${p.runs === 1 ? '' : 's'} · ${esc(p.from || '')} to ${esc(p.to || '')}` : '';
    return `<div class="card an-project-pick">
      <label class="an-field"><span class="small muted">Project analysed</span>
        <select id="an-project" data-testid="an-project" aria-label="Project analysed" title="${esc(pr?.folder || '')}">${options || '<option value="">No projects</option>'}</select></label>
      <div class="an-project-summary" data-testid="an-project-summary"><div>${summary}</div>${pr?.folder ? `<div class="muted small mono an-file" title="${esc(pr.folder)}">${esc(pr.folder)}</div>` : ''}</div>
    </div>`;
  }

  function conflictsTable(list) {
    if (!list.length) return '<p class="muted small an-empty">No run hit a merge conflict in this range.</p>';
    return `<table class="u-table an-sessions"><thead><tr><th>Run</th><th class="num">Started</th><th>Through</th><th class="num">Cost</th><th>Files the conflict named</th></tr></thead><tbody>
      ${list.map((c) => `<tr>
        <td class="an-title"><button type="button" class="link-btn" data-an-run="${esc(c.runId)}" data-workflow="${esc(c.workflow || '')}" title="${esc(c.title)}">${esc(c.title)}</button>
          <div class="muted small">${esc(c.runId)} · ${esc(c.status || '')}</div></td>
        <td class="num nowrap">${c.startedAt ? esc(dateOf(c.startedAt)) : '—'}</td>
        <td><span class="badge${c.via === 'failed PR/MR merge' ? ' warn' : ''}">${esc(c.via)}</span></td>
        <td class="num">${fmtUsd(c.costUsd)}</td>
        <td class="small">${c.files.length ? c.files.map((f) => `<code>${esc(f)}</code>`).join(' ') : '<span class="muted">not named</span>'}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  function parallelCard(par) {
    const maxH = Math.max(1, ...par.hours);
    const hours = `<div class="an-hours" role="img" aria-label="Runs active per hour of the day">${par.hours.map((n, h) => `<span title="${String(h).padStart(2, '0')}:00 — ${n} run${n === 1 ? '' : 's'} active"><i style="height:${Math.max(n ? 4 : 0, (n / maxH) * 100)}%"></i><em>${h % 3 === 0 ? h : ''}</em></span>`).join('')}</div>`;
    const days = par.days.length ? `<table class="u-table an-sessions"><thead><tr><th>Day</th><th class="num">Runs started</th><th class="num" title="The most runs active at the same moment">At once (peak)</th><th class="num" title="Roadmap stages among the runs at the peak">Roadmap stages</th><th class="num">Hit a conflict</th></tr></thead><tbody>
      ${[...par.days].reverse().map((d) => `<tr><td class="nowrap">${esc(d.day)}</td><td class="num">${d.runs}</td><td class="num">${d.peak}</td><td class="num">${d.stages || '—'}</td><td class="num">${d.conflicts ? `<span class="badge warn">${d.conflicts}</span>` : 0}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted small an-empty">No runs in this range.</p>';
    return `<div class="card an-card"><h3>Hours runs were active <span class="muted small">(local time, runs per hour of the day)</span></h3>${hours}</div>
      <div class="card table-wrap">${days}</div>`;
  }

  // Before/after the marker: [label, key, format, better when lower]
  const COMPARE = [
    ['Runs', 'runs', (x) => fmtNum(x), null],
    ['Runs with commits', 'runsWithCommits', (x) => fmtNum(x), null],
    ['Busiest file (% of runs)', (s) => s.topFile?.share ?? null, pct, true],
    ['Files edited by more than the limit', 'filesOverLimit', (x) => fmtNum(x), true],
    ['Runs that hit a conflict', 'conflictShare', pct, true],
    ['Their share of the cost', 'conflictCostShare', pct, true],
    ['Peak of runs at once', 'peak', (x) => fmtNum(x), null],
  ];
  function compareCard(c, limit) {
    if (!c) return '';
    if (c.error) return `<div class="usage-unavailable">${esc(c.error)}</div>`;
    const get = (s, key) => (typeof key === 'function' ? key(s) : s[key]);
    const rows = COMPARE.map(([label, key, f, lower]) => {
      const b = get(c.before, key);
      const a = get(c.after, key);
      const d = a != null && b != null ? a - b : null;
      const cls = d && lower != null ? ((d < 0) === lower ? ' an-better' : ' an-worse') : '';
      const diff = d == null ? '—' : f === pct ? `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts` : `${d > 0 ? '+' : ''}${fmtNum(d)}`;
      return `<tr><td>${esc(label === 'Files edited by more than the limit' ? `Files edited by more than ${pct(limit)} of the runs` : label)}</td><td class="num">${b == null ? '—' : f(b)}</td><td class="num">${a == null ? '—' : f(a)}</td><td class="num${cls}">${diff}</td></tr>`;
    }).join('');
    return `<div class="card table-wrap an-compare"><table class="u-table"><thead><tr><th>Split at ${esc(c.commit ? `${c.marker} (${c.commit.slice(0, 8)})` : c.marker)} · ${esc(dateOf(c.at))}</th><th class="num">Before</th><th class="num">After</th><th class="num">Difference</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderPerf() {
    const body = $a('#an-body');
    if (ax.perfError) { body.innerHTML = `<div class="usage-unavailable">Could not load repository performance: ${esc(ax.perfError)}</div>`; return; }
    const p = ax.perf;
    if (!p) { body.innerHTML = '<p class="muted">Loading…</p>'; return; }
    if (!p.project) { body.innerHTML = '<div class="empty-state"><b>No projects yet</b><p class="muted">Add a project with a git repository: its runs\' commits are measured here.</p></div>'; return; }
    const notGit = p.project.isGit ? '' : `<div class="usage-unavailable">${esc(p.project.name)}'s folder is not a git repository: the files runs edit cannot be read.</div>`;
    const head = projectHeader(p);
    if (p.empty) {
      body.innerHTML = `${head}${notGit}<div class="empty-state"><b>No runs with commits on this repository in this range</b><p class="muted">Runs count once their work is merged (a local merge or a merged PR/MR). Try a longer range.</p></div>`;
      return;
    }
    const over = p.files.filter((f) => f.recommendation).length;
    body.innerHTML = `${head}${notGit}
      <div class="an-totals">
        ${stat('Runs', fmtNum(p.runs), `${p.runsWithCommits} with commits on ${p.project.name}`)}
        ${stat('Busiest file', p.topFile ? pct(p.topFile.share) : '—', p.topFile ? `${p.topFile.file}: edited by ${pct(p.topFile.share)} of the runs with commits` : '')}
        ${stat(`Files over ${pct(p.sharedLimit)}`, fmtNum(p.filesOverLimit), `Files edited by more than ${pct(p.sharedLimit)} of the runs with commits (the epic's target: none)`)}
        ${stat('Runs that hit a conflict', `${pct(p.conflictShare)} <span class="muted small">(${p.conflictRuns})</span>`, 'Went through the conflict step (resolve_merge / resolve_conflict) or a failed gh pr merge / glab mr merge')}
        ${stat('Their share of the cost', pct(p.conflictCostShare), `${fmtUsd(p.costUsd)} in total`)}
        ${stat('Peak of runs at once', fmtNum(p.peak))}
      </div>
      ${compareCard(p.compare, p.sharedLimit)}
      <div class="row an-card-head"><h3 class="s-subtitle">Files most runs edit <span class="muted small">(of ${p.runsWithCommits} runs with commits; each run counts once per file)</span></h3>
        ${over ? `<button type="button" class="btn" id="an-plan" data-testid="an-plan" title="The supervisor suggests a plan for the ${over} file(s) over ${pct(p.sharedLimit)} (a real model call: it asks first)">Ask for a plan</button>` : ''}</div>
      <div id="an-plan-box"></div>
      <div class="card table-wrap" id="an-files">${filesTable(p.files, p.sharedLimit)}</div>
      <h3 class="s-subtitle">Merge conflicts</h3>
      <div class="card table-wrap">${conflictsTable(p.conflicts)}</div>
      <h3 class="s-subtitle">Parallel work</h3>
      ${parallelCard(p.parallel)}`;
    renderPlan();
  }

  function wire() {
    const view = $a('#view-analytics');
    if (!view || view.dataset.wired) return;
    view.dataset.wired = '1';
    view.addEventListener('click', (e) => {
      const scope = e.target.closest('[data-an-scope]');
      const days = e.target.closest('[data-an-days]');
      const sort = e.target.closest('[data-an-sort]');
      const tab = e.target.closest('[data-an-tab]');
      const psort = e.target.closest('[data-an-psort]');
      const run = e.target.closest('[data-an-run]');
      const issue = e.target.closest('[data-an-issue]');
      if (issue) createIssue(issue.dataset.anIssue);
      if (e.target.closest('#an-plan')) askPlan();
      if (tab && tab.dataset.anTab !== ax.tab) { ax.tab = tab.dataset.anTab; persist(); render(); load(); }
      if (psort && ax.perf) {
        ax.perfSort = psort.dataset.anPsort;
        $a('#an-files').innerHTML = filesTable(ax.perf.files, ax.perf.sharedLimit);
      }
      if (run) window.showRun(run.dataset.anRun, { workflow: run.dataset.workflow || undefined });
      if (scope) { ax.scope = scope.dataset.anScope; ax.report = null; persist(); load(); }
      if (days) { ax.days = +days.dataset.anDays; ax.report = null; persist(); load(); }
      if (sort && ax.data) {
        ax.sortKey = sort.dataset.anSort;
        const wrap = $a('.an-sessions')?.parentElement;
        if (wrap) wrap.innerHTML = sessionsTable(ax.data.sessions);
      }
    });
    const onDate = () => {
      ax.days = null;
      ax.from = $a('#an-from').value || null;
      ax.to = $a('#an-to').value || null;
      ax.report = null;
      persist(); load();
    };
    $a('#an-from').addEventListener('change', onDate);
    $a('#an-to').addEventListener('change', onDate);
    // the project select is redrawn with the tab (#197): one listener on the view
    view.addEventListener('change', (e) => {
      if (e.target.id !== 'an-project') return;
      ax.project = e.target.value || null; ax.perfIssues = null; ax.plan = null; ax.planError = null;
      persist(); load();
    });
    $a('#an-marker').addEventListener('change', (e) => { ax.marker = e.target.value.trim(); persist(); load(); });
    $a('#an-refresh').addEventListener('click', load);
    $a('#an-analyze').addEventListener('click', analyze);
  }

  registerView({
    id: 'analytics',
    nav: { label: 'Analytics', order: 100, icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>' },
    markup: `
      <section id="view-analytics" class="view hidden">
        <div class="page-head">
          <div>
            <h1>Analytics</h1>
            <p class="muted small" id="an-sub">Tokens and session metrics</p>
          </div>
          <div class="row an-controls">
            <div class="seg an-usage-only" role="group" aria-label="Analytics scope"><button type="button" data-an-scope="orchestrator">Orchestrator</button><button type="button" data-an-scope="machine">This machine</button></div>
            <div class="seg sm an-range" role="group" aria-label="Quick range"><button type="button" data-an-days="7">7 days</button><button type="button" data-an-days="30">30 days</button><button type="button" data-an-days="90">90 days</button></div>
            <label class="an-date small muted an-range">From <input type="date" id="an-from" /></label>
            <label class="an-date small muted an-range">To <input type="date" id="an-to" /></label>
            <label class="an-date small muted an-perf-only hidden" title="A date (YYYY-MM-DD) or a commit of the repository: every number is split into before and after it">Before/after <input type="text" id="an-marker" class="an-marker" placeholder="date or commit" /></label>
            <button class="btn" id="an-refresh" type="button">Refresh</button>
            <button class="btn primary an-usage-only" id="an-analyze" type="button" title="The supervisor writes a report on these sessions (a real model call)">Ask the supervisor</button>
          </div>
        </div>
        <div class="tabs page-tabs" role="tablist" aria-label="Analytics"><button type="button" class="tab" role="tab" data-an-tab="usage">Usage</button><button type="button" class="tab" role="tab" data-an-tab="performance">Repository performance</button>${extraTabs().map((t) => `<button type="button" class="tab" role="tab" data-an-tab="${t.id}" data-testid="an-tab-${t.id}">${t.label}</button>`).join('')}</div>
        <div id="an-body"></div>
      </section>`,
    mount: wire,
    show() {
      render();
      load();
    },
  });
  // what the Supervisor is told about this screen (supervisor-chat.js)
  // opens Analytics on a tab: the top bar's 24/7 chip, "Open in Analytics" of a run (#228)
  window.openAnalytics = ({ tab = 'usage', runId = null } = {}) => {
    if (TAB_IDS().includes(tab)) ax.tab = tab;
    if (runId) extraTab('run')?.select?.(runId);
    persist();
    showView('analytics');
  };
  window.analyticsContext = () => {
    const r = range();
    const extra = (window.AnalyticsTabs || {})[ax.tab];
    if (extra) return extra.context();
    if (ax.tab === 'performance') return `Repository performance tab, ${ax.perf?.project?.name || 'no project'}, range ${r.from} to ${r.to}${ax.marker ? `, split before/after ${ax.marker}` : ''}`;
    return `range ${r.from} to ${r.to}, ${ax.scope === 'machine' ? 'every CLI session on this machine' : 'the orchestrator\'s runs'}`;
  };
})();
