// @ts-check
// The Run screen's tab row and what hangs on it (moved out of run.js, the redesign of 2026-11-28): the status pill
// ("Waiting for you" at a gate), the run's title, its actions (runActionPlan: at most two buttons, the rest in the ⋮
// menu, each with its old element id), the stations row under it (the Roadmap lane's stations, time, cost, id) and the
// fail banner (where it stopped, Resume from step…, Ask the supervisor). run.js calls them from renderRunScreen and
// renderRunSummary; they use app.js globals ($, esc, state, selectedView, t…) and the UI kit's (Menu, RunProgress,
// StatusPill), read when called.

// The tab row's status pill and id (#412: they left the top bar), its Stop and Pause (run-controls.js).
// Redesign (2026-11-28): a live run at a human gate reads "Waiting for you" (data-status="waiting"), as the
// run chat and the Roadmap say it (StatusPill); a simulated run says so once, with the badge by its title.
// Under the row: the run's stations and its time and cost (renderRunProgressRow).
function renderRunTabRow() {
  const r = state.run;
  const v = selectedView();
  const pill = $('#run-screen-status');
  const st = r?.status || 'idle';
  const waiting = st === 'running' && !v?.past && v?.approvals?.size > 0;
  pill.className = `pill pill-${waiting ? 'warn' : st}`;
  pill.dataset.status = waiting ? 'waiting' : st;
  pill.textContent = StatusPill.statusLabel(st, { waiting });
  $('#run-screen-id').textContent = r?.id || '';
  renderRunControls(r);
  renderRunProgressRow(v);
}

