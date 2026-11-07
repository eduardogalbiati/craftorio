/* global esc, t, TimeZone, api, confirmDialog, showToast, errMsg */
// The PR monitor's card on a run (#809): the run chat's `pr_card` item (run-chat-model.js) and the Run
// screen's Details (run.js renderRunPrMonitor) draw it the same way. Its PR's link leads ("#42"), then
// the five lines (packages/shared/pr-card.js: CI, Review, Conflicts, Comments, Result), each a label and
// a badge, the time of the last read and, only after a read that failed, why (the last lines stay).
// #810: then what blocks the merge, the last failed merge's message and the buttons Merge (a merge commit),
// Merge ignoring protection (only with that permission, asks first) and Close (asks first); one click handler
// here for the run's cards and the Roadmap's (backlog-roadmap-pr-card.js), on runs:mergePr / runs:closePr.
// No Approve: the run ends by itself on the merge. Test ids: pr-monitor-card, pr-monitor-link,
// pr-monitor-<line>, pr-monitor-read-at, pr-monitor-read-error (fronts/build/features/steps/pr-monitor.steps.js),
// pr-merge, pr-merge-admin, pr-close, pr-merge-blocked, pr-merge-error (pr-merge.steps.js).
// Browser: window.PrMonitorCard.
(function (root) {
  const timeOf = (iso) => (iso ? TimeZone.formatTime(iso, TimeZone.current()) : '');

  // card: { url, number, state, lines: [{ key, label, text, tone }], checkedAt, error, buttons, blocked,
  // mergeError } → HTML; its title follows the state (waiting, merged, closed without merging: PrCard.title)
  function html(card, { item = '', runId = '' } = {}) {
    const n = card.number ? `#${card.number}` : t('pr_card.open_pr');
    const link = card.url ? `<a class="pr-monitor-link mono" data-testid="pr-monitor-link" href="${esc(card.url)}" target="_blank" rel="noopener" title="${esc(card.url)}">${esc(n)}</a>` : '';
    const lines = (card.lines || []).map((l) => root.PrCard.lineHtml(l, `pr-monitor-${l.key}`)).join('');
    const at = card.checkedAt ? t('pr_card.checked_at', { time: timeOf(card.checkedAt) }) : t('pr_card.not_read');
    const error = card.error ? `<p class="pr-monitor-error small" data-testid="pr-monitor-read-error" role="status">${esc(t('pr_card.read_failed', { error: card.error, time: timeOf(card.checkedAt) || '—' }))}</p>` : '';
    const actions = root.PrCard.actionsHtml(card, { runId });
    return `<div class="pr-monitor" data-testid="pr-monitor-card"${item ? ` data-item="${esc(item)}"` : ''}>
      <div class="pr-monitor-head"><b>${esc(root.PrCard.title(card.state))}</b>${link}<span class="muted small" data-testid="pr-monitor-read-at">${esc(at)}</span></div>
      <div class="pr-monitor-lines">${lines}</div>${error}${actions}</div>`;
  }

  // The Run screen's card (#run-pr-monitor, run.js renderRunScreen): the view's last `pr.monitor` event
  // (app.js RUN_EVENT_REDUCERS keeps it as v.prMonitor, #810: and the last merge tried as v.prMerge); redrawn
  // only when another read or merge arrives
  function renderRun(v) {
    const box = document.getElementById('run-pr-monitor');
    if (!box) return;
    const ev = v?.prMonitor || null;
    const merge = v?.prMerge || null;
    box.classList.toggle('hidden', !ev);
    const key = ev ? `${ev.seq || ''}:${ev.ts || ''}:${ev.checked_at || ''}:${ev.error || ''}:${merge?.ts || ''}:${v?.run?.status || ''}` : '';
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    const merged = !!merge?.merged;
    const state = merged ? 'merged' : ev?.state;
    const ended = root.PrCard.ended(state);
    box.innerHTML = ev ? html({
      url: ev.url, number: ev.number, state, lines: root.PrCard.lines(ev, { fork: !!ev.fork }), checkedAt: ev.checked_at, error: ev.error,
      buttons: root.PrCard.buttons(ev.merge_options, { fork: !!ev.fork, state }), blocked: merged ? '' : root.PrCard.blocked(ev),
      mergeError: ended ? null : ev.merge_error || (merge ? merge.error || t('pr_card.merge_refused') : null),
      closeError: ended ? null : ev.close_error || null,
      // the buttons act on a live run only (a run stopped or ended in the monitor has nothing to wake)
    }, { runId: v?.run?.status === 'running' ? v.run.id : '' }) : '';
  }

  // #810: a click on Merge / Merge ignoring protection / Close (data-pr-action, data-run): asks first when the
  // button has data-confirm; the buttons stay disabled until the service answers (the card redraws on the event)
  async function act(b) {
    const runId = b.dataset.run;
    const action = b.dataset.prAction;
    if (!runId || b.disabled) return;
    if (b.dataset.confirm) {
      const yes = action === 'close' ? t('pr_card.close_confirm_yes') : t('pr_card.merge_admin_confirm_yes');
      if (!await confirmDialog(b.textContent, b.dataset.confirm, yes)) return;
    }
    const group = b.closest('.pr-monitor-actions')?.querySelectorAll('button') || [b];
    group.forEach((x) => { x.disabled = true; });
    try {
      const r = action === 'close' ? await api.closeRunPr(runId) : await api.mergeRunPr(runId, action === 'merge_admin');
      if (r && r.merged === false && r.error) showToast(t('pr_card.merge_failed', { error: r.error }));
      if (r && r.closed === false && r.error) showToast(t('pr_card.close_failed', { error: r.error }));
    } catch (err) {
      showToast(t('pr_card.action_failed'), errMsg(err));
    } finally {
      group.forEach((x) => { x.disabled = false; });
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      const b = e.target?.closest?.('button[data-pr-action]');
      if (!b) return;
      e.preventDefault();
      act(b);
    });
  }

  root.PrMonitorCard = { html, renderRun };
})(window);
