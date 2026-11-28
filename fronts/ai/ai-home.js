// The AI front's Home card (phase 3 of docs/reorganisation-study-2026-10.md, decision 5; the kit's
// home-cards.js): the last Night watch's card (#172, drawn by views/nightwatch/nightwatch.js renderMorning, which Home
// calls on each render and which fetches at most once a minute; the Home redesign of 2026-11-28: "Last watch", the last
// run of the watch by day or by night, beside "Last 24 hours") and that watch's cost in "Last 24 hours": tonight's while
// the Night watch is spending, else the real runs started in the last watch's window. The Home redesign also adds two
// "What needs you" rows: the project's production errors still new (Monitor › Errors, monitor:state: Diagnose opens
// the Errors screen) and the day's budget at 80 % or more (the top bar's spending, Usage). A composition without this
// front shows none of it. Uses the globals of app.js (state, fmtUsd, showView, viewRegistry, t) at call time.
(function () {
  const BUDGET_WARN = 0.8; // the top bar's warn level (usage-widget.js)
  window.HomeCards.register({
    id: 'ai',
    order: 30,
    async read({ projectId, api, read }) {
      if (!projectId || typeof api.monitorState !== 'function' || !viewRegistry.has('errors')) return { errors: [] };
      const st = await read(() => api.monitorState({ projectId }));
      return { errors: (Array.isArray(st?.groups) ? st.groups : []).filter((g) => (g.state || 'new') === 'new') };
    },
    morning: (box) => window.NightWatchView?.renderMorning(box) || null,
    needs(own) {
      const errors = (own.errors || []).map((g) => ({
        kind: 'error', order: 55, since: g.lastSeen || g.firstSeen || null,
        title: g.title || g.message || t('dashboard.badge_new_error'),
        detail: [g.where, g.count ? t('dashboard.error_count', { count: g.count }) : ''].filter(Boolean).join(' · '),
        button: { label: t('dashboard.diagnose'), attr: 'data-home-errors', value: String(g.fingerprint || '') },
      }));
      const day = state.usage?.spending?.day;
      const used = day?.limitUsd ? (Number(day.spentUsd) || 0) / day.limitUsd : 0;
      const usage = used >= BUDGET_WARN && viewRegistry.has('usage') ? [{
        kind: 'usage', order: 60, since: null,
        title: t('dashboard.budget_at_percent', { percent: Math.round(used * 100) }),
        detail: t('dashboard.spent_of_budget_today', { spent: fmtUsd(day.spentUsd, day.estimated), budget: fmtUsd(day.limitUsd) }),
        button: { label: t('dashboard.open_usage'), attr: 'data-home-usage', value: 'day' },
      }] : [];
      return [...errors, ...usage];
    },
    today(own, d) {
      const sp = state.usage?.spending;
      const usd = (p) => (p ? `${p.estimated ? '≈ ' : ''}${fmtUsd(p.spentUsd)}` : '—');
      const w = own.morning?.window;
      const inWatch = (r) => !r.mock && Date.parse(r.startedAt) >= Date.parse(w.from) && Date.parse(r.startedAt) <= Date.parse(w.to);
      const watch = sp?.night ? [t('dashboard.cost_tonight'), usd(sp.night), t('dashboard.spent_by_real_runs_since_the_night')]
        : w ? [t('dashboard.cost_of_the_last_watch'), fmtUsd((d.runs || []).filter(inWatch).reduce((a, r) => a + (Number(r.costUsd) || 0), 0), (d.runs || []).some((r) => inWatch(r) && r.costApprox)), t('dashboard.cost_of_the_real_runs_started_during')]
          : [t('dashboard.cost_of_the_last_watch'), '—', t('dashboard.no_night_watch_ended_recently')];
      return [{ order: 20, label: watch[0], value: esc(watch[1]), title: watch[2] }];
    },
    actions: {
      'data-home-errors': () => showView('errors'),
      'data-home-usage': () => showView('usage'),
    },
  });
})();
