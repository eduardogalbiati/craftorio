/* global esc, t, TimeZone */
// The PR monitor's card on a run (#809): the run chat's `pr_card` item (run-chat-model.js) and the Run
// screen's Details (run.js renderRunPrMonitor) draw it the same way. Its PR's link leads ("#42"), then
// the five lines (packages/shared/pr-card.js: CI, Review, Conflicts, Comments, Result), each a label and
// a badge, the time of the last read and, only after a read that failed, why (the last lines stay).
// No Approve: the run ends by itself on the merge. Test ids: pr-monitor-card, pr-monitor-link,
// pr-monitor-<line>, pr-monitor-read-at, pr-monitor-read-error (fronts/build/features/steps/pr-monitor.steps.js).
// Browser: window.PrMonitorCard.
(function (root) {
  const timeOf = (iso) => (iso ? TimeZone.formatTime(iso, TimeZone.current()) : '');

  // card: { url, number, state, lines: [{ key, label, text, tone }], checkedAt, error } → HTML; its title
  // follows the state (waiting, merged, closed without merging: PrCard.title)
  function html(card, { item = '' } = {}) {
    const n = card.number ? `#${card.number}` : t('pr_card.open_pr');
    const link = card.url ? `<a class="pr-monitor-link mono" data-testid="pr-monitor-link" href="${esc(card.url)}" target="_blank" rel="noopener" title="${esc(card.url)}">${esc(n)}</a>` : '';
    const lines = (card.lines || []).map((l) => root.PrCard.lineHtml(l, `pr-monitor-${l.key}`)).join('');
    const at = card.checkedAt ? t('pr_card.checked_at', { time: timeOf(card.checkedAt) }) : t('pr_card.not_read');
    const error = card.error ? `<p class="pr-monitor-error small" data-testid="pr-monitor-read-error" role="status">${esc(t('pr_card.read_failed', { error: card.error, time: timeOf(card.checkedAt) || '—' }))}</p>` : '';
    return `<div class="pr-monitor" data-testid="pr-monitor-card"${item ? ` data-item="${esc(item)}"` : ''}>
      <div class="pr-monitor-head"><b>${esc(root.PrCard.title(card.state))}</b>${link}<span class="muted small" data-testid="pr-monitor-read-at">${esc(at)}</span></div>
      <div class="pr-monitor-lines">${lines}</div>${error}</div>`;
  }

  // The Run screen's card (#run-pr-monitor, run.js renderRunScreen): the view's last `pr.monitor` event
  // (app.js RUN_EVENT_REDUCERS keeps it as v.prMonitor); redrawn only when another read arrives
  function renderRun(v) {
    const box = document.getElementById('run-pr-monitor');
    if (!box) return;
    const ev = v?.prMonitor || null;
    box.classList.toggle('hidden', !ev);
    const key = ev ? `${ev.seq || ''}:${ev.ts || ''}:${ev.checked_at || ''}:${ev.error || ''}` : '';
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = ev ? html({ url: ev.url, number: ev.number, state: ev.state, lines: root.PrCard.lines(ev, { fork: !!ev.fork }), checkedAt: ev.checked_at, error: ev.error }) : '';
  }

  root.PrMonitorCard = { html, renderRun };
})(window);
