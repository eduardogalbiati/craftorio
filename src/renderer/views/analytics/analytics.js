// Analytics: tokens and session metrics over a date range (default the last 30 days), for the
// orchestrator's runs or every CLI session on this machine (the same scopes as Usage). Charts are
// plain SVG/CSS. "Ask the supervisor" writes a report on the range (a real model call: it asks first).
// Two tabs (the selected one is remembered with the scope and range): Usage (the above) and Repository
// performance (#159: per project, the runs that hit a merge conflict, the runs at once, split
// before/after a marker; channel analytics:performance, src/repo-performance.js).
// #197, #254: the analysed project is the header's (window.CurrentProject), named at the top of that tab.
// #354: the files most runs edit (their recommendations, "Create issue", "Ask for a plan") moved to
// the project's Conflict map tab: a one-line link leads there (views/project/project-conflict-map.js).
// More tabs register in window.AnalyticsTabs before this file loads: Run (#228, analytics-run.js) and
// 24/7 (#188, analytics-occupancy.js), each { id, label, order, load(), render(body), sub(), context() };
// Agents (#280, analytics-agents.js) has `usesRange`: it keeps the date range controls and its load()
// gets the range.
// window.openAnalytics({ tab, runId }) opens a tab (the top bar's 24/7 chip, "Open in Analytics").
// Registers itself with registerView (view-registry.js).
// Uses app.js globals: api, esc, fmtTok, fmtUsd, fmtDur, fmtNum, dateOf, errMsg, markdownHtml, state, window.showRun.
(() => {
  const $a = (sel) => document.querySelector(sel);
  const LS = 'multiagent.analytics';
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
    // #383: a DateRange preset id (DateRange.PRESETS); null = custom from/to. The older `days` reads as
    // its preset: 7 as '7d', anything else (the dropped 90 days too) as '30d'.
    preset: (window.DateRange?.PRESETS || []).some((p) => p.id === saved.preset) ? saved.preset : saved.days === 7 ? '7d' : '30d',
    from: null, to: null,
    data: null, error: null, loading: false,
    report: null, reportError: null, analyzing: false,
    sortKey: 'tokens',
    // inline (not TAB_IDS): the Supervisor's context test evaluates this literal on its own
    tab: ['usage', 'performance', ...Object.keys(window.AnalyticsTabs || {})].includes(saved.tab) ? saved.tab : 'usage',
    project: null, // the project the performance on screen is of (asked for the header's, #254)
    marker: saved.marker || '',
    perf: null, perfError: null, perfLoading: false,
  };
  const persist = () => {
    try {
      localStorage.setItem(LS, JSON.stringify({ scope: ax.scope, preset: ax.preset, tab: ax.tab, marker: ax.marker }));
    } catch { /* ignore */ }
  };
  // #273: the owner's local days (time-zone.js; without it, UTC days)
  const today = () => (window.TimeZone ? window.TimeZone.dayKey(Date.now(), window.TimeZone.current()) : new Date().toISOString().slice(0, 10));
  const daysBack = (n) => (window.TimeZone ? window.TimeZone.shiftDay(today(), 1 - n) : new Date(Date.now() - (n - 1) * DAY).toISOString().slice(0, 10));
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const val = (x, f = fmtNum) => (x == null ? '—' : f(x));

  // the range asked for: All is the longest one the service reads (a year, src/analytics.js dateRange)
  function range() {
    if (ax.preset === 'all') return { from: daysBack(365), to: today() };
    const preset = ax.preset && window.DateRange?.presetRange(ax.preset, new Date(), window.TimeZone ? window.TimeZone.current() : 'UTC');
    if (preset) return preset;
    return { from: ax.from || daysBack(30), to: ax.to || today() };
  }
  // the From / To fields: All shows no range
  const shownRange = () => (ax.preset === 'all' ? { from: '', to: '' } : range());
  const rangeText = (r) => (ax.preset === 'all' ? 'all dates (the last year at most)' : `${r.from} to ${r.to}`);
  function renderRange() {
    const s = shownRange();
    document.querySelectorAll('#view-analytics [data-date-preset]').forEach((b) => {
      b.classList.toggle('active', b.dataset.datePreset === ax.preset);
      b.setAttribute('aria-pressed', String(b.dataset.datePreset === ax.preset));
    });
    $a('#an-from').value = s.from;
    $a('#an-to').value = s.to;
  }

  async function load() {
    if (ax.tab === 'performance') return loadPerf();
    const extra = extraTab(ax.tab);
    if (extra) {
      renderControls();
      await extra.load(range());
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
      // #254: the header's project; another one than the one on screen drops its issues and plan
      const projectId = window.CurrentProject.get();
      ax.perf = await api.getRepositoryPerformance({ projectId, marker: ax.marker, ...range() });
      ax.project = ax.perf.project?.id || null;
      ax.perfError = null;
    } catch (e) { ax.perfError = errMsg(e); }
    ax.perfLoading = false;
    render();
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
    document.querySelectorAll('#view-analytics .an-range').forEach((el) => el.classList.toggle('hidden', !!extra && !extra.usesRange));
    if (extra) {
      if (extra.usesRange) renderRange();
      $a('#an-sub').textContent = extra.sub();
      return;
    }
    if (perf) {
      if (document.activeElement !== $a('#an-marker')) $a('#an-marker').value = ax.marker;
      renderRange();
      $a('#an-refresh').disabled = ax.perfLoading;
      $a('#an-sub').textContent = `Files runs collide on and merge conflicts${ax.perf?.project ? ` in ${ax.perf.project.name}` : ''}, ${rangeText(r)}${ax.perfLoading ? ' — loading…' : ''}`;
      return;
    }
    document.querySelectorAll('#view-analytics [data-an-scope]').forEach((b) => b.classList.toggle('active', b.dataset.anScope === ax.scope));
    renderRange();
    $a('#an-refresh').disabled = ax.loading;
    $a('#an-analyze').disabled = ax.analyzing || !ax.data;
    $a('#an-analyze').textContent = ax.analyzing ? 'Analyzing…' : 'Ask the supervisor';
    $a('#an-sub').textContent = `${ax.scope === 'machine' ? 'Every Claude Code, Codex and Grok session on this machine' : 'The sessions of the orchestrator\'s runs'}, ${rangeText(r)}${ax.loading ? ' — loading…' : ''}`;
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
        return `<rect x="${(i * bw + pad).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 2 * pad).toFixed(1)}" height="${h.toFixed(1)}" style="fill:${PROVIDER_COLOR[p] || 'var(--muted)'}"><title>${esc(d.day)} ${I18n.t('analytics.value_t_tokens', { value: esc(PROVIDER_LABEL[p] || p), t: fmtTok(t) })}</title></rect>`;
      }).join('');
      return `<g>${parts}<rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" class="an-hit"><title>${esc(d.day)}${t('analytics.tokens_tokens', { tokens: fmtTok(d.tokens) })} ${fmtUsd(d.costUsd)}</title></rect></g>`;
    }).join('');
    const every = Math.ceil(days.length / 10);
    const labels = days.map((d, i) => (i % every === 0 ? `<span style="left:${((i + 0.5) / days.length) * 100}%">${esc(d.day.slice(5))}</span>` : '')).join('');
    return `<div class="an-chart"><div class="an-ymax muted small">${fmtTok(max)}</div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t('analytics.tokens_per_day')}">${bars}</svg><div class="an-xlabels">${labels}</div></div>`;
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
    if (!total) return `<p class="muted small">${t('analytics.none_recorded')}</p>`;
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
    if (ax.error) { body.innerHTML = `<div class="usage-unavailable">${I18n.t('analytics.could_not_load_analytics')} ${esc(ax.error)}</div>`; return; }
    const a = ax.data;
    if (!a) { body.innerHTML = `<p class="muted">${I18n.t('analytics.loading')}</p>`; return; }
    const m = a.metrics;
    const t = a.totals;
    const missing = a.scope === 'machine' && a.localAvailable && !Object.values(a.localAvailable).some(Boolean);
    body.innerHTML = `
      ${missing ? `<div class="usage-unavailable">${I18n.t('analytics.no_cli_transcripts_found_on_this')}</div>` : ''}
      <div class="an-totals">
        ${stat('Tokens', fmtTok(t.tokens.total), `${fmtNum(t.tokens.total)} tokens: input ${fmtNum(t.tokens.input)}, output ${fmtNum(t.tokens.output)}, cache read ${fmtNum(t.tokens.cache_read)}, cache write ${fmtNum(t.tokens.cache_write)}`)}
        ${stat('Cost', fmtUsd(t.costUsd), t.unpricedTokens ? `${fmtNum(t.unpricedTokens)} tokens have no price (set per-model prices in Usage)` : '')}
        ${stat('Sessions', fmtNum(t.sessions))}
        ${stat('Cache hit rate', pct(t.cacheHitRate), 'cache read / (input + cache read + cache write)')}
        ${stat('Active time', fmtDur(m.activeMs), `wall-clock ${fmtDur(m.durationMs)}; pauses over 5 minutes are idle time`)}
        ${stat('Tool calls', val(m.toolCalls), m.toolCalls == null ? 'Recorded in the CLIs\' transcripts, which these sessions do not have on this machine' : '')}
      </div>
      ${t.unpricedTokens ? `<p class="muted small an-note">${fmtTok(t.unpricedTokens)} ${I18n.t('analytics.tokens_have_no_cost_the_cli')}</p>` : ''}
      <div class="card an-card"><div class="row an-card-head"><h3>${I18n.t('analytics.tokens_per_day')}</h3><div class="an-legend">${Object.entries(PROVIDER_LABEL).map(([k, v]) => `<span><i style="background:${PROVIDER_COLOR[k]}"></i>${v}</span>`).join('')}</div></div>${dayChart(a.byDay)}</div>
      <div class="an-grid">
        <div class="card an-card"><h3>${I18n.t('analytics.by_provider')}</h3>${barList(a.byProvider.map((p) => ({ label: p.name, value: p.tokens, sub: `${fmtTok(p.tokens)} · ${fmtUsd(p.costUsd)} · ${p.sessions} sessions`, color: PROVIDER_COLOR[p.id] })))}</div>
        <div class="card an-card"><h3>${I18n.t('analytics.by_model')}</h3>${barList(a.byModel.map((x) => ({ label: x.model, value: x.tokens, sub: `${fmtTok(x.tokens)} · ${fmtUsd(x.costUsd)}`, color: PROVIDER_COLOR[x.provider] })))}</div>
        <div class="card an-card"><h3>${I18n.t('analytics.by_project')}</h3>${barList(a.byProject.map((p) => ({ label: p.name, value: p.tokens, sub: `${fmtTok(p.tokens)} · ${p.sessions} sessions` })))}</div>
      </div>
      <div class="an-grid">
        <div class="card an-card"><h3>${I18n.t('analytics.tool_calls')}</h3>${stack(m.toolMix, TOOL_COLOR)}
          <div class="u-breakdown an-facts"><span>${I18n.t('analytics.failed')} <b>${val(m.failedToolCalls)}</b></span><span>${I18n.t('analytics.permission_denials')} <b>${val(m.permissionDenials)}</b></span><span>${I18n.t('analytics.interrupts')} <b>${val(m.interrupts)}</b></span><span>${I18n.t('analytics.compactions')} <b>${val(m.compactions)}</b></span></div></div>
        <div class="card an-card"><h3>${I18n.t('analytics.work')}</h3><div class="u-breakdown an-facts">
          <span>${I18n.t('analytics.prompts')} <b>${val(m.userPrompts)}</b></span><span>${I18n.t('analytics.assistant_turns')} <b>${val(m.assistantTurns)}</b></span>
          <span>${I18n.t('analytics.files_touched')} <b>${val(m.filesTouched)}</b></span><span>${I18n.t('analytics.lines')} <b>${m.linesAdded == null ? '—' : `+${fmtNum(m.linesAdded)} −${fmtNum(m.linesRemoved)}`}</b></span>
          <span>${I18n.t('analytics.avg_session')} <b>${fmtDur(m.avgDurationMs)}</b> ${I18n.t('analytics.active')} <b>${fmtDur(m.avgActiveMs)}</b>)</span><span>${I18n.t('analytics.peak_context')} <b>${val(m.peakContext, fmtTok)}</b></span></div>
          <h4 class="small muted">${I18n.t('analytics.complexity')}${m.avgComplexity != null ? ` (average ${Math.round(m.avgComplexity)}/100)` : ''}</h4>${stack(m.complexity, { low: 'var(--green)', medium: 'var(--yellow)', high: 'var(--red)' })}</div>
        <div class="card an-card"><h3>${I18n.t('analytics.session_types')} <span class="muted small" title="${I18n.t('analytics.from_the_first_prompt_and_the')}">${I18n.t('analytics.heuristic')}</span></h3>${stack(m.intents, { coding: 'var(--green)', debugging: 'var(--red)', review: 'var(--purple)', docs: 'var(--yellow)', research: 'var(--accent)', other: 'var(--muted)' })}
          ${a.runs.total ? `<h4 class="small muted">${I18n.t('analytics.runs')}</h4><div class="u-breakdown an-facts"><span>${I18n.t('analytics.runs_2')} <b>${a.runs.total}</b></span>${Object.entries(a.runs.byStatus).map(([k, v]) => `<span>${esc(k)} <b>${v}</b></span>`).join('')}<span>${I18n.t('analytics.waiting')} <b>${fmtDur(a.runs.waitingMs)}</b></span><span>${I18n.t('analytics.supervisor_turns')} <b>${a.runs.supervisorTurns}</b></span></div>` : ''}</div>
      </div>
      <div id="an-report"></div>
      <h3 class="s-subtitle">${I18n.t('analytics.sessions')}${a.sessionsTruncated ? ` <span class="muted small">${I18n.t('analytics.the_length_largest', { length: a.sessions.length })}</span>` : ''}</h3>
      <div class="card table-wrap">${sessionsTable(a.sessions)}</div>`;
    renderReport();
  }

  const SORTS = {
    tokens: (s) => s.tokens.total, start: (s) => Date.parse(s.start || 0), active: (s) => s.activeMs || 0,
    tools: (s) => s.toolCallsTotal || 0, complexity: (s) => s.complexity || 0, cost: (s) => s.costUsd || 0,
  };
  function sessionsTable(list) {
    if (!list.length) return `<p class="muted small an-empty">${t('analytics.no_sessions_in_this_range')}</p>`;
    const rows = [...list].sort((a, b) => SORTS[ax.sortKey](b) - SORTS[ax.sortKey](a)).slice(0, 100);
    const toolCallsTitle = (s) => Object.entries(s.toolCalls || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ');
    const th = (key, label) => `<th class="num an-sort${ax.sortKey === key ? ' active' : ''}" data-an-sort="${key}">${label}</th>`;
    return `<table class="u-table an-sessions"><thead><tr><th>${t('analytics.session')}</th><th>${t('analytics.project')}</th>${th('start', t('analytics.start'))}${th('active', t('analytics.active'))}<th class="num">${t('analytics.prompts_2')}</th>${th('tools', t('analytics.tools'))}<th class="num">${t('analytics.files')}</th>${th('tokens', t('analytics.tokens'))}<th class="num">${t('analytics.cache')}</th>${th('cost', t('analytics.cost'))}${th('complexity', t('analytics.complexity'))}</tr></thead><tbody>
      ${rows.map((s) => `<tr>
        <td class="an-title"><span class="pill" style="color:${PROVIDER_COLOR[s.provider]}">${esc(PROVIDER_LABEL[s.provider] || s.provider)}</span> <span title="${esc(s.title || s.id || '')}">${esc(s.title || (s.run ? `${s.run.workflow || 'run'} · ${s.run.agent || ''}` : s.id || '—'))}</span>
          <div class="muted small">${esc(s.model || '')} · ${esc(s.intent)}${s.run ? ` · run ${esc(s.run.runId)}` : ''}</div></td>
        <td>${esc(s.project || '—')}</td>
        <td class="num nowrap">${s.start ? esc(dateOf(s.start)) : '—'}</td>
        <td class="num nowrap" title="${t('analytics.wall_clock_durationms', { durationMs: esc(fmtDur(s.durationMs)) })}">${fmtDur(s.activeMs)}</td>
        <td class="num">${val(s.userPrompts)}</td>
        <td class="num" title="${esc(toolCallsTitle(s))}">${val(s.toolCallsTotal)}${s.failedToolCalls ? ` <span class="muted">${t('analytics.failedtoolcalls_failed', { failedToolCalls: s.failedToolCalls })}</span>` : ''}</td>
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
    if (ax.analyzing) { box.innerHTML = `<div class="card an-card an-report"><p class="muted">${t('analytics.the_supervisor_is_reading_the_sessions')}</p></div>`; return; }
    if (ax.reportError) { box.innerHTML = `<div class="usage-unavailable">${t('analytics.the_supervisor_s_report_failed')} ${esc(ax.reportError)}</div>`; return; }
    if (!ax.report) { box.innerHTML = ''; return; }
    const r = ax.report;
    box.innerHTML = `<div class="card an-card an-report"><div class="md">${markdownHtml(r.markdown)}</div>
      <p class="muted small">${t('analytics.saved_in')} ${esc(r.reportPath)}${r.costUsd ? ` · ${fmtUsd(r.costUsd)}` : ''}</p></div>`;
  }

  // ---- Repository performance (#159) ------------------------------------------------------
  // #197: the analysed project (#254: the one chosen in the header), at the top of the tab, and what the page counts
  function projectHeader(p) {
    const pr = p.project;
    const summary = pr ? `<b>${esc(pr.name)}</b> ${t('analytics.value_run_value2_value3_to', { value: fmtNum(p.runs || 0), value2: p.runs === 1 ? '' : 's', value3: esc(p.from || '') })} ${esc(p.to || '')}` : '';
    return `<div class="card an-project-shown" title="${t('analytics.the_project_chosen_in_the_header')}">
      <span class="small muted">${t('analytics.project_analysed')}</span>
      <div class="an-project-summary" data-testid="an-project-summary"><div>${summary}</div>${pr?.folder ? `<div class="muted small mono an-file" title="${esc(pr.folder)}">${esc(pr.folder)}</div>` : ''}</div>
    </div>`;
  }

  function conflictsTable(list) {
    if (!list.length) return `<p class="muted small an-empty">${t('analytics.no_run_hit_a_merge_conflict')}</p>`;
    return `<table class="u-table an-sessions"><thead><tr><th>${t('analytics.run')}</th><th class="num">${t('analytics.started')}</th><th>${t('analytics.through')}</th><th class="num">${t('analytics.cost')}</th><th>${t('analytics.files_the_conflict_named')}</th></tr></thead><tbody>
      ${list.map((c) => `<tr>
        <td class="an-title"><button type="button" class="link-btn" data-an-run="${esc(c.runId)}" data-workflow="${esc(c.workflow || '')}" title="${esc(c.title)}">${esc(c.title)}</button>
          <div class="muted small">${esc(c.runId)} · <span data-status="${esc(c.status || '')}">${esc(c.status ? StatusPill.statusLabel(c.status) : '')}</span></div></td>
        <td class="num nowrap">${c.startedAt ? esc(dateOf(c.startedAt)) : '—'}</td>
        <td><span class="badge${c.via === 'failed PR/MR merge' ? ' warn' : ''}">${esc(c.via)}</span></td>
        <td class="num">${fmtUsd(c.costUsd)}</td>
        <td class="small">${c.files.length ? c.files.map((f) => `<code>${esc(f)}</code>`).join(' ') : `<span class="muted">${t('analytics.not_named')}</span>`}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  function parallelCard(par) {
    const maxH = Math.max(1, ...par.hours);
    const hours = `<div class="an-hours" role="img" aria-label="${t('analytics.runs_active_per_hour_of_the')}">${par.hours.map((n, h) => `<span title="${t('analytics.value_00_n_run_value2_active', { value: String(h).padStart(2, '0'), n, value2: n === 1 ? '' : 's' })}"><i style="height:${Math.max(n ? 4 : 0, (n / maxH) * 100)}%"></i><em>${h % 3 === 0 ? h : ''}</em></span>`).join('')}</div>`;
    const days = par.days.length ? `<table class="u-table an-sessions"><thead><tr><th>${t('analytics.day')}</th><th class="num">${t('analytics.runs_started')}</th><th class="num" title="${t('analytics.the_most_runs_active_at_the')}">${t('analytics.at_once_peak')}</th><th class="num" title="${t('analytics.roadmap_stages_among_the_runs_at')}">${t('analytics.roadmap_stages')}</th><th class="num">${t('analytics.hit_a_conflict')}</th></tr></thead><tbody>
      ${[...par.days].reverse().map((d) => `<tr><td class="nowrap">${esc(d.day)}</td><td class="num">${d.runs}</td><td class="num">${d.peak}</td><td class="num">${d.stages || '—'}</td><td class="num">${d.conflicts ? `<span class="badge warn">${d.conflicts}</span>` : 0}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted small an-empty">${t('analytics.no_runs_in_this_range')}</p>`;
    return `<div class="card an-card"><h3>${t('analytics.hours_runs_were_active')} <span class="muted small">${t('analytics.local_time_runs_per_hour_of')}</span></h3>${hours}</div>
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
    return `<div class="card table-wrap an-compare"><table class="u-table"><thead><tr><th>${t('analytics.split_at_value', { value: esc(c.commit ? `${c.marker} (${c.commit.slice(0, 8)})` : c.marker) })} ${esc(dateOf(c.at))}</th><th class="num">${t('analytics.before')}</th><th class="num">${t('analytics.after')}</th><th class="num">${t('analytics.difference')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderPerf() {
    const body = $a('#an-body');
    if (ax.perfError) { body.innerHTML = `<div class="usage-unavailable">${t('analytics.could_not_load_repository_performance')} ${esc(ax.perfError)}</div>`; return; }
    const p = ax.perf;
    if (!p) { body.innerHTML = `<p class="muted">${t('analytics.loading')}</p>`; return; }
    if (!p.project) { body.innerHTML = `<div class="empty-state"><b>${t('analytics.no_projects_yet')}</b><p class="muted">${t('analytics.add_a_project_with_a_git')}</p></div>`; return; }
    const notGit = p.project.isGit ? '' : `<div class="usage-unavailable">${esc(p.project.name)}${t('analytics.s_folder_is_not_a_git')}</div>`;
    const head = projectHeader(p);
    // #354: the files most runs edit moved to the project's Conflict map tab (views/project/project-conflict-map.js)
    const link = window.ProjectConflictMap ? window.ProjectConflictMap.linkHtml(p.project.id) : '';
    if (p.empty) {
      body.innerHTML = `${head}${notGit}${link}<div class="empty-state"><b>${t('analytics.no_runs_with_commits_on_this')}</b><p class="muted">${t('analytics.runs_count_once_their_work_is')}</p></div>`;
      return;
    }
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
      ${link}
      <h3 class="s-subtitle">${t('analytics.merge_conflicts')}</h3>
      <div class="card table-wrap">${conflictsTable(p.conflicts)}</div>
      <h3 class="s-subtitle">${t('analytics.parallel_work')}</h3>
      ${parallelCard(p.parallel)}`;
  }

  function wire() {
    const view = $a('#view-analytics');
    if (!view || view.dataset.wired) return;
    view.dataset.wired = '1';
    view.addEventListener('click', (e) => {
      const scope = e.target.closest('[data-an-scope]');
      const preset = e.target.closest('[data-date-preset]');
      const sort = e.target.closest('[data-an-sort]');
      const tab = e.target.closest('[data-an-tab]');
      const run = e.target.closest('[data-an-run]');
      if (window.ProjectConflictMap?.onLinkClick(e)) return;
      if (tab && tab.dataset.anTab !== ax.tab) { ax.tab = tab.dataset.anTab; persist(); render(); load(); }
      if (run) window.showRun(run.dataset.anRun, { workflow: run.dataset.workflow || undefined });
      if (scope) { ax.scope = scope.dataset.anScope; ax.report = null; persist(); load(); }
      if (preset) { ax.preset = preset.dataset.datePreset; ax.report = null; persist(); load(); }
      if (sort && ax.data) {
        ax.sortKey = sort.dataset.anSort;
        const wrap = $a('.an-sessions')?.parentElement;
        if (wrap) wrap.innerHTML = sessionsTable(ax.data.sessions);
      }
    });
    const onDate = () => {
      ax.preset = null;
      ax.from = $a('#an-from').value || null;
      ax.to = $a('#an-to').value || null;
      ax.report = null;
      persist(); load();
    };
    $a('#an-from').addEventListener('change', onDate);
    $a('#an-to').addEventListener('change', onDate);
    $a('#an-marker').addEventListener('change', (e) => { ax.marker = e.target.value.trim(); persist(); load(); });
    $a('#an-refresh').addEventListener('click', load);
    $a('#an-analyze').addEventListener('click', analyze);
  }

  registerView({
    id: 'analytics',
    // #255: a tab of Home (views/dashboard/), without a menu entry: Home's section holds `panel`,
    // showView('analytics') opens Home on this tab
    section: 'dashboard',
    menu: 'dashboard',
    panel: `
      <div id="view-analytics" class="hidden" role="tabpanel">
        <div class="page-head">
          <div>
            <h1>${t('analytics.analytics')}</h1>
            <p class="muted small" id="an-sub">${t('analytics.tokens_and_session_metrics')}</p>
          </div>
          <div class="row an-controls">
            <div class="seg an-usage-only" role="group" aria-label="${t('analytics.analytics_scope')}"><button type="button" data-an-scope="orchestrator">${t('analytics.orchestrator')}</button><button type="button" data-an-scope="machine">${t('analytics.this_machine')}</button></div>
            <div class="an-range">${window.DateRange.fields({ testid: 'analytics-date-range', fromAttrs: 'id="an-from"', toAttrs: 'id="an-to"', presets: true })}</div>
            <label class="an-date small muted an-perf-only hidden" title="${t('analytics.a_date_yyyy_mm_dd_or')}">${t('analytics.before_after')} <input type="text" id="an-marker" class="an-marker" placeholder="${t('analytics.date_or_commit')}" /></label>
            <button class="btn" id="an-refresh" type="button">${t('analytics.refresh')}</button>
            <button class="btn primary an-usage-only" id="an-analyze" type="button" title="${t('analytics.the_supervisor_writes_a_report_on')}">${t('analytics.ask_the_supervisor')}</button>
          </div>
        </div>
        <div class="tabs page-tabs" role="tablist" aria-label="${t('analytics.analytics')}"><button type="button" class="tab" role="tab" data-an-tab="usage">${t('analytics.usage')}</button><button type="button" class="tab" role="tab" data-an-tab="performance" title="${t('analytics.repository_performance_how_well_the_repository')}">${t('analytics.performance')}</button>${extraTabs().map((t) => `<button type="button" class="tab" role="tab" data-an-tab="${t.id}" data-testid="an-tab-${t.id}">${t.label}</button>`).join('')}</div>
        <div id="an-body"></div>
      </div>`,
    show() {
      paintHomeTabs();
      wire(); // once: the panel is in place when Home is
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
