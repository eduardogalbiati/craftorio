// Supervisor chat (#28): the app-wide conversation with the Supervisor, in a right-side drawer
// (#svc-drawer) opened from the Workflows screen's round button (#409, data-testid=supervisor-fab:
// its robot and the yellow dot of an unseen answer drawn here; #254, #264: no screen of its own and
// no top bar button; window.openSupervisorChat, also used by the Oracle's request links) and from a
// run card's Send to supervisor, which attaches the run to the next question (openSupervisorChat({ run }),
// a removable chip in the chat's top slot; the cards' buttons are disabled while it answers).
// The drawer shows the latest exchanges; Expand widens it to the whole conversation and what the
// supervisor can read. Each message carries what the person is looking at (screenContext(): "Builder, editing workflow X",
// "Analytics, range 2026-09-01 to 2026-09-30"), so requests need not repeat it. The supervisor reads the
// app's data with its read-only MCP tools (packages/engine/domains/supervisor/supervisor-tools.js); it cannot change anything yet.
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
  // attached (#409): the run a run card sent ({ runId, workflow, status, error, mock, issues }), until
  // the next question
  const sv = { messages: [], busy: false, loaded: false, drawer: false, full: false, tools: [], live: null, window: false, liveIn: null, pending: null, since: 0, unread: 0, elsewhere: false, attached: null };
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
    // the Agents window's page has no screen of its own (#263)
    if (window.AgentsWindow?.isWindowPage?.()) return 'Agents window';
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
      for (const c of [chat, winChat]) c?.setError('');
    } catch (e) { for (const c of [chat, winChat]) c?.setError(errMsg(e)); }
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
    Object.assign(sv, { busy: true, pending: q, since: Date.now(), liveIn: c, live: window.LiveTurn.create({ agent: t('supervisor.supervisor') }) });
    c.setLiveTurn(sv.live);
    render();
    try {
      const attachments = fromBox ? await PasteImage.collect(c.input) : [];
      if (fromBox) PasteImage.clear(c.input);
      // #409: the run attached by a run card's Send to supervisor goes with this question only
      const run = sv.attached;
      const out = await api.askSupervisorChat({ question: q, screen, mock: devMode(), ...(attachments.length ? { attachments } : {}), ...(run ? { run } : {}) });
      sv.messages = out.messages;
      if (sv.attached === run) sv.attached = null;
      if (!sv.drawer && !sv.window) sv.unread += 1;
      return { messages: shown() };
    } finally {
      Object.assign(sv, { busy: false, live: null, liveIn: null, pending: null });
    }
  };

  // #263: a question sent from the other window: the service's progress is the only sign of it here;
  // the question comes with the history, the answer at the end
  async function turnElsewhere(p) {
    if (p.phase === 'end') {
      if (!sv.elsewhere) return;
      Object.assign(sv, { busy: false, live: null, liveIn: null, pending: null, elsewhere: false });
      await load();
      if (!sv.drawer && !sv.window) sv.unread += 1;
      render();
      return;
    }
    if (sv.busy) return;
    Object.assign(sv, { busy: true, elsewhere: true, pending: '…', since: Date.now(), liveIn: null, live: window.LiveTurn.create({ agent: t('supervisor.supervisor') }) });
    window.LiveTurn.apply(sv.live, p);
    for (const c of [chat, winChat]) c?.setLiveTurn(sv.live);
    await load();
    if (!sv.elsewhere) return;
    const last = sv.messages.at(-1);
    if (last?.role === 'user') sv.pending = last.text;
    render();
  }

  async function clear() {
    if (!await confirmDialog(t('supervisor.new_conversation'), t('supervisor.the_supervisor_forgets_this_conversation_and'), t('supervisor.clear'))) return;
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
  // #409: `run` (a run card's Send to supervisor) is attached to the next question; nothing is asked
  window.openSupervisorChat = (opts) => {
    if (opts?.run) sv.attached = opts.run;
    openDrawerPanel();
  };
  window.supervisorChatBusy = () => sv.busy;

  // Expand (#264, where the Supervisor page was): the drawer over the whole screen, with every
  // message and the list of what the supervisor can read
  function setFull(on) {
    sv.full = on;
    $('#svc-drawer').classList.toggle('full', on);
    $('#svc-side').classList.toggle('hidden', !on);
    const btn = $('#btn-svc-full');
    btn.textContent = on ? t('supervisor.collapse') : t('supervisor.expand');
    btn.setAttribute('aria-pressed', String(on));
    render();
    if (on && !sv.tools.length) api.supervisorTools().then((t) => { sv.tools = t; render(); }).catch(() => {});
  }

  // ---- rendering ---------------------------------------------------------------------------------
  function messageHtml(msg, i, all) {
    const time = msg.ts ? new Date(msg.ts).toLocaleString(undefined, { timeZone: TimeZone.current() }) : '';
    // #240: another agent's request and its result, one card (agent-request.js)
    if (msg.role === 'request') return window.AgentRequest.cardHtml(msg, all, { testid: 'svc-request', owner: 'supervisor' });
    if (window.AgentRequest.inCard(msg)) return '';
    if (msg.role === 'user') {
      return `<div class="sup-wmsg user"><div class="sup-wmsg-meta">${t('supervisor.you')} ${esc(time)}${msg.screen ? ` · <span title="${t('supervisor.what_the_supervisor_was_told_about')}">${esc(msg.screen)}</span>` : ''}${msg.run?.runId ? ` · <span class="badge" title="${esc(`The run sent with this question${msg.run.workflow ? `: ${msg.run.workflow}` : ''}${msg.run.status ? `, ${msg.run.status}` : ''}`)}">${t('supervisor.run')} <span class="mono">${esc(msg.run.runId)}</span></span>` : ''}</div><div>${esc(msg.text)}</div></div>`;
    }
    if (msg.role === 'system') return `<div class="sup-wmsg system${msg.error ? ' error' : ''}"><div class="sup-wmsg-meta">${esc(time)}</div><div>${esc(msg.text)}</div></div>`;
    const meta = `Supervisor · ${esc(time)}${msg.simulated ? ' · simulated' : msg.model ? ` · ${esc(msg.model)}` : ''} · ${esc(fmtCost(msg.costUsd || 0))}${msg.stopped ? ` · <span class="badge warn" title="${t('supervisor.you_stopped_this_turn_the_answer')}">${t('supervisor.stopped')}</span>` : ''}`;
    return `<div class="sup-wmsg svc-msg"><div class="sup-wmsg-meta"><span class="sup-mark">◆</span> ${meta}</div><div class="md md-compact">${markdownHtml(msg.text || '')}</div></div>`;
  }

  const emptyHtml = () => `<div class="svc-empty muted small">${t('supervisor.ask_about_anything_in_the_app')}</div>`;

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
      renderAttached();
    }
    document.querySelectorAll('.svc-clear').forEach((b) => (b.disabled = sv.busy || !sv.messages.length));
    renderFab();
    syncSendButtons();
    window.AgentsWindow?.changed?.();
  }

  // #409: the run a run card attached, a chip above the drawer's chat (removable until it is sent)
  function renderAttached() {
    const box = $('#svc-attached-drawer');
    if (!box) return;
    const r = sv.attached;
    box.classList.toggle('hidden', !r);
    box.innerHTML = r ? `<span class="muted small">${t('supervisor.attached')}</span><span class="badge po-file" data-testid="supervisor-attachment" title="${esc(`Run ${r.runId}${r.workflow ? ` (${r.workflow})` : ''}, ${r.status || 'unknown status'}${r.error ? `: ${r.error}` : ''}`)}"><span class="mono">${esc(r.runId)}</span> <span class="muted">${esc([r.workflow, r.status].filter(Boolean).join(' · '))}</span><button type="button" data-svc-unattach aria-label="${t('supervisor.remove_the_run')}"${sv.busy ? ' disabled' : ''}>×</button></span>` : '';
  }

  // #409: the Workflows screen's round button: the Supervisor's robot, and the yellow dot of an
  // answer not seen yet (#149, like the Product Owner's)
  function renderFab() {
    const unread = !!sv.unread && !sv.busy;
    const robot = window.Robots ? Robots.svg('supervisor', sv.busy ? 'thinking' : 'idle', { bubble: false, plaque: '' }) : '';
    document.querySelectorAll('[data-testid="supervisor-fab"]').forEach((b) => {
      b.innerHTML = robot + (unread ? '<span class="status-dot" aria-hidden="true"></span>' : '');
      b.classList.toggle('st-waiting', unread);
      b.setAttribute('aria-label', unread ? t('supervisor.supervisor_a_new_answer') : t('supervisor.supervisor'));
    });
  }
  window.renderSupervisorFab = renderFab;

  // #409: the run cards' Send to supervisor (run-list.js): disabled while a question is in flight
  function syncSendButtons() {
    document.querySelectorAll('[data-run-act="send-sup"]').forEach((b) => {
      if (b.disabled === sv.busy) return;
      b.disabled = sv.busy;
      b.innerHTML = sendToSupervisorHtml(sv.busy);
      b.title = sendToSupervisorTitle(sv.busy);
    });
  }

  // the shared chat's options (#274), for the drawer and the window's pane: `from` is the chat itself,
  // read when a message is sent (the live turn's Stop included)
  const chatOptions = (from) => ({
    agent: 'Supervisor',
    classes: { messages: 'svc-log', form: 'svc-form', input: 'svc-input', send: 'svc-send' },
    placeholder: t('supervisor.ask_the_supervisor_enter_to_send'),
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
    modals: () => `
  <div id="svc-backdrop" class="drawer-backdrop sup-backdrop hidden"></div>
  <aside id="svc-drawer" class="drawer sup-drawer svc-drawer" data-testid="svc-drawer" aria-hidden="true" aria-label="${t('supervisor.supervisor')}">
    <div class="drawer-head">
      <div class="sup-head">
        <h2 class="drawer-title"><span class="sup-mark">◆</span> ${t('supervisor.supervisor')}</h2>
        <div class="muted small">${t('supervisor.on')} <span id="svc-screen"></span></div>
      </div>
      <div class="row">
        <button id="btn-svc-full" class="btn ghost sm" type="button" aria-pressed="false" title="${t('supervisor.the_whole_conversation_and_what_the')}">${t('supervisor.expand')}</button>
        <button class="btn ghost sm svc-clear" type="button" title="${t('supervisor.new_conversation_the_supervisor_forgets_this')}">${t('supervisor.new')}</button>
        <button class="icon-btn" type="button" data-agents-window="supervisor" data-testid="agent-chat-open-window" title="${t('supervisor.open_in_a_window_ctrl_shift')}" aria-label="${t('supervisor.open_the_supervisor_in_a_window')}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="14" height="14" rx="2" /><path d="M9 3h12v12M21 3l-9 9" /></svg></button>
        <button id="btn-svc-close" class="icon-btn" title="${t('supervisor.close_esc')}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </button>
      </div>
    </div>
    <div class="drawer-body sup-body svc-body">
      <div id="svc-chat" class="svc-main"></div>
      <aside id="svc-side" class="svc-side card hidden">
        <div class="sup-h">${t('supervisor.what_it_can_read')}</div>
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
      // #409: the run attached by a run card's Send to supervisor
      chat.slot('top').innerHTML = '<div id="svc-attached-drawer" class="svc-attached hidden"></div>';
      // #180: the question in flight, as the service reports it
      api.onChatProgress?.((p) => {
        if (p?.chat !== 'supervisor') return;
        if (!sv.live) { turnElsewhere(p); return; }
        window.LiveTurn.apply(sv.live, p);
        // a turn started elsewhere has no chat of its own (#263): both show its steps
        for (const c of sv.liveIn ? [sv.liveIn] : [chat, winChat]) c?.setLiveTurn(sv.live);
        if (p.phase === 'end' && sv.elsewhere) turnElsewhere(p);
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
        // a chip of the Agents window's pane asks from that chat (#263)
        if (chip) (chip.closest('[data-svc-window]') ? winChat : chat)?.ask(chip.dataset.svcQ);
        if (e.target.closest('[data-svc-unattach]') && !sv.busy) { sv.attached = null; render(); }
      });
      // the round button gets its robot before the drawer is first opened
      renderFab();
    },
  });
})();
