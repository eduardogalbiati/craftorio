// The Agents window (#263): the conversational agents in their own window, laid out like a desktop
// chat app: a vertical rail on the left with one entry per agent (its robot in its role colour, its
// name on hover and beside it when wide, an unread count, a "busy" ring while it answers) and the
// selected agent's conversation on the right, full height, through the shared chat (agent-chat.js).
// The agents declare themselves: each conversational view calls AgentsWindow.register({ id, name,
// order?, color?, avatar?(), mount(el), unmount?(el), unread?(), busy?(), header?() }) as it loads
// (the Oracle, the Product Owner and the Supervisor: order 1, 2, 3; others after), and calls
// AgentsWindow.changed() when its state changes (busy, unread, model, cost): the rail and the header
// are redrawn once per tick. A pane shows the same conversation as the agent's drawer (one
// conversation, two places): the agent mounts a second surface of its own state there.
// - The page: the app's page opened with `?window=agents&agent=<id>` (src/agents-window.js in the
//   main process) hides its shell and mounts the window into the body; agents-window:show (a second
//   "Open in a window") switches the agent; the agent shown is reported (agents-window:agent).
// - From the main window: every drawer's [data-agents-window="<id>"] button and Ctrl+Shift+A call
//   agents-window:open (api.openAgentsWindow({ agent })); the browser UI has no second window.
// - Links to a screen (a run, an issue, a file, a request, the settings): the window's page has no
//   shell, so a view asks AgentsWindow.toMainWindow(name, target) first: on the window's page it sends
//   the target to the main window (agents-window:navigate, relayed by main.js as main-window:navigate)
//   and answers true; in the main window it answers false and the view opens the screen itself. The
//   main window runs the handler the view registered with AgentsWindow.onNavigate(name, fn).
// Test ids: agents-rail (a nav named "Agents"), agents-rail-item (data-agent, data-busy),
// agents-rail-unread, agents-window-pane, agents-window-header, agent-chat-open-window.
// Uses app.js globals at call time (esc, api, state); Robots and AgentColors when present.
(function (root) {
  const DEFAULT_ORDER = 100;
  const defs = []; // the registered agents, in order
  const aw = { root: null, selected: null, scheduled: false };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const query = () => { try { return new URLSearchParams(root.location?.search || ''); } catch { return new URLSearchParams(); } };
  const isWindowPage = () => query().get('window') === 'agents';
  const byId = (id) => defs.find((d) => d.id === id) || null;
  const sorted = () => [...defs].sort((a, b) => (a.order - b.order) || (a.seq - b.seq));

  function register(def) {
    if (!def?.id || typeof def.mount !== 'function') throw new Error('AgentsWindow.register needs { id, name, mount }');
    const i = defs.findIndex((d) => d.id === def.id);
    const entry = { order: DEFAULT_ORDER, name: def.id, ...def, seq: i >= 0 ? defs[i].seq : defs.length };
    if (i >= 0) defs[i] = entry; else defs.push(entry);
    if (aw.root) changed();
    return entry;
  }

  // ---- rendering ----------------------------------------------------------------------------------
  const colorOf = (d) => d.color || (root.AgentColors?.ROLES?.[d.id]) || '';
  function avatarHtml(d) {
    if (typeof d.avatar === 'function') return d.avatar();
    if (root.Robots?.svg) return root.Robots.svg(d.id, 'idle', { bubble: false, plaque: '' });
    return `<span class="aw-initial">${esc(String(d.name || d.id).slice(0, 1))}</span>`;
  }
  function railHtml() {
    return sorted().map((d) => {
      const on = d.id === aw.selected;
      const unread = Math.max(0, Number(typeof d.unread === 'function' ? d.unread() : 0) || 0);
      const busy = typeof d.busy === 'function' ? !!d.busy() : false;
      const color = colorOf(d);
      return `<button type="button" class="aw-item${on ? ' active' : ''}" data-testid="agents-rail-item" data-agent="${esc(d.id)}" aria-label="${esc(d.name)}" title="${esc(d.name)}${busy ? ' (answering…)' : unread ? ` (${unread} unread)` : ''}" aria-pressed="${on}" data-busy="${busy}"${color ? ` style="--aw-color:${esc(color)}"` : ''}>
        <span class="aw-avatar" aria-hidden="true">${avatarHtml(d)}</span>
        <span class="aw-name" aria-hidden="true">${esc(d.name)}</span>
        ${unread ? `<span class="aw-unread" data-testid="agents-rail-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
      </button>`;
    }).join('');
  }
  const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  function headerHtml(d) {
    if (!d) return '<span class="muted">No agent</span>';
    const h = (typeof d.header === 'function' ? d.header() : null) || {};
    const parts = [h.model && `<span class="mono aw-model" title="Model">${esc(h.model)}</span>`,
      h.cost != null && `<span title="What this conversation cost">${esc(money(h.cost))}</span>`,
      h.tokens != null && `<span title="Tokens of this conversation">${esc(Number(h.tokens).toLocaleString('en-US'))} tokens</span>`,
      h.note && `<span class="aw-note" title="${esc(h.note)}">${esc(h.note)}</span>`].filter(Boolean);
    return `<span class="aw-head-avatar" aria-hidden="true">${avatarHtml(d)}</span><h1 class="aw-title">${esc(d.name)}</h1>${parts.length ? `<span class="muted small aw-facts">${parts.join(' · ')}</span>` : ''}`;
  }
  function paint() {
    aw.scheduled = false;
    if (!aw.root) return;
    const rail = aw.root.querySelector('[data-testid="agents-rail"]');
    const head = aw.root.querySelector('[data-testid="agents-window-header"]');
    if (rail) rail.innerHTML = railHtml();
    if (head) head.innerHTML = headerHtml(byId(aw.selected));
    if (isWindowPage() && root.document) root.document.title = `${byId(aw.selected)?.name || 'Agents'} · Agents`;
  }
  // the rail and the header once per tick, however many agents changed
  function changed() {
    if (!aw.root || aw.scheduled) return;
    aw.scheduled = true;
    Promise.resolve().then(paint);
  }

  function select(id) {
    const d = byId(id) || sorted()[0];
    if (!d || !aw.root) return;
    const pane = aw.root.querySelector('[data-testid="agents-window-pane"] .aw-chat');
    const prev = byId(aw.selected);
    if (prev && prev !== d) { try { prev.unmount?.(pane); } catch (e) { console.error('[agents-window] unmount:', e); } }
    if (prev !== d || !pane.childNodes.length) {
      pane.innerHTML = '';
      aw.selected = d.id;
      try { d.mount(pane); } catch (e) { console.error('[agents-window] mount:', e); pane.innerHTML = `<p class="error small">Could not open ${esc(d.name)}: ${esc(e.message || e)}</p>`; }
    }
    aw.selected = d.id;
    paint();
    if (isWindowPage()) { try { root.api?.setAgentsWindowAgent?.({ agent: d.id }); } catch { /* the browser UI */ } }
  }

  /** Mounts the window into `el` (the rail and the pane), on `agent` or the first registered one. */
  function mount(el, { agent = null } = {}) {
    // a window mounted before (another root): its agent's surface is released first
    if (aw.root && aw.selected) { try { byId(aw.selected)?.unmount?.(aw.root.querySelector('.aw-chat')); } catch { /* already gone */ } }
    aw.root = el;
    aw.selected = null;
    el.classList.add('aw');
    el.innerHTML = `<nav class="aw-rail" data-testid="agents-rail" aria-label="Agents"></nav>
      <section class="aw-pane" data-testid="agents-window-pane">
        <header class="aw-header" data-testid="agents-window-header"></header>
        <div class="aw-chat"></div>
      </section>`;
    el.querySelector('[data-testid="agents-rail"]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-agent]');
      if (b) select(b.dataset.agent);
    });
    select(agent);
    return { select, refresh: paint };
  }

  // ---- links to a screen: from the window's page to the main window ---------------------------------
  const navigators = new Map(); // name -> the view's handler, run in the main window
  function onNavigate(name, fn) {
    if (typeof fn === 'function') navigators.set(String(name), fn);
  }
  /** True when the link was forwarded to the main window (the window's page); false in the main window. */
  function toMainWindow(name, target = null) {
    if (!isWindowPage()) return false;
    const send = root.api?.navigateMainWindow;
    if (typeof send !== 'function') return false;
    try { send({ name: String(name), target }); } catch (e) { console.error('[agents-window] navigate:', e?.message || e); }
    return true;
  }
  function navigated(m) {
    const fn = navigators.get(String(m?.name || ''));
    if (!fn) return;
    try { fn(m.target); } catch (e) { console.error('[agents-window] navigate:', e?.message || e); }
  }

  // ---- from the main window: the buttons and the shortcut ------------------------------------------
  function openWindow({ agent } = {}) {
    const call = root.api?.openAgentsWindow;
    if (typeof call !== 'function') return;
    Promise.resolve().then(() => call({ agent: agent || aw.selected || null })).catch((e) => console.error('[agents-window] open:', e?.message || e));
  }
  if (root.document?.addEventListener) {
    root.document.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-agents-window]');
      if (!b) return;
      e.preventDefault();
      openWindow({ agent: b.dataset.agentsWindow });
    });
    root.document.addEventListener('keydown', (e) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey || String(e.key).toUpperCase() !== 'A') return;
      e.preventDefault();
      openWindow({});
    });
    // the window's own page: the shell gives way to the rail and the pane
    root.document.addEventListener('DOMContentLoaded', () => {
      // the browser UI (npm run serve) has no second window: its buttons go
      if (root.api?.platform === 'browser') root.document.querySelectorAll('[data-agents-window]').forEach((b) => b.remove());
      // the main window: the links the Agents window forwards open their screen here
      if (!isWindowPage()) { root.api?.onMainWindowNavigate?.(navigated); return; }
      root.document.body.classList.add('agents-window-page');
      const el = root.document.createElement('div');
      el.id = 'agents-window-root';
      root.document.body.appendChild(el);
      mount(el, { agent: query().get('agent') });
      root.api?.onAgentsWindowShow?.((m) => { if (m?.agent) select(m.agent); });
    });
  }

  root.AgentsWindow = { changed, isWindowPage, mount, onNavigate, open: openWindow, register, select, selected: () => aw.selected, toMainWindow };
})(typeof window !== 'undefined' ? window : globalThis);
