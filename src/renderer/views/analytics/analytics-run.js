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
  // a step or agent id as people read it (#245, display-name.js); the id stays in the tooltip
  // (`names`: the run's own id → name map, from its workflow's display names)
  const readable = (id, names) => (typeof displayName === 'function' ? displayName(id, names) : String(id || ''));
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
      // the remembered run is gone (deleted): the latest one instead (only that run: another one
      // missing would pick the same run again, forever)
      if (rx.runId && errMsg(e).includes(`Run not found: ${rx.runId}`)) { select(null); rx.loading = false; return load(); }
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
    return list.length ? list.map((r) => `<option value="${esc(r.runId)}"${r.runId === rx.runId ? ' selected' : ''}>${esc(r.title)}${r.issues?.length ? ` · ${esc(issuesText(r.issues))}` : ''} · ${esc(r.workflow || '')} · ${r.startedAt ? esc(dateOf(r.startedAt)) : ''}${r.mock ? t('analytics_run.simulated_2') : ''}</option>`).join('') : `<option value="">${t('analytics_run.no_run_matches')}</option>`;
  }
  function picker() {
    return `<div class="card an-project-pick an-run-pick">
      <label class="an-field"><span class="small muted">${t('analytics_run.search_runs')}</span><input type="text" id="an-run-search" data-testid="an-run-search" placeholder="${t('analytics_run.run_id_issue_219_or_title')}" value="${esc(rx.query)}" /></label>
      <label class="an-field"><span class="small muted">${t('analytics_run.run')}</span><select id="an-run-pick" data-testid="an-run-pick" aria-label="${t('analytics_run.run')}">${options()}</select></label>
    </div>`;
  }

  // "▲ +46% · $7.00 more than the median"; the verdict also in a word, not colour only
  function diffText(c, kind) {
    if (!c) return '<span class="muted small">—</span>';
    if (c.verdict === 'same') return `<span class="an-verdict neutral">${t('analytics_run.the_median')}</span>`;
    const sign = c.diff > 0 ? '▲ +' : '▼ −';
    const pctText = c.diffPct == null ? '' : `${sign}${Math.abs(Math.round(c.diffPct))}% · `;
    return `<span class="an-verdict ${esc(c.level)}" title="${t('analytics_run.value_than_the_median_of_the', { value: c.verdict === 'worse' ? 'Worse' : 'Better', p25: esc(fmt(c.p25, kind)), p75: esc(fmt(c.p75, kind)) })}">${pctText}${esc(fmt(Math.abs(c.diff), kind))} ${c.diff > 0 ? 'more' : 'less'} ${t('analytics_run.than_the_median')} <b>${c.verdict}</b></span>`;
  }

  // #233: the estimated / cost not recorded badges (run-list.js's costMarks, a renderer global)
  const marksOf = (x) => costMarks(x.costEstimatedUsd, x.costNotRecorded);

  function header(f, cmp) {
    const stat = (label, value, title = '', testid = '') => `<div class="u-stat"${title ? ` title="${esc(title)}"` : ''}${testid ? ` data-testid="${testid}"` : ''}><label>${esc(label)}</label><b>${value}</b></div>`;
    return `<div class="card an-card an-run-head" data-testid="an-run-header">
        <div class="row an-card-head"><div><h3 class="an-run-title" title="${esc(f.title || f.runId)}">${esc(f.title || f.workflow || f.runId)}</h3>
          <div class="muted small"><span class="badge">${esc(f.workflow || '—')}</span> ${f.issues?.length ? esc(issuesText(f.issues)) : ''} · <span class="mono" title="${esc(f.runId)}">${esc(f.runId)}</span>${f.startedAt ? ` · ${esc(dateOf(f.startedAt))}` : ''}${f.mock ? ` · <span class="badge">${t('analytics_run.simulated')}</span>` : ''}</div></div>
          <div class="row"><span class="badge ${f.status === 'success' ? 'cat-monitor' : f.status === 'failed' ? 'warn' : ''}" data-status="${esc(f.status)}">${esc(StatusPill.statusLabel(f.status))}</span><button type="button" class="btn sm ghost" data-an-open-run="${esc(f.runId)}" data-workflow="${esc(f.file || '')}">${t('analytics_run.open_run')}</button></div></div>
        <div class="an-totals">
          ${stat(t('analytics_run.total_cost'), `${fmtUsd(f.costUsd)}${marksOf(f)}`, '', 'an-run-total-cost')}
          ${stat(t('analytics_run.cost_per_issue'), fmt(f.costPerIssue, 'usd'))}
          ${stat(t('analytics_run.duration'), fmtDur(f.durationMs))}
          ${stat(t('analytics_run.active'), fmtDur(f.activeMs), t('analytics_run.the_duration_minus_the_time_waiting'))}
          ${stat(t('analytics_run.waiting_at_gates'), fmtDur(f.gateWaitMs), f.gates.map((g) => `${g.gate}: ${fmtDur(g.waitMs)}`).join(', '))}
          ${stat(t('analytics_run.suite_rounds'), fmtNum(f.suiteRounds.length))}
        </div>
        ${comparison(f, cmp)}
      </div>`;
  }

  function comparison(f, cmp) {
    if (!cmp) return '';
    if (cmp.tooFew) return `<p class="muted small an-note" data-testid="an-run-compare">${t('analytics_run.only_count_other_successful_real_run', { count: cmp.count, value: cmp.count === 1 ? '' : 's', value2: esc(f.workflow || 'this workflow'), minRuns: cmp.minRuns })}</p>`;
    const rows = FIGURES.map(([key, label, kind]) => {
      const c = cmp.metrics[key];
      return `<tr><td>${esc(label)}</td><td class="num">${esc(fmt(f[key], kind))}</td><td class="num">${c ? esc(fmt(c.median, kind)) : '—'}</td><td class="num nowrap">${c ? `${esc(fmt(c.p25, kind))} – ${esc(fmt(c.p75, kind))}` : '—'}</td><td>${diffText(c, kind)}</td></tr>`;
    }).join('');
    return `<h4 class="small muted" data-testid="an-run-compare">${t('analytics_run.compared_with_the_last_count_successful', { count: cmp.count })} ${esc(f.workflow || t('analytics_run.this_workflow'))}</h4>
      <div class="table-wrap"><table class="u-table an-sessions"><thead><tr><th>${t('analytics_run.figure')}</th><th class="num">${t('analytics_run.this_run')}</th><th class="num">${t('analytics_run.median')}</th><th class="num">p25 – p75</th><th>${t('analytics_run.difference')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // The Gantt: one row per agent (role colour) and the orchestrator's machine steps; gates hatched.
  function timeline(f) {
    const t0 = Date.parse(f.startedAt || f.timeline[0]?.from || 0);
    const t1 = Math.max(Date.parse(f.finishedAt || 0) || 0, ...f.timeline.map((b) => Date.parse(b.to)), ...f.gates.map((g) => Date.parse(g.to || 0) || 0));
    if (!f.timeline.length || !(t1 > t0)) return `<p class="muted small an-empty">${t('analytics_run.no_step_recorded')}</p>`;
    const rows = [...new Set(f.timeline.map((b) => b.row))].sort((a, b) => (a === 'orchestrator') - (b === 'orchestrator'));
    const W = 1000;
    const RH = 26;
    const LW = 130;
    const H = (rows.length + 1) * RH;
    const x = (t) => LW + ((Date.parse(t) - t0) / (t1 - t0)) * (W - LW - 6);
    const bars = f.timeline.map((b) => {
      const y = rows.indexOf(b.row) * RH + 4;
      const w = Math.max(2, x(b.to) - x(b.from));
      return `<rect x="${x(b.from).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${RH - 8}" rx="3" style="fill:${colorOf(b.row)}"><title>${esc(readable(b.step, f.stepNames))} ${t('analytics_run.step_visit_visit', { step: esc(b.step), visit: b.visit })} ${esc(fmtDur(b.durationMs))}${b.costUsd ? ` · ${esc(fmtUsd(b.costUsd))}` : ''}${b.costEstimatedUsd ? t('analytics_run.costestimatedusd_estimated', { costEstimatedUsd: esc(fmtUsd(b.costEstimatedUsd)) }) : ''}${b.costNotRecorded ? t('analytics_run.cost_not_recorded') : ''}</title></rect>
        ${w > 60 ? `<text x="${(x(b.from) + 4).toFixed(1)}" y="${y + RH / 2 + 1}" class="an-gantt-label">${esc(readable(b.step, f.stepNames))}</text>` : ''}`;
    }).join('');
    const gy = rows.length * RH + 4;
    const gates = f.gates.map((g) => {
      const to = g.to || f.finishedAt || new Date(t1).toISOString();
      const w = Math.max(2, x(to) - x(g.from));
      return `<rect x="${x(g.from).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H - 4}" class="an-gantt-gate"><title>${t('analytics_run.waiting_at_the_gate_gate_gate2', { gate: esc(readable(g.gate, f.stepNames)), gate2: esc(g.gate) })} ${esc(fmtDur(g.waitMs))}</title></rect>
        <text x="${(x(g.from) + 4).toFixed(1)}" y="${gy + RH / 2 + 1}" class="an-gantt-label muted">${esc(readable(g.gate, f.stepNames))} · ${esc(fmtDur(g.waitMs))}</text>`;
    }).join('');
    const rowName = (r) => (r === 'gates' ? 'waiting for you' : r === 'orchestrator' ? r : readable(r, f.agentNames));
    const labels = [...rows, 'gates'].map((r, i) => `<text x="4" y="${i * RH + RH / 2 + 2}" class="an-gantt-row">${esc(rowName(r))}</text>`).join('');
    return `<div class="an-gantt" data-testid="an-run-timeline"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('analytics_run.timeline_of_the_run_by_agent')}">
      <defs><pattern id="an-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="an-hatch-line" /></pattern></defs>
      ${gates}${bars}${labels}</svg>
      <div class="an-xlabels"><span style="left:${(LW / W) * 100}%">${esc(dateOf(new Date(t0).toISOString()))}</span><span style="left:96%">${esc(fmtDur(t1 - t0))}</span></div></div>`;
  }

  function hbars(items, { stacked = false } = {}) {
    // `keep`: shown even at zero (a cost not recorded); `marks`: HTML after the value; `testid`: per bar
    const list = items.filter((x) => x.keep || (stacked ? x.parts.reduce((s, p) => s + p.value, 0) : x.value) > 0);
    if (!list.length) return `<p class="muted small">${t('analytics_run.none_recorded')}</p>`;
    const totalOf = (x) => (stacked ? x.parts.reduce((s, p) => s + p.value, 0) : x.value);
    const max = Math.max(...list.map(totalOf)) || 1;
    return `<div class="an-bars">${list.map((x) => `<div class="an-bar" title="${esc(x.title || x.label)}"${x.testid ? ` data-testid="${x.testid}"` : ''}>
        <span class="an-bar-label">${x.chip || esc(x.label)}</span>
        <span class="an-bar-track">${stacked
    ? x.parts.filter((p) => p.value > 0).map((p) => `<span style="width:${(p.value / max) * 100}%;background:${p.color}" title="${esc(p.title)}"></span>`).join('')
    : `<span style="width:${Math.max(1, (x.value / max) * 100)}%;background:${x.color}"></span>`}</span>
        <span class="an-bar-val">${esc(x.sub)}${x.marks || ''}</span></div>`).join('')}</div>`;
  }

  function agentCharts(f, cmp) {
    // the agent's readable name leads; its id in the bar's tooltip
    const name = (a) => readable(a, f.agentNames);
    const chip = (a) => `<span class="an-agent"><i style="background:${colorOf(a)}"></i>${esc(name(a))}</span>`;
    const time = hbars(f.agents.map((a) => ({
      label: name(a.agent), chip: chip(a.agent), sub: `${fmtDur(a.activeMs)} active · ${fmtDur(a.waitingMs)} on tools`, title: t('analytics_run.agent_agent2_activems_active_waitingms_waiting', { agent: name(a.agent), agent2: a.agent, activeMs: fmtDur(a.activeMs), waitingMs: fmtDur(a.waitingMs) }),
      parts: [{ value: a.activeMs, color: colorOf(a.agent), title: `active ${fmtDur(a.activeMs)}` }, { value: a.waitingMs, color: 'var(--muted)', title: t('analytics_run.waiting_on_tools_waitingms', { waitingMs: fmtDur(a.waitingMs) }) }],
    })), { stacked: true });
    const turns = hbars(f.agents.map((a) => ({ label: name(a.agent), title: `${name(a.agent)} (${a.agent})`, chip: chip(a.agent), value: a.turns, sub: `${fmtNum(a.turns)} turn${a.turns === 1 ? '' : 's'}`, color: colorOf(a.agent) })));
    const cost = hbars(f.agents.map((a) => {
      const c = cmp?.agents?.[a.agent]?.costUsd;
      return {
        label: name(a.agent), title: `${name(a.agent)} (${a.agent})`, chip: chip(a.agent), value: a.costUsd, sub: `${fmtUsd(a.costUsd)}${c ? ` (${c.diff > 0 ? '▲' : c.diff < 0 ? '▼' : '='} median ${fmtUsd(c.median)})` : ''}`, color: colorOf(a.agent),
        marks: marksOf(a), keep: !!a.costNotRecorded, testid: 'an-agent-cost',
      };
    }));
    const tokens = hbars(f.agents.map((a) => ({
      label: name(a.agent), chip: chip(a.agent), sub: `${fmtTok(a.totalTokens)} · ${a.usdPerMTokens == null ? '—' : `${fmtUsd(a.usdPerMTokens)}/M`}`,
      title: `${name(a.agent)} (${a.agent}): ${Object.keys(TOKEN_LABELS).map((k) => `${TOKEN_LABELS[k]} ${fmtNum(a.tokens[k])}`).join(', ')}; effective ${a.usdPerMTokens == null ? '—' : fmtUsd(a.usdPerMTokens)} per million tokens`,
      parts: Object.keys(TOKEN_LABELS).map((k) => ({ value: a.tokens[k], color: TOKEN_COLORS[k], title: `${TOKEN_LABELS[k]}: ${fmtNum(a.tokens[k])}` })),
      // #308: the sub-agents' share, already counted in the agent's tokens
      marks: a.subagents ? ` <span class="muted small" data-testid="an-agent-subagents">${t('analytics_run.of_which_sub_agents_calls_call', { calls: fmtNum(a.subagents.calls), value: a.subagents.calls === 1 ? '' : 's', tokens: fmtTok(a.subagents.tokens) })}</span>` : '',
      testid: 'an-agent-tokens',
    })), { stacked: true });
    return `<div class="an-grid">
        <div class="card an-card"><h3>${t('analytics_run.time_per_agent')} <span class="muted small">${t('analytics_run.active_then_waiting_on_tools')}</span></h3>${time}</div>
        <div class="card an-card"><h3>${t('analytics_run.turns_per_agent')}</h3>${turns}</div>
        <div class="card an-card"><h3>${t('analytics_run.cost_per_agent')}</h3>${cost}</div>
      </div>
      <div class="card an-card"><div class="row an-card-head"><h3>${t('analytics_run.tokens_per_agent')} <span class="muted small">${t('analytics_run.and_the_effective_m_tokens')}</span></h3>
        <div class="an-legend">${Object.keys(TOKEN_LABELS).map((k) => `<span><i style="background:${TOKEN_COLORS[k]}"></i>${TOKEN_LABELS[k]}</span>`).join('')}</div></div>${tokens}</div>`;
  }

  function tables(f) {
    const steps = f.steps.length ? `<table class="u-table an-sessions"><thead><tr><th>${t('analytics_run.step')}</th><th>${t('analytics_run.agent')}</th><th class="num">${t('analytics_run.visits')}</th><th class="num">${t('analytics_run.duration')}</th></tr></thead><tbody>
      ${f.steps.map((s) => `<tr><td title="${esc(s.step)}">${esc(readable(s.step, f.stepNames))}</td><td>${s.agent ? `<span class="an-agent" title="${esc(s.agent)}"><i style="background:${colorOf(s.agent)}"></i>${esc(readable(s.agent, f.agentNames))}</span>` : `<span class="muted">${t('analytics_run.orchestrator')}</span>`}</td><td class="num">${s.visits}</td><td class="num">${fmtDur(s.durationMs)}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted small an-empty">${t('analytics_run.no_step_recorded')}</p>`;
    // #304: a round of a `scope: affected` suite: what it ran, and why each file was selected
    // (a red check's round runs the files its step lists: every reason is "listed by <step>")
    const listed = (sel) => Object.values(sel.reasons || {}).length > 0 && Object.values(sel.reasons).every((why) => /^listed by /.test(why));
    const scopeOf = (r) => (!r.selection ? (r.scope === 'files' ? 'Files' : 'Whole suite') : r.selection.mode === 'all' ? 'Whole suite' : listed(r.selection) ? 'Listed tests' : r.affected && r.scope === 'full' ? 'Affected, then whole suite' : 'Affected');
    const whyOf = (r) => {
      if (!r.selection) return '';
      const reasons = Object.entries(r.selection.reasons || {}).map(([file, why]) => `${file}: ${why}`).join('; ');
      return reasons || r.selection.why || '';
    };
    const suite = f.suiteRounds.length ? `<table class="u-table an-sessions"><thead><tr><th class="num">${t('analytics_run.round')}</th><th>${t('analytics_run.result')}</th><th>${t('analytics_run.scope')}</th><th class="num">${t('analytics_run.duration')}</th><th class="num">${t('analytics_run.failures')}</th><th class="num">${t('analytics_run.pre_existing')}</th></tr></thead><tbody>
      ${f.suiteRounds.map((r) => `<tr data-testid="an-suite-round"><td class="num">${r.round}</td><td><span class="badge ${r.status === 'pass' ? 'cat-monitor' : 'warn'}">${esc(r.status || '—')}</span></td><td class="an-title"><span class="badge" title="${esc(r.selection?.why || '')}">${esc(scopeOf(r))}</span>${whyOf(r) ? `<div class="muted small an-suite-why" title="${esc(whyOf(r))}">${esc(whyOf(r))}</div>` : ''}</td><td class="num">${fmtDur(r.durationMs)}</td><td class="num">${r.failures}</td><td class="num">${r.preexisting}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted small an-empty">${t('analytics_run.no_suite_round_in_this_run')}</p>`;
    const tools = f.slowestTools.length ? `<table class="u-table an-sessions"><thead><tr><th>${t('analytics_run.command')}</th><th>${t('analytics_run.agent')}</th><th class="num">${t('analytics_run.time')}</th></tr></thead><tbody>
      ${f.slowestTools.map((t) => `<tr><td class="an-title"><code class="an-file" title="${esc(t.command)}">${esc(t.command)}</code></td><td${t.agent ? ` title="${esc(t.agent)}"` : ''}>${esc(t.agent ? readable(t.agent, f.agentNames) : '—')}</td><td class="num">${fmtDur(t.durationMs)}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted small an-empty">${t('analytics_run.no_tool_call_recorded')}</p>`;
    return `<div class="an-grid an-grid-2">
        <div><h3 class="s-subtitle">${t('analytics_run.steps')}</h3><div class="card table-wrap">${steps}</div></div>
        <div><h3 class="s-subtitle">${t('analytics_run.suite_rounds')}</h3><div class="card table-wrap">${suite}</div></div>
      </div>
      <h3 class="s-subtitle">${t('analytics_run.slowest_tool_calls')} <span class="muted small">${t('analytics_run.top_10')}</span></h3><div class="card table-wrap">${tools}</div>`;
  }

  function render(body) {
    const head = picker();
    if (rx.error) { body.innerHTML = `${head}<div class="usage-unavailable" role="alert">${t('analytics_run.could_not_load_the_run')} ${esc(rx.error)}</div>`; wire(body); return; }
    if (rx.loading && !rx.data) { body.innerHTML = `${head}<p class="muted">${t('analytics_run.loading')}</p>`; wire(body); return; }
    if (!rx.runs.length) { body.innerHTML = `<div class="empty-state"><b>${t('analytics_run.no_runs_yet')}</b><p class="muted">${t('analytics_run.start_a_run_each_one_can')}</p></div>`; return; }
    const d = rx.data;
    if (!d?.figures) { body.innerHTML = `${head}<p class="muted">${t('analytics_run.pick_a_run')}</p>`; wire(body); return; }
    const f = d.figures;
    body.innerHTML = `${head}${header(f, d.comparison)}
      <h3 class="s-subtitle">${t('analytics_run.timeline')} <span class="muted small">${t('analytics_run.one_row_per_agent_hatched_waiting')}</span></h3>
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
