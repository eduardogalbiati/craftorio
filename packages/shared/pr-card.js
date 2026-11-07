// The PR monitor's card (#809): the five lines a run waiting for its PR/MR's merge shows (the run chat,
// the Run screen and the Roadmap item), from the engine's `pr.monitor` event (run/transitions.js
// pollPrMonitor; its fields are run-pr.js fetchPrMonitor's). One text per line, from the i18n catalog:
// - lines(pr, { fork }) → [{ key, label, text, tone (ok | bad | wait | idle: its badge) }], keys in order ci, review, conflicts, comments, result;
//   Result reads "Ready to merge" or what blocks the merge (the engine's words), and in Fork + PR it
//   says the PR waits for the maintainers. [] when the PR was never read.
// Browser: window.PrCard; Node: module.exports.
(function (root) {
  const tr = () => (typeof module === 'object' && module.exports ? require('./i18n').t : root.I18n?.t || root.t);
  const t = (...a) => tr()?.(...a) ?? a[0];
  const KEYS = ['ci', 'review', 'conflicts', 'comments', 'result'];
  const names = (list) => (Array.isArray(list) ? list.filter(Boolean).join(', ') : '');

  const TEXTS = {
    ci: (c) => (c.status === 'failed' ? t('pr_card.ci.failed', { jobs: names(c.failed) || '?' })
      : ['passed', 'running', 'none'].includes(c.status) ? t(`pr_card.ci.${c.status}`) : String(c.status || '')),
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
    ci: (c) => ({ passed: 'ok', failed: 'bad', running: 'wait' })[c?.status] || 'idle',
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

  const api = { KEYS, lines };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
