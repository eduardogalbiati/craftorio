/* global api */
// Run screen (Run Details): its first row is the tab row (#410: the Chat | Details | 3D tabs, the
// run's status and id, its actions on the right with "+ When it finishes…", then Pause and Stop, #412:
// renderRunTabRow, renderRunSummary), then the run's failure banner, its chain banner below the row
// (#134: renderChainBanner, only when there is a chain, its editor or linked runs), the gates it waits at
// (gate cards: renderRunGates, onRunGateClick; what a gate offers is gate-panel.js), its summary
// (inputs, supervisor, watch, resume, the run that resumed it: #384, Save to issue, Review changes: the diff viewer, #118,
// a shipped release run's "Show on the map": #376, views/project/project-city-release.js), its
// steps by group, its sessions and the Artifacts / Session / Events tabs (a run opens on Artifacts, #410). No sidebar entry of its own: the Run item and the runs menu
// belong to the shell (app.js), which also keeps the run state it draws (state.runs, onEvent,
// hydrateRun) and calls renderRunScreen() from render() while it shows. Registers itself with
// registerView (view-registry.js); uses app.js globals ($, esc, state, api, selectedView…).

// The gates waiting in the run the Run screen shows, asked inline above its steps (never in a
// dialog over the app): which run and step they belong to, the message, the choices and the
// optional feedback field. Rebuilt only when the gates change, so a feedback being typed stays.
// A gate with `local_preview: true` (developer_check, human_review, approve_merge) has two columns
// (#108): the message, Run App and the choices on the left, the run's Artifacts panel on the right
// (stacked below on a narrow window, style.css).
function renderRunGates() {
  const v = selectedView();
  const box = $('#run-gates');
  const gates = [...v.approvals.values()];
  // the gates answered from this window, until approval.resolved confirms them (#603)
  const answered = [...(v.answered?.values() || [])];
  box.classList.toggle('hidden', !gates.length && !answered.length);
  // the interface language too (#30: translated choices and causes redraw on a language change)
  const key = `${gates.map((g) => `${g.run_id}:${g.approval_id}`).join('|')}:${answered.map((a) => `${a.gate.approval_id}:${a.note}`).join('|')}:${runLabel(v.run)}:${window.I18n?.getLanguage?.() || ''}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = gates.map((g) => {
    // the choices, then "Interact with Oracle" at the end of the row (#183)
    const buttons = (g.choices
      ? gateChoices(g).map((c, i) => `<button type="button" class="btn sm ${i === 0 ? 'primary' : 'ghost'}" data-choice="${esc(c.id)}"${c.intent ? ` data-intent="${esc(c.intent)}" title="${esc(c.title)}"` : ''}${c.feedback_required ? ' data-needs-text="1"' : ''} data-testid="run-gate-choice">${esc(c.label)}</button>`).join('')
      : `<button type="button" class="btn sm ghost" data-testid="run-gate-choice" data-answer="false">${esc(g.reject?.label || t('run.reject'))}</button><button type="button" class="btn sm primary" data-testid="run-gate-choice" data-answer="true">${esc(g.approve?.label || t('common.approve'))}</button>`)
      + (window.GateOracle?.gateOracleButtonHtml(g) || '');
    const field = g.feedback ? `<label class="duo-ask-label">${esc(g.feedback.label || t('run.instructions_optional'))}</label>
      <textarea class="duo-ask-text run-gate-feedback" rows="3" placeholder="${esc(g.feedback.placeholder || '')}"></textarea>` : '';
    // a report (#290: the release summary) leads, as Markdown, above the rest of the message
    const parts = typeof gateReportParts === 'function' ? gateReportParts(g) : { reportHtml: '', message: g.message || '' };
    const message = `${parts.reportHtml}<pre class="run-gate-message" data-testid="run-gate-message">${esc(parts.message)}</pre>`;
    // #30: a check_environment gate says its cause in one line, in the interface language, instead of its card
    const envText = typeof gateEnvironmentText === 'function' ? gateEnvironmentText(g) : '';
    const card = envText ? `<p class="gate-card-what" data-testid="check-environment-message">${esc(envText)}</p>` : gateCardHtml(g.run_id, g, message) || message;
    const main = `<div class="run-gate-head"><b>${t('run.approval_required')}</b><span class="muted small mono">${esc(`${v.run ? `${runLabel(v.run)} · ` : ''}step: ${g.step_id}`)}</span></div>
      ${card}${gateToolsHtml(g)}${field}<div class="row gate-choices run-gate-actions">${buttons}</div>${gateButtonsHelpHtml(g)}`;
    const side = gateSideHtml(g);
    const rec = g.brief?.recommendation?.answer;
    return `<div class="run-gate${side ? ' run-gate-wide' : ''}" data-testid="run-gate" data-approval="${esc(g.approval_id)}" data-run="${esc(g.run_id)}"${rec ? ` data-recommend="${esc(rec)}"` : ''}>${side ? `<div class="run-gate-main">${main}</div>${side}` : main}</div>`;
  }).join('') + answered.map(({ gate: g, note }) => `<div class="run-gate run-gate-answered" data-testid="run-gate" data-approval="${esc(g.approval_id)}" data-run="${esc(g.run_id)}"><div class="run-gate-head"><b>${esc(note)}</b><span class="muted small mono">${esc(`step: ${g.step_id}`)}</span></div></div>`).join('');
  mountGateSides(box);
  paintGateApps();
}

// A click on a gate card's button answers that gate (true/false or a choice id) with the run's id,
// so it works for any run in progress. The accepted answer leaves the run's gates at once (the card
// says "Answered", or when a gate answered elsewhere was; the badge and the menu follow, #603);
// approval.resolved only confirms it. A choice that needs the feedback text (feedback_required) is
// not sent without one.
function onRunGateClick(e) {
  const tool = e.target.closest('[data-gate-tool]');
  if (tool) { onGateTool(e, tool.closest('.run-gate')?.dataset.run); return; }
  const b = e.target.closest('button[data-answer], button[data-choice]');
  const card = b?.closest('.run-gate');
  if (!card) return;
  const answer = b.dataset.choice !== undefined ? b.dataset.choice : b.dataset.answer === 'true';
  const text = card.querySelector('.run-gate-feedback');
  if (b.dataset.needsText && !text?.value.trim()) { showToast(t('run.write_your_request_first'), t('run.textcontent_sends_the_text_to_the', { textContent: b.textContent })); text?.focus({ preventScroll: true }); return; }
  const buttons = card.querySelectorAll('button');
  buttons.forEach((x) => (x.disabled = true));
  const send = () => PasteImage.settle(text)
    .then(() => {
      // intent: "Accept and save to issue #n" (#125); images pasted into the feedback (#130)
      const images = PasteImage.attachments(text);
      const extra = images.length ? [b.dataset.intent || null, images] : b.dataset.intent ? [b.dataset.intent] : [];
      return api.resolveApproval(card.dataset.approval, answer, text?.value || '', card.dataset.run, ...extra);
    })
    .then((ok) => {
      if (ok === false) { buttons.forEach((x) => (x.disabled = false)); showToast(t('run.the_gate_did_not_accept_the'), t('run.it_needs_a_text_or_it')); return; }
      const note = ok?.already_answered ? t('run.already_answered_at', { time: TimeZone.formatTime(ok.answered_at, TimeZone.current()) }) : t('run.answered');
      const run = state.runs.get(card.dataset.run);
      const gate = run?.approvals.get(card.dataset.approval);
      if (gate) { run.approvals.delete(gate.approval_id); (run.answered ||= new Map()).set(gate.approval_id, { gate, note }); }
      const actions = card.querySelector('.run-gate-actions');
      if (actions) actions.textContent = note;
      scheduleRender();
    })
    .catch((err) => { buttons.forEach((x) => (x.disabled = false)); showToast(t('run.could_not_answer_the_gate'), errMsg(err)); });
  // the answer opposite to the gate's recommendation asks once (#213); any other is sent at once
  // (data-recommend on the card: the recommended answer, approve / reject or a choice id)
  const key = typeof answer === 'boolean' ? (answer ? 'approve' : 'reject') : String(answer);
  if (!card.dataset.recommend || key === card.dataset.recommend) { send(); return; }
  confirmGateAnswer(selectedView().approvals.get(card.dataset.approval), answer).then((ok) => (ok ? send() : buttons.forEach((x) => (x.disabled = false))));
}

// Brings the Run screen's gate card into view and focuses its first answer.
function focusRunGate() {
  requestAnimationFrame(() => {
    const card = $('#run-gates .run-gate');
    // scrolls the Run view only, never the page (#208: scrollIntoView also scrolled the page sideways)
    const view = card?.closest('.view');
    if (card && view) {
      const c = card.getBoundingClientRect(), v = view.getBoundingClientRect();
      if (c.top < v.top) view.scrollTop -= v.top - c.top;
      else if (c.bottom > v.bottom) view.scrollTop += Math.min(c.bottom - v.bottom, c.top - v.top);
    }
    card?.querySelector('.run-gate-actions button')?.focus({ preventScroll: true });
  });
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab[data-tab]').forEach((t) => { t.classList.toggle('active', t.dataset.tab === tab); t.setAttribute('aria-selected', String(t.dataset.tab === tab)); });
  $('#tab-detail').classList.toggle('hidden', tab !== 'detail');
  $('#tab-events').classList.toggle('hidden', tab !== 'events');
  $('#tab-artifacts').classList.toggle('hidden', tab !== 'artifacts');
  scheduleRender();
}

// The Run screen's Artifacts tab (#109): the shared panel (artifacts-panel.js), mounted on first
// use (the component loads after app.js); its count goes on the tab.
let runArtPanel = null;
function runArtifactsPanel() {
  if (!runArtPanel && window.ArtifactsPanel) {
    runArtPanel = ArtifactsPanel.mount($('#tab-artifacts'), {
      onCount: (n) => { const c = $('#tab-artifacts-count'); c.textContent = String(n); c.classList.toggle('hidden', !n); },
    });
  }
  return runArtPanel;
}

// What render() draws while the Run screen shows.
function renderRunScreen() {
  if ($('.tab[data-tab].active')?.dataset.tab !== state.tab) switchTab(state.tab); // another run opens on Artifacts (#410)
  renderRunTabRow();
  renderRunBanner();
  renderPauseBanner();
  renderChainBanner();
  renderRunGates();
  window.PrMonitorCard?.renderRun(selectedView()); // #809: the PR monitor's card, while the run waits for its merge
  renderRunSummary();
  renderSteps();
  renderSessions();
  // the tab's count follows the selected run even while another tab shows
  runArtifactsPanel()?.setRun(state.runId);
  if (state.tab === 'detail') renderDetail();
  else if (state.tab === 'events') renderEvents();
}

// The tab row's status pill and id (#412: they left the top bar), its Stop and Pause (run-controls.js).
function renderRunTabRow() {
  const r = state.run;
  const pill = $('#run-screen-status');
  const st = r?.status || 'idle';
  pill.className = `pill pill-${st}`;
  pill.dataset.status = st;
  pill.textContent = statusLabel(r);
  $('#run-screen-id').textContent = r?.id || '';
  renderRunControls(r);
}

function liveDuration(s) {
  if (s.closed_at) return s.duration_ms;
  return Date.now() - (s.localOpenedAt || Date.parse(s.opened_at));
}

// Whether a run has changes to review (#118): a git worktree, or files its developer reported.
function hasChanges(runId) {
  return (state.runs.get(runId)?.events || []).some((e) => e.type === 'worktree.ready' || (e.type === 'step.finished' && Array.isArray(e.output?.files_changed)));
}

// #203: which tests the run wrote and ran, as badges ("Unit tests: Off", warn when off), the
// value's source (workflow default / chosen for this run) on hover; '' for other workflows.
function testsPlanHtml(plan) {
  if (!Array.isArray(plan) || !plan.length) return '';
  return `<div class="small run-tests-plan">${plan.map((p) => `<span class="badge${p.value === 'off' ? ' warn' : ''}" title="${esc(`${p.label}: ${p.value_label} (${p.source})${p.value === 'off' ? ': nothing of it is tested in this run' : ''}`)}">${esc(p.label)}: ${esc(p.value_label)}</span>`).join(' ')}</div>`;
}

// #396: a run that went on to the build without a green suite (the owner's policy on a suite red
// only outside the change, or Continue at the test gate), as a warn badge; its failures and their
// class on hover. '' for a run tested green or without a suite. #71: nothing to test, a neutral badge.
function testedPillHtml(r) {
  if (r.tested === 'no tests') return ` <span class="badge" data-testid="run-tested-pill" title="${esc(t('run.no_tests_tip'))}">${t('run.no_tests')}</span>`;
  if (r.tested !== 'not green') return '';
  const fails = (r.testedFailures || []).map((f) => `${f.test}${f.file ? ` (${f.file})` : ''}${f.class ? `: ${f.class}` : ''}`);
  const title = `${t('run.reached_the_build_without_a_green_suite')}${fails.length ? `\n${fails.join('\n')}` : ''}`;
  return ` <span class="badge warn" data-testid="run-tested-pill" title="${esc(title)}">${t('run.not_tested_green')}</span>`;
}

// #304: a suite step with `scope: affected`, its latest round as a card: the scope (the affected test
// files, then the whole suite once), why each file ran (output.selection) and the logs. '' when no
// suite step of the run selected its files. A step that runs the files it lists (the red check: every
// reason is "listed by <step>") reads "Listed tests", not the change's affected set.
const SUITE_REASONS_SHOWN = 6;
function suiteCardsHtml(runId, stepNames) {
  const last = new Map();
  for (const e of state.runs.get(runId)?.events || []) {
    if (e.type === 'step.finished' && e.output?.kind === 'suite' && e.output.selection) last.set(e.step_id, e.output);
  }
  return [...last].map(([stepId, out]) => {
    const sel = out.selection;
    const listed = Object.values(sel.reasons || {}).length > 0 && Object.values(sel.reasons).every((why) => /^listed by /.test(why));
    const scope = t(sel.mode === 'all' ? 'run.suite_whole' : listed ? 'run.suite_listed' : out.affected && out.scope === 'full' ? 'run.suite_affected_then_whole' : 'run.suite_affected_only');
    const reasons = Object.entries(sel.reasons || {});
    const more = reasons.length - SUITE_REASONS_SHOWN;
    const list = reasons.length
      ? `<ul>${reasons.slice(0, SUITE_REASONS_SHOWN).map(([f, why]) => `<li><span class="mono text-cut" data-testid="run-suite-file" title="${esc(f)}">${esc(f)}</span>: <span class="text-prose">${esc(why)}</span></li>`).join('')}${more > 0 ? `<li class="muted">${t('run.and_more_more', { more })}</li>` : ''}</ul>`
      : '';
    const logBtn = (log, label, testid) => (log ? `<button type="button" class="link-btn small" data-testid="${testid}" data-suite-log="${esc(log)}" title="${esc(log)}">${label}</button>` : '');
    const affectedLog = out.affected ? out.affected.log : out.scope === 'files' ? out.log : '';
    return `<div class="run-suite-card fit-box" data-testid="run-suite-card">
      <div><b title="${esc(stepId)}">${esc(agentLabel(stepId, stepNames))}</b> <span class="badge" data-testid="run-suite-scope" title="${esc(sel.why || '')}">${esc(scope)}</span>${out.round ? ` <span class="muted small">${t('run.round')} ${esc(out.round)}</span>` : ''}</div>
      <div class="small run-suite-selection" data-testid="run-suite-selection">${list}${sel.why ? `<div class="muted">${esc(sel.why)}</div>` : ''}</div>
      <div class="row">${logBtn(affectedLog, t(listed ? 'run.suite_listed_log' : 'run.suite_affected_log'), 'run-suite-affected-log')}${out.affected && out.scope === 'full' ? logBtn(out.log, t('run.suite_whole_log'), 'run-suite-full-log') : ''}</div>
    </div>`;
  }).join('');
}

// Opens a log of the run (a path relative to its folder); a run recorded without its folder opens the folder.
function openRunLog(runId, rel) {
  const runDir = state.runs.get(runId)?.events?.find((e) => e.type === 'workflow.started')?.run_dir || '';
  const opened = runDir ? api.openPath(`${runDir.replace(/[\\/]+$/, '')}/${rel}`) : api.openRunDir(runId);
  Promise.resolve(opened).catch((e) => showToast(t('run.could_not_open_the_log'), errMsg(e)));
}

// The run's scratch workspace (#201: its agents' checks, not artifacts), read at most every 15 s
// per run: runId → { info: { dir, files, bytes } | null, at }. Shown only while it exists.
const scratchOfRun = new Map();
function askScratch(runId) {
  const cur = scratchOfRun.get(runId);
  if (cur && (cur.pending || Date.now() - cur.at < 15000)) return;
  scratchOfRun.set(runId, { ...(cur || { info: null }), pending: true, at: Date.now() });
  api.runScratch(runId).then((info) => info, () => null).then((info) => {
    scratchOfRun.set(runId, { info, at: Date.now() });
    if (state.run?.id === runId && state.view === 'run') renderRunSummary();
  });
}

function scratchHtml(runId) {
  const s = scratchOfRun.get(runId)?.info;
  if (!s) return '';
  return `<div class="small run-scratch" title="${t('run.a_scratch_copy_of_the_workspace', { dir: esc(s.dir) })}">`
    + `<span class="text-prose">${t('run.scratch_workspace_files', { count: s.files, size: esc(fmtSize(s.bytes)) })}</span> <button class="btn sm ghost" id="btn-run-scratch">${t('run.open_folder')}</button></div>`;
}

// #384: the run that resumed an ended run (its row's resumedBy, runs:list { ids }), read at most every
// 15 s per run: runId → { by: { runId, status } | null, at }. A running run is not asked.
const resumedOfRun = new Map();
function askResumed(r) {
  if (!r.id || r.status === 'running') return;
  const cur = resumedOfRun.get(r.id);
  if (cur && (cur.pending || Date.now() - cur.at < 15000)) return;
  resumedOfRun.set(r.id, { ...(cur || { by: null }), pending: true, at: Date.now() });
  Promise.resolve().then(() => api.listRuns({ ids: [r.id] })).then((d) => d?.runs?.[0]?.resumedBy || null, () => cur?.by || null).then((by) => {
    resumedOfRun.set(r.id, { by, at: Date.now() });
    if (state.run?.id === r.id && state.view === 'run') renderRunSummary();
  });
}

function renderRunSummary() {
  const r = state.run;
  if (!r) return;
  askPrStates([r]);
  askScratch(r.id);
  askResumed(r);
  // (#39: a run on a local backlog has no platform to show)
  const all = Object.entries(r.inputs || {}).filter(([k, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && !(k === 'git_platform' && v === 'local'));
  // #216: the choices (enum and yes/no inputs) as the shared pills, with their labels; the rest
  // (task, paths, numbers) as key / value
  const wf = (state.workflows || []).find((w) => w.file === r.file || w.name === r.workflow) || null;
  const isChoice = (k) => Array.isArray(wf?.inputs?.[k]?.enum) || wf?.inputs?.[k]?.type === 'boolean';
  const pills = WorkflowInputs.inputPills(wf, Object.fromEntries(all.filter(([k]) => isChoice(k))), { defaults: true });
  const inputs = all.filter(([k]) => !isChoice(k));
  // an accepted Write & Review run started from an issue: Save to issue, now or later (#103)
  const saveIssue = r.workflow === 'writer-reviewer' && r.status === 'success' && window.openDuoSaveToIssue ? (issuesOfRun(r)[0] || null) : null;
  // its title (editable) and PR first, the workflow under it (#84); a past run opened from disk is read-only
  const html = `
    <div class="run-summary-name"><b>${runTitleHtml(r)}</b>${StatusPill.resumedLink(resumedOfRun.get(r.id)?.by)} ${prBadge(r)}${testedPillHtml(r)}</div>
    <div class="small muted">${esc(r.workflow || '')}${r.version ? ` v${esc(r.version)}` : ''}${selectedView().past ? ` · <span title="${t('run.opened_from_its_recorded_events_nothing')}">${t('run.read_only')}</span>` : ''}</div>
    ${r.project ? `<div class="small">${t('run.project')} <b>${esc(r.project)}</b></div>` : ''}
    ${(r.issueSaves || []).map((s) => `<div class="small" title="${t('run.the_accepted_document_was_saved_to')}">${t('run.saved_to_issue')} <a href="${esc(s.commentUrl || s.url)}" target="_blank" rel="noopener">#${esc(s.number)}</a> · ${s.mode === 'comment' ? t('run.as_a_comment') : t('run.description_replaced')} · ${esc(new Date(s.at).toLocaleString('en-US'))}</div>`).join('')}
    ${r.gateWaitMs ? `<div class="small" title="${t('run.time_the_run_waited_for_your')}">${t('run.waiting_for_you_at_gates')} <b>${esc(fmtDur(r.gateWaitMs))}</b></div>` : ''}
    ${testsPlanHtml(r.testsPlan)}
    ${suiteCardsHtml(r.id, r.stepNames)}
    ${scratchHtml(r.id)}
    ${pills ? `<div class="run-input-pills">${pills}</div>` : ''}
    <dl class="kv run-inputs">${inputs.map(([k, v]) => `<dt title="${esc(k)}">${esc(k)}</dt>${inputValueCell(v)}`).join('')}</dl>
    ${inputImagesHtml()}
    ${window.gateScenariosHtml ? window.gateScenariosHtml(r.id) : ''}`;
  // #410: the run's actions sit on the tab row, on the right; "+ When it finishes…" first while it goes without a chain
  const chainLink = r.status === 'running' && !r.chain?.then && !selectedView().past
    ? `<button type="button" class="link-btn small" data-chain="edit" title="${t('run.start_a_workflow_when_this_run')}">${t('run.when_it_finishes')}</button>` : '';
  const actionsHtml = `${chainLink}
      <button class="btn sm ghost sup-btn" id="btn-run-sup" title="${t('run.ask_the_ai_supervisor_to_explain')}"><span class="sup-mark">◆</span> ${t('run.ask_the_supervisor')}</button>
      ${r.status === 'running' ? `<button class="btn sm ghost sup-btn" id="btn-run-watch" title="${WATCH_TITLE}"><span class="sup-mark">◆</span> ${t('run.watch')}</button>` : ''}
      ${canResume(r) ? `<button class="btn sm ghost" id="btn-run-resume" title="${t('run.start_a_new_run_from_a')}">${t('run.resume_from_step')}</button>` : ''}
      ${hasChanges(r.id) ? `<button class="btn sm ghost" id="btn-run-diff" title="${t('run.the_files_this_run_changed_on')}">${t('run.review_changes')}</button>` : ''}
      ${saveIssue ? `<button class="btn sm ghost" id="btn-run-save-issue" title="${t('run.save_the_accepted_document_to_its')}">${t('run.save_to_issue_number', { number: esc(saveIssue.number) })}</button>` : ''}
      <button class="btn sm ghost" id="btn-run-analytics" title="${t('run.its_timeline_cost_and_tokens_per')}">${t('run.open_in_analytics')}</button>
      ${replayMapHtml(r)}${releaseMapHtml(r)}`;
  // rendered on every event: rebuilt only when it changes, so a hover popover over an input stays open
  const box = $('#run-summary');
  const row = $('#run-actions');
  // keyed on the run too: its handlers hold that run
  if (row._html !== `${r.id}\n${actionsHtml}`) { row._html = `${r.id}\n${actionsHtml}`; row.innerHTML = actionsHtml; mountRunActions(); }
  if (box._html === html || box.querySelector('.run-title-input') === document.activeElement) return;
  box._html = html;
  box.innerHTML = html;
  mountInputImages(box);
  // the test writer's E2E scenarios (#143): local-hero has no merge approval to show them at
  if (window.mountGateScenarios) window.mountGateScenarios(box);
  box.querySelectorAll('[data-testid="run-resumed-link"]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); showRun(a.dataset.run); }));
  box.querySelectorAll('[data-suite-log]').forEach((b) => (b.onclick = () => openRunLog(r.id, b.dataset.suiteLog)));
  if ($('#btn-run-scratch')) $('#btn-run-scratch').onclick = () => api.openPath(scratchOfRun.get(r.id)?.info?.dir).catch((e) => showToast(t('run.could_not_open_the_folder'), errMsg(e)));

  // the tab row's buttons: the same ids and handlers as when they sat in the Workflow panel
  function mountRunActions() {
    $('#btn-run-sup').onclick = () => openSupervisorForCurrent();
    if ($('#btn-run-watch')) $('#btn-run-watch').onclick = () => openSupervisorForCurrent({ watch: true });
    if ($('#btn-run-resume')) $('#btn-run-resume').onclick = () => openResumeDialog(r.id);
    if ($('#btn-run-diff')) $('#btn-run-diff').onclick = () => DiffViewer.open({ runId: r.id, title: r.title || r.workflow || '' });
    $('#btn-run-analytics').onclick = () => window.openAnalytics?.({ tab: 'run', runId: r.id });
    mountReplayMap(r);
    if ($('#btn-run-save-issue')) {
      $('#btn-run-save-issue').onclick = () => window.openDuoSaveToIssue({ runId: r.id, issue: saveIssue, mock: !!r.mock, docSkill: r.inputs?.document_skill || '' });
    }
  }

  // Replay on the map (#374): a finished run of a project plays its agents' files over the city
  function replayMapHtml(run) {
    if (!run.projectId || run.status === 'running' || !window.ProjectCityAgents) return '';
    return `<button class="btn sm ghost" id="btn-run-replay-map" data-testid="run-replay-map" title="${t('run.play_the_files_this_run_s')}">${t('run.replay_on_the_map')}</button>`;
  }

  // #376: a shipped release run (workflows/release.yaml) shows its release on the city, the previous tag in grey
  function releaseMapHtml(run) {
    const shipped = run.projectId && run.status === 'success' && run.inputs?.version && /(^|[\\/])release\.yaml$/.test(String(run.file || ''));
    if (!shipped || !window.ProjectCityRelease) return '';
    return `<button class="btn sm ghost" id="btn-run-release-map" data-testid="run-release-map" title="${t('run.the_project_city_at_the_previous', { version: esc(run.inputs.version) })}">${t('run.show_on_the_map')}</button>`;
  }

  function mountReplayMap(run) {
    if ($('#btn-run-replay-map')) $('#btn-run-replay-map').onclick = () => ProjectCityAgents.replay(run.projectId, run.id);
    if ($('#btn-run-release-map')) $('#btn-run-release-map').onclick = () => showReleaseOf(run);
  }

  // the tag Ship wrote (tagName: "Sprint 12: beta" is tagged Sprint-12-beta), from the release that lists this run; else the version
  async function showReleaseOf(run) {
    const data = await api.listReleases(run.projectId).catch(() => null);
    const release = (data?.releases || []).find((r) => [].concat(r.runs || []).includes(run.id));
    ProjectCityRelease.showRelease(run.projectId, { to: String(release?.tag || run.inputs.version) });
  }
}

// The images attached to the run's inputs (#129, pasted in the Start drawer #130): read-only
// thumbnails under the inputs (no remove button), read from the run folder (artifacts:read) and
// opened in the image viewer.
function inputImagesHtml() {
  const recorded = selectedView().events?.find((e) => e.type === 'workflow.started')?.attachments || {};
  const files = Object.entries(recorded).flatMap(([input, list]) => (list || []).map((f) => ({ ...f, input })));
  if (!files.length) return '';
  return `<div class="ar-chips paste-chips run-input-images">${files.map((f) => `<span class="ar-chip paste-chip" title="${esc(`${f.input}: ${f.name}`)}">`
    + `<img class="paste-thumb" ${ImageViewer.THUMB} alt="${esc(f.name)}" data-run-image="${esc(f.path)}" /><span>${esc(f.name)}</span><small>${esc(f.input)}</small></span>`).join('')}</div>`;
}
function mountInputImages(box) {
  const imgs = [...box.querySelectorAll('[data-run-image]')];
  if (!imgs.length) return;
  imgs.forEach(async (img) => {
    try { const src = (await api.readArtifact(img.dataset.runImage))?.image; if (src) img.src = src; } catch { /* deleted since */ }
  });
  // every input image of the run, one item each (#182)
  const open = (img) => ImageViewer.open({ title: t('run.input_images'), items: imgs.map((i) => ({ title: i.alt || t('run.input_image'), images: [{ file: i.dataset.runImage, src: i.getAttribute('src') || undefined, label: i.alt }] })), index: imgs.indexOf(img) });
  const row = box.querySelector('.run-input-images');
  row.onclick = (e) => { const img = e.target.closest('[data-run-image]'); if (img) open(img); };
  row.onkeydown = (e) => { const img = e.target.closest('[data-run-image]'); if (img && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(img); } };
}

// A run input in the Details panel: one line cut with an ellipsis (paths keep their end), the full
// text on hover (a scrollable popover for long values). Arrays read as a list (issue URLs as #N).
const ISSUE_URL_RE = /\/(?:issues|pull|merge_requests|-\/issues)\/(\d+)\/?$/;
function inputText(v) {
  if (Array.isArray(v)) {
    const items = v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x)));
    const refs = items.map((x) => ISSUE_URL_RE.exec(x)?.[1]);
    return { line: refs.every(Boolean) ? refs.map((n) => `#${n}`).join(', ') : items.join(', '), full: items.join('\n') };
  }
  if (v && typeof v === 'object') return { line: JSON.stringify(v), full: JSON.stringify(v, null, 2) };
  const s = String(v);
  return { line: s.replace(/\s*\n\s*/g, ' ⏎ '), full: s };
}
const looksLikePath = (s) => !/\n/.test(s) && /^(?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/])/.test(s);
function inputValueCell(v) {
  const { line, full } = inputText(v);
  const long = full.length > 200 || full.includes('\n');
  const text = looksLikePath(line) ? `<span class="kv-path"><bdi>${esc(line)}</bdi></span>` : esc(line);
  return long ? `<dd class="kv-line" data-full="${esc(full)}">${text}</dd>` : `<dd class="kv-line" title="${esc(full)}">${text}</dd>`;
}

