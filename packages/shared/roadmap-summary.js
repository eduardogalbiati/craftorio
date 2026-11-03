// Roadmap summary (#421): what the planned roadmap still costs and how long it takes, in total and per
// release cut line (#260), and what it already spent; pure (no DOM, no files, never changes its input).
// The Roadmap bar draws it from the same estimates the items show (#206 cost, #215 time); it loads in
// node (require) and in the renderer (<script>, window.RoadmapSummary), RoadmapModel read at call time.
//
// summarize({ stages, releases }) -> { planned, spent, releases }
//   planned { usd, minutes, items, stages, withoutEstimate: [{ id, title }] }: the enabled stages' items
//     not finished; a running item counts its estimate minus what its run spent and elapsed (never below
//     zero); an item without an estimate is listed, never counted as zero. Stages run in sequence, a
//     stage's items in parallel: minutes is the sum of each stage's longest remainder (gates not counted).
//   spent { usd, since }: the real cost of the finished and running items; since: the oldest item origin.
//   releases: per cut line in stage order ({ version, at }: the stages after the previous line up to
//     stage `at`, plus the release run's own estimate), then { after: true } for the rest; [] without lines.
// #750: the Roadmap header's numbers band drawn from it: stats(roadmap) the values (null when unknown), statsHtml the four
// columns (Stages, Left, Forecast, Spent); byReleaseHtml(roadmap, { open, money, minutes }) the "By release" button and list
// of the view band (catalog text, #330).
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const model = () => (node ? require('./roadmap-model') : root.RoadmapModel);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const round = (v) => Math.round(v * 1e6) / 1e6;

  /** One stage's part left: { usd, minutes, items, withoutEstimate } (a disabled stage: nothing). */
  function stagePart(stage) {
    const part = { usd: 0, minutes: 0, items: 0, withoutEstimate: [] };
    if (!stage || stage.disabled) return part;
    for (const x of Array.isArray(stage.items) ? stage.items : []) {
      if (model().isFinished(x) || x.status === 'skipped') continue;
      part.items += 1;
      const usd = num(x.estimate?.usd);
      if (usd === null) { part.withoutEstimate.push({ id: x.id, title: x.title || (Array.isArray(x.issues) ? x.issues : []).map((i) => `#${i.number} ${i.title || ''}`.trim()).join(', ') || String(x.id) }); continue; }
      const running = x.status === 'running';
      part.usd += Math.max(0, usd - (running ? num(x.actualUsd) || 0 : 0));
      const minutes = num(x.estimate.minutes);
      if (minutes !== null) part.minutes = Math.max(part.minutes, Math.max(0, minutes - (running ? num(x.actualMinutes) || 0 : 0)));
    }
    return part;
  }

  /** Adds stage parts (and a release run's estimate) into one total. */
  function total(parts, extra) {
    const out = { usd: 0, minutes: 0, items: 0, stages: 0, withoutEstimate: [] };
    for (const p of parts) {
      out.usd += p.usd;
      out.minutes += p.minutes;
      out.items += p.items;
      if (p.items) out.stages += 1;
      out.withoutEstimate.push(...p.withoutEstimate);
    }
    out.usd = round(out.usd + (num(extra?.usd) || 0));
    out.minutes = round(out.minutes + (num(extra?.minutes) || 0));
    return out;
  }

  function summarize({ stages = [], releases = [] } = {}) {
    const list = Array.isArray(stages) ? stages : [];
    const parts = list.map(stagePart);
    let spent = 0;
    let since = null;
    for (const x of list.flatMap((s) => (Array.isArray(s.items) ? s.items : []))) {
      if (x.status === 'done' || x.status === 'running' || x.status === 'parked') spent += num(x.actualUsd) || 0;
      if (x.origin && (!since || Date.parse(x.origin) < Date.parse(since))) since = x.origin;
    }
    const lines = (Array.isArray(releases) ? releases : []).filter((x) => num(x?.at) !== null && x.at >= 0).sort((a, b) => a.at - b.at);
    const split = [];
    let from = 0;
    for (const line of lines) {
      split.push({ version: line.version, at: line.at, ...total(parts.slice(from, line.at + 1), line.estimate) });
      from = line.at + 1;
    }
    if (lines.length) split.push({ after: true, ...total(parts.slice(from)) });
    return { planned: total(parts), spent: { usd: round(spent), since }, releases: split };
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const i18n = () => (node ? require('./i18n') : root.I18n);
  const t = (...a) => i18n()?.t(...a) ?? a[0];
  const stagesOf = (roadmap) => (Array.isArray(roadmap?.stages) ? roadmap.stages : []);
  const summaryOf = (stages) => summarize({ stages, releases: stages.flatMap((s, at) => (s.release ? [{ version: s.release.name, at, estimate: s.release.estimate }] : [])) });

  /**
   * #750: the header's numbers as values: { stages, disabled, left: { items, stages }, forecast: { usd, minutes } | null,
   * spent: { usd, since } | null, withoutEstimate }. forecast is null when no item left has an estimate, spent when no item has a real cost.
   */
  function stats(roadmap) {
    const stages = stagesOf(roadmap);
    const S = summaryOf(stages);
    const p = S.planned;
    const costed = stages.flatMap((s) => (Array.isArray(s.items) ? s.items : [])).some((x) => ['done', 'running', 'parked'].includes(x.status) && num(x.actualUsd) !== null);
    return {
      stages: stages.length,
      disabled: stages.filter((s) => s.disabled).length,
      left: { items: p.items, stages: p.stages },
      forecast: p.items > p.withoutEstimate.length ? { usd: p.usd, minutes: p.minutes } : null,
      spent: costed ? S.spent : null,
      withoutEstimate: p.withoutEstimate,
    };
  }

  /**
   * #750: the header's numbers band (rm-head-stats): four columns, each a muted label, the value and a muted detail; "—" for an
   * unknown value, the column always there. `minutes`: the view's time format; money in the interface's locale (I18n.formatCost).
   */
  function statsHtml(roadmap, { minutes, money = (n) => i18n()?.formatCost(n) ?? `$${Number(n).toFixed(2)}` } = {}) {
    const s = stats(roadmap);
    const none = s.withoutEstimate.length ? t('backlog_roadmap.summary_without_estimate', { count: s.withoutEstimate.length }) : '';
    const noneTip = none ? t('backlog_roadmap.summary_without_estimate_tip', { items: s.withoutEstimate.map((x) => x.title).join(', ') }) : '';
    const col = (label, value, detail, tip = '') => `<div class="rm-head-stat" data-testid="roadmap-stat"${tip ? ` title="${esc(tip)}"` : ''}><small class="muted" data-testid="roadmap-stat-label">${esc(t(label))}</small><strong data-testid="roadmap-stat-value">${esc(value)}</strong><small class="muted" data-testid="roadmap-stat-detail">${esc(detail || '—')}</small></div>`;
    return `<div class="rm-head-stats" data-testid="roadmap-stats">${[
      col('backlog_roadmap.stat_stages', i18n()?.formatNumber(s.stages) ?? String(s.stages), t('backlog_roadmap.stat_disabled', { count: s.disabled })),
      col('backlog_roadmap.stat_left', t('backlog_roadmap.items_count', { count: s.left.items }), t('backlog_roadmap.stat_in_stages', { count: s.left.stages })),
      col('backlog_roadmap.stat_forecast', s.forecast ? `≈ ${minutes(s.forecast.minutes)}` : '—', s.forecast ? `≈ ${money(s.forecast.usd)}${none ? ` · ${none}` : ''}` : none, [t('backlog_roadmap.summary_tip'), noneTip].filter(Boolean).join('\n')),
      col('backlog_roadmap.stat_spent', s.spent ? money(s.spent.usd) : '—', t('backlog_roadmap.stat_so_far'), s.spent?.since ? t('backlog_roadmap.summary_spent_tip', { date: String(s.spent.since).slice(0, 10) }) : ''),
    ].join('')}</div>`;
  }

  /**
   * The "By release" button and its list (#421; #750: in the header's view band), one row per cut line; '' without a cut
   * line. `open`: its list drawn; `money`, `minutes`: the view's formats.
   */
  function byReleaseHtml(roadmap, { open = false, money, minutes }) {
    const S = summaryOf(stagesOf(roadmap));
    if (!S.releases.length) return '';
    const plan = (p) => `≈ ${money(p.usd)} · ≈ ${minutes(p.minutes)}`;
    const none = (p) => (p.withoutEstimate.length ? ` <span class="warn-text" title="${esc(t('backlog_roadmap.summary_without_estimate_tip', { items: p.withoutEstimate.map((x) => x.title).join(', ') }))}">${esc(t('backlog_roadmap.summary_without_estimate', { count: p.withoutEstimate.length }))}</span>` : '');
    const rows = S.releases.map((x) => `<div class="rm-summary-row" data-testid="roadmap-summary-release-row"><b>${esc(x.after ? t('backlog_roadmap.summary_after_last_cut') : x.version)}</b><span class="muted">${plan(x)}${none(x)}</span></div>`);
    const list = open ? `<div class="bl-menu rm-summary-releases" data-testid="roadmap-summary-releases">${rows.join('')}</div>` : '';
    return `<span class="bl-menu-wrap rm-by-release"><button class="btn sm ghost" type="button" data-rm-summary-releases data-testid="roadmap-summary-by-release" aria-expanded="${open}" title="${esc(t('backlog_roadmap.summary_by_release_tip'))}">${esc(t('backlog_roadmap.summary_by_release'))} ${open ? '▴' : '▾'}</button>${list}</span>`;
  }

  const api = {
    byReleaseHtml,
    stats,
    statsHtml,
    summarize,
  };
  if (node) module.exports = api;
  else root.RoadmapSummary = api;
})(typeof window !== 'undefined' ? window : globalThis);
