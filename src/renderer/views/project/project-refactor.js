// A project's Refactor tab (#357): its refactor proposals (the Architecture findings sent to Refactor,
// or written here by the owner, refactor:add) as a list prioritized by the Product Owner. What leads:
// one row per proposal, sorted by rank (rank, title and target, the one-line reason, complexity 1-5,
// its issue with open/closed and its roadmap item's status, and the Danger Zone outcome of its run:
// left the Danger Zone, score dropped, or not improved, marked). The header counts the files that
// left the Danger Zone through refactor runs in the last 30 and 90 days, and when the ranking was made.
// Actions: "Ask the Product Owner to prioritize" (refactor:prioritize, one turn, the simulated answer
// in simulation), per row "File as issue" (refactor:file, a preview in simulation), "Add to roadmap
// now" (refactor:addToRoadmap, once it has an issue) and "Dismiss" with a reason (refactor:dismiss,
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

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
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
    c.loadError = list.status === 'rejected' ? `Could not read the proposals: ${errMsg(list.reason)}` : null;
    c.list = value(list) || [];
    c.cadence = value(cadence) || c.cadence;
    c.reports = value(reports) || [];
    // a reason or a proposal being typed keeps its box: the new data shows on the next action
    if (!c.dismissing && !c.adding) render();
  }

  // ---- markup -------------------------------------------------------------------------------------
  function headMarkup(c, open) {
    const cd = c.cadence;
    const ranked = cd?.rankedAt ? `<span class="muted small" data-testid="refactor-ranked-at">Ranked on ${esc(day(cd.rankedAt))}${cd.rankCostUsd ? ` · ${esc(usd(cd.rankCostUsd))}` : ''}</span>` : '';
    const left = cd ? `<span class="badge rf-good" data-testid="refactor-left-danger" title="Files that left the Danger Zone through refactor runs">Left the Danger Zone: ${cd.left30 || 0} in 30 days · ${cd.left90 || 0} in 90 days</span>` : '';
    return `<div class="row rf-head">
      <button type="button" class="btn primary sm" data-testid="refactor-prioritize" data-rf-prioritize ${c.prioritizing || !open ? 'disabled' : ''}
        title="One Product Owner turn orders the open proposals by value against risk and cost">Ask the Product Owner to prioritize</button>
      ${ranked}<span class="spacer"></span>${left}
    </div>`;
  }

  function cadenceMarkup(c) {
    const cd = c.cadence || { on: false, every: 10, nextIn: 10, ready: false };
    const next = cd.nextIn > 0 ? `next in ${plural(cd.nextIn, 'run')}` : 'due at the next finished run';
    return `<div class="row rf-cadence" data-testid="refactor-cadence">
      <label class="check"><input type="checkbox" data-testid="refactor-cadence-toggle" data-rf-cadence-on aria-label="Add a refactor to the roadmap every X runs" ${cd.on ? 'checked' : ''} /><span>Add a refactor to the roadmap every</span></label>
      <input type="number" class="rf-every" min="3" max="50" step="1" value="${Number(cd.every) || 10}" data-testid="refactor-cadence-every" data-rf-cadence-every aria-label="Runs between two refactors (3 to 50)" />
      <span>runs</span>
      ${cd.on ? `<span class="badge" data-testid="refactor-cadence-next">${esc(next)}</span>` : ''}
      ${cd.on && !cd.ready ? '<span class="muted small" data-testid="refactor-nothing-ready">Nothing ready to add: prioritize or file a proposal</span>' : ''}
    </div>`;
  }

  function issueMarkup(p) {
    if (!p.issue) return '<span class="muted small">no issue</span>';
    const link = `<span class="badge" data-testid="refactor-proposal-issue" title="${esc(p.issueUrl || '')}">#${esc(p.issue)}${p.issueState ? ` ${esc(String(p.issueState).toLowerCase())}` : ''}</span>`;
    const status = p.roadmapStatus ? `<span class="badge${STATUS_TONE[p.roadmapStatus] ?? ''}" data-testid="refactor-proposal-status">${esc(p.roadmapStatus)}</span>` : '';
    return link + status;
  }

  function outcomeMarkup(p) {
    const o = p.outcome;
    if (o?.leftDangerZone) return '<span class="badge rf-good" data-testid="refactor-proposal-outcome">left the Danger Zone</span>';
    if (o?.improved) return `<span class="badge rf-good" data-testid="refactor-proposal-outcome">score −${esc(o.scoreDrop)}</span>`;
    if (o) return '<span class="badge warn" data-testid="refactor-proposal-outcome" title="The target\'s Danger Zone score did not drop">not improved</span>';
    if (p.before) return `<span class="muted small" title="The target's Danger Zone score before the run">score ${esc(p.before.score)} before</span>`;
    return '';
  }

  function actionsMarkup(c, p) {
    if (p.status === 'dismissed') return '';
    const busy = c.busy === p.id ? 'disabled' : '';
    const placed = !!p.roadmapUnfinished;
    return `<div class="row rf-actions">
      ${p.issue ? '' : `<button type="button" class="btn sm" data-rf-file="${esc(p.id)}" data-testid="refactor-file" ${busy}>File as issue</button>`}
      ${p.issue && !placed ? `<button type="button" class="btn sm" data-rf-roadmap="${esc(p.id)}" data-testid="refactor-add-roadmap" ${busy}>Add to roadmap now</button>` : ''}
      <button type="button" class="btn sm ghost" data-rf-dismiss="${esc(p.id)}" data-testid="refactor-dismiss" aria-label="Dismiss ${esc(p.title || p.target || 'proposal')}" ${busy}>Dismiss</button>
    </div>`;
  }

  function dismissMarkup(p) {
    return `<div class="row rf-dismiss-form">
      <input type="text" class="rf-reason" data-testid="refactor-dismiss-reason" data-rf-reason aria-label="Why dismiss ${esc(p.title || 'this proposal')}" placeholder="Why it should not be done" spellcheck="false" />
      <button type="button" class="btn sm" data-rf-dismiss-confirm="${esc(p.id)}" data-testid="refactor-dismiss-confirm">Dismiss</button>
      <button type="button" class="btn sm ghost" data-rf-dismiss-cancel>Cancel</button>
    </div>`;
  }

  function rowMarkup(c, p) {
    const files = p.targetFiles || [];
    const dismissed = p.status === 'dismissed';
    return `<li class="rf-row" data-testid="refactor-proposal">
      <span class="rf-rank" data-testid="refactor-proposal-rank" title="Rank">${p.rank ? `#${esc(p.rank)}` : '—'}</span>
      <div class="rf-body">
        <div class="rf-line"><b class="rf-title" title="${esc(p.title || '')}">${esc(p.title || p.improvement || p.target || 'Proposal')}</b>
          ${p.complexity ? `<span class="badge" data-testid="refactor-proposal-complexity" title="Complexity from 1 to 5">complexity ${esc(p.complexity)}</span>` : ''}
          ${issueMarkup(p)}${outcomeMarkup(p)}</div>
        <div class="rf-line small"><span class="mono muted rf-target" title="${esc(files.join(', '))}">${esc(files.join(', ') || '—')}</span></div>
        ${p.rankReason ? `<div class="small" data-testid="refactor-proposal-reason">${esc(p.rankReason)}</div>` : ''}
        ${dismissed ? `<div class="small muted" data-testid="refactor-proposal-dismiss-reason">Dismissed: ${esc(p.dismissReason || '')}</div>` : ''}
        ${c.dismissing === p.id ? dismissMarkup(p) : actionsMarkup(c, p)}
      </div>
    </li>`;
  }

  function addFormMarkup() {
    return `<div class="rf-add" data-testid="refactor-add-form">
      <div class="rf-add-grid">
        <div class="field"><label for="rf-add-target">Target</label><input type="text" id="rf-add-target" data-rf-add-target placeholder="src/billing/invoice.js" spellcheck="false" /><div class="hint">A file or a folder.</div></div>
        <div class="field"><label for="rf-add-improvement">Expected improvement</label><input type="text" id="rf-add-improvement" data-rf-add-improvement placeholder="Split the tax rules out of the invoice builder" /></div>
      </div>
      <div class="field"><label for="rf-add-evidence">Evidence</label><textarea id="rf-add-evidence" rows="2" data-rf-add-evidence placeholder="What shows it is needed: hotspot rank, Danger Zone score, bugs"></textarea></div>
      <div class="row"><button type="button" class="btn sm primary" data-rf-add-save>Save</button><button type="button" class="btn sm ghost" data-rf-add-cancel>Cancel</button></div>
    </div>`;
  }

  function listMarkup(c, open, dismissed) {
    const shown = (c.filter === 'dismissed' ? dismissed : open).slice().sort(byRank);
    const filters = `<div class="row rf-filters">
      <div class="chips" role="group" aria-label="Proposals">
        <button type="button" class="chip${c.filter === 'open' ? ' active' : ''}" data-rf-filter="open" aria-pressed="${c.filter === 'open'}">Open ${open.length}</button>
        <button type="button" class="chip${c.filter === 'dismissed' ? ' active' : ''}" data-rf-filter="dismissed" data-testid="refactor-filter-dismissed" aria-pressed="${c.filter === 'dismissed'}">Dismissed ${dismissed.length}</button>
      </div>
      <span class="spacer"></span>
      ${c.adding ? '' : '<button type="button" class="btn sm ghost" data-rf-add data-testid="refactor-add">Write a proposal</button>'}
    </div>`;
    const empty = c.filter === 'dismissed' ? 'No dismissed proposal.' : 'No open proposal: send findings from the Architecture tab or write one.';
    return `${filters}${c.adding ? addFormMarkup() : ''}
      ${shown.length ? `<ul class="rf-list" data-testid="refactor-proposals">${shown.map((p) => rowMarkup(c, p)).join('')}</ul>` : `<p class="muted small">${empty}</p>`}`;
  }

  function stateMarkup(c, open, dismissed) {
    if (!c.loaded) return '<p class="muted" data-testid="refactor-loading">Reading the proposals…</p>';
    if (!c.reports.length && !open.length && !dismissed.length && !c.adding) {
      return `<div class="empty-state" data-testid="refactor-state-no-report"><b>No Architecture report yet</b>
        <p class="muted">The proposals come from the Architecture tab's findings: analyze the project there, then send its findings to Refactor.</p>
        <div class="row rf-center"><button type="button" class="btn sm primary" data-rf-open-architecture>Open the Architecture tab</button><button type="button" class="btn sm ghost" data-rf-add>Write a proposal</button></div></div>`;
    }
    if (!open.length && !dismissed.length && !c.adding) {
      return `<div class="empty-state" data-testid="refactor-state-empty"><b>No refactor proposals yet</b>
        <p class="muted">Send findings from the Architecture tab, or write a proposal with its target and the improvement expected.</p>
        <div class="row rf-center"><button type="button" class="btn sm primary" data-rf-add>Write a proposal</button><button type="button" class="btn sm ghost" data-rf-open-architecture>Open the Architecture tab</button></div></div>`;
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
      ${c.prioritizing ? '<p class="muted small rf-busy" data-testid="refactor-prioritizing" role="status">The Product Owner is ranking the proposals…</p>' : ''}
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
        if (out) showToast(`The Product Owner ranked ${plural(out.ranking?.length || 0, 'proposal')}${out.costUsd ? ` (${usd(out.costUsd)})` : ''}`);
      } finally {
        c.prioritizing = false;
      }
    });
  }

  const fileIssue = (id) => act(async (c) => {
    const out = await api.fileRefactorIssue(c.id, id, {});
    if (out?.preview) showToast(`Simulation: the issue would be filed with ${out.command || 'the tracker\'s CLI'}`);
    else if (out?.proposal?.issue) showToast(`Filed as #${out.proposal.issue}`);
  }, { busy: id });

  const addToRoadmap = (id) => act(async (c) => {
    const out = await api.addRefactorToRoadmap(c.id, id);
    if (out?.proposal) showToast(`Added #${out.proposal.issue} to the roadmap, stage ${out.stage}`);
  }, { busy: id });

  function dismiss(id) {
    const reason = cur.box.querySelector('[data-rf-reason]')?.value.trim() || '';
    if (!reason) { cur.error = 'Say why the proposal is dismissed: the reason stays with it.'; render(); return; }
    cur.dismissing = null;
    act(async (c) => {
      const out = await api.dismissRefactorProposal(c.id, id, reason);
      showToast(`Dismissed "${out?.title || 'the proposal'}"`);
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
    if (at('[data-rf-add]')) return () => { Object.assign(cur, { adding: true, error: null }); render(); cur.box.querySelector('[data-rf-add-target]')?.focus(); };
    if (at('[data-rf-add-cancel]')) return () => { Object.assign(cur, { adding: false, error: null }); render(); };
    if (at('[data-rf-add-save]')) return saveProposal;
    const filter = at('[data-rf-filter]');
    if (filter) return () => { Object.assign(cur, { filter: filter.dataset.rfFilter, dismissing: null }); render(); };
    const file = at('[data-rf-file]');
    if (file) return () => fileIssue(file.dataset.rfFile);
    const roadmap = at('[data-rf-roadmap]');
    if (roadmap) return () => addToRoadmap(roadmap.dataset.rfRoadmap);
    const confirm = at('[data-rf-dismiss-confirm]');
    if (confirm) return () => dismiss(confirm.dataset.rfDismissConfirm);
    if (at('[data-rf-dismiss-cancel]')) return () => { Object.assign(cur, { dismissing: null, error: null }); render(); };
    const ask = at('[data-rf-dismiss]');
    if (ask) return () => { Object.assign(cur, { dismissing: ask.dataset.rfDismiss, error: null }); render(); cur.box.querySelector('[data-rf-reason]')?.focus(); };
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
