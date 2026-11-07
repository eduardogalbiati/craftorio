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
// #811: then the PR's requests, the owner's note, Ask for a fix (runs:askFix) and the fix rounds (fixHtml).
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
      <div class="pr-monitor-lines">${lines}</div>${error}${actions}${fixHtml(card, { runId })}</div>`;
  }

  // #811: what the owner picked and wrote for the next fix, per run: the card redraws on every read, the
  // selection and the note survive it (cleared once the fix is asked)
  const drafts = new Map();
  const draftOf = (runId) => drafts.get(runId) || { ids: new Set(), note: '' };

  // #811: the PR's requests (a checkbox on a trusted one, a link to each, the untrusted mark), the note, Ask for a
  // fix (enabled once a request is checked or a note written) and the fix rounds with their tokens. Test ids:
  // pr-fix-requests, pr-request-item, pr-request-untrusted, pr-fix-note, pr-ask-fix, pr-fix-round, pr-fix-tokens,
  // pr-fix-limit, pr-fix-error (fronts/build/features/steps/pr-fix.steps.js)
  function fixHtml(card, { runId = '' } = {}) {
    const asks = root.PrCard.ended(card.state) ? [] : card.requests || [];
    const fixes = card.fixes || [];
    const canAsk = !!runId && (card.buttons || []).some((b) => b.id === 'ask_fix');
    const draft = draftOf(runId);
    const items = asks.map((r) => {
      const checked = r.selectable && draft.ids.has(r.id);
      const box = `<input type="checkbox" class="pr-request-check" data-pr-request="${esc(r.id)}" aria-label="${esc(r.text)}"${checked ? ' checked' : ''}${r.selectable && canAsk ? '' : ' disabled'}>`;
      const linkHtml = r.url ? `<a class="pr-request-link mono" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.url)}">${esc(r.text)}</a>` : `<span class="mono">${esc(r.text)}</span>`;
      const mark = r.mark ? `<span class="pill pill-idle" data-testid="pr-request-untrusted">${esc(r.mark)}</span>` : '';
      const body = r.body && r.kind !== 'ci_failed' ? `<div class="small muted pr-request-body" title="${esc(r.body)}">${esc(r.body)}</div>` : '';
      return `<li class="pr-request-item" data-testid="pr-request-item"><div class="pr-request-head">${box}${linkHtml}${mark}</div>${body}</li>`;
    }).join('');
    const list = asks.length ? `<div class="pr-fix-requests" data-testid="pr-fix-requests" role="group" aria-label="${esc(t('pr_card.requests'))}">
        <div class="small muted">${esc(t('pr_card.requests'))}</div><ul class="pr-request-list">${items}</ul></div>` : '';
    const ready = draft.ids.size > 0 || !!draft.note.trim();
    const ask = canAsk ? `<div class="pr-fix-ask" data-run="${esc(runId)}">
        <textarea class="pr-fix-note" data-testid="pr-fix-note" rows="2" aria-label="${esc(t('pr_card.fix_note'))}" placeholder="${esc(t('pr_card.fix_note'))}">${esc(draft.note)}</textarea>
        <button type="button" class="btn sm primary" data-testid="pr-ask-fix" data-pr-action="ask_fix" data-run="${esc(runId)}"${ready ? '' : ' disabled'}>${esc(t('pr_card.ask_fix'))}</button></div>` : '';
    const rounds = fixes.map((f) => {
      const status = `<span class="pill ${({ fixed: 'pill-success', failed: 'pill-failed' })[f.status] || 'pill-running'}">${esc(t(`pr_card.fix_status.${f.status || 'requested'}`))}</span>`;
      const what = [...(f.sent || []), f.note ? `“${f.note}”` : ''].filter(Boolean).join(' · ');
      const sent = `<div class="small muted pr-fix-sent" title="${esc(what)}">${esc(t('pr_card.fix_sent', { agent: f.agent || 'developer', what: what || '—' }))}</div>`;
      const tokens = f.status !== 'requested' && f.tokens ? `<span class="small muted" data-testid="pr-fix-tokens">${esc(root.PrCard.tokensText(f.tokens))}</span>` : '';
      const commit = f.commit ? `<span class="mono small">${esc(String(f.commit).slice(0, 7))}</span>` : '';
      const why = f.status === 'failed' ? `<div class="small warn-text" data-testid="pr-fix-error" role="status">${esc(t('pr_card.fix_failed', { reason: f.reason || '?' }))}</div>` : '';
      return `<li class="pr-fix-round" data-testid="pr-fix-round"><div class="pr-request-head"><b>${esc(t('pr_card.fix_round', { round: f.round, max: root.PrCard.FIX_ROUNDS }))}</b> ${status} ${commit} ${tokens}</div>${sent}${why}</li>`;
    }).join('');
    const roundsHtml = rounds ? `<ol class="pr-fix-rounds">${rounds}</ol>` : '';
    const limit = card.fixLimit ? `<div class="small muted" data-testid="pr-fix-limit">${esc(card.fixLimit)}</div>` : '';
    return list || roundsHtml || limit ? `<div class="pr-fix">${list}${ask}${roundsHtml}${limit}</div>` : '';
  }

  // #811: Ask for a fix: the checked requests and the note to runs:askFix; nothing reaches an agent before
  async function askFix(b) {
    const runId = b.dataset.run;
    const draft = draftOf(runId);
    b.disabled = true;
    try {
      const r = await api.askRunPrFix(runId, [...draft.ids], draft.note.trim());
      if (r && r.queued === false) showToast(t('pr_card.ask_fix_failed', { error: r.error || '?' }));
      else drafts.delete(runId);
    } catch (err) {
      showToast(t('pr_card.action_failed'), errMsg(err));
    } finally {
      b.disabled = false;
    }
  }

  // #811: keeps the draft and the button's state as the owner checks a request or writes the note
  function onFixInput(e) {
    const box = e.target?.closest?.('.pr-fix');
    const runId = box?.querySelector('.pr-fix-ask')?.dataset.run;
    if (!runId) return;
    const draft = draftOf(runId);
    if (e.target.matches('input[data-pr-request]')) {
      if (e.target.checked) draft.ids.add(e.target.dataset.prRequest);
      else draft.ids.delete(e.target.dataset.prRequest);
    } else if (e.target.matches('textarea.pr-fix-note')) draft.note = e.target.value;
    else return;
    drafts.set(runId, draft);
    const button = box.querySelector('[data-testid="pr-ask-fix"]');
    if (button) button.disabled = !(draft.ids.size > 0 || draft.note.trim());
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
    const fixEvents = v?.prFixes || [];
    const key = ev ? `${ev.seq || ''}:${ev.ts || ''}:${ev.checked_at || ''}:${ev.error || ''}:${merge?.ts || ''}:${v?.run?.status || ''}:${fixEvents.length}` : '';
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    const merged = !!merge?.merged;
    const state = merged ? 'merged' : ev?.state;
    const ended = root.PrCard.ended(state);
    // #811: the PR's requests from the last read and the fix rounds (app.js keeps the `pr.fix` events as v.prFixes)
    const requests = root.PrCard.requests(ev?.requests);
    const fixes = fixEvents.reduce((list, f) => root.PrCard.foldFix(list, f), []);
    box.innerHTML = ev ? html({
      url: ev.url, number: ev.number, state, lines: root.PrCard.lines(ev, { fork: !!ev.fork }), checkedAt: ev.checked_at, error: ev.error,
      requests, fixes, fixLimit: root.PrCard.fixLimit(fixes),
      buttons: root.PrCard.buttons(ev.merge_options, { fork: !!ev.fork, state, requests, fixes }), blocked: merged ? '' : root.PrCard.blocked(ev),
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
    if (action === 'ask_fix') return askFix(b);
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
    document.addEventListener('input', onFixInput);
    document.addEventListener('change', onFixInput);
  }

  root.PrMonitorCard = { html, renderRun };
})(window);
