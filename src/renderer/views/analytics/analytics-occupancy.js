// Analytics › 24/7 (#188): how close the machine is to always working, and at what price. Cards
// (occupancy over 24 h, 7 and 30 days, the current active streak, the week's longest idle gap and its
// cause, average and peak runs at once), a day-by-day chart of active vs idle time by cause, a 24-hour
// heat strip per day (the owner's local time; #275: five levels from idle to fully active, more is
// more, a hatched cell for an hour without data, a legend), the idle gaps over 15 min, the Night watch
// split (inside vs outside its windows, and its nights next to the nights without it), the cost per
// active hour, per delivered issue and per 100 lines with a trend, the split by the Product Owner's
// calibration (#189), and one plain hint when an idle cause dominates. Day labels follow the owner's
// locale (navigator.language) in the machine's time zone (#273). Channel analytics:occupancy
// (src/domains/run/occupancy.js via src/service/areas/insights.js). A tab of views/analytics/analytics.js
// (window.AnalyticsTabs). Uses app.js globals: api, esc, fmtUsd, fmtDur, fmtNum, dateOf, errMsg, showView.
(() => {
  const LS = 'multiagent.analytics.occupancy';
  // [cause, its label's catalog key, colour]
  const CAUSES = [
    ['noWork', 'analytics_occupancy.cause_no_work', 'var(--muted)'],
    ['blocked', 'analytics_occupancy.cause_blocked', 'var(--red)'],
    ['gate', 'analytics_occupancy.cause_gate', 'var(--yellow)'],
    ['appClosed', 'analytics_occupancy.cause_app_closed', 'var(--purple)'],
    ['other', 'analytics_occupancy.cause_other', 'var(--orange)'],
  ];
  const CAUSE_KEY = Object.fromEntries(CAUSES.map(([k, l]) => [k, l]));
  const causeLabel = (k) => (CAUSE_KEY[k] ? t(CAUSE_KEY[k]) : k);
  const ACTIVE = 'var(--green)';
  const ox = { days: (() => { try { return Number(localStorage.getItem(LS)) === 7 ? 7 : 30; } catch { return 30; } })(), data: null, error: null, loading: false };
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const hours = (h) => (h == null ? '—' : `${(Math.round(h * 10) / 10).toFixed(1)} h`);
  const level = (x) => window.OccupancyChip?.chipModel({ occupancy: x || 0 }).level || 'none';

  // dates in the interface language (#329); a day key (the engine cuts d.day in the
  // owner's zone, #273) is drawn from its own date, an instant from its day in that zone
  const dayFormat = (opts) => {
    try { return new Intl.DateTimeFormat(window.I18n?.getLanguage() || undefined, opts); } catch { return new Intl.DateTimeFormat(undefined, opts); }
  };
  const DAY_SHORT = dayFormat({ day: '2-digit', month: '2-digit' });
  const DAY_LONG = dayFormat({ weekday: 'short', day: '2-digit', month: '2-digit' });
  const localMidnight = (day) => { const [y, m, d] = String(day).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDay = (day, long = false) => {
    const t = localMidnight(day);
    return Number.isNaN(t.getTime()) ? String(day) : (long ? DAY_LONG : DAY_SHORT).format(t);
  };
  const fmtWhenDay = (iso) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? String(iso).slice(0, 10) : typeof TimeZone !== 'undefined' ? fmtDay(TimeZone.dayKey(t, TimeZone.current()), true) : DAY_LONG.format(t); };
  const hh = (h) => `${String(h % 24).padStart(2, '0')}:00`;

  // the heatmap's scale (#275): l0 idle, l1 under 25%, l2 under 50%, l3 under 75%, l4 75% and over
  const HEAT_LABELS = ['analytics_occupancy.heat_idle', 'analytics_occupancy.heat_under_25', 'analytics_occupancy.heat_25_50', 'analytics_occupancy.heat_50_75', 'analytics_occupancy.heat_over_75'];
  const heatLevel = (v) => (v <= 0 ? 0 : v < 0.25 ? 1 : v < 0.5 ? 2 : v < 0.75 ? 3 : 4);

  async function load() {
    ox.loading = true;
    try { ox.data = await api.getOccupancy({ days: ox.days }); ox.error = null; } catch (e) { ox.error = errMsg(e); }
    ox.loading = false;
  }

  const stat = (label, value, title = '', cls = '') => `<div class="u-stat${cls ? ` ${cls}` : ''}"${title ? ` title="${esc(title)}"` : ''}><label>${esc(label)}</label><b>${value}</b></div>`;
  const occ = (x) => `<span class="an-occ" data-level="${x == null ? 'none' : level(x)}">${pct(x)}</span>`;

  function cards(o) {
    const g = o.cards.week.longestGap;
    return `<div class="an-totals" data-testid="an-occ-cards">
      ${stat(t('analytics_occupancy.last_24_h'), occ(o.cards.day.occupancy), t('analytics_occupancy.activehours_active_of_hours', { activeHours: hours(o.cards.day.activeHours), hours: hours(o.cards.day.hours) }))}
      ${stat(t('analytics_occupancy.n7_days'), occ(o.cards.week.occupancy), t('analytics_occupancy.activehours_active_of_hours', { activeHours: hours(o.cards.week.activeHours), hours: hours(o.cards.week.hours) }))}
      ${stat(t('analytics_occupancy.n30_days'), occ(o.cards.month.occupancy), t('analytics_occupancy.activehours_active_of_hours', { activeHours: hours(o.cards.month.activeHours), hours: hours(o.cards.month.hours) }))}
      ${stat(t('analytics_occupancy.active_streak'), o.streakMinutes ? fmtDur(o.streakMinutes * 60e3) : '—', o.running ? t('analytics_occupancy.a_run_is_active_now') : t('analytics_occupancy.idle_now_for_value', { value: fmtDur(o.idleNowMinutes * 60e3) }))}
      ${stat(t('analytics_occupancy.longest_idle_gap_week'), g ? `${fmtDur(g.minutes * 60e3)} <span class="muted small">${esc(causeLabel(g.cause))}</span>` : '—', g ? `${dateOf(g.from)} → ${dateOf(g.to)}` : '')}
      ${stat(t('analytics_occupancy.runs_at_once'), `${o.avgConcurrent == null ? '—' : (Math.round(o.avgConcurrent * 10) / 10).toFixed(1)} <span class="muted small">${t('analytics_occupancy.avg_peak')} ${fmtNum(o.peakConcurrent)}</span>`, t('analytics_occupancy.average_while_at_least_one_run'))}
    </div>`;
  }

  const legend = () => `<div class="an-legend"><span><i style="background:${ACTIVE}"></i>${t('analytics_occupancy.active')}</span>${CAUSES.map(([, l, c]) => `<span><i style="background:${c}"></i>${t(l)}</span>`).join('')}</div>`;

  // active vs idle by cause, one bar per local day
  function dayChart(days) {
    const W = 900; const H = 160; const bw = W / Math.max(1, days.length);
    const bars = days.map((d, i) => {
      const span = d.hours || 24;
      let y = H;
      const parts = [['active', d.activeHours, ACTIVE], ...CAUSES.map(([k, , c]) => [k, d.idleHours[k], c])].map(([k, v, c]) => {
        const h = (v / 24) * H;
        y -= h;
        return v > 0 ? `<rect x="${(i * bw + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 4).toFixed(1)}" height="${h.toFixed(1)}" style="fill:${c}"><title>${esc(fmtDay(d.day, true))} · ${esc(k === 'active' ? t('analytics_occupancy.active') : causeLabel(k))}: ${hours(v)}</title></rect>` : '';
      }).join('');
      return `<g>${parts}<rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" class="an-hit"><title>${esc(fmtDay(d.day, true))}${t('analytics_occupancy.occupancy_active_activehours_of_span', { occupancy: pct(d.occupancy), activeHours: hours(d.activeHours), span: hours(span) })}${d.partial ? t('analytics_occupancy.partial_day') : ''}</title></rect></g>`;
    }).join('');
    const every = Math.ceil(days.length / 10);
    const labels = days.map((d, i) => (i % every === 0 ? `<span style="left:${((i + 0.5) / days.length) * 100}%">${esc(fmtDay(d.day))}</span>` : '')).join('');
    return `<div class="an-chart" data-testid="an-occ-days"><div class="an-ymax muted small">24 h</div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t('analytics_occupancy.active_and_idle_hours_per_day')}">${bars}</svg><div class="an-xlabels">${labels}</div></div>`;
  }

  // a 24-hour strip per day, newest first: the share of each local hour with a run active, as one of
  // five levels (more is more); a hatched cell when the hour was not measured (before the log, or ahead)
  function heatCell(day, h, v) {
    if (v == null) return `<i class="an-heat-cell an-heat-nodata" title="${esc(t('analytics_occupancy.hour_no_data', { day: fmtDay(day, true), from: hh(h), to: hh(h + 1) }))}"></i>`;
    const title = `${fmtDay(day, true)}, ${hh(h)}–${hh(h + 1)} · ${t('analytics_occupancy.minutes_active', { minutes: Math.round(v * 60), share: pct(v) })}`;
    return `<i class="an-heat-cell an-heat-l${heatLevel(v)}" title="${esc(title)}"></i>`;
  }
  function heatStrip(days) {
    const rows = [...days].reverse().map((d) => `<div class="an-heat-row"><span class="an-heat-day mono small" title="${esc(fmtDay(d.day, true))}">${esc(fmtDay(d.day))}</span>${d.hourly.map((v, h) => heatCell(d.day, h, v)).join('')}</div>`).join('');
    const axis = `<div class="an-heat-row an-heat-axis"><span class="an-heat-day"></span>${Array.from({ length: 24 }, (_, h) => `<em>${h % 3 === 0 ? h : ''}</em>`).join('')}</div>`;
    return `<div class="an-heat" data-testid="an-occ-heat" role="img" aria-label="${t('analytics_occupancy.active_share_of_each_hour_per')}">${rows}${axis}</div>`;
  }
  const heatLegend = () => `<div class="an-legend an-heat-legend" data-testid="an-occ-heat-legend" aria-label="${t('analytics_occupancy.heatmap_scale')}"><span class="an-heat-scale">${t('analytics_occupancy.idle_value_fully_active', { value: HEAT_LABELS.map((l, i) => `<i class="an-heat-cell an-heat-l${i}" title="${esc(t(l))}"></i>`).join('') })}</span><span><i class="an-heat-cell an-heat-nodata"></i>${t('analytics_occupancy.no_data')}</span></div>`;

  const causeColor = (cause) => CAUSES.find(([k]) => k === cause)?.[2] || 'inherit';
  function gapsTable(gaps) {
    if (!gaps.length) return `<p class="muted small an-empty">${t('analytics_occupancy.no_idle_gap_longer_than_15')}</p>`;
    return `<table class="u-table an-sessions"><thead><tr><th>${t('analytics_occupancy.from')}</th><th>${t('analytics_occupancy.to')}</th><th class="num">${t('analytics_occupancy.length')}</th><th>${t('analytics_occupancy.cause')}</th><th>${t('analytics_occupancy.ended_by')}</th></tr></thead><tbody>
      ${[...gaps].reverse().slice(0, 60).map((g) => `<tr><td class="nowrap">${esc(dateOf(g.from))}</td><td class="nowrap">${esc(dateOf(g.to))}</td><td class="num">${fmtDur(g.minutes * 60e3)}</td>
        <td><span class="badge an-cause" style="color:${causeColor(g.cause)}">${esc(causeLabel(g.cause))}</span></td><td class="small">${esc(g.endedBy || t('analytics_occupancy.still_idle'))}</td></tr>`).join('')}</tbody></table>`;
  }

  function idleSplit(idle) {
    const total = idle.total || 0;
    if (!total) return `<span class="muted small">${t('analytics_occupancy.no_idle_time')}</span>`;
    return `<div class="an-stack">${CAUSES.filter(([k]) => idle[k] > 0).map(([k, l, c]) => `<span style="flex:${idle[k]};background:${c}" title="${esc(t(l))}: ${hours(idle[k])}"></span>`).join('')}</div>`;
  }

  function nightWatch(o) {
    const nw = o.nightWatch;
    const row = (label, s) => `<tr><td>${label}</td><td class="num">${hours(s.hours)}</td><td class="num">${occ(s.occupancy)}</td><td class="an-idle-cell">${idleSplit(s.idleHours)}</td><td class="num">${fmtNum(s.issues)}</td><td class="num">${fmtUsd(s.costUsd)}</td></tr>`;
    const nights = o.nights.length ? `<table class="u-table an-sessions"><thead><tr><th>${t('analytics_occupancy.night')}</th><th>${t('analytics_occupancy.window')}</th><th class="num">${t('analytics_occupancy.occupancy')}</th><th class="num">${t('analytics_occupancy.incidents')}</th><th class="num">${t('analytics_occupancy.actions')}</th><th class="num">${t('analytics_occupancy.hours_saved')}</th><th class="num">${t('analytics_occupancy.cost')}</th><th></th></tr></thead><tbody>
      ${o.nights.map((n) => `<tr><td class="nowrap" title="${esc(n.startedAt)}">${esc(fmtWhenDay(n.startedAt))}${n.watch ? '' : ` <span class="badge" title="${t('analytics_occupancy.no_night_watch_this_night_00')}">${t('analytics_occupancy.no_watch')}</span>`}</td>
        <td class="nowrap small">${esc(dateOf(n.window.from))} → ${esc(dateOf(n.window.to))}</td><td class="num">${occ(n.occupancy)}</td>
        <td class="num">${n.incidents == null ? '—' : n.incidents}</td><td class="num">${n.actions == null ? '—' : n.actions}</td><td class="num">${n.hoursSaved == null ? '—' : hours(n.hoursSaved)}</td>
        <td class="num">${fmtUsd(n.costUsd || 0)}</td><td>${n.watch ? `<button type="button" class="link-btn" data-occ-night="${esc(n.startedAt)}">${t('analytics_occupancy.night_watch')}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted small an-empty">${t('analytics_occupancy.no_night_in_this_range')}</p>`;
    return `<div class="card table-wrap"><table class="u-table an-sessions" data-testid="an-occ-nightwatch"><thead><tr><th></th><th class="num">${t('analytics_occupancy.hours')}</th><th class="num">${t('analytics_occupancy.occupancy')}</th><th>${t('analytics_occupancy.idle_by_cause')}</th><th class="num">${t('analytics_occupancy.issues_delivered')}</th><th class="num">${t('analytics_occupancy.cost')}</th></tr></thead><tbody>
        ${row(`${t('analytics_occupancy.under_the_night_watch')} <span class="muted small">${t('analytics_occupancy.nights_count', { count: nw.nights })}</span>`, nw.inside)}${row(t('analytics_occupancy.outside_it'), nw.outside)}</tbody></table></div>
      <div class="card table-wrap">${nights}</div>`;
  }

  // cost per active hour per day, as a line
  function costTrend(days) {
    const pts = days.map((d) => (d.activeHours > 0.05 ? d.costUsd / d.activeHours : null));
    const vals = pts.filter((v) => v != null);
    if (vals.length < 2) return `<p class="muted small">${t('analytics_occupancy.not_enough_active_days_for_a')}</p>`;
    const W = 900; const H = 90; const max = Math.max(...vals) || 1;
    const xy = pts.map((v, i) => (v == null ? null : [((i + 0.5) / days.length) * W, H - 6 - (v / max) * (H - 12)]));
    const path = xy.filter(Boolean).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const dots = xy.map((p, i) => (p ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" class="an-trend-dot"><title>${esc(fmtDay(days[i].day, true))}${t('analytics_occupancy.value_per_active_hour', { value: fmtUsd(pts[i]) })}</title></circle>` : '')).join('');
    return `<div class="an-chart"><div class="an-ymax muted small">${fmtUsd(max)}/h</div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t('analytics_occupancy.cost_per_active_hour_per_day')}"><path d="${path}" class="an-trend" />${dots}</svg></div>`;
  }

  function costCard(o) {
    const c = o.cost;
    const side = (s) => {
      const per = (n, k = 1) => (n > 0 ? fmtUsd((s.costUsd * k) / n) : '—');
      return `<td class="num">${per(s.activeHours)}</td><td class="num">${per(s.issues)}</td><td class="num">${per(s.lines, 100)}</td>`;
    };
    return `<div class="an-totals">
        ${stat(t('analytics_occupancy.cost_per_active_hour'), c.perActiveHour == null ? '—' : fmtUsd(c.perActiveHour), t('analytics_occupancy.costusd_over_activehours_active', { costUsd: fmtUsd(o.costUsd), activeHours: hours(o.activeHours) }))}
        ${stat(t('analytics_occupancy.cost_per_delivered_issue'), c.perIssue == null ? '—' : fmtUsd(c.perIssue), t('analytics_occupancy.issues_delivered_count', { count: o.issues, n: fmtNum(o.issues) }))}
        ${stat(t('analytics_occupancy.cost_per_100_lines'), c.per100Lines == null ? '—' : fmtUsd(c.per100Lines), o.lines ? t('analytics_occupancy.lines_lines_changed_by_the_local', { lines: fmtNum(o.lines) }) : t('analytics_occupancy.no_local_merge_with_lines_in'))}
      </div>
      <div class="card table-wrap"><table class="u-table an-sessions"><thead><tr><th></th><th class="num">${t('analytics_occupancy.per_active_hour')}</th><th class="num">${t('analytics_occupancy.per_issue')}</th><th class="num">${t('analytics_occupancy.per_100_lines')}</th></tr></thead><tbody>
        <tr><td>${t('analytics_occupancy.under_the_night_watch')}</td>${side(o.nightWatch.inside)}</tr><tr><td>${t('analytics_occupancy.outside_it')}</td>${side(o.nightWatch.outside)}</tr></tbody></table></div>
      <div class="card an-card"><h3>${t('analytics_occupancy.cost_per_active_hour_per_day')}</h3>${costTrend(o.days)}</div>`;
  }

  function calibrationCard(list) {
    if (!list.length) return `<p class="muted small an-empty">${t('analytics_occupancy.no_run_was_planned_by_a')}</p>`;
    return `<table class="u-table an-sessions" data-testid="an-occ-calibration"><thead><tr><th>${t('analytics_occupancy.calibration')}</th><th class="num">${t('analytics_occupancy.runs')}</th><th class="num">${t('analytics_occupancy.runs_per_stage')}</th><th class="num" title="${t('analytics_occupancy.runs_that_went_through_resolve_merge')}">${t('analytics_occupancy.resolve_merge')}</th><th class="num">${t('analytics_occupancy.review_rounds_avg')}</th><th class="num">${t('analytics_occupancy.cost_per_issue')}</th></tr></thead><tbody>
      ${list.map((c) => `<tr><td>${esc(c.label || String(c.calibration))}</td><td class="num">${c.runs}</td><td class="num">${c.runsPerStage == null ? '—' : (Math.round(c.runsPerStage * 10) / 10).toFixed(1)}</td><td class="num">${pct(c.resolveMergeShare)}</td><td class="num">${(Math.round(c.reviewRounds * 10) / 10).toFixed(1)}</td><td class="num">${c.costPerIssue == null ? '—' : fmtUsd(c.costPerIssue)}</td></tr>`).join('')}</tbody></table>`;
  }

  function hint(h) {
    if (!h) return '';
    const go = { noWork: 'analytics_occupancy.open_the_live_roadmap', appClosed: 'analytics_occupancy.open_keep_awake', gate: 'analytics_occupancy.open_the_night_watch' }[h.cause];
    return `<div class="card an-card an-hint" role="note" data-testid="an-occ-hint"><b>${esc(causeLabel(h.cause))}${t('analytics_occupancy.share_of_the_idle_time', { share: pct(h.share) })}</b> ${esc(h.text)} <button type="button" class="btn sm ghost" data-occ-hint="${esc(h.cause)}">${go ? esc(t(go)) : ''}</button></div>`;
  }

  function render(body) {
    const seg = `<div class="row an-card-head"><div class="seg sm" role="group" aria-label="${t('analytics_occupancy.n24_7_range')}"><button type="button" data-occ-days="7" class="${ox.days === 7 ? 'active' : ''}">${t('analytics_occupancy.n7_days')}</button><button type="button" data-occ-days="30" class="${ox.days === 30 ? 'active' : ''}">${t('analytics_occupancy.n30_days')}</button></div>
      <span class="muted small">${t('analytics_occupancy.your_local_time_simulated_runs_never')}</span></div>`;
    if (ox.error) { body.innerHTML = `${seg}<div class="usage-unavailable" role="alert">${t('analytics_occupancy.could_not_load_the_24_7')} ${esc(ox.error)}</div>`; wire(body); return; }
    const o = ox.data;
    if (!o) { body.innerHTML = `${seg}<p class="muted">${t('analytics_occupancy.loading')}</p>`; wire(body); return; }
    if (o.empty) { body.innerHTML = `${seg}<div class="empty-state" data-testid="an-occ-empty"><b>${t('analytics_occupancy.no_runs_yet_start_one_to')}</b><p class="muted">${t('analytics_occupancy.the_meter_counts_the_time_with')}</p></div>`; wire(body); return; }
    const notes = [
      o.partialSince ? t('analytics_occupancy.note_records_since', { date: dateOf(o.partialSince) }) : '',
      !o.appLog ? t('analytics_occupancy.note_no_heartbeat_log') : '',
      o.days.some((d) => d.partial) ? t('analytics_occupancy.note_partial_days') : '',
    ].filter(Boolean);
    body.innerHTML = `${seg}
      ${notes.length ? `<p class="muted small an-note an-occ-note" data-testid="an-occ-partial">${notes.map(esc).join(' ')}</p>` : ''}
      ${hint(o.hint)}
      ${cards(o)}
      <div class="card an-card"><div class="row an-card-head"><h3>${t('analytics_occupancy.day_by_day')}</h3>${legend()}</div>${dayChart(o.days)}</div>
      <div class="card an-card" data-testid="an-occ-hours"><div class="row an-card-head"><h3>${t('analytics_occupancy.hours_of_the_day')} <span class="muted small">${t('analytics_occupancy.more_active_hours_are_stronger')}</span></h3>${heatLegend()}</div>${heatStrip(o.days)}</div>
      <h3 class="s-subtitle">${t('analytics_occupancy.night_watch_2')} <span class="muted small">${t('analytics_occupancy.inside_its_windows_vs_outside_last', { span: o.span })}</span></h3>
      ${nightWatch(o)}
      <h3 class="s-subtitle">${t('analytics_occupancy.n24_7_at_what_price')}</h3>
      ${costCard(o)}
      <h3 class="s-subtitle">${t('analytics_occupancy.by_the_product_owner_s_calibration')}</h3>
      <div class="card table-wrap">${calibrationCard(o.calibration || [])}</div>
      <h3 class="s-subtitle">${t('analytics_occupancy.idle_gaps_over_15_minutes')}</h3>
      <div class="card table-wrap" data-testid="an-occ-gaps">${gapsTable(o.gaps)}</div>
      <p class="muted small an-note">${t('analytics_occupancy.blocked_counts_failed_and_interrupted_runs')}</p>`;
    wire(body);
  }

  function wire(body) {
    body.querySelectorAll('[data-occ-days]').forEach((b) => {
      b.onclick = async () => {
        ox.days = Number(b.dataset.occDays) === 7 ? 7 : 30;
        try { localStorage.setItem(LS, String(ox.days)); } catch { /* ignore */ }
        ox.data = null; render(body); await load(); render(body);
      };
    });
    body.querySelectorAll('[data-occ-night]').forEach((b) => {
      b.onclick = () => {
        if (window.NightWatchView?.openNight) window.NightWatchView.openNight(b.dataset.occNight);
        else showView('nightwatch');
      };
    });
    body.querySelectorAll('[data-occ-hint]').forEach((b) => {
      b.onclick = () => {
        const cause = b.dataset.occHint;
        if (cause === 'noWork') showView('roadmap');
        else if (cause === 'gate') showView('nightwatch');
        else { showView('settings'); if (typeof showSettingsTab === 'function') showSettingsTab('execution'); }
      };
    });
  }

  window.AnalyticsTabs = window.AnalyticsTabs || {};
  window.AnalyticsTabs.occupancy = {
    id: 'occupancy',
    label: '24/7',
    order: 20,
    load,
    render,
    sub: () => `${t('analytics_occupancy.sub', { days: ox.days })}${ox.loading ? t('analytics_occupancy.loading_suffix') : ''}`,
    context: () => (ox.data && !ox.data.empty ? `24/7 tab, last ${ox.days} days: ${pct(ox.data.occupancy)} active, idle mostly ${ox.data.hint ? ox.data.hint.cause : 'spread'}` : '24/7 tab, no runs yet'),
  };
})();
