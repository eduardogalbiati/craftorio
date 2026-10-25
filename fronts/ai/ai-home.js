// The AI front's Home card (phase 3 of docs/reorganisation-study-2026-10.md, decision 5; the kit's
// home-cards.js): the banner above Home's body with the last Night watch's morning summary (#172,
// drawn by views/nightwatch/nightwatch.js renderMorning, which Home calls on each render and which
// fetches at most once a minute) and "Today"'s cost of the night: tonight's while the Night watch is
// spending, else the real runs started in the last night's window (the banner's). A composition
// without this front shows neither. Uses the globals of app.js (state, fmtUsd, t) at call time.
(function () {
  window.HomeCards.register({
    id: 'ai',
    order: 30,
    morning: (box) => window.NightWatchView?.renderMorning(box) || null,
    today(own, d) {
      const sp = state.usage?.spending;
      const usd = (p) => (p ? `${p.estimated ? '≈ ' : ''}${fmtUsd(p.spentUsd)}` : '—');
      const w = own.morning?.window;
      const inNight = (r) => !r.mock && Date.parse(r.startedAt) >= Date.parse(w.from) && Date.parse(r.startedAt) <= Date.parse(w.to);
      const night = sp?.night ? [t('dashboard.cost_tonight'), usd(sp.night), t('dashboard.spent_by_real_runs_since_the_night')]
        : w ? [t('dashboard.cost_last_night'), fmtUsd((d.runs || []).filter(inNight).reduce((a, r) => a + (Number(r.costUsd) || 0), 0)), t('dashboard.cost_of_the_real_runs_started_during')]
          : [t('dashboard.cost_last_night'), '—', t('dashboard.no_night_watch_ended_recently')];
      return [{ order: 20, label: night[0], value: esc(night[1]), title: night[2] }];
    },
  });
})();
