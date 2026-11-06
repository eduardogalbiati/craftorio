// Roadmap summary (#421): what the planned roadmap still costs and how long it takes, in total and per
// release cut line (#260), and what it already spent; pure (no DOM, no files, never changes its input).
// The Roadmap bar draws it from the same estimates the items show (#206 cost, #215 time); it loads in
// node (require) and in the renderer (<script>, window.RoadmapSummary), RoadmapModel read at call time.
//
// summarize({ stages, releases }) -> { planned, spent, releases }
//   planned { usd, minutes, items, stages, withoutEstimate: [{ id, title }] }: the enabled stages' items
//     not finished; a running item counts its estimate minus what its run spent and elapsed (never below
//     zero); an item waiting for its merge (#797) counts as an item, with nothing left to spend; an item
//     without an estimate is listed, never counted as zero. Stages run in sequence, a stage's items in
//     parallel: minutes is the sum of each stage's longest remainder (gates not counted).
//   spent { usd, since }: the real cost of the finished and running items; since: the oldest item origin.
//   releases: per cut line in stage order ({ version, at }: the stages after the previous line up to
//     stage `at`, plus the release run's own estimate), then { after: true } for the rest; [] without lines.
// #750: stats(roadmap) the Roadmap header's numbers as values (null when unknown; backlog-live.js statsHtml draws the four
// columns); byReleaseHtml(roadmap, { open, money, minutes }) the "By release" button and list of its view band (catalog text, #330).
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
      if (x.status === 'waiting_merge') continue; // #797: its run ended, only a person's merge is left
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
    let costed = 0; // #750: the items with a real cost (the header's Spent is "—" without one)
    let since = null;
    for (const x of list.flatMap((s) => (Array.isArray(s.items) ? s.items : []))) {
      if (['done', 'parked', 'running', 'waiting_merge'].includes(x.status) && num(x.actualUsd) !== null) { spent += num(x.actualUsd); costed += 1; }
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
    return { planned: total(parts), spent: { usd: round(spent), since, items: costed }, releases: split };
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const i18n = () => (node ? require('./i18n') : root.I18n);
  const t = (...a) => i18n()?.t(...a) ?? a[0];
  const stagesOf = (roadmap) => (Array.isArray(roadmap?.stages) ? roadmap.stages : []);
  const summaryOf = (stages) => summarize({ stages, releases: stages.flatMap((s, at) => (s.release ? [{ version: s.release.name, at, estimate: s.release.estimate }] : [])) });

  /**
   * #750: the header's numbers as values: { stages, disabled, left: { items, stages }, forecast: { usd, minutes } | null,
   * spent: { usd, since, items } | null, withoutEstimate }. forecast is null when no item left has an estimate, spent when no item has a real cost.
   */
  function stats(roadmap) {
    const stages = stagesOf(roadmap);
    const S = summaryOf(stages);
    const p = S.planned;
    return {
      stages: stages.length,
      disabled: stages.filter((s) => s.disabled).length,
      left: { items: p.items, stages: p.stages },
      forecast: p.items > p.withoutEstimate.length ? { usd: p.usd, minutes: p.minutes } : null,
      spent: S.spent.items > 0 ? S.spent : null,
      withoutEstimate: p.withoutEstimate,
    };
  }

  /**
   * The "By release" button and its list (#421; #750: in the header's view band), one row per cut line; '' without a cut
   * line. `open`: its list drawn; `money`, `minutes`: the view's formats.
   */
  function byReleaseHtml(roadmap, { open = false, money, minutes }) {
    const S = summaryOf(stagesOf(roadmap));
    if (!S.releases.length) return '';
    const plan = (p) => `≈ ${money(p.usd)} · ≈ ${minutes(p.minutes)}`;
    const tip = (p) => t('backlog_roadmap.summary_without_estimate_tip', { items: p.withoutEstimate.map((x) => x.title).join(', ') });
    const none = (p) => (p.withoutEstimate.length ? ` <span class="warn-text" title="${esc(tip(p))}">${esc(t('backlog_roadmap.summary_without_estimate', { count: p.withoutEstimate.length }))}</span>` : '');
    const rows = S.releases.map((x) => `<div class="rm-summary-row" data-testid="roadmap-summary-release-row"><b>${esc(x.after ? t('backlog_roadmap.summary_after_last_cut') : x.version)}</b><span class="muted">${plan(x)}${none(x)}</span></div>`);
    const list = open ? `<div class="bl-menu rm-summary-releases" data-testid="roadmap-summary-releases">${rows.join('')}</div>` : '';
    return `<span class="bl-menu-wrap rm-by-release"><button class="btn sm ghost" type="button" data-rm-summary-releases data-testid="roadmap-summary-by-release" aria-expanded="${open}" title="${esc(t('backlog_roadmap.summary_by_release_tip'))}">${esc(t('backlog_roadmap.summary_by_release'))} ${open ? '▴' : '▾'}</button>${list}</span>`;
  }

  const api = {
    byReleaseHtml,
    stats,
    summarize,
  };
  if (node) module.exports = api;
  else root.RoadmapSummary = api;
})(typeof window !== 'undefined' ? window : globalThis);