// One floating popover for elements with data-full (long run inputs): scrollable, stays open while
// the mouse moves into it, so a task of thousands of characters stays readable.
function initFullTextPopover() {
  const pop = document.createElement('div');
  pop.className = 'full-pop hidden';
  document.body.appendChild(pop);
  let owner = null;
  let timer = null;
  const hide = () => { clearTimeout(timer); timer = setTimeout(() => { pop.classList.add('hidden'); owner = null; }, 200); };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[data-full]');
    if (el || pop.contains(e.target)) clearTimeout(timer);
    if (!el || el === owner) return;
    owner = el;
    pop.textContent = el.dataset.full;
    pop.classList.remove('hidden');
    const b = el.getBoundingClientRect();
    const w = Math.min(560, window.innerWidth - 24);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(12, Math.min(b.left, window.innerWidth - w - 12))}px`;
    const below = window.innerHeight - b.bottom - 12;
    pop.style.maxHeight = `${Math.max(below, b.top - 12, 120)}px`;
    if (below >= Math.min(pop.scrollHeight, 240) || below >= b.top) { pop.style.top = `${b.bottom + 4}px`; pop.style.bottom = ''; }
    else { pop.style.top = ''; pop.style.bottom = `${window.innerHeight - b.top + 4}px`; }
  });
  document.addEventListener('mouseout', (e) => {
    const from = e.target.closest?.('[data-full]') || (pop.contains(e.target) ? pop : null);
    if (!from) return;
    const to = e.relatedTarget;
    if (to && (pop.contains(to) || to.closest?.('[data-full]') === owner)) return;
    hide();
  });
}

function renderRunBanner() {
  const r = state.run;
  const box = $('#run-fail-banner');
  const show = r?.status === 'failed';
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const key = `${r.id}:${issueRefs(r)}:${r.error || ''}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = `<div class="fail-banner-text"><b>${t('run.the_workflow_failed')} ${esc(runLabel(r))}</b><span class="muted small mono">${esc(r.id)}</span>${r.error ? `<span class="mono small" title="${esc(r.error)}">${esc(r.error)}</span>` : ''}</div>
    <button class="btn sm sup-btn solid" id="btn-banner-sup"><span class="sup-mark">◆</span> ${t('run.ask_the_supervisor')}</button>`;
  $('#btn-banner-sup').onclick = () => openSupervisorForCurrent();
}

