// The PR monitor's card (#809): the five lines a run waiting for its PR/MR's merge shows (the run chat,
// the Run screen and the Roadmap item), from the engine's `pr.monitor` event (run/transitions.js
// pollPrMonitor; its fields are run-pr.js fetchPrMonitor's). One text per line, from the i18n catalog:
// - lines(pr, { fork }) → [{ key, label, text, tone (ok | bad | wait | idle: its badge) }], keys in order ci, review, conflicts, comments, result;
//   Result reads "Ready to merge" or what blocks the merge (the engine's words), and in Fork + PR it
//   says the PR waits for the maintainers. [] when the PR was never read.
// - lineHtml(line, testid) → one line's HTML, a label and its badge (TONE_PILL: the tone's pill class), the
//   same on the run's card (fronts/build/views/runchat/pr-monitor-card.js) and the Roadmap's (backlog-roadmap-pr-card.js).
// - title(state) → the card's title: waiting for the merge, merged or closed without merging.
// - buttons(mergeOptions, { fork, state }), blocked(pr), actionsHtml(...) (#810): Merge, Merge ignoring
//   protection and Close, what blocks the merge, a failed merge's message.
// Browser: window.PrCard; Node: module.exports.
(function (root) {
  const tr = () => (typeof module === 'object' && module.exports ? require('./i18n').t : root.I18n?.t || root.t);
  const t = (...a) => tr()?.(...a) ?? a[0];
  const KEYS = ['ci', 'review', 'conflicts', 'comments', 'result'];
  const names = (list) => (Array.isArray(list) ? list.filter(Boolean).join(', ') : '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const TEXTS = {
    ci: (c) => (c.status === 'failed' ? t('pr_card.ci.failed', { jobs: names(c.failed) || '?' })
      : ['passed', 'running', 'manual', 'none'].includes(c.status) ? t(`pr_card.ci.${c.status}`) : String(c.status || '')),
    review: (r) => (r.status === 'changes_requested' ? t('pr_card.review.changes_requested', { who: names(r.by) || '?' })
      : ['approved', 'required', 'none'].includes(r.status) ? t(`pr_card.review.${r.status}`) : String(r.status || '')),
    conflicts: (c) => t(c.status === 'base' ? 'pr_card.conflicts.base' : 'pr_card.conflicts.none'),
    comments: (c) => t('pr_card.comments.unanswered', { count: Number(c.unanswered) || 0 }),
  };

  function resultText(r, fork) {
    const blockers = names(r?.blockers);
    const what = r?.ready ? t('pr_card.ready_to_merge') : blockers;
    if (!fork) return what;
    return what ? `${t('pr_card.waits_for_maintainers')} · ${what}` : t('pr_card.waits_for_maintainers');
  }

  // the line's badge: ok (green), bad (red), wait (in progress), idle (nothing to say)
  const TONES = {
    ci: (c) => ({ passed: 'ok', failed: 'bad', running: 'wait', manual: 'wait' })[c?.status] || 'idle',
    review: (r) => ({ approved: 'ok', changes_requested: 'bad', required: 'wait' })[r?.status] || 'idle',
    conflicts: (c) => (c?.status === 'base' ? 'bad' : 'ok'),
    comments: (c) => (Number(c?.unanswered) ? 'wait' : 'ok'),
    result: (r) => (r?.ready ? 'ok' : 'wait'),
  };

  function lines(pr, { fork = false } = {}) {
    if (!pr?.ci && !pr?.result) return [];
    return KEYS.map((key) => ({
      key,
      label: t(`pr_card.${key}`),
      text: key === 'result' ? resultText(pr.result, fork) : pr[key] ? TEXTS[key](pr[key]) : '',
      tone: TONES[key](pr[key]),
    }));
  }

  const TONE_PILL = { ok: 'pill-success', bad: 'pill-failed', wait: 'pill-running', idle: 'pill-idle' };

  function lineHtml(l, testid) {
    return `<div class="pr-monitor-line" data-testid="${esc(testid)}" data-line="${esc(l.key)}"><span class="pr-monitor-label">${esc(l.label)}</span><span class="pill ${TONE_PILL[l.tone] || 'pill-idle'} pr-monitor-value" title="${esc(l.text)}">${esc(l.text)}</span></div>`;
  }

  const title = (state) => t(state === 'merged' ? 'pr_card.title_merged' : state === 'closed' ? 'pr_card.title_closed' : 'pr_card.title');

  // #810: the card's merge choices (the engine's merge_options, run-pr.js mergeOptions) → its buttons, in order
  // Merge (a merge commit, no question), Merge ignoring protection (names what it ignores, asks first), Close
  // (asks first): [{ id: merge | merge_admin | close, label, confirm }]. None once the PR ended, and in Fork + PR
  // never a merge (the upstream's maintainers merge).
  const ENDED = ['merged', 'closed'];
  const blockerText = (codes) => (Array.isArray(codes) ? codes.map((c) => t(`pr_card.blocked.${c}`)).join(', ') : '');
  function buttons(o, { fork = false, state = null } = {}) {
    if (!o || ENDED.includes(state)) return [];
    const what = blockerText(o.ignores);
    return [
      o.merge && !fork ? { id: 'merge', label: t('pr_card.merge'), confirm: null } : null,
      o.bypass && !fork ? { id: 'merge_admin', label: t('pr_card.merge_admin', { what }), confirm: t('pr_card.merge_admin_confirm', { what }) } : null,
      o.close ? { id: 'close', label: t('pr_card.close'), confirm: t('pr_card.close_confirm') } : null,
    ].filter(Boolean);
  }

  // what blocks the merge, in the engine's words (the Result's blockers), '' when nothing does or the PR ended
  const blocked = (pr) => (pr?.result && !pr.result.ready && !ENDED.includes(pr.state) ? names(pr.result.blockers) : '');

  const TESTIDS = { merge: 'pr-merge', merge_admin: 'pr-merge-admin', close: 'pr-close' };
  // the buttons' row, what blocks the merge and the last failed merge's message (one HTML for the run's card and
  // the Roadmap's); a click is handled by pr-monitor-card.js (data-pr-action, data-run, data-confirm). No buttons
  // without the run they act on (a past run's card)
  function actionsHtml({ buttons: list = [], blocked: why = '', mergeError = null } = {}, { runId = '' } = {}) {
    const row = (runId ? list || [] : []).map((b) => `<button type="button" class="btn sm ${b.id === 'merge' ? 'primary' : 'ghost'}" data-testid="${TESTIDS[b.id]}" data-pr-action="${esc(b.id)}" data-run="${esc(runId)}"${b.confirm ? ` data-confirm="${esc(b.confirm)}"` : ''} title="${esc(b.confirm || b.label)}">${esc(b.label)}</button>`).join('');
    const blockedLine = why ? `<div class="small muted" data-testid="pr-merge-blocked">${esc(t('pr_card.merge_blocked', { what: why }))}</div>` : '';
    const error = mergeError ? `<div class="small warn-text" data-testid="pr-merge-error" role="status">${esc(t('pr_card.merge_failed', { error: mergeError }))}</div>` : '';
    return blockedLine + error + (row ? `<div class="pr-monitor-actions" role="group">${row}</div>` : '');
  }

  const api = {
    KEYS,
    TONE_PILL,
    actionsHtml,
    blocked,
    buttons,
    lineHtml,
    lines,
    title,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
