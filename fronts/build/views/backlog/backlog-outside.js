// Outside issues on the Backlog and the Roadmap (#90): an issue written by someone who is not the owner, a member
// or a collaborator (packages/engine/domains/backlog/issue-author.js) carries a badge, the Product Owner's verdict
// (well written or not, injection suspected or not, the lines quoted), "Quarantined" when an injection is suspected,
// and the owner's Approve button while it waits (channel backlog:approve-outside: only this click, never an agent).
// backlog.js draws row(i) in an issue's labels line; backlog-roadmap.js draws badge(i) on a roadmap card.
// Browser: window.BacklogOutside (with a delegated click on [data-approve-outside]); Node: module.exports.
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('@craftorio/shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const isOutside = (i) => i?.outside === true;

  /** The "Outside" badge, the author and association on hover. */
  const badge = (i) => (isOutside(i)
    ? `<span class="badge bl-outside" data-testid="outside-issue-badge" title="${esc(t('backlog.outside_issue_title', { author: i.author || 'unknown', association: i.authorAssociation || 'NONE' }))}">${esc(t('backlog.outside_issue_badge'))}</span>` : '');

  /** "Quarantined" while an injection is suspected and the owner has not approved it. */
  const quarantined = (i) => (isOutside(i) && i.quarantined
    ? `<span class="badge bl-quarantined" data-testid="issue-quarantined" title="${esc(t('backlog.issue_quarantined_title'))}">${esc(t('backlog.issue_quarantined'))}</span>` : '');

  /** The Product Owner's verdict: two chips, its reasons on hover, the lines that decided it quoted. */
  function verdict(i) {
    const v = isOutside(i) ? i.verdict : null;
    if (!v) return '';
    const written = t(v.well_written ? 'backlog.po_verdict_well_written' : 'backlog.po_verdict_not_well_written');
    const injection = t(v.injection_suspected ? 'backlog.po_verdict_injection' : 'backlog.po_verdict_no_injection');
    const lines = (v.lines || []).map((l) => `<q class="bl-verdict-line">${esc(l)}</q>`).join('');
    return `<span class="bl-verdict" data-testid="po-verdict" title="${esc([t('backlog.po_verdict'), ...(v.reasons || [])].join('\n'))}">`
      + `<span class="badge${v.well_written ? '' : ' warn'}">${esc(written)}</span>`
      + `<span class="badge${v.injection_suspected ? ' bad' : ''}">${esc(injection)}</span>`
      + `${lines ? `<span class="bl-verdict-lines" aria-label="${esc(t('backlog.po_verdict_lines'))}">${lines}</span>` : ''}</span>`;
  }

  /** The owner's Approve, while the outside issue waits for it. */
  const approveButton = (i) => (isOutside(i) && !i.ownerApproved
    ? `<button type="button" class="btn sm bl-approve-outside" data-approve-outside="${Number(i.number)}" data-testid="approve-outside-issue" title="${esc(t('backlog.approve_outside_issue_title', { number: i.number }))}">${esc(t('backlog.approve_outside_issue'))}</button>` : '');

  /** Everything a Backlog row or card shows for an outside issue, in its labels line. */
  const row = (i) => `${badge(i)}${quarantined(i)}${verdict(i)}${approveButton(i)}`;

  /** Why a run cannot start on the issue yet (the ⋯ menu's Enrich in Documents), '' when it can. */
  const runBlockReason = (i) => (isOutside(i) && !i.ownerApproved ? t('backlog.outside_issue_run_blocked', { number: i.number }) : '');

  async function approve(btn) {
    const actions = root.BacklogActions;
    const number = Number(btn.dataset.approveOutside);
    btn.disabled = true;
    try {
      const out = await root.api.approveOutsideIssue(actions.projectId(), number);
      actions.showData(out?.backlog);
    } catch (err) {
      btn.disabled = false;
      root.showToast?.(t('backlog.outside_issue_not_approved', { number }), err?.message || String(err));
    }
  }

  const api = { approveButton, badge, quarantined, row, runBlockReason, verdict };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.BacklogOutside = api;
    root.document?.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[data-approve-outside]');
      if (!btn) return;
      e.preventDefault();
      approve(btn);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
