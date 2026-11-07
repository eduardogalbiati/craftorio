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
// - requests(list), fixLimit(fixes), tokensText(n), FIX_ROUNDS (#811): the PR's requests on the card (only a
//   trusted one is selectable), Ask for a fix (a button of buttons()), the limit of fix rounds and their tokens.
// - fmtK(n) (#811): a token count, 1.2k past a thousand (the shared copy; older views keep their own for now).
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
  // whether a PR's state is its last (run-pr.js prEnded's rule, for the renderer)
  const ended = (state) => ['merged', 'closed'].includes(state);
  const blockerText = (codes) => (Array.isArray(codes) ? codes.map((c) => t(`pr_card.blocked.${c}`)).join(', ') : '');
  // #811: and Ask for a fix (ask_fix) while the card has requests, no fix round runs and fewer than FIX_ROUNDS
  // were taken (`fixes`: the card's rounds, fixRounds)
  function buttons(o, { fork = false, state = null, requests: asks = [], fixes = [] } = {}) {
    if (!o || ended(state)) return [];
    const what = blockerText(o.ignores);
    return [
      o.merge && !fork ? { id: 'merge', label: t('pr_card.merge'), confirm: null } : null,
      o.bypass && !fork ? { id: 'merge_admin', label: t('pr_card.merge_admin', { what }), confirm: t('pr_card.merge_admin_confirm', { what }) } : null,
      o.close ? { id: 'close', label: t('pr_card.close'), confirm: t('pr_card.close_confirm') } : null,
      canAskFix(asks, fixes) ? { id: 'ask_fix', label: t('pr_card.ask_fix'), confirm: null } : null,
    ].filter(Boolean);
  }

  // #811: the fix rounds a run takes before it asks the owner: the one value, the engine's MAX_FIX_ROUNDS too
  // (engine/run/pr-fix.js requires it from here)
  const FIX_ROUNDS = 5;
  const roundsTaken = (fixes) => (Array.isArray(fixes) ? fixes.reduce((n, f) => Math.max(n, Number(f?.round) || 0), 0) : 0);
  const canAskFix = (asks, fixes) => Array.isArray(asks) && asks.length > 0
    && !(fixes || []).some((f) => f?.status === 'requested') && roundsTaken(fixes) < FIX_ROUNDS;
  // the limit's text once FIX_ROUNDS rounds were taken, '' before
  const fixLimit = (fixes) => (roundsTaken(fixes) >= FIX_ROUNDS ? t('pr_card.fix_limit', { max: FIX_ROUNDS }) : '');

  // #811: one request's line: its author and file:line (a failed CI: its job), never its body
  const where = (r) => (r?.file ? `${r.file}${r.line != null ? `:${r.line}` : ''}` : '');
  const requestText = (r) => (r?.kind === 'ci_failed'
    ? `${t('pr_card.ci')}: ${String(r.body || '?')}`
    : [r?.author ? `@${r.author}` : '', where(r)].filter(Boolean).join(' · '));

  // #811: the engine's requests (run-pr.js fetchPrMonitor) → the card's: only a trusted one can be selected; an
  // untrusted one carries its mark (pr_card.untrusted)
  const requests = (list) => (Array.isArray(list) ? list : []).filter((r) => r && r.id != null).map((r) => ({
    id: String(r.id), kind: r.kind || 'comment', author: r.author || null, file: r.file || null, line: r.line ?? null,
    url: r.url || '', body: String(r.body || ''), trusted: !!r.trusted, selectable: !!r.trusted,
    text: requestText(r), mark: r.trusted ? '' : t('pr_card.untrusted'),
  }));

  // #811: one `pr.fix` event (transitions.js queuePrFix / prFixOutcome) into the card's rounds, in place: one round
  // per `round` (requested → fixed with its commit, or failed with why), its tokens; the run chat's card
  // (run-chat-model.js) and the Run screen's Details (pr-monitor-card.js renderRun) fold them the same way
  function foldFix(fixes, ev) {
    const list = Array.isArray(fixes) ? fixes : [];
    const round = Number(ev?.round) || list.length + 1;
    let f = list.find((x) => x.round === round);
    if (!f) list.push(f = { round, status: null, commit: null, tokens: null, reason: null, agent: 'developer', ids: [], note: '', sent: [] });
    f.status = ev.status || f.status;
    if (ev.commit) f.commit = String(ev.commit);
    if (ev.tokens != null) f.tokens = Number(ev.tokens) || 0;
    if (ev.reason) f.reason = String(ev.reason);
    if (Array.isArray(ev.ids)) f.ids = ev.ids.map(String);
    if (ev.note != null) f.note = String(ev.note || '');
    if (Array.isArray(ev.requests)) f.sent = requests(ev.requests).map((r) => r.text);
    return list;
  }

  const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
  const tokensText = (n) => t('pr_card.fix_tokens', { tokens: fmtK(Number(n) || 0) });

  // what blocks the merge: the same codes as the buttons (merge_options.blockers, the event's; mergeOptions on
  // the Roadmap's item), '' when nothing does or the PR ended
  const blocked = (pr) => {
    const o = pr?.merge_options || pr?.mergeOptions;
    return o && !ended(pr.state) ? blockerText(o.blockers) : '';
  };

  const TESTIDS = { merge: 'pr-merge', merge_admin: 'pr-merge-admin', close: 'pr-close' };
  // the buttons' row, what blocks the merge and the last failed merge's message (one HTML for the run's card and
  // the Roadmap's); a click is handled by pr-monitor-card.js (data-pr-action, data-run, data-confirm). No buttons
  // without the run they act on (a past run's card)
  function actionsHtml({ buttons: list = [], blocked: why = '', mergeError = null, closeError = null } = {}, { runId = '' } = {}) {
    // #811: Ask for a fix sits with the requests it sends (pr-monitor-card.js fixHtml), not in this row
    const row = (runId ? list || [] : []).filter((b) => b.id !== 'ask_fix').map((b) => `<button type="button" class="btn sm ${b.id === 'merge' ? 'primary' : 'ghost'}" data-testid="${TESTIDS[b.id]}" data-pr-action="${esc(b.id)}" data-run="${esc(runId)}"${b.confirm ? ` data-confirm="${esc(b.confirm)}"` : ''} title="${esc(b.confirm || b.label)}">${esc(b.label)}</button>`).join('');
    const blockedLine = why ? `<div class="small muted" data-testid="pr-merge-blocked">${esc(t('pr_card.merge_blocked', { what: why }))}</div>` : '';
    const error = (mergeError ? `<div class="small warn-text" data-testid="pr-merge-error" role="status">${esc(t('pr_card.merge_failed', { error: mergeError }))}</div>` : '')
      + (closeError ? `<div class="small warn-text" data-testid="pr-close-error" role="status">${esc(t('pr_card.close_failed', { error: closeError }))}</div>` : '');
    return blockedLine + error + (row ? `<div class="pr-monitor-actions" role="group" aria-label="${esc(t('pr_card.actions'))}">${row}</div>` : '');
  }

  const api = {
    FIX_ROUNDS,
    KEYS,
    TONE_PILL,
    actionsHtml,
    blocked,
    buttons,
    ended,
    fixLimit,
    fmtK,
    foldFix,
    lineHtml,
    lines,
    requestText,
    requests,
    title,
    tokensText,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