// The run's chain (#134): "→ then: <workflow>" on the first run, "← from <run>" on the next one, the
// chain's state once the run ended, and what the owner can do with it: Edit / Cancel while the run
// goes (or "+ When it finishes" to add one), Resume / Edit / Drop when it paused. Edit opens the
// ChainPicker (chain-picker.js) in the banner with Save / Cancel. A finished run's chain is read
// from the service (api.runChain) a moment after it ends: the service acts on it then.
// A saved pipeline's run (#135) also shows the pipeline: each stage with its run and status
// (api.pipelineRun, read again when the run's status or chain changes). A chain set up by hand can
// be saved as a pipeline ("Save as pipeline": name, category, description, then Save / Cancel).
const chainUi = { editing: null, picker: null, busy: false, error: '', workflows: null, savingPipe: null, savedPipe: null, pipes: new Map() };
const PIPE_CATEGORIES = [['build', 'Build'], ['plan', 'Plan'], ['monitor', 'Monitor']];

// The pipeline run a run belongs to, read once per run status and chain state.
function pipelineRunOf(r, pipe) {
  const key = JSON.stringify([pipe.id, r.status, r.chain?.state, r.chain?.nextRunId]);
  const got = chainUi.pipes.get(pipe.id);
  if (got?.key === key || typeof api.pipelineRun !== 'function') return got?.info || null;
  chainUi.pipes.set(pipe.id, { key, info: got?.info || null });
  api.pipelineRun(pipe.id).then((info) => { chainUi.pipes.set(pipe.id, { key, info }); renderChainBanner(); }).catch(() => {});
  return got?.info || null;
}

