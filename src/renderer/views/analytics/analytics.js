// Analytics: tokens and session metrics over a date range (default the last 30 days), for the
// orchestrator's runs or every CLI session on this machine (the same scopes as Usage). Charts are
// plain SVG/CSS. "Ask the supervisor" writes a report on the range (a real model call: it asks first).
// Registers itself with registerView (view-registry.js).
// Uses app.js globals: api, esc, fmtTok, fmtUsd, fmtDur, fmtNum, dateOf, errMsg, markdownHtml, state.
(() => {
  const $a = (sel) => document.querySelector(sel);
  const LS = 'multiagent.analytics';
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
  };
  const persist = () => { try { localStorage.setItem(LS, JSON.stringify({ scope: ax.scope, days: ax.days })); } catch { /* ignore */ } };
  const today = () => new Date().toISOString().slice(0, 10);
  const daysBack = (n) => new Date(Date.now() - (n - 1) * DAY).toISOString().slice(0, 10);
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const val = (x, f = fmtNum) => (x == null ? '—' : f(x));

  function range() {
    if (ax.days) return { from: daysBack(ax.days), to: today() };
    return { from: ax.from || daysBack(30), to: ax.to || today() };
  }

  async function load() {
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

  function renderControls() {
    const r = range();
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

  function wire() {
    const view = $a('#view-analytics');
    if (!view || view.dataset.wired) return;
    view.dataset.wired = '1';
    view.addEventListener('click', (e) => {
      const scope = e.target.closest('[data-an-scope]');
      const days = e.target.closest('[data-an-days]');
      const sort = e.target.closest('[data-an-sort]');
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
            <div class="seg" role="group" aria-label="Analytics scope"><button type="button" data-an-scope="orchestrator">Orchestrator</button><button type="button" data-an-scope="machine">This machine</button></div>
            <div class="seg sm" role="group" aria-label="Quick range"><button type="button" data-an-days="7">7 days</button><button type="button" data-an-days="30">30 days</button><button type="button" data-an-days="90">90 days</button></div>
            <label class="an-date small muted">From <input type="date" id="an-from" /></label>
            <label class="an-date small muted">To <input type="date" id="an-to" /></label>
            <button class="btn" id="an-refresh" type="button">Refresh</button>
            <button class="btn primary" id="an-analyze" type="button" title="The supervisor writes a report on these sessions (a real model call)">Ask the supervisor</button>
          </div>
        </div>
        <div id="an-body"></div>
      </section>`,
    mount: wire,
    show() {
      render();
      load();
    },
  });
  // what the Supervisor is told about this screen (supervisor-chat.js)
  window.analyticsContext = () => {
    const r = range();
    return `range ${r.from} to ${r.to}, ${ax.scope === 'machine' ? 'every CLI session on this machine' : 'the orchestrator\'s runs'}`;
  };
})();