// The run's title (editable, #84), what resumed it (#384), its PR, its tests' pill, the workflow, Simulated and
// read-only (a past run opened from disk), on the tab row after the tabs. Not redrawn while the title is edited.
function renderRunTitle(r) {
  const box = $('#run-screen-title');
  if (!box || box.querySelector('.run-title-input') === document.activeElement) return;
  const past = selectedView().past;
  const html = `<b class="run-screen-name">${runTitleHtml(r)}</b>${StatusPill.resumedLink(resumedOfRun.get(r.id)?.by)} ${prBadge(r)}${testedPillHtml(r)}`
    + `<span class="small muted run-screen-wf">${esc(r.workflow || '')}${r.version ? ` v${esc(r.version)}` : ''}</span>`
    + `${r.mock ? ` <span class="badge p-mock">${t('run.simulated')}</span>` : ''}`
    + `${past ? ` <span class="small muted" title="${t('run.opened_from_its_recorded_events_nothing')}">${t('run.read_only')}</span>` : ''}`;
  if (box._html === html) return;
  box._html = html;
  box.innerHTML = html;
  box.querySelectorAll('[data-testid="run-resumed-link"]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); showRun(a.dataset.run); }));
}

// The run's stations (redesign 2026-11-28), the Roadmap lane's (RunProgress.pipeline): one per group of its
// workflow and per step in no group; a hollow dot not reached, a dashed one not run, a check done, the
// Validated mode's gate the owner's icon, a return arrow where the run was sent back; the station the run
// is at is a pill (Running, Waiting for you, Failed, Stopped). Read-only: the Steps column has the detail.
// Then the run's time and cost. Hidden for a run without steps to place (an unknown workflow, no trail).
const RUN_STATION_PILL = { running: 'pill-running', waiting: 'pill-warn', failed: 'pill-failed', stopped: 'pill-idle' };
const RUN_STATION_GLYPH = {
  done: '<path d="m3.5 8.5 3 3 6-7"/>', // i18n-ignore
  gate: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3.5 13.5c.6-2.4 2.4-3.6 4.5-3.6s3.9 1.2 4.5 3.6"/>', // i18n-ignore
  back: '<path d="M6 3.5 3 6.5l3 3"/><path d="M3 6.5h6.5a3 3 0 0 1 0 6H8"/>', // i18n-ignore
};
function runStations(v) {
  const r = v?.run;
  if (!r || typeof RunProgress?.pipeline !== 'function') return [];
  const wf = (state.workflows || []).find((w) => w.file === r.file || w.name === r.workflow) || null;
  const steps = wf?.steps?.length ? wf.steps : [...(v.steps?.values() || [])].map((s) => ({ id: s.id, type: s.type }));
  if (!steps.length) return [];
  const groups = wf?.groups?.length ? wf.groups : v.groups || [];
  const mode = r.inputs?.validation ?? r.inputs?.mode ?? null;
  const status = r.status === 'running' || r.status === 'pending' ? 'running' : r.status;
  const list = RunProgress.pipeline({ steps, groups, mode, start: RunProgress.startStep({ steps, inputs: wf?.inputs || {}, values: r.inputs || {} }), progress: v.trail?.steps || [], status, merged: r.mergedCommit || null });
  return v.approvals?.size && !v.past ? list.map((st) => (st.state === 'running' ? { ...st, state: 'waiting' } : st)) : list;
}
function runStationsHtml(v) {
  const list = runStations(v);
  if (!list.length) return '';
  const stepNames = window.runStepNames?.(v.run) ?? v.run?.stepNames;
  const nameOf = (st) => (st.gate ? t('run.your_check') : st.grouped ? RunProgress.groupName(st.name, t) : agentLabel(st.name, stepNames));
  const svg = (d) => `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  return list.map((st) => {
    const name = nameOf(st);
    const pill = RUN_STATION_PILL[st.state];
    const round = st.round > 1 ? ` · ${t('run.round')} ${st.round}` : '';
    const mark = pill
      ? `<span class="pill ${pill} run-st-pill"><span${st.state === 'running' ? ' class="status-dot"' : ''}>${esc(StatusPill.statusLabel(st.state))}</span></span>`
      : `<span class="run-st-glyph">${RUN_STATION_GLYPH[st.state] ? svg(RUN_STATION_GLYPH[st.state]) : ''}</span>`;
    return `<li class="run-station st-${esc(st.state)}" data-testid="run-station" data-step="${esc(st.name)}" data-state="${esc(st.state)}" title="${esc(`${name}${round}`)}">${mark}<span class="run-st-name">${esc(name)}</span></li>`;
  }).join('');
}
function renderRunProgressRow(v) {
  const row = $('#run-progress-row');
  const r = v?.run;
  const stations = r ? runStationsHtml(v) : '';
  row.classList.toggle('hidden', !r);
  if (!r) return;
  const list = $('#run-stations');
  if (list._html !== stations) { list._html = stations; list.innerHTML = stations; }
  list.classList.toggle('hidden', !stations);
  // its time (ticking while it runs) and its cost so far (#117: unknown, partial and approximate as everywhere)
  const ms = r.startedAt ? (r.finishedAt || Date.now()) - r.startedAt : 0;
  const sum = totals();
  const cost = r.mock ? fmtCost(0) : runCostText({ usd: sum.cost, approx: sum.approx, unknown: sum.unknown, partial: sum.partial }, fmtCost);
  $('#run-stats').textContent = [ms > 0 ? fmtDur(ms) : '', cost].filter(Boolean).join(' · ');
}

// The tab row's actions (redesign 2026-11-28): which of them show as buttons, the rest going to its ⋮ menu.
// One action leads by the run's state, at most one more beside it: a live run has none (its own Pause
// and Stop are the row's buttons), nor has a failed one (the fail banner carries Resume from step… and
// Ask the supervisor); a Write & Review run accepted from an issue leads with Save to issue; an ended
// run with changes leads with Review changes, then Resume from step…; one without leads with Resume
// from step…, then Ask the supervisor. ids: the actions the run has (their element ids), in their order.
// → { buttons: [id], primary: whether the first one is the accent button, menu: [id] (the others, in order) }
function runActionPlan(r, ids, { past = false, failBanner = false } = {}) {
  const has = (id) => ids.includes(id);
  const live = r?.status === 'running' && !past;
  let buttons = [];
  if (live || failBanner) buttons = [];
  else if (has('btn-run-save-issue')) buttons = ['btn-run-save-issue', 'btn-run-diff'];
  else if (has('btn-run-diff')) buttons = ['btn-run-diff', 'btn-run-resume'];
  else if (has('btn-run-resume')) buttons = ['btn-run-resume', 'btn-run-sup'];
  buttons = buttons.filter(has);
  return { buttons, primary: buttons.length > 0, menu: ids.filter((id) => !buttons.includes(id)) };
}

// an action as a button of the row (the accent one when `primary`); the supervisor's keep their ◆ mark
function runActionButton(a, primary) {
  return `<button type="button" class="btn sm ${primary ? 'primary' : 'ghost'}${a.mark ? ' sup-btn' : ''}" id="${esc(a.id)}"${a.testid ? ` data-testid="${esc(a.testid)}"` : ''} title="${esc(a.title || '')}">${a.mark ? '<span class="sup-mark">◆</span> ' : ''}${esc(a.label)}</button>`;
}

// the row's ⋮ menu (Menu.menuHtml), closed: each entry keeps its action's id, so its handler is the same
function runActionsMenuHtml(list) {
  const items = list.map((a) => ({ id: a.id, label: a.label, title: a.title, icon: a.mark ? '◆' : '', testid: a.testid || '', attrs: `id="${esc(a.id)}"` }));
  return `<div class="run-actions-more"><button type="button" class="btn sm ghost run-actions-toggle" data-run-more aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t('run.more_actions'))}" title="${esc(t('run.more_actions'))}" data-testid="run-actions-more">⋮</button>`
    + `<div class="run-actions-pop hidden" data-run-more-pop>${Menu.menuHtml(items, { label: t('run.more_actions'), testid: 'run-actions-menu' })}</div></div>`;
}

