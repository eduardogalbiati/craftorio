// Supervisor chat (#28): the app-wide conversation with the Supervisor, in a right-side drawer
// (#svc-drawer) opened from the Workflows screen's Supervisor button (#254, #264: no screen of its
// own and no top bar button; window.openSupervisorChat, also used by the Oracle's request links).
// The drawer shows the latest exchanges; Expand widens it to the whole conversation and what the
// supervisor can read. Each message carries what the person is looking at (screenContext(): "Builder, editing workflow X",
// "Analytics, range 2026-09-01 to 2026-09-30"), so requests need not repeat it. The supervisor reads the
// app's data with its read-only MCP tools (src/supervisor-tools.js); it cannot change anything yet.
// Developer or simulated mode asks the simulated supervisor (no model call).
// Live progress (#180, window.LiveTurn, live-turn.js): while it answers, what the supervisor does and
// its answer as it is written (chat:progress 'supervisor'); Stop (api.cancelChatTurn) keeps what was written.
// The conversation, the text box and Send go through the agents' shared chat (#274, agent-chat.js): the
// box empties as soon as Send is clicked and gets the question back with the error when it fails.
// Uses app.js globals ($, esc, state, api, errMsg, devMode, fmtCost, markdownHtml, confirmDialog,
// shownRunId, registerView).
(() => {
  // window (#263): the Agents window's pane shows the conversation; liveIn / pending: the chat a
  // question in flight was sent from and its text (the other surface shows the turn); unread: the
  // answers that arrived while neither the drawer nor the pane showed them
  const sv = { messages: [], busy: false, loaded: false, drawer: false, full: false, tools: [], live: null, window: false, liveIn: null, pending: null, since: 0, unread: 0 };
  let chat = null; // the shared chat (agent-chat.js), mounted with the drawer
  let winChat = null; // the Agents window's chat (#263), while its pane shows the Supervisor
  const SUGGESTIONS = [
    'What am I looking at?',
    'Which runs failed recently, and why?',
    'How much did I spend this month?',
    'Which workflow fits a small bug fix?',
  ];
  const LABELS = {
    sessions: 'Sessions', dashboard: 'Home', project: 'Project', backlog: 'Backlog', roadmap: 'Roadmap', artifacts: 'Artifacts',
    workflows: 'Workflows', agents: 'Agents', skills: 'Skills', usage: 'Usage', analytics: 'Analytics', duo: 'Write & Review',
    arena: 'AI Arena', run: 'Run details', runchat: 'Run chat', settings: 'Settings', nightwatch: 'Night watch',
  };

  // What the current screen shows, in one line for the supervisor.
  function screenContext() {
    const view = state.view;
    const label = LABELS[view] || view || 'unknown screen';
    const parts = [label];
    const runId = typeof shownRunId === 'function' ? shownRunId() : null;
    if (runId) parts.push(`run ${runId}${state.run?.workflow ? ` (${state.run.workflow})` : ''}`);
    if (view === 'workflows') {
      parts.push(`${state.workflowsTab || 'runs'} tab`);
      if (state.workflowsTab === 'builder' && window.builderContext) parts.push(window.builderContext());
    }
    if (view === 'analytics' && window.analyticsContext) parts.push(window.analyticsContext());
    if (view === 'project' && state.pv?.project) parts.push(`project ${state.pv.project.name || state.pv.id} (id ${state.pv.id})`);
    if ((view === 'backlog' || view === 'roadmap') && window.BacklogActions?.projectId?.()) parts.push(`project ${window.BacklogActions.projectId()}`);
    if (view === 'artifacts') {
      const sel = state.art?.sel;
      const file = typeof sel === 'string' ? sel : sel?.path;
      if (file) parts.push(`artifact ${file}`);
    }
    if (view === 'sessions' && window.SessionsView?.shownTerminalId?.()) parts.push(`terminal ${window.SessionsView.shownTerminalId()}`);
    return parts.join(', ');
  }
  window.supervisorScreenContext = screenContext;

  async function load() {
    try {
      sv.messages = await api.supervisorChatHistory();
      sv.loaded = true;
      chat.setError('');
    } catch (e) { chat.setError(errMsg(e)); }
    render();
  }
  // the drawer shows the latest exchanges; expanded, all of them
  const shown = () => (sv.full ? sv.messages : sv.messages.slice(-20));

  // The chat's send (#274): the question with the screen it was asked on and the images pasted in the
  // box (#130; a suggestion chip sends without them, they stay in the box); a failure goes back to the
  // chat (the question back in the box, the error shown)
  // `from`: the chat it was sent from (the drawer's or the Agents window's, #263)
  const sendFrom = (from) => async (q, _attachments, { fromBox } = {}) => {
    const c = from();
    const screen = screenContext();
    Object.assign(sv, { busy: true, pending: q, since: Date.now(), liveIn: c, live: window.LiveTurn.create({ agent: 'supervisor' }) });
    c.setLiveTurn(sv.live);
    render();
    try {
      const attachments = fromBox ? await PasteImage.collect(c.input) : [];
      if (fromBox) PasteImage.clear(c.input);
      const out = await api.askSupervisorChat({ question: q, screen, mock: devMode(), ...(attachments.length ? { attachments } : {}) });
      sv.messages = out.messages;
      if (!sv.drawer && !sv.window) sv.unread += 1;
      return { messages: shown() };
    } finally {
      Object.assign(sv, { busy: false, live: null, liveIn: null, pending: null });
    }
  };

  async function clear() {
    if (!await confirmDialog('New conversation', 'The supervisor forgets this conversation and its history is deleted.', 'Clear')) return;
    try { sv.messages = await api.clearSupervisorChat(); } catch (e) { chat.setError(errMsg(e)); }
    render();
  }

  function openDrawerPanel() {
    sv.drawer = true;
    sv.unread = 0;
    $('#svc-drawer').classList.add('open');
    $('#svc-drawer').setAttribute('aria-hidden', 'false');
    $('#svc-backdrop').classList.remove('hidden');
    render();
    // #240: requests from other agents arrive while it is closed
    load();
    setTimeout(() => $('#svc-q-drawer').focus({ preventScroll: true }), 200);
  }
  function closeDrawerPanel() {
    sv.drawer = false;
    $('#svc-drawer').classList.remove('open');
    $('#svc-drawer').setAttribute('aria-hidden', 'true');
    $('#svc-backdrop').classList.add('hidden');
  }
  window.openSupervisorChat = openDrawerPanel;

  // Expand (#264, where the Supervisor page was): the drawer over the whole screen, with every
  // message and the list of what the supervisor can read
  function setFull(on) {
    sv.full = on;
    $('#svc-drawer').classList.toggle('full', on);
    $('#svc-side').classList.toggle('hidden', !on);
    const btn = $('#btn-svc-full');
    btn.textContent = on ? 'Collapse' : 'Expand';
    btn.setAttribute('aria-pressed', String(on));
    render();
    if (on && !sv.tools.length) api.supervisorTools().then((t) => { sv.tools = t; render(); }).catch(() => {});
  }

  // ---- rendering ---------------------------------------------------------------------------------
  function messageHtml(msg, i, all) {
    const time = msg.ts ? new Date(msg.ts).toLocaleString() : '';
    // #240: another agent's request and its result, one card (agent-request.js)
    if (msg.role === 'request') return window.AgentRequest.cardHtml(msg, all, { testid: 'svc-request', owner: 'supervisor' });
    if (window.AgentRequest.inCard(msg)) return '';
    if (msg.role === 'user') {
      return `<div class="sup-wmsg user"><div class="sup-wmsg-meta">You · ${esc(time)}${msg.screen ? ` · <span title="What the supervisor was told about the screen">${esc(msg.screen)}</span>` : ''}</div><div>${esc(msg.text)}</div></div>`;
    }
    if (msg.role === 'system') return `<div class="sup-wmsg system${msg.error ? ' error' : ''}"><div class="sup-wmsg-meta">${esc(time)}</div><div>${esc(msg.text)}</div></div>`;
    const meta = `Supervisor · ${esc(time)}${msg.simulated ? ' · simulated' : msg.model ? ` · ${esc(msg.model)}` : ''} · ${esc(fmtCost(msg.costUsd || 0))}${msg.stopped ? ' · <span class="badge warn" title="You stopped this turn: the answer is what was written until then">Stopped</span>' : ''}`;
    return `<div class="sup-wmsg svc-msg"><div class="sup-wmsg-meta"><span class="sup-mark">◆</span> ${meta}</div><div class="md md-compact">${markdownHtml(msg.text || '')}</div></div>`;
  }

  const emptyHtml = () => '<div class="svc-empty muted small">Ask about anything in the app: workflows, projects, runs, skills, agents, usage. I know which screen you are on, and I read the app\'s data (never your repositories\' code). I cannot change anything yet: I tell you what to change and where.</div>';

  function render() {
    const simulated = devMode();
    const cost = sv.messages.reduce((a, x) => a + (x.costUsd || 0), 0);
    const note = `${simulated ? 'Simulated (developer mode): no model is called and nothing is spent.' : 'Each message is one call to the model: it uses your Claude Code subscription.'}${cost ? ` Conversation cost ${fmtCost(cost)}.` : ''}`;
    const chips = SUGGESTIONS.map((q) => `<button class="chip" type="button" data-svc-q="${esc(q)}"${sv.busy ? ' disabled' : ''}>${esc(q)}</button>`).join('');
    // the drawer and the Agents window's pane (#263): the same conversation; a question sent from
    // the other one shows as a turn started elsewhere
    for (const [c, w, on] of [[chat, 'drawer', sv.drawer], [winChat, 'window', sv.window]]) {
      if (!c || !on) continue;
      // the pills first: the chat locks them while a message is in flight
      $(`#svc-chips-${w}`).innerHTML = chips;
      c.setMessages(shown());
      c.setTurn(sv.busy && sv.liveIn !== c ? { text: sv.pending, since: sv.since } : null);
      $(`#svc-note-${w}`).textContent = note;
    }
    if (sv.drawer) {
      $('#svc-screen').textContent = screenContext();
      if (sv.full) $('#svc-tools').innerHTML = sv.tools.map((t) => `<li><span class="mono">${esc(t.name)}</span> <span class="muted">${esc(t.description)}</span></li>`).join('');
    }
    document.querySelectorAll('.svc-clear').forEach((b) => (b.disabled = sv.busy || !sv.messages.length));
    window.AgentsWindow?.changed?.();
  }

  // the shared chat's options (#274), for the drawer and the window's pane: `from` is the chat itself,
  // read when a message is sent (the live turn's Stop included)
  const chatOptions = (from) => ({
    agent: 'Supervisor',
    classes: { messages: 'svc-log', form: 'svc-form', input: 'svc-input', send: 'svc-send' },
    placeholder: 'Ask the supervisor… (Enter to send, Shift+Enter for a new line)',
    renderMessage: messageHtml,
    emptyHtml,
    send: sendFrom(from),
    onStop: () => api.cancelChatTurn('supervisor', '').catch((err) => from().setError(errMsg(err))),
    onDone: render,
  });

  // #263: the Supervisor in the Agents window: the same conversation, a second chat in the pane
  window.AgentsWindow?.register({
    id: 'supervisor',
    name: 'Supervisor',
    order: 3,
    color: '#7C5CFF',
    avatar: () => '<span class="sup-mark" aria-hidden="true">◆</span>',
    mount(el) {
      el.innerHTML = '<div class="drawer-body sup-body svc-body"><div class="svc-main" data-svc-window></div></div>';
      winChat = window.AgentChat.create(el.querySelector('[data-svc-window]'), {
        ...chatOptions(() => winChat),
        agentId: 'supervisor',
        ids: { messages: 'svc-log-window', input: 'svc-q-window' },
      });
      winChat.slot('pills').innerHTML = '<div id="svc-chips-window" class="svc-chips"></div>';
      winChat.slot('foot').innerHTML = '<p id="svc-note-window" class="muted small svc-note"></p>';
      sv.window = true;
      sv.unread = 0;
      render();
      load();
      setTimeout(() => $('#svc-q-window')?.focus({ preventScroll: true }), 50);
    },
    unmount() {
      sv.window = false;
      winChat = null;
    },
    unread: () => sv.unread,
    busy: () => sv.busy,
    header: () => ({
      model: devMode() ? 'simulated' : [...sv.messages].reverse().find((m) => m.model)?.model || '',
      cost: sv.messages.reduce((a, x) => a + (x.costUsd || 0), 0),
      note: `On: ${screenContext()}`,
    }),
  });

  registerView({
    id: 'supervisor',
    modals: `
  <div id="svc-backdrop" class="drawer-backdrop sup-backdrop hidden"></div>
  <aside id="svc-drawer" class="drawer sup-drawer svc-drawer" data-testid="svc-drawer" aria-hidden="true" aria-label="Supervisor">
    <div class="drawer-head">
      <div class="sup-head">
        <h2 class="drawer-title"><span class="sup-mark">◆</span> Supervisor</h2>
        <div class="muted small">On: <span id="svc-screen"></span></div>
      </div>
      <div class="row">
        <button id="btn-svc-full" class="btn ghost sm" type="button" aria-pressed="false" title="The whole conversation and what the supervisor can read, over the whole screen">Expand</button>
        <button class="btn ghost sm svc-clear" type="button" title="New conversation: the supervisor forgets this one">New</button>
        <button class="icon-btn" type="button" data-agents-window="supervisor" data-testid="agent-chat-open-window" title="Open in a window (Ctrl+Shift+A)" aria-label="Open the Supervisor in a window"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="14" height="14" rx="2" /><path d="M9 3h12v12M21 3l-9 9" /></svg></button>
        <button id="btn-svc-close" class="icon-btn" title="Close (Esc)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </button>
      </div>
    </div>
    <div class="drawer-body sup-body svc-body">
      <div id="svc-chat" class="svc-main"></div>
      <aside id="svc-side" class="svc-side card hidden">
        <div class="sup-h">What it can read</div>
        <ul id="svc-tools" class="svc-tools small"></ul>
      </aside>
    </div>
  </aside>`,
    mount() {
      $('#btn-svc-close').onclick = closeDrawerPanel;
      $('#svc-backdrop').onclick = closeDrawerPanel;
      $('#btn-svc-full').onclick = () => setFull(!sv.full);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sv.drawer) closeDrawerPanel(); });
      document.querySelectorAll('.svc-clear').forEach((b) => (b.onclick = clear));
      // #274: the shared chat (the live turn's Stop included); the screen is read when the message
      // is sent: the one under the drawer
      chat = window.AgentChat.create($('#svc-chat'), {
        ...chatOptions(() => chat),
        ids: { messages: 'svc-log-drawer', input: 'svc-q-drawer' },
      });
      chat.slot('pills').innerHTML = '<div id="svc-chips-drawer" class="svc-chips"></div>';
      chat.slot('foot').innerHTML = '<p id="svc-note-drawer" class="muted small svc-note"></p>';
      // #180: the question in flight, as the service reports it
      api.onChatProgress?.((p) => {
        if (p?.chat !== 'supervisor' || !sv.live) return;
        window.LiveTurn.apply(sv.live, p);
        chat.setLiveTurn(sv.live);
      });
      // #241: the owner's Do it / Dismiss / Undo on a request card (agent-request.js)
      window.addEventListener('agent-request:changed', async (e) => {
        if (e.detail?.owner !== 'supervisor') return;
        if (e.detail.messages) sv.messages = e.detail.messages;
        else await load();
        chat.setError(e.detail.error || '');
        render();
      });
      document.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-svc-q]');
        if (chip) chat.ask(chip.dataset.svcQ);
      });
    },
  });
})();
