/* global api, state */
// The top bar's 24/7 chip (#188): one number, the last 24 h occupancy ("24/7 · 87%": time with at
// least one real run active, src/occupancy.js), green from 90 %, amber from 60 %, red below; a dot
// that pulses while a run is active (grey when none is); a one-line tooltip; a click opens Analytics'
// 24/7 tab. No chart or breakdown here. Settings › General can hide it (settings.showOccupancyChip).
// Refreshed on workflow.started / workflow.finished and every minute (channel analytics:occupancy
// with `summary: true`). Browser: window.OccupancyChip; Node: module.exports (chipModel, tested).
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('../shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  const REFRESH_MS = 60e3;

  /** { text, level: green | amber | red, dot: pulse | grey, tooltip } of the last 24 h figures. */
  function chipModel({ occupancy, activeHours, idleNowMinutes, running }) {
    const pct = Math.round((Number(occupancy) || 0) * 100);
    const level = pct >= 90 ? 'green' : pct >= 60 ? 'amber' : 'red';
    const hours = Math.round((Number(activeHours) || 0) * 10) / 10;
    const idle = running ? 'a run is active now' : `idle now ${fmtIdle(idleNowMinutes)}`;
    return { text: `24/7 · ${pct}%`, level, dot: running ? 'pulse' : 'grey', tooltip: t('occupancy_chip.last_24_h_hours_h_active', { hours, idle }) };
  }
  function fmtIdle(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  }

  const api$ = { chipModel };
  if (typeof module === 'object' && module.exports) { module.exports = api$; return; }
  root.OccupancyChip = api$;

  let timer = null;
  let pending = null;
  const el = () => document.getElementById('occupancy-chip');
  const shown = () => state?.settings?.showOccupancyChip !== false;

  async function refresh() {
    const chip = el();
    if (!chip) return;
    if (!shown()) { chip.classList.add('hidden'); return; }
    // #389: read after the first paint; until the first answer the chip shows that it is loading
    if (!chip.dataset.loaded) {
      chip.classList.remove('hidden');
      chip.setAttribute('aria-busy', 'true');
      chip.querySelector('.occ-text').textContent = '24/7 · …';
      chip.title = t('occupancy_chip.reading_the_last_24_h');
    }
    try {
      const o = await api.getOccupancy({ summary: true });
      chip.dataset.loaded = '1';
      chip.removeAttribute('aria-busy');
      if (o.empty) {
        chip.classList.remove('hidden');
        chip.dataset.level = 'none';
        chip.querySelector('.occ-text').textContent = '24/7 · —';
        chip.querySelector('.occ-dot').dataset.dot = 'grey';
        chip.title = t('occupancy_chip.no_runs_yet_start_one_to');
        chip.setAttribute('aria-label', t('occupancy_chip.n24_7_meter_no_runs_yet'));
        return;
      }
      const m = chipModel(o);
      chip.classList.remove('hidden');
      chip.dataset.level = m.level;
      chip.querySelector('.occ-text').textContent = m.text;
      chip.querySelector('.occ-dot').dataset.dot = m.dot;
      chip.title = m.tooltip;
      chip.setAttribute('aria-label', t('occupancy_chip.text_tooltip_open_the_24_7', { text: m.text, tooltip: m.tooltip }));
    } catch { chip.removeAttribute('aria-busy'); chip.classList.add('hidden'); /* no workspace yet: checked again next minute */ }
  }
  const soon = () => { clearTimeout(pending); pending = setTimeout(refresh, 800); };

  function init() {
    const chip = el();
    if (!chip || chip.dataset.wired) return;
    chip.dataset.wired = '1';
    chip.addEventListener('click', () => window.openAnalytics?.({ tab: 'occupancy' }));
    api.onEvent?.((ev) => { if (ev?.type === 'workflow.started' || ev?.type === 'workflow.finished') soon(); });
    // Settings' switch: shown or hidden at once
    document.addEventListener('change', (e) => {
      if (e.target?.dataset?.setting !== 'showOccupancyChip') return;
      if (!e.target.checked) chip.classList.add('hidden');
      setTimeout(refresh, 500);
    });
    // the first read: app.js's init calls refresh once Home is drawn (#389)
    timer = setInterval(refresh, REFRESH_MS);
  }
  root.OccupancyChip.refresh = refresh;
  root.OccupancyChip.stop = () => clearInterval(timer);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
