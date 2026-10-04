// Supervisor everywhere (#28): the app-wide Supervisor chat, in two places that show one conversation:
// - the drawer (#svc-drawer), opened from the top bar's "Supervisor" button on every screen;
// - the Supervisor page (menu item), the whole conversation history full page.
// Each message carries what the person is looking at (screenContext(): "Builder, editing workflow X",
// "Analytics, range 2026-09-01 to 2026-09-30"), so requests need not repeat it. The supervisor reads the
// app's data with its read-only MCP tools (src/supervisor-tools.js); it cannot change anything yet.
// Developer or simulated mode asks the simulated supervisor (no model call).
// Live progress (#180, window.LiveTurn, live-turn.js): while it answers, what the supervisor does and
// its answer as it is written (chat:progress 'supervisor'); Stop (api.cancelChatTurn) keeps what was written.
// Uses app.js globals ($, esc, state, api, errMsg, devMode, fmtCost, markdownHtml, confirmDialog,
// shownRunId, registerView).
(() => {
  const sv = { messages: [], busy: false, pending: null, error: null, loaded: false, drawer: false, tools: [], live: null };
  const SUGGESTIONS = [
    'What am I looking at?',
    'Which runs failed recently, and why?',
    'How much did I spend this month?',
    'Which workflow fits a small bug fix?',
  ];
  const LABELS = {
    sessions: 'Sessions', dashboard: 'Dashboard', projects: 'Projects', project: 'Project', backlog: 'Backlog', artifacts: 'Artifacts',
    workflows: 'Workflows', agents: 'Agents', skills: 'Skills', usage: 'Usage', analytics: 'Analytics', duo: 'Write & Review',
    arena: 'AI Arena', run: 'Run details', runchat: 'Run chat', settings: 'Settings', supervisor: 'Supervisor',
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
    if (view === 'backlog' && window.BacklogActions?.projectId?.()) parts.push(`project ${window.BacklogActions.projectId()}`);
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
      sv.error = null;
    } catch (e) { sv.error = errMsg(e); }
    render();
  }

  // field: the input the question was typed in, whose pasted images go with it (#130)
  async function ask(question, screen, field = null) {
    const q = String(question || '').trim();
    if (!q || sv.busy) return;
    Object.assign(sv, { busy: true, pending: q, error: null, live: window.LiveTurn.create({ agent: 'supervisor' }) });
    const attachments = await PasteImage.collect(field);
    document.querySelectorAll('.svc-input').forEach((el) => { el.value = ''; PasteImage.clear(el); });
    render();
    // #180: the timer and "Still working" move even when no item arrives
    const tick = setInterval(renderLive, 1000);
    try {
      const out = await api.askSupervisorChat({ question: q, screen, mock: devMode(), ...(attachments.length ? { attachments } : {}) });
      sv.messages = out.messages;
    } catch (e) {
      sv.error = errMsg(e);
    } finally {
      clearInterval(tick);
      Object.assign(sv, { busy: false, pending: null, live: null });
      render();
    }
  }

  // #180: only the live turn is redrawn on each event and each second
  function renderLive() {
    if (!sv.live) return;
    document.querySelectorAll('.svc-live').forEach((el) => {
      el.innerHTML = window.LiveTurn.html(sv.live);
      const log = el.parentElement;
      if (log) log.scrollTop = log.scrollHeight;
    });
  }

  async function clear() {
    if (!await confirmDialog('New conversation', 'The supervisor forgets this conversation and its history is deleted.', 'Clear')) return;
    try { sv.messages = await api.clearSupervisorChat(); } catch (e) { sv.error = errMsg(e); }
    render();
  }

  function openDrawerPanel() {
    sv.drawer = true;
    $('#svc-drawer').classList.add('open');
    $('#svc-drawer').setAttribute('aria-hidden', 'false');
    $('#svc-backdrop').classList.remove('hidden');
    render();
    if (!sv.loaded) load();
    setTimeout(() => $('#svc-q-drawer').focus({ preventScroll: true }), 200);
  }
  function closeDrawerPanel() {
    sv.drawer = false;
    $('#svc-drawer').classList.remove('open');
    $('#svc-drawer').setAttribute('aria-hidden', 'true');
    $('#svc-backdrop').classList.add('hidden');
  }
  window.openSupervisorChat = openDrawerPanel;

  // ---- rendering ---------------------------------------------------------------------------------
  function messageHtml(msg) {
    const time = msg.ts ? new Date(msg.ts).toLocaleString() : '';
    if (msg.role === 'user') {
      return `<div class="sup-wmsg user"><div class="sup-wmsg-meta">You · ${esc(time)}${msg.screen ? ` · <span title="What the supervisor was told about the screen">${esc(msg.screen)}</span>` : ''}</div><div>${esc(msg.text)}</div></div>`;
    }
    if (msg.role === 'system') return `<div class="sup-wmsg system${msg.error ? ' error' : ''}"><div class="sup-wmsg-meta">${esc(time)}</div><div>${esc(msg.text)}</div></div>`;
    const meta = `Supervisor · ${esc(time)}${msg.simulated ? ' · simulated' : msg.model ? ` · ${esc(msg.model)}` : ''} · ${esc(fmtCost(msg.costUsd || 0))}${msg.stopped ? ' · <span class="badge warn" title="You stopped this turn: the answer is what was written until then">Stopped</span>' : ''}`;
    return `<div class="sup-wmsg svc-msg"><div class="sup-wmsg-meta"><span class="sup-mark">◆</span> ${meta}</div><div class="md md-compact">${markdownHtml(msg.text || '')}</div></div>`;
  }

  function logHtml(messages) {
    return (messages.length || sv.pending ? '' : `<div class="svc-empty muted small">Ask about anything in the app: workflows, projects, runs, skills, agents, usage. I know which screen you are on, and I read the app's data (never your repositories' code). I cannot change anything yet: I tell you what to change and where.</div>`)
      + messages.map(messageHtml).join('')
      + (sv.pending ? `<div class="sup-wmsg user"><div class="sup-wmsg-meta">You</div><div>${esc(sv.pending)}</div></div>` : '')
      + (sv.live ? `<div class="svc-live">${window.LiveTurn.html(sv.live)}</div>` : '')
      + (sv.busy && !sv.live ? '<div class="sup-loading"><span class="spinner"></span><span>The supervisor is reading the app\'s data…</span></div>' : '')
      + (sv.error ? `<p class="error small">${esc(sv.error)}</p>` : '');
  }

  function render() {
    const simulated = devMode();
    const cost = sv.messages.reduce((a, x) => a + (x.costUsd || 0), 0);
    const note = `${simulated ? 'Simulated (developer mode): no model is called and nothing is spent.' : 'Each message is one call to the model: it uses your Claude Code subscription.'}${cost ? ` Conversation cost ${fmtCost(cost)}.` : ''}`;
    const chips = SUGGESTIONS.map((q) => `<button class="chip" type="button" data-svc-q="${esc(q)}"${sv.busy ? ' disabled' : ''}>${esc(q)}</button>`).join('');
    if (sv.drawer) {
      $('#svc-screen').textContent = screenContext();
      const log = $('#svc-log-drawer');
      // the drawer shows the latest exchanges; the Supervisor page has them all
      log.innerHTML = logHtml(sv.messages.slice(-20));
      log.scrollTop = log.scrollHeight;
      $('#svc-chips-drawer').innerHTML = chips;
      $('#svc-note-drawer').textContent = note;
    }
    if (state.view === 'supervisor') {
      const log = $('#svc-log-page');
      log.innerHTML = logHtml(sv.messages);
      log.scrollTop = log.scrollHeight;
      $('#svc-chips-page').innerHTML = chips;
      $('#svc-note-page').textContent = note;
      $('#svc-tools').innerHTML = sv.tools.map((t) => `<li><span class="mono">${esc(t.name)}</span> <span class="muted">${esc(t.description)}</span></li>`).join('');
    }
    document.querySelectorAll('.svc-send').forEach((b) => (b.disabled = sv.busy));
    document.querySelectorAll('.svc-clear').forEach((b) => (b.disabled = sv.busy || !sv.messages.length));
  }

  const inputBox = (where) => `
        <div id="svc-chips-${where}" class="svc-chips"></div>
        <form class="svc-form" data-svc-form="${where}">
          <textarea id="svc-q-${where}" class="svc-input" rows="2" placeholder="Ask the supervisor… (Enter to send, Shift+Enter for a new line)"></textarea>
          <button class="btn primary svc-send" type="submit">Send</button>
        </form>
        <p id="svc-note-${where}" class="muted small svc-note"></p>`;

  registerView({
    id: 'supervisor',
    nav: { label: 'Supervisor', order: 110, title: 'Talk to the supervisor: the whole conversation', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 21 12 12 21 3 12Z" /><path d="M8 12h8" /></svg>' },
    markup: `
      <section id="view-supervisor" class="view hidden">
        <div class="page-head">
          <div>
            <h1><span class="sup-mark">◆</span> Supervisor</h1>
            <p class="muted small">Your companion on every screen (the Supervisor button in the top bar opens it anywhere). It reads the app's data and never the repositories' code, never answers a human gate, and routes code problems to the workflow's agents.</p>
          </div>
          <div class="row"><button class="btn ghost svc-clear" type="button">New conversation</button></div>
        </div>
        <div class="svc-page">
          <div class="svc-main">
            <div id="svc-log-page" class="svc-log"></div>
            ${inputBox('page')}
          </div>
          <aside class="svc-side card">
            <div class="sup-h">What it can read</div>
            <ul id="svc-tools" class="svc-tools small"></ul>
          </aside>
        </div>
      </section>`,
    modals: `
  <div id="svc-backdrop" class="drawer-backdrop sup-backdrop hidden"></div>
  <aside id="svc-drawer" class="drawer sup-drawer svc-drawer" aria-hidden="true" aria-label="Supervisor">
    <div class="drawer-head">
      <div class="sup-head">
        <h2 class="drawer-title"><span class="sup-mark">◆</span> Supervisor</h2>
        <div class="muted small">On: <span id="svc-screen"></span></div>
      </div>
      <div class="row">
        <button id="btn-svc-full" class="btn ghost sm" type="button" title="The whole conversation on the Supervisor page">Full page</button>
        <button class="btn ghost sm svc-clear" type="button">New</button>
        <button id="btn-svc-close" class="icon-btn" title="Close (Esc)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </button>
      </div>
    </div>
    <div class="drawer-body sup-body svc-body">
      <div id="svc-log-drawer" class="svc-log"></div>
      ${inputBox('drawer')}
    </div>
  </aside>`,
    mount() {
      // the top bar's button: the drawer on every screen
      const btn = document.createElement('button');
      btn.id = 'btn-svc-open';
      btn.type = 'button';
      btn.className = 'btn ghost svc-open';
      btn.title = 'Ask the supervisor about this screen';
      btn.innerHTML = '<span class="sup-mark">◆</span> Supervisor';
      btn.onclick = () => (sv.drawer ? closeDrawerPanel() : openDrawerPanel());
      document.querySelector('.topbar .actions')?.prepend(btn);
      $('#btn-svc-close').onclick = closeDrawerPanel;
      $('#svc-backdrop').onclick = closeDrawerPanel;
      $('#btn-svc-full').onclick = () => { closeDrawerPanel(); showView('supervisor'); };
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sv.drawer) closeDrawerPanel(); });
      document.querySelectorAll('.svc-clear').forEach((b) => (b.onclick = clear));
      // the screen is read when the message is sent: from the drawer, the screen under it
      const screenFor = (where) => (where === 'drawer' ? screenContext() : 'Supervisor page (no other screen in view)');
      document.querySelectorAll('[data-svc-form]').forEach((form) => {
        const where = form.dataset.svcForm;
        const input = form.querySelector('textarea');
        form.onsubmit = (e) => { e.preventDefault(); ask(input.value, screenFor(where), input); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value, screenFor(where), input); } });
      });
      // #180: the question in flight, as the service reports it
      api.onChatProgress?.((p) => {
        if (p?.chat !== 'supervisor' || !sv.live) return;
        window.LiveTurn.apply(sv.live, p);
        renderLive();
      });
      document.addEventListener('click', (e) => {
        // #180: the live turn's Stop and its steps' toggle
        if (e.target.closest('.svc-live') && window.LiveTurn.onClick(e, sv.live, { onStop: () => api.cancelChatTurn('supervisor', '').catch((err) => { sv.error = errMsg(err); render(); }), render: renderLive })) return;
        const chip = e.target.closest('[data-svc-q]');
        if (!chip) return;
        const where = chip.closest('#svc-drawer') ? 'drawer' : 'page';
        ask(chip.dataset.svcQ, screenFor(where));
      });
    },
    show() {
      render();
      load();
      if (!sv.tools.length) api.supervisorTools().then((t) => { sv.tools = t; render(); }).catch(() => {});
    },
  });
})();
