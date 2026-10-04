// Backlog › Product Owner (#105): the floating robot button at the bottom right of the Backlog opens
// the Product Owner's drawer (#po-drawer): suggested questions as chips, a free text box, and the
// project's conversation (kept by the service until cleared, src/product-owner.js). Each answer
// shows its cost and, when it has them, the proposed groups (issues, workflow, inputs, why, files,
// stage, size: complexity, an estimate from past runs, warnings), the issues that must not run in
// parallel and the issues to enrich first. A group is applied only on the owner's click: Assign
// (the assign dialog prefilled) or Add to roadmap (a new stage), through window.BacklogActions
// (backlog.js); "Add all to the roadmap" sends the groups as planned stages (api.proposeRoadmap).
// A group already applied (#140, `groupState`, derived from the Backlog's roadmap, queue and runs)
// stays in the conversation dimmed, with a badge (In roadmap · Stage N, a link to the Roadmap; Queued;
// Running, a link to the run) and its buttons disabled; a partly applied one offers "Add the rest".
// Register an issue (#117, the #po-mode toggle or its chip): the owner describes an issue (typed,
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
// (MOCK_SCENARIOS in src/product-owner.js: a question, a draft, a duplicate, an error, large answers,
// applied groups, a long attachments list) to click through every state by hand or in a smoke check.
// The conversation keeps the owner's scroll position on every render; a new message (the question
// sent, the answer) scrolls to the end only when the owner was already there (#148). While a
// question is in flight its attachments can't be removed: they were sent with it.
// An answer the owner has not seen (the drawer closed, or another screen) puts a yellow dot on the
// robot button until the drawer opens (#149, po.unread); the service also notifies it (`po` notice).
// A proposed group's card (#216): the workflow by its name with its inputs as pills
// (WorkflowInputs.inputPills, the Cost step's choices too), then labelled sections (Why, Mode as
// Markdown; Files; Estimate with the time, Estimates.formatMinutes) and the warnings as a callout.
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
// a working line under the pills (#po-working) shows the elapsed time; a click with no project says
// so (#po-notice). The workflow a plan is for (#235, #po-workflow, Plan mode): the workflows that take
// a task by their display name, starting on the last one chosen for the project (localStorage), else
// the default (DefaultWorkflow); its own options below (#po-workflow-options, WorkflowInputs.formHtml,
// never task, issue(s), base_branch or paths) go with the question (api.askProductOwner's `workflow`
// and `inputs`) and into every group. The Cost chip shows only where the Cost axis applies
// (PoCalibration.costApplies: not on a tests-first workflow). The header (#po-for) names the project
// and the workflow ("Planning for <project> · <workflow>").
// The conversation, the text box, Ask and the working line go through the agents' shared chat (#274,
// agent-chat.js, adopting #po-chat's markup): the box empties as soon as Ask is clicked and gets the
// question back when it fails; the pills (#po-chips, its 'pills' slot) and BacklogPO.ask send through it.
// load: after robots.js agent-chat.js views/backlog/backlog.js (the button's robot is drawn and the drawer wired as it loads)
/* global api, Robots */
(() => {
  const QUESTIONS = [
    'Analyze the backlog and propose runs',
    'What should not run together?',
    'Build a roadmap',
    'Which issues are too big or unclear?',
    'Which issues are too big to run as one?',
    'Organize the open issues into epics',
  ];
  const REGISTER = 'Register an issue';
  // the workflow a filed issue is planned or assigned with: the default development workflow (#195,
  // Settings › General › Backlog) unless picked in the select next to Create + roadmap (per draft)
  const draftWorkflow = new Map(); // message index → the workflow picked
  const workflowFor = (m) => draftWorkflow.get(m) || DefaultWorkflow.current().file;
  const MAX_CANDIDATES = 3;
  // #169: the question the drawer suggests for issues sent from the Backlog (the owner may edit it)
  const SELECTION_QUESTION = 'What is the best strategy to put these issues in the roadmap? Should any other open issue join them?';
  // attached: issue numbers sent from the Backlog (#169); extras: `${m}:${n}` → the suggested issues checked in a group
  // unread: an answer the owner has not seen yet (#149); scenario: the simulated answer forced (#148)
  const po = { open: false, busy: false, projectId: null, messages: [], pending: null, error: null, notes: {}, mode: 'plan', files: [], placeEpic: {}, attached: [], extras: {}, unread: false, scenario: '', live: null, since: 0, notice: '', workflow: null, optionsFor: '' };
  const NO_PROJECT = 'Choose a project in the Backlog first: the Product Owner plans for the project of the Backlog\'s project select.';
  const $p = (sel) => document.querySelector(sel);
  const actions = () => window.BacklogActions;
  const issueOf = (n) => (actions()?.data()?.issues || []).find((i) => i.number === n);
  const avatar = (st = 'idle') => (window.Robots ? Robots.svg('product-owner', st, { bubble: false, plaque: '' }) : '');
  // #148: the simulated answers the picker forces (ids of MOCK_SCENARIOS, src/product-owner.js); `mode`:
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
  const watching = () => (po.open && state.view === 'backlog' && !document.hidden) || (po.open && state.view === 'roadmap' && !document.hidden);

  function renderButton() {
    // #149: the sidebar's yellow status dot while an answer is unseen (the robot thinks while busy)
    const unread = po.unread && !po.busy;
    const b = $p('#btn-bl-po');
    b.innerHTML = avatar() + (unread ? '<span class="status-dot" aria-hidden="true"></span>' : '');
    b.classList.toggle('st-waiting', unread);
    b.setAttribute('aria-label', unread ? 'Product Owner: a new answer' : 'Product Owner');
    $p('#po-avatar').innerHTML = avatar(po.busy ? 'thinking' : 'idle');
    syncSendButton();
  }

  // The Backlog's Send to Product Owner (n) (#169): disabled while a question is in flight.
  function syncSendButton() {
    const b = $p('#btn-bl-send-po');
    if (!b) return;
    b.disabled = po.busy;
    b.textContent = po.busy ? 'Product Owner is answering…' : `Send to Product Owner (${b.dataset.n || 0})`;
    b.title = po.busy ? 'Product Owner is answering: wait for the answer' : 'Ask the Product Owner about the selected issues before planning them';
  }

  async function open() {
    // #234: with no project selected the drawer opens and says so (nothing can be asked)
    const projectId = actions()?.projectId() || null;
    // attachments not sent yet belong to the other project's conversation
    if (po.projectId !== projectId) po.files = [];
    if (po.projectId !== projectId) po.placeEpic = {};
    if (po.projectId !== projectId) Object.assign(po, { attached: [], extras: {} });
    if (po.projectId !== projectId) Object.assign(po, { projectId, messages: [], pending: null, error: null, notes: {} });
    Object.assign(po, { open: true, unread: false });
    po.notice = projectId ? '' : NO_PROJECT;
    $p('#po-drawer').classList.add('open');
    $p('#po-drawer').setAttribute('aria-hidden', 'false');
    $p('#po-backdrop').classList.remove('hidden');
    window.reportNotifyContext?.();
    // #235: the workflow last chosen for this project (the list may have changed meanwhile)
    po.workflow = chosenWorkflow();
    renderWorkflow();
    render({ scroll: 'end' });
    if (!projectId) return;
    // while a question is in flight the service already recorded it: render() leaves out the pending bubble
    // (no history yet may come back empty-handed: an empty conversation;
    // and one that comes back after the drawer moved to another project is not this one's)
    try {
      const messages = await api.productOwnerHistory(projectId) || [];
      if (po.projectId === projectId) po.messages = messages;
    } catch (e) { po.error = errMsg(e); }
    // a draft still to file: back to Register an issue
    if (openDraftIndex() >= 0 && !po.busy) po.mode = 'issue';
    render({ scroll: 'end' });
    setTimeout(() => $p('#po-question').focus({ preventScroll: true }), 200);
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
    const mode = po.mode;
    const files = mode === 'issue' ? po.files.map((f) => f.path) : [];
    // #169: the attached issues go with every plan question until the owner removes them
    const issues = mode === 'plan' ? [...po.attached] : [];
    // #189: the chip's step for this question only; the next question uses the saved one again
    const calibration = mode === 'plan' ? window.BacklogPoSettings?.override() ?? null : null;
    // #205: the Cost chip's step, the same way
    const cost = mode === 'plan' ? window.BacklogPoSettings?.costOverride?.() ?? null : null;
    if (mode === 'plan') window.BacklogPoSettings?.clearOverride();
    // #235: the workflow chosen in the drawer and its options, for every group of the plan; no Cost
    // step where the Cost axis does not apply to it (the chip is hidden then)
    const workflow = mode === 'plan' ? po.workflow || null : null;
    const inputs = mode === 'plan' ? window.WorkflowInputs?.read($p('#po-workflow-options'), { all: true }) ?? null : null;
    const costOff = !!workflow && window.PoCalibration?.costApplies?.((state.workflows || []).find((w) => w.file === workflow)) === false;
    Object.assign(po, { busy: true, pending: q, error: null, notice: '', since: Date.now(), live: window.LiveTurn.create({ agent: 'Product Owner' }) });
    // #234: the question and the live turn in view, whatever the scroll position was
    render({ scroll: 'end' });
    if (po.open) questionInView();
    // #180: the timer and "Still working" move even when no item arrives
    const tick = setInterval(renderLive, 1000);
    try {
      // #148: the simulation-only scenario picker forces the simulated answer
      const out = await api.askProductOwner(projectId, q, devMode(), mode, files, issues, devMode() ? po.scenario || null : null, calibration, costOff ? null : cost, workflow, inputs);
      if (po.projectId === projectId) {
        po.messages = out.messages;
        if (mode === 'issue') po.files = [];
        // #149: the answer arrived while the owner was not looking at the drawer
        if (!watching()) po.unread = true;
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
      ? `${time}≈ $${Number(g.costEstimate.usd).toFixed(2)} <span class="muted" title="${esc(g.costEstimate.basis)}">(estimate from ${g.costEstimate.runs} past run${g.costEstimate.runs > 1 ? 's' : ''}${g.costEstimate.estimated ? ', partly from token prices' : ''})</span>`
      : g.estimate
      ? `${time}≈ $${Number(g.estimate.costUsd).toFixed(2)} <span class="muted">(estimate from ${esc(g.estimate.basis)})</span>`
      : '<span class="muted">no past run to estimate from</span>';
    return `complexity ${g.complexity}${g.guessed ? ' <span class="muted" title="Some issues have no complexity:n label: counted as 3">(some guessed)</span>' : ''} · ${est}`;
  };

  // ---- a group already applied (#140): derived from the Backlog's data (its issues' roadmap place,
  // queue entry and live run), never remembered, so it holds after a reopen or a restart ------------
  const liveRun = (i) => i?.runs?.find((x) => !x.enrich && ['pending', 'running'].includes(x.status));
  // An issue is "in the roadmap" when an item plans it, runs it or has done it (a skipped one is not).
  const inRoadmap = (i) => !!i?.roadmap && i.roadmap.status !== 'skipped';
  /**
   * { kind: 'roadmap' | 'running' | 'queued' | 'partly' | null, stages: [n], covered: [numbers], rest: [numbers], runId }:
   * every issue in the roadmap (or assigned), some of them (partly), or none (null: the group is still to apply).
   * A simulated answer's group may add issues counted as in the roadmap at a stage (`g.simulated`, #148).
   */
  function groupState(g) {
    const issues = g.issues.map((n) => ({ n, i: issueOf(n) }));
    const sim = (n) => !!g.simulated?.covered?.includes(n);
    const covered = issues.filter(({ n, i }) => sim(n) || inRoadmap(i) || i?.queued || liveRun(i));
    const rest = issues.filter((x) => !covered.includes(x)).map(({ n }) => n);
    const stages = [...new Set(covered.map(({ n, i }) => (inRoadmap(i) ? i.roadmap.stage : sim(n) ? g.simulated.stage : null)).filter((s) => s != null))].sort((a, b) => a - b);
    const run = covered.map(({ i }) => liveRun(i)).find(Boolean);
    const out = { stages, covered: covered.map(({ n }) => n), rest, runId: run?.runId || null };
    if (!covered.length) return { ...out, kind: null };
    if (rest.length) return { ...out, kind: 'partly' };
    return { ...out, kind: stages.length ? 'roadmap' : run ? 'running' : 'queued' };
  }
  const stagesLabel = (s) => (s.length > 1 ? `Stages ${s.join(', ')}` : `Stage ${s[0]}`);

  // The badge of an applied group: a link to the roadmap stage or to the run.
  function appliedBadge(st, already) {
    if (st.kind === 'roadmap') {
      const label = already ? 'Already in the roadmap' : `In roadmap · ${stagesLabel(st.stages)}`;
      return `<button class="badge po-applied" type="button" data-po-stage="${st.stages[0]}" title="Open the Roadmap at stage ${st.stages[0]}">${esc(label)}</button>`;
    }
    if (st.kind === 'running' && st.runId) return `<button class="badge po-applied live" type="button" data-po-run="${esc(st.runId)}" title="Open run ${esc(st.runId)}">Running</button>`;
    if (st.kind === 'running' || st.kind === 'queued') return '<span class="badge po-applied" title="Assigned: in the queue, it starts when a slot is free">Queued</span>';
    if (st.kind === 'partly') {
      const where = st.stages.length ? 'in the roadmap' : 'assigned';
      return `<span class="badge warn" title="${esc(`${st.covered.map((x) => `#${x}`).join(', ')} already ${where}; ${st.rest.map((x) => `#${x}`).join(', ')} not yet`)}">Partly ${where} (${esc(st.covered.map((x) => `#${x}`).join(', '))})</span>`;
    }
    return '';
  }
  const applied = (st) => ['queued', 'roadmap', 'running'].includes(st.kind);
  const appliedTitle = (st) => (st.kind === 'roadmap' ? `Already in the roadmap, ${stagesLabel(st.stages).toLowerCase()}` : st.kind === 'running' ? 'Already assigned: its run is in progress' : 'Already assigned: it is in the queue');

  // #169: open issues the owner did not attach that could join the group, each unchecked until the
  // owner keeps it (po.extras); only the checked ones go with Assign…, Add to roadmap and Add all
  const extrasOf = (key) => po.extras[key] || [];
  const withExtras = (issues, key) => [...issues, ...extrasOf(key).filter((x) => !issues.includes(x) && issueOf(x)?.state !== 'closed')];
  function suggestedHtml(g, key, done) {
    if (!g.suggested?.length) return '';
    return `<div class="po-suggested"><div class="small muted">Could join (suggested, not selected)</div>
      ${g.suggested.map((s) => {
        const i = issueOf(s.issue);
        const tip = `${i ? `#${s.issue} ${i.title}` : `#${s.issue}`}${s.reason ? ` · ${s.reason}` : ''}`;
        return `<label class="check small" title="${esc(tip)}"><input type="checkbox" data-po-extra="${s.issue}"${extrasOf(key).includes(s.issue) ? ' checked' : ''}${done ? ' disabled' : ''} />
          <span>${issueRef(s.issue)} ${esc(i?.title || '')}${s.reason ? ` <span class="muted">${esc(s.reason)}</span>` : ''}</span></label>`;
      }).join('')}</div>`;
  }

  // #216: the files a group touches, as code paths (the first FILES_SHOWN, the rest folded)
  const FILES_SHOWN = 3;
  const filesHtml = (files) => {
    const li = (f) => `<li><code>${esc(f)}</code></li>`;
    const rest = files.slice(FILES_SHOWN);
    return `<ul class="po-files">${files.slice(0, FILES_SHOWN).map(li).join('')}</ul>${rest.length
      ? `<details class="po-files-more"><summary class="small muted">+${rest.length} more</summary><ul class="po-files">${rest.map(li).join('')}</ul></details>` : ''}`;
  };
  const workflowOf = (file) => (state.workflows || []).find((w) => w.file === file) || null;
  // A workflow as people read it: software-development-local-hero → "Software development, local
  // hero" (the variant of another workflow after a comma), ai-development → "AI development".
  const VARIANTS = [
    'local-hero',
  ];
  const words = (slug) => WorkflowInputs.humanize(slug).replace(/\b(ai|ci|e2e|pr|ui)\b/gi, (m) => m.toUpperCase());
  function workflowTitle(wf, file) {
    const slug = String(wf?.name || file || '').replace(/\.ya?ml$/i, '');
    // a known variant names its base even when the base workflow is not installed (#235: AI Development, local hero)
    const variant = VARIANTS.find((v) => slug.endsWith(`-${v}`));
    const base = (state.workflows || []).map((w) => w.name).filter((s) => s && slug.startsWith(`${s}-`)).sort((a, b) => b.length - a.length)[0]
      || (variant ? slug.slice(0, -variant.length - 1) : '');
    return base ? `${words(base)}, ${words(slug.slice(base.length + 1)).replace(/^\w/, (c) => c.toLowerCase())}` : words(slug);
  }

  // ---- the workflow a plan is for (#235) ----------------------------------------------------------
  // its options leave out what the Backlog sets per run (the task, the issues, the repository, the
  // branch) and the project's language (detected from its files when the run starts: a default here
  // would override it in every group)
  const SKIP_INPUTS = [
    'base_branch',
    'issue',
    'issues',
    'language',
    'repo_path',
    'task',
  ];
  const isPathInput = (key) => /path|dir/i.test(key);
  const workflowKey = (projectId) => `po.workflow.${projectId}`;
  const planWorkflows = () => (state.workflows || []).filter((w) => !w.error && w.inputs?.task);
  /** The workflow last chosen for the project, else the default development workflow. */
  function chosenWorkflow() {
    let saved = null;
    try { saved = po.projectId ? localStorage.getItem(workflowKey(po.projectId)) : null; } catch { /* none */ }
    return saved && planWorkflows().some((w) => w.file === saved) ? saved : DefaultWorkflow.current().file;
  }
  const optionDefs = (wf) => Object.fromEntries(Object.entries(wf?.inputs || {}).filter(([k]) => !SKIP_INPUTS.includes(k) && !isPathInput(k)));
  // the Cost chip and its steps: not on a tests-first workflow, nor one without the inputs it sets
  const costOn = () => window.PoCalibration.costApplies(workflowOf(po.workflow));

  // The select and the chosen workflow's options; the options are drawn again only when the
  // workflow (or the project) changed, so what the owner set stays while the drawer redraws.
  function renderWorkflow() {
    const file = po.workflow || chosenWorkflow();
    const list = planWorkflows();
    const options = list.some((w) => w.file === file) ? list : [{ file, name: file }, ...list];
    const select = $p('#po-workflow');
    select.innerHTML = options.map((w) => `<option value="${esc(w.file)}"${w.file === file ? ' selected' : ''}>${esc(workflowTitle(w, w.file))}</option>`).join('');
    select.value = file;
    const key = `${po.projectId}:${file}`;
    if (po.optionsFor === key) return;
    po.optionsFor = key;
    const defs = optionDefs(workflowOf(file));
    const box = $p('#po-workflow-options');
    box.innerHTML = Object.keys(defs).length
      ? `<div class="po-wf-fields"${WorkflowInputs.scopeAttrs()}>${WorkflowInputs.formHtml(defs, { id: (k) => `po-wi-${k}` })}</div>` : '';
    box.classList.toggle('hidden', !Object.keys(defs).length);
  }

  function chooseWorkflow(file) {
    if (!file || file === po.workflow) return;
    po.workflow = file;
    try { if (po.projectId) localStorage.setItem(workflowKey(po.projectId), file); } catch { /* not remembered */ }
    renderWorkflow();
    render();
  }

  const projectName = () => actions()?.project?.()?.name || (state.projects || []).find((p) => p.id === po.projectId)?.name || po.projectId;
  function groupHtml(g, m, n) {
    const wf = workflowOf(g.workflow);
    const key = `${m}:${n}`;
    const st = groupState(g);
    const done = applied(st);
    // planned, but by none of this answer's items (the roadmap records each item's origin): they were
    // already planned, e.g. "Add all" left them out
    const from = po.messages[m]?.ts;
    const already = st.kind === 'roadmap' && g.issues.every((x) => issueOf(x)?.roadmap?.origin !== from);
    const off = done ? ` disabled title="${esc(appliedTitle(st))}"` : '';
    return `
      <div class="po-group${done ? ' applied' : ''}" data-msg="${m}" data-group="${n}">
        <div class="po-group-head">
          <span class="badge">stage ${g.stage}</span>
          <b>${esc(g.name)}</b>
          <span class="po-issues">${g.issues.map(issueRef).join('')}</span>
          ${appliedBadge(st, already)}
        </div>
        <div class="po-wf"><span class="badge po-wf-name" title="${esc(g.workflow)}">${esc(workflowTitle(wf, g.workflow))}</span>${WorkflowInputs.inputPills(wf, g.inputs, { defaults: true })}</div>
        <dl class="po-secs small">
          ${g.reason ? `<dt>Why</dt><dd class="md md-compact">${markdownHtml(g.reason)}</dd>` : ''}
          ${g.modeReason ? `<dt>Mode</dt><dd class="md md-compact">${markdownHtml(g.modeReason)}</dd>` : ''}
          ${g.files?.length ? `<dt>Files</dt><dd>${filesHtml(g.files)}</dd>` : ''}
          <dt>Estimate</dt><dd class="po-size">${sizeText(g)}</dd>
          ${g.cost ? `<dt>Cost</dt><dd>${costHtml(g)}</dd>` : ''}
        </dl>
        ${g.warnings?.length ? `<div class="po-callout warn small" role="note">${g.warnings.map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
        ${suggestedHtml(g, key, done)}
        <div class="row po-group-actions">
          <button class="btn sm primary" type="button" data-po-act="assign"${off || ' title="Open the assign dialog with these issues as one run"'}>Assign…</button>
          ${st.kind === 'partly'
            ? `<button class="btn sm ghost" type="button" data-po-act="roadmap" title="${esc(`Plan ${st.rest.map((x) => `#${x}`).join(', ')} as a new stage at the end of the roadmap`)}">Add the rest</button>`
            : `<button class="btn sm ghost" type="button" data-po-act="roadmap"${off || ' title="Plan this group as a new stage at the end of the roadmap"'}>Add to roadmap</button>`}
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
    return `<div class="po-cost"><span class="badge po-cost-name" title="${esc(tip)}">${esc(g.cost.name)}</span>${WorkflowInputs.inputPills(workflowOf(g.workflow), g.cost.inputs, { defaults: true })}${g.cost.grouping ? ` <span class="muted">${esc(g.cost.grouping)}</span>` : ''}${(g.cost.notAdjustable || []).some((x) => /^Agents/.test(x)) ? ' <span class="muted">· agents: not adjustable</span>' : ''}</div>`;
  }

  function answerHtml(a, m) {
    if (!a) return '';
    const parts = [];
    // #206: the plan's estimated total
    if (a.estimateUsd != null && a.groups?.length) parts.push(`<div class="small"><span class="badge" title="The sum of the groups' estimates from past runs${a.estimateMissing ? `; ${a.estimateMissing} group(s) have no estimate yet` : ''}">Plan ≈ $${Number(a.estimateUsd).toFixed(2)}</span>${a.estimateMissing ? ` <span class="muted">${a.estimateMissing} without an estimate</span>` : ''}</div>`);
    if (a.groups?.length) {
      const allDone = a.groups.every((g) => applied(groupState(g)));
      const allTitle = allDone ? 'Every group is already in the roadmap or assigned' : 'Every group as a planned stage (by its stage number) at the end of the roadmap';
      parts.push(`<div class="po-sec"><div class="sup-h">Proposed runs</div>${a.groups.map((g, n) => groupHtml(g, m, n)).join('')}
        <div class="row"><button class="btn sm ghost" type="button" data-po-act="roadmap-all" data-msg="${m}" title="${allTitle}"${allDone ? ' disabled' : ''}>Add all to the roadmap</button>
        ${po.notes[`${m}:all`] ? `<span class="small ${po.notes[`${m}:all`].error ? 'error' : 'muted'}">${esc(po.notes[`${m}:all`].text)}</span>` : ''}</div></div>`);
    }
    // #169: attached issues closed meanwhile are in no group
    if (a.closed?.length) parts.push(`<div class="small muted">Left out (closed): ${a.closed.map(issueRef).join(' ')}</div>`);
    if (a.conflicts?.length) {
      parts.push(`<div class="po-sec"><div class="sup-h">Do not run in parallel</div><ul class="po-list">${a.conflicts.map((c) =>
        `<li>${c.issues.map(issueRef).join(' ⟷ ')} ${esc(c.reason)}${c.files?.length ? ` <span class="muted mono small">${c.files.map(esc).join(', ')}</span>` : ''}</li>`).join('')}</ul></div>`);
    }
    if (a.enrich?.length) {
      parts.push(`<div class="po-sec"><div class="sup-h">Enrich first</div><ul class="po-list">${a.enrich.map((e) =>
        `<li>${issueRef(e.issue)} ${esc(e.reason)} <a class="small" href="${esc(e.link)}" target="_blank" rel="noopener" title="Enrich an issue (#103)">how to enrich (#103)</a></li>`).join('')}</ul></div>`);
    }
    // #124 / #138: issues too big for one run, and the epics section
    const msg = po.messages[m];
    if (msg) parts.push(window.BacklogPoProposals.splitsHtml(proposalsCtx(), msg), window.BacklogPoProposals.epicsHtml(proposalsCtx(), msg));
    return parts.join('');
  }
  const proposalsCtx = () => ({
    messages: po.messages, projectId: po.projectId, busy: po.busy, issueRef, issueOf, render, setMessages: (list) => { po.messages = list; },
  });

  // #138: whether Create places the draft in its epic; the project's Auto-place option is the default
  const placeEpic = (m) => (m in po.placeEpic ? po.placeEpic[m] : !!actions()?.data()?.autoEpic);

  // The draft the owner can still file: the latest one, unless filed (not a preview) or discarded since
  // (the same rule as currentDraft in src/product-owner.js).
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

  // The workflow of Create + roadmap / Create + assign… (#195): the workflows that take a task.
  function workflowSelect(m, busy) {
    const value = workflowFor(m);
    const def = DefaultWorkflow.current().file;
    const list = (state.workflows || []).filter((w) => !w.error && w.inputs?.task);
    const options = list.some((w) => w.file === value) ? list : [{ file: value, name: value }, ...list];
    return `<select class="po-wf" data-po-wf aria-label="Workflow of the filed issue" title="The workflow Create + roadmap plans it with (the default comes from Settings › General › Backlog)"${busy}>${options.map((w) =>
      `<option value="${esc(w.file)}"${w.file === value ? ' selected' : ''}>${esc(w.name || w.file)}${w.file === def ? ' (default)' : ''}</option>`).join('')}</select>`;
  }

  function draftActions(x, m) {
    const busy = po.busy ? ' disabled' : '';
    const note = po.notes[`draft:${m}`];
    const into = candidates(x);
    return `<div class="row po-draft-actions">
        ${x.draft ? `<button class="btn sm primary" type="button" data-po-act="create"${busy} title="File this draft as a new issue">Create</button>
        <button class="btn sm ghost" type="button" data-po-act="create-roadmap"${busy} title="File it, then plan it as a new roadmap stage (${esc(DefaultWorkflow.label(workflowFor(m)))})">Create + roadmap</button>
        ${workflowSelect(m, busy)}
        <button class="btn sm ghost" type="button" data-po-act="create-assign"${busy} title="File it, then open the assign dialog with it">Create + assign…</button>` : ''}
        ${into.map((n) => `<button class="btn sm${x.draft ? ' ghost' : ' primary'}" type="button" data-po-act="append" data-n="${n}"${busy} title="Append ${x.existingIssue === n && x.addition ? 'the addition' : 'this draft'} to #${n}'s description as a dated section, keeping what is there">Add to #${n}${x.draft ? ' instead' : ''}</button>
          <button class="link-btn small" type="button" data-po-act="comment" data-n="${n}"${busy} title="Add it as a comment on #${n} instead">comment on #${n}</button>`).join('')}
        <button class="btn sm ghost" type="button" data-po-act="revise"${busy} title="Tell the Product Owner what to change">Revise</button>
        <button class="btn sm ghost" type="button" data-po-act="discard"${busy} title="Drop this draft: nothing is filed">Discard</button>
        ${note ? `<span class="small ${note.error ? 'error' : 'muted'}">${esc(note.text)}</span>` : ''}
      </div>`;
  }

  function issueHtml(x, m) {
    if (!x) return '';
    const parts = [];
    if (x.questions?.length) parts.push(`<ol class="po-list po-questions">${x.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>`);
    if (x.draft) {
      const d = x.draft;
      parts.push(`<div class="po-sec"><div class="sup-h">Draft</div><div class="po-draft">
        <div class="po-draft-title" title="${esc(d.title)}">${esc(d.title)}</div>
        <div class="po-draft-meta">${d.labels.map((l) => `<span class="badge">${esc(l)}</span>`).join('')}
          ${d.related.length ? `<span class="muted small">Related</span> ${d.related.map(issueRef).join('')}` : ''}</div>
        ${d.epic ? `<div class="po-draft-meta"><span class="muted small">Epic</span> <span class="badge bl-epic" title="Epic ${esc(d.epic)}">${esc(d.epicTitle || d.epic)}</span>
          ${m === openDraftIndex() ? `<label class="check small" title="Create also places the new issue in this epic"><input type="checkbox" data-po-epic${placeEpic(m) ? ' checked' : ''} /><span>Place in epic</span></label>` : ''}</div>` : ''}
        <div class="md md-compact po-draft-body">${markdownHtml(d.body)}</div>
      </div></div>`);
    }
    if (x.existingIssue && x.addition) {
      const i = issueOf(x.existingIssue);
      parts.push(`<div class="po-sec"><div class="sup-h">Addition to #${x.existingIssue}${i ? ` ${esc(i.title)}` : ''}</div><div class="po-draft">
        <div class="md md-compact po-draft-body">${markdownHtml(`## Update (${new Date().toISOString().slice(0, 10)})\n\n${x.addition}`)}</div></div></div>`);
    }
    if (x.duplicates?.length) {
      parts.push(`<div class="po-sec"><div class="sup-h">Close issues</div><ul class="po-list">${x.duplicates.map((d) =>
        `<li>${issueRef(d.number)} <span class="badge${d.relation === 'duplicate' ? ' warn' : ''}">${esc(d.relation)}</span> ${esc(d.title)}${d.state === 'closed' ? ' <span class="muted small">(closed)</span>' : ''}${d.reason ? ` <span class="muted small">${esc(d.reason)}</span>` : ''}</li>`).join('')}</ul></div>`);
    }
    if (x.assumptions?.length) parts.push(`<details class="small"><summary class="muted">Assumptions (${x.assumptions.length})</summary><ul class="po-list">${x.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></details>`);
    if (m === openDraftIndex()) parts.push(draftActions(x, m));
    return parts.join('');
  }

  function messageHtml(msg, m) {
    const time = msg.ts ? new Date(msg.ts).toLocaleTimeString() : '';
    // #240: another agent's request and its result, one card (agent-request.js)
    if (msg.role === 'request') return window.AgentRequest.cardHtml(msg, po.messages, { testid: 'po-request', owner: 'po', projectId: po.projectId });
    if (window.AgentRequest.inCard(msg)) return '';
    if (msg.role === 'user') {
      const files = [...(msg.issues || []).map(issueRef), ...(msg.attachments || []).map((f) => `<span class="badge" title="${esc(f)}">${esc(f.split(/[\\/]/).pop())}</span>`)].join(' ');
      const once = [msg.calibrationOverride ? window.PoCalibration.step(msg.calibration).name : '', msg.costOverride ? window.PoCalibration.cost.step(msg.cost).name : ''].filter(Boolean)
        .map((name) => ` · <span class="badge" title="For this question only: the saved setting is unchanged">for ${esc(name)}</span>`).join('');
      return `<div class="sup-wmsg user" data-testid="po-message-you"><div class="sup-wmsg-meta">You · ${esc(time)}${once}</div><div>${esc(msg.text)}</div>${files ? `<div class="po-files">${files}</div>` : ''}</div>`;
    }
    // #189: the calibration it planned with (marked when it was for this question only)
    // #205: and the Cost step ("Planned for Speed · Economy")
    const once = msg.calibrationOverride || msg.costOverride;
    const calib = msg.calibration ? ` <span class="badge" title="${esc(`${once ? 'For this question only. ' : ''}${window.PoCalibration.tooltip(msg.calibration)}${msg.cost ? `\n\n${window.PoCalibration.cost.tooltip(msg.cost)}` : ''}`)}">Planned for ${esc(window.PoCalibration.plannedFor(msg.calibration, msg.cost ?? null))}${once ? ' · this question' : ''}</span>` : '';
    const meta = `Product Owner · ${esc(time)}${msg.model ? ` · ${esc(msg.model)}` : ''} · ${esc(fmtCost(msg.costUsd || 0))}${calib}${msg.stopped ? ' <span class="badge warn" title="You stopped this turn: the answer is what was written until then">Stopped</span>' : ''}`;
    return `<div class="sup-wmsg po-msg${msg.error ? ' error' : ''}" data-msg="${m}"><div class="sup-wmsg-meta">${meta}</div>
      <div class="md md-compact">${msg.error ? esc(msg.text) : markdownHtml(msg.text || '')}</div>
      ${msg.invalid ? `<p class="small muted">The answer had no valid ${msg.mode === 'issue' ? 'draft' : 'proposal'} (${esc(msg.invalid)}): shown as text only.</p>` : ''}
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
    renderButton();
    if (!po.open) return;
    const agent = window.productOwnerAgent;
    const simulated = devMode();
    const issueMode = po.mode === 'issue';
    // registering an issue uses the issue tracker's cheaper analysis model (ISSUE_AGENT in src/product-owner.js)
    const model = issueMode ? 'claude-sonnet-5 · medium' : `${agent?.model || 'claude-opus-5-5'}${agent?.effort && agent.effort !== 'default' ? ` · ${agent.effort}` : ''}`;
    // #235: what the drawer plans for, the project by its name
    $p('#po-for').textContent = !po.projectId ? 'Choose a project in the Backlog first'
      : issueMode ? `Registering an issue for ${projectName()}` : `Planning for ${projectName()} · ${workflowTitle(workflowOf(po.workflow), po.workflow)}`;
    // cut with an ellipsis in a narrow drawer: the whole line on hover (no app tooltip there)
    $p('#po-for').title = $p('#po-for').textContent;
    $p('#po-sub').textContent = simulated ? 'simulated (developer mode)' : model;
    const log = $p('#po-log');
    const top = log.scrollTop;
    const toEnd = scroll === 'end' || atEnd(log);
    const cost = po.messages.reduce((a, x) => a + (x.costUsd || 0), 0);
    // #274: the messages, the question in flight, the live turn and the error, through the shared chat
    chat.update({ messages: po.messages, live: po.live, error: po.error, busy: po.busy });
    // #148: the simulation-only scenario picker (never in the production UI)
    $p('#po-sim').classList.toggle('hidden', !simulated);
    $p('#po-scenario').innerHTML = simulated ? SCENARIOS.map((s) => `<button type="button" class="po-sim-opt${s.id === po.scenario ? ' active' : ''}" data-po-scenario="${esc(s.id)}" aria-pressed="${s.id === po.scenario}"${po.busy ? ' disabled' : ''}>${esc(s.label)}</button>`).join('') : '';
    document.querySelectorAll('#po-mode [data-po-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.poMode === po.mode);
      b.disabled = po.busy;
    });
    // #234: locked while a question is in flight (the text box stays free)
    $p('#po-chips').innerHTML = issueMode ? '' : [...QUESTIONS.map((q) => `<button class="chip" type="button" data-testid="po-pill" data-q="${esc(q)}"${po.busy ? ' disabled' : ''}>${esc(q)}</button>`),
      `<button class="chip" type="button" data-testid="po-pill" data-mode="issue"${po.busy ? ' disabled' : ''} title="Describe an issue; the Product Owner drafts it and you file it">${esc(REGISTER)}…</button>`].join('');
    $p('#po-chips').classList.toggle('hidden', issueMode);
    // #235: the workflow of a plan question and its options (Plan mode only)
    $p('#po-wf-row').classList.toggle('hidden', issueMode || !po.projectId);
    $p('#po-workflow').disabled = po.busy;
    showNotice(po.notice);
    $p('#po-files').classList.toggle('hidden', !issueMode || !po.files.length);
    // #148: an attachment sent with the question in flight can't be removed until the answer
    const sent = po.busy ? ' disabled title="Already sent with this question: you can remove it once the Product Owner answers"' : '';
    $p('#po-files').innerHTML = po.files.map((f, n) => `<span class="badge po-file" title="${esc(f.path)}"><span>${esc(f.name)}</span> <span class="muted">${esc(fmtSize(f.size))}</span><button type="button" data-po-unattach="${n}" aria-label="Remove ${esc(f.name)}"${sent}>×</button></span>`).join('');
    $p('#btn-po-attach').classList.toggle('hidden', !issueMode);
    $p('#btn-po-attach').disabled = po.busy;
    // #169: the issues sent from the Backlog (plan questions only); a closed one is struck through
    const attached = !issueMode && po.attached.length;
    $p('#po-attached').classList.toggle('hidden', !attached);
    $p('#po-attached').innerHTML = attached ? `<span class="muted small">Attached</span>${po.attached.map((n) => {
      const i = issueOf(n);
      const closed = i?.state === 'closed';
      const tip = `${i ? `#${n} ${i.title}` : `#${n} (not synced)`}${closed ? ' · closed: left out of the proposal' : ''}`;
      return `<span class="badge po-file${closed ? ' closed' : ''}" title="${esc(tip)}"><span>#${n}</span> <span class="muted">${esc(i?.title || '')}</span><button type="button" data-po-unattach-issue="${n}" aria-label="Remove #${n}"${po.busy ? ' disabled' : ''}>×</button></span>`;
    }).join('')}<button class="link-btn small" type="button" data-po-unattach-all${po.busy ? ' disabled' : ''} title="Ask about the whole backlog again">clear</button>` : '';
    $p('#po-question').placeholder = issueMode
      ? (openDraftIndex() >= 0 ? 'What should change? Or "add this to #n"…' : 'Describe the issue in a few words (paste or drop screenshots)…')
      : attached ? 'Ask about the attached issues…' : 'Ask about the backlog: which issues should go first?';
    $p('#btn-po-ask').textContent = issueMode ? 'Send' : 'Ask';
    $p('#btn-po-clear').disabled = po.busy || !po.messages.length;
    // #189: the calibration chip (backlog-po-settings.js)
    window.BacklogPoSettings?.renderChip({ busy: po.busy, issueMode });
    // #235: the Cost chip only where the Cost axis applies to the chosen workflow
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
  const leftOut = (skipped) => (skipped.length ? ` Left out (not To do): ${skipped.map((n) => `#${n}`).join(', ')}.` : '');
  async function apply(act, el) {
    const box = el.closest('[data-msg]');
    const m = Number(box.dataset.msg);
    const answer = po.messages[m]?.answer;
    if (!answer) return;
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

  // ---- filing a draft (the owner's click; Register an issue) ----------------------------------------
  // act: create | create-roadmap | create-assign | append | comment | revise | discard. A real filing
  // asks once more; developer or simulated mode only previews (the service never calls gh/glab then).
  async function fileDraft(act, el) {
    const m = Number(el.closest('[data-msg]').dataset.msg);
    const msg = po.messages[m];
    const x = msg?.issue;
    if (!x || po.busy) return;
    const key = `draft:${m}`;
    if (act === 'revise') {
      setMode('issue');
      $p('#po-question').placeholder = 'What should change in the draft?';
      return;
    }
    const n = Number(el.dataset.n) || null;
    const simulated = devMode();
    if (act === 'discard') {
      if (!await confirmDialog('Discard the draft', 'Nothing is filed. The conversation keeps it, marked as discarded.', 'Discard')) return;
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

  // ---- the chat (#274) ------------------------------------------------------------------------------
  function emptyHtml() {
    const empty = po.mode === 'issue'
      ? 'Describe the issue in a few words: type it, dictate it, or paste a screenshot. I look at the code and the backlog for evidence and duplicates, ask a question if I must, and draft it. Nothing is filed until you click Create or Add to #n.'
      : 'I read the synced issues, the queue, the runs in progress and past runs (and the code, read-only), and propose which issues to run together, which not, and in what order. I never start runs or edit issues: you apply a proposal with a click.';
    return `<div class="po-empty"><span class="po-empty-robot" aria-hidden="true">${avatar()}</span>
        <p class="muted small">${empty}</p></div>`;
  }
  // ask() keeps the turn's own state (busy, the live turn, unread); a failed one gives the question back
  const chat = window.AgentChat.create($p('#po-chat'), {
    agent: 'Product Owner',
    parts: { log: $p('#po-log'), input: $p('#po-question'), send: $p('#btn-po-ask'), working: $p('#po-working'), slots: { pills: $p('#po-chips') } },
    renderMessage: (msg, m) => messageHtml(msg, m),
    emptyHtml,
    pendingHtml: () => (pendingShown() ? `<div class="sup-wmsg user" data-testid="po-message-you"><div class="sup-wmsg-meta">You</div><div>${esc(po.pending)}</div></div>` : ''),
    // #234: no silent no-op when no project is selected (the text stays in the box)
    beforeSend: () => { if (po.projectId) return true; showNotice(NO_PROJECT); return false; },
    send: async (q) => { await ask(q); return po.error ? { ok: false } : null; },
    onStop: stopTurn,
    onDone: () => render(),
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
  $p('#po-workflow').onchange = (e) => chooseWorkflow(e.target.value);
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
  $p('#po-mode').onclick = (e) => { const b = e.target.closest('[data-po-mode]'); if (b) setMode(b.dataset.poMode); };
  $p('#po-chips').onclick = (e) => {
    const c = e.target.closest('[data-q], [data-mode]');
    if (c?.dataset.mode) setMode(c.dataset.mode);
    else if (c) chat.ask(c.dataset.q);
  };
  const DRAFT_ACTS = ['append', 'comment', 'create', 'create-assign', 'create-roadmap', 'discard', 'revise'];
  $p('#po-log').onclick = (e) => {
    // an applied group's badge (#140): the Roadmap at its stage, or its run
    const stage = e.target.closest('[data-po-stage]');
    if (stage) { close(); actions().openStage(Number(stage.dataset.poStage)); return; }
    const run = e.target.closest('[data-po-run]');
    if (run) { close(); window.showRun(run.dataset.poRun); return; }
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
    const b = e.target.closest('[data-po-act]');
    if (!b) return;
    if (DRAFT_ACTS.includes(b.dataset.poAct)) fileDraft(b.dataset.poAct, b);
    else apply(b.dataset.poAct, b);
  };
  $p('#po-log').addEventListener('input', (e) => window.BacklogPoProposals.onInput(e, proposalsCtx()));
  $p('#po-log').addEventListener('change', (e) => {
    // a draft's workflow select (#195): kept for that draft, the Create + roadmap tooltip follows it
    if (e.target.matches('[data-po-wf]')) {
      draftWorkflow.set(Number(e.target.closest('[data-msg]')?.dataset.msg), e.target.value);
      render();
      return;
    }
    window.BacklogPoProposals.onInput(e, proposalsCtx());
  });
  $p('#btn-po-clear').onclick = async () => {
    if (!await confirmDialog('Clear the conversation', 'The Product Owner forgets this project\'s questions and answers (and the files attached to them).', 'Clear')) return;
    try { po.messages = await api.clearProductOwner(po.projectId); Object.assign(po, { notes: {}, files: [], attached: [], extras: {} }); } catch (e) { po.error = errMsg(e); }
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
    // a `po` notification's click (#149, app.js openNotificationTarget)
    open,
    // the project whose drawer is open, for the notifications' window context (#149)
    openProjectId: () => (po.open ? po.projectId : null),
    syncSendButton,
  };
  renderButton();
})();
