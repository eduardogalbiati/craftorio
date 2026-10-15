// The Oracle's chat (#171; the service is #122, src/oracle.js): one conversation in two places.
// - the dock (#oracle-dock): docked on Home's Overview (the view `dashboard`), open there; hidden on
//   Home's Analytics tab (#255, the view `analytics`: the drawer, as on the other screens);
// - the drawer (#oracle-drawer): an overlay opened on any other screen from the header's Oracle
//   button (#nav-oracle, at the top right next to the notifications bell, #254; on the Dashboard it
//   focuses the dock). Esc and the backdrop close it. The button's .nav-badge counts the answers that arrived
//   while neither was in view (oracle:state readAt, saved by oracle:markRead: survives a reload).
// The state (empty, conversation, answering, error, paused by budget, unavailable in another app
// process), Send, the pasted images and the memory form come from OracleChatModel
// (oracle-chat-model.js). Messages reuse .sup-wmsg and markdownHtml; run ids, #issues and run
// files in an answer open in the app, other paths are copyable. Developer mode asks the simulated
// Oracle (no model call). Exposes window.OracleChat (open, ask, attach, reload) for the screenshot script.
// Part 2 (#123): an action card (what changes, where, the backup, who asked) runs only on its
// "Do it" (oracle:act), Dismiss drops it, Undo puts its backup back; a wake-up shows its run events
// folded, with Mute per run; a delegation shows the agent asked and its cost. The head's Night
// watch opens its form (end time, Start / Cancel); while on, a strip shows it with Turn off, and the
// runs or roadmaps watched and the runs muted (Unwatch, Unmute). oracle:changed reloads the chat.
// Live progress (#180, window.LiveTurn, live-turn.js): while it answers, what the Oracle does and its
// answer as it is written (chat:progress 'oracle'); Stop (api.cancelChatTurn) keeps what was written.
// A gate's "Interact with Oracle" (#183, gate-oracle.js) calls OracleChat.openWith: the drawer opens
// beside the screen (no backdrop, the content narrows), the question box shows a removable context
// chip and the gate's starters; each question carries that context (oracle:ask `context`). A starter
// clicked while another question is answered queues. An answer's ```gate-feedback block becomes a card whose
// "Use this text" fills the gate's feedback box. #208: fields are focused with preventScroll and the
// head wraps its buttons under the title in the narrow dock.
// Each surface's conversation, text box and Send go through the agents' shared chat (#274,
// agent-chat.js): the box empties as soon as Send is clicked (the question shows at once) and gets
// the question back with the error when the send fails or a budget refuses it; while it answers Send
// is locked and the box stays free.
// Uses app.js globals ($, esc, state, api, errMsg, devMode, fmtCost, markdownHtml, confirmDialog,
// selectRun, showView, openArtifactsAt, showSettingsTab, registerView, viewRegistry, Robots).
(() => {
  const M = window.OracleChatModel;
  const or = {
    messages: [], service: null, pending: null, error: null, loaded: false, drawer: false,
    drafts: { text: '', images: [] }, pasteError: null, memory: M.memoryForm(''), memoryOpen: false, refilledFor: null,
    wake: null, nightForm: null, acting: new Set(), live: null, liveIn: null,
    // #183: the question box's context chip ({ label, ref, text, starters }), the questions waiting
    // for the one in flight, and the context of the one in flight
    context: null, queue: [], pendingRef: null,
  };
  // the surfaces the conversation shows in: Home's dock, the drawer, and the Agents window's pane
  // (#263, 'window': mounted by AgentsWindow when the Oracle is picked there)
  const SURFACES = ['dock', 'drawer'];
  const WINDOW = 'window';
  const ALL_SURFACES = [...SURFACES, WINDOW];
  const chats = {}; // each surface's shared chat (#274, agent-chat.js), mounted with it
  const shownIn = (w) => (w === 'drawer' ? or.drawer : w === WINDOW ? or.window : onDashboard());
  // the surface the owner talks in: the Agents window's pane when it shows the Oracle, else the drawer or Home's dock
  const activeSurface = () => (or.window && chats[WINDOW] ? WINDOW : or.drawer || !onDashboard() ? 'drawer' : 'dock');
  const SUGGESTIONS = [
    'What happened overnight?',
    'Which runs failed this week, and why?',
    'Where do my tokens go?',
    'What should I work on next?',
  ];
  const attachmentCache = new Map(); // a stored image's name → data: URL (or a pending promise)
  const avatar = (cls = '') => `<span class="oracle-avatar ${cls}" aria-hidden="true">${Robots.svg('oracle', 'idle', { bubble: false, plaque: '' })}</span>`;
  const onDashboard = () => state.view === 'dashboard';
  const inView = () => or.drawer || onDashboard() || !!or.window;
  const view = () => M.chatView({ messages: or.messages, service: or.service, pending: or.pending, error: or.error, drafts: or.drafts, open: inView() });
  const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const screen = () => (window.supervisorScreenContext ? window.supervisorScreenContext() : state.view || '');

  async function load() {
    try {
      [or.messages, or.service, or.wake] = await Promise.all([api.oracleHistory(), api.oracleState(), api.oracleWakeState().catch(() => null)]);
      or.loaded = true;
    } catch (e) { or.error = errMsg(e); }
    render();
  }
  // a wake-up, a card or a result arrived (oracle:changed): reload once the burst is over
  let reloadTimer = null;
  function reloadSoon() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { if (!or.pending) load(); }, 300);
  }

  // ---- action cards, the Night watch, watches and mutes (#123) --------------------------------
  // the result of a card's button: the conversation and the state come back
  async function cardAction(id, call) {
    or.acting.add(id);
    render();
    try {
      const out = await call();
      if (out?.messages) or.messages = out.messages;
      if (out?.state) or.service = out.state;
      or.error = null;
    } catch (e) { or.error = errMsg(e); }
    or.acting.delete(id);
    await load();
  }
  const doAction = (id) => cardAction(id, () => api.oracleAct({ actionId: id, mock: devMode() }));
  const dismissAction = (id) => cardAction(id, () => api.oracleDismiss({ actionId: id }));
  async function undoAction(id) {
    if (!await confirmDialog('Undo this action', 'The backup taken before the action is put back.', 'Undo')) return;
    cardAction(id, () => api.oracleUndo({ actionId: id }));
  }
  async function startNightWatch() {
    const f = or.nightForm;
    const until = f.until ? new Date(TimeZone.parseInput(f.until, TimeZone.current())) : null;
    if (!until || !(until > new Date())) { or.nightForm = { ...f, error: 'Pick an end time in the future.' }; render(); return; }
    or.nightForm = { ...f, saving: true, error: null };
    render();
    try {
      const out = await api.setOracleNightWatch({ on: true, until: until.toISOString(), from: 'the Oracle drawer' });
      or.messages = out.messages;
      or.service = out.state;
      or.nightForm = null;
    } catch (e) { or.nightForm = { ...f, saving: false, error: errMsg(e) }; }
    render();
  }
  async function stopNightWatch() {
    try {
      const out = await api.setOracleNightWatch({ on: false });
      or.messages = out.messages;
      or.service = out.state;
    } catch (e) { or.error = errMsg(e); }
    render();
  }
  async function setWatch(call) {
    try { or.wake = { ...or.wake, ...(await call()) }; } catch (e) { or.error = errMsg(e); }
    render();
  }

  // the conversation is in view: its answers so far are read
  function markRead() {
    if (!inView()) return;
    const last = or.messages.filter((m) => m.role === 'oracle').at(-1);
    if (!last || (or.service?.readAt && or.service.readAt >= last.ts)) return;
    if (or.service) or.service = { ...or.service, readAt: last.ts };
    api.markOracleRead({ at: last.ts }).catch(() => {});
  }

  // A question without the text box (a suggestion, a gate's starter, OracleChat.ask), through the chat
  // in view. queued: the context the question was asked with (a queued gate question keeps its gate)
  function ask(question, queued) {
    const q = String(question ?? '').trim();
    // #183: a question asked while another is answered waits in line, with its context
    if (or.pending) { if (q) { or.queue.push({ q, context: queued ? queued.context : or.context }); render(); } return; }
    if (!q || !view().chipsEnabled) return;
    nextQueued = queued || null;
    chats[activeSurface()].ask(q);
  }
  // The chat's send (#274; the box is already empty, a failure or a refusal gives the question back):
  // the question with the screen, the pasted images and the gate context (#183); w: the surface it came from
  let nextQueued = null;
  async function send(q, w) {
    const queued = nextQueued;
    nextQueued = null;
    const images = queued ? [] : or.drafts.images;
    const ctx = queued ? queued.context : or.context;
    Object.assign(or, { pending: q || `(${images.length} image${images.length > 1 ? 's' : ''})`, pendingSince: Date.now(), pendingRef: ctx?.ref || '', error: null, pasteError: null, live: window.LiveTurn.create({ agent: 'Oracle' }), liveIn: w });
    chats[w].setLiveTurn(or.live);
    render();
    try {
      const context = ctx ? { label: ctx.label, ref: ctx.ref, text: ctx.text } : undefined;
      const out = await api.askOracle({ question: q, screen: screen(), images: images.map((i) => ({ dataUrl: i.dataUrl })), context, mock: devMode() });
      or.messages = out.messages;
      or.service = out.state;
      // a daily budget shows as the paused state; a monthly one as an error
      if (out.refused) return { ok: false, error: out.refused.reason === 'daily-budget' ? '' : out.refused.text, messages: out.messages };
      if (!queued) or.drafts.images = [];
      return { messages: out.messages };
    } finally {
      Object.assign(or, { pending: null, pendingRef: null, live: null });
    }
  }
  // after a send: paused (daily budget) or unavailable, the queue stays on screen, sent after the next question
  function sent() {
    render();
    if (or.queue.length && view().chipsEnabled) { const next = or.queue.shift(); ask(next.q, next); }
  }

  async function reset() {
    if (!await confirmDialog('New session', 'The Oracle starts a new session from a handoff note it writes now. The conversation and its memory are kept.', 'New session')) return;
    try {
      const out = await api.resetOracle({ mock: devMode() });
      or.messages = out.messages;
      or.service = out.state;
      or.error = null;
    } catch (e) { or.error = errMsg(e); }
    render();
  }

  // ---- the memory form ---------------------------------------------------------------------
  async function openMemory() {
    or.memoryOpen = true;
    try { or.memory = M.editMemory(M.memoryForm((await api.oracleMemory()).text)); } catch (e) { or.memory = { ...M.editMemory(M.memoryForm('')), error: errMsg(e) }; }
    render();
    document.querySelector(`#oracle-mem-${activeSurface()}`)?.focus({ preventScroll: true });
  }
  async function saveMemory() {
    or.memory = { ...or.memory, saving: true };
    render();
    or.memory = await M.saveMemory(or.memory, (text) => api.saveOracleMemory(text));
    render();
  }
  // #184: Import, the decisions of a pasted text added to the draft (saved with Save); `rev` redraws the form
  function toggleImport(on) {
    or.memory = { ...or.memory, importing: on, importText: on ? or.memory.importText || '' : '', rev: (or.memory.rev || 0) + 1 };
    render();
    if (on) document.querySelector(`#oracle-mem-import-${activeSurface()}`)?.focus({ preventScroll: true });
  }
  async function importMemory() {
    try {
      const out = await api.importOracleMemory({ text: or.memory.importText || '', base: or.memory.draft });
      or.memory = { ...or.memory, draft: out.text, importing: false, importText: '', error: null, rev: (or.memory.rev || 0) + 1 };
    } catch (e) {
      or.memory = { ...or.memory, error: errMsg(e) };
    }
    render();
  }

  // ---- drafts and pasted images ------------------------------------------------------------
  function setDraftText(text) {
    or.drafts.text = text;
    ALL_SURFACES.forEach((w) => { const el = $(`#oracle-q-${w}`); if (el && el.value !== text) el.value = text; });
  }
  const readFile = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ type: file.type, size: file.size, name: file.name || '', dataUrl: r.result });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  // images given as { type, size, dataUrl } (the paste handler, or the screenshot script)
  function attach(files) {
    const out = M.addImages(or.drafts.images, files);
    or.drafts.images = out.images;
    or.pasteError = out.error;
    render();
  }
  async function onPaste(e) {
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
    if (!files.length) return; // text: the textarea's own paste
    e.preventDefault();
    attach(await Promise.all(files.map(readFile)));
  }

  // ---- links in the answers ----------------------------------------------------------------
  // In the Agents window (#263) the page has no screens: a link's target goes to the main window,
  // which runs the same function (AgentsWindow.onNavigate); in the main window toMain answers false.
  const toMain = (name, target) => !!window.AgentsWindow?.toMainWindow?.(name, target);
  // #240: a request's line opens its owner's conversation at the request's card
  const OWNERS = { 'product-owner': 'Product Owner', supervisor: 'Supervisor' };
  async function openRequest(link) {
    const { oracleOpenRequest: to, ref, project } = link;
    if (toMain('oracle:request', { oracleOpenRequest: to, ref, project })) return;
    closeDrawer();
    if (to === 'supervisor') window.openSupervisorChat?.();
    else {
      if (project) window.BacklogActions?.focusProject?.(project);
      showView('backlog');
      await window.BacklogPO?.open();
    }
    window.AgentRequest.reveal(ref);
  }
  function follow(target) {
    if (toMain('oracle:follow', target)) return;
    if (target.kind === 'run') { closeDrawer(); selectRun(target.runId); }
    else if (target.kind === 'issue') {
      closeDrawer();
      // the issue's own project: the link's repository, or the run named in the same answer
      const projectId = M.issueProject(target, {
        projects: state.projects || [],
        runProject: target.runId ? state.runs.get(target.runId)?.run?.project : null,
        currentId: window.BacklogActions?.projectId?.(),
      });
      window.BacklogActions?.focusProject?.(projectId);
      window.BacklogActions?.focusIssue?.(target.number);
      showView('backlog');
    } else if (target.kind === 'file') {
      closeDrawer();
      openArtifactsAt({ projectId: '', path: target.path, mock: !!state.runs.get(target.runId)?.run?.mock });
    }
  }
  // a run's own line (a watch, an action) and the Oracle's settings
  function openRun(runId) {
    if (toMain('oracle:run', runId)) return;
    closeDrawer();
    window.showRun(runId);
  }
  function openSettings() {
    if (toMain('oracle:settings', null)) return;
    closeDrawer();
    showView('settings');
    showSettingsTab('execution');
    setTimeout(() => { $('#set-oracle-budget')?.focus({ preventScroll: true }); $('#set-oracle')?.scrollIntoView({ block: 'center' }); }, 100);
  }
  window.AgentsWindow?.onNavigate?.('oracle:follow', follow);
  window.AgentsWindow?.onNavigate?.('oracle:request', openRequest);
  window.AgentsWindow?.onNavigate?.('oracle:run', openRun);
  window.AgentsWindow?.onNavigate?.('oracle:settings', openSettings);
  // run ids and #issues in the text become links; links and absolute paths get their target
  function decorate(box) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('a, pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const pieces = M.linkPieces(node.nodeValue);
      if (!pieces.some((p) => p.href)) continue;
      const frag = document.createDocumentFragment();
      for (const p of pieces) {
        if (!p.href) { frag.append(p.text); continue; }
        const a = document.createElement('a');
        a.href = p.href;
        a.textContent = p.text;
        frag.append(a);
      }
      node.replaceWith(frag);
    }
    // a #<number> without a repository belongs to the project of the first run the answer names
    const contextRun = box.textContent.match(/\b\d{8}-\d{6}-[0-9a-f]{8}\b/)?.[0];
    box.querySelectorAll('a[href]').forEach((a) => {
      const t = M.linkTarget(a.getAttribute('href'));
      if (t.kind === 'issue' && !t.repo && contextRun) t.runId = contextRun;
      if (t.kind === 'external') { a.target = '_blank'; a.rel = 'noopener'; return; }
      if (t.kind === 'none' || t.kind === 'path') return;
      a.classList.add('oracle-link');
      a.dataset.oracleLink = JSON.stringify(t);
      a.title = t.kind === 'run' ? `Open run ${t.runId}` : t.kind === 'issue' ? `Open #${t.number} in the Backlog` : `Open ${t.path} in Artifacts`;
    });
    box.querySelectorAll('code').forEach((c) => {
      if (c.closest('a')) return;
      const t = M.linkTarget(c.textContent);
      if (t.kind === 'file') {
        c.classList.add('oracle-link');
        c.dataset.oracleLink = JSON.stringify(t);
        c.title = `Open ${t.path} in Artifacts`;
      } else if (t.kind === 'path') {
        c.classList.add('oracle-path');
        c.dataset.oracleCopy = t.path;
        c.title = `${t.path} (click to copy)`;
      }
    });
  }

  // ---- rendering ---------------------------------------------------------------------------
  const time = (t) => (t ? new Date(t).toLocaleString(undefined, { timeZone: TimeZone.current() }) : '');
  function thumbsHtml(names = []) {
    if (!names.length) return '';
    return `<div class="oracle-thumbs">${names.map((n) => {
      const url = attachmentCache.get(n);
      return `<span class="oracle-thumb" title="${esc(n)}">${typeof url === 'string' ? `<img src="${esc(url)}" alt="Pasted image ${esc(n)}" />` : '<span class="muted small">image</span>'}</span>`;
    }).join('')}</div>`;
  }
  function loadAttachments(names = []) {
    for (const n of names) {
      if (attachmentCache.has(n)) continue;
      attachmentCache.set(n, api.oracleAttachment(n).then((url) => { attachmentCache.set(n, url || ''); render(); }).catch(() => attachmentCache.set(n, '')));
    }
  }
  // #183: the "Ask for changes" text the Oracle proposes (```gate-feedback blocks), out of the prose
  function feedbackBlocks(text) {
    const blocks = [];
    const rest = String(text || '').replace(/```gate-feedback[^\n]*\n([\s\S]*?)```/g, (_, b) => { blocks.push(b.trim()); return ''; });
    return { rest, blocks: blocks.filter(Boolean) };
  }
  // each proposal as a card; "Use this text" fills the gate's feedback box (never answers it)
  const feedbackCardsHtml = (blocks, ref) => blocks.map((b) => `<div class="oracle-feedback-card" data-testid="oracle-feedback-card">
      <div class="muted small">Proposed text for "Ask for changes"</div>
      <div class="oracle-text">${esc(b)}</div>
      ${ref ? `<div class="row oracle-card-actions"><button class="btn primary sm" type="button" data-oracle-use-text="${esc(ref)}" data-text="${esc(b)}" title="Put this text in the gate's feedback box; you still choose the answer">Use this text</button></div>` : ''}
    </div>`).join('');
  function messageHtml(m, ref = '') {
    if (m.role === 'user') {
      loadAttachments(m.attachments);
      return `<div class="sup-wmsg user"><div class="sup-wmsg-meta oracle-meta">You · ${esc(time(m.ts))}${m.screen ? ` · <span class="oracle-cut" title="${esc(m.screen)}">${esc(m.screen)}</span>` : ''}${m.unanswered ? ' · <span class="badge warn">no answer</span>' : ''}${m.refused ? ` · <span class="badge warn" title="${esc(m.refused.text || '')}">not sent: ${m.refused.reason === 'daily-budget' ? 'daily budget' : 'monthly budget'}</span>` : ''}</div>${m.context?.label ? `<div class="oracle-cut small muted" title="${esc(m.context.label)}">About: ${esc(m.context.label)}</div>` : ''}<div class="oracle-text">${esc(m.text)}</div>${thumbsHtml(m.attachments)}</div>`;
    }
    if (m.kind === 'action' && m.action) return cardHtml(m);
    if (m.kind === 'delegation') {
      return `<div class="sup-wmsg system oracle-delegation${m.failed ? ' error' : ''}"><div class="sup-wmsg-meta oracle-meta">${M.delegationParts(m, { fmtTime: time, fmtCost }).map(esc).join(' · ')}${m.failed ? ' · <span class="pill pill-failed">Failed</span>' : ''}</div>
        <div class="oracle-cut small" title="${esc(m.question)}">${esc(m.question)}</div>
        <details class="oracle-fold"><summary>Answer${m.ref ? ` <span class="muted small">(${esc(m.ref)})</span>` : ''}</summary><div class="md md-compact oracle-md">${markdownHtml(m.text || '')}</div></details></div>`;
    }
    // #240: a request it sent to an owner's inbox: one short line, the link opens the owner's message
    if (m.kind === 'request') {
      const owner = OWNERS[m.to] || m.to;
      return `<div class="sup-wmsg system oracle-request${m.failed ? ' error' : ''}" data-testid="oracle-request"><div class="sup-wmsg-meta oracle-meta">Sent to the ${esc(owner)} · <span class="badge">${esc(m.requestKind)}</span> · <span class="pill ${m.failed ? 'pill-failed">Failed' : m.pending ? `pill-cancelled" title="A card waits for your click in the ${esc(owner)}'s chat">Waits for your click` : 'pill-success">Done'}</span> · ${esc(window.AgentRequest.usd(m.costUsd))} · ${esc(time(m.ts))} · <a href="#" data-oracle-open-request="${esc(m.to)}" data-ref="${esc(m.ref)}" data-project="${esc(m.projectId || '')}" title="The request and its result in the ${esc(owner)}'s conversation">Open</a></div><div class="oracle-cut small" title="${esc(m.text)}">${esc(m.text)}</div></div>`;
    }
    if (m.kind === 'wake') {
      const mutes = (m.runIds || []).map((id) => {
        const muted = (or.wake?.muted || []).includes(id);
        return `<button class="btn ghost sm" type="button" data-oracle-mute="${esc(id)}" data-on="${muted ? '0' : '1'}" title="${muted ? 'Its events wake the Oracle again' : 'Its events no longer wake the Oracle'}">${muted ? 'Unmute' : 'Mute'} ${esc(id)}</button>`;
      }).join('');
      return `<div class="sup-wmsg system oracle-wake"><details class="oracle-fold"><summary><span class="sup-wmsg-meta">${esc(time(m.ts))}</span> ${esc(m.text)}</summary>
        <ul class="oracle-events small">${(m.events || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${mutes ? `<div class="row oracle-card-actions">${mutes}</div>` : ''}</details></div>`;
    }
    // #244: a routine run event, written by the app (no model call): the status leads, the run id opens the run
    if (m.kind === 'notice') {
      return `<div class="sup-wmsg system oracle-notice-msg" data-testid="oracle-run-notice" data-run="${esc(m.runId || '')}"><div class="sup-wmsg-meta oracle-meta">${esc(time(m.ts))} · ${StatusPill.statusPill(m.status || 'notice')}${m.runId ? ` · <a href="#" data-oracle-open-run="${esc(m.runId)}" title="Open the run">${esc(m.runId)}</a>` : ''}</div><div>${esc(m.text)}</div></div>`;
    }
    // #244: the wake-ups a budget refused, as one digest
    if (m.kind === 'wake-refused') {
      return `<div class="sup-wmsg system oracle-wake"><details class="oracle-fold"><summary><span class="sup-wmsg-meta">${esc(time(m.lastTs || m.ts))}</span> <span class="badge warn">Paused by budget</span> ${esc(m.text)}</summary>
        <ul class="oracle-events small">${(m.events || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details></div>`;
    }
    if (m.role === 'system') return `<div class="sup-wmsg system${m.error ? ' error' : ''}"><div class="sup-wmsg-meta">${esc(time(m.ts))}</div><div>${esc(m.text)}</div></div>`;
    const meta = M.metaParts(m, { fmtTime: time, fmtCost }).map(esc).join(' · ');
    const tag = m.wake ? ' · <span class="badge">wake-up</span>' : m.kind === 'night-summary' ? ' · <span class="badge warn">Night watch</span>' : m.stopped ? ' · <span class="badge warn" title="You stopped this turn: the answer is what was written until then">Stopped</span>' : '';
    const fb = feedbackBlocks(m.text);
    return `<div class="sup-wmsg oracle-msg"><div class="sup-wmsg-meta oracle-meta">${avatar('xs')} Oracle · ${meta}${tag}</div><div class="md md-compact oracle-md">${markdownHtml(fb.rest)}</div>${feedbackCardsHtml(fb.blocks, ref)}${m.kind === 'night-summary' ? summaryUndoHtml(m) : ''}</div>`;
  }
  // a card: the title leads; what changes, where, the backup and why; who asked; its buttons
  function cardHtml(m) {
    const a = m.action;
    const v = M.actionView({ ...a, status: or.acting.has(a.id) ? 'running' : a.status }, { unavailable: view().state === 'unavailable' });
    const field = (label, value) => (value ? `<dt>${label}</dt><dd>${esc(value)}</dd>` : '');
    return `<div class="sup-wmsg oracle-msg oracle-card${v.fromContent ? ' from-content' : ''}" data-oracle-card="${esc(a.id)}">
      <div class="sup-wmsg-meta oracle-meta">${avatar('xs')} Oracle · ${esc(time(m.ts))}</div>
      <div class="oracle-card-head"><span class="oracle-card-title" title="${esc(a.title)}">${esc(a.title)}</span><span class="pill pill-${esc(v.pill)}">${esc(v.label)}</span></div>
      <dl class="oracle-card-fields small">${field('Change', a.change)}${field('Where', a.where)}${field('Backup', a.backup)}${field('Why', a.why)}</dl>
      <div class="oracle-card-from small${v.fromContent ? ' warn' : ' muted'}">${v.auto ? '<span class="badge warn">Night watch</span> Done without asking. ' : ''}${esc(v.requester)}</div>
      ${a.result ? `<div class="oracle-card-result small${a.result.ok ? '' : ' error'}">${esc(a.result.text)}</div>` : ''}
      ${v.canDo || v.canUndo ? `<div class="row oracle-card-actions">
        ${v.canDo ? `<button class="btn primary sm" type="button" data-oracle-act="${esc(a.id)}">Do it</button><button class="btn ghost sm" type="button" data-oracle-dismiss="${esc(a.id)}">Dismiss</button>` : ''}
        ${v.canUndo ? `<button class="btn ghost sm" type="button" data-oracle-undo="${esc(a.id)}" title="Put back the backup taken before the action">Undo</button>` : ''}
      </div>` : ''}
    </div>`;
  }
  // the morning summary's Undo buttons, for the actions that can still be undone
  function summaryUndoHtml(m) {
    const cards = or.messages.filter((x) => x.kind === 'action' && (m.actions || []).includes(x.action?.id) && x.action.result?.undoable);
    return cards.length ? `<div class="row oracle-card-actions">${cards.map((x) => `<button class="btn ghost sm oracle-cut" type="button" data-oracle-undo="${esc(x.action.id)}" title="Undo: ${esc(x.action.title)}">Undo: ${esc(x.action.title)}</button>`).join('')}</div>` : '';
  }
  // the Night watch (its form, or its strip while on) and the runs watched or muted
  function opsHtml(w) {
    const nw = M.nightWatchView(or.service?.nightWatch, { fmtTime: time });
    const parts = [];
    if (or.nightForm) {
      const f = or.nightForm;
      parts.push(`<form class="oracle-night-form" data-oracle-night-form>
        <div class="field">
          <label for="oracle-night-until-${w}">Night watch until</label>
          <input type="datetime-local" id="oracle-night-until-${w}" class="oracle-night-until" value="${esc(f.until || '')}"${f.saving ? ' disabled' : ''} />
          <div class="hint">Until then the Oracle fixes what stops the roadmap without asking, but only with the permissions you chose on the Night watch screen (by default: retry a failed item and refresh issue text). Each action is logged with its backup and sent as a notification. Gates stay yours; it never closes issues or pushes.</div>
          ${f.error ? `<p class="error small">${esc(f.error)}</p>` : ''}
        </div>
        <div class="row"><button class="btn primary sm" type="submit"${f.saving ? ' disabled' : ''}>Start</button><button class="btn ghost sm" type="button" data-oracle-night-cancel>Cancel</button></div>
      </form>`);
    } else if (nw.active) {
      parts.push(`<div class="row oracle-ops-row"><span class="badge warn" title="Repairs that keep the roadmap going run without asking; everything else waits for you${nw.selfHealing ? '. Turn it off in Settings › Execution › Oracle' : ''}">${esc(nw.label)}</span><span class="spacer"></span>${nw.selfHealing ? '' : '<button class="btn ghost sm" type="button" data-oracle-night-off>Turn off</button>'}</div>`);
    }
    // the runs and roadmaps watched, the runs muted: one compact row (the full id on hover)
    const watching = (or.wake?.watching || []).map((x) => {
      const name = x.runId ? x.runId : `roadmap of ${x.projectId}`;
      return `<button class="btn ghost sm oracle-cut" type="button" data-oracle-unwatch="${esc(JSON.stringify(x.runId ? { runId: x.runId } : { projectId: x.projectId }))}" title="Watching ${esc(name)}: its events wake the Oracle until it ends. Click to stop watching.">${esc(name)} ×</button>`;
    });
    const muted = (or.wake?.muted || []).map((id) => `<button class="btn ghost sm oracle-cut" type="button" data-oracle-mute="${esc(id)}" data-on="0" title="Muted: ${esc(id)}'s events do not wake the Oracle. Click to unmute.">${esc(id)} ×</button>`);
    if (watching.length || muted.length) {
      parts.push(`<div class="row oracle-ops-row small">${watching.length ? `<span class="muted">Watching</span>${watching.join('')}` : ''}${muted.length ? `<span class="muted">Muted</span>${muted.join('')}` : ''}</div>`);
    }
    if (or.wake?.wakeScope === 'off') parts.push('<div class="muted small">Run events do not wake the Oracle (Settings › Execution › Oracle).</div>');
    return parts.join('');
  }
  // an answer's "Use this text" belongs to the gate its question was about
  function refAt(all, i) {
    for (let j = i; j >= 0; j--) if (all[j].role === 'user') return all[j].context?.ref || '';
    return '';
  }
  // the conversation's own parts around the shared chat's messages (#274)
  const emptyHtml = () => '<div class="svc-empty muted small">The Oracle keeps one conversation for the whole app. It reads your runs (events, sessions, decisions, costs), the roadmaps and the Backlog, the workflows and skills, and your projects\' repositories, read-only. Ask it why a run failed, where the tokens go or what to do next. Run events wake it when they need you. It changes nothing itself: it sends each change to the agent that owns it (the Product Owner for the Backlog, the Supervisor for runs, workflows and skills), where it is done or waits for your click.</div>';
  const pendingHtml = (f) => `<div class="sup-wmsg user"><div class="sup-wmsg-meta">You</div><div class="oracle-text">${esc(or.pending || f.text)}</div>${or.drafts.images.length ? `<div class="oracle-thumbs">${or.drafts.images.map((i) => `<span class="oracle-thumb"><img src="${esc(i.dataUrl)}" alt="" /></span>`).join('')}</div>` : ''}</div>`;
  // the questions waiting for the one in flight (#183), and an error of the Oracle's own buttons
  const afterHtml = () => or.queue.map(({ q, context }) => `<div class="sup-wmsg user oracle-queued"><div class="sup-wmsg-meta">You · <span class="badge">queued</span>${context ? ` · <span class="muted" title="${esc(context.label)}">${esc(context.label)}</span>` : ''}</div><div class="oracle-text">${esc(q)}</div></div>`).join('')
    + (or.error ? `<div class="sup-wmsg system error"><div class="sup-wmsg-meta">now</div><div>${esc(or.error)}</div></div>` : '');
  function noticeHtml(v) {
    if (v.state === 'paused') {
      const t = v.today || {};
      return `<div class="oracle-notice-box"><span class="badge warn">Paused by budget</span> <span>Spent ${esc(money(t.spentUsd))} of ${esc(money(t.limitUsd))} today. <a href="#" data-oracle-settings>Raise it in Settings</a>, or it resumes tomorrow.</span></div>`;
    }
    if (v.state === 'unavailable') {
      const o = v.owner;
      return `<div class="oracle-notice-box"><span class="badge">Unavailable</span> <span>The Oracle answers in another app process (pid ${esc(String(o.pid))} on ${esc(o.host || '?')}${o.since ? `, since ${esc(time(o.since))}` : ''}). Ask it there, or close that window.</span></div>`;
    }
    return '';
  }
  function memoryHtml(w) {
    const f = or.memory;
    if (!or.memoryOpen) return '';
    if (!f.editing) {
      return `<div class="oracle-memory-view"><div class="row oracle-memory-head"><b>Memory</b><span class="badge">saved</span><span class="spacer"></span><button class="btn ghost sm" type="button" data-oracle-mem-edit>Edit</button><button class="btn ghost sm" type="button" data-oracle-mem-close>Close</button></div>
        <div class="oracle-memory-text small">${f.text.trim() ? esc(f.text) : '<span class="muted">Empty.</span>'}</div></div>`;
    }
    return `<form class="oracle-memory-form" data-oracle-mem-form>
      <div class="field">
        <label for="oracle-mem-${w}">Memory</label>
        <textarea id="oracle-mem-${w}" class="oracle-mem-input" rows="8"${f.saving ? ' disabled' : ''}>${esc(f.draft)}</textarea>
        <div class="hint">Your standing decisions (e.g. "UI issues need UI criteria", "reply in Portuguese"). The Oracle reads them at every session start; only you change them. Import adds decisions from a pasted text.</div>
        ${f.error ? `<p class="error small oracle-mem-error">${esc(f.error)}</p>` : ''}
      </div>
      <div class="row"><button class="btn primary sm" type="submit"${f.saving ? ' disabled' : ''}>Save</button><button class="btn ghost sm" type="button" data-oracle-mem-cancel>Cancel</button><span class="spacer"></span><button class="btn ghost sm" type="button" data-oracle-mem-import-open data-testid="oracle-memory-import-open" title="Add standing decisions from a pasted text, e.g. a Claude Code memory index"${f.importing ? ' aria-expanded="true"' : ''}>Import</button></div>
      ${f.importing ? `<div class="field oracle-mem-import" data-testid="oracle-memory-import">
        <label for="oracle-mem-import-${w}">Pasted text</label>
        <textarea id="oracle-mem-import-${w}" class="oracle-mem-import-input" rows="4" placeholder="e.g. a Claude Code memory index: - [Title](file.md) - the decision">${esc(f.importText || '')}</textarea>
        <div class="hint">One decision per line; headings and links to memory files are dropped. They are added to the memory above, and kept when you Save.</div>
        <div class="row"><button class="btn primary sm" type="button" data-oracle-mem-import>Import</button><button class="btn ghost sm" type="button" data-oracle-mem-import-cancel>Cancel</button></div>
      </div>` : ''}
    </form>`;
  }
  // #244: the model every turn uses, and whether the last turn started a fresh session or resumed it
  function statusHtml() {
    const s = or.service;
    if (!s?.model) return '';
    const mode = s.sessionMode === 'fresh'
      ? '<span class="badge" data-testid="oracle-session-mode" title="The last turn started a new session from the skill, the memory and the app\'s state note">fresh session</span>'
      : s.sessionMode === 'resumed'
        ? '<span class="badge" data-testid="oracle-session-mode" title="The last turn went on with the same session (its cache was warm)">resumed session</span>' : '';
    return `<span class="badge" data-testid="oracle-model" title="${esc(s.model)}${s.effort ? `, effort ${esc(s.effort)}` : ''}">${esc(Robots.plaqueFor(s.model))}</span> ${mode}`;
  }
  function footHtml(v) {
    const t = v.today;
    const budget = !t ? '' : t.limitUsd ? `Today ${money(t.spentUsd)} of ${money(t.limitUsd)} daily budget.` : `Today ${money(t.spentUsd)} (no daily cap).`;
    return `${budget} ${devMode() ? 'Simulated (developer mode): no model is called and nothing is spent.' : 'Each message is one call to the model.'}`;
  }

  // #274: the turn a surface shows without having sent it: the other surface's question in flight, or
  // the Oracle's own turn
  function turnElsewhere(w) {
    if (or.pending) return or.liveIn === w ? null : { text: or.pending, since: or.pendingSince };
    return or.service?.busy ? { since: or.busySince } : null;
  }
  function render() {
    const v = view();
    // a failed answer keeps its question in the input, once
    const last = or.messages.at(-1);
    if (v.state === 'error' && v.resendText && !or.drafts.text && last && or.refilledFor !== last.id) { or.refilledFor = last.id; setDraftText(v.resendText); }
    const where = screen();
    // a turn the Oracle answers on its own (the service is busy, no send here) runs since it was first seen
    if (!or.service?.busy) or.busySince = null; else if (!or.busySince) or.busySince = Date.now();
    for (const w of ALL_SURFACES) {
      if (!shownIn(w) || !chats[w]) continue;
      const chat = chats[w];
      chat.update({ messages: or.messages, turn: turnElsewhere(w) });
      const memBox = $(`#oracle-memory-${w}`);
      const editingHere = memBox.querySelector('textarea');
      // the form is redrawn on its own changes only, never while typing
      if (!editingHere || !or.memory.editing || or.memory.saving || or.memory.error !== memBox.dataset.error || String(or.memory.rev || 0) !== memBox.dataset.rev) {
        memBox.innerHTML = memoryHtml(w);
        memBox.dataset.error = or.memory.error || '';
        memBox.dataset.rev = String(or.memory.rev || 0);
      }
      memBox.classList.toggle('hidden', !or.memoryOpen);
      // the Night watch form is redrawn on its own changes only, never while picking the time
      const ops = $(`#oracle-ops-${w}`);
      const nf = or.nightForm;
      const key = nf ? `form:${nf.saving ? 1 : 0}:${nf.error || ''}` : 'strip';
      if (!nf || !(ops.querySelector('[data-oracle-night-form]') && ops.dataset.key === key)) ops.innerHTML = opsHtml(w);
      ops.dataset.key = key;
      ops.classList.toggle('hidden', !ops.innerHTML.trim());
      // while on, the strip's Turn off is the control
      const nightOn = M.nightWatchView(or.service?.nightWatch).active;
      document.querySelectorAll('[data-oracle-night]').forEach((b) => (b.disabled = nightOn || v.state === 'unavailable'));
      $(`#oracle-screen-${w}`).textContent = where;
      $(`#oracle-screen-${w}`).title = where;
      $(`#oracle-status-${w}`).innerHTML = statusHtml();
      $(`#oracle-notice-${w}`).innerHTML = noticeHtml(v);
      // #183: with a context chip, its starters stay under the box (asked while busy, they queue)
      $(`#oracle-context-${w}`).innerHTML = or.context ? `<span class="oracle-context-chip" data-testid="oracle-context-chip" title="${esc(or.context.label)}"><span class="oracle-cut">${esc(or.context.label)}</span><button class="icon-btn" type="button" data-oracle-uncontext aria-label="Remove the gate context" title="Remove the gate context: the next questions are not about this gate"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg></button></span>` : '';
      const starters = or.context?.starters?.length ? or.context.starters : null;
      const startersOn = v.state !== 'unavailable' && (v.chipsEnabled || v.state === 'answering');
      $(`#oracle-starters-${w}`).innerHTML = starters
        ? starters.map((q) => `<button class="chip" type="button" data-oracle-q="${esc(q)}"${startersOn ? '' : ' disabled'}>${esc(q)}</button>`).join('') : '';
      $(`#oracle-chips-${w}`).innerHTML = !starters && (v.state === 'empty' || (v.state === 'answering' && !or.messages.length))
        ? SUGGESTIONS.map((q) => `<button class="chip" type="button" data-oracle-q="${esc(q)}"${v.chipsEnabled ? '' : ' disabled'}>${esc(q)}</button>`).join('') : '';
      $(`#oracle-thumbs-${w}`).innerHTML = v.attachments.map((i) => `<span class="oracle-thumb draft" title="${esc(i.name || 'Pasted image')}"><img src="${esc(i.dataUrl)}" alt="Pasted image" /><button class="icon-btn" type="button" data-oracle-unpaste="${esc(i.id)}" title="Remove this image" aria-label="Remove this image"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg></button></span>`).join('');
      chat.form.classList.toggle('hidden', v.state === 'unavailable');
      // Send and the text box follow the state (paused, unavailable, answering); the chips just redrawn get the busy lock
      chat.refresh();
      const pe = $(`#oracle-paste-error-${w}`);
      pe.textContent = or.pasteError || '';
      pe.classList.toggle('hidden', !or.pasteError);
      $(`#oracle-foot-${w}`).textContent = footHtml(v);
      document.querySelectorAll('[data-oracle-reset]').forEach((b) => (b.disabled = v.state === 'answering' || v.state === 'unavailable'));
    }
    const badge = $('#nav-oracle-count');
    badge.textContent = String(v.unread);
    badge.classList.toggle('hidden', !v.unread);
    badge.title = `${v.unread} new answer${v.unread === 1 ? '' : 's'} from the Oracle`;
    markRead();
    window.GateOracle?.paint?.();
    window.AgentsWindow?.changed?.();
  }

  // ---- the drawer and the dock -------------------------------------------------------------
  // side: beside the screen (#183, a gate stays answerable on the left): no backdrop, the content narrows
  function openDrawer({ side = false } = {}) {
    if (onDashboard()) { render(); $('#oracle-q-dock')?.focus({ preventScroll: true }); return; }
    or.drawer = true;
    $('#oracle-drawer').classList.add('open');
    $('#oracle-drawer').classList.toggle('side', side);
    $('.shell')?.classList.toggle('oracle-side', side);
    $('#oracle-drawer').setAttribute('aria-hidden', 'false');
    $('#oracle-backdrop').classList.toggle('hidden', side);
    render();
    const loading = load();
    setTimeout(() => $('#oracle-q-drawer')?.focus({ preventScroll: true }), 200);
    return loading;
  }
  function closeDrawer() {
    if (!or.drawer) return;
    or.drawer = false;
    $('#oracle-drawer').classList.remove('open', 'side');
    $('.shell')?.classList.remove('oracle-side');
    $('#oracle-drawer').setAttribute('aria-hidden', 'true');
    $('#oracle-backdrop').classList.add('hidden');
    render();
  }
  // #183: the chat about something on screen (a gate): its context chip and starters, the drawer beside it
  // #271: a context with a first `question` (a failed roadmap item) asks it at once, once the chat is
  // loaded (a chat that could not load shows its error, nothing is asked); while the Oracle answers
  // another question it waits in line with its context (ask)
  function openWith(context) {
    or.context = context || null;
    const loading = openDrawer({ side: true });
    if (context?.question) Promise.resolve(loading).then(() => { if (or.loaded && or.context === context) ask(context.question); });
  }

  // #263: the drawer's "Open in a window" (the Agents window on the Oracle; agents-window.js hides it in the browser UI)
  const OPEN_WINDOW_BUTTON = '<button class="icon-btn" type="button" data-agents-window="oracle" data-testid="agent-chat-open-window" title="Open in a window (Ctrl+Shift+A)" aria-label="Open the Oracle in a window"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="14" height="14" rx="2" /><path d="M9 3h12v12M21 3l-9 9" /></svg></button>';
  const surfaceHtml = (w) => `
    <div class="drawer-head oracle-head">
      <div class="oracle-who">${avatar()}
        <div class="sup-head">
          <h2 class="drawer-title oracle-title">Oracle</h2>
          <div class="muted small oracle-cut">On: <span id="oracle-screen-${w}"></span></div>
          <div class="small oracle-status" id="oracle-status-${w}"></div>
        </div>
      </div>
      <div class="row">
        <button class="btn ghost sm" type="button" data-oracle-night title="Let the Oracle fix what stops the roadmap without asking, until a time you choose">Night watch</button>
        <button class="btn ghost sm" type="button" data-oracle-memory title="The owner's standing decisions, read at every session start">Memory</button>
        <button class="btn ghost sm" type="button" data-oracle-reset title="A new session from a handoff note; the conversation and the memory are kept">New session</button>
        ${w === WINDOW ? '' : OPEN_WINDOW_BUTTON}${w === 'drawer' ? '<button id="btn-oracle-close" class="icon-btn" type="button" title="Close (Esc)"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg></button>' : ''}
      </div>
    </div>
    <div id="oracle-chat-${w}" class="drawer-body svc-body oracle-body"></div>`;
  // #274: each surface's conversation, text box and Send go through the shared chat; the Oracle's own
  // parts sit in its slots (memory and Night watch above the conversation, the gate's starters below)
  function mountChat(w) {
    const chat = window.AgentChat.create($(`#oracle-chat-${w}`), {
      agent: 'Oracle',
      ...(w === WINDOW ? { agentId: 'oracle' } : {}),
      ids: { messages: `oracle-log-${w}`, input: `oracle-q-${w}` },
      classes: { messages: 'svc-log oracle-log', form: 'svc-form', input: 'svc-input oracle-input', send: 'oracle-send', live: 'oracle-live' },
      placeholder: 'Ask the Oracle… (Enter to send, Shift+Enter for a new line; paste a screenshot)',
      renderMessage: (m, i, all) => messageHtml(m, refAt(all, i)),
      emptyHtml,
      pendingHtml,
      afterHtml,
      onRender: (log) => log.querySelectorAll('.oracle-md').forEach(decorate),
      // typing only changes Send (the log is not redrawn on every key)
      onInput: setDraftText,
      canSend: () => view().ready,
      inputEnabled: () => view().inputEnabled,
      hasDraft: () => or.drafts.images.length > 0,
      onPaste,
      send: (q) => send(q, w),
      onStop: () => api.cancelChatTurn('oracle', '').catch((err) => { or.error = errMsg(err); render(); }),
      onDone: sent,
    });
    chat.slot('top').innerHTML = `<div id="oracle-memory-${w}" class="oracle-memory hidden" data-testid="oracle-memory"></div>
      <div id="oracle-ops-${w}" class="oracle-ops hidden"></div>`;
    chat.slot('pills').innerHTML = `<div id="oracle-notice-${w}" class="oracle-notice"></div>
      <div id="oracle-chips-${w}" class="svc-chips"></div>`;
    chat.slot('compose').innerHTML = `<div id="oracle-thumbs-${w}" class="oracle-thumbs"></div>
      <div id="oracle-context-${w}" class="oracle-context"></div>`;
    chat.slot('foot').innerHTML = `<div id="oracle-starters-${w}" class="svc-chips oracle-starters" role="group" aria-label="Suggested questions about the gate"></div>
      <p id="oracle-paste-error-${w}" class="error small oracle-paste-error hidden"></p>
      <p id="oracle-foot-${w}" class="muted small svc-note"></p>`;
    chats[w] = chat;
  }

  // the head buttons of every surface (bound again when the window's surface is mounted, #263)
  function bindOps() {
    document.querySelectorAll('[data-oracle-reset]').forEach((b) => (b.onclick = reset));
    document.querySelectorAll('[data-oracle-memory]').forEach((b) => (b.onclick = () => (or.memoryOpen && or.memory.editing ? null : openMemory())));
    document.querySelectorAll('[data-oracle-night]').forEach((b) => (b.onclick = () => {
      if (M.nightWatchView(or.service?.nightWatch).active) return;
      or.nightForm = or.nightForm ? null : { until: M.defaultNightEnd(new Date(), TimeZone.current()), saving: false, error: null };
      render();
      if (or.nightForm) document.querySelector(`#oracle-night-until-${or.window ? WINDOW : or.drawer ? 'drawer' : 'dock'}`)?.focus({ preventScroll: true });
    }));
  }

  // #263: the Oracle in the Agents window: the same conversation as a third surface in the pane
  window.AgentsWindow?.register({
    id: 'oracle',
    name: 'Oracle',
    order: 1,
    color: '#1E3A8A',
    avatar: () => Robots.svg('oracle', 'idle', { bubble: false, plaque: '' }),
    mount(el) {
      el.innerHTML = surfaceHtml(WINDOW);
      mountChat(WINDOW);
      bindOps();
      or.window = true;
      render();
      if (!or.loaded) load();
      setTimeout(() => $(`#oracle-q-${WINDOW}`)?.focus({ preventScroll: true }), 50);
    },
    unmount() {
      or.window = false;
      delete chats[WINDOW];
    },
    unread: () => view().unread,
    busy: () => !!(or.pending || or.service?.busy),
    header: () => ({
      model: or.service?.model || window.oracleAgent?.model || '',
      cost: or.messages.reduce((a, m) => a + (m.costUsd || 0), 0),
      tokens: or.messages.some((m) => m.tokens != null) ? or.messages.reduce((a, m) => a + (Number(m.tokens) || 0), 0) : null,
    }),
  });

  registerView({
    id: 'oracle',
    modals: `
  <div id="oracle-backdrop" class="drawer-backdrop sup-backdrop hidden"></div>
  <aside id="oracle-drawer" class="drawer sup-drawer oracle-drawer" aria-hidden="true" aria-label="Oracle">${surfaceHtml('drawer')}</aside>`,
    mount() {
      // the dock on Home (its section is in place: views load in path order)
      const dash = $('#view-dashboard');
      dash.classList.add('oracle-docked');
      dash.insertAdjacentHTML('beforeend', `<aside id="oracle-dock" class="card oracle-dock" aria-label="Oracle">${surfaceHtml('dock')}</aside>`);
      // the header's button (#254), at the top right before the notifications bell
      const btn = document.createElement('button');
      btn.id = 'nav-oracle';
      btn.type = 'button';
      btn.className = 'btn ghost btn-icon nav-oracle';
      btn.title = 'Talk to the Oracle (on Home: its panel)';
      btn.innerHTML = `${avatar('nav')}<span>Oracle</span><span id="nav-oracle-count" class="nav-badge oracle-unread hidden"></span>`;
      btn.onclick = (e) => { e.stopPropagation(); if (or.drawer) closeDrawer(); else openDrawer(); };
      const corner = $('.topbar .header-right');
      corner.insertBefore(btn, corner.querySelector('.notif-wrap'));
      // Home's Overview shows the dock: the drawer closes there
      SURFACES.forEach(mountChat);
      const dashView = viewRegistry.get('dashboard');
      const showDash = dashView.show;
      dashView.show = () => { showDash(); closeDrawer(); render(); };

      $('#btn-oracle-close').onclick = closeDrawer;
      $('#oracle-backdrop').onclick = closeDrawer;
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && or.drawer) closeDrawer(); });
      bindOps();
      // #273: the messages' times follow the chosen zone, in the surfaces not shown too (render skips
      // them, and coming back to one does not redraw it)
      TimeZone.onChange(() => {
        for (const w of ALL_SURFACES) chats[w]?.update({ messages: or.messages, turn: turnElsewhere(w) });
        render();
      });
      document.addEventListener('input', (e) => {
        if (e.target.classList?.contains('oracle-mem-input')) or.memory = { ...or.memory, draft: e.target.value };
        if (e.target.classList?.contains('oracle-mem-import-input')) or.memory = { ...or.memory, importText: e.target.value };
        if (e.target.classList?.contains('oracle-night-until') && or.nightForm) or.nightForm = { ...or.nightForm, until: e.target.value };
      });
      document.addEventListener('submit', (e) => {
        if (e.target.matches?.('[data-oracle-mem-form]')) { e.preventDefault(); saveMemory(); }
        if (e.target.matches?.('[data-oracle-night-form]')) { e.preventDefault(); startNightWatch(); }
      });
      api.onOracleChanged?.(reloadSoon);
      // #180: the question in flight, as the service reports it
      api.onChatProgress?.((p) => {
        if (p?.chat !== 'oracle') return;
        // #263: a question sent from the other window: shown as a turn started elsewhere until its
        // end, when oracle:changed reloads the conversation (reloadSoon)
        let started = false;
        if (!or.live) {
          if (p.phase === 'end' || or.pending) return;
          Object.assign(or, { pending: '…', pendingSince: Date.now(), liveIn: null, live: window.LiveTurn.create({ agent: 'Oracle' }), elsewhere: true });
          started = true;
        }
        window.LiveTurn.apply(or.live, p);
        // a turn started elsewhere has no surface of its own: every mounted chat shows its steps
        for (const c of or.liveIn ? [chats[or.liveIn]] : Object.values(chats)) c?.setLiveTurn(or.live);
        if (started) render();
        // at its end the conversation is reloaded, then the questions queued here meanwhile are sent (sent)
        if (p.phase === 'end' && or.elsewhere) { Object.assign(or, { pending: null, live: null, liveIn: null, elsewhere: false }); load().then(sent); }
      });
      document.addEventListener('click', (e) => {
        const t = e.target;
        const chip = t.closest('[data-oracle-q]');
        if (chip) { ask(chip.dataset.oracleQ); return; }
        if (t.closest('[data-oracle-uncontext]')) { or.context = null; render(); return; }
        const use = t.closest('[data-oracle-use-text]');
        if (use) { window.GateOracle?.useText(use.dataset.oracleUseText, use.dataset.text); return; }
        const un = t.closest('[data-oracle-unpaste]');
        if (un) { or.drafts.images = M.removeImage(or.drafts.images, un.dataset.oracleUnpaste); or.pasteError = null; render(); return; }
        if (t.closest('[data-oracle-mem-cancel]')) { or.memory = M.cancelMemory(or.memory); or.memoryOpen = false; render(); return; }
        if (t.closest('[data-oracle-mem-close]')) { or.memoryOpen = false; render(); return; }
        if (t.closest('[data-oracle-mem-edit]')) { or.memory = M.editMemory(or.memory); render(); return; }
        if (t.closest('[data-oracle-mem-import-open]')) { toggleImport(!or.memory.importing); return; }
        if (t.closest('[data-oracle-mem-import-cancel]')) { toggleImport(false); return; }
        if (t.closest('[data-oracle-mem-import]')) { importMemory(); return; }
        const act = t.closest('[data-oracle-act]');
        if (act) { act.disabled = true; doAction(act.dataset.oracleAct); return; }
        const dismiss = t.closest('[data-oracle-dismiss]');
        if (dismiss) { dismissAction(dismiss.dataset.oracleDismiss); return; }
        const undoBtn = t.closest('[data-oracle-undo]');
        if (undoBtn) { undoAction(undoBtn.dataset.oracleUndo); return; }
        const runLink = t.closest('[data-oracle-open-run]');
        if (runLink) { e.preventDefault(); openRun(runLink.dataset.oracleOpenRun); return; }
        const requestLink = t.closest('[data-oracle-open-request]');
        if (requestLink) { e.preventDefault(); openRequest({ ...requestLink.dataset }); return; }
        const mute = t.closest('[data-oracle-mute]');
        if (mute) { setWatch(() => api.muteOracleRun({ runId: mute.dataset.oracleMute, on: mute.dataset.on === '1' })); return; }
        const unwatch = t.closest('[data-oracle-unwatch]');
        if (unwatch) { setWatch(() => api.oracleWatch({ ...JSON.parse(unwatch.dataset.oracleUnwatch), on: false })); return; }
        if (t.closest('[data-oracle-night-cancel]')) { or.nightForm = null; render(); return; }
        if (t.closest('[data-oracle-night-off]')) { stopNightWatch(); return; }
        if (t.closest('[data-oracle-settings]')) { e.preventDefault(); openSettings(); return; }
        const link = t.closest('[data-oracle-link]');
        if (link) { e.preventDefault(); follow(JSON.parse(link.dataset.oracleLink)); return; }
        const copy = t.closest('[data-oracle-copy]');
        if (copy) { api.clipboardWrite(copy.dataset.oracleCopy).then(() => { copy.title = 'Copied'; }).catch(() => {}); return; }
        // any other link in an answer: not a navigation of the app's page
        const a = t.closest('.oracle-md a[href]');
        if (a && !a.target) e.preventDefault();
      });
      load();
    },
  });

  window.OracleChat = { ask, attach, open: () => openDrawer(), openWith, close: closeDrawer, reload: load, pendingRef: () => (or.pending ? or.pendingRef || '' : null) };
})();
