// Analytics › Agents (#280): what the three conversational agents cost and how their sessions live, in
// the screen's date range. A card per agent (Oracle, Product Owner, Supervisor: its robot, cost, tokens
// by kind, turns, sessions, cost per turn and its share of the three; the Oracle's spend today against
// its daily budget and its wake-ups vs questions; the Product Owner's projects), the cost per day
// stacked by agent (US$ or tokens, remembered) and the sessions with why each one started and ended
// (newest first, 50 at a time; a click on a card or the agent select filters them).
// Channel analytics:agents (src/agents-usage.js via src/service/areas/usage.js). A tab of
// views/analytics/analytics.js (window.AnalyticsTabs), which gives load() its date range (usesRange).
// Uses app.js globals: api, esc, fmtUsd, fmtTok, fmtNum, dateOf, errMsg; window.Robots (robots.js).
(() => {
  const LS = 'multiagent.analytics.agents';
  const PAGE = 50;
  const DAY = 864e5;
  const AGENTS = [
    { id: 'oracle', name: 'Oracle', color: 'var(--accent)', testid: 'agents-card-oracle' },
    { id: 'product-owner', name: 'Product Owner', color: 'var(--green)', testid: 'agents-card-product-owner' },
    { id: 'supervisor', name: 'Supervisor', color: 'var(--purple)', testid: 'agents-card-supervisor' },
  ];
  const AGENT = Object.fromEntries(AGENTS.map((g) => [g.id, g]));
  // why a session started or ended: the chip's label and its tooltip
  const REASONS = {
    answered: ['Answered', 'Answered: a one-shot call ends with its answer'],
    cleared: ['Cleared', 'Cleared: the conversation was cleared, the next message started a new session'],
    compaction: ['Compaction', 'Compaction: the context passed the Oracle\'s limit (150,000 tokens unless changed in Settings), a new session started from a handoff note'],
    first: ['First', 'First: there was no earlier session to resume'],
    idle: ['Idle 55 min', 'Idle: the last turn was over 55 minutes before, past the prompt cache\'s lifetime; a fresh session costs less than resuming'],
    'model-change': ['Model change', 'Model change: the agent\'s model changed, and a session stays on its model'],
    'one-shot': ['One-shot', 'One-shot: the Product Owner starts a fresh call for every question, with the last exchanges re-sent'],
    reset: ['Reset', 'Reset: "New session" in the Oracle, the next question started from a handoff note'],
  };
  const gx = {
    unit: (() => { try { return localStorage.getItem(LS) === 'tokens' ? 'tokens' : 'usd'; } catch { return 'usd'; } })(),
    range: null, data: null, error: null, loading: false, reads: 0,
    filter: 'all', // the agent whose sessions the table lists
    shown: PAGE,
  };
  const agentOf = (id) => gx.data?.agents?.[id] || null;
  const turnsOf = (a) => Number(a?.totals?.turns) || 0;
  const sumTokens = (t) => (t ? (Number(t.input) || 0) + (Number(t.output) || 0) + (Number(t.cache_read) || 0) + (Number(t.cache_write) || 0) : 0);
  const count = (n, word) => `${fmtNum(Number(n) || 0)} ${word}${Number(n) === 1 ? '' : 's'}`;

  // `range`: the screen's { from, to }; without it (Retry) the last one is read again
  async function load(range) {
    if (range) gx.range = { from: range.from, to: range.to };
    // the latest read wins: a slower earlier answer (another range) is dropped
    const read = ++gx.reads;
    gx.loading = true;
    let out;
    try { out = { data: await api.getAgentsAnalytics({ ...gx.range }), error: null }; } catch (e) { out = { error: errMsg(e) }; }
    if (read !== gx.reads) return;
    Object.assign(gx, out);
    gx.loading = false;
    gx.shown = PAGE;
  }

  // ---- the cards ---------------------------------------------------------------------------
  const head = (g, state) => `<span class="ag-card-head"><span class="an-robot" data-testid="agents-card-robot" aria-hidden="true">${window.Robots ? window.Robots.svg(g.id, state, { bubble: false, plaque: '' }) : ''}</span><b class="ag-name">${esc(g.name)}</b></span>`;

  function oracleLines(a) {
    const t = a.totals;
    const today = a.today;
    let budget = '';
    if (today) {
      const spent = Number(today.spentUsd) || 0;
      const limit = Number(today.limitUsd) || 0;
      const share = limit > 0 ? Math.min(1, spent / limit) : 0;
      budget = limit > 0
        ? `<span class="ag-line small" title="${I18n.t('analytics_agents.the_oracle_s_spend_today_utc')}">${I18n.t('analytics_agents.today_spent_of', { spent: fmtUsd(spent) })} ${fmtUsd(limit)}<span class="ag-budget${1 <= share ? ' full' : ''}"><i style="width:${Math.round(share * 100)}%"></i></span></span>`
        : `<span class="ag-line small" title="${I18n.t('analytics_agents.the_oracle_has_no_daily_budget')}">${I18n.t('analytics_agents.today_spent_no_daily_budget', { spent: fmtUsd(spent) })}</span>`;
    }
    return `${budget}<span class="ag-line muted small" title="${I18n.t('analytics_agents.what_its_turns_answered_a_turn')}">${count(t.wakeUps, 'wake-up')} · ${count(t.questions, 'question')}</span>`;
  }

  // a card is a button: it filters the sessions table to its agent (again: every agent)
  function card(g, totalUsd) {
    const a = agentOf(g.id);
    const n = turnsOf(a);
    if (!n) return `<div class="card ag-card ag-card-empty" data-testid="${g.testid}">${head(g, 'idle')}<span class="ag-line muted">${I18n.t('analytics_agents.no_turns_in_this_range')}</span></div>`;
    const t = a.totals;
    const cost = Number(t.costUsd) || 0;
    const tk = t.tokens || {};
    const on = gx.filter === g.id;
    return `<button type="button" class="card ag-card${on ? ' active' : ''}" data-ag-card="${g.id}" data-testid="${g.testid}" aria-pressed="${on}" title="${on ? I18n.t('analytics_agents.show_every_agent_s_sessions') : I18n.t('analytics_agents.show_only_the_name_s_sessions', { name: esc(g.name) })}">
      ${head(g, 'done')}
      <span class="ag-line ag-main"><b data-testid="agents-card-cost">${fmtUsd(cost)}</b> ${I18n.t('analytics_agents.tk_tokens', { tk: fmtTok(sumTokens(tk)) })}</span>
      <span class="ag-line muted small">${I18n.t('analytics_agents.input_input_output_output_cache_read', { input: fmtTok(tk.input), output: fmtTok(tk.output), cache_read: fmtTok(tk.cache_read) })} ${fmtTok(tk.cache_write)}</span>
      ${t.turnsWithoutTokens ? `<span class="ag-line muted small" title="${I18n.t('analytics_agents.only_the_cost_of_these_turns')}">${I18n.t('analytics_agents.tokens_of_turnswithouttokens_not_recorded', { turnsWithoutTokens: count(t.turnsWithoutTokens, 'earlier turn') })}</span>` : ''}
      <span class="ag-line" data-testid="agents-card-turns">${count(n, 'turn')} · ${count(t.sessions, 'session')}</span>
      <span class="ag-line muted small">${fmtUsd(cost / n)} ${I18n.t('analytics_agents.per_turn_value_of_the_three', { value: totalUsd > 0 ? Math.round((cost / totalUsd) * 100) : 0 })}</span>
      ${g.id === 'oracle' ? oracleLines(a) : ''}${g.id === 'product-owner' ? `<span class="ag-line muted small">${count(t.projects, 'project')}</span>` : ''}
    </button>`;
  }

  // ---- cost per day ------------------------------------------------------------------------
  // every day of the range (the read's, else the screen's), else the days with turns
  function axisDays() {
    const from = Date.parse(gx.data?.from || gx.range?.from || '');
    const to = Date.parse(gx.data?.to || gx.range?.to || '');
    const days = [];
    if (Number.isFinite(from) && Number.isFinite(to)) for (let t = from; t <= to && days.length < 400; t += DAY) days.push(new Date(t).toISOString().slice(0, 10));
    return days.length ? days : [...new Set(AGENTS.flatMap((g) => (agentOf(g.id)?.days || []).map((d) => d.day)))].sort();
  }

  function dayChart() {
    const tokens = gx.unit === 'tokens';
    const fmt = (v) => (tokens ? `${fmtTok(v)} tokens` : fmtUsd(v));
    const byDay = AGENTS.map((g) => new Map((agentOf(g.id)?.days || []).map((d) => [d.day, tokens ? sumTokens(d.tokens) : Number(d.costUsd) || 0])));
    const days = axisDays();
    const max = Math.max(0, ...days.map((day) => byDay.reduce((s, m) => s + (m.get(day) || 0), 0))) || 1;
    const W = 900; const H = 180; const bw = W / Math.max(1, days.length);
    const bars = days.map((day, i) => {
      let y = H;
      const parts = AGENTS.map((g, k) => {
        const v = byDay[k].get(day) || 0;
        const h = (v / max) * (H - 10);
        y -= h;
        return v > 0 ? `<rect x="${(i * bw + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 4).toFixed(1)}" height="${h.toFixed(1)}" style="fill:${g.color}"></rect>` : '';
      }).join('');
      // hovering a day shows the three values
      const tip = `${day} · ${AGENTS.map((g, k) => `${g.name}: ${fmt(byDay[k].get(day) || 0)}`).join(' · ')}`;
      return `<g>${parts}<rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" class="an-hit"><title>${esc(tip)}</title></rect></g>`;
    }).join('');
    const every = Math.ceil(days.length / 10);
    const labels = days.map((d, i) => (i % every === 0 ? `<span style="left:${((i + 0.5) / days.length) * 100}%">${esc(d.slice(5))}</span>` : '')).join('');
    const unit = (id, label) => `<button type="button" role="radio" aria-checked="${gx.unit === id}" class="${gx.unit === id ? 'active' : ''}" data-ag-unit="${id}">${label}</button>`;
    return `<div class="card an-card" data-testid="agents-chart">
      <div class="row an-card-head"><h3>${t('analytics_agents.cost_per_day')}</h3>
        <div class="row ag-chart-controls"><div class="an-legend" data-testid="agents-cost-per-day-legend">${AGENTS.map((g) => `<span><i style="background:${g.color}"></i>${esc(g.name)}</span>`).join('')}</div>
        <div class="seg sm" role="radiogroup" aria-label="${t('analytics_agents.cost_per_day')}">${unit('usd', 'US$')}${unit('tokens', 'Tokens')}</div></div>
      </div>
      <div class="an-chart"><div class="an-ymax muted small">${esc(fmt(max))}</div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t('analytics_agents.value_per_day_stacked_by_agent', { value: tokens ? 'Tokens' : 'Cost' })}">${bars}</svg><div class="an-xlabels">${labels}</div></div>
    </div>`;
  }

  // ---- the sessions ------------------------------------------------------------------------
  function chip(reason, testid = '') {
    const id = testid ? ` data-testid="${testid}" data-reason="${esc(reason || '')}"` : '';
    const known = REASONS[reason];
    if (known) return `<span class="badge"${id} title="${esc(known[1])}">${esc(known[0])}</span>`;
    // a line from before #280 has no reason
    return `<span class="muted"${id}${reason ? '' : ` title="${t('analytics_agents.not_recorded_this_turn_is_from')}"`}>${esc(reason || '—')}</span>`;
  }

  function sessionRow(s) {
    const g = AGENT[s.agent];
    const open = s.endReason === 'open';
    const tokens = s.tokens ? fmtTok(sumTokens(s.tokens)) : `<span class="muted" title="${t('analytics_agents.the_supervisor_chat_kept_only_the')}">${t('analytics_agents.not_recorded')}</span>`;
    return `<tr data-testid="agents-session-row" data-started="${esc(s.start)}">
      <td><span class="an-agent"><i style="background:${g.color}"></i>${esc(g.name)}</span></td>
      <td class="nowrap">${esc(dateOf(s.start))}</td>
      <td>${chip(s.startReason, 'agents-start-reason')}</td>
      <td class="num">${fmtNum(Number(s.turns) || 0)}</td>
      <td class="num"${s.contextAtEnd ? ` title="${t('analytics_agents.contextatend_tokens_of_context_after_its', { contextAtEnd: fmtNum(s.contextAtEnd) })}"` : ''}>${s.contextAtEnd ? fmtTok(s.contextAtEnd) : '—'}</td>
      <td class="num nowrap">${fmtUsd(s.costUsd)} · ${tokens}</td>
      <td class="nowrap" data-testid="agents-session-ended">${open ? `<span class="badge live" title="${t('analytics_agents.its_agent_s_latest_session_in')}">${t('analytics_agents.open')}</span>` : esc(dateOf(s.end))}</td>
      <td>${!open ? chip(s.endReason) : '<span class="muted">—</span>'}</td>
    </tr>`;
  }

  function sessionsCard() {
    const all = AGENTS.flatMap((g) => (agentOf(g.id)?.sessions || []).map((s) => ({ ...s, agent: g.id })))
      .filter((s) => gx.filter === 'all' || s.agent === gx.filter)
      .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
    const rows = all.slice(0, gx.shown).map(sessionRow).join('');
    const none = `<tr><td colspan="8" class="muted">${t('analytics_agents.no_sessions_value_in_this_range', { value: gx.filter === 'all' ? '' : ` of the ${esc(AGENT[gx.filter].name)}` })}</td></tr>`;
    const more = all.length > gx.shown
      ? `<tfoot><tr><td colspan="8"><button type="button" class="btn sm ghost" data-ag-more data-testid="agents-show-more">${t('analytics_agents.show_more')}</button> <span class="muted small">${fmtNum(gx.shown)} ${t('analytics_agents.of_length_sessions', { length: fmtNum(all.length) })}</span></td></tr></tfoot>` : '';
    const option = (id, label) => `<option value="${id}"${gx.filter === id ? ' selected' : ''}>${esc(label)}</option>`;
    return `<div class="card an-card">
      <div class="row an-card-head"><h3>${t('analytics_agents.sessions')}</h3>
        <label class="an-date small muted">${t('analytics_agents.agent')} <select data-ag-filter data-testid="agents-sessions-filter">${option('all', 'All agents')}${AGENTS.map((g) => option(g.id, g.name)).join('')}</select></label>
      </div>
      <div class="table-wrap"><table class="u-table an-sessions" data-testid="agents-sessions-table">
        <thead><tr><th>${t('analytics_agents.agent')}</th><th>${t('analytics_agents.started')}</th><th>${t('analytics_agents.why_it_started')}</th><th class="num">${t('analytics_agents.turns')}</th><th class="num">${t('analytics_agents.context_at_end')}</th><th class="num">${t('analytics_agents.cost_tokens')}</th><th>${t('analytics_agents.ended')}</th><th>${t('analytics_agents.why_it_ended')}</th></tr></thead>
        <tbody>${rows || none}</tbody>${more}
      </table></div>
    </div>`;
  }

  // ---- the tab -----------------------------------------------------------------------------
  function render(body) {
    if (gx.error) {
      body.innerHTML = `<div class="usage-unavailable" role="alert" data-ag-root>${t('analytics_agents.could_not_load_the_agents_usage')} ${esc(gx.error)} <button type="button" class="btn sm ghost" data-ag-retry data-testid="agents-retry">${t('analytics_agents.retry')}</button></div>`;
    } else if (!gx.data) {
      body.innerHTML = `<p class="muted" data-ag-root>${t('analytics_agents.loading')}</p>`;
    } else if (!AGENTS.some((g) => turnsOf(agentOf(g.id)))) {
      body.innerHTML = `<div class="empty-state" data-testid="agents-empty" data-ag-root><b>${t('analytics_agents.no_turns_in_this_range')}</b><p class="muted">${t('analytics_agents.the_oracle_the_product_owner_and')}</p></div>`;
    } else {
      const totalUsd = AGENTS.reduce((s, g) => s + (Number(agentOf(g.id)?.totals?.costUsd) || 0), 0);
      body.innerHTML = `<div class="ag-cards" data-ag-root>${AGENTS.map((g) => card(g, totalUsd)).join('')}</div>${dayChart()}${sessionsCard()}`;
    }
    wire(body);
  }

  // renders again and puts the focus back on the control that was used
  function again(body, focus) {
    render(body);
    if (focus) body.querySelector(focus)?.focus({ preventScroll: true });
  }

  function wire(body) {
    body.querySelectorAll('[data-ag-card]').forEach((b) => {
      b.onclick = () => {
        gx.filter = gx.filter === b.dataset.agCard ? 'all' : b.dataset.agCard;
        gx.shown = PAGE;
        again(body, `[data-ag-card="${b.dataset.agCard}"]`);
      };
    });
    body.querySelectorAll('[data-ag-filter]').forEach((s) => {
      s.onchange = () => {
        gx.filter = AGENT[s.value] ? s.value : 'all';
        gx.shown = PAGE;
        again(body, '[data-ag-filter]');
      };
    });
    body.querySelectorAll('[data-ag-unit]').forEach((b) => {
      b.onclick = () => {
        gx.unit = b.dataset.agUnit === 'tokens' ? 'tokens' : 'usd';
        try { localStorage.setItem(LS, gx.unit); } catch { /* ignore */ }
        again(body, `[data-ag-unit="${gx.unit}"]`);
      };
    });
    body.querySelectorAll('[data-ag-more]').forEach((b) => {
      b.onclick = () => { gx.shown += PAGE; again(body, '[data-ag-more]'); };
    });
    body.querySelectorAll('[data-ag-retry]').forEach((b) => {
      b.onclick = async () => {
        gx.error = null; gx.data = null;
        render(body);
        await load();
        // still this tab's body (another tab may have been opened meanwhile)
        if (body.querySelector('[data-ag-root]')) render(body);
      };
    });
  }

  const rangeText = () => (gx.range ? `${gx.range.from} to ${gx.range.to}` : 'the screen\'s range');

  window.AnalyticsTabs = window.AnalyticsTabs || {};
  window.AnalyticsTabs.agents = {
    id: 'agents',
    label: 'Agents',
    order: 30,
    usesRange: true,
    load,
    render,
    sub: () => `What the Oracle, the Product Owner and the Supervisor cost, and how their sessions start and end, ${rangeText()}${gx.loading ? ' — loading…' : ''}`,
    context: () => `Agents tab, range ${rangeText()}: ${AGENTS.map((g) => `${g.name} ${fmtUsd(Number(agentOf(g.id)?.totals?.costUsd) || 0)} in ${count(turnsOf(agentOf(g.id)), 'turn')}`).join(', ')}`,
  };
})();
