// Analytics › 24/7 (#188): how close the machine is to always working, and at what price. Cards
// (occupancy over 24 h, 7 and 30 days, the current active streak, the week's longest idle gap and its
// cause, average and peak runs at once), a day-by-day chart of active vs idle time by cause, a 24-hour
// heat strip per day (the owner's local time; #275: five levels from idle to fully active, more is
// more, a hatched cell for an hour without data, a legend), the idle gaps over 15 min, the Night watch
// split (inside vs outside its windows, and its nights next to the nights without it), the cost per
// active hour, per delivered issue and per 100 lines with a trend, the split by the Product Owner's
// calibration (#189), and one plain hint when an idle cause dominates. Day labels follow the owner's
// locale (navigator.language) in the machine's time zone (#273). Channel analytics:occupancy
// (src/occupancy.js via src/service/areas/insights.js). A tab of views/analytics/analytics.js
// (window.AnalyticsTabs). Uses app.js globals: api, esc, fmtUsd, fmtDur, fmtNum, dateOf, errMsg, showView.
(() => {
  const LS = 'multiagent.analytics.occupancy';
  const CAUSES = [
    ['noWork', 'No work', 'var(--muted)'],
    ['blocked', 'Blocked', 'var(--red)'],
    ['gate', 'Waiting for you', 'var(--yellow)'],
    ['appClosed', 'App closed / asleep', 'var(--purple)'],
    ['other', 'Other', 'var(--orange)'],
  ];
  const CAUSE_LABEL = Object.fromEntries(CAUSES.map(([k, l]) => [k, l]));
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
  const HEAT_LABELS = ['Idle', 'Under 25% active', '25–50% active', '50–75% active', 'Over 75% active'];
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
      ${stat('Last 24 h', occ(o.cards.day.occupancy), `${hours(o.cards.day.activeHours)} active of ${hours(o.cards.day.hours)}`)}
      ${stat('7 days', occ(o.cards.week.occupancy), `${hours(o.cards.week.activeHours)} active of ${hours(o.cards.week.hours)}`)}
      ${stat('30 days', occ(o.cards.month.occupancy), `${hours(o.cards.month.activeHours)} active of ${hours(o.cards.month.hours)}`)}
      ${stat('Active streak', o.streakMinutes ? fmtDur(o.streakMinutes * 60e3) : '—', o.running ? 'A run is active now' : `Idle now for ${fmtDur(o.idleNowMinutes * 60e3)}`)}
      ${stat('Longest idle gap (week)', g ? `${fmtDur(g.minutes * 60e3)} <span class="muted small">${esc(CAUSE_LABEL[g.cause] || g.cause)}</span>` : '—', g ? `${dateOf(g.from)} → ${dateOf(g.to)}` : '')}
      ${stat('Runs at once', `${o.avgConcurrent == null ? '—' : (Math.round(o.avgConcurrent * 10) / 10).toFixed(1)} <span class="muted small">avg · peak ${fmtNum(o.peakConcurrent)}</span>`, 'Average while at least one run is active, and the peak')}
    </div>`;
  }

  const legend = () => `<div class="an-legend"><span><i style="background:${ACTIVE}"></i>Active</span>${CAUSES.map(([, l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;

  // active vs idle by cause, one bar per local day
  function dayChart(days) {
    const W = 900; const H = 160; const bw = W / Math.max(1, days.length);
    const bars = days.map((d, i) => {
      const span = d.hours || 24;
      let y = H;
      const parts = [['active', d.activeHours, ACTIVE], ...CAUSES.map(([k, , c]) => [k, d.idleHours[k], c])].map(([k, v, c]) => {
        const h = (v / 24) * H;
        y -= h;
        return v > 0 ? `<rect x="${(i * bw + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 4).toFixed(1)}" height="${h.toFixed(1)}" style="fill:${c}"><title>${esc(fmtDay(d.day, true))} · ${esc(k === 'active' ? 'Active' : CAUSE_LABEL[k])}: ${hours(v)}</title></rect>` : '';
      }).join('');
      return `<g>${parts}<rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" class="an-hit"><title>${esc(fmtDay(d.day, true))}: ${pct(d.occupancy)} active (${hours(d.activeHours)} of ${hours(span)})${d.partial ? ', partial day' : ''}</title></rect></g>`;
    }).join('');
    const every = Math.ceil(days.length / 10);
    const labels = days.map((d, i) => (i % every === 0 ? `<span style="left:${((i + 0.5) / days.length) * 100}%">${esc(fmtDay(d.day))}</span>` : '')).join('');
    return `<div class="an-chart" data-testid="an-occ-days"><div class="an-ymax muted small">24 h</div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Active and idle hours per day">${bars}</svg><div class="an-xlabels">${labels}</div></div>`;
  }

  // a 24-hour strip per day, newest first: the share of each local hour with a run active, as one of
  // five levels (more is more); a hatched cell when the hour was not measured (before the log, or ahead)
  function heatCell(day, h, v) {
    if (v == null) return `<i class="an-heat-cell an-heat-nodata" title="${esc(`${fmtDay(day, true)}, ${hh(h)}–${hh(h + 1)} · no data`)}"></i>`;
    const title = `${fmtDay(day, true)}, ${hh(h)}–${hh(h + 1)} · ${Math.round(v * 60)} min active (${pct(v)})`;
    return `<i class="an-heat-cell an-heat-l${heatLevel(v)}" title="${esc(title)}"></i>`;
  }
  function heatStrip(days) {
    const rows = [...days].reverse().map((d) => `<div class="an-heat-row"><span class="an-heat-day mono small" title="${esc(fmtDay(d.day, true))}">${esc(fmtDay(d.day))}</span>${d.hourly.map((v, h) => heatCell(d.day, h, v)).join('')}</div>`).join('');
    const axis = `<div class="an-heat-row an-heat-axis"><span class="an-heat-day"></span>${Array.from({ length: 24 }, (_, h) => `<em>${h % 3 === 0 ? h : ''}</em>`).join('')}</div>`;
    return `<div class="an-heat" data-testid="an-occ-heat" role="img" aria-label="Active share of each hour, per day">${rows}${axis}</div>`;
  }
  const heatLegend = () => `<div class="an-legend an-heat-legend" data-testid="an-occ-heat-legend" aria-label="Heatmap scale"><span class="an-heat-scale">Idle ${HEAT_LABELS.map((l, i) => `<i class="an-heat-cell an-heat-l${i}" title="${esc(l)}"></i>`).join('')} Fully active</span><span><i class="an-heat-cell an-heat-nodata"></i>No data</span></div>`;

  function gapsTable(gaps) {
    if (!gaps.length) return '<p class="muted small an-empty">No idle gap longer than 15 minutes.</p>';
    return `<table class="u-table an-sessions"><thead><tr><th>From</th><th>To</th><th class="num">Length</th><th>Cause</th><th>Ended by</th></tr></thead><tbody>
      ${[...gaps].reverse().slice(0, 60).map((g) => `<tr><td class="nowrap">${esc(dateOf(g.from))}</td><td class="nowrap">${esc(dateOf(g.to))}</td><td class="num">${fmtDur(g.minutes * 60e3)}</td>
        <td><span class="badge an-cause" style="color:${CAUSES.find(([k]) => k === g.cause)?.[2] || 'inherit'}">${esc(CAUSE_LABEL[g.cause] || g.cause)}</span></td><td class="small">${esc(g.endedBy || 'still idle')}</td></tr>`).join('')}</tbody></table>`;
  }

  function idleSplit(idle) {
    const total = idle.total || 0;
    if (!total) return '<span class="muted small">No idle time.</span>';
    return `<div class="an-stack">${CAUSES.filter(([k]) => idle[k] > 0).map(([k, l, c]) => `<span style="flex:${idle[k]};background:${c}" title="${esc(l)}: ${hours(idle[k])}"></span>`).join('')}</div>`;
  }

  function nightWatch(o) {
    const nw = o.nightWatch;
    const row = (label, s) => `<tr><td>${label}</td><td class="num">${hours(s.hours)}</td><td class="num">${occ(s.occupancy)}</td><td class="an-idle-cell">${idleSplit(s.idleHours)}</td><td class="num">${fmtNum(s.issues)}</td><td class="num">${fmtUsd(s.costUsd)}</td></tr>`;
    const nights = o.nights.length ? `<table class="u-table an-sessions"><thead><tr><th>Night</th><th>Window</th><th class="num">Occupancy</th><th class="num">Incidents</th><th class="num">Actions</th><th class="num">Hours saved</th><th class="num">Cost</th><th></th></tr></thead><tbody>
      ${o.nights.map((n) => `<tr><td class="nowrap" title="${esc(n.startedAt)}">${esc(fmtWhenDay(n.startedAt))}${n.watch ? '' : ' <span class="badge" title="No Night watch this night: 00:00-08:00 shown">no watch</span>'}</td>
        <td class="nowrap small">${esc(dateOf(n.window.from))} → ${esc(dateOf(n.window.to))}</td><td class="num">${occ(n.occupancy)}</td>
        <td class="num">${n.incidents == null ? '—' : n.incidents}</td><td class="num">${n.actions == null ? '—' : n.actions}</td><td class="num">${n.hoursSaved == null ? '—' : hours(n.hoursSaved)}</td>
        <td class="num">${fmtUsd(n.costUsd || 0)}</td><td>${n.watch ? `<button type="button" class="link-btn" data-occ-night="${esc(n.startedAt)}">Night watch →</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted small an-empty">No night in this range.</p>';
    return `<div class="card table-wrap"><table class="u-table an-sessions" data-testid="an-occ-nightwatch"><thead><tr><th></th><th class="num">Hours</th><th class="num">Occupancy</th><th>Idle by cause</th><th class="num">Issues delivered</th><th class="num">Cost</th></tr></thead><tbody>
        ${row(`Under the Night watch <span class="muted small">(${nw.nights} night${nw.nights === 1 ? '' : 's'})</span>`, nw.inside)}${row('Outside it', nw.outside)}</tbody></table></div>
      <div class="card table-wrap">${nights}</div>`;
  }

  // cost per active hour per day, as a line
  function costTrend(days) {
    const pts = days.map((d) => (d.activeHours > 0.05 ? d.costUsd / d.activeHours : null));
    const vals = pts.filter((v) => v != null);
    if (vals.length < 2) return '<p class="muted small">Not enough active days for a trend.</p>';
    const W = 900; const H = 90; const max = Math.max(...vals) || 1;
    const xy = pts.map((v, i) => (v == null ? null : [((i + 0.5) / days.length) * W, H - 6 - (v / max) * (H - 12)]));
    const path = xy.filter(Boolean).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const dots = xy.map((p, i) => (p ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" class="an-trend-dot"><title>${esc(fmtDay(days[i].day, true))}: ${fmtUsd(pts[i])} per active hour</title></circle>` : '')).join('');
    return `<div class="an-chart"><div class="an-ymax muted small">${fmtUsd(max)}/h</div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Cost per active hour, per day"><path d="${path}" class="an-trend" />${dots}</svg></div>`;
  }

  function costCard(o) {
    const c = o.cost;
    const side = (s) => {
      const per = (n, k = 1) => (n > 0 ? fmtUsd((s.costUsd * k) / n) : '—');
      return `<td class="num">${per(s.activeHours)}</td><td class="num">${per(s.issues)}</td><td class="num">${per(s.lines, 100)}</td>`;
    };
    return `<div class="an-totals">
        ${stat('Cost per active hour', c.perActiveHour == null ? '—' : fmtUsd(c.perActiveHour), `${fmtUsd(o.costUsd)} over ${hours(o.activeHours)} active`)}
        ${stat('Cost per delivered issue', c.perIssue == null ? '—' : fmtUsd(c.perIssue), `${fmtNum(o.issues)} issue(s) delivered`)}
        ${stat('Cost per 100 lines', c.per100Lines == null ? '—' : fmtUsd(c.per100Lines), o.lines ? `${fmtNum(o.lines)} lines changed by the local merges` : 'No local merge with lines in this range')}
      </div>
      <div class="card table-wrap"><table class="u-table an-sessions"><thead><tr><th></th><th class="num">Per active hour</th><th class="num">Per issue</th><th class="num">Per 100 lines</th></tr></thead><tbody>
        <tr><td>Under the Night watch</td>${side(o.nightWatch.inside)}</tr><tr><td>Outside it</td>${side(o.nightWatch.outside)}</tr></tbody></table></div>
      <div class="card an-card"><h3>Cost per active hour, per day</h3>${costTrend(o.days)}</div>`;
  }

  function calibrationCard(list) {
    if (!list.length) return '<p class="muted small an-empty">No run was planned by a Product Owner answer with a calibration in this range.</p>';
    return `<table class="u-table an-sessions" data-testid="an-occ-calibration"><thead><tr><th>Calibration</th><th class="num">Runs</th><th class="num">Runs per stage</th><th class="num" title="Runs that went through resolve_merge">resolve_merge</th><th class="num">Review rounds (avg)</th><th class="num">Cost per issue</th></tr></thead><tbody>
      ${list.map((c) => `<tr><td>${esc(c.label || String(c.calibration))}</td><td class="num">${c.runs}</td><td class="num">${c.runsPerStage == null ? '—' : (Math.round(c.runsPerStage * 10) / 10).toFixed(1)}</td><td class="num">${pct(c.resolveMergeShare)}</td><td class="num">${(Math.round(c.reviewRounds * 10) / 10).toFixed(1)}</td><td class="num">${c.costPerIssue == null ? '—' : fmtUsd(c.costPerIssue)}</td></tr>`).join('')}</tbody></table>`;
  }

  function hint(h) {
    if (!h) return '';
    const go = { noWork: 'Open the Live roadmap', appClosed: 'Open Keep awake', gate: 'Open the Night watch' }[h.cause];
    return `<div class="card an-card an-hint" role="note" data-testid="an-occ-hint"><b>${esc(CAUSE_LABEL[h.cause])}: ${pct(h.share)} of the idle time.</b> ${esc(h.text)} <button type="button" class="btn sm ghost" data-occ-hint="${esc(h.cause)}">${esc(go)}</button></div>`;
  }

  function render(body) {
    const seg = `<div class="row an-card-head"><div class="seg sm" role="group" aria-label="24/7 range"><button type="button" data-occ-days="7" class="${ox.days === 7 ? 'active' : ''}">7 days</button><button type="button" data-occ-days="30" class="${ox.days === 30 ? 'active' : ''}">30 days</button></div>
      <span class="muted small">Your local time · simulated runs never count</span></div>`;
    if (ox.error) { body.innerHTML = `${seg}<div class="usage-unavailable" role="alert">Could not load the 24/7 meter: ${esc(ox.error)}</div>`; wire(body); return; }
    const o = ox.data;
    if (!o) { body.innerHTML = `${seg}<p class="muted">Loading…</p>`; wire(body); return; }
    if (o.empty) { body.innerHTML = `${seg}<div class="empty-state" data-testid="an-occ-empty"><b>No runs yet: start one to measure</b><p class="muted">The meter counts the time with at least one real run active.</p></div>`; wire(body); return; }
    const notes = [
      o.partialSince ? `The app records when it runs since ${dateOf(o.partialSince)}: before that, "app closed" time counts as no work.` : '',
      !o.appLog ? 'The app has no heartbeat log yet: "app closed / asleep" time cannot be told apart from no work.' : '',
      o.days.some((d) => d.partial) ? 'The first and last days are partial (the window starts and ends mid-day).' : '',
    ].filter(Boolean);
    body.innerHTML = `${seg}
      ${notes.length ? `<p class="muted small an-note an-occ-note" data-testid="an-occ-partial">${notes.map(esc).join(' ')}</p>` : ''}
      ${hint(o.hint)}
      ${cards(o)}
      <div class="card an-card"><div class="row an-card-head"><h3>Day by day</h3>${legend()}</div>${dayChart(o.days)}</div>
      <div class="card an-card" data-testid="an-occ-hours"><div class="row an-card-head"><h3>Hours of the day <span class="muted small">(more active hours are stronger)</span></h3>${heatLegend()}</div>${heatStrip(o.days)}</div>
      <h3 class="s-subtitle">Night watch <span class="muted small">(inside its windows vs outside, last ${o.span} days)</span></h3>
      ${nightWatch(o)}
      <h3 class="s-subtitle">24/7 at what price</h3>
      ${costCard(o)}
      <h3 class="s-subtitle">By the Product Owner's calibration</h3>
      <div class="card table-wrap">${calibrationCard(o.calibration || [])}</div>
      <h3 class="s-subtitle">Idle gaps over 15 minutes</h3>
      <div class="card table-wrap" data-testid="an-occ-gaps">${gapsTable(o.gaps)}</div>
      <p class="muted small an-note">"Blocked" counts failed and interrupted runs, and the incidents the Night watch logged (a paused roadmap, a stall). Outside the Night watch windows nothing records when the roadmap was paused, so that time counts as no work.</p>`;
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
    sub: () => `How much of the time a run is active, why it idles, and at what cost (last ${ox.days} days)${ox.loading ? ' — loading…' : ''}`,
    context: () => (ox.data && !ox.data.empty ? `24/7 tab, last ${ox.days} days: ${pct(ox.data.occupancy)} active, idle mostly ${ox.data.hint ? CAUSE_LABEL[ox.data.hint.cause] : 'spread'}` : '24/7 tab, no runs yet'),
  };
})();