// #368: the run's pause line, while it pauses after the current turn (who or what it waits for, and
// Cancel pause) and once it paused (where, whose turn comes next, when, and Resume, which continues
// there). RunProgress.pauseLabel says it; `r.pause` comes from runs:active and the run's events.
function renderPauseBanner() {
  const r = selectedView().run;
  const box = $('#run-pause-banner');
  const p = r && ((r.status === 'running' && r.pause?.state === 'pausing') || (r.status === 'paused' && r.pause)) ? r.pause : null;
  box.classList.toggle('hidden', !p);
  const key = JSON.stringify([r?.id, p]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  if (!p) { box.innerHTML = ''; return; }
  const action = p.state === 'pausing'
    ? `<button type="button" class="btn sm ghost" data-pause-act="cancel" data-testid="run-cancel-pause" title="${t('run.take_the_pause_back_the_run')}">${t('run.cancel_pause')}</button>`
    : `<button type="button" class="btn sm primary" data-pause-act="resume" data-testid="run-resume" title="${t('run.continue_this_run_where_it_paused')}">${t('run.resume')}</button>`;
  box.innerHTML = `<div class="run-pause-state" data-testid="run-pause-state" data-state="${esc(p.state)}"><span class="run-pause-text">${esc(RunProgress.pauseLabel(p))}</span>${action}</div>`;
}

async function onPauseBannerClick(e) {
  const b = e.target.closest('[data-pause-act]');
  const r = selectedView().run;
  if (!b || !r) return;
  b.disabled = true;
  try {
    if (b.dataset.pauseAct === 'cancel') {
      await api.cancelPauseRun(r.id);
      r.pause = null;
      scheduleRender();
    } else {
      await resumePausedRun(r);
    }
  } catch (err) {
    showToast(b.dataset.pauseAct === 'cancel' ? t('run.could_not_cancel_the_pause') : t('run.could_not_resume_the_run'), errMsg(err));
  } finally {
    b.disabled = false;
  }
}

// Resume of a paused run: where it continues and what each agent's next turn re-reads (#320: a
// prompt cache that expired meanwhile shows the first turn's extra cost, cold_resume_usd), then the
// new run from that point.
async function resumePausedRun(r) {
  let o = null;
  try { o = await api.resumeOptions(r.id); } catch { /* the line without the turns */ }
  const at = o?.paused ? RunProgress.pauseLabel({ state: 'paused', ...o.paused }) : RunProgress.pauseLabel(r.pause);
  const turns = o?.paused?.turns || [];
  const names = { ...(r.display?.agents || {}), ...(r.agentNames || {}) };
  const cont = turns.length ? ` ${SessionCache.continueText(turns, (a) => names[a] || a)}.` : '';
  if (!(await confirmDialog(t('run.resume_the_paused_run'), `${at}. Resume continues there: no finished turn runs again.${cont}`, t('run.resume')))) return;
  const { runId } = await api.resumeRun(r.id);
  showRun(runId, { running: true });
}

function renderChainBanner() {
  const v = selectedView();
  const r = v.run;
  const box = $('#run-chain');
  if (!r) { box.classList.add('hidden'); return; }
  if (r.status !== 'running' && !v.chainLoaded && typeof api.runChain === 'function') {
    v.chainLoaded = true;
    const wait = r.finishedAt && Date.now() - r.finishedAt < 3000 ? 1500 : 0;
    setTimeout(() => api.runChain(r.id).then((c) => { r.chain = c; renderChainBanner(); }).catch(() => {}), wait);
  }
  const c = r.chain;
  const running = r.status === 'running';
  const editing = chainUi.editing === r.id;
  const savingPipe = chainUi.savingPipe === r.id;
  const family = r.parentRun?.run_id || r.childRuns?.length;
  // #410: a live run without a chain shows none ("+ When it finishes…" is on the tab row)
  const show = !!(c?.then || c?.from) || editing || savingPipe || !!family;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const pipe = c ? ChainModel.pipelineOf(c, r.id) : null;
  const pipeRun = pipe?.id ? pipelineRunOf(r, pipe) : null;
  const saved = chainUi.savedPipe?.runId === r.id ? chainUi.savedPipe : null;
  const key = JSON.stringify([r.id, r.status, c, editing, savingPipe, saved, pipeRun, chainUi.busy, chainUi.error, r.parentRun, r.childRuns]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const then = c?.then || null;
  const btn = (act, label, cls = 'ghost') => `<button type="button" class="btn sm ${cls}" data-chain="${act}"${chainUi.busy ? ' disabled' : ''}>${esc(label)}</button>`;
  // a chain set up by hand (not already a pipeline's) can be saved as a pipeline
  const savePipe = then && !pipe && !savingPipe && !saved && typeof api.savePipeline === 'function'
    ? `<button type="button" class="link-btn small" data-chain="save-pipe-open" title="${t('run.save_this_run_s_workflow_and')}">${t('run.save_as_pipeline')}</button>` : '';
  let actions = '';
  let text = '';
  if (editing) {
    actions = `${btn('cancel-edit', 'Cancel')}${btn('save', 'Save', 'primary')}`;
  } else if (savingPipe) {
    actions = `${btn('cancel-pipe', 'Cancel')}${btn('save-pipe', 'Save pipeline', 'primary')}`;
  } else if (running) {
    actions = then ? `${btn('edit', 'Edit')}${btn('clear', 'Cancel chain')}` : '';
    if (then) text = 'Starts only if this run succeeds. Its gates still wait for you.';
  } else if (then && c.state === 'paused') {
    actions = `${btn('drop', 'Drop chain')}${btn('edit', 'Edit')}${btn('resume', 'Resume chain', 'primary')}`;
    text = c.reason || 'The chain paused.';
  } else if (then) {
    text = c.reason || '';
    if (c.nextRunId) actions = `<button type="button" class="link-btn small" data-run-link="${esc(c.nextRunId)}">${t('run.open_the_next_run')}</button>`;
  }
  const badges = c ? ChainModel.chainBadgesHtml(c) : '';
  const names = Object.fromEntries((chainUi.workflows || []).map((w) => [w.file, w.name]));
  const strip = pipeRun ? `<div class="chain-banner-pipe"><span class="muted small">${t('run.pipeline')} <b>${esc(pipeRun.name)}</b>${pipeRun.state === 'paused' ? ` · <span class="warn-text">${t('run.paused')}</span>` : ''}</span>
      ${ChainModel.pipelineStagesHtml(pipeRun, { names, runs: pipeRun.runs, current: pipe.stage })}</div>` : '';
  // what the owner typed survives a redraw (busy, an error)
  const draft = chainUi.pipeDraft?.runId === r.id ? chainUi.pipeDraft : { name: then ? `${r.workflow || 'Run'} → ${ChainModel.thenLabel(then)}` : '', category: 'build', description: '' };
  const pipeForm = savingPipe ? `<div class="chain-banner-edit pipe-save-form">
      <div class="field"><label for="pipe-save-name">${t('run.name')}</label><input type="text" id="pipe-save-name" value="${esc(draft.name)}" spellcheck="false" /></div>
      <div class="field"><label for="pipe-save-category">${t('run.category')}</label>${window.Select.markup('id="pipe-save-category"', PIPE_CATEGORIES, draft.category)}</div>
      <div class="field pipe-save-desc"><label for="pipe-save-description">${t('run.description')}</label><input type="text" id="pipe-save-description" value="${esc(draft.description)}" placeholder="${t('run.what_the_pipeline_does_shown_when')}" /></div>
      <p class="muted small">${t('run.saved_in_the_workspace_s_pipelines')}</p>
    </div>` : '';
  if (saved) text = `Saved as the pipeline "${saved.name}" (${saved.file}).`;
  box.innerHTML = `<div class="chain-banner-head">
      <span class="chain-banner-title">${then || editing ? t('run.when_it_finishes_2') : !c?.from && family && !running ? t('run.linked_runs') : t('run.chain')}</span>${badges}
      ${text ? `<span class="muted small chain-banner-text" title="${esc(text)}">${esc(text)}</span>` : ''}
      <span class="spacer"></span>${savePipe}${actions}
    </div>
    ${strip}
    ${childRunsStrip(r)}
    ${editing ? '<div class="chain-banner-edit" data-chain-picker></div>' : ''}
    ${pipeForm}
    ${chainUi.error ? `<p class="error small">${esc(chainUi.error)}</p>` : ''}`;
  if (savingPipe) box.querySelector('#pipe-save-name').focus({ preventScroll: true });
  if (editing) {
    const source = () => (chainUi.workflows || []).find((w) => w.name === r.workflow || w.file === r.file) || null;
    chainUi.picker = ChainPicker.mount(box.querySelector('[data-chain-picker]'), { workflows: () => chainUi.workflows || [], source, value: then });
  }
}

// A `type: workflow` step's links (#174): the run that started this one, and each child run with its
// item and status (a child's gate waits for the owner on the child's own Run screen).
function childRunsStrip(r) {
  const p = r.parentRun;
  const kids = r.childRuns || [];
  if (!p?.run_id && !kids.length) return '';
  const link = (id, text, tip) => `<button type="button" class="link-btn small" data-run-link="${esc(id)}" title="${esc(tip)}">${esc(text)}</button>`;
  const parent = p?.run_id ? `<span class="muted small">${t('run.child_run_of')}</span> ${link(p.run_id, p.workflow || p.run_id, `Open run ${p.run_id} (step ${p.step_id || '?'})`)}${Number.isInteger(p.index) ? ` <span class="badge">${t('run.item')} ${p.index + 1}</span>` : ''}` : '';
  const cost = childRunsCost(r);
  const children = kids.length ? `<span class="muted small">${t('run.child_runs')}${cost ? ` · ${esc(fmtCost(cost))}` : ''}</span> ${kids.map((k) => {
    const name = k.label || (Number.isInteger(k.index) ? `item ${k.index + 1}` : k.workflow || k.run_id);
    // a resumed parent's children (#175): reused when they had succeeded, else resumed
    const how = k.reused ? `, reused from the previous run` : k.resumed_from ? `, resumes ${k.resumed_from}` : '';
    return k.run_id
      ? `<span class="child-run">${link(k.run_id, name, `Open run ${k.run_id} (${k.workflow || 'workflow'}, step ${k.step_id}${how}${k.cost_usd ? `, ${fmtCost(k.cost_usd)}` : ''})`)} ${StatusPill.statusPill(k.status)}${k.reused ? ` <span class="badge">${t('run.reused')}</span>` : k.resumed_from ? ` <span class="badge">${t('run.resumed')}</span>` : ''}</span>`
      : `<span class="child-run muted small">${esc(name)} ${StatusPill.statusPill(k.status)}</span>`;
  }).join('')}` : '';
  return `<div class="chain-banner-pipe child-runs">${parent}${children}</div>`;
}

// What a run's child runs cost so far (#175): the finished ones, their own children included.
const childRunsCost = (r) => (r?.childRuns || []).reduce((a, c) => a + (+c.cost_usd || 0), 0);

async function onChainBannerClick(e) {
  const link = e.target.closest('[data-run-link]');
  if (link) { showRun(link.dataset.runLink); return; }
  const b = e.target.closest('[data-chain]');
  const r = selectedView().run;
  if (!b || !r) return;
  const act = b.dataset.chain;
  chainUi.error = '';
  if (act === 'edit') {
    try { chainUi.workflows ??= (await api.listWorkflows()).filter((w) => !w.error); } catch (err) { chainUi.error = errMsg(err); }
    chainUi.editing = r.id;
    renderChainBanner();
    return;
  }
  if (act === 'cancel-edit') { chainUi.editing = null; renderChainBanner(); return; }
  if (act === 'save-pipe-open') { chainUi.savingPipe = r.id; chainUi.editing = null; renderChainBanner(); return; }
  if (act === 'cancel-pipe') { chainUi.savingPipe = null; chainUi.pipeDraft = null; renderChainBanner(); return; }
  // the form's values before the banner redraws as busy
  const form = act === 'save-pipe' ? { runId: r.id, name: $('#pipe-save-name').value, category: $('#pipe-save-category').value, description: $('#pipe-save-description').value } : null;
  if (form) chainUi.pipeDraft = form;
  chainUi.busy = true;
  renderChainBanner();
  try {
    if (act === 'save-pipe') {
      const out = await api.savePipeline(r.id, form.name, form.description, form.category);
      chainUi.savedPipe = { runId: r.id, ...out };
      chainUi.savingPipe = null;
      chainUi.pipeDraft = null;
    } else if (act === 'save' || act === 'clear') {
      const out = await api.setRunChain(r.id, act === 'save' ? chainUi.picker?.value() || null : null);
      r.chain = { ...(r.chain || {}), ...(out?.chain || {}), from: r.chain?.from || null };
      chainUi.editing = null;
    } else if (act === 'resume') {
      r.chain = await api.resumeChain(r.id);
    } else if (act === 'drop') {
      const out = await api.dropChain(r.id);
      r.chain = { ...(r.chain || {}), ...(out?.chain || {}) };
    }
  } catch (err) {
    chainUi.error = errMsg(err);
  } finally {
    chainUi.busy = false;
    renderChainBanner();
  }
}

// The Run screen's steps: only those that ran, one collapsible section per workflow group (the
// current step's group open), a step in no group on its own; "Show all steps" adds the others.
function renderSteps() {
  const v = selectedView();
  const all = [...v.steps.values()];
  const shown = v.allSteps ? all : all.filter((s) => s.visits > 0);
  const groupOf = new Map(v.groups.flatMap((g) => g.steps.map((id) => [id, g.name])));
  const current = v.trail?.steps.at(-1)?.step || all.find((s) => s.status === 'running' || s.status === 'waiting')?.id;
  const logs = stepLogs(v);
  const na = stepsThatDontApply(v, all);
  // #465: a deterministic step that wrote a log follows it live, as a session does (read-only)
  const logButtons = (s) => {
    const log = logs.get(s.id);
    if (s.agent || !log?.path) return '';
    const base = log.base ? `<button type="button" class="btn sm ghost" data-term="log" data-log="${esc(log.base)}" title="${esc(t('run.follow_the_base_check_log'))}">${t('run.base_log')}</button>` : '';
    return `<div class="step-term" data-log="${esc(log.path)}">${termButtons('log', `${log.command ? `$ ${log.command}\n` : ''}${log.path}`)}${base}<span class="muted small" data-term-msg></span></div>`;
  };
  // #735: a step (or a fan-out agent of it, the code review's UI reviewer) that can't run with the
  // run's inputs is dimmed and says why
  const naLine = (s) => {
    const own = na.get(s.id);
    const agents = [...na.keys()].filter((id) => id !== s.id && !v.steps.has(id) && na.get(id).step === s.id);
    if (own && !s.visits) return `<br><span class="muted small" data-testid="run-step-doesnt-apply">${esc(t(own.reason))}</span>`;
    return agents.map((id) => `<br><span class="muted small" data-testid="run-agent-doesnt-apply">${esc(agentLabel(id, v.run?.agentNames))}: ${esc(t(na.get(id).reason))}</span>`).join('');
  };
  const item = (s) => `
    <li class="${s.status}${na.has(s.id) && !s.visits ? ' doesnt-apply' : ''}" data-testid="run-step-card" data-step="${esc(s.id)}"${na.has(s.id) && !s.visits ? ' data-doesnt-apply="1"' : ''}>
      <span class="dot"></span>
      <span><span title="${esc(s.id)}">${esc(agentLabel(s.id, v.run?.stepNames))}</span>${naLine(s)}<br><span class="kind"${s.agent ? ` title="${esc(s.agent)}"` : ''}>${s.type === 'human_approval' ? t('run.human_approval') : s.type === 'screenshots' ? t('run.screenshots_no_agent') : s.type === 'suite' ? t('run.test_suite_no_agent') : s.type === 'test_ids' ? t('run.test_id_check_no_agent') : s.type === 'check' ? t('run.rule_checks_no_agent') : s.type === 'release_version' ? t('run.release_version_no_agent') : s.type === 'project_map' ? t('run.project_map_no_agent') :s.type === 'workflow' ? t('run.child_workflow_runs') : esc(agentLabel(s.agent, v.run?.agentNames))}</span></span>
      <span class="visits">${s.visits ? '×' + s.visits : ''}</span>
      ${logButtons(s)}
    </li>`;
  // in the workflow's step order: a group where its first shown step is
  const sections = [];
  const byGroup = new Map();
  for (const s of shown) {
    const name = groupOf.get(s.id);
    if (name == null) { sections.push({ steps: [s] }); continue; }
    if (!byGroup.has(name)) { byGroup.set(name, { name, steps: [] }); sections.push(byGroup.get(name)); }
    byGroup.get(name).steps.push(s);
  }
  const html = sections.map((sec) => {
    if (sec.name == null) return `<ol class="steps">${item(sec.steps[0])}</ol>`;
    const open = v.openGroups.get(sec.name) ?? sec.steps.some((s) => s.id === current);
    const st = sec.steps.some((s) => s.status === 'running') ? 'running' : sec.steps.some((s) => s.status === 'waiting') ? 'waiting' : sec.steps.some((s) => s.visits) ? 'done' : 'pending';
    return `<details class="step-group ${st}" data-group="${esc(sec.name)}" ${open ? 'open' : ''}>
      <summary><span class="dot"></span><b>${esc(RunProgress.groupName(sec.name, t))}</b><span class="muted small">${sec.steps.filter((s) => s.visits).length}/${sec.steps.length}</span></summary>
      <ol class="steps">${sec.steps.map(item).join('')}</ol>
    </details>`;
  }).join('');
  const hidden = all.length - all.filter((s) => s.visits > 0).length;
  const toggle = hidden ? `<button type="button" class="link-btn small" data-all-steps>${v.allSteps ? t('run.hide_the_steps_that_did_not') : t('run.show_all_steps_hidden_not_run', { hidden })}</button>` : '';
  const box = $('#steps');
  const out = (html || `<p class="muted small">${t('run.no_step_has_run_yet')}</p>`) + toggle;
  if (box.dataset.html === out) return;
  box.dataset.html = out;
  box.innerHTML = out;
  box.querySelectorAll('.step-group > summary').forEach((sum) => (sum.onclick = () => {
    v.openGroups.set(sum.parentElement.dataset.group, !sum.parentElement.open);
  }));
  const btn = box.querySelector('[data-all-steps]');
  if (btn) btn.onclick = () => { v.allSteps = !v.allSteps; renderSteps(); };
  box.querySelectorAll('.step-term [data-term]').forEach((b) => (b.onclick = async () => {
    const wrap = b.closest('.step-term');
    const card = b.closest('[data-step]');
    const label = agentLabel(card.dataset.step, v.run?.stepNames);
    const msg = await termAction(b, { sessionId: b.dataset.log || wrap.dataset.log, runId: v.run?.id || state.run?.id, label: b.dataset.log ? `${label} base` : label });
    const line = wrap.querySelector('[data-term-msg]');
    line.textContent = msg.text;
    line.classList.toggle('error', !!msg.error);
  }));
}

// #735: the steps and agents the run's inputs rule out (window.RunPlan, packages/shared/run-plan.js):
// id → { reason, step } (`step`: the step whose agent_when names an agent; the step itself otherwise)
function stepsThatDontApply(v, all) {
  const r = v.run || state.run;
  if (!r || typeof window.RunPlan?.stepsThatDontApply !== 'function') return new Map();
  const wf = (state.workflows || []).find((w) => w.file === r.file || w.name === r.workflow) || null;
  const steps = Array.isArray(wf?.steps) ? wf.steps : all.map((s) => ({ id: s.id }));
  const owner = new Map(steps.flatMap((s) => window.RunPlan.agentsOf(s).map((a) => [a, s.id])));
  const list = window.RunPlan.stepsThatDontApply({ inputs: wf?.inputs || {}, steps }, r.inputs || {});
  return new Map(list.map((x) => [x.id, { reason: x.reason, step: owner.get(x.id) || x.id }]));
}

// #465: each deterministic step's log for its terminal buttons: the latest round's (its step.log, else
// the log its output names) and the base check's of that round (step.log with `base`), relative to the
// run folder (packages/shared/run-log-path.js)
function stepLogs(v) {
  const rel = window.runLogPath;
  const out = new Map();
  for (const ev of v.events || []) {
    if (!ev.step_id) continue;
    if (ev.type === 'step.started') out.delete(ev.step_id);
    else if (ev.type === 'step.log' && rel(ev.path)) {
      const cur = out.get(ev.step_id) || {};
      out.set(ev.step_id, ev.base ? { ...cur, base: rel(ev.path) } : { ...cur, path: rel(ev.path), command: ev.command || null });
    } else if (ev.type === 'step.finished' && rel(ev.output?.log) && !out.get(ev.step_id)?.path) {
      out.set(ev.step_id, { ...out.get(ev.step_id), path: rel(ev.output.log), command: ev.output.command || null });
    }
  }
  return out;
}

function renderSessions() {
  const box = $('#sessions');
  if (!state.sessions.size) return;
  const list = [...state.sessions.values()];
  // #233: the part of a cost estimated from attempts stopped before their result, or not recorded
  const estimated = list.reduce((a, s) => a + (Number(s.estimated_cost_usd) || 0), 0);
  const notRecorded = (ss) => ss.some((s) => s.cost_not_recorded || s.costNotRecorded);
  const marks = costMarks; // run-list.js: the badges shared with the run lists and Analytics
  box.innerHTML = list.map((s) => {
    const isOrch = s.id === 'orchestrator';
    const t = s.tokens || {};
    return `
    <div class="session-card ${isOrch ? '' : 'child'} ${state.selected === s.id ? 'selected' : ''}" data-id="${esc(s.id)}" data-agent="${esc(s.agent)}" data-testid="run-session-card">
      <div class="sc-head">
        <span class="name" title="${esc(s.agent)}">${esc(agentLabel(s.agent, selectedView()?.run?.agentNames))}</span>
        <span class="id">${esc(s.id)}</span>
        <span class="status st-${esc(s.status)}" data-status="${esc(s.status)}"><span class="status-dot"></span>${esc(StatusPill.statusLabel(s.status))}</span>
      </div>
      <div class="badges">
        <span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span>
        <span class="badge">${esc(s.model)}</span>${s.account ? `<span class="badge" data-testid="run-session-account">${esc(s.account)}</span>` : ''}
        ${isOrch ? '' : `<span class="badge">${s.turns || 0} ${I18n.t('run.turn_s')}</span>`}
      </div>
      <div class="metrics">
        <div class="metric"><label>${I18n.t('run.open')}</label><b>${fmtDur(liveDuration(s))}</b></div>
        ${isOrch ? `
        <div class="metric"><label>${I18n.t('run.steps')}</label><b>${[...state.steps.values()].reduce((a, x) => a + x.visits, 0)}</b></div>
        <div class="metric"><label>${I18n.t('run.child_sessions')}</label><b>${list.length - 1}</b></div>
        <div class="metric"><label>${I18n.t('run.total_cost')}</label><b>${fmtCost(totals().cost)}${marks(estimated, notRecorded(list))}</b></div>${state.run?.childRuns?.length ? `
        <div class="metric" title="${I18n.t('run.what_its_child_runs_cost_their')}"><label>${I18n.t('run.child_runs_cost')}</label><b>${fmtCost(childRunsCost(state.run))}</b></div>` : ''}` : `
        <div class="metric"><label>${I18n.t('run.active')}</label><b>${fmtDur(s.active_ms)}</b></div>
        <div class="metric"><label>${I18n.t('run.in_out')}</label><b>${fmtNum((t.input || 0) + (t.cache_read || 0))} / ${fmtNum(t.output)}</b></div>
        <div class="metric"><label>${I18n.t('run.cost')}</label><b data-testid="session-cost">${s.cost_estimate?.source === 'unknown' ? '—' : fmtCost(s.cost_usd)}${marks(Number(s.estimated_cost_usd) || 0, notRecorded([s]))}${costEstimateNote(s.cost_estimate)}</b></div>
        ${nextTurnMetric(s)}`}
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('.session-card').forEach((el) => (el.onclick = () => {
    state.selected = el.dataset.id;
    if (state.tab !== 'detail') switchTab('detail'); else scheduleRender();
  }));
}

// #320: how the session's next turn starts (session-cache.js), like the run lists' Next turn column
function nextTurnMetric(s) {
  const t = SessionCache.currentTurn(s);
  return `<div class="metric next-turn"${t ? ` data-next-turn="${esc(t.kind)}"` : ''} data-testid="session-next-turn" title="${esc(SessionCache.turnTitle(t))}"><label>${I18n.t('run.next_turn')}</label><b>${esc(SessionCache.turnText(t))}</b></div>`;
}

function detailsBlock(key, cls, label, body) {
  const open = state.openDetails.has(key);
  return `<details class="item ${cls}" data-key="${esc(key)}" ${open ? 'open' : ''}>
    <summary><div class="label">${label}</div></summary><pre>${esc(body)}</pre></details>`;
}

// a sub-agent call (Claude's Agent/Task tool): its type and description in the label
function subagentLabel(item) {
  const input = item.input;
  if (!['Agent', 'Task'].includes(item.name) || !input || typeof input !== 'object') return '';
  return ` · sub-agent ${esc(input.subagent_type || 'general-purpose')}${input.description ? `: ${esc(input.description)}` : ''}`;
}

function renderItem(sid, turn, item, i) {
  const key = `${sid}:${turn}:${i}`;
  switch (item.kind) {
    case 'thinking': return detailsBlock(key, 'thinking', 'thinking', item.text);
    case 'text': return `<div class="item text"><div class="label">${t('run.output')}</div><pre>${esc(item.text)}</pre></div>`;
    case 'tool_call': return `<div class="item tool_call"><div class="label">${t('run.tool')} ${esc(item.name)}${subagentLabel(item)}</div><pre>${esc(typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2))}</pre></div>`;
    case 'tool_result': return detailsBlock(key, 'tool_result', `result${item.is_error ? ' (error)' : ''}`, item.output);
    case 'stderr': return `<div class="item stderr"><div class="label">${t('run.stderr')}</div><pre>${esc(item.text)}</pre></div>`;
    case 'spawn': return `<div class="item spawn"><div class="label">${t('run.process')}</div><pre>${esc(item.command)} ${esc(item.args.join(' '))}\ncwd: ${esc(item.cwd)}</pre></div>`; // i18n-ignore
    default: return `<div class="item raw"><div class="label">${t('run.event')}</div><pre>${esc(item.text || JSON.stringify(item.event))}</pre></div>`;
  }
}

function renderDetail() {
  const box = $('#tab-detail');
  const s = state.sessions.get(state.selected);
  if (!s) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;

  let html = `
    <div class="detail-head">
      <h3 title="${esc(s.agent)}">${esc(agentLabel(s.agent, selectedView()?.run?.agentNames))} <span class="muted small mono">${esc(s.agent)}</span> <span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span> <span class="badge">${esc(s.model)}</span></h3>
      <div class="detail-actions">
        ${termButtons('live', s.id === 'orchestrator' ? 'Follow the orchestrator log (steps, transitions, sessions, approvals) in a terminal' : 'Follow this session live in a terminal')}
        ${s.id === 'orchestrator' ? '' : termButtons('cli', '', cliBlocked(s))}
        ${s.id === 'orchestrator' ? `<button class="btn sm ghost sup-btn" data-sup><span class="sup-mark">◆</span> ${t('run.ask_the_supervisor')}</button>` : ''}
        <span class="muted small" data-term-msg></span>
      </div>
      <dl class="kv">
        <dt>${t('run.session')}</dt><dd>${esc(s.id)}</dd>
        <dt>${t('run.provider_session')}</dt><dd>${esc(s.provider_session_id || '—')}</dd>
        <dt>${t('run.status')}</dt><dd data-status="${esc(s.status)}">${esc(StatusPill.statusLabel(s.status))}</dd>
        <dt>${t('run.opened_at')}</dt><dd>${esc(timeOf(s.opened_at))}${s.closed_at ? ' → ' + esc(timeOf(s.closed_at)) : ''}</dd>
        <dt>${t('run.duration_active_idle')}</dt><dd>${fmtDur(liveDuration(s))} / ${fmtDur(s.active_ms)} / ${fmtDur(s.idle_ms)}</dd>
        <dt>${t('run.tokens')}</dt><dd>${t('run.in_input_cache_r_w_cache', { input: fmtNum(s.tokens?.input), cache_read: fmtNum(s.tokens?.cache_read), cache_write: fmtNum(s.tokens?.cache_write), output: fmtNum(s.tokens?.output) })} ${fmtNum(s.tokens?.reasoning)}</dd>
        <dt>${t('run.cost')}</dt><dd>${fmtCost(s.cost_usd)}</dd>
      </dl>
    </div>`;

  if (s.id === 'orchestrator') {
    html += `<div class="orch-log">${state.orchLog.map((l) =>
      `<div class="line ${esc(l.level)}"><span class="ts">${esc(timeOf(l.ts))}</span><span>${esc(l.text)}</span></div>`).join('')}</div>`;
  } else {
    html += [...s.turnLog.values()].map((t) => `
      <div class="turn">
        <div class="turn-head">
          <span class="t">${I18n.t('run.turn')} ${t.n}</span><span class="muted">${esc(t.stepId || '')}</span>
          <span class="meta">${t.result ? I18n.t('run.duration_in_value_out_output_cost', { duration: fmtDur(t.result.duration), value: fmtNum((t.result.usage?.input || 0) + (t.result.usage?.cache_read || 0)), output: fmtNum(t.result.usage?.output), cost: fmtCost(t.result.cost) }) : I18n.t('run.in_progress')}</span>
        </div>
        <div class="turn-body">
          ${t.prompt != null ? detailsBlock(`${s.id}:${t.n}:prompt`, 'prompt', 'prompt sent', t.prompt) : ''}
          ${t.items.map((it, i) => renderItem(s.id, t.n, it, i)).join('')}
          ${t.result ? `<div class="usage-row">
              <span>${I18n.t('run.input')} ${fmtNum(t.result.usage?.input)}</span><span>${I18n.t('run.cache_read')} ${fmtNum(t.result.usage?.cache_read)}</span>
              <span>${I18n.t('run.cache_write')} ${fmtNum(t.result.usage?.cache_write)}</span><span>${I18n.t('run.output')} ${fmtNum(t.result.usage?.output)}</span>
              <span>${I18n.t('run.reasoning')} ${fmtNum(t.result.usage?.reasoning)}</span></div>` : ''}
        </div>
      </div>`).join('') || `<p class="empty muted">${t('run.waiting_for_the_first_turn')}</p>`;
  }

  box.innerHTML = html;
  box.querySelector('[data-sup]')?.addEventListener('click', () => openSupervisorForCurrent());
  box.querySelectorAll('[data-term]').forEach((b) => (b.onclick = async () => {
    const msg = box.querySelector('[data-term-msg]');
    const r = await termAction(b, { sessionId: s.id, runId: state.run?.id, label: s.agent });
    if (msg) { msg.textContent = r.text; msg.classList.toggle('error', r.error); }
  }));
  if (atBottom) box.scrollTop = box.scrollHeight;
}

// Why "Open in CLI" is not available for a session right now ('' = available).
function cliBlocked(s) {
  if (s.provider === 'mock') return 'Simulated sessions have no CLI conversation.';
  if (!s.provider_session_id) return 'Available after the first turn finishes.';
  if (s.status === 'active' || s.status === 'retrying') return 'The agent is in the middle of a turn.';
  return '';
}

function renderEvents() {
  const box = $('#tab-events');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = state.events.slice(-400).map((ev) => {
    const { seq, ts, type, run_id, ...rest } = ev;
    return `<div class="ev" data-testid="run-event"><div class="ev-head"><span class="muted">#${seq}</span><span class="muted">${esc(timeOf(ts))}</span><span class="ev-type">${esc(type)}</span></div>
      <pre>${esc(JSON.stringify(rest, null, 1)).slice(0, 2000)}</pre></div>`;
  }).join('');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

registerView({
  id: 'run',
  markup: () => `
      <section id="view-run" class="view hidden">
        <div class="run-tab-row" data-testid="run-tab-row">
          <div class="tabs" role="tablist" aria-label="${t('run.run_view')}">
            <button id="run-mode-chat" class="tab" type="button" role="tab" aria-selected="false" title="${t('run.follow_this_run_as_a_chat')}">${t('run.chat')}</button>
            <button class="tab active" type="button" role="tab" aria-selected="true">${t('run.details')}</button>
            <button id="run-mode-3d" class="tab" type="button" role="tab" aria-selected="false" data-run3d="run" data-testid="run-3d" title="${t('run.show_this_run_in_3d')}">3D</button>
          </div>
          <span id="run-screen-status" class="pill pill-idle" data-testid="run-screen-status" data-status="idle">${t('run.idle')}</span>
          <span id="run-screen-id" class="muted mono small" data-testid="run-screen-id"></span>
          <div id="run-actions" class="run-actions"></div>
          <!-- #368: the run ends paused once its agents finish their current turn (run-controls.js pauseRun); #391 the owner's words: "step" -->
          <button id="btn-pause" class="btn ghost sm hidden" type="button" data-testid="run-pause" title="${t('run.the_agents_finish_their_current_turn')}">${t('run.pause_after_current_step')}</button>
          <button id="btn-stop" class="btn danger sm hidden" type="button" data-testid="run-stop">${t('run.stop')}</button>
        </div>
        <div id="run-fail-banner" class="fail-banner hidden"></div>
        <div id="run-pause-banner" class="run-pause-banner hidden" aria-live="polite"></div>
        <div id="run-chain" class="chain-banner hidden" aria-live="polite" data-testid="run-chain-banner"></div>
        <div id="run-gates" class="run-gates hidden" aria-live="polite"></div>
        <div id="run-pr-monitor" class="run-pr-monitor hidden" aria-live="polite"></div>
        <div class="run-layout">
          <aside class="panel config" data-testid="run-side-column">
            <section>
              <h2>${t('run.workflow')}</h2>
              <div id="run-summary" class="run-summary"><p class="muted small">${t('run.no_workflow_started')}</p></div>
            </section>
            <section>
              <h2>${t('run.steps_2')}</h2>
              <div id="steps" class="step-groups" data-testid="run-steps"></div>
            </section>
          </aside>

          <section class="panel sessions-panel">
            <h2>${t('run.sessions')}</h2>
            <div id="sessions" class="sessions">
              <p class="empty muted">${t('run.no_sessions_yet_start_a_workflow')}</p>
            </div>
          </section>

          <section class="panel detail-panel">
            <div class="tabs" role="tablist" aria-label="${t('run.run_details')}">
              <button class="tab active" type="button" role="tab" aria-selected="true" data-tab="artifacts" data-testid="run-tab-artifacts" title="${t('run.the_files_this_run_produced')}">${t('run.artifacts')} <span id="tab-artifacts-count" class="tab-count hidden"></span></button>
              <button class="tab" type="button" role="tab" aria-selected="false" data-tab="detail">${t('run.session_2')}</button>
              <button class="tab" type="button" role="tab" aria-selected="false" data-tab="events">${t('run.events')}</button>
            </div>
            <div id="tab-detail" class="tab-body hidden">
              <p class="empty muted">${t('run.select_a_session_to_see_prompts')}</p>
            </div>
            <div id="tab-events" class="tab-body hidden" data-testid="run-events"></div>
            <div id="tab-artifacts" class="tab-body"></div>
          </section>
        </div>
      </section>`,
  mount() {
    $('#run-gates').onclick = onRunGateClick;
    $('#run-pause-banner').onclick = onPauseBannerClick;
    $('#run-chain').onclick = onChainBannerClick;
    // #410: the tab row's "+ When it finishes…" opens the same chain editor; #412 Stop and Pause
    $('#run-actions').onclick = onChainBannerClick;
    $('#btn-stop').onclick = stopRun;
    $('#btn-pause').onclick = pauseRun;
    document.querySelectorAll('.tab[data-tab]').forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
    $('#tab-detail').addEventListener('toggle', (e) => {
      const key = e.target.dataset?.key;
      if (!key) return;
      e.target.open ? state.openDetails.add(key) : state.openDetails.delete(key);
    }, true);
  },
  show() {
    scheduleRender();
  },
});
