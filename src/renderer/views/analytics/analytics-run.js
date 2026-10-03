// Analytics › Run (#228): one run in depth. Pick a run (search by id, issue or title; "Open in
// Analytics" from the run page and the runs list: window.openAnalytics({ tab: 'run', runId })). Shows
// its header (workflow, issues, status, cost, duration, active vs waiting at gates), a Gantt timeline
// (one row per agent in its role colour, #224, and one for the orchestrator's machine steps; gate waits
// hatched), per-agent time, turns, cost and tokens (new input, output, cache read, cache creation, the
// effective $/M), steps, suite rounds, the slowest tool calls, and the comparison with the latest real
// successful runs of the same workflow (median, p25-p75, better/worse with signs, not colour only).
// Channel analytics:run (src/service/areas/insights.js, src/run-analysis.js). A tab of
// views/analytics/analytics.js (window.AnalyticsTabs).
// Uses app.js globals: api, esc, fmtTok, fmtUsd, fmtDur, fmtNum, dateOf, errMsg, window.showRun.
(() => {
  const SS = 'multiagent.analytics.run';
  const TOKEN_COLORS = { input: 'var(--accent)', output: 'var(--green)', cache_read: 'var(--purple)', cache_write: 'var(--orange)' };
  const TOKEN_LABELS = { input: 'new input', output: 'output', cache_read: 'cache read', cache_write: 'cache creation' };
  const FIGURES = [['costUsd', 'Total cost', 'usd'], ['durationMs', 'Duration', 'ms'], ['costPerIssue', 'Cost per issue', 'usd']];
  const rx = {
    runId: (() => { try { return sessionStorage.getItem(SS) || null; } catch { return null; } })(),
    query: '', runs: [], data: null, error: null, loading: false,
  };
  const colorOf = (agent) => (agent === 'orchestrator' ? 'var(--muted)' : window.AgentColors?.colorFor?.(agent) || 'var(--accent)');
  const fmt = (v, kind) => (v == null ? '—' : kind === 'usd' ? fmtUsd(v) : kind === 'ms' ? fmtDur(v) : fmtNum(v));
  const issuesText = (list) => (list || []).map((i) => `#${i?.number ?? i}`).join(' ');

  async function load() {
    rx.loading = true;
    try {
      const out = await api.getRunAnalysis({ runId: rx.runId || undefined });
      rx.runs = out.runs || [];
      // nothing picked yet: the latest finished run
      if (!rx.runId && rx.runs.length) {
        const pick = rx.runs.find((r) => !r.mock && r.status === 'success') || rx.runs.find((r) => r.status !== 'running') || rx.runs[0];
        rx.runId = pick.runId;
        rx.data = await api.getRunAnalysis({ runId: rx.runId });
      } else rx.data = rx.runId ? out : null;
      rx.error = null;
    } catch (e) {
      // the remembered run is gone (deleted): the latest one instead
      if (rx.runId && /Run not found/.test(errMsg(e))) { select(null); rx.loading = false; return load(); }
      rx.error = errMsg(e); rx.data = null;
    }
    rx.loading = false;
  }

  function select(runId) {
    rx.runId = runId || null;
    rx.data = null;
    try { if (rx.runId) sessionStorage.setItem(SS, rx.runId); } catch { /* ignore */ }
  }

  // ---- pieces -----------------------------------------------------------------------------------
  function options() {
    const q = rx.query.trim().toLowerCase();
    const match = (r) => !q || [r.runId, r.title, r.workflow, issuesText(r.issues)].some((x) => String(x || '').toLowerCase().includes(q));
    const list = rx.runs.filter(match).slice(0, 80);
    if (rx.runId && !list.some((r) => r.runId === rx.runId)) {
      const cur = rx.runs.find((r) => r.runId === rx.runId);
      if (cur) list.unshift(cur);
    }
    return list.length ? list.map((r) => `<option value="${esc(r.runId)}"${r.runId === rx.runId ? ' selected' : ''}>${esc(r.title)}${r.issues?.length ? ` · ${esc(issuesText(r.issues))}` : ''} · ${esc(r.workflow || '')} · ${r.startedAt ? esc(dateOf(r.startedAt)) : ''}${r.mock ? ' · simulated' : ''}</option>`).join('') : '<option value="">No run matches</option>';
  }
  function picker() {
    return `<div class="card an-project-pick an-run-pick">
      <label class="an-field"><span class="small muted">Search runs</span><input type="text" id="an-run-search" data-testid="an-run-search" placeholder="Run id, issue (#219) or title" value="${esc(rx.query)}" /></label>
      <label class="an-field"><span class="small muted">Run</span><select id="an-run-pick" data-testid="an-run-pick" aria-label="Run">${options()}</select></label>
    </div>`;
  }

  // "▲ +46% · $7.00 more than the median"; the verdict also in a word, not colour only
  function diffText(c, kind) {
    if (!c) return '<span class="muted small">—</span>';
    if (c.verdict === 'same') return '<span class="an-verdict neutral">= the median</span>';
    const sign = c.diff > 0 ? '▲ +' : '▼ −';
    const pctText = c.diffPct == null ? '' : `${sign}${Math.abs(Math.round(c.diffPct))}% · `;
    return `<span class="an-verdict ${esc(c.level)}" title="${c.verdict === 'worse' ? 'Worse' : 'Better'} than the median of the compared runs (p25–p75: ${esc(fmt(c.p25, kind))} – ${esc(fmt(c.p75, kind))})">${pctText}${esc(fmt(Math.abs(c.diff), kind))} ${c.diff > 0 ? 'more' : 'less'} than the median · <b>${c.verdict}</b></span>`;
  }

  function header(f, cmp) {
    const stat = (label, value, title = '') => `<div class="u-stat"${title ? ` title="${esc(title)}"` : ''}><label>${esc(label)}</label><b>${value}</b></div>`;
    return `<div class="card an-card an-run-head" data-testid="an-run-header">
        <div class="row an-card-head"><div><h3 class="an-run-title" title="${esc(f.title || f.runId)}">${esc(f.title || f.workflow || f.runId)}</h3>
          <div class="muted small"><span class="badge">${esc(f.workflow || '—')}</span> ${f.issues?.length ? esc(issuesText(f.issues)) : ''} · <span class="mono" title="${esc(f.runId)}">${esc(f.runId)}</span>${f.startedAt ? ` · ${esc(dateOf(f.startedAt))}` : ''}${f.mock ? ' · <span class="badge">simulated</span>' : ''}</div></div>
          <div class="row"><span class="badge ${f.status === 'success' ? 'cat-monitor' : f.status === 'failed' ? 'warn' : ''}">${esc(f.status)}</span><button type="button" class="btn sm ghost" data-an-open-run="${esc(f.runId)}" data-workflow="${esc(f.file || '')}">Open run</button></div></div>
        <div class="an-totals">
          ${stat('Total cost', fmtUsd(f.costUsd))}
          ${stat('Cost per issue', fmt(f.costPerIssue, 'usd'))}
          ${stat('Duration', fmtDur(f.durationMs))}
          ${stat('Active', fmtDur(f.activeMs), 'The duration minus the time waiting for you at gates')}
          ${stat('Waiting at gates', fmtDur(f.gateWaitMs), f.gates.map((g) => `${g.gate}: ${fmtDur(g.waitMs)}`).join(', '))}
          ${stat('Suite rounds', fmtNum(f.suiteRounds.length))}
        </div>
        ${comparison(f, cmp)}
      </div>`;
  }

  function comparison(f, cmp) {
    if (!cmp) return '';
    if (cmp.tooFew) return `<p class="muted small an-note" data-testid="an-run-compare">Only ${cmp.count} other successful real run${cmp.count === 1 ? '' : 's'} of ${esc(f.workflow || 'this workflow')}: at least ${cmp.minRuns} are needed to compare.</p>`;
    const rows = FIGURES.map(([key, label, kind]) => {
      const c = cmp.metrics[key];
      return `<tr><td>${esc(label)}</td><td class="num">${esc(fmt(f[key], kind))}</td><td class="num">${c ? esc(fmt(c.median, kind)) : '—'}</td><td class="num nowrap">${c ? `${esc(fmt(c.p25, kind))} – ${esc(fmt(c.p75, kind))}` : '—'}</td><td>${diffText(c, kind)}</td></tr>`;
    }).join('');
    return `<h4 class="small muted" data-testid="an-run-compare">Compared with the last ${cmp.count} successful real runs of ${esc(f.workflow || 'this workflow')}</h4>
      <div class="table-wrap"><table class="u-table an-sessions"><thead><tr><th>Figure</th><th class="num">This run</th><th class="num">Median</th><th class="num">p25 – p75</th><th>Difference</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // The Gantt: one row per agent (role colour) and the orchestrator's machine steps; gates hatched.
  function timeline(f) {
    const t0 = Date.parse(f.startedAt || f.timeline[0]?.from || 0);
    const t1 = Math.max(Date.parse(f.finishedAt || 0) || 0, ...f.timeline.map((b) => Date.parse(b.to)), ...f.gates.map((g) => Date.parse(g.to || 0) || 0));
    if (!f.timeline.length || !(t1 > t0)) return '<p class="muted small an-empty">No step recorded.</p>';
    const rows = [...new Set(f.timeline.map((b) => b.row))].sort((a, b) => (a === 'orchestrator') - (b === 'orchestrator'));
    const W = 1000;
    const RH = 26;
    const LW = 130;
    const H = (rows.length + 1) * RH;
    const x = (t) => LW + ((Date.parse(t) - t0) / (t1 - t0)) * (W - LW - 6);
    const bars = f.timeline.map((b) => {
      const y = rows.indexOf(b.row) * RH + 4;
      const w = Math.max(2, x(b.to) - x(b.from));
      return `<rect x="${x(b.from).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${RH - 8}" rx="3" style="fill:${colorOf(b.row)}"><title>${esc(b.step)} · visit ${b.visit} · ${esc(fmtDur(b.durationMs))}${b.costUsd ? ` · ${esc(fmtUsd(b.costUsd))}` : ''}</title></rect>
        ${w > 60 ? `<text x="${(x(b.from) + 4).toFixed(1)}" y="${y + RH / 2 + 1}" class="an-gantt-label">${esc(b.step)}</text>` : ''}`;
    }).join('');
    const gy = rows.length * RH + 4;
    const gates = f.gates.map((g) => {
      const to = g.to || f.finishedAt || new Date(t1).toISOString();
      const w = Math.max(2, x(to) - x(g.from));
      return `<rect x="${x(g.from).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H - 4}" class="an-gantt-gate"><title>Waiting at the gate "${esc(g.gate)}": ${esc(fmtDur(g.waitMs))}</title></rect>
        <text x="${(x(g.from) + 4).toFixed(1)}" y="${gy + RH / 2 + 1}" class="an-gantt-label muted">${esc(g.gate)} · ${esc(fmtDur(g.waitMs))}</text>`;
    }).join('');
    const labels = [...rows, 'gates'].map((r, i) => `<text x="4" y="${i * RH + RH / 2 + 2}" class="an-gantt-row">${esc(r === 'gates' ? 'waiting for you' : r)}</text>`).join('');
    return `<div class="an-gantt" data-testid="an-run-timeline"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline of the run by agent">
      <defs><pattern id="an-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="an-hatch-line" /></pattern></defs>
      ${gates}${bars}${labels}</svg>
      <div class="an-xlabels"><span style="left:${(LW / W) * 100}%">${esc(dateOf(new Date(t0).toISOString()))}</span><span style="left:96%">${esc(fmtDur(t1 - t0))}</span></div></div>`;
  }

  function hbars(items, { stacked = false } = {}) {
    const list = items.filter((x) => (stacked ? x.parts.reduce((s, p) => s + p.value, 0) : x.value) > 0);
    if (!list.length) return '<p class="muted small">None recorded.</p>';
    const totalOf = (x) => (stacked ? x.parts.reduce((s, p) => s + p.value, 0) : x.value);
    const max = Math.max(...list.map(totalOf));
    return `<div class="an-bars">${list.map((x) => `<div class="an-bar" title="${esc(x.title || x.label)}">
        <span class="an-bar-label">${x.chip || esc(x.label)}</span>
        <span class="an-bar-track">${stacked
    ? x.parts.filter((p) => p.value > 0).map((p) => `<span style="width:${(p.value / max) * 100}%;background:${p.color}" title="${esc(p.title)}"></span>`).join('')
    : `<span style="width:${Math.max(1, (x.value / max) * 100)}%;background:${x.color}"></span>`}</span>
        <span class="an-bar-val">${esc(x.sub)}</span></div>`).join('')}</div>`;
  }

  function agentCharts(f, cmp) {
    const chip = (a) => `<span class="an-agent"><i style="background:${colorOf(a)}"></i>${esc(a)}</span>`;
    const time = hbars(f.agents.map((a) => ({
      label: a.agent, chip: chip(a.agent), sub: `${fmtDur(a.activeMs)} active · ${fmtDur(a.waitingMs)} on tools`, title: `${a.agent}: ${fmtDur(a.activeMs)} active, ${fmtDur(a.waitingMs)} waiting on tools`,
      parts: [{ value: a.activeMs, color: colorOf(a.agent), title: `active ${fmtDur(a.activeMs)}` }, { value: a.waitingMs, color: 'var(--muted)', title: `waiting on tools ${fmtDur(a.waitingMs)}` }],
    })), { stacked: true });
    const turns = hbars(f.agents.map((a) => ({ label: a.agent, chip: chip(a.agent), value: a.turns, sub: `${fmtNum(a.turns)} turn${a.turns === 1 ? '' : 's'}`, color: colorOf(a.agent) })));
    const cost = hbars(f.agents.map((a) => {
      const c = cmp?.agents?.[a.agent]?.costUsd;
      return { label: a.agent, chip: chip(a.agent), value: a.costUsd, sub: `${fmtUsd(a.costUsd)}${c ? ` (${c.diff > 0 ? '▲' : c.diff < 0 ? '▼' : '='} median ${fmtUsd(c.median)})` : ''}`, color: colorOf(a.agent) };
    }));
    const tokens = hbars(f.agents.map((a) => ({
      label: a.agent, chip: chip(a.agent), sub: `${fmtTok(a.totalTokens)} · ${a.usdPerMTokens == null ? '—' : `${fmtUsd(a.usdPerMTokens)}/M`}`,
      title: `${a.agent}: ${Object.keys(TOKEN_LABELS).map((k) => `${TOKEN_LABELS[k]} ${fmtNum(a.tokens[k])}`).join(', ')}; effective ${a.usdPerMTokens == null ? '—' : fmtUsd(a.usdPerMTokens)} per million tokens`,
      parts: Object.keys(TOKEN_LABELS).map((k) => ({ value: a.tokens[k], color: TOKEN_COLORS[k], title: `${TOKEN_LABELS[k]}: ${fmtNum(a.tokens[k])}` })),
    })), { stacked: true });
    return `<div class="an-grid">
        <div class="card an-card"><h3>Time per agent <span class="muted small">(active, then waiting on tools)</span></h3>${time}</div>
        <div class="card an-card"><h3>Turns per agent</h3>${turns}</div>
        <div class="card an-card"><h3>Cost per agent</h3>${cost}</div>
      </div>
      <div class="card an-card"><div class="row an-card-head"><h3>Tokens per agent <span class="muted small">(and the effective $/M tokens)</span></h3>
        <div class="an-legend">${Object.keys(TOKEN_LABELS).map((k) => `<span><i style="background:${TOKEN_COLORS[k]}"></i>${TOKEN_LABELS[k]}</span>`).join('')}</div></div>${tokens}</div>`;
  }

  function tables(f) {
    const steps = f.steps.length ? `<table class="u-table an-sessions"><thead><tr><th>Step</th><th>Agent</th><th class="num">Visits</th><th class="num">Duration</th></tr></thead><tbody>
      ${f.steps.map((s) => `<tr><td>${esc(s.step)}</td><td>${s.agent ? `<span class="an-agent"><i style="background:${colorOf(s.agent)}"></i>${esc(s.agent)}</span>` : '<span class="muted">orchestrator</span>'}</td><td class="num">${s.visits}</td><td class="num">${fmtDur(s.durationMs)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted small an-empty">No step recorded.</p>';
    const suite = f.suiteRounds.length ? `<table class="u-table an-sessions"><thead><tr><th class="num">Round</th><th>Result</th><th class="num">Duration</th><th class="num">Failures</th><th class="num">Pre-existing</th></tr></thead><tbody>
      ${f.suiteRounds.map((r) => `<tr><td class="num">${r.round}</td><td><span class="badge ${r.status === 'pass' ? 'cat-monitor' : 'warn'}">${esc(r.status || '—')}</span></td><td class="num">${fmtDur(r.durationMs)}</td><td class="num">${r.failures}</td><td class="num">${r.preexisting}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted small an-empty">No suite round in this run.</p>';
    const tools = f.slowestTools.length ? `<table class="u-table an-sessions"><thead><tr><th>Command</th><th>Agent</th><th class="num">Time</th></tr></thead><tbody>
      ${f.slowestTools.map((t) => `<tr><td class="an-title"><code class="an-file" title="${esc(t.command)}">${esc(t.command)}</code></td><td>${esc(t.agent || '—')}</td><td class="num">${fmtDur(t.durationMs)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted small an-empty">No tool call recorded.</p>';
    return `<div class="an-grid an-grid-2">
        <div><h3 class="s-subtitle">Steps</h3><div class="card table-wrap">${steps}</div></div>
        <div><h3 class="s-subtitle">Suite rounds</h3><div class="card table-wrap">${suite}</div></div>
      </div>
      <h3 class="s-subtitle">Slowest tool calls <span class="muted small">(top 10)</span></h3><div class="card table-wrap">${tools}</div>`;
  }

  function render(body) {
    const head = picker();
    if (rx.error) { body.innerHTML = `${head}<div class="usage-unavailable" role="alert">Could not load the run: ${esc(rx.error)}</div>`; wire(body); return; }
    if (rx.loading && !rx.data) { body.innerHTML = `${head}<p class="muted">Loading…</p>`; wire(body); return; }
    if (!rx.runs.length) { body.innerHTML = '<div class="empty-state"><b>No runs yet</b><p class="muted">Start a run: each one can be read here in depth.</p></div>'; return; }
    const d = rx.data;
    if (!d?.figures) { body.innerHTML = `${head}<p class="muted">Pick a run.</p>`; wire(body); return; }
    const f = d.figures;
    body.innerHTML = `${head}${header(f, d.comparison)}
      <h3 class="s-subtitle">Timeline <span class="muted small">(one row per agent; hatched: waiting for you at a gate)</span></h3>
      <div class="card an-card">${timeline(f)}</div>
      ${agentCharts(f, d.comparison)}
      ${tables(f)}`;
    wire(body);
  }

  function wire(body) {
    const search = body.querySelector('#an-run-search');
    const pick = body.querySelector('#an-run-pick');
    if (search && pick) search.oninput = () => { rx.query = search.value; pick.innerHTML = options(); };
    if (pick) pick.onchange = async () => { select(pick.value); render(body); await load(); render(body); };
    body.querySelectorAll('[data-an-open-run]').forEach((b) => { b.onclick = () => window.showRun?.(b.dataset.anOpenRun, { workflow: b.dataset.workflow || undefined }); });
  }

  window.AnalyticsTabs = window.AnalyticsTabs || {};
  window.AnalyticsTabs.run = {
    id: 'run',
    label: 'Run',
    order: 10,
    load,
    render,
    select,
    sub: () => (rx.data?.figures ? `One run in depth: ${rx.data.figures.title || rx.data.figures.runId}` : 'One run in depth, compared with its workflow\'s runs'),
    context: () => (rx.data?.figures ? `Run tab, run ${rx.data.figures.runId} (${rx.data.figures.workflow || 'workflow'})` : 'Run tab, no run picked'),
  };
})();