// the ⋮ button opens and closes its menu (arrows, Esc and a click outside: Menu.bindMenu); a pick runs the
// entry's own handler (mountRunActions), then the menu closes
let runActionsMenu = null;
function onRunActionsMoreClick(e) {
  const pop = $('#run-actions [data-run-more-pop]');
  const btn = $('#run-actions [data-run-more]');
  if (!pop || !btn) return;
  const close = () => { runActionsMenu?.close(); runActionsMenu = null; pop.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
  if (e.target.closest('[data-run-more]')) {
    if (!pop.classList.contains('hidden')) { close(); return; }
    pop.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    const menu = pop.querySelector('[role="menu"]');
    runActionsMenu = Menu.bindMenu(menu, { anchor: btn, onClose: (why) => { close(); if (why === 'escape') btn.focus({ preventScroll: true }); } });
    menu.querySelector(Menu.ENTRY)?.focus({ preventScroll: true });
    return;
  }
  if (e.target.closest(`[data-run-more-pop] ${Menu.ENTRY}`)) close();
}

// The tab row's actions as markup: "+ When it finishes…" first while a live run goes without a chain (#410), then the
// buttons runActionPlan picks and the ⋮ menu with the rest. saveIssue: the issue an accepted Write & Review run saves to.
function runActionsHtml(r, saveIssue) {
  // #410: the run's actions sit on the tab row, on the right; "+ When it finishes…" first while it goes without a chain.
  // The redesign (2026-11-28): at most two of them show as buttons, the one the run's state calls for first
  // (runActionPlan); every other one is an entry of the row's ⋮ menu (Menu, ui-patterns.md), with the same id
  // and handler, so nothing the row offered before is gone.
  const chainLink = r.status === 'running' && !r.chain?.then && !selectedView().past
    ? `<button type="button" class="link-btn small" data-chain="edit" title="${t('run.start_a_workflow_when_this_run')}">${t('run.when_it_finishes')}</button>` : '';
  const actions = [
    { id: 'btn-run-sup', label: t('run.ask_the_supervisor'), title: t('run.ask_the_ai_supervisor_to_explain'), mark: true },
    r.status === 'running' && { id: 'btn-run-watch', label: t('run.watch'), title: WATCH_TITLE, mark: true },
    canResume(r) && { id: 'btn-run-resume', label: t('run.resume_from_step'), title: t('run.start_a_new_run_from_a') },
    hasChanges(r.id) && { id: 'btn-run-diff', label: t('run.review_changes'), title: t('run.the_files_this_run_changed_on') },
    saveIssue && { id: 'btn-run-save-issue', label: t('run.save_to_issue_number', { number: saveIssue.number }), title: t('run.save_the_accepted_document_to_its') },
    { id: 'btn-run-analytics', label: t('run.open_in_analytics'), title: t('run.its_timeline_cost_and_tokens_per') },
    replayMap(r), releaseMap(r),
  ].filter(Boolean);
  const plan = runActionPlan(r, actions.map((a) => a.id), { past: selectedView().past, failBanner: r.status === 'failed' });
  const shownActions = plan.buttons.map((id, i) => runActionButton(actions.find((a) => a.id === id), i === 0 && plan.primary));
  const menuActions = actions.filter((a) => plan.menu.includes(a.id));
  return `${chainLink}${shownActions.join('')}${menuActions.length ? runActionsMenuHtml(menuActions) : ''}`;
}

// Replay on the map (#374): a finished run of a project plays its agents' files over the city
function replayMap(run) {
  if (!run.projectId || run.status === 'running' || !window.ProjectCityAgents) return null;
  return { id: 'btn-run-replay-map', testid: 'run-replay-map', label: t('run.replay_on_the_map'), title: t('run.play_the_files_this_run_s') };
}

// #376: a shipped release run (workflows/release.yaml) shows its release on the city, the previous tag in grey
function releaseMap(run) {
  const shipped = run.projectId && run.status === 'success' && run.inputs?.version && /(^|[\\/])release\.yaml$/.test(String(run.file || ''));
  if (!shipped || !window.ProjectCityRelease) return null;
  return { id: 'btn-run-release-map', testid: 'run-release-map', label: t('run.show_on_the_map'), title: t('run.the_project_city_at_the_previous', { version: run.inputs.version }) };
}

// The fail banner under the tab row, while the run shown has failed.
function renderRunBanner() {
  const r = state.run;
  const box = $('#run-fail-banner');
  const show = r?.status === 'failed';
  box.classList.toggle('hidden', !show);
  if (!show) return;
  // redesign (2026-11-28): where it stopped leads; the way back (Resume from step…, the accent button) and the
  // supervisor sit here, not on the tab row too (runActionPlan leaves a failed run's row to its ⋮ menu)
  const at = selectedView().trail?.steps?.at(-1)?.step || '';
  const resume = canResume(r);
  const key = `${r.id}:${issueRefs(r)}:${r.error || ''}:${at}:${resume}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const where = at ? t('run.stopped_at_step', { step: agentLabel(at, window.runStepNames?.(r) ?? r.stepNames) }) : `${t('run.the_workflow_failed')} ${runLabel(r)}`;
  box.innerHTML = `<svg class="fail-banner-icon" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5v4.2M8 11h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    <div class="fail-banner-text" role="alert"><b data-testid="run-fail-where">${esc(where)}</b>${r.error ? `<span class="mono small" title="${esc(r.error)}">${esc(r.error)}</span>` : ''}<span class="muted small mono">${esc(r.id)}</span></div>
    ${resume ? `<button type="button" class="btn sm primary" id="btn-banner-resume" data-testid="run-fail-resume" title="${t('run.start_a_new_run_from_a')}">${t('run.resume_from_step')}</button>` : ''}
    <button type="button" class="btn sm ghost sup-btn" id="btn-banner-sup"><span class="sup-mark">◆</span> ${t('run.ask_the_supervisor')}</button>`;
  $('#btn-banner-sup').onclick = () => openSupervisorForCurrent();
  if (resume) $('#btn-banner-resume').onclick = () => openResumeDialog(r.id);
}
