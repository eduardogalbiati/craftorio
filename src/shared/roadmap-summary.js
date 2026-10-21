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
// barHtml(roadmap, { open, money, minutes }): the Roadmap bar's summary drawn from it (catalog text, #330).
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
  /**
   * The Roadmap bar's summary markup (backlog-roadmap.js; '' for an empty roadmap): the planned part and
   * its tooltip, "+ n without estimate" naming them, "Spent $Y" (tooltip: since), and with a cut line the
   * "By release" toggle (`open`: its list drawn). `money`, `minutes`: the view's formats.
   */
  function barHtml(roadmap, { open = false, money, minutes }) {
    const stages = Array.isArray(roadmap?.stages) ? roadmap.stages : [];
    if (!stages.length) return '';
    const S = summarize({ stages, releases: stages.flatMap((s, at) => (s.release ? [{ version: s.release.name, at, estimate: s.release.estimate }] : [])) });
    const t = (...a) => (node ? require('./i18n') : root.I18n)?.t(...a) ?? a[0];
    const plan = (p) => `≈ ${money(p.usd)} · ≈ ${minutes(p.minutes)}`;
    const titles = (p) => p.withoutEstimate.map((x) => x.title).join(', ');
    const none = (p) => (p.withoutEstimate.length ? ` <span class="warn-text" title="${esc(t('backlog_roadmap.summary_without_estimate_tip', { items: titles(p) }))}">${esc(t('backlog_roadmap.summary_without_estimate', { count: p.withoutEstimate.length }))}</span>` : '');
    const rows = S.releases.map((x) => `<div class="rm-summary-row" data-testid="roadmap-summary-release-row"><b>${esc(x.after ? t('backlog_roadmap.summary_after_last_cut') : x.version)}</b><span class="muted">${plan(x)}${none(x)}</span></div>`);
    const list = open ? `<div class="bl-menu rm-summary-releases" data-testid="roadmap-summary-releases">${rows.join('')}</div>` : '';
    const toggle = S.releases.length ? `<span class="bl-menu-wrap"><button class="btn sm ghost" type="button" data-rm-summary-releases data-testid="roadmap-summary-by-release" aria-expanded="${open}" title="${esc(t('backlog_roadmap.summary_by_release_tip'))}">${open ? '▴' : '▾'} ${esc(t('backlog_roadmap.summary_by_release'))}</button>${list}</span>` : '';
    const counts = `(${esc(t('backlog_roadmap.items_count', { count: S.planned.items }))}, ${esc(t('backlog_roadmap.stages_count', { count: S.planned.stages }))})`;
    const since = S.spent.since ? ` title="${esc(t('backlog_roadmap.summary_spent_tip', { date: String(S.spent.since).slice(0, 10) }))}"` : '';
    return `<span class="small rm-summary" data-testid="roadmap-summary" title="${esc(t('backlog_roadmap.summary_tip'))}"><span>${esc(t('backlog_roadmap.summary_planned', { usd: money(S.planned.usd), time: minutes(S.planned.minutes) }))} ${counts}${none(S.planned)}</span><span class="muted"${since}>${esc(t('backlog_roadmap.summary_spent', { usd: money(S.spent.usd) }))}</span>${toggle}</span>`;
  }

  const api = { barHtml, summarize };
  if (node) module.exports = api;
  else root.RoadmapSummary = api;
})(typeof window !== 'undefined' ? window : globalThis);
