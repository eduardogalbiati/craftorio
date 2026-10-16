// The agents' chat (#274): one component for every conversation with an agent, so a fix on one side
// fixes all. Used by the Oracle (views/oracle/oracle.js, its drawer and its Home dock), the
// Product Owner (views/backlog/backlog-po.js) and the Supervisor (views/supervisor/supervisor.js); a
// new agent chat (the Agents window, #263) uses it too, never a copy. What it owns:
// - the conversation: the messages in order, the owner's ("You") and the agent's, rendered as Markdown
//   (markdownHtml) with the cost and tokens per message (fmtCost), each marked
//   [data-testid="agent-chat-message"][data-role="user|agent"]; a view may draw its own message markup
//   (renderMessage) inside that marker, and its empty state (emptyHtml);
// - Send: a click on Send or Enter (Shift+Enter is a new line, an IME composition's Enter is not a
//   send) empties the text box at once and shows the message in the conversation before the answer;
//   a failure (the send rejects) or a refusal ({ ok: false, error }: busy, a budget) puts the text and
//   its attachments back in the box and shows the error line ([data-testid="agent-chat-error"]);
// - the busy lock (#234): while a message is in flight (or setBusy), Send and the buttons of the
//   'pills' slot are disabled, the text box stays free and Enter sends nothing;
// - a turn started elsewhere (setTurn: another surface's send, the service's own turn) locks and shows
//   like a send of this chat;
// - the working line ("<agent> is working… 0:12") and the live turn (#180, window.LiveTurn: drawn at
//   the end of the conversation, redrawn each second, its Stop calls onStop);
// - scroll: the owner's position is kept on a redraw unless they were at the end; Send scrolls to the end;
// - attachments and pasted images (#130) for the next send (addAttachment; with pasteImages, a pasted
//   image becomes one), as removable chips;
// - the unread state (#149): an agent message that arrives while the chat is hidden (setVisible(false))
//   marks it unread until it is shown again or markSeen (onUnreadChange);
// - slots for each agent's own parts ([data-agent-chat-slot]): 'head' and 'top' above the conversation
//   (a mode switch, a context chip), 'pills' (suggested questions, starters: locked while busy),
//   'compose' above the text box (never locked), 'actions' in the form before Send, 'foot' under it.
// A view keeps its ids and classes (options ids / classes), so its styles and tests stay.
// Uses app.js's globals at call time (esc, markdownHtml, fmtCost, errMsg) when present.
// Browser: window.AgentChat; Node: module.exports.
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('../shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  const NEAR_END = 40;
  const SLOTS = ['head', 'top', 'pills', 'compose', 'actions', 'foot'];
  /* global esc, markdownHtml, fmtCost, errMsg */
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const e = (s) => (typeof esc === 'function' ? esc(s) : escape(s));
  const md = (s) => (typeof markdownHtml === 'function' ? markdownHtml(String(s ?? '')) : `<p>${e(s)}</p>`);
  const money = (n) => (typeof fmtCost === 'function' ? fmtCost(n) : `$${(Number(n) || 0).toFixed(2)}`);
  const errText = (x) => (typeof errMsg === 'function' ? errMsg(x) : String(x?.message || x));
  const elapsed = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const attr = (name, value) => (value ? ` ${name}="${e(value)}"` : '');

  /** The default markup of a message: the owner's as text, the agent's as Markdown with its cost. */
  function messageHtml(m, agent) {
    // #273: in the owner's zone (time-zone.js; in node, the computer's)
    const time = m.ts ? new Date(m.ts).toLocaleString(undefined, { timeZone: typeof TimeZone !== 'undefined' ? TimeZone.current() : undefined }) : '';
    if (m.role === 'user') return `<div class="sup-wmsg user"><div class="sup-wmsg-meta">${t('agent_chat.you')}${time ? ` · ${e(time)}` : ''}</div><div>${e(m.text)}</div></div>`;
    const meta = [e(agent), time && e(time), m.costUsd != null && e(money(m.costUsd)), m.tokens != null && `${e(Number(m.tokens).toLocaleString('en-US'))} tokens`].filter(Boolean).join(' · ');
    return `<div class="sup-wmsg"><div class="sup-wmsg-meta">${meta}</div><div class="md md-compact">${md(m.text)}</div></div>`;
  }

  // The component's own markup in `container`; its wrappers are display: contents (agent-chat.css)
  function build(container, o, ids, cls) {
    const slotHtml = (name) => `<div class="agent-chat-slot" data-agent-chat-slot="${name}"></div>`;
    container.innerHTML = `<div class="agent-chat agent-chat-flat${cls.root ? ` ${cls.root}` : ''}" data-testid="agent-chat" data-agent="${e(o.agentId || o.agent)}">
      ${slotHtml('head')}${slotHtml('top')}
      <div${attr('id', ids.messages)} class="agent-chat-log ${cls.messages || ''}" data-testid="agent-chat-messages" role="log" aria-label="${e(`Conversation with ${o.agent}`)}"></div>
      <div class="agent-chat-foot ${cls.foot || 'agent-chat-flat'}">
        ${slotHtml('pills')}${slotHtml('compose')}
        <div class="agent-chat-attachments hidden" data-agent-chat-attachments></div>
        <div${attr('id', ids.working)} class="agent-chat-working small hidden ${cls.working || ''}" role="status" aria-live="polite"></div>
        <form${attr('id', ids.form)} class="agent-chat-form ${cls.form || ''}" data-agent-chat-form>
          <textarea${attr('id', ids.input)} class="${cls.input || ''}" rows="2" data-testid="agent-chat-input"${attr('placeholder', o.placeholder)} aria-label="${e(`Message to ${o.agent}`)}"></textarea>
          ${slotHtml('actions')}
          <button${attr('id', ids.send)} class="btn primary agent-chat-send ${cls.send || ''}" type="submit" data-testid="agent-chat-send">${e(o.sendLabel || t('agent_chat.send'))}</button>
        </form>
        ${slotHtml('foot')}
      </div>
    </div>`;
    const root = container.querySelector('[data-testid="agent-chat"]');
    const q = (sel) => root.querySelector(sel);
    return {
      root,
      log: q('[data-testid="agent-chat-messages"]'),
      input: q('[data-testid="agent-chat-input"]'),
      send: q('[data-testid="agent-chat-send"]'),
      form: q('[data-agent-chat-form]'),
      working: q('.agent-chat-working'),
      chips: q('[data-agent-chat-attachments]'),
      slots: Object.fromEntries(SLOTS.map((n) => [n, q(`[data-agent-chat-slot="${n}"]`)])),
    };
  }

  // A view's existing markup (options.parts: { log, input, send, working?, form?, slots? }): the
  // component marks it and drives it the same way (the Product Owner's drawer, whose markup and ids
  // other code and tests share)
  function adopt(container, o) {
    const { log, input, send, working = null, form = null, slots = {} } = o.parts;
    const mark = (el, testid) => el.setAttribute('data-testid', testid);
    container.classList.add('agent-chat');
    mark(container, 'agent-chat');
    mark(log, 'agent-chat-messages');
    log.setAttribute('role', 'log');
    mark(input, 'agent-chat-input');
    mark(send, 'agent-chat-send');
    working?.setAttribute('role', 'status');
    return { root: container, log, input, send, form, working, chips: null, slots: Object.fromEntries(SLOTS.map((n) => [n, slots[n] || null])) };
  }

  /**
   * Mounts a chat in `container`. Options: agent (its name), agentId (its id for data-agent, #263: the
   * Agents window's panes; the name by default), send(text, attachments, { fromBox }) →
   * result (fromBox false: a pill or ask(), not the text box),
   * placeholder, sendLabel, onUnreadChange(unread); and for a view's own parts: renderMessage(m, i, all)
   * (markup, '' to skip one, undefined for the default), roleOf(m), emptyHtml(), pendingHtml(flight),
   * afterHtml() (after the live turn), onRender(log), workingText(), canSend() / inputEnabled() (the
   * controls' state besides busy), beforeSend(text, attachments) (false: not sent, the text stays),
   * hasDraft() (something to send besides the text), onInput(value), onPaste(event), onStop(),
   * onDone() (after a send ends), pasteImages, ids / classes ({ root, messages, foot, form, input,
   * send, working }).
   */
  function create(container, opts = {}) {
    const o = { agent: 'Agent', ...opts };
    const ids = o.ids || {};
    const cls = o.classes || {};
    const s = { messages: [], extBusy: false, flight: null, turn: null, live: null, error: '', attachments: [], visible: true, unread: false, seen: 0, started: false, timer: null };
    const p = o.parts ? adopt(container, o) : build(container, o, ids, cls);
    const { root: rootEl, log, input, send: sendBtn, form, working, chips, slots } = p;

    // a turn of the agent in flight: this chat's send, or one started elsewhere (setTurn)
    const inFlight = () => s.flight || s.turn;
    const isBusy = () => s.extBusy || !!inFlight();
    const roleOf = (m) => (o.roleOf ? o.roleOf(m) : m?.role === 'user' ? 'user' : 'agent');
    const atEnd = () => log.scrollHeight - log.scrollTop - log.clientHeight <= NEAR_END;
    const scrollToEnd = () => { log.scrollTop = log.scrollHeight; };
    const agentCount = () => s.messages.filter((m) => roleOf(m) === 'agent').length;
    function setInput(value) {
      input.value = value;
      o.onInput?.(value);
    }

    // ---- unread (#149) ----------------------------------------------------------------------------
    function setUnread(on) {
      if (s.unread === on) return;
      s.unread = on;
      o.onUnreadChange?.(on);
    }
    function markSeen() {
      s.seen = agentCount();
      setUnread(false);
    }
    // the first conversation shown is the baseline; afterwards a new agent message while hidden is unread
    function noteArrivals() {
      const n = agentCount();
      if (!s.started) { s.started = true; s.seen = n; return; }
      if (s.visible || n < s.seen) s.seen = n;
      else if (n > s.seen) setUnread(true);
    }

    // ---- rendering --------------------------------------------------------------------------------
    // the message in flight, until the conversation shows it (a history reloaded meanwhile)
    function pendingShown() {
      const f = inFlight();
      if (!f || !f.text) return false;
      const last = s.messages[s.messages.length - 1];
      return !(last && roleOf(last) === 'user' && String(last.text || '').trim() === f.text);
    }
    const wrap = (role, html, extra = '') => `<div class="agent-chat-msg${extra}" data-testid="agent-chat-message" data-role="${role}">${html}</div>`;
    const liveHtml = () => (s.live && root.LiveTurn ? root.LiveTurn.html(s.live, { stop: !!o.onStop }) : '');
    function logHtml() {
      const list = s.messages;
      const out = [];
      if (!list.length && !inFlight() && o.emptyHtml) out.push(o.emptyHtml());
      list.forEach((m, i) => {
        const own = o.renderMessage ? o.renderMessage(m, i, list) : undefined;
        const html = own === undefined || own === null ? messageHtml(m, o.agent) : own;
        if (html) out.push(wrap(roleOf(m), html));
      });
      if (pendingShown()) {
        const f = inFlight();
        const own = o.pendingHtml ? o.pendingHtml(f) : undefined;
        if (own !== '') out.push(wrap('user', own || messageHtml({ role: 'user', text: f.text }, o.agent), ' pending'));
      }
      if (s.live) out.push(`<div class="agent-chat-live ${cls.live || ''}" data-agent-chat-live>${liveHtml()}</div>`);
      if (o.afterHtml) out.push(o.afterHtml());
      if (s.error) out.push(`<p class="error small agent-chat-error" data-testid="agent-chat-error" role="alert">${e(s.error)}</p>`);
      return out.join('');
    }
    function renderWorking() {
      if (!working) return;
      const f = inFlight();
      const on = !!f;
      working.innerHTML = on ? `<span class="spinner" aria-hidden="true"></span><span>${e(o.workingText ? o.workingText() : `${o.agent} is working…`)} <span class="mono">${elapsed(Date.now() - (f.since || Date.now()))}</span></span>` : '';
      working.classList.toggle('hidden', !on);
    }
    function renderLive() {
      const el = log.querySelector('[data-agent-chat-live]');
      if (!el || !s.live) return;
      const end = atEnd();
      el.innerHTML = liveHtml();
      if (end) scrollToEnd();
    }
    function renderAttachments() {
      if (!chips) return;
      chips.innerHTML = s.attachments.map((a, i) => `<span class="badge agent-chat-attachment" title="${e(a.name || 'Attachment')}">${a.dataUrl && /^data:image\//.test(a.dataUrl) ? `<img src="${e(a.dataUrl)}" alt="" />` : ''}<span>${e(a.name || 'Attachment')}</span><button type="button" data-agent-chat-unattach="${i}" aria-label="${e(`Remove ${a.name || 'the attachment'}`)}"${s.flight ? ' disabled' : ''}>×</button></span>`).join('');
      chips.classList.toggle('hidden', !s.attachments.length);
    }
    // Send, the pills (#234) and the text box, from the busy state and the view's own conditions
    function syncControls() {
      const busy = isBusy();
      sendBtn.disabled = busy || (o.canSend ? !o.canSend() : false);
      if (o.inputEnabled) input.disabled = !o.inputEnabled();
      slots.pills?.querySelectorAll('button, select').forEach((b) => {
        if (busy && !b.disabled) { b.disabled = true; b.setAttribute('data-agent-chat-locked', ''); } else if (!busy && b.hasAttribute('data-agent-chat-locked')) { b.disabled = false; b.removeAttribute('data-agent-chat-locked'); }
      });
      renderWorking();
    }
    function render({ end = false } = {}) {
      const top = log.scrollTop;
      const toEnd = end || atEnd();
      log.innerHTML = logHtml();
      o.onRender?.(log);
      renderAttachments();
      syncControls();
      if (toEnd) scrollToEnd(); else log.scrollTop = top;
    }

    // ---- sending ----------------------------------------------------------------------------------
    // the timer of the working line and the live turn move even when no progress arrives (#180)
    // (only while a turn is in flight)
    function syncTick() {
      if (!inFlight()) { clearInterval(s.timer); s.timer = null; } else if (!s.timer) s.timer = setInterval(() => { renderWorking(); renderLive(); }, 1000);
    }
    function fail(message) {
      const f = s.flight;
      if (f?.fromBox) {
        const typed = input.value.trim();
        setInput(typed ? `${f.text}\n${input.value}` : f.text);
        s.attachments = [...f.attachments, ...s.attachments];
      }
      s.error = message || '';
    }
    function submit(raw, { fromBox = false } = {}) {
      const text = String(raw ?? '').trim();
      const attachments = fromBox ? s.attachments.slice() : [];
      if (isBusy() || (!text && !attachments.length && !(fromBox && o.hasDraft?.()))) return false;
      if (o.beforeSend && o.beforeSend(text, attachments) === false) return false;
      if (fromBox) { setInput(''); s.attachments = []; }
      s.flight = { text, attachments, fromBox, since: Date.now() };
      s.error = '';
      s.started = true;
      syncTick();
      render({ end: true });
      let out;
      try { out = Promise.resolve(o.send(text, attachments, { fromBox })); } catch (x) { out = Promise.reject(x); }
      out.then((res) => {
        if (res && Array.isArray(res.messages)) { s.messages = res.messages; noteArrivals(); }
        if (res && res.ok === false) fail(res.error);
      }, (x) => fail(errText(x))).finally(() => {
        s.flight = null;
        s.live = null;
        syncTick();
        render();
        // a view's redraw that throws must not leave the send's promise rejected with no handler
        try { o.onDone?.(); } catch (x) { console.error(x); }
      });
      return true;
    }
    const submitBox = () => submit(input.value, { fromBox: true });

    // ---- events -----------------------------------------------------------------------------------
    // a click on Send submits the form; an adopted Send outside a form is its own click
    if (form) form.addEventListener('submit', (ev) => { ev.preventDefault(); submitBox(); });
    else sendBtn.onclick = (ev) => { ev?.preventDefault?.(); submitBox(); };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); submitBox(); }
    });
    input.addEventListener('input', () => { o.onInput?.(input.value); syncControls(); });
    input.addEventListener('paste', (ev) => {
      if (o.onPaste) { o.onPaste(ev); return; }
      if (!o.pasteImages) return;
      const files = [...(ev.clipboardData?.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
      if (!files.length) return; // text: the text box's own paste
      ev.preventDefault();
      files.forEach((file) => {
        const r = new FileReader();
        r.onload = () => chat.addAttachment({ name: file.name || 'Pasted image', type: file.type, size: file.size, dataUrl: r.result });
        r.readAsDataURL(file);
      });
    });
    chips?.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-agent-chat-unattach]');
      if (b && !s.flight) { s.attachments.splice(Number(b.getAttribute('data-agent-chat-unattach')), 1); renderAttachments(); }
    });
    // the live turn's Stop and its steps' toggle (#180)
    log.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-agent-chat-live]') && root.LiveTurn) root.LiveTurn.onClick(ev, s.live, { onStop: o.onStop, render: renderLive });
    });

    const chat = {
      /** The conversation: [{ role, text, ts?, costUsd?, tokens? }] (role 'user' is the owner). */
      setMessages(list) {
        s.messages = Array.isArray(list) ? list : [];
        noteArrivals();
        render();
      },
      /** The busy lock set by the view (a filing, a turn the service runs); a send in flight is busy too. */
      setBusy(on) {
        s.extBusy = !!on;
        syncControls();
      },
      isBusy,
      /**
       * A turn of the agent started elsewhere (another surface, the service on its own): { text?, since? },
       * null when over. Like a send: busy, the working line, its question (text) in the conversation.
       */
      setTurn(turn) {
        s.turn = turn || null;
        syncTick();
        render();
      },
      /** A LiveTurn state drawn at the end of the conversation; null removes it. */
      setLiveTurn(turn) {
        const had = !!log.querySelector('[data-agent-chat-live]');
        s.live = turn || null;
        if (had && s.live) renderLive(); else render();
      },
      /** A message sent without the text box (a pill, a starter): what is typed stays. */
      ask: (text) => submit(text),
      /** Several of the view's states in one redraw: { messages, busy, turn, live, error } (each optional). */
      update(patch = {}) {
        if ('busy' in patch) s.extBusy = !!patch.busy;
        if ('turn' in patch) { s.turn = patch.turn || null; syncTick(); }
        if ('live' in patch) s.live = patch.live || null;
        if ('error' in patch) s.error = patch.error || '';
        if ('messages' in patch) { s.messages = Array.isArray(patch.messages) ? patch.messages : []; noteArrivals(); }
        render();
      },
      setError(text) {
        s.error = text || '';
        render();
      },
      addAttachment(att) {
        s.attachments.push(att);
        renderAttachments();
      },
      removeAttachment(i) {
        s.attachments.splice(i, 1);
        renderAttachments();
      },
      attachments: () => s.attachments.slice(),
      setVisible(on) {
        s.visible = !!on;
        if (s.visible) markSeen();
      },
      isUnread: () => s.unread,
      markSeen,
      slot: (name) => slots[name] || null,
      /** Redraws the conversation (the view's own markup changed) and the controls. */
      render,
      /** Only the controls (Send, the pills, the text box) after a change of the view's conditions. */
      refresh: syncControls,
      sending: () => (s.flight ? { text: s.flight.text } : null),
      input,
      form,
      sendButton: sendBtn,
      log,
      root: rootEl,
    };
    render();
    return chat;
  }

  const AgentChat = { create, messageHtml };
  if (typeof module === 'object' && module.exports) module.exports = AgentChat;
  if (typeof window !== 'undefined') root.AgentChat = AgentChat;
}(typeof window !== 'undefined' ? window : globalThis));
