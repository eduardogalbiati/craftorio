// Backlog › Product Owner (#105): the floating robot button at the bottom right of the Backlog opens
// the Product Owner's drawer (#po-drawer): suggested questions as chips, a free text box, and the
// project's conversation (kept by the service until cleared, packages/engine/domains/po/product-owner.js). Each answer
// shows its cost and, when it has them, the proposed groups (issues, workflow, inputs, why, files,
// stage, size: complexity, an estimate from past runs, warnings), the issues that must not run in
// parallel and the issues to enrich first. A group is applied only on the owner's click: Assign
// (the assign dialog prefilled) or Add to roadmap (a new stage), through window.BacklogActions
// (backlog.js); "Add all to the roadmap" sends the groups as planned stages (api.proposeRoadmap).
// A group already applied (#140, `groupState`, derived from the Backlog's roadmap, queue and runs)
// stays in the conversation dimmed, with a badge (In roadmap · Stage N, a link to the Roadmap; Queued;
// Running, a link to the run) and its buttons disabled; a partly applied one offers "Add the rest".
// Register an issue (#117, its pill, or the PO deciding from the message, #785): the owner describes an issue (typed,
// dictated, with screenshots pasted, dropped or attached: api.attachProductOwnerFile), the Product
// Owner may ask a couple of questions, then shows the draft (title, labels, Related, the body
// rendered, close issues). The latest draft is filed only on the owner's click: Create, Create +
// roadmap, Create + assign…, Add to #n / Comment on #n, or Discard; Revise is a new message. After a
// filing the Backlog shows the synced issues (BacklogActions.showData).
// A draft that names its epic (#138) shows "Place in epic" (checked when the project's Auto-place option
// is on): Create then places the new issue in it. The plan answer's splits (#124) and epics (#138) are
// drawn and applied by backlog-po-proposals.js; window.BacklogPO.ask opens the drawer and asks (the
// Epics view's "Organize into epics…").
// Send to Product Owner (#169, window.BacklogPO.attach, the Backlog's button next to Assign workflow…):
// the selected issues become removable chips (#po-attached; a closed one struck through) and the
// text box gets an editable suggested question; nothing is sent until Ask. They go with every plan
// question (api.askProductOwner's `issues`: read in full) until removed or the conversation is
// cleared. A group's suggested extra issues are checkboxes, unchecked: Assign…, Add to roadmap and
// Add all add only the checked ones (po.extras). While a question is in flight the Backlog's button
// is disabled ("Product Owner is answering": syncSendButton).
// Developer or simulated mode asks the simulated Product Owner (no model call) and only previews a filing.
// Its scenario picker (#148, #po-sim, orange, shown in that mode only) forces the next simulated answer
// (MOCK_SCENARIOS in packages/engine/domains/po/product-owner.js: a question, a draft, a duplicate, an error, large answers,
// applied groups, a long attachments list) to click through every state by hand or in a smoke check.
// The conversation keeps the owner's scroll position on every render; a new message (the question
// sent, the answer) scrolls to the end only when the owner was already there (#148). While a
// question is in flight its attachments can't be removed: they were sent with it.
// An answer the owner has not seen (the drawer closed, or another screen) puts a yellow dot on the
// robot button until the drawer opens (#149, po.unread); the service also notifies it (`po` notice).
// A proposed group's card (#216): its decisions (#785, backlog-po-options.js: the workflow and its inputs
// grouped, each with its source and reason, editable in place, the changes kept in po.edits), then
// labelled sections (Why, Mode as Markdown; Files; Estimate with the time, Estimates.formatMinutes; the
// Cost step's choices as pills) and the warnings as a callout.
// Uses app.js globals ($, esc, state, errMsg, devMode, fmtCost, fmtSize, markdownHtml, confirmDialog)
// and window.Robots (robots.js).
// Live progress (#180, window.LiveTurn, live-turn.js): while a question is in flight the drawer shows
// what the Product Owner does (activity line, timer, the last steps) and its answer as it is written,
// from the service's chat:progress events ('po', the project id); Stop (api.cancelChatTurn) ends the
// turn and the service records what was written, marked as stopped. The cards come from the final answer.
// Calibration (#189, backlog-po-settings.js): the header's chip and settings button; a plan question
// sends the chip's step for that question only, and each answer shows the step it was planned with.
// Its button and drawer are part of the Backlog's markup (backlog.js registerView): wired as it loads.
// While a question is in flight (#234) the pills, "Register an issue…" and Ask/Send are locked (the
// text box stays free; Enter sends nothing), the log jumps to the question and the live turn, and
// a working line under the pills (#po-working, an ActivityLine, #781) shows the elapsed time; a click with no project says
// so (#po-notice). #785: nothing is chosen before the answer: three suggestions in the interface's language
// ("+ opções" shows the others), no workflow and no options; a question goes as mode 'auto' and the PO
// decides whether it plans or registers, and each recommendation's workflow and inputs. The Cost chip
// shows only where the Cost axis applies to the default workflow (PoCalibration.costApplies). The header
// (#po-for) names the project. "Back to planning" (#btn-po-plan) leaves Register an issue.
// #791 (backlog-po-kinds.js): a recommendation's kind, the plan by kind and Feature | Fix | Outro; the other
// pickers of the drawer offer only the project's workflows (DefaultWorkflow.projectWorkflows).
// The conversation, the text box, Ask and the working line go through the agents' shared chat (#274,
// agent-chat.js, adopting #po-chat's markup): the box empties as soon as Ask is clicked and gets the
// question back when it fails; the pills (#po-chips, its 'pills' slot) and BacklogPO.ask send through it.
// load: after robots.js agent-chat.js views/backlog/backlog.js (the button's robot is drawn and the drawer wired as it loads)
/* global api, Robots */
(() => {
  // #785: the suggestions, each asked in the interface's language; the rest behind "+ opções"
  const MAIN_QUESTIONS = [
    'backlog_po.suggest_analyze_the_backlog',
    'backlog_po.suggest_build_a_roadmap',
  ];
  const MORE_QUESTIONS = [
    'backlog_po.suggest_not_together',
    'backlog_po.suggest_too_big_or_unclear',
    'backlog_po.suggest_too_big_for_one_run',
    'backlog_po.suggest_organize_into_epics',
  ];
  // the workflow a filed issue is planned or assigned with: the project's default workflow (#195,
  // #790) unless picked in the select next to Create + roadmap (per draft)
  const draftWorkflow = new Map(); // message index → the workflow picked
  const workflowFor = (m) => draftWorkflow.get(m) || DefaultWorkflow.current().file;
  const MAX_CANDIDATES = 3;
  // #169: the question the drawer suggests for issues sent from the Backlog (the owner may edit it)
  const SELECTION_QUESTION = 'What is the best strategy to put these issues in the roadmap? Should any other open issue join them?';
  // attached: issue numbers sent from the Backlog (#169); extras: `${m}:${n}` → the suggested issues checked in a group
  // unread: an answer the owner has not seen yet (#149); scenario: the simulated answer forced (#148)
  // window (#263): the conversation is shown in the Agents window's pane too; unreadCount: its badge
  // edits (#785): `${m}:${n}` → the owner's changes to a recommendation (backlog-po-options.js); runDefaults: the project's
  const po = { open: false, busy: false, projectId: null, messages: [], pending: null, error: null, notes: {}, mode: 'plan', files: [], placeEpic: {}, attached: [], extras: {}, unread: false, unreadCount: 0, scenario: '', live: null, liveIn: null, elsewhere: false, since: 0, notice: '', window: false, moreSuggestions: false, leftDraft: false, runDefaults: null, edits: {} };
  let winChat = null; // the Agents window's chat of this conversation (#263), while its pane shows it
  const NO_PROJECT = 'Choose a project in the Backlog first: the Product Owner plans for the project of the Backlog\'s project select.';
  const $p = (sel) => document.querySelector(sel);
  const actions = () => window.BacklogActions;
  const issueOf = (n) => (actions()?.data()?.issues || []).find((i) => i.number === n);
  const avatar = (st = 'idle') => (window.Robots ? Robots.svg('product-owner', st, { bubble: false, plaque: '' }) : '');
  // #148: the simulated answers the picker forces (ids of MOCK_SCENARIOS, packages/engine/domains/po/product-owner.js); `mode`:
  // the drawer switches to the mode it answers in
  const SCENARIOS = [
    { id: '', label: 'Default (built from the backlog)' },
    { id: 'question', label: 'A pending question', mode: 'issue' },
    { id: 'draft', label: 'A draft ready to file', mode: 'issue' },
    { id: 'duplicate', label: 'A duplicate found', mode: 'issue' },
    { id: 'large-draft', label: 'A large draft', mode: 'issue' },
    { id: 'attachments', label: 'A long attachments list', mode: 'issue' },
    { id: 'groups', label: 'Several groups (applied, partly applied)', mode: 'plan' },
    { id: 'large-answer', label: 'A large answer', mode: 'plan' },
    { id: 'error', label: 'An error answer' },
  ];
  const SIM_FILES = 8;
  // the owner reads the drawer: an answer arriving now is seen (#149)
  // (#254: the drawer also opens on the Roadmap screen)
  // (#263: or the Agents window's pane shows it)
  const watching = () => (po.open && state.view === 'backlog' && !document.hidden) || (po.open && state.view === 'roadmap' && !document.hidden) || (po.window && !document.hidden);

  function renderButton() {
    // #149: the sidebar's yellow status dot while an answer is unseen (the robot thinks while busy)
    const unread = po.unread && !po.busy;
    const b = $p('#btn-bl-po');
    b.innerHTML = avatar() + (unread ? '<span class="status-dot" aria-hidden="true"></span>' : '');
    b.classList.toggle('st-waiting', unread);
    b.setAttribute('aria-label', unread ? t('backlog_po.product_owner_a_new_answer') : t('backlog_po.product_owner'));
    $p('#po-avatar').innerHTML = avatar(po.busy ? 'thinking' : 'idle');
    syncSendButton();
  }

  // The Backlog's Send to Product Owner (n) (#169): disabled while a question is in flight.
  function syncSendButton() {
    const b = $p('#btn-bl-send-po');
    if (!b) return;
    b.disabled = po.busy;
    b.textContent = po.busy ? t('backlog_po.product_owner_is_answering') : t('backlog_po.send_to_product_owner_value', { value: b.dataset.n || 0 });
    b.title = po.busy ? t('backlog_po.product_owner_is_answering_wait_for') : t('backlog_po.ask_the_product_owner_about_the');
  }

  // The conversation of `projectId`: another project's attachments not sent yet, messages and notes
  // belong to that project's conversation and go. #26: so does its unsent text (typed, or given back by a
  // failed turn): it is not sent as the next project's question.
  function setProject(projectId) {
    if (po.projectId === projectId) return;
    clearInputs();
    Object.assign(po, { projectId, messages: [], pending: null, error: null, notes: {}, files: [], placeEpic: {}, attached: [], extras: {}, edits: {}, runDefaults: null });
  }
  // #26: the text boxes (the drawer's, the Agents window's) of the project being left
  function clearInputs() {
    for (const c of [chat, winChat]) if (c) { c.input.value = ''; c.refresh(); }
  }
  // while a question is in flight the service already recorded it: render() leaves out the pending bubble
  // (no history yet may come back empty-handed: an empty conversation;
  // and one that comes back after the drawer moved to another project is not this one's)
  async function loadHistory(projectId) {
    try {
      const messages = await api.productOwnerHistory(projectId) || [];
      if (po.projectId === projectId) po.messages = messages;
    } catch (e) { po.error = errMsg(e); }
    // #785: the values a recommendation shows for what it did not choose (no hints: the workflow's)
    let hints = null;
    try { hints = await window.WorkflowInputs?.hintsOf(projectId); } catch { /* the workflow's values, then */ }
    if (po.projectId === projectId) po.runDefaults = hints?.runDefaults || null;
    // a draft still to file: back to Register an issue
    if (openDraftIndex() >= 0 && !po.busy) po.mode = 'issue';
  }

  async function open() {
    // #234: with no project selected the drawer opens and says so (nothing can be asked)
    const projectId = actions()?.projectId() || null;
    // attachments and text (#26) not sent yet belong to the other project's conversation
    if (po.projectId !== projectId) clearInputs();
    if (po.projectId !== projectId) Object.assign(po, { files: [], placeEpic: {} });
    if (po.projectId !== projectId) Object.assign(po, { attached: [], extras: {} });
    if (po.projectId !== projectId) Object.assign(po, { edits: {}, runDefaults: null });
    if (po.projectId !== projectId) Object.assign(po, { projectId, messages: [], pending: null, error: null, notes: {} });
    Object.assign(po, { open: true, unread: false });
    Object.assign(po, { unreadCount: 0, notice: projectId ? '' : NO_PROJECT });
    $p('#po-drawer').classList.add('open');
    $p('#po-drawer').setAttribute('aria-hidden', 'false');
    $p('#po-backdrop').classList.remove('hidden');
    window.reportNotifyContext?.();
    render({ scroll: 'end' });
    if (!projectId) return;
    await loadHistory(projectId);
    render({ scroll: 'end' });
    setTimeout(() => $p('#po-question').focus({ preventScroll: true }), 200);
  }

  // #263: the conversation in the Agents window's pane: the project of the Backlog's select, else the
  // app's current project (the window has no Backlog open)
  let windowTries = 0;
  async function openInWindow() {
    const projectId = actions()?.projectId() || window.CurrentProject?.get?.() || null;
    // the window's page still loading its projects (app.js init): the current project comes in a moment
    if (!projectId && window.AgentsWindow?.isWindowPage?.() && windowTries++ < 100) {
      po.window = true;
      setTimeout(() => { if (po.window && !po.projectId) openInWindow(); }, 300);
      return;
    }
    setProject(projectId);
    Object.assign(po, { window: true, unread: false, unreadCount: 0 });
    po.notice = projectId ? '' : NO_PROJECT;
    render();
    if (!projectId) return;
    if (!po.messages.length && !po.busy) await loadHistory(projectId);
    render();
  }

  function close() {
    window.BacklogPoSettings?.close();
    po.open = false;
    $p('#po-drawer').classList.remove('open');
    $p('#po-drawer').setAttribute('aria-hidden', 'true');
    $p('#po-backdrop').classList.add('hidden');
    window.reportNotifyContext?.();
  }

  function setMode(mode) {
    po.mode = mode === 'issue' ? 'issue' : 'plan';
    // #785: the owner left an open draft: the next questions are plans, not revisions of it
    po.leftDraft = po.mode === 'plan' && openDraftIndex() >= 0;
    render();
    $p('#po-question').focus({ preventScroll: true });
  }

  // #234: a short message where the owner clicked (no project selected)
  function showNotice(text) {
    po.notice = text;
    const el = $p('#po-notice');
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  }

  async function ask(question) {
    const q = String(question || '').trim();
    // #234: no silent no-op when no project is selected
    if (q && !po.busy && !po.projectId) showNotice(NO_PROJECT);
    if (!q || po.busy || !po.projectId) return;
    const projectId = po.projectId;
    let mode = po.mode;
    const files = mode === 'issue' ? po.files.map((f) => f.path) : [];
    // #169: the attached issues go with every plan question until the owner removes them
    const issues = mode === 'plan' ? [...po.attached] : [];
    // #189: the chip's step for this question only; the next question uses the saved one again
    const calibration = mode === 'plan' ? window.BacklogPoSettings?.override() ?? null : null;
    // #205: the Cost chip's step, the same way
    const cost = mode === 'plan' ? window.BacklogPoSettings?.costOverride?.() ?? null : null;
    if (mode === 'plan') window.BacklogPoSettings?.clearOverride();
    // #785: no toggle: the PO decides from the message, unless the owner just left an open draft
    if (mode === 'plan' && !(po.leftDraft && openDraftIndex() >= 0)) mode = 'auto';
    Object.assign(po, { busy: true, pending: q, error: null, notice: '', since: Date.now(), live: window.LiveTurn.create({ agent: t('backlog_po.product_owner') }) });
    // #234: the question and the live turn in view, whatever the scroll position was
    render({ scroll: 'end' });
    if (po.open) questionInView();
    // #180: the timer and "Still working" move even when no item arrives
    const tick = setInterval(renderLive, 1000);
    try {
      // #148: the simulation-only scenario picker forces the simulated answer; #785: the PO chooses each
      // recommendation's workflow and inputs, none go with a question
      const out = await api.askProductOwner(projectId, q, devMode(), mode, files, issues, devMode() ? po.scenario || null : null, calibration, cost, null, null);
      if (po.projectId === projectId) {
        po.messages = out.messages;
        if (mode === 'issue') po.files = [];
        if (out.message?.mode === 'issue') po.mode = 'issue'; // #785: the PO took it as an issue to register
        // #149: the answer arrived while the owner was not looking at the drawer (nor the window's pane, #263)
        if (!watching()) po.unread = true;
        if (!watching()) po.unreadCount += 1;
      }
    } catch (e) {
      if (po.projectId === projectId) po.error = errMsg(e);
    } finally {
      clearInterval(tick);
      Object.assign(po, { busy: false, pending: null, live: null });
      render();
    }
  }

  // #180: only the live turn is redrawn on each event (the conversation above keeps its inputs and
  // selection); the chat keeps an owner at the end of the log there as the answer grows (#274)
  function renderLive() {
    if (po.live && po.open) chat.setLiveTurn(po.live);
    if (po.live && winChat) winChat.setLiveTurn(po.live);
  }

  function stopTurn() {
    const projectId = po.projectId;
    api.cancelChatTurn('po', projectId).catch((e) => { if (po.projectId === projectId) { po.error = errMsg(e); render(); } });
  }

  // #148: the "long attachments list" scenario attaches simulated screenshots through the real path
  // (api.attachProductOwnerFile): a 1×1 PNG each, with long names
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  function simulatedFiles() {
    const bytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
    return Array.from({ length: SIM_FILES }, (_, n) => new File([bytes], `simulated-screenshot-${n + 1}-of-the-backlog-drawer-with-a-long-name.png`, { type: 'image/png' }));
  }

  async function setScenario(id) {
    const s = SCENARIOS.find((x) => x.id === id) || SCENARIOS[0];
    po.scenario = s.id;
    if (s.mode && s.mode !== po.mode) setMode(s.mode);
    if (s.id === 'attachments') await addFiles(simulatedFiles());
    else render();
  }

  // #169: the Backlog's selection attached to the next plan questions; nothing is asked until the
  // owner sends. An empty text box gets the suggested question; a typed one is kept.
  async function attach(numbers) {
    if (po.busy || !numbers?.length) return;
    await open();
    if (!po.open) return;
    if (po.mode !== 'plan') setMode('plan');
    po.attached = [...new Set(numbers)];
    const box = $p('#po-question');
    if (!box.value.trim()) box.value = SELECTION_QUESTION;
    render();
    box.focus({ preventScroll: true });
    box.setSelectionRange(box.value.length, box.value.length);
  }

  // ---- attachments (Register an issue): stored in the conversation's folder by the service ---------
  const toBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error || new Error(`Could not read ${file.name}`));
    r.readAsDataURL(file);
  });
  async function addFiles(list) {
    const files = [...(list || [])];
    if (!files.length || !po.projectId) return;
    if (po.mode !== 'issue') po.mode = 'issue';
    po.error = null;
    for (const f of files) {
      try {
        po.files.push(await api.attachProductOwnerFile(po.projectId, f.name || 'pasted.png', await toBase64(f)));
      } catch (e) { po.error = `${f.name || 'file'}: ${errMsg(e)}`; }
    }
    render();
  }

  // ---- rendering ---------------------------------------------------------------------------------
  const issueRef = (n) => {
    const i = issueOf(n);
    return i?.url ? `<a class="badge po-issue" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(i.title)}">#${n}</a>` : `<span class="badge po-issue">#${n}</span>`;
  };
  // #215: the time as the roadmap shows it ("1 h 45 min"); the roadmap's history estimate first
  const minutesOf = (g) => g.costEstimate?.minutes ?? g.estimate?.minutes;
  const sizeText = (g) => {
    const time = minutesOf(g) != null ? `≈ ${Estimates.formatMinutes(minutesOf(g))} · ` : '';
    const est = g.costEstimate
      ? `${time}≈ $${Number(g.costEstimate.usd).toFixed(2)} <span class="muted" title="${esc(g.costEstimate.basis)}">${t(g.costEstimate.estimated ? 'backlog_po.estimate_from_past_runs_and_token_prices' : 'backlog_po.estimate_from_past_runs', { count: g.costEstimate.runs })}</span>`
      : g.estimate
      ? `${time}≈ $${Number(g.estimate.costUsd).toFixed(2)} <span class="muted">${t('backlog_po.estimate_from_basis', { basis: esc(g.estimate.basis) })}</span>`
      : `<span class="muted">${t('backlog_po.no_past_run_to_estimate_from')}</span>`;
    return `complexity ${g.complexity}${g.guessed ? ` <span class="muted" title="${t('backlog_po.some_issues_have_no_complexity_n')}">${t('backlog_po.some_guessed')}</span>` : ''} · ${est}`;
  };

  // ---- a group already applied (#140): derived from the Backlog's data (its issues' roadmap place,
  // and live run), never remembered, so it holds after a reopen or a restart ------------
  const liveRun = (i) => i?.runs?.find((x) => !x.enrich && ['pending', 'running'].includes(x.status));
  // An issue is "in the roadmap" when an item plans it, runs it or has done it (a skipped one is not).
  const inRoadmap = (i) => !!i?.roadmap && i.roadmap.status !== 'skipped';
  /**
   * { kind: 'roadmap' | 'running' | 'partly' | null, stages: [n], covered: [numbers], rest: [numbers], runId }:
   * every issue in the roadmap (or assigned), some of them (partly), or none (null: the group is still to apply).
   * A simulated answer's group may add issues counted as in the roadmap at a stage (`g.simulated`, #148).
   */
  function groupState(g) {
    const issues = g.issues.map((n) => ({ n, i: issueOf(n) }));
    const sim = (n) => !!g.simulated?.covered?.includes(n);
    const covered = issues.filter(({ n, i }) => sim(n) || inRoadmap(i) || liveRun(i));
    const rest = issues.filter((x) => !covered.includes(x)).map(({ n }) => n);
    const stages = [...new Set(covered.map(({ n, i }) => (inRoadmap(i) ? i.roadmap.stage : sim(n) ? g.simulated.stage : null)).filter((s) => s != null))].sort((a, b) => a - b);
    const run = covered.map(({ i }) => liveRun(i)).find(Boolean);
    const out = { stages, covered: covered.map(({ n }) => n), rest, runId: run?.runId || null };
    if (!covered.length) return { ...out, kind: null };
    if (rest.length) return { ...out, kind: 'partly' };
    return { ...out, kind: stages.length ? 'roadmap' : 'running' };
  }
  const stagesLabel = (s) => (s.length > 1 ? `Stages ${s.join(', ')}` : `Stage ${s[0]}`);

  // The badge of an applied group: a link to the roadmap stage or to the run.
  function appliedBadge(st, already) {
    if (st.kind === 'roadmap') {
      const label = already ? 'Already in the roadmap' : `In roadmap · ${stagesLabel(st.stages)}`;
      return `<button class="badge po-applied" type="button" data-po-stage="${st.stages[0]}" title="${t('backlog_po.open_the_roadmap_at_stage_value', { value: st.stages[0] })}">${esc(label)}</button>`;
    }
    if (st.kind === 'running' && st.runId) return `<button class="badge po-applied live" type="button" data-po-run="${esc(st.runId)}" title="${t('backlog_po.open_run_runid', { runId: esc(st.runId) })}">${t('backlog_po.running')}</button>`;
    if (st.kind === 'running') return `<span class="badge po-applied live">${t('backlog_po.running')}</span>`;
    if (st.kind === 'partly') {
      const where = st.stages.length ? 'in the roadmap' : 'assigned';
      return `<span class="badge warn" title="${esc(`${st.covered.map((x) => `#${x}`).join(', ')} already ${where}; ${st.rest.map((x) => `#${x}`).join(', ')} not yet`)}">${t('backlog_po.partly_where_value', { where, value: esc(st.covered.map((x) => `#${x}`).join(', ')) })}</span>`;
    }
    return '';
  }
  const applied = (st) => ['roadmap', 'running'].includes(st.kind);
  const appliedTitle = (st) => (st.kind === 'roadmap' ? `Already in the roadmap, ${stagesLabel(st.stages).toLowerCase()}` : 'Already assigned: its run is in progress');

  // #169: open issues the owner did not attach that could join the group, each unchecked until the
  // owner keeps it (po.extras); only the checked ones go with Assign…, Add to roadmap and Add all
  const extrasOf = (key) => po.extras[key] || [];
  const withExtras = (issues, key) => [...issues, ...extrasOf(key).filter((x) => !issues.includes(x) && issueOf(x)?.state !== 'closed')];
  function suggestedHtml(g, key, done) {
    if (!g.suggested?.length) return '';
    return `<div class="po-suggested"><div class="small muted">${t('backlog_po.could_join_suggested_not_selected')}</div>
      ${g.suggested.map((s) => {
        const i = issueOf(s.issue);
        const tip = `${i ? `#${s.issue} ${i.title}` : `#${s.issue}`}${s.reason ? ` · ${s.reason}` : ''}`;
        return `<label class="check small" title="${esc(tip)}"><input type="checkbox" data-po-extra="${s.issue}"${extrasOf(key).includes(s.issue) ? ' checked' : ''}${done ? ' disabled' : ''} />
          <span>${issueRef(s.issue)} ${esc(i?.title || '')}${s.reason ? ` <span class="muted">${esc(s.reason)}</span>` : ''}</span></label>`;
      }).join('')}</div>`;
  }

  const workflowOf = (file) => (state.workflows || []).find((w) => w.file === file) || null;
  const workflowTitle = (wf, file) => window.BacklogPoOptions.workflowTitle(wf, file, state.workflows);

  // the header project's record (its set, its default, #791 its workflowKinds), as the Backlog holds it
  const projectRecord = () => actions()?.project?.() || (state.projects || []).find((p) => p.id === po.projectId) || null;
  const taskWorkflows = () => (state.workflows || []).filter((w) => !w.error && w.inputs?.task);
  // #486, #790, #791: the pickers offer the project's workflows only (every one with a task when it has none)
  const planWorkflows = () => DefaultWorkflow.projectWorkflows(taskWorkflows(), projectRecord());
  // the Cost chip and its steps: not on a tests-first workflow, nor one without the inputs it sets
  const costOn = () => window.PoCalibration.costApplies(workflowOf(DefaultWorkflow.current().file));

  const projectName = () => actions()?.project?.()?.name || (state.projects || []).find((p) => p.id === po.projectId)?.name || po.projectId;
  function groupHtml(g, m, n) {
    const key = `${m}:${n}`;
    const wf = workflowOf(po.edits[key]?.workflow || g.workflow);
    const st = groupState(g);
    const done = applied(st);
    // planned, but by none of this answer's items (the roadmap records each item's origin): they were
    // already planned, e.g. "Add all" left them out
    const from = po.messages[m]?.ts;
    const already = st.kind === 'roadmap' && g.issues.every((x) => issueOf(x)?.roadmap?.origin !== from);
    const off = done ? ` disabled title="${esc(appliedTitle(st))}"` : '';
    return `
      <div class="po-group${done ? ' applied' : ''}" data-msg="${m}" data-group="${n}" data-testid="po-recommendation">
        <div class="po-group-head">
          <span class="badge">${t('backlog_po.stage')} ${g.stage}</span>
          ${window.BacklogPoKinds.badge(window.BacklogPoKinds.shown(g, po.edits[key]))}
          <b>${esc(g.name)}</b>
          <span class="po-issues">${g.issues.map(issueRef).join('')}</span>
          ${appliedBadge(st, already)}
        </div>
        ${g.kind ? window.BacklogPoKinds.controlHtml({ g, edit: po.edits[key], done, workflows: taskWorkflows(), title: workflowTitle }) : ''}
        ${window.BacklogPoOptions.decisionsHtml({ g, key, edit: po.edits[key], wf, workflows: planWorkflows(), title: workflowTitle, runDefaults: po.runDefaults, done })}
        <dl class="po-secs small">
          ${window.BacklogPoKinds.reasonHtml(g)}
          ${g.reason ? `<dt>${t('backlog_po.why')}</dt><dd class="md md-compact">${markdownHtml(g.reason)}</dd>` : ''}
          ${g.modeReason ? `<dt>${t('backlog_po.mode')}</dt><dd class="md md-compact">${markdownHtml(g.modeReason)}</dd>` : ''}
          ${g.files?.length ? `<dt>${t('backlog_po.files')}</dt><dd>${window.BacklogPoOptions.filesHtml(g.files)}</dd>` : ''}
          <dt>${t('backlog_po.estimate')}</dt><dd class="po-size">${sizeText(g)}</dd>
          ${g.cost ? `<dt>${t('backlog_po.cost')}</dt><dd>${costHtml(g)}</dd>` : ''}
        </dl>
        ${g.warnings?.length ? `<div class="po-callout warn small" role="note">${g.warnings.map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
        ${suggestedHtml(g, key, done)}
        <div class="row po-group-actions">
          <button class="btn sm primary" type="button" data-po-act="assign"${off || ` title="${t('backlog_po.open_the_assign_dialog_with_these')}"`}>${t('backlog_po.assign')}</button>
          ${st.kind === 'partly'
            ? `<button class="btn sm ghost" type="button" data-po-act="roadmap" title="${esc(`Plan ${st.rest.map((x) => `#${x}`).join(', ')} as a new stage at the end of the roadmap`)}">${t('backlog_po.add_the_rest')}</button>`
            : `<button class="btn sm ghost" type="button" data-po-act="roadmap"${off || ` title="${t('backlog_po.plan_this_group_as_a_new')}"`}>${t('backlog_po.add_to_roadmap')}</button>`}
          ${po.notes[key] ? `<span class="small ${po.notes[key].error ? 'error' : 'muted'}">${esc(po.notes[key].text)}</span>` : ''}
        </div>
      </div>`;
  }

  // #205: what the Cost step set on a group (its inputs, the grouping, what the workflow cannot adjust)
  // (#216: its choices as the same pills as the workflow's inputs)
  function costHtml(g) {
    if (!g.cost) return '';
    const set = Object.entries(g.cost.inputs || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
    const tip = [set && `Set by the Cost step: ${set}`, g.cost.grouping, ...(g.cost.notAdjustable || [])].filter(Boolean).join('\n');
    return `<div class="po-cost"><span class="badge po-cost-name" title="${esc(tip)}">${esc(g.cost.name)}</span>${WorkflowInputs.inputPills(workflowOf(g.workflow), g.cost.inputs, { defaults: true })}${g.cost.grouping ? ` <span class="muted">${esc(g.cost.grouping)}</span>` : ''}${(g.cost.notAdjustable || []).some((x) => /^Agents/.test(x)) ? ` <span class="muted">${t('backlog_po.agents_not_adjustable')}</span>` : ''}</div>`;
  }

  function answerHtml(a, m) {
    if (!a) return '';
    const parts = [];
    // #206: the plan's estimated total
    if (a.estimateUsd != null && a.groups?.length) parts.push(`<div class="small"><span class="badge" title="${t('backlog_po.the_sum_of_the_groups_estimates', { value: a.estimateMissing ? `; ${a.estimateMissing} group(s) have no estimate yet` : '' })}">${t('backlog_po.plan')}${Number(a.estimateUsd).toFixed(2)}</span>${a.estimateMissing ? ` <span class="muted">${a.estimateMissing} ${t('backlog_po.without_an_estimate')}</span>` : ''}</div>`);
    if (a.groups?.length) {
      const allDone = a.groups.every((g) => applied(groupState(g)));
      const allTitle = allDone ? 'Every group is already in the roadmap or assigned' : 'Every group as a planned stage (by its stage number) at the end of the roadmap';
      // #791: the runs summed up and grouped by kind
      parts.push(`<div class="po-sec"><div class="sup-h">${t('backlog_po.proposed_runs')}</div>${window.BacklogPoKinds.planHtml(a.groups, (g, n) => groupHtml(g, m, n), (g, n) => window.BacklogPoKinds.shown(g, po.edits[`${m}:${n}`]))}
        <div class="row"><button class="btn sm ghost" type="button" data-po-act="roadmap-all" data-msg="${m}" title="${allTitle}"${allDone ? ' disabled' : ''}>${t('backlog_po.add_all_to_the_roadmap')}</button>
        ${po.notes[`${m}:all`] ? `<span class="small ${po.notes[`${m}:all`].error ? 'error' : 'muted'}">${esc(po.notes[`${m}:all`].text)}</span>` : ''}</div></div>`);
    }
    // #169: attached issues closed meanwhile are in no group
    if (a.closed?.length) parts.push(`<div class="small muted">${t('backlog_po.left_out_closed')} ${a.closed.map(issueRef).join(' ')}</div>`);
    if (a.conflicts?.length) {
      parts.push(`<div class="po-sec"><div class="sup-h">${t('backlog_po.do_not_run_in_parallel')}</div><ul class="po-list">${a.conflicts.map((c) =>
        `<li>${c.issues.map(issueRef).join(' ⟷ ')} ${esc(c.reason)}${c.files?.length ? ` <span class="muted mono small">${c.files.map(esc).join(', ')}</span>` : ''}</li>`).join('')}</ul></div>`);
    }
    // #150: the conflict map's hot spots, each filed as an issue on the owner's click
    if (a.decongest?.length) {
      const ts = po.messages[m]?.ts;
      const filed = (n) => po.messages.some((x) => x.decongestFiled && x.decongestFiled.at === ts && x.decongestFiled.index === n && !x.decongestFiled.preview);
      parts.push(`<div class="po-sec" data-msg="${m}"><div class="sup-h">${t('backlog_po.decongest_hot_spots_of_the_conflict')}</div><ul class="po-list">${a.decongest.map((d, n) =>
        `<li><span class="mono">${esc(d.line ? `${d.file}:${d.line}` : d.file)}</span>${d.runs && d.of ? ` <span class="badge">${d.runs} ${t('backlog_po.of_of_runs', { of: d.of })}</span>` : ''} ${esc(d.fix)}
          ${filed(n) ? `<span class="badge">${t('backlog_po.filed')}</span>` : `<button class="btn sm ghost" type="button" data-po-decongest="${n}" title="${t('backlog_po.file_this_fix_as_an_issue')}"${po.busy ? ' disabled' : ''}>${t('backlog_po.file_as_issue')}</button>`}
          ${po.notes[`decongest:${m}:${n}`] ? `<span class="small ${po.notes[`decongest:${m}:${n}`].error ? 'error' : 'muted'}">${esc(po.notes[`decongest:${m}:${n}`].text)}</span>` : ''}</li>`).join('')}</ul></div>`);
    }
    if (a.enrich?.length) {
      parts.push(`<div class="po-sec"><div class="sup-h">${t('backlog_po.enrich_first')}</div><ul class="po-list">${a.enrich.map((e) =>
        `<li>${issueRef(e.issue)} ${esc(e.reason)} <a class="small" href="${esc(e.link)}" target="_blank" rel="noopener" title="${t('backlog_po.add_what_is_missing_the_goal')}">${t('backlog_po.how_to_enrich')}</a></li>`).join('')}</ul></div>`);
    }
    // #124 / #138: issues too big for one run, and the epics section
    const msg = po.messages[m];
    if (msg) parts.push(window.BacklogPoProposals.splitsHtml(proposalsCtx(), msg), window.BacklogPoProposals.epicsHtml(proposalsCtx(), msg), window.BacklogPoProposals.specHtml(proposalsCtx(), msg)); // #670
    return parts.join('');
  }
  const proposalsCtx = () => ({
    messages: po.messages, projectId: po.projectId, busy: po.busy, issueRef, issueOf, render, setMessages: (list) => { po.messages = list; },
  });

  // #138: whether Create places the draft in its epic; the project's Auto-place option is the default
  const placeEpic = (m) => (m in po.placeEpic ? po.placeEpic[m] : !!actions()?.data()?.autoEpic);

  // The draft the owner can still file: the latest one, unless filed (not a preview) or discarded since
  // (the same rule as currentDraft in packages/engine/domains/po/product-owner.js).
  function openDraftIndex() {
    for (let i = po.messages.length - 1; i >= 0; i--) {
      const m = po.messages[i];
      if ((m.filed && !m.filed.preview) || m.discarded) return -1;
      if (m.role === 'po' && m.mode === 'issue' && (m.issue?.draft || m.issue?.existingIssue)) return i;
    }
    return -1;
  }

  // The issues the draft may go into instead: the one named by the owner or the PO, then the close ones.
  const candidates = (x) => [...new Set([x.existingIssue, ...(x.duplicates || []).filter((d) => d.state !== 'closed').map((d) => d.number)].filter(Boolean))].slice(0, MAX_CANDIDATES);

  // The workflow of Create + roadmap / Create + assign… (#195): the project's workflows that take a task (#791).
  function workflowSelect(m, busy) {
    const value = workflowFor(m);
    const def = DefaultWorkflow.current().file;
    const list = planWorkflows();
    const options = list.some((w) => w.file === value) ? list : [{ file: value, name: value }, ...list];
    return `<select class="po-wf" data-po-wf aria-label="${t('backlog_po.workflow_of_the_filed_issue')}" title="${t('backlog_po.the_workflow_create_roadmap_plans_it')}"${busy}>${options.map((w) =>
      `<option value="${esc(w.file)}"${w.file === value ? ' selected' : ''}>${esc(w.name || w.file)}${w.file === def ? ' (default)' : ''}</option>`).join('')}</select>`;
  }

  function draftActions(x, m) {
    const busy = po.busy ? ' disabled' : '';
    const note = po.notes[`draft:${m}`];
    const into = candidates(x);
    return `<div class="row po-draft-actions">
        ${x.draft ? `<button class="btn sm primary" type="button" data-po-act="create"${busy} title="${t('backlog_po.file_this_draft_as_a_new')}">${t('backlog_po.create')}</button>
        <button class="btn sm ghost" type="button" data-po-act="create-roadmap"${busy} title="${t('backlog_po.file_it_then_plan_it_as', { m: esc(DefaultWorkflow.label(workflowFor(m))) })}">${t('backlog_po.create_roadmap')}</button>
        ${workflowSelect(m, busy)}
        <button class="btn sm ghost" type="button" data-po-act="create-assign"${busy} title="${t('backlog_po.file_it_then_open_the_assign')}">${t('backlog_po.create_assign')}</button>` : ''}
        ${into.map((n) => `<button class="btn sm${x.draft ? ' ghost' : ' primary'}" type="button" data-po-act="append" data-n="${n}"${busy} title="${t('backlog_po.append_value_to_n_s_description', { value: x.existingIssue === n && x.addition ? t('backlog_po.the_addition') : t('backlog_po.this_draft'), n })}">${t('backlog_po.add_to')}${n}${x.draft ? t('backlog_po.instead') : ''}</button>
          <button class="link-btn small" type="button" data-po-act="comment" data-n="${n}"${busy} title="${t('backlog_po.add_it_as_a_comment_on', { n })}">${t('backlog_po.comment_on')}${n}</button>`).join('')}
        <button class="btn sm ghost" type="button" data-po-act="revise"${busy} title="${t('backlog_po.tell_the_product_owner_what_to')}">${t('backlog_po.revise')}</button>
        <button class="btn sm ghost" type="button" data-po-act="discard"${busy} title="${t('backlog_po.drop_this_draft_nothing_is_filed')}">${t('backlog_po.discard')}</button>
        ${note ? `<span class="small ${note.error ? 'error' : 'muted'}">${esc(note.text)}</span>` : ''}
      </div>`;
  }

  function issueHtml(x, m) {
    if (!x) return '';
    const parts = [];
    if (x.questions?.length) parts.push(`<ol class="po-list po-questions">${x.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>`);
    if (x.draft) {
      const d = x.draft;
      parts.push(`<div class="po-sec"><div class="sup-h">${t('backlog_po.draft')}</div><div class="po-draft">
        <div class="po-draft-title" title="${esc(d.title)}">${esc(d.title)}</div>
        <div class="po-draft-meta">${d.labels.map((l) => `<span class="badge">${esc(l)}</span>`).join('')}
          ${d.related.length ? `<span class="muted small">${t('backlog_po.related')}</span> ${d.related.map(issueRef).join('')}` : ''}</div>
        ${d.epic ? `<div class="po-draft-meta"><span class="muted small">${t('backlog_po.epic')}</span> <span class="badge bl-epic" title="${t('backlog_po.epic_epic', { epic: esc(d.epic) })}">${esc(d.epicTitle || d.epic)}</span>
          ${m === openDraftIndex() ? `<label class="check small" title="${t('backlog_po.create_also_places_the_new_issue')}"><input type="checkbox" data-po-epic${placeEpic(m) ? ' checked' : ''} /><span>${t('backlog_po.place_in_epic')}</span></label>` : ''}</div>` : ''}
        <div class="md md-compact po-draft-body">${markdownHtml(d.body)}</div>
      </div></div>`);
    }
    if (x.existingIssue && x.addition) {
      const i = issueOf(x.existingIssue);
      parts.push(`<div class="po-sec"><div class="sup-h">${t('backlog_po.addition_to')}${x.existingIssue}${i ? ` ${esc(i.title)}` : ''}</div><div class="po-draft">
        <div class="md md-compact po-draft-body">${markdownHtml(`## Update (${typeof TimeZone !== 'undefined' ? TimeZone.dayKey(Date.now(), TimeZone.current()) : new Date().toISOString().slice(0, 10)})\n\n${x.addition}`)}</div></div></div>`);
    }
    if (x.duplicates?.length) {
      parts.push(`<div class="po-sec"><div class="sup-h">${t('backlog_po.close_issues')}</div><ul class="po-list">${x.duplicates.map((d) =>
        `<li>${issueRef(d.number)} <span class="badge${d.relation === 'duplicate' ? ' warn' : ''}">${esc(d.relation)}</span> ${esc(d.title)}${d.state === 'closed' ? ` <span class="muted small">${t('backlog_po.closed')}</span>` : ''}${d.reason ? ` <span class="muted small">${esc(d.reason)}</span>` : ''}</li>`).join('')}</ul></div>`);
    }
    if (x.assumptions?.length) parts.push(`<details class="small"><summary class="muted">${t('backlog_po.assumptions_length', { length: x.assumptions.length })}</summary><ul class="po-list">${x.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></details>`);
    if (m === openDraftIndex()) parts.push(draftActions(x, m));
    return parts.join('');
  }

  function messageHtml(msg, m) {
    const time = msg.ts ? new Date(msg.ts).toLocaleTimeString(undefined, { timeZone: typeof TimeZone !== 'undefined' ? TimeZone.current() : undefined }) : '';
    // #240: another agent's request and its result, one card (agent-request.js)
    if (msg.role === 'request') return window.AgentRequest.cardHtml(msg, po.messages, { testid: 'po-request', owner: 'po', projectId: po.projectId });
    if (window.AgentRequest.inCard(msg)) return '';
    if (msg.role === 'user') {
      const files = [...(msg.issues || []).map(issueRef), ...(msg.attachments || []).map((f) => `<span class="badge" title="${esc(f)}">${esc(f.split(/[\\/]/).pop())}</span>`)].join(' ');
      const once = [msg.calibrationOverride ? window.PoCalibration.nameOf(msg.calibration) : '', msg.costOverride ? window.PoCalibration.cost.nameOf(msg.cost) : ''].filter(Boolean)
        .map((name) => ` · <span class="badge" title="${t('backlog_po.for_this_question_only_the_saved')}">${t('backlog_po.for')} ${esc(name)}</span>`).join('');
      return `<div class="sup-wmsg user" data-testid="po-message-you"><div class="sup-wmsg-meta">${t('backlog_po.you')} ${esc(time)}${once}</div><div>${esc(msg.text)}</div>${files ? `<div class="po-files">${files}</div>` : ''}</div>`;
    }
    // #189: the calibration it planned with (marked when it was for this question only)
    // #205: and the Cost step ("Planned for Speed · Economy")
    const once = msg.calibrationOverride || msg.costOverride;
    const calib = msg.calibration ? ` <span class="badge" title="${esc(`${once ? 'For this question only. ' : ''}${window.PoCalibration.tooltip(msg.calibration)}${msg.cost ? `\n\n${window.PoCalibration.cost.tooltip(msg.cost)}` : ''}`)}">${t('backlog_po.planned_for')} ${esc(window.PoCalibration.plannedFor(msg.calibration, msg.cost ?? null))}${once ? t('backlog_po.this_question') : ''}</span>` : '';
    const meta = `Product Owner · ${esc(time)}${msg.model ? ` · ${esc(msg.model)}` : ''} · ${esc(fmtCost(msg.costUsd || 0))}${calib}${msg.stopped ? ` <span class="badge warn" title="${t('backlog_po.you_stopped_this_turn_the_answer')}">${t('backlog_po.stopped')}</span>` : ''}`;
    return `<div class="sup-wmsg po-msg${msg.error ? ' error' : ''}" data-msg="${m}"><div class="sup-wmsg-meta">${meta}</div>
      <div class="md md-compact">${msg.error ? esc(msg.text) : markdownHtml(msg.text || '')}</div>
      ${msg.invalid ? `<p class="small muted">${t(msg.mode === 'issue' ? 'backlog_po.the_answer_had_no_valid_draft' : 'backlog_po.the_answer_had_no_valid_proposal', { invalid: esc(msg.invalid) })}</p>` : ''}
      ${answerHtml(msg.answer, m)}${issueHtml(msg.issue, m)}</div>`;
  }

  // Whether the conversation is scrolled to its end (or near it).
  const NEAR_END = 40;
  const atEnd = (log) => log.scrollHeight - log.scrollTop - log.clientHeight <= NEAR_END;
  // The question sent while the service answers it; once recorded (a history reloaded meanwhile,
  // open()), the conversation shows it and the pending bubble would repeat it (#148).
  const pendingShown = () => {
    const last = po.messages[po.messages.length - 1];
    return po.pending && !(last?.role === 'user' && last.text === po.pending);
  };

  // scroll (#148): 'keep' the owner's position (an applied group, a filing, an attachment, a mode
  // switch, a backlog refresh; a new message too), except that an owner at the end stays at the end
  // (so the question sent and the answer show up only then); 'end' when the drawer opens.
  function render({ scroll = 'keep' } = {}) {
    if (po.unread && watching()) po.unread = false;
    if (!po.unread) po.unreadCount = 0;
    renderButton();
    // #263: the Agents window's pane shows the same conversation
    if (winChat) winChat.update({ messages: po.messages, live: po.live, error: po.error, busy: po.busy, turn: turnFor(winChat) });
    window.AgentsWindow?.changed?.();
    if (!po.open) return;
    const agent = window.productOwnerAgent;
    const simulated = devMode();
    const issueMode = po.mode === 'issue';
    // registering an issue uses the issue tracker's cheaper analysis model (ISSUE_AGENT in packages/engine/domains/po/product-owner.js)
    const model = issueMode ? 'claude-sonnet-5 · medium' : `${agent?.model || 'claude-opus-5-5'}${agent?.effort && agent.effort !== 'default' ? ` · ${agent.effort}` : ''}`;
    // #235: what the drawer plans for, the project by its name
    $p('#po-for').textContent = !po.projectId ? t('backlog_po.choose_a_project_in_the_backlog')
      : issueMode ? t('backlog_po.registering_an_issue_for_value', { value: projectName() }) : t('backlog_po.planning_for_value', { value: projectName() });
    // cut with an ellipsis in a narrow drawer: the whole line on hover (no app tooltip there)
    $p('#po-for').title = $p('#po-for').textContent;
    $p('#po-sub').textContent = simulated ? t('backlog_po.simulated_developer_mode') : model;
    const log = $p('#po-log');
    const top = log.scrollTop;
    const toEnd = scroll === 'end' || atEnd(log);
    const cost = po.messages.reduce((a, x) => a + (x.costUsd || 0), 0);
    // #234: locked while a question is in flight (the text box stays free). Drawn before the chat's
    // update, so the chat locks them too while its send is still in flight after ask() has ended
    const off = po.busy ? ' disabled' : '';
    const chip = (key) => `<button class="chip" type="button" data-testid="po-pill" data-q="${esc(t(key))}"${off}>${esc(t(key))}</button>`;
    $p('#po-chips').innerHTML = issueMode ? '' : [...MAIN_QUESTIONS.map(chip),
      `<button class="chip" type="button" data-testid="po-pill" data-mode="issue"${off} title="${t('backlog_po.describe_an_issue_the_product_owner')}">${t('backlog.register_an_issue')}</button>`,
      ...(po.moreSuggestions ? MORE_QUESTIONS.map(chip) : [`<button class="chip" type="button" data-testid="po-suggestion-more" data-more${off}>${t('backlog_po.suggestions_more')}</button>`])].join('');
    $p('#po-chips').classList.toggle('hidden', issueMode);
    // #274: the messages, the question in flight, the live turn and the error, through the shared chat
    chat.update({ messages: po.messages, live: po.live, error: po.error, busy: po.busy, turn: turnFor(chat) });
    // #148: the simulation-only scenario picker (never in the production UI)
    $p('#po-sim').classList.toggle('hidden', !simulated);
    $p('#po-scenario').innerHTML = simulated ? SCENARIOS.map((s) => `<button type="button" class="po-sim-opt${s.id === po.scenario ? ' active' : ''}" data-po-scenario="${esc(s.id)}" aria-pressed="${s.id === po.scenario}"${po.busy ? ' disabled' : ''}>${esc(s.label)}</button>`).join('') : '';
    $p('#btn-po-plan').classList.toggle('hidden', !issueMode);
    $p('#btn-po-plan').disabled = po.busy;
    showNotice(po.notice);
    $p('#po-files').classList.toggle('hidden', !issueMode || !po.files.length);
    // #148: an attachment sent with the question in flight can't be removed until the answer
    const sent = po.busy ? ` disabled title="${t('backlog_po.already_sent_with_this_question_you')}"` : '';
    $p('#po-files').innerHTML = po.files.map((f, n) => `<span class="badge po-file" title="${esc(f.path)}"><span>${esc(f.name)}</span> <span class="muted">${esc(fmtSize(f.size))}</span><button type="button" data-po-unattach="${n}" aria-label="${t('backlog_po.remove_name', { name: esc(f.name) })}"${sent}>×</button></span>`).join('');
    $p('#btn-po-attach').classList.toggle('hidden', !issueMode);
    $p('#btn-po-attach').disabled = po.busy;
    // #169: the issues sent from the Backlog (plan questions only); a closed one is struck through
    const attached = !issueMode && po.attached.length;
    $p('#po-attached').classList.toggle('hidden', !attached);
    $p('#po-attached').innerHTML = attached ? `<span class="muted small">${t('backlog_po.attached')}</span>${po.attached.map((n) => {
      const i = issueOf(n);
      const closed = i?.state === 'closed';
      const tip = `${i ? `#${n} ${i.title}` : `#${n} (not synced)`}${closed ? ' · closed: left out of the proposal' : ''}`;
      return `<span class="badge po-file${closed ? ' closed' : ''}" title="${esc(tip)}"><span>#${n}</span> <span class="muted">${esc(i?.title || '')}</span><button type="button" data-po-unattach-issue="${n}" aria-label="${t('backlog_po.remove_n', { n })}"${po.busy ? ' disabled' : ''}>×</button></span>`;
    }).join('')}<button class="link-btn small" type="button" data-po-unattach-all${po.busy ? ' disabled' : ''} title="${t('backlog_po.ask_about_the_whole_backlog_again')}">${t('backlog_po.clear')}</button>` : '';
    $p('#po-question').placeholder = issueMode
      ? (openDraftIndex() >= 0 ? t('backlog_po.what_should_change_or_add_this') : t('backlog_po.describe_the_issue_in_a_few'))
      : attached ? t('backlog_po.ask_about_the_attached_issues') : t('backlog_po.ask_about_the_backlog_which_issues');
    $p('#btn-po-ask').textContent = issueMode ? t('backlog_po.send') : t('backlog_po.ask');
    $p('#btn-po-clear').disabled = po.busy || !po.messages.length;
    // #189: the calibration chip (backlog-po-settings.js)
    window.BacklogPoSettings?.renderChip({ busy: po.busy, issueMode });
    // #235: the Cost chip only where the Cost axis applies to the default workflow
    if (!costOn()) $p('#po-cost-chip').classList.add('hidden');
    $p('#po-note').textContent = `${simulated ? `Simulated: no model is called and nothing is spent.${issueMode ? ' Filing only previews: nothing reaches GitHub/GitLab.' : ''}` : 'Each question is one call to the model: it uses your Claude Code subscription.'}${cost ? ` Conversation cost ${fmtCost(cost)}.` : ''}`;
    // last: the footer above may have changed the log's height
    log.scrollTop = toEnd ? log.scrollHeight : top;
  }

  // #234: the log at its end, the question just sent stays in view above the live turn
  function questionInView() {
    const log = $p('#po-log');
    const you = [...log.querySelectorAll('[data-testid="po-message-you"]')].at(-1);
    const above = you ? you.getBoundingClientRect().top - log.getBoundingClientRect().top : 0;
    if (above < 0) log.scrollTop += above - 8;
  }

  // ---- applying a proposal (the owner's click) ------------------------------------------------------
  // #785: a recommendation as it goes to the roadmap or the Assign dialog: only what was chosen, with the owner's changes
  const withEdits = (g, key) => window.BacklogPoOptions.withEdits(g, po.edits[key], workflowOf(po.edits[key]?.workflow || g.workflow), po.runDefaults);
  const leftOut = (skipped) => (skipped.length ? ` Left out (not To do): ${skipped.map((n) => `#${n}`).join(', ')}.` : '');
  async function apply(act, el) {
    const box = el.closest('[data-msg]');
    const m = Number(box.dataset.msg);
    const given = po.messages[m]?.answer;
    if (!given) return;
    const answer = { ...given, groups: given.groups.map((g, n) => withEdits(g, `${m}:${n}`)) };
    // the items remember this answer: its groups show "In roadmap", issues planned before "Already in the roadmap" (#140)
    const origin = po.messages[m].ts;
    if (act === 'roadmap-all') {
      const stages = [...new Set(answer.groups.map((g) => g.stage))].sort((a, b) => a - b).map((s) => ({
        name: `Stage ${s} (Product Owner)`,
        note: '',
        items: answer.groups.map((g, n) => ({ g, n })).filter(({ g }) => g.stage === s).map(({ g, n }) => ({ workflow: g.workflow, issues: withExtras(g.issues, `${m}:${n}`), inputs: g.inputs, mock: !!state.simulationOnly, reason: g.reason, modeReason: g.modeReason, origin, ...(g.cost ? { cost: g.cost } : {}) })),
      }));
      try {
        const out = await api.proposeRoadmap(po.projectId, { stages }, false);
        actions().showRoadmap(out);
        po.notes[`${m}:all`] = { text: `Added to the roadmap as planned.${out.dropped?.length ? ` Already planned, left out: ${out.dropped.map((n) => `#${n}`).join(', ')}.` : ''}` };
      } catch (e) { po.notes[`${m}:all`] = { text: errMsg(e), error: true }; }
      render();
      return;
    }
    const n = Number(box.dataset.group);
    const st = groupState(answer.groups[n]);
    // an applied group is not applied again (#140); a partly applied one only for the rest
    if (applied(st)) return;
    const key = `${m}:${n}`;
    // the suggested issues the owner checked join the group (#169)
    const g = { ...answer.groups[n], issues: withExtras(st.kind === 'partly' ? st.rest : answer.groups[n].issues, key), origin };
    try {
      if (act === 'assign') {
        const skipped = await actions().assignGroup(g);
        po.notes[key] = skipped.length === g.issues.length ? { text: 'None of these issues is To do any more.', error: true } : skipped.length ? { text: leftOut(skipped).trim() } : null;
      } else {
        // the group's badge says where it went; only what was left out is noted
        const skipped = await actions().roadmapGroup(g);
        po.notes[key] = skipped.length ? { text: `Added as a new roadmap stage.${leftOut(skipped)}` } : null;
      }
    } catch (e) { po.notes[key] = { text: errMsg(e), error: true }; }
    render();
  }

  // #150: one hot spot of an answer's `decongest` filed as an issue; asks first, previews in developer or simulated mode
  async function fileDecongest(el) {
    const m = Number(el.closest('[data-msg]').dataset.msg);
    const n = Number(el.dataset.poDecongest);
    const msg = po.messages[m];
    const d = msg?.answer?.decongest?.[n];
    if (!d || po.busy) return;
    const key = `decongest:${m}:${n}`;
    const simulated = devMode();
    if (!simulated && !await confirmDialog(t('backlog_po.file_decongest_title', { target: d.line ? `${d.file}:${d.line}` : d.file }),t('backlog_po.an_issue_with_this_fix_is'), t('backlog_po.file'))) return;
    Object.assign(po, { busy: true, error: null });
    po.notes[key] = null;
    render();
    try {
      const out = await api.fileProductOwnerDecongest(po.projectId, msg.ts, n, simulated);
      po.messages = out.messages;
      if (out.backlog) actions().showData(out.backlog);
      if (out.syncError) po.notes[key] = { text: `Filed, but the backlog sync failed: ${out.syncError}`, error: true };
    } catch (e) {
      po.notes[key] = { text: errMsg(e), error: true };
    } finally {
      po.busy = false;
      render();
    }
  }

  // ---- filing a draft (the owner's click; Register an issue) ----------------------------------------
  // act: create | create-roadmap | create-assign | append | comment | revise | discard. A real filing
  // asks once more; developer or simulated mode only previews (the service never calls gh/glab then).
  async function fileDraft(act, el) {
    const m = Number(el.closest('[data-msg]').dataset.msg);
    const msg = po.messages[m];
    const x = msg?.issue;
    if (!x || po.busy) return;
    const key = `draft:${m}`;
    if (act === 'revise') { setMode('issue'); $p('#po-question').placeholder = t('backlog_po.what_should_change_in_the_draft'); return; }
    const n = Number(el.dataset.n) || null;
    const simulated = devMode();
    if (act === 'discard') {
      if (!await confirmDialog(t('backlog_po.discard_the_draft'), t('backlog_po.nothing_is_filed_the_conversation_keeps'), t('backlog_po.discard'))) return;
      try { po.messages = await api.discardProductOwnerDraft(po.projectId, msg.ts); } catch (e) { po.notes[key] = { text: errMsg(e), error: true }; }
      render();
      return;
    }
    const action = act.startsWith('create') ? 'create' : act;
    if (!simulated) {
      const what = action === 'create' ? [`Create the issue “${x.draft.title}”`, 'It is filed on the project\'s repository as shown.', 'Create']
        : action === 'append' ? [`Add to #${n}`, `The ${x.existingIssue === n && x.addition ? 'addition' : 'draft'} is appended to #${n}'s description as a dated section; the rest of it is kept.`, 'Add']
          : [`Comment on #${n}`, `The ${x.existingIssue === n && x.addition ? 'addition' : 'draft'} is added as a comment on #${n}.`, 'Comment'];
      if (!await confirmDialog(...what)) return;
    }
    Object.assign(po, { busy: true, error: null });
    po.notes[key] = null;
    render();
    try {
      const out = await api.fileProductOwnerDraft(po.projectId, msg.ts, action, n, simulated, action === 'create' && !!x.draft?.epic && placeEpic(m));
      po.messages = out.messages;
      if (out.backlog) actions().showData(out.backlog);
      if (out.syncError) po.notes[key] = { text: `Filed, but the backlog sync failed: ${out.syncError}`, error: true };
      const filed = !out.preview && out.filed?.number;
      markNextStepIssue(out);
      if (filed && act === 'create-roadmap') {
        await actions().roadmapGroup({ issues: [filed], workflow: workflowFor(m), inputs: {}, reason: 'Filed by the Product Owner.' });
      } else if (filed && act === 'create-assign') {
        await actions().assignGroup({ issues: [filed], workflow: workflowFor(m), inputs: {} });
      }
    } catch (e) {
      po.notes[key] = { text: errMsg(e), error: true };
    } finally {
      po.busy = false;
      render();
    }
  }
  // #744: an issue filed after the Next steps card's "Open the PO" marks its step done (project.js reads multiagent.nextStepsPoIssue)
  function markNextStepIssue(out) { const filed = !out.preview && out.filed?.number; if (filed && po.issueFor === po.projectId) { try { localStorage.setItem('craftorio.nextStepsPoIssue', JSON.stringify({ ...JSON.parse(localStorage.getItem('craftorio.nextStepsPoIssue') || '{}'), [po.projectId]: { issue: filed, url: out.filed.url || null } })); } catch { /* storage unavailable */ } } }

  // ---- the chat (#274) ------------------------------------------------------------------------------
  function emptyHtml() {
    const empty = po.mode === 'issue'
      ? 'Describe the issue in a few words: type it, dictate it, or paste a screenshot. I look at the code and the backlog for evidence and duplicates, ask a question if I must, and draft it. Nothing is filed until you click Create or Add to #n.'
      : 'I read the synced issues, the queue, the runs in progress and past runs (and the code, read-only), and propose which issues to run together, which not, and in what order. I never start runs or edit issues: you apply a proposal with a click.';
    return `<div class="po-empty"><span class="po-empty-robot" aria-hidden="true">${avatar()}</span>
        <p class="muted small">${empty}</p></div>`;
  }
  // #781: the working line: the issues it starts from, then the live turn's current step (the line animates its own "…")
  function workingLine(time) {
    const v = po.live ? window.LiveTurn.view(po.live) : null;
    const open = (window.BacklogActions?.data()?.issues || []).filter((i) => String(i.state).toLowerCase() === 'open').length;
    const said = !v || v.status === 'starting' ? open && t('backlog_po.reading_open_issues', { count: open }) : '';
    return { state: 'running', text: String(said || v?.label || t('backlog_po.product_owner_is_answering')).replace(/…$/, ''), meta: time };
  }
  // ask() keeps the turn's own state (busy, the live turn, unread); a failed one gives the question back
  // `from`: the chat the question is sent from (the drawer's or the Agents window's, #263): the other
  // one shows it as a turn started elsewhere
  const chatOptions = (from) => ({
    agent: 'Product Owner',
    renderMessage: (msg, m) => messageHtml(msg, m),
    emptyHtml,
    pendingHtml: () => (pendingShown() ? `<div class="sup-wmsg user" data-testid="po-message-you"><div class="sup-wmsg-meta">${t('backlog_po.you_2')}</div><div>${esc(po.pending)}</div></div>` : ''),
    // #234: no silent no-op when no project is selected (the text stays in the box)
    beforeSend: () => { if (po.projectId) return true; showNotice(NO_PROJECT); return false; },
    send: async (q) => { po.liveIn = from(); await ask(q); return po.error ? { ok: false } : null; },
    workingLine,
    onStop: stopTurn,
    onDone: () => render(),
  });
  // the question in flight as the other surface sees it (null for the chat it was sent from)
  const turnFor = (c) => (po.busy && po.liveIn !== c ? { text: po.pending, since: po.since } : null);
  const chat = window.AgentChat.create($p('#po-chat'), {
    ...chatOptions(() => chat),
    parts: { log: $p('#po-log'), input: $p('#po-question'), send: $p('#btn-po-ask'), working: $p('#po-working'), slots: { pills: $p('#po-chips') } },
  });

  // ---- events ----------------------------------------------------------------------------------------
  $p('#btn-bl-po').onclick = open;
  $p('#btn-po-close').onclick = close;
  $p('#po-backdrop').onclick = close;
  // #241: the owner's Do it / Dismiss / Undo on a request card (agent-request.js)
  window.addEventListener('agent-request:changed', async (e) => {
    const { owner, projectId, messages, error } = e.detail || {};
    if (owner !== 'po' || projectId !== po.projectId) return;
    try { po.messages = messages || await api.productOwnerHistory(projectId); } catch (err) { po.error = errMsg(err); }
    if (error) po.error = error;
    render();
  });
  $p('#po-scenario').onclick = (e) => { const b = e.target.closest('[data-po-scenario]'); if (b && !po.busy) setScenario(b.dataset.poScenario); };
  // a pasted screenshot becomes an attachment (and switches to Register an issue); text pastes as usual
  $p('#po-question').addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });
  const foot = $p('#po-drawer .po-foot');
  foot.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); foot.classList.add('dropping'); } });
  foot.addEventListener('dragleave', () => foot.classList.remove('dropping'));
  foot.addEventListener('drop', (e) => {
    foot.classList.remove('dropping');
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });
  $p('#btn-po-attach').onclick = () => $p('#po-file-input').click();
  $p('#po-file-input').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  $p('#po-files').onclick = (e) => {
    const b = e.target.closest('[data-po-unattach]');
    if (b && !po.busy) { po.files.splice(Number(b.dataset.poUnattach), 1); render(); }
  };
  $p('#po-attached').onclick = (e) => {
    const one = e.target.closest('[data-po-unattach-issue]');
    if (one) po.attached = po.attached.filter((n) => n !== Number(one.dataset.poUnattachIssue));
    else if (e.target.closest('[data-po-unattach-all]')) po.attached = [];
    else return;
    render();
    $p('#po-question').focus({ preventScroll: true });
  };
  $p('#btn-po-plan').onclick = () => setMode('plan');
  $p('#po-chips').onclick = (e) => {
    const c = e.target.closest('[data-q], [data-mode], [data-more]');
    if (c?.dataset.mode) setMode(c.dataset.mode);
    else if (c && 'more' in c.dataset) { if (!po.busy) { po.moreSuggestions = true; render(); } } else if (c) chat.ask(c.dataset.q);
  };
  const DRAFT_ACTS = ['append', 'comment', 'create', 'create-assign', 'create-roadmap', 'discard', 'revise'];
  // an applied group's badge (#140): the Roadmap at its stage, or its run; the drawer gives way
  const openStage = (n) => { close(); actions().openStage(n); };
  const openRun = (runId) => { close(); window.showRun(runId); };
  window.AgentsWindow?.onNavigate?.('product-owner:stage', openStage);
  window.AgentsWindow?.onNavigate?.('product-owner:run', openRun);
  // the conversation's own controls (proposals, drafts, extras); the Agents window's log gets the same handlers (#263)
  $p('#po-log').onclick = (e) => {
    // an applied group's badge (#140): the Roadmap at its stage, or its run
    // (in the Agents window, #263, they open in the main window: its page has no Roadmap or Run screen)
    const stage = e.target.closest('[data-po-stage]');
    if (stage) { if (!window.AgentsWindow?.toMainWindow?.('product-owner:stage', Number(stage.dataset.poStage))) openStage(Number(stage.dataset.poStage)); return; }
    const run = e.target.closest('[data-po-run]');
    if (run) { if (!window.AgentsWindow?.toMainWindow?.('product-owner:run', run.dataset.poRun)) openRun(run.dataset.poRun); return; }
    // a split's or an epic's buttons (#124, #138)
    if (window.BacklogPoProposals.onClick(e, proposalsCtx())) return;
    const epic = e.target.closest('[data-po-epic]');
    if (epic) { po.placeEpic[Number(epic.closest('[data-msg]').dataset.msg)] = epic.checked; return; }
    // a suggested extra issue kept in (or out of) its group (#169)
    const extra = e.target.closest('[data-po-extra]');
    if (extra) {
      const box = extra.closest('[data-group]');
      const key = `${box.dataset.msg}:${box.dataset.group}`;
      const x = Number(extra.dataset.poExtra);
      po.extras[key] = extra.checked ? [...extrasOf(key).filter((y) => y !== x), x] : extrasOf(key).filter((y) => y !== x);
      return;
    }
    const hot = e.target.closest('[data-po-decongest]');
    if (hot) { fileDecongest(hot); return; }
    // #791: Feature | Fix | Outro on a recommendation
    const kind = e.target.closest('[data-po-kind]');
    if (kind) {
      if (!kind.disabled) { window.BacklogPoKinds.choose(editOf(kind), groupOf(kind), kind.dataset.poKind, { project: projectRecord(), workflows: state.workflows || [] }); render(); }
      return;
    }
    // #785: a recommendation's "Editar" (the form) and "Mais" (the advanced lines)
    const toggle = e.target.closest('[data-testid="po-decisions-edit"], [data-testid="po-decisions-more"]');
    if (toggle) {
      const flag = toggle.dataset.testid === 'po-decisions-edit' ? 'open' : 'more';
      editOf(toggle)[flag] = !editOf(toggle)[flag];
      render();
      return;
    }
    const b = e.target.closest('[data-po-act]');
    if (!b) return;
    if (DRAFT_ACTS.includes(b.dataset.poAct)) fileDraft(b.dataset.poAct, b);
    else apply(b.dataset.poAct, b);
  };
  // #785: the owner's changes to a recommendation, kept by its place in the conversation
  const groupOf = (el) => { const box = el.closest('[data-group]'); return po.messages[Number(box.dataset.msg)]?.answer?.groups?.[Number(box.dataset.group)]; };
  function editOf(el) {
    const box = el.closest('[data-group]');
    const key = `${box.dataset.msg}:${box.dataset.group}`;
    po.edits[key] ||= { values: {} };
    return po.edits[key];
  }
  // a control of the form: a value back at what the card showed is no change; the workflow draws the form again
  function decisionChanged(el) {
    const edit = editOf(el);
    const g = groupOf(el);
    if (el.matches('[data-testid="po-decisions-workflow"]')) {
      window.BacklogPoKinds.pickForm(edit, g, el.value);
      render();
      return;
    }
    window.BacklogPoOptions.valueChanged(el, edit, g, workflowOf(edit.workflow || g.workflow), po.runDefaults);
  }
  const inDecisionsForm = (e) => !!e.target.closest?.('[data-testid="po-decisions-form"]');
  const onLogInput = (e) => (inDecisionsForm(e) ? decisionChanged(e.target) : window.BacklogPoProposals.onInput(e, proposalsCtx()));
  const onLogChange = (e) => {
    if (inDecisionsForm(e)) { decisionChanged(e.target); return; }
    // #791: a workflow picked in Outro
    if (e.target.matches('[data-po-kind-other]')) { window.BacklogPoKinds.pickOther(editOf(e.target), e.target.value); render(); return; }
    // a draft's workflow select (#195): kept for that draft, the Create + roadmap tooltip follows it
    if (e.target.matches('[data-po-wf]')) {
      draftWorkflow.set(Number(e.target.closest('[data-msg]')?.dataset.msg), e.target.value);
      render();
      return;
    }
    window.BacklogPoProposals.onInput(e, proposalsCtx());
  };
  $p('#po-log').addEventListener('input', onLogInput);
  $p('#po-log').addEventListener('change', onLogChange);
  // the Agents window's log (#263): the same click, input and change handlers as the drawer's
  const bindLog = (log) => {
    log.onclick = $p('#po-log').onclick;
    log.addEventListener('input', onLogInput);
    log.addEventListener('change', onLogChange);
  };
  $p('#btn-po-clear').onclick = async () => {
    if (!await confirmDialog(t('backlog_po.clear_the_conversation'), t('backlog_po.the_product_owner_forgets_this_project'), t('backlog_po.clear_2'))) return;
    try { po.messages = await api.clearProductOwner(po.projectId); Object.assign(po, { notes: {}, files: [], attached: [], extras: {} }); po.edits = {}; } catch (e) { po.error = errMsg(e); }
    render();
  };
  // capture: runs before app.js's Esc handler closes a dialog over the drawer
  document.addEventListener('keydown', (e) => {
    // the settings panel (#189) goes back to the conversation first
    if (e.key === 'Escape' && po.open && !document.querySelector('.modal:not(.hidden)') && !window.BacklogPoSettings?.close()) close();
  }, true);
  // #189: the saved calibration, model or effort changed (the settings panel): the chip and the model line follow
  document.addEventListener('po:settings', () => render());
  // #180: the turn in flight for this project, as the service reports it
  api.onChatProgress?.((p) => {
    if (p?.chat !== 'po' || p.key !== po.projectId || !po.live) return;
    window.LiveTurn.apply(po.live, p);
    renderLive();
  });
  // #263: the same events for a turn started in the other window (after the live turn above took them)
  api.onChatProgress?.((p) => {
    if (p?.chat !== 'po' || p.key !== po.projectId) return;
    if (!po.live || (p.phase === 'end' && po.elsewhere)) turnElsewhere(p);
  });
  // #263: a question sent from the other window (the Agents window or the main one): the service's
  // progress is the only sign of it here; the question comes with the history, the answer at the end
  async function turnElsewhere(p) {
    const projectId = po.projectId;
    if (p.phase === 'end') {
      if (!po.elsewhere) return;
      Object.assign(po, { busy: false, pending: null, live: null, liveIn: null, elsewhere: false });
      await loadHistory(projectId);
      if (po.projectId !== projectId) return;
      if (!watching()) po.unread = true;
      if (!watching()) po.unreadCount += 1;
      render();
      return;
    }
    if (po.busy) return;
    Object.assign(po, { busy: true, elsewhere: true, pending: '…', error: null, since: Date.now(), liveIn: null, live: window.LiveTurn.create({ agent: t('backlog_po.product_owner') }) });
    window.LiveTurn.apply(po.live, p);
    render({ scroll: 'end' });
    await loadHistory(projectId);
    if (po.projectId !== projectId || !po.elsewhere) return;
    const last = po.messages.at(-1);
    if (last?.role === 'user') po.pending = last.text;
    render({ scroll: 'end' });
  }
  document.addEventListener('robots:changed', (e) => { if (e.detail?.name === 'product-owner') renderButton(); });
  // the roadmap, queue or runs changed (backlog.js setData): the groups' applied state follows (#140),
  // the conversation keeps its scroll position (render's default)
  document.addEventListener('backlog:data', () => {
    if (po.open) render();
  });
  // the Epics view's "Organize into epics…" (#138): open the drawer and ask, as a plan question
  window.BacklogPO = {
    ask: async (question) => {
      await open();
      if (po.mode !== 'plan') setMode('plan');
      chat.ask(question);
    },
    // the Backlog's Send to Product Owner (#169)
    attach,
    open, // a `po` notification's click (#149, app.js openNotificationTarget)
    // the project whose drawer is open, for the notifications' window context (#149)
    openProjectId: () => (po.open ? po.projectId : null),
    syncSendButton,
  };
  // #744: the Next steps card's "Open the PO" (project.js): issue mode on that project; an issue filed then marks the step done (localStorage craftorio.nextStepsPoIssue)
  window.Actions?.register('openPoIssue', async (projectId) => { actions()?.focusProject(projectId); Object.assign(po, { issueFor: projectId }); await open(); setMode('issue'); });
  // #263: the Product Owner in the Agents window: the same conversation, a second chat in the pane
  window.AgentsWindow?.register({
    id: 'product-owner',
    name: 'Product Owner',
    order: 2,
    color: '#0F9F8F',
    avatar: () => avatar(),
    mount(el) {
      el.innerHTML = '<div class="drawer-body sup-body svc-body"><div class="svc-main po-window-chat"></div></div>';
      winChat = window.AgentChat.create(el.querySelector('.po-window-chat'), {
        ...chatOptions(() => winChat),
        agentId: 'product-owner',
        ids: { messages: 'po-log-window', input: 'po-question-window' },
        classes: { messages: 'svc-log po-log', form: 'svc-form', input: 'svc-input', send: 'svc-send' },
        placeholder: t('backlog_po.ask_the_product_owner_enter_to'),
      });
      bindLog(winChat.log);
      windowTries = 0;
      openInWindow();
      setTimeout(() => $p('#po-question-window')?.focus({ preventScroll: true }), 50);
    },
    unmount() {
      po.window = false;
      winChat = null;
    },
    unread: () => (po.unread && !po.busy ? Math.max(1, po.unreadCount) : 0),
    busy: () => po.busy,
    header: () => ({
      model: devMode() ? 'simulated' : `${window.productOwnerAgent?.model || ''}${window.productOwnerAgent?.effort && window.productOwnerAgent.effort !== 'default' ? ` · ${window.productOwnerAgent.effort}` : ''}`,
      cost: po.messages.reduce((a, x) => a + (x.costUsd || 0), 0),
      note: !po.projectId ? 'Choose a project in the Backlog first' : `Planning for ${projectName()}`,
    }),
  });
  renderButton();
})();
