// Backlog › Roadmap: the PR monitor's card of an item whose run waits for its PR's merge (#809), used by
// backlog-roadmap.js (statusHtml, next to the PR's link). The item's `pr` is the service's (roadmap.js
// mergeGateOf: the monitor's last read, run-pr.js fetchPrMonitor's shape plus checkedAt / error); its five
// lines come from packages/shared/pr-card.js (CI, Review, Conflicts, Comments, Result), each a label and a
// badge, and the time of the last read on hover. Nothing when the PR was never read by the monitor.
// Test ids: roadmap-item-pr-card, pr-card-line (data-line ci | review | conflicts | comments | result); #810:
// pr-merge, pr-merge-admin, pr-close, pr-merge-blocked, pr-merge-error (the item's `pr.mergeOptions`, `pr.mergeError`).
// Uses app.js globals (esc, t), PrCard and TimeZone.
(() => {
  const timeOf = (iso) => (iso && window.TimeZone ? TimeZone.formatTime(iso, TimeZone.current()) : iso || '');

  function html(x) {
    const pr = x?.pr;
    const lines = pr && window.PrCard ? PrCard.lines(pr, { fork: x.effectiveMode === 'fork' || x.inputs?.mode === 'fork' || !!pr.fork }) : [];
    if (!lines.length) return '';
    const at = pr.checkedAt ? t('pr_card.checked_at', { time: timeOf(pr.checkedAt) }) : '';
    const error = pr.error ? `<div class="small warn-text" role="status">${esc(t('pr_card.read_failed', { error: pr.error, time: timeOf(pr.checkedAt) || '—' }))}</div>` : '';
    const rows = lines.map((l) => PrCard.lineHtml(l, 'pr-card-line')).join('');
    // #810: Merge / Merge ignoring protection / Close (pr-monitor-card.js handles the click), what blocks the
    // merge and the last failed merge's message
    const fork = x.effectiveMode === 'fork' || x.inputs?.mode === 'fork' || !!pr.fork;
    const actions = PrCard.actionsHtml({ buttons: PrCard.buttons(pr.mergeOptions, { fork, state: pr.state }), blocked: PrCard.blocked(pr), mergeError: pr.mergeError || null }, { runId: x.runId || '' });
    return `<div class="pr-monitor rm-pr-card small" data-testid="roadmap-item-pr-card" title="${esc(at)}">${rows}${error}${actions}</div>`;
  }

  window.RoadmapPrCard = { html };
})();
