// A project's Refactor tab (#357): its refactor proposals (the Architecture findings sent to Refactor,
// or written here by the owner, refactor:add) as a list prioritized by the Product Owner. What leads:
// one row per proposal, sorted by rank (rank, title and target, the one-line reason, complexity 1-5,
// its issue with open/closed and its roadmap item's status, and the Danger Zone outcome of its run:
// left the Danger Zone, score dropped, or not improved, marked). The header counts the files that
// left the Danger Zone through refactor runs in the last 30 and 90 days, and when the ranking was made.
// Actions: "Ask the Product Owner to prioritize" (refactor:prioritize, one turn, the simulated answer
// in simulation), per row "File as issue" (refactor:file, a preview in simulation), "Add to roadmap
// now" (refactor:addToRoadmap, once it has an issue: the disabled waiting stage at the end, #435) and
// "Run now" (the same with runNow: after the stage in progress, enabled), the row naming its issue and
// stage ("#432 · stage 117, waiting for your OK", refactor-proposal-where), and "Dismiss" with a reason (refactor:dismiss,
// kept under the "Dismissed" filter); the cadence switch "Add a refactor to the roadmap every X runs"
// (refactor:cadence / refactor:setCadence, X from 3 to 50) with its "next in N runs" counter and
// "Nothing ready to add" when no proposal has an issue and no unfinished item.
// States: no Architecture report yet (a button opens the Architecture tab), no proposals, prioritizing,
// the list, the cadence on/off, and an error with its message (refactor-state-error).
// Read again on each show (the Architecture tab sends proposals), except while a reason or a new
// proposal is being typed. Drawn into the box project.js gives it (show), its clicks and changes
// routed from the project page's listeners (onClick, onChange). Uses app.js globals at call time:
// api, esc, errMsg, fmtUsd (usage-widget.js), openProjectView (project.js), showToast.
// Browser: window.ProjectRefactor.
(() => {
  const STATUS_TONE = { planned: '', running: ' live', failed: ' warn', done: ' rf-good', skipped: '' };
  // the project on screen: { id, box, list, cadence, reports, loaded, loadError, error, filter ('open' | 'dismissed'),
  // dismissing (a proposal id), adding, prioritizing, busy (a proposal id), seq }
  let cur = null;

  const usd = (v) => (typeof fmtUsd === 'function' ? fmtUsd(v) : `$${Number(v || 0).toFixed(2)}`);
  const day = (iso) => String(iso || '').slice(0, 10);
  const byRank = (a, b) => (a.rank || Infinity) - (b.rank || Infinity) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

  async function load() {
    const c = cur;
    if (!c) return;
    const seq = ++c.seq;
    const [list, cadence, reports] = await Promise.allSettled([
      api.refactorProposals(c.id),
      api.refactorCadence(c.id),
      api.listArchitectureReports(c.id),
    ]);
    if (cur !== c || seq !== c.seq) return;
    const value = (r) => (r.status === 'fulfilled' ? r.value : null);
    c.loaded = true;
    c.loadError = list.status === 'rejected' ? t('project_refactor.could_not_read_the_proposals', { error: errMsg(list.reason) }) : null;
    c.list = value(list) || [];
    c.cadence = value(cadence) || c.cadence;
    c.reports = value(reports) || [];
    // a reason or a proposal being typed keeps its box: the new data shows on the next action
    if (!c.dismissing && !c.adding) render();
  }

  // ---- markup -------------------------------------------------------------------------------------
  function headMarkup(c, open) {
    const cd = c.cadence;
    const ranked = cd?.rankedAt ? `<span class="muted small" data-testid="refactor-ranked-at">${t('project_refactor.ranked_on')} ${esc(day(cd.rankedAt))}${cd.rankCostUsd ? ` · ${esc(usd(cd.rankCostUsd))}` : ''}</span>` : '';
    const left = cd ? `<span class="badge rf-good" data-testid="refactor-left-danger" title="${t('project_refactor.files_that_left_the_danger_zone')}">${t('project_refactor.left_the_danger_zone_value_in', { value: cd.left30 || 0, value2: cd.left90 || 0 })}</span>` : '';
    return `<div class="row rf-head">
      <button type="button" class="btn primary sm" data-testid="refactor-prioritize" data-rf-prioritize ${c.prioritizing || !open ? 'disabled' : ''}
        title="${t('project_refactor.one_product_owner_turn_orders_the')}">${t('project_refactor.ask_the_product_owner_to_prioritize')}</button>
      ${ranked}<span class="spacer"></span>${left}
    </div>`;
  }

  function cadenceMarkup(c) {
    const cd = c.cadence || { on: false, every: 10, nextIn: 10, ready: false };
    const next = cd.nextIn > 0 ? t('project_refactor.next_in_runs', { count: cd.nextIn }) : t('project_refactor.due_at_the_next_finished_run');
    return `<div class="row rf-cadence" data-testid="refactor-cadence">
      <label class="check"><input type="checkbox" data-testid="refactor-cadence-toggle" data-rf-cadence-on aria-label="${t('project_refactor.add_a_refactor_to_the_roadmap_2')}" ${cd.on ? 'checked' : ''} /><span>${t('project_refactor.add_a_refactor_to_the_roadmap')}</span></label>
      <input type="number" class="rf-every" min="3" max="50" step="1" value="${Number(cd.every) || 10}" data-testid="refactor-cadence-every" data-rf-cadence-every aria-label="${t('project_refactor.runs_between_two_refactors_3_to')}" />
      <span>${t('project_refactor.runs')}</span>
      ${cd.on ? `<span class="badge" data-testid="refactor-cadence-next">${esc(next)}</span>` : ''}
      ${cd.on && !cd.ready ? `<span class="muted small" data-testid="refactor-nothing-ready">${t('project_refactor.nothing_ready_to_add_prioritize_or')}</span>` : ''}
    </div>`;
  }

  function issueMarkup(p) {
    if (!p.issue) return `<span class="muted small">${t('project_refactor.no_issue')}</span>`;
    const link = `<span class="badge" data-testid="refactor-proposal-issue" title="${esc(p.issueUrl || '')}">#${esc(p.issue)}${p.issueState ? ` ${esc(String(p.issueState).toLowerCase())}` : ''}</span>`;
    const status = p.roadmapStatus ? `<span class="badge${STATUS_TONE[p.roadmapStatus] ?? ''}" data-testid="refactor-proposal-status">${esc(p.roadmapStatus)}</span>` : '';
    return link + status + whereMarkup(p);
  }

  // where the proposal went (#435): its issue and its roadmap stage, "waiting for your OK" in the waiting stage
  function whereMarkup(p) {
    if (!p.issue || !p.roadmapStage || !p.roadmapUnfinished) return '';
    const where = t(p.roadmapWaiting ? 'common.refactor_where_waiting' : 'common.refactor_where', { issue: p.issue, stage: p.roadmapStage });
    return p.issueUrl ? `<a class="small" data-testid="refactor-proposal-where" href="${esc(p.issueUrl)}" target="_blank" rel="noopener">${esc(where)}</a>`
      : `<span class="small muted" data-testid="refactor-proposal-where">${esc(where)}</span>`;
  }

  function outcomeMarkup(p) {
    const o = p.outcome;
    if (o?.leftDangerZone) return `<span class="badge rf-good" data-testid="refactor-proposal-outcome">${t('project_refactor.left_the_danger_zone')}</span>`;
    if (o?.improved) return `<span class="badge rf-good" data-testid="refactor-proposal-outcome">${t('project_refactor.score')}${esc(o.scoreDrop)}</span>`;
    if (o) return `<span class="badge warn" data-testid="refactor-proposal-outcome" title="${t('project_refactor.the_target_s_danger_zone_score')}">${t('project_refactor.not_improved')}</span>`;
    if (p.before) return `<span class="muted small" title="${t('project_refactor.the_target_s_danger_zone_score_2')}">${t('project_refactor.score_score_before', { score: esc(p.before.score) })}</span>`;
    return '';
  }

  function actionsMarkup(c, p) {
    if (p.status === 'dismissed') return '';
    const busy = c.busy === p.id ? 'disabled' : '';
    const placed = !!p.roadmapUnfinished;
    return `<div class="row rf-actions">
      ${p.issue ? '' : `<button type="button" class="btn sm" data-rf-file="${esc(p.id)}" data-testid="refactor-file" ${busy}>${t('project_refactor.file_as_issue')}</button>`}
      ${p.issue && !placed ? `<button type="button" class="btn sm" data-rf-roadmap="${esc(p.id)}" data-testid="refactor-add-roadmap" ${busy}>${t('project_refactor.add_to_roadmap_now')}</button>
      <button type="button" class="btn sm ghost" data-rf-run-now="${esc(p.id)}" data-testid="refactor-run-now" title="${t('project_refactor.run_now_title')}" ${busy}>${t('project_refactor.run_now')}</button>` : ''}
      <button type="button" class="btn sm ghost" data-rf-dismiss="${esc(p.id)}" data-testid="refactor-dismiss" aria-label="${t('project_refactor.dismiss_value', { value: esc(p.title || p.target || 'proposal') })}" ${busy}>${t('common.dismiss')}</button>
    </div>`;
  }

  function dismissMarkup(p) {
    return `<div class="row rf-dismiss-form">
      <input type="text" class="rf-reason" data-testid="refactor-dismiss-reason" data-rf-reason aria-label="${t('project_refactor.why_dismiss_value', { value: esc(p.title || 'this proposal') })}" placeholder="${t('project_refactor.why_it_should_not_be_done')}" spellcheck="false" />
      <button type="button" class="btn sm" data-rf-dismiss-confirm="${esc(p.id)}" data-testid="refactor-dismiss-confirm">${t('common.dismiss')}</button>
      <button type="button" class="btn sm ghost" data-rf-dismiss-cancel>${t('common.cancel')}</button>
    </div>`;
  }

  function rowMarkup(c, p) {
    const files = p.targetFiles || [];
    const dismissed = p.status === 'dismissed';
    return `<li class="rf-row" data-testid="refactor-proposal">
      <span class="rf-rank" data-testid="refactor-proposal-rank" title="${t('project_refactor.rank')}">${p.rank ? `#${esc(p.rank)}` : '—'}</span>
      <div class="rf-body">
        <div class="rf-line"><b class="rf-title" title="${esc(p.title || '')}">${esc(p.title || p.improvement || p.target || t('project_refactor.proposal'))}</b>
          ${p.complexity ? `<span class="badge" data-testid="refactor-proposal-complexity" title="${t('project_refactor.complexity_from_1_to_5')}">${t('project_refactor.complexity')} ${esc(p.complexity)}</span>` : ''}
          ${issueMarkup(p)}${outcomeMarkup(p)}</div>
        <div class="rf-line small"><span class="mono muted rf-target" title="${esc(files.join(', '))}">${esc(files.join(', ') || '—')}</span></div>
        ${p.rankReason ? `<div class="small" data-testid="refactor-proposal-reason">${esc(p.rankReason)}</div>` : ''}
        ${dismissed ? `<div class="small muted" data-testid="refactor-proposal-dismiss-reason">${t('project_refactor.dismissed')} ${esc(p.dismissReason || '')}</div>` : ''}
        ${c.dismissing === p.id ? dismissMarkup(p) : actionsMarkup(c, p)}
      </div>
    </li>`;
  }

  function addFormMarkup() {
    return `<div class="rf-add" data-testid="refactor-add-form">
      <div class="rf-add-grid">
        <div class="field"><label for="rf-add-target">${t('project_refactor.target')}</label><input type="text" id="rf-add-target" data-rf-add-target placeholder="${t('project_refactor.src_billing_invoice_js')}" spellcheck="false" /><div class="hint">${t('project_refactor.a_file_or_a_folder')}</div></div>
        <div class="field"><label for="rf-add-improvement">${t('project_refactor.expected_improvement')}</label><input type="text" id="rf-add-improvement" data-rf-add-improvement placeholder="${t('project_refactor.split_the_tax_rules_out_of')}" /></div>
      </div>
      <div class="field"><label for="rf-add-evidence">${t('project_refactor.evidence')}</label><textarea id="rf-add-evidence" rows="2" data-rf-add-evidence placeholder="${t('project_refactor.what_shows_it_is_needed_hotspot')}"></textarea></div>
      <div class="row"><button type="button" class="btn sm primary" data-rf-add-save>${t('common.save')}</button><button type="button" class="btn sm ghost" data-rf-add-cancel>${t('common.cancel')}</button></div>
    </div>`;
  }

  function listMarkup(c, open, dismissed) {
    const shown = (c.filter === 'dismissed' ? dismissed : open).slice().sort(byRank);
    const filters = `<div class="row rf-filters">
      <div class="chips" role="group" aria-label="${t('project_refactor.proposals')}">
        <button type="button" class="chip${c.filter === 'open' ? ' active' : ''}" data-rf-filter="open" aria-pressed="${c.filter === 'open'}">${t('project_refactor.open')} ${open.length}</button>
        <button type="button" class="chip${c.filter === 'dismissed' ? ' active' : ''}" data-rf-filter="dismissed" data-testid="refactor-filter-dismissed" aria-pressed="${c.filter === 'dismissed'}">${t('project_refactor.dismissed_2')} ${dismissed.length}</button>
      </div>
      <span class="spacer"></span>
      ${c.adding ? '' : `<button type="button" class="btn sm ghost" data-rf-add data-testid="refactor-add">${t('project_refactor.write_a_proposal')}</button>`}
    </div>`;
    const empty = c.filter === 'dismissed' ? t('project_refactor.no_dismissed_proposal') : t('project_refactor.no_open_proposal');
    return `${filters}${c.adding ? addFormMarkup() : ''}
      ${shown.length ? `<ul class="rf-list" data-testid="refactor-proposals">${shown.map((p) => rowMarkup(c, p)).join('')}</ul>` : `<p class="muted small">${empty}</p>`}`;
  }

  function stateMarkup(c, open, dismissed) {
    if (!c.loaded) return `<p class="muted" data-testid="refactor-loading">${t('project_refactor.reading_the_proposals')}</p>`;
    if (!c.reports.length && !open.length && !dismissed.length && !c.adding) {
      return `<div class="empty-state" data-testid="refactor-state-no-report"><b>${t('project_refactor.no_architecture_report_yet')}</b>
        <p class="muted">${t('project_refactor.the_proposals_come_from_the_architecture')}</p>
        <div class="row rf-center"><button type="button" class="btn sm primary" data-rf-open-architecture>${t('project_refactor.open_the_architecture_tab')}</button><button type="button" class="btn sm ghost" data-rf-add>${t('project_refactor.write_a_proposal')}</button></div></div>`;
    }
    if (!open.length && !dismissed.length && !c.adding) {
      return `<div class="empty-state" data-testid="refactor-state-empty"><b>${t('project_refactor.no_refactor_proposals_yet')}</b>
        <p class="muted">${t('project_refactor.send_findings_from_the_architecture_tab')}</p>
        <div class="row rf-center"><button type="button" class="btn sm primary" data-rf-add>${t('project_refactor.write_a_proposal')}</button><button type="button" class="btn sm ghost" data-rf-open-architecture>${t('project_refactor.open_the_architecture_tab')}</button></div></div>`;
    }
    return listMarkup(c, open, dismissed);
  }

  function render() {
    const c = cur;
    if (!c?.box) return;
    const list = c.list || [];
    const open = list.filter((p) => p.status !== 'dismissed');
    const dismissed = list.filter((p) => p.status === 'dismissed');
    const error = c.error || c.loadError;
    c.box.innerHTML = `<div class="rf-tab" data-testid="refactor">
      ${c.loaded ? headMarkup(c, open.length > 0) : ''}
      ${c.prioritizing ? `<p class="muted small rf-busy" data-testid="refactor-prioritizing" role="status">${t('project_refactor.the_product_owner_is_ranking_the')}</p>` : ''}
      ${error ? `<div class="usage-unavailable" role="alert" data-testid="refactor-state-error">${esc(error)}</div>` : ''}
      ${c.loaded ? cadenceMarkup(c) : ''}
      ${stateMarkup(c, open, dismissed)}
    </div>`;
  }

  // ---- actions ------------------------------------------------------------------------------------
  // runs `call` for the project on screen; its error becomes the tab's error state; reloads after
  async function act(call, { busy = null } = {}) {
    const c = cur;
    Object.assign(c, { error: null, busy });
    render();
    try {
      const out = await call(c);
      return out;
    } catch (e) {
      c.error = errMsg(e);
      return null;
    } finally {
      c.busy = null;
      if (cur === c) await load();
    }
  }

  async function prioritize() {
    if (cur.prioritizing) return;
    const c = cur;
    c.prioritizing = true;
    await act(async () => {
      try {
        const out = await api.prioritizeRefactors(c.id);
        if (out) showToast(`${t('project_refactor.the_po_ranked_proposals', { count: out.ranking?.length || 0 })}${out.costUsd ? ` (${usd(out.costUsd)})` : ''}`);
      } finally {
        c.prioritizing = false;
      }
    });
  }

  const fileIssue = (id) => act(async (c) => {
    const out = await api.fileRefactorIssue(c.id, id, {});
    if (out?.preview) showToast(t(out.command ? 'project_refactor.simulation_filed_with' : 'project_refactor.simulation_filed_with_tracker_cli', { command: out.command }));
    else if (out?.proposal?.issue) showToast(t('project_refactor.filed_as_issue', { issue: out.proposal.issue }));
  }, { busy: id });

  // the waiting stage by default (the owner enables it); runNow after the stage in progress (#435)
  const addToRoadmap = (id, runNow = false) => act(async (c) => {
    const out = await api.addRefactorToRoadmap(c.id, id, runNow ? { runNow: true } : {});
    const key = out?.waiting ? 'project_refactor.added_issue_to_the_waiting_stage' : 'project_refactor.added_issue_to_the_roadmap_stage';
    if (out?.proposal) showToast(t(key, { issue: out.proposal.issue, stage: out.stage }));
  }, { busy: id });

  function dismiss(id) {
    const reason = cur.box.querySelector('[data-rf-reason]')?.value.trim() || '';
    if (!reason) { cur.error = t('project_refactor.say_why_the_proposal_is_dismissed'); render(); return; }
    cur.dismissing = null;
    act(async (c) => {
      const out = await api.dismissRefactorProposal(c.id, id, reason);
      showToast(out?.title ? t('project_refactor.dismissed_title', { title: out.title }) : t('project_refactor.dismissed_the_proposal'));
    });
  }

  function saveProposal() {
    const box = cur.box;
    const target = box.querySelector('[data-rf-add-target]')?.value.trim() || '';
    const improvement = box.querySelector('[data-rf-add-improvement]')?.value.trim() || '';
    const evidence = box.querySelector('[data-rf-add-evidence]')?.value.trim() || '';
    if (!target || !improvement) { cur.error = 'A proposal needs its target and the improvement expected.'; render(); return; }
    cur.adding = false;
    act((c) => api.addRefactorProposal(c.id, { target, improvement, evidence }));
  }

  function setCadence(changes) {
    const c = cur;
    const was = c.cadence || { on: false, every: 10 };
    const next = { on: was.on, every: was.every, ...changes };
    c.cadence = { ...was, ...next }; // a reload in flight does not flip the switch back
    act(async () => { c.cadence = await api.setRefactorCadence(c.id, next.on, next.every) || c.cadence; });
  }

  // a click → its action, or null
  function clickAction(e) {
    const at = (sel) => e.target.closest(sel);
    if (at('[data-rf-prioritize]')) return prioritize;
    if (at('[data-rf-open-architecture]')) return () => openProjectView(cur.id, { tab: 'architecture' });
    if (at('[data-rf-add]')) return () => { Object.assign(cur, { adding: true, error: null }); render(); cur.box.querySelector('[data-rf-add-target]')?.focus({ preventScroll: true }); };
    if (at('[data-rf-add-cancel]')) return () => { Object.assign(cur, { adding: false, error: null }); render(); };
    if (at('[data-rf-add-save]')) return saveProposal;
    const filter = at('[data-rf-filter]');
    if (filter) return () => { Object.assign(cur, { filter: filter.dataset.rfFilter, dismissing: null }); render(); };
    const file = at('[data-rf-file]');
    if (file) return () => fileIssue(file.dataset.rfFile);
    const roadmap = at('[data-rf-roadmap]');
    if (roadmap) return () => addToRoadmap(roadmap.dataset.rfRoadmap);
    const runNow = at('[data-rf-run-now]');
    if (runNow) return () => addToRoadmap(runNow.dataset.rfRunNow, true);
    const confirm = at('[data-rf-dismiss-confirm]');
    if (confirm) return () => dismiss(confirm.dataset.rfDismissConfirm);
    if (at('[data-rf-dismiss-cancel]')) return () => { Object.assign(cur, { dismissing: null, error: null }); render(); };
    const ask = at('[data-rf-dismiss]');
    if (ask) return () => { Object.assign(cur, { dismissing: ask.dataset.rfDismiss, error: null }); render(); cur.box.querySelector('[data-rf-reason]')?.focus({ preventScroll: true }); };
    return null;
  }

  /** A click inside the tab; true when it was the tab's. */
  function onClick(e) {
    const action = cur?.box?.contains(e.target) ? clickAction(e) : null;
    if (action) action();
    return !!action;
  }

  /** The cadence switch or its number of runs; true when it was the tab's. */
  function onChange(e) {
    if (!cur?.box?.contains(e.target)) return false;
    const t = e.target;
    if (t.matches('[data-rf-cadence-on]')) setCadence({ on: t.checked });
    else if (t.matches('[data-rf-cadence-every]')) setCadence({ every: Number(t.value) });
    else return false;
    return true;
  }

  /** Draws the tab of project `id` into `box`, read again unless a reason or a proposal is being typed. */
  function show(id, box) {
    if (cur?.id !== id) {
      cur = { id, box, list: null, cadence: null, reports: [], loaded: false, loadError: null, error: null, filter: 'open', dismissing: null, adding: false, prioritizing: false, busy: null, seq: 0 };
    }
    const typing = (cur.dismissing || cur.adding) && cur.box === box && box.querySelector('.rf-tab');
    cur.box = box;
    if (typing) return;
    render();
    load();
  }

  window.ProjectRefactor = {
    onChange,
    onClick,
    show,
  };
})();
