/* global api */
// Run screen (Run Details): the run shown in the top bar, its failure banner, its chain banner (#134:
// renderChainBanner), the gates it waits at
// (gate cards: renderRunGates, onRunGateClick; what a gate offers is gate-panel.js), its summary
// (inputs, supervisor, watch, resume, the run that resumed it: #384, Save to issue, Review changes: the diff viewer, #118), its
// steps by group, its sessions and the Session / Events / Artifacts tabs. No sidebar entry of its own: the Run item and the runs menu
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
  box.classList.toggle('hidden', !gates.length);
  const key = `${gates.map((g) => `${g.run_id}:${g.approval_id}`).join('|')}:${runLabel(v.run)}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = gates.map((g) => {
    // the choices, then "Interact with Oracle" at the end of the row (#183)
    const buttons = (g.choices
      ? gateChoices(g).map((c, i) => `<button type="button" class="btn sm ${i === 0 ? 'primary' : 'ghost'}" data-choice="${esc(c.id)}"${c.intent ? ` data-intent="${esc(c.intent)}" title="${esc(c.title)}"` : ''}${c.feedback_required ? ' data-needs-text="1"' : ''} data-testid="run-gate-choice">${esc(c.label)}</button>`).join('')
      : `<button type="button" class="btn sm ghost" data-testid="run-gate-choice" data-answer="false">${esc(g.reject?.label || 'Reject')}</button><button type="button" class="btn sm primary" data-testid="run-gate-choice" data-answer="true">${esc(g.approve?.label || 'Approve')}</button>`)
      + (window.GateOracle?.gateOracleButtonHtml(g) || '');
    const field = g.feedback ? `<label class="duo-ask-label">${esc(g.feedback.label || 'Instructions (optional)')}</label>
      <textarea class="duo-ask-text run-gate-feedback" rows="3" placeholder="${esc(g.feedback.placeholder || '')}"></textarea>` : '';
    // a report (#290: the release summary) leads, as Markdown, above the rest of the message
    const parts = typeof gateReportParts === 'function' ? gateReportParts(g) : { reportHtml: '', message: g.message || '' };
    const message = `${parts.reportHtml}<pre class="run-gate-message" data-testid="run-gate-message">${esc(parts.message)}</pre>`;
    const main = `<div class="run-gate-head"><b>Approval required</b><span class="muted small mono">${esc(`${v.run ? `${runLabel(v.run)} · ` : ''}step: ${g.step_id}`)}</span></div>
      ${gateCardHtml(g.run_id, g, message) || message}${gateToolsHtml(g)}${field}<div class="row gate-choices run-gate-actions">${buttons}</div>${gateButtonsHelpHtml(g)}`;
    const side = gateSideHtml(g);
    const rec = g.brief?.recommendation?.answer;
    return `<div class="run-gate${side ? ' run-gate-wide' : ''}" data-testid="run-gate" data-approval="${esc(g.approval_id)}" data-run="${esc(g.run_id)}"${rec ? ` data-recommend="${esc(rec)}"` : ''}>${side ? `<div class="run-gate-main">${main}</div>${side}` : main}</div>`;
  }).join('');
  mountGateSides(box);
  paintGateApps();
}

// A click on a gate card's button answers that gate (true/false or a choice id) with the run's id,
// so it works for any run in progress; the card goes away with approval.resolved. A choice that
// needs the feedback text (feedback_required) is not sent without one.
function onRunGateClick(e) {
  const tool = e.target.closest('[data-gate-tool]');
  if (tool) { onGateTool(e, tool.closest('.run-gate')?.dataset.run); return; }
  const b = e.target.closest('button[data-answer], button[data-choice]');
  const card = b?.closest('.run-gate');
  if (!card) return;
  const answer = b.dataset.choice !== undefined ? b.dataset.choice : b.dataset.answer === 'true';
  const text = card.querySelector('.run-gate-feedback');
  if (b.dataset.needsText && !text?.value.trim()) { showToast('Write your request first', `"${b.textContent}" sends the text to the agent.`); text?.focus({ preventScroll: true }); return; }
  const buttons = card.querySelectorAll('button');
  buttons.forEach((x) => (x.disabled = true));
  const send = () => PasteImage.settle(text)
    .then(() => {
      // intent: "Accept and save to issue #n" (#125); images pasted into the feedback (#130)
      const images = PasteImage.attachments(text);
      const extra = images.length ? [b.dataset.intent || null, images] : b.dataset.intent ? [b.dataset.intent] : [];
      return api.resolveApproval(card.dataset.approval, answer, text?.value || '', card.dataset.run, ...extra);
    })
    .then((ok) => { if (ok === false) { buttons.forEach((x) => (x.disabled = false)); showToast('The gate did not accept the answer', 'It needs a text, or it was already answered.'); } })
    .catch((err) => { buttons.forEach((x) => (x.disabled = false)); showToast('Could not answer the gate', errMsg(err)); });
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
  document.querySelectorAll('.tab[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
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
  renderRunBanner();
  renderPauseBanner();
  renderChainBanner();
  renderRunGates();
  renderRunSummary();
  renderSteps();
  renderSessions();
  // the tab's count follows the selected run even while another tab shows
  runArtifactsPanel()?.setRun(state.runId);
  if (state.tab === 'detail') renderDetail();
  else if (state.tab === 'events') renderEvents();
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
// class on hover. '' for a run tested green or without a suite.
function testedPillHtml(r) {
  if (r.tested !== 'not green') return '';
  const fails = (r.testedFailures || []).map((f) => `${f.test}${f.file ? ` (${f.file})` : ''}${f.class ? `: ${f.class}` : ''}`);
  const title = `The run reached the build without a green suite.${fails.length ? `\n${fails.join('\n')}` : ''}`;
  return ` <span class="badge warn" data-testid="run-tested-pill" title="${esc(title)}">Not tested green</span>`;
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
    const scope = sel.mode === 'all' ? 'Whole suite' : listed ? 'Listed tests' : out.affected && out.scope === 'full' ? 'Affected tests, then the whole suite' : 'Affected tests only';
    const reasons = Object.entries(sel.reasons || {});
    const more = reasons.length - SUITE_REASONS_SHOWN;
    const list = reasons.length
      ? `<ul>${reasons.slice(0, SUITE_REASONS_SHOWN).map(([f, why]) => `<li><span class="mono" title="${esc(f)}">${esc(f)}</span>: ${esc(why)}</li>`).join('')}${more > 0 ? `<li class="muted">and ${more} more</li>` : ''}</ul>`
      : '';
    const logBtn = (log, label, testid) => (log ? `<button type="button" class="link-btn small" data-testid="${testid}" data-suite-log="${esc(log)}" title="${esc(log)}">${label}</button>` : '');
    const affectedLog = out.affected ? out.affected.log : out.scope === 'files' ? out.log : '';
    return `<div class="run-suite-card" data-testid="run-suite-card">
      <div><b title="${esc(stepId)}">${esc(agentLabel(stepId, stepNames))}</b> <span class="badge" data-testid="run-suite-scope" title="${esc(sel.why || '')}">${esc(scope)}</span>${out.round ? ` <span class="muted small">round ${esc(out.round)}</span>` : ''}</div>
      <div class="small run-suite-selection" data-testid="run-suite-selection">${list}${sel.why ? `<div class="muted">${esc(sel.why)}</div>` : ''}</div>
      <div class="row">${logBtn(affectedLog, listed ? 'Listed tests\' log' : 'Affected tests\' log', 'run-suite-affected-log')}${out.affected && out.scope === 'full' ? logBtn(out.log, 'Whole suite\'s log', 'run-suite-full-log') : ''}</div>
    </div>`;
  }).join('');
}

// Opens a log of the run (a path relative to its folder); a run recorded without its folder opens the folder.
function openRunLog(runId, rel) {
  const runDir = state.runs.get(runId)?.events?.find((e) => e.type === 'workflow.started')?.run_dir || '';
  const opened = runDir ? api.openPath(`${runDir.replace(/[\\/]+$/, '')}/${rel}`) : api.openRunDir(runId);
  Promise.resolve(opened).catch((e) => showToast('Could not open the log', errMsg(e)));
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
  return `<div class="small run-scratch" title="A scratch copy of the workspace for the checks of this run's agents (simulated runs, screenshots): not artifacts, removed once the run ends. ${esc(s.dir)}">`
    + `Scratch workspace (${esc(s.files)} file${s.files === 1 ? '' : 's'}, ${esc(fmtSize(s.bytes))}) <button class="btn sm ghost" id="btn-run-scratch">Open folder</button></div>`;
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
  const all = Object.entries(r.inputs || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length));
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
    <div class="small muted">${esc(r.workflow || '')}${r.version ? ` v${esc(r.version)}` : ''}${selectedView().past ? ' · <span title="Opened from its recorded events: nothing here can change it">read-only</span>' : ''}</div>
    ${r.project ? `<div class="small">Project: <b>${esc(r.project)}</b></div>` : ''}
    ${(r.issueSaves || []).map((s) => `<div class="small" title="The accepted document was saved to the issue (Save to issue, Write & Review)">Saved to issue: <a href="${esc(s.commentUrl || s.url)}" target="_blank" rel="noopener">#${esc(s.number)}</a> · ${s.mode === 'comment' ? 'as a comment' : 'description replaced'} · ${esc(new Date(s.at).toLocaleString('en-US'))}</div>`).join('')}
    ${r.gateWaitMs ? `<div class="small" title="Time the run waited for your answers at its human gates: no agent works (or costs) meanwhile">Waiting for you at gates: <b>${esc(fmtDur(r.gateWaitMs))}</b></div>` : ''}
    ${testsPlanHtml(r.testsPlan)}
    ${suiteCardsHtml(r.id, r.stepNames)}
    ${scratchHtml(r.id)}
    ${pills ? `<div class="run-input-pills">${pills}</div>` : ''}
    <dl class="kv run-inputs">${inputs.map(([k, v]) => `<dt title="${esc(k)}">${esc(k)}</dt>${inputValueCell(v)}`).join('')}</dl>
    ${inputImagesHtml()}
    ${window.gateScenariosHtml ? window.gateScenariosHtml(r.id) : ''}
    <div class="row">
      <button class="btn sm ghost sup-btn" id="btn-run-sup" title="Ask the AI supervisor to explain this run and suggest how to continue"><span class="sup-mark">◆</span> Ask the supervisor</button>
      ${r.status === 'running' ? `<button class="btn sm ghost sup-btn" id="btn-run-watch" title="${WATCH_TITLE}"><span class="sup-mark">◆</span> Watch</button>` : ''}
      ${canResume(r) ? '<button class="btn sm ghost" id="btn-run-resume" title="Start a new run from a step of this one, keeping the previous outputs (no supervisor call)">Resume from step…</button>' : ''}
      ${hasChanges(r.id) ? '<button class="btn sm ghost" id="btn-run-diff" title="The files this run changed on its branch, file by file, split or unified">Review changes</button>' : ''}
      ${saveIssue ? `<button class="btn sm ghost" id="btn-run-save-issue" title="Save the accepted document to its issue (preview first, then confirm)">Save to issue #${esc(saveIssue.number)}…</button>` : ''}
      <button class="btn sm ghost" id="btn-run-analytics" title="Its timeline, cost and tokens per agent, compared with its workflow's runs (Analytics › Run, #228)">Open in Analytics</button>
      ${replayMapHtml(r)}
    </div>`;
  // rendered on every event: rebuilt only when it changes, so a hover popover over an input stays open
  const box = $('#run-summary');
  if (box._html === html || box.querySelector('.run-title-input') === document.activeElement) return;
  box._html = html;
  box.innerHTML = html;
  mountInputImages(box);
  // the test writer's E2E scenarios (#143): local-hero has no merge approval to show them at
  if (window.mountGateScenarios) window.mountGateScenarios(box);
  $('#btn-run-sup').onclick = () => openSupervisorForCurrent();
  if ($('#btn-run-watch')) $('#btn-run-watch').onclick = () => openSupervisorForCurrent({ watch: true });
  if ($('#btn-run-resume')) $('#btn-run-resume').onclick = () => openResumeDialog(r.id);
  box.querySelectorAll('[data-testid="run-resumed-link"]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); showRun(a.dataset.run); }));
  box.querySelectorAll('[data-suite-log]').forEach((b) => (b.onclick = () => openRunLog(r.id, b.dataset.suiteLog)));
  if ($('#btn-run-scratch')) $('#btn-run-scratch').onclick = () => api.openPath(scratchOfRun.get(r.id)?.info?.dir).catch((e) => showToast('Could not open the folder', errMsg(e)));
  if ($('#btn-run-diff')) $('#btn-run-diff').onclick = () => DiffViewer.open({ runId: r.id, title: r.title || r.workflow || '' });
  $('#btn-run-analytics').onclick = () => window.openAnalytics?.({ tab: 'run', runId: r.id });
  mountReplayMap(r);
  if ($('#btn-run-save-issue')) {
    $('#btn-run-save-issue').onclick = () => window.openDuoSaveToIssue({ runId: r.id, issue: saveIssue, mock: !!r.mock, docSkill: r.inputs?.document_skill || '' });
  }

  // Replay on the map (#374): a finished run of a project plays its agents' files over the city
  function replayMapHtml(run) {
    if (!run.projectId || run.status === 'running' || !window.ProjectCityAgents) return '';
    return '<button class="btn sm ghost" id="btn-run-replay-map" data-testid="run-replay-map" title="Play the files this run\'s agents read and changed over its project\'s city (#374)">Replay on the map</button>';
  }

  function mountReplayMap(run) {
    if ($('#btn-run-replay-map')) $('#btn-run-replay-map').onclick = () => ProjectCityAgents.replay(run.projectId, run.id);
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
  const open = (img) => ImageViewer.open({ title: 'Input images', items: imgs.map((i) => ({ title: i.alt || 'Input image', images: [{ file: i.dataset.runImage, src: i.getAttribute('src') || undefined, label: i.alt }] })), index: imgs.indexOf(img) });
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
  box.innerHTML = `<div class="fail-banner-text"><b>The workflow failed: ${esc(runLabel(r))}</b><span class="muted small mono">${esc(r.id)}</span>${r.error ? `<span class="mono small" title="${esc(r.error)}">${esc(r.error)}</span>` : ''}</div>
    <button class="btn sm sup-btn solid" id="btn-banner-sup"><span class="sup-mark">◆</span> Ask the supervisor</button>`;
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
    ? '<button type="button" class="btn sm ghost" data-pause-act="cancel" data-testid="run-cancel-pause" title="Take the pause back: the run goes on after the current turn">Cancel pause</button>'
    : '<button type="button" class="btn sm primary" data-pause-act="resume" data-testid="run-resume" title="Continue this run where it paused: no finished turn runs again">Resume</button>';
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
    showToast(b.dataset.pauseAct === 'cancel' ? 'Could not cancel the pause' : 'Could not resume the run', errMsg(err));
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
  if (!(await confirmDialog('Resume the paused run', `${at}. Resume continues there: no finished turn runs again.${cont}`, 'Resume'))) return;
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
  const show = !!(c?.then || c?.from) || editing || running || !!family;
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
    ? '<button type="button" class="link-btn small" data-chain="save-pipe-open" title="Save this run\'s workflow and its chain as a pipeline you can start like a workflow">Save as pipeline</button>' : '';
  let actions = '';
  let text = '';
  if (editing) {
    actions = `${btn('cancel-edit', 'Cancel')}${btn('save', 'Save', 'primary')}`;
  } else if (savingPipe) {
    actions = `${btn('cancel-pipe', 'Cancel')}${btn('save-pipe', 'Save pipeline', 'primary')}`;
  } else if (running) {
    actions = then ? `${btn('edit', 'Edit')}${btn('clear', 'Cancel chain')}` : '<button type="button" class="link-btn small" data-chain="edit">+ When it finishes…</button>';
    if (then) text = 'Starts only if this run succeeds. Its gates still wait for you.';
  } else if (then && c.state === 'paused') {
    actions = `${btn('drop', 'Drop chain')}${btn('edit', 'Edit')}${btn('resume', 'Resume chain', 'primary')}`;
    text = c.reason || 'The chain paused.';
  } else if (then) {
    text = c.reason || '';
    if (c.nextRunId) actions = `<button type="button" class="link-btn small" data-run-link="${esc(c.nextRunId)}">Open the next run</button>`;
  }
  const badges = c ? ChainModel.chainBadgesHtml(c) : '';
  const names = Object.fromEntries((chainUi.workflows || []).map((w) => [w.file, w.name]));
  const strip = pipeRun ? `<div class="chain-banner-pipe"><span class="muted small">Pipeline <b>${esc(pipeRun.name)}</b>${pipeRun.state === 'paused' ? ' · <span class="warn-text">paused</span>' : ''}</span>
      ${ChainModel.pipelineStagesHtml(pipeRun, { names, runs: pipeRun.runs, current: pipe.stage })}</div>` : '';
  // what the owner typed survives a redraw (busy, an error)
  const draft = chainUi.pipeDraft?.runId === r.id ? chainUi.pipeDraft : { name: then ? `${r.workflow || 'Run'} → ${ChainModel.thenLabel(then)}` : '', category: 'build', description: '' };
  const pipeForm = savingPipe ? `<div class="chain-banner-edit pipe-save-form">
      <div class="field"><label for="pipe-save-name">Name</label><input type="text" id="pipe-save-name" value="${esc(draft.name)}" spellcheck="false" /></div>
      <div class="field"><label for="pipe-save-category">Category</label>${window.Select.markup('id="pipe-save-category"', PIPE_CATEGORIES, draft.category)}</div>
      <div class="field pipe-save-desc"><label for="pipe-save-description">Description</label><input type="text" id="pipe-save-description" value="${esc(draft.description)}" placeholder="What the pipeline does (shown when you start it)" /></div>
      <p class="muted small">Saved in the workspace's pipelines folder: this run's workflow, then each step of its chain with its mapping. Start it from the Start drawer or Workflows › Definitions.</p>
    </div>` : '';
  if (saved) text = `Saved as the pipeline "${saved.name}" (${saved.file}).`;
  box.innerHTML = `<div class="chain-banner-head">
      <span class="chain-banner-title">${then || editing ? 'When it finishes' : !c?.from && family && !running ? 'Linked runs' : 'Chain'}</span>${badges}
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
  const parent = p?.run_id ? `<span class="muted small">Child run of</span> ${link(p.run_id, p.workflow || p.run_id, `Open run ${p.run_id} (step ${p.step_id || '?'})`)}${Number.isInteger(p.index) ? ` <span class="badge">item ${p.index + 1}</span>` : ''}` : '';
  const cost = childRunsCost(r);
  const children = kids.length ? `<span class="muted small">Child runs${cost ? ` · ${esc(fmtCost(cost))}` : ''}</span> ${kids.map((k) => {
    const name = k.label || (Number.isInteger(k.index) ? `item ${k.index + 1}` : k.workflow || k.run_id);
    // a resumed parent's children (#175): reused when they had succeeded, else resumed
    const how = k.reused ? `, reused from the previous run` : k.resumed_from ? `, resumes ${k.resumed_from}` : '';
    return k.run_id
      ? `<span class="child-run">${link(k.run_id, name, `Open run ${k.run_id} (${k.workflow || 'workflow'}, step ${k.step_id}${how}${k.cost_usd ? `, ${fmtCost(k.cost_usd)}` : ''})`)} ${StatusPill.statusPill(k.status)}${k.reused ? ' <span class="badge">reused</span>' : k.resumed_from ? ' <span class="badge">resumed</span>' : ''}</span>`
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
  const item = (s) => `
    <li class="${s.status}">
      <span class="dot"></span>
      <span><span title="${esc(s.id)}">${esc(agentLabel(s.id, v.run?.stepNames))}</span><br><span class="kind"${s.agent ? ` title="${esc(s.agent)}"` : ''}>${s.type === 'human_approval' ? 'human approval' : s.type === 'screenshots' ? 'screenshots (no agent)' : s.type === 'suite' ? 'test suite (no agent)' : s.type === 'test_ids' ? 'test id check (no agent)' : s.type === 'release_version' ? 'release version (no agent)' : s.type === 'project_map' ? 'project map (no agent)' :s.type === 'workflow' ? 'child workflow runs' : esc(agentLabel(s.agent, v.run?.agentNames))}</span></span>
      <span class="visits">${s.visits ? '×' + s.visits : ''}</span>
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
      <summary><span class="dot"></span><b>${esc(sec.name)}</b><span class="muted small">${sec.steps.filter((s) => s.visits).length}/${sec.steps.length}</span></summary>
      <ol class="steps">${sec.steps.map(item).join('')}</ol>
    </details>`;
  }).join('');
  const hidden = all.length - all.filter((s) => s.visits > 0).length;
  const toggle = hidden ? `<button type="button" class="link-btn small" data-all-steps>${v.allSteps ? 'Hide the steps that did not run' : `Show all steps (${hidden} not run)`}</button>` : '';
  const box = $('#steps');
  const out = (html || '<p class="muted small">No step has run yet.</p>') + toggle;
  if (box.dataset.html === out) return;
  box.dataset.html = out;
  box.innerHTML = out;
  box.querySelectorAll('.step-group > summary').forEach((sum) => (sum.onclick = () => {
    v.openGroups.set(sum.parentElement.dataset.group, !sum.parentElement.open);
  }));
  const btn = box.querySelector('[data-all-steps]');
  if (btn) btn.onclick = () => { v.allSteps = !v.allSteps; renderSteps(); };
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
        <span class="badge">${esc(s.model)}</span>
        ${isOrch ? '' : `<span class="badge">${s.turns || 0} turn(s)</span>`}
      </div>
      <div class="metrics">
        <div class="metric"><label>open</label><b>${fmtDur(liveDuration(s))}</b></div>
        ${isOrch ? `
        <div class="metric"><label>steps</label><b>${[...state.steps.values()].reduce((a, x) => a + x.visits, 0)}</b></div>
        <div class="metric"><label>child sessions</label><b>${list.length - 1}</b></div>
        <div class="metric"><label>total cost</label><b>${fmtCost(totals().cost)}${marks(estimated, notRecorded(list))}</b></div>${state.run?.childRuns?.length ? `
        <div class="metric" title="What its child runs cost (their own children included), not in its total cost"><label>child runs cost</label><b>${fmtCost(childRunsCost(state.run))}</b></div>` : ''}` : `
        <div class="metric"><label>active</label><b>${fmtDur(s.active_ms)}</b></div>
        <div class="metric"><label>in / out</label><b>${fmtNum((t.input || 0) + (t.cache_read || 0))} / ${fmtNum(t.output)}</b></div>
        <div class="metric"><label>cost</label><b data-testid="session-cost">${s.cost_estimate?.source === 'unknown' ? '—' : fmtCost(s.cost_usd)}${marks(Number(s.estimated_cost_usd) || 0, notRecorded([s]))}${costEstimateNote(s.cost_estimate)}</b></div>
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
  return `<div class="metric next-turn"${t ? ` data-next-turn="${esc(t.kind)}"` : ''} data-testid="session-next-turn" title="${esc(SessionCache.turnTitle(t))}"><label>next turn</label><b>${esc(SessionCache.turnText(t))}</b></div>`;
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
    case 'text': return `<div class="item text"><div class="label">output</div><pre>${esc(item.text)}</pre></div>`;
    case 'tool_call': return `<div class="item tool_call"><div class="label">tool · ${esc(item.name)}${subagentLabel(item)}</div><pre>${esc(typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2))}</pre></div>`;
    case 'tool_result': return detailsBlock(key, 'tool_result', `result${item.is_error ? ' (error)' : ''}`, item.output);
    case 'stderr': return `<div class="item stderr"><div class="label">stderr</div><pre>${esc(item.text)}</pre></div>`;
    case 'spawn': return `<div class="item spawn"><div class="label">process</div><pre>${esc(item.command)} ${esc(item.args.join(' '))}\ncwd: ${esc(item.cwd)}</pre></div>`;
    default: return `<div class="item raw"><div class="label">event</div><pre>${esc(item.text || JSON.stringify(item.event))}</pre></div>`;
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
        ${s.id === 'orchestrator' ? '<button class="btn sm ghost sup-btn" data-sup><span class="sup-mark">◆</span> Ask the supervisor</button>' : ''}
        <span class="muted small" data-term-msg></span>
      </div>
      <dl class="kv">
        <dt>session</dt><dd>${esc(s.id)}</dd>
        <dt>provider session</dt><dd>${esc(s.provider_session_id || '—')}</dd>
        <dt>status</dt><dd data-status="${esc(s.status)}">${esc(StatusPill.statusLabel(s.status))}</dd>
        <dt>opened at</dt><dd>${esc(timeOf(s.opened_at))}${s.closed_at ? ' → ' + esc(timeOf(s.closed_at)) : ''}</dd>
        <dt>duration / active / idle</dt><dd>${fmtDur(liveDuration(s))} / ${fmtDur(s.active_ms)} / ${fmtDur(s.idle_ms)}</dd>
        <dt>tokens</dt><dd>in ${fmtNum(s.tokens?.input)} · cache r/w ${fmtNum(s.tokens?.cache_read)}/${fmtNum(s.tokens?.cache_write)} · out ${fmtNum(s.tokens?.output)} · reasoning ${fmtNum(s.tokens?.reasoning)}</dd>
        <dt>cost</dt><dd>${fmtCost(s.cost_usd)}</dd>
      </dl>
    </div>`;

  if (s.id === 'orchestrator') {
    html += `<div class="orch-log">${state.orchLog.map((l) =>
      `<div class="line ${esc(l.level)}"><span class="ts">${esc(timeOf(l.ts))}</span><span>${esc(l.text)}</span></div>`).join('')}</div>`;
  } else {
    html += [...s.turnLog.values()].map((t) => `
      <div class="turn">
        <div class="turn-head">
          <span class="t">Turn ${t.n}</span><span class="muted">${esc(t.stepId || '')}</span>
          <span class="meta">${t.result ? `${fmtDur(t.result.duration)} · in ${fmtNum((t.result.usage?.input || 0) + (t.result.usage?.cache_read || 0))} · out ${fmtNum(t.result.usage?.output)} · ${fmtCost(t.result.cost)}` : 'in progress…'}</span>
        </div>
        <div class="turn-body">
          ${t.prompt != null ? detailsBlock(`${s.id}:${t.n}:prompt`, 'prompt', 'prompt sent', t.prompt) : ''}
          ${t.items.map((it, i) => renderItem(s.id, t.n, it, i)).join('')}
          ${t.result ? `<div class="usage-row">
              <span>input ${fmtNum(t.result.usage?.input)}</span><span>cache read ${fmtNum(t.result.usage?.cache_read)}</span>
              <span>cache write ${fmtNum(t.result.usage?.cache_write)}</span><span>output ${fmtNum(t.result.usage?.output)}</span>
              <span>reasoning ${fmtNum(t.result.usage?.reasoning)}</span></div>` : ''}
        </div>
      </div>`).join('') || '<p class="empty muted">Waiting for the first turn…</p>';
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
    return `<div class="ev"><div class="ev-head"><span class="muted">#${seq}</span><span class="muted">${esc(timeOf(ts))}</span><span class="ev-type">${esc(type)}</span></div>
      <pre>${esc(JSON.stringify(rest, null, 1)).slice(0, 2000)}</pre></div>`;
  }).join('');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

registerView({
  id: 'run',
  markup: `
      <section id="view-run" class="view hidden">
        <div id="run-fail-banner" class="fail-banner hidden"></div>
        <div id="run-pause-banner" class="run-pause-banner hidden" aria-live="polite"></div>
        <div id="run-chain" class="chain-banner hidden" aria-live="polite"></div>
        <div id="run-gates" class="run-gates hidden" aria-live="polite"></div>
        <div class="run-modebar">
          <div class="seg sm" role="group" aria-label="Run view">
            <button id="run-mode-chat" type="button" title="Follow this run as a chat">Chat</button>
            <button type="button" class="active" aria-pressed="true">Details</button>
          </div>
          <button id="run-mode-3d" class="btn ghost sm" type="button" data-run3d="run" data-testid="run-3d" title="Show this run in 3D">3D</button>
        </div>
        <div class="run-layout">
          <aside class="panel config">
            <section>
              <h2>Workflow</h2>
              <div id="run-summary" class="run-summary"><p class="muted small">No workflow started.</p></div>
            </section>
            <section>
              <h2>Steps</h2>
              <div id="steps" class="step-groups" data-testid="run-steps"></div>
            </section>
          </aside>

          <section class="panel sessions-panel">
            <h2>Sessions</h2>
            <div id="sessions" class="sessions">
              <p class="empty muted">No sessions yet. Click <b>Start</b> at the top to pick a workflow.</p>
            </div>
          </section>

          <section class="panel detail-panel">
            <div class="tabs">
              <button class="tab active" data-tab="detail">Session</button>
              <button class="tab" data-tab="events">Events</button>
              <button class="tab" data-tab="artifacts" data-testid="run-tab-artifacts" title="The files this run produced">Artifacts <span id="tab-artifacts-count" class="tab-count hidden"></span></button>
            </div>
            <div id="tab-detail" class="tab-body">
              <p class="empty muted">Select a session to see prompts, thinking, tool calls and output.</p>
            </div>
            <div id="tab-events" class="tab-body hidden"></div>
            <div id="tab-artifacts" class="tab-body hidden"></div>
          </section>
        </div>
      </section>`,
  mount() {
    $('#run-gates').onclick = onRunGateClick;
    $('#run-pause-banner').onclick = onPauseBannerClick;
    $('#run-chain').onclick = onChainBannerClick;
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
