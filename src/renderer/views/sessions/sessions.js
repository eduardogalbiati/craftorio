// Sessions: every Claude Code, Codex and Grok conversation recorded on this machine, and the CLIs
// themselves in embedded terminals (like a terminal multiplexer for AI sessions). Clicking a
// session reopens it in its CLI (claude --resume / codex resume / grok --resume) in its folder;
// "New session" starts a CLI with a provider, model, effort and project. The processes live in
// the engine (node-pty); terminals keep running while you switch screens.
// Registers itself with registerView (view-registry.js), with the New session dialog; window.SessionsView
// serves app.js (notifications, terminal events).
// Uses app.js globals: api, createXterm, wireTerminal, replayPending, markExited, errMsg, state, showView.
(() => {
  const $s = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = 'multiagent.sessions';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } })();
  const persist = () => { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch { /* ignore */ } };
  const PROVIDER_STYLE = {
    claude: { short: 'C', label: 'Claude' },
    codex: { short: 'X', label: 'Codex' },
    grok: { short: 'G', label: 'Grok' },
  };
  const REFRESH_MS = 20000;

  const prefs = { filter: 'all', showAgents: false, last: null, ...saved };
  const sx = {
    sessions: null,     // listCliSessions().sessions
    providers: [],      // [{ id, name, installed, models, efforts }]
    error: null,
    loading: null,
    q: '',
    tabs: [],           // open terminals: { key, id, kind, provider, sessionId, title, meta, opts, term, fit, pane, exited, pendingTitle }
    active: null,
    seq: 0,
    timer: null,
    form: null,         // new-session form state
    editing: false,     // a title is being edited (the list is not redrawn meanwhile)
  };

  // ---- list -----------------------------------------------------------------------------
  async function load() {
    if (sx.loading) return sx.loading;
    sx.loading = api.listCliSessions()
      .then((r) => { sx.sessions = r.sessions; sx.providers = r.providers; sx.error = null; linkTabs(); })
      .catch((e) => { sx.error = errMsg(e); })
      .finally(() => { sx.loading = null; renderList(); });
    return sx.loading;
  }

  // A new session's terminal becomes the session its CLI recorded (same provider and folder,
  // created after the terminal started): the list shows it once, and Restart resumes it.
  // Linked terminals follow the session's title (CLIs name conversations after a while).
  const sameFolder = (a, b) => !!a && !!b && String(a).replace(/[\\/]+$/, '').toLowerCase() === String(b).replace(/[\\/]+$/, '').toLowerCase();
  function linkTabs() {
    for (const tab of sx.tabs) {
      if (tab.kind === 'cli-new' && tab.cwd) {
        const taken = new Set(sx.tabs.map((t) => t.key));
        const s = sx.sessions.filter((x) => x.provider === tab.provider && sameFolder(x.cwd, tab.cwd)
          && new Date(x.createdAt).getTime() >= tab.startedAt - 5000 && !taken.has(resumeKey(x.provider, x.id))).pop();
        if (!s) continue;
        Object.assign(tab, { key: resumeKey(s.provider, s.id), kind: 'cli-resume', opts: { provider: s.provider, sessionId: s.id } });
        if (tab.pendingTitle) applyPendingTitle(tab, s);
      }
      const s = tab.kind === 'cli-resume' && sx.sessions.find((x) => x.provider === tab.opts.provider && x.id === tab.opts.sessionId);
      if (s && s.title !== '(no prompt)') tab.title = s.title;
    }
    if (sx.active) renderHead();
  }

  const visible = () => state.view === 'sessions';
  function show() {
    renderList();
    load();
    clearInterval(sx.timer);
    sx.timer = setInterval(() => (visible() ? load() : clearInterval(sx.timer)), REFRESH_MS);
    requestAnimationFrame(() => { fitActive(); sx.active?.term.focus(); });
  }

  function ago(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '';
    const m = Math.round(ms / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.round(h / 24);
    return d < 7 ? `${d}d` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function dayGroup(iso) {
    const d = new Date(iso);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const diff = Math.floor((start - d) / 86400000) + 1;
    if (d >= start) return 'Today';
    if (diff <= 1) return 'Yesterday';
    if (diff < 7) return 'This week';
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  const folderName = (p) => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() || p : '');
  const badge = (provider) => `<span class="sx-badge p-${esc(provider)}" title="${esc(PROVIDER_STYLE[provider]?.label || provider)}">${esc(PROVIDER_STYLE[provider]?.short || '?')}</span>`;
  const resumeKey = (provider, id) => `resume:${provider}:${id}`;

  function filtered() {
    const q = sx.q.trim().toLowerCase();
    return (sx.sessions || []).filter((s) =>
      (prefs.filter === 'all' || s.provider === prefs.filter)
      && (prefs.showAgents || !s.workflowAgent)
      && (!q || [s.title, s.cwd, s.model, s.project?.name, s.id].some((v) => String(v || '').toLowerCase().includes(q))));
  }

  function renderFilters() {
    const counts = {};
    for (const s of sx.sessions || []) if (prefs.showAgents || !s.workflowAgent) counts[s.provider] = (counts[s.provider] || 0) + 1;
    const all = Object.values(counts).reduce((a, b) => a + b, 0);
    const chips = [['all', 'All', all], ...Object.entries(PROVIDER_STYLE).map(([id, p]) => [id, p.label, counts[id] || 0])];
    $s('#sx-filters').innerHTML = chips.map(([id, label, n]) =>
      `<button type="button" class="chip ${prefs.filter === id ? 'active' : ''}" data-filter="${id}">${esc(label)} <span class="muted">${n}</span></button>`).join('');
    $s('#sx-filters').querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { prefs.filter = b.dataset.filter; persist(); renderList(); }));
  }

  // rename: the pencil's data attributes (a recorded session's provider and id, or an open
  // terminal's key); close: the key of an open terminal, for the trash can. Both show on hover/focus.
  function itemHtml({ provider, title, sub, time, open, exited, active, sessionAttr, rename, close }) {
    const pencil = rename ? `<button type="button" class="icon-btn sx-item-rename" ${rename} title="Rename" aria-label="Rename">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></button>` : '';
    const trash = close ? `<button type="button" class="icon-btn sx-item-close" data-close-tab="${esc(close)}" title="${exited ? 'Close' : 'End session'}" aria-label="${exited ? 'Close' : 'End session'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg></button>` : '';
    return `<div class="sx-item ${active ? 'active' : ''}" role="listitem" tabindex="0" ${sessionAttr}>
      ${badge(provider)}
      <span class="sx-item-body">
        <span class="sx-item-title">${open ? `<span class="term-dot ${exited ? 'exited' : 'running'}"></span>` : ''}<span class="sx-item-text">${esc(title)}</span></span>
        <span class="sx-item-sub muted">${sub}</span>
      </span>
      <span class="sx-item-time muted small">${esc(time || '')}</span>
      ${pencil || trash ? `<span class="sx-item-actions">${pencil}${trash}</span>` : ''}
    </div>`;
  }

  function renderList() {
    if (sx.editing) return; // redrawn when the title editor closes
    renderFilters();
    $s('#sx-show-agents').checked = prefs.showAgents;
    const box = $s('#sx-list');
    const parts = [];
    if (sx.tabs.length) {
      parts.push('<div class="sx-group">Open terminals</div>');
      for (const t of sx.tabs) {
        parts.push(itemHtml({
          provider: t.provider, title: t.title, sub: esc(t.meta), time: t.exited ? 'exited' : '',
          open: true, exited: t.exited, active: t === sx.active, sessionAttr: `data-tab="${esc(t.key)}"`,
          rename: `data-rename-tab="${esc(t.key)}"`, close: t.key,
        }));
      }
    }
    if (sx.error) parts.push(`<p class="error small sx-pad">${esc(sx.error)}</p>`);
    else if (!sx.sessions) parts.push('<p class="muted small sx-pad">Reading the sessions…</p>');
    else {
      const list = filtered();
      if (!list.length) parts.push(`<p class="muted small sx-pad">${sx.sessions.length ? 'No session matches.' : 'No Claude Code, Codex or Grok sessions on this machine yet.'}</p>`);
      let group = null;
      for (const s of list.slice(0, 300)) {
        const g = dayGroup(s.updatedAt);
        if (g !== group) { parts.push(`<div class="sx-group">${esc(g)}</div>`); group = g; }
        const tab = sx.tabs.find((t) => t.key === resumeKey(s.provider, s.id));
        const where = s.project ? `<b>${esc(s.project.name)}</b>` : esc(folderName(s.cwd) || 'unknown folder');
        const tags = [s.model && esc(s.model), s.workflowAgent && '<span class="sx-tag">agent</span>'].filter(Boolean).join(' · ');
        parts.push(itemHtml({
          provider: s.provider, title: s.title, sub: `${where}${tags ? ` · ${tags}` : ''}`, time: ago(s.updatedAt),
          open: !!tab, exited: tab?.exited, active: tab && tab === sx.active,
          sessionAttr: `data-provider="${esc(s.provider)}" data-id="${esc(s.id)}" title="${esc(s.cwd || '')}"`,
          rename: `data-rename-provider="${esc(s.provider)}" data-rename-id="${esc(s.id)}"`,
        }));
      }
      if (list.length > 300) parts.push(`<p class="muted small sx-pad">${list.length - 300} older sessions not shown: search to find them.</p>`);
    }
    box.innerHTML = parts.join('');
    const onOpen = (el, fn) => {
      el.onclick = (e) => { if (!e.target.closest('.sx-item-actions, .sx-title-input')) fn(); };
      el.onkeydown = (e) => { if (e.key === 'Enter' && e.target === el) fn(); };
    };
    box.querySelectorAll('[data-tab]').forEach((el) => onOpen(el, () => activate(sx.tabs.find((t) => t.key === el.dataset.tab))));
    box.querySelectorAll('[data-id]').forEach((el) => onOpen(el, () => openSession(el.dataset.provider, el.dataset.id)));
    box.querySelectorAll('.sx-item-rename').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const el = b.closest('.sx-item').querySelector('.sx-item-text');
      if (b.dataset.renameTab) editTabTitle(el, sx.tabs.find((t) => t.key === b.dataset.renameTab));
      else editSessionTitle(el, b.dataset.renameProvider, b.dataset.renameId);
    }));
    box.querySelectorAll('.sx-item-close').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      endTab(sx.tabs.find((t) => t.key === b.dataset.closeTab));
    }));
    const running = sx.tabs.filter((t) => !t.exited).length;
    $s('#nav-sessions-count').textContent = String(running);
    $s('#nav-sessions-count').classList.toggle('hidden', !running);
  }

  // ---- terminals ----------------------------------------------------------------------
  function findTab(id) { return sx.tabs.find((t) => t.id === id) || null; }

  let msgTimer = null;
  function flash(text, error = false) {
    const el = $s('#sx-term-msg');
    el.textContent = text;
    el.classList.toggle('error', error);
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => (el.textContent = ''), 3000);
  }

  function fitActive() {
    const t = sx.active;
    if (!t || !visible()) return;
    try { t.fit.fit(); } catch { /* not visible yet */ }
  }

  function renderHead() {
    const t = sx.active;
    $s('#sx-empty').classList.toggle('hidden', !!t);
    $s('#sx-term-head').classList.toggle('hidden', !t);
    if (!t) return;
    $s('#sx-term-badge').outerHTML = badge(t.provider).replace('class="sx-badge', 'id="sx-term-badge" class="sx-badge');
    $s('#sx-term-title').textContent = t.title;
    $s('#sx-term-meta').textContent = t.meta;
    $s('#btn-sx-restart').classList.toggle('hidden', !t.exited);
    $s('#btn-sx-close').textContent = t.exited ? 'Close' : 'End session';
    $s('#btn-sx-rename').disabled = false;
    $s('#btn-sx-rename').title = t.kind === 'cli-new' ? 'Rename this terminal: the CLI session gets the name once it is recorded (after your first message)' : 'Rename this session';
  }

  function activate(tab) {
    if (!tab) return;
    sx.active = tab;
    sx.tabs.forEach((t) => t.pane.classList.toggle('active', t === tab));
    renderHead();
    renderList();
    window.reportNotifyContext?.();
    requestAnimationFrame(() => { fitActive(); tab.term.focus(); });
  }

  // Starts the tab's CLI (again, after a restart) in its xterm.
  async function start(tab) {
    tab.exited = false;
    tab.id = null;
    tab.startedAt = Date.now();
    try {
      const res = await api.termOpen({ kind: tab.kind, ...tab.opts, cols: tab.term.cols, rows: tab.term.rows });
      tab.id = res.id;
      if (res.windowsPty) tab.term.options.windowsPty = res.windowsPty;
      if (res.title && tab.kind === 'cli-resume' && res.title !== '(no prompt)') tab.title = res.title;
      if (res.cwd) { tab.cwd = res.cwd; tab.meta = [tab.model, res.cwd].filter(Boolean).join(' · '); }
      replayPending(tab);
      window.reportNotifyContext?.();
      renderHead();
      renderList();
      fitActive();
      // the CLI records a new session after its first message: pick it up in the list
      if (tab.kind === 'cli-new') setTimeout(load, 5000);
    } catch (e) {
      tab.exited = true;
      tab.term.write(`\x1b[31m${errMsg(e)}\x1b[0m\r\n`);
      renderHead();
      renderList();
      throw e;
    }
  }

  function createTab({ key, kind, provider, title, meta, model, opts }) {
    if (typeof Terminal === 'undefined') throw new Error('The terminal component failed to load.');
    const pane = document.createElement('div');
    pane.className = 'term-pane';
    $s('#sx-term-body').appendChild(pane);
    const { term, fit } = createXterm(kind);
    const tab = { key, id: null, kind, provider, title, meta, model, opts, term, fit, pane, exited: false, lastPaste: 0, sent: 0 };
    tab.onFocus = () => { if (sx.active !== tab) activate(tab); };
    tab.onChange = () => { renderHead(); renderList(); };
    tab.flash = flash;
    sx.tabs.unshift(tab);
    term.open(pane);
    wireTerminal(tab);
    activate(tab);
    // the CLI's first frame should already have the final size: TUIs redraw badly on a resize
    try { fit.fit(); } catch { /* the screen is not visible */ }
    return tab;
  }

  async function openSession(provider, id) {
    const key = resumeKey(provider, id);
    const existing = sx.tabs.find((t) => t.key === key);
    if (existing) return activate(existing);
    const s = (sx.sessions || []).find((x) => x.provider === provider && x.id === id);
    const tab = createTab({
      key, kind: 'cli-resume', provider, title: s?.title || id, model: s?.model,
      meta: [s?.model, s?.cwd].filter(Boolean).join(' · '), opts: { provider, sessionId: id },
    });
    start(tab).catch(() => {});
  }

  // ---- rename ---------------------------------------------------------------------------
  // Turns a title into an input: Enter or leaving it saves, Esc cancels; save(title) gets the
  // trimmed text when it changed. The list is not redrawn while a title is being edited.
  function editTitle(el, current, save) {
    if (!el || sx.editing) return;
    const input = document.createElement('input');
    input.className = 'sx-title-input';
    input.value = current;
    input.placeholder = 'Empty = the default title';
    input.setAttribute('aria-label', 'Session title');
    el.replaceWith(input);
    sx.editing = true;
    input.focus();
    input.select();
    let done = false;
    const finish = async (keep) => {
      if (done) return;
      done = true;
      sx.editing = false;
      const title = input.value.trim();
      input.replaceWith(el); // the header keeps its title element (the list is redrawn anyway)
      if (keep && title !== current) {
        try { await save(title); } catch (e) { flash(errMsg(e), true); }
      }
      renderHead();
      renderList();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    };
    input.onblur = () => finish(true);
    input.onclick = (e) => e.stopPropagation();
  }

  // A recorded CLI session: the name is kept by the app (empty = the CLI's own title).
  function editSessionTitle(el, provider, id) {
    const s = (sx.sessions || []).find((x) => x.provider === provider && x.id === id);
    const tab = sx.tabs.find((t) => t.key === resumeKey(provider, id));
    editTitle(el, s?.title || tab?.title || '', async (title) => {
      const r = await api.renameCliSession(provider, id, title);
      if (s) { s.title = r.title || s.title; s.renamed = r.renamed; }
      if (tab && r.title) tab.title = r.title;
    });
  }

  // An open terminal: a recorded session is renamed; a new session the CLI has not recorded yet
  // gets its tab renamed now and the name given to the session once it is recorded (linkTabs);
  // any other terminal only gets its tab label. Empty = the tab's first title.
  function editTabTitle(el, tab) {
    if (!tab) return;
    if (tab.kind === 'cli-resume') return editSessionTitle(el, tab.opts.provider, tab.opts.sessionId);
    tab.baseTitle ??= tab.title;
    editTitle(el, tab.title, async (title) => {
      // recorded while the title was being edited
      if (tab.kind === 'cli-resume') return renameRecorded(tab, title);
      tab.title = title || tab.baseTitle;
      if (tab.kind === 'cli-new') tab.pendingTitle = title || null;
    });
  }

  async function renameRecorded(tab, title) {
    const { provider, sessionId: id } = tab.opts;
    const r = await api.renameCliSession(provider, id, title);
    const s = (sx.sessions || []).find((x) => x.provider === provider && x.id === id);
    if (s) { s.title = r.title || s.title; s.renamed = r.renamed; }
    if (r.title) tab.title = r.title;
  }

  // The name given to a new session before the CLI recorded it, applied to the recorded session.
  function applyPendingTitle(tab, s) {
    const title = tab.pendingTitle;
    tab.pendingTitle = null;
    s.title = title; // linkTabs keeps it on the tab meanwhile
    renameRecorded(tab, title).then(renderList, (e) => flash(errMsg(e), true));
  }

  function renameActive() {
    if (sx.active) editTabTitle($s('#sx-term-title'), sx.active);
  }


  // ---- end ------------------------------------------------------------------------------
  // Ends the CLI and every process it started (the engine kills the whole process tree) and
  // closes the terminal. The conversation stays recorded: it can be reopened from the list.
  // An exited terminal closes without asking. Used by the toolbar and the list's trash can.
  async function endTab(tab) {
    if (!tab) return;
    if (tab.id && !tab.exited) {
      const ok = await confirmDialog('End session?', `"${tab.title}": the CLI and everything it started are closed. The conversation stays recorded, so you can reopen it from the list.`, 'End session');
      if (!ok || !sx.tabs.includes(tab)) return;
    }
    closeTab(tab);
  }
  const endActive = () => endTab(sx.active);

  function closeTab(tab) {
    if (!tab) return;
    if (tab.id && !tab.exited) api.termKill(tab.id).catch(() => {});
    const i = sx.tabs.indexOf(tab);
    if (i < 0) return;
    sx.tabs.splice(i, 1);
    tab.term.dispose();
    tab.pane.remove();
    if (sx.active !== tab) { renderList(); return; }
    sx.active = null;
    const next = sx.tabs[i] || sx.tabs[i - 1];
    if (next) activate(next);
    else { renderHead(); renderList(); window.reportNotifyContext?.(); }
  }
  const closeActive = () => closeTab(sx.active);

  function restartActive() {
    const tab = sx.active;
    if (!tab || !tab.exited) return;
    tab.term.reset();
    start(tab).catch(() => {});
  }

  // ---- new session ------------------------------------------------------------------------
  async function openNew() {
    if (!sx.providers.length) await load();
    const last = prefs.last || {};
    const firstInstalled = sx.providers.find((p) => p.installed)?.id || 'claude';
    sx.form = {
      provider: sx.providers.some((p) => p.id === last.provider) ? last.provider : firstInstalled,
      model: last.model ?? null,
      custom: false,
      effort: last.effort || '',
      projectId: last.projectId || '',
    };
    const projects = state.projects || [];
    if (!projects.some((p) => p.id === sx.form.projectId)) sx.form.projectId = '';
    $s('#sx-project').innerHTML = `<option value="">None</option>${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
    $s('#sx-project').value = sx.form.projectId;
    $s('#sx-folder').value = '';
    $s('#sx-error').textContent = '';
    $s('#sx-model').value = '';
    renderForm();
    $s('#sx-modal').classList.remove('hidden');
    $s('#sx-model-select').focus();
  }

  // Models come from the CLI's own list ({ id, name, efforts, defaultEffort }); "Other…" takes any
  // model id, and "CLI default" passes none. The effort options follow the chosen model.
  const OTHER = '__other__';
  function renderForm() {
    const f = sx.form;
    const p = sx.providers.find((x) => x.id === f.provider) || { models: [], efforts: [] };
    $s('#sx-providers').innerHTML = sx.providers.map((x) => `
      <button type="button" class="sx-provider ${x.id === f.provider ? 'active' : ''}" data-provider="${esc(x.id)}" role="radio" aria-checked="${x.id === f.provider}" ${x.installed ? '' : 'disabled'}>
        ${badge(x.id)}<span><b>${esc(x.name)}</b><span class="muted small">${x.installed ? `${x.models.length} model${x.models.length === 1 ? '' : 's'}` : 'not installed'}</span></span>
      </button>`).join('');
    $s('#sx-providers').querySelectorAll('[data-provider]').forEach((b) => (b.onclick = () => {
      f.provider = b.dataset.provider;
      f.model = sx.providers.find((x) => x.id === f.provider).models[0]?.id || '';
      f.custom = false;
      renderForm();
    }));
    if (f.model == null) f.model = p.models[0]?.id || '';
    if (f.model && !p.models.some((m) => m.id === f.model)) f.custom = true;
    const sel = $s('#sx-model-select');
    sel.innerHTML = `${p.models.map((m) => `<option value="${esc(m.id)}">${esc(m.name !== m.id ? `${m.name} (${m.id})` : m.id)}</option>`).join('')}
      <option value="">CLI default</option><option value="${OTHER}">Other…</option>`;
    sel.value = f.custom ? OTHER : f.model;
    const custom = $s('#sx-model');
    custom.classList.toggle('hidden', !f.custom);
    if (f.custom && custom.value !== f.model) custom.value = f.model;
    const model = p.models.find((m) => m.id === f.model);
    const efforts = model?.efforts?.length ? model.efforts : p.efforts;
    if (f.effort && !efforts.includes(f.effort)) f.effort = '';
    $s('#sx-model-hint').textContent = f.custom ? 'Any model id the CLI accepts.' : !f.model ? 'The model the CLI picks by default.' : model?.defaultEffort ? `Default effort: ${model.defaultEffort}.` : '';
    $s('#sx-efforts').innerHTML = ['', ...efforts].map((e) => `<button type="button" data-effort="${esc(e)}" class="${e === f.effort ? 'active' : ''}">${esc(e || 'default')}</button>`).join('');
    $s('#sx-efforts').querySelectorAll('[data-effort]').forEach((b) => (b.onclick = () => { f.effort = b.dataset.effort; renderForm(); }));
    const project = (state.projects || []).find((x) => x.id === $s('#sx-project').value);
    $s('#sx-folder').placeholder = project?.folder || 'Your home folder';
    $s('#btn-sx-start').disabled = !sx.providers.find((x) => x.id === f.provider)?.installed;
  }

  async function submitNew(e) {
    e.preventDefault();
    const f = sx.form;
    f.model = (f.custom ? $s('#sx-model').value : f.model || '').trim();
    f.projectId = $s('#sx-project').value;
    const folder = $s('#sx-folder').value.trim();
    const provider = sx.providers.find((x) => x.id === f.provider);
    const project = (state.projects || []).find((x) => x.id === f.projectId);
    prefs.last = { provider: f.provider, model: f.model, effort: f.effort, projectId: f.projectId };
    persist();
    const where = project?.name || folderName(folder) || 'home';
    const tab = createTab({
      key: `new:${++sx.seq}`, kind: 'cli-new', provider: f.provider, model: f.model,
      title: `New ${provider?.name || f.provider} session · ${where}`,
      meta: [f.model || 'default model', f.effort && `effort ${f.effort}`].filter(Boolean).join(' · '),
      opts: { provider: f.provider, model: f.model || null, effort: f.effort || null, projectId: f.projectId || null, folder: folder || null },
    });
    try {
      await start(tab);
      $s('#sx-modal').classList.add('hidden');
      if (!visible()) showView('sessions');
    } catch (err) {
      // keep the form open with the reason; the failed tab goes away
      sx.active = tab;
      closeActive();
      $s('#sx-error').textContent = errMsg(err);
    }
  }

  // ---- wiring ---------------------------------------------------------------------------
  function init() {
    $s('#btn-sx-new').onclick = openNew;
    $s('#btn-sx-new-empty').onclick = openNew;
    $s('#btn-sx-refresh').onclick = () => load();
    $s('#btn-sx-close').onclick = endActive;
    $s('#btn-sx-rename').onclick = renameActive;
    $s('#sx-term-title').ondblclick = renameActive;
    $s('#btn-sx-restart').onclick = restartActive;
    $s('#sx-search').oninput = (e) => { sx.q = e.target.value; renderList(); };
    $s('#sx-show-agents').onchange = (e) => { prefs.showAgents = e.target.checked; persist(); renderList(); };
    $s('#sx-form').onsubmit = submitNew;
    $s('#btn-sx-cancel').onclick = () => $s('#sx-modal').classList.add('hidden');
    $s('#sx-project').onchange = () => renderForm();
    $s('#sx-model-select').onchange = (e) => {
      const other = e.target.value === OTHER;
      Object.assign(sx.form, { custom: other, model: other ? $s('#sx-model').value.trim() : e.target.value });
      renderForm();
      if (other) $s('#sx-model').focus();
    };
    $s('#sx-model').oninput = (e) => { sx.form.model = e.target.value; };
    $s('#btn-sx-pick').onclick = async () => { const d = await api.pickFolder(); if (d) $s('#sx-folder').value = d; };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$s('#sx-modal').classList.contains('hidden')) { e.stopImmediatePropagation(); $s('#sx-modal').classList.add('hidden'); }
    }, true);
    window.addEventListener('resize', fitActive);
    if (window.ResizeObserver) new ResizeObserver(() => fitActive()).observe($s('#sx-term-body'));
    renderHead();
  }

  // A desktop notification about a terminal was clicked: show it.
  function focusTerminal(id) {
    const tab = findTab(id);
    if (!tab) return false;
    if (!visible()) showView('sessions');
    activate(tab);
    return true;
  }
  // the terminal the screen shows, for desktop notifications
  const shownTerminalId = () => (visible() ? sx.active?.id || null : null);

  registerView({
    id: 'sessions',
    nav: { label: 'Sessions', order: 10, title: 'Claude Code, Codex and Grok sessions on this machine, in embedded terminals', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><polyline points="7 9 10 12 7 15" /><line x1="12.5" y1="15" x2="17" y2="15" /></svg>' },
    markup: `
      <section id="view-sessions" class="view view-sessions hidden">
        <aside class="sx-side">
          <div class="sx-head">
            <h1>Sessions</h1>
            <button id="btn-sx-refresh" class="icon-btn" type="button" title="Reload the sessions list">
              <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="23 4 23 10 17 10" /><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10" /></svg>
            </button>
          </div>
          <button id="btn-sx-new" class="btn primary btn-icon sx-new" type="button">
            <svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New session
          </button>
          <input id="sx-search" class="sx-search" type="search" placeholder="Search title, folder, model…" aria-label="Search sessions" />
          <div id="sx-filters" class="chips sx-filters" role="group" aria-label="Provider"></div>
          <label class="sx-toggle small muted"><input type="checkbox" id="sx-show-agents" /> Show workflow agents' sessions</label>
          <div id="sx-list" class="sx-list" role="list"></div>
        </aside>
        <section class="sx-main">
          <div id="sx-empty" class="sx-empty">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><polyline points="7 9 10 12 7 15" /><line x1="12.5" y1="15" x2="17" y2="15" /></svg>
            <b>Pick a session or start a new one</b>
            <p class="muted">Reopening a session runs its CLI (<span class="mono">claude</span>, <span class="mono">codex</span> or <span class="mono">grok</span>) in the session's folder, resuming the same conversation. It is the real CLI: everything you type goes to it.</p>
            <button id="btn-sx-new-empty" class="btn primary" type="button">New session</button>
          </div>
          <div id="sx-term-head" class="sx-term-head hidden">
            <span id="sx-term-badge" class="sx-badge"></span>
            <div class="sx-term-title">
              <span class="sx-title-row">
                <b id="sx-term-title"></b>
                <button id="btn-sx-rename" class="icon-btn sx-rename" type="button" title="Rename this session">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                </button>
              </span>
              <span id="sx-term-meta" class="muted small mono"></span>
            </div>
            <span id="sx-term-msg" class="muted small"></span>
            <button id="btn-sx-restart" class="btn ghost sm hidden" type="button" title="Run the CLI again in this terminal">Restart</button>
            <button id="btn-sx-close" class="btn ghost sm danger" type="button" title="End the CLI and everything it started, and close the terminal (the conversation stays recorded)">End session</button>
          </div>
          <div id="sx-term-body" class="sx-term-body"></div>
        </section>
      </section>`,
    modals: `
  <div id="sx-modal" class="modal hidden">
    <form id="sx-form" class="modal-card wide">
      <h3>New session</h3>
      <div class="field">
        <label>Provider</label>
        <div id="sx-providers" class="sx-providers" role="radiogroup" aria-label="Provider"></div>
      </div>
      <div class="field">
        <label for="sx-model-select">Model</label>
        <select id="sx-model-select"></select>
        <input type="text" id="sx-model" class="hidden sx-model-custom" autocomplete="off" placeholder="Model id, e.g. gpt-5.6-terra" aria-label="Model id" />
        <div id="sx-model-hint" class="hint"></div>
      </div>
      <div class="field">
        <label>Effort</label>
        <div id="sx-efforts" class="seg" role="radiogroup" aria-label="Effort"></div>
      </div>
      <div class="field">
        <label for="sx-project">Project</label>
        <select id="sx-project"></select>
      </div>
      <div class="field">
        <label for="sx-folder">Folder</label>
        <div class="row">
          <input type="text" id="sx-folder" placeholder="The project's folder, or your home folder" />
          <button type="button" id="btn-sx-pick" class="btn sm">…</button>
        </div>
        <div class="hint">Where the CLI starts: it works on the files in this folder.</div>
      </div>
      <p id="sx-error" class="error small"></p>
      <div class="modal-actions">
        <button type="button" id="btn-sx-cancel" class="btn ghost">Cancel</button>
        <button type="submit" id="btn-sx-start" class="btn primary">Start session</button>
      </div>
    </form>
  </div>`,
    mount() {
      // the sidebar entry's count of running sessions (renderHead)
      $s('nav.sidebar [data-view="sessions"]').insertAdjacentHTML('beforeend', '<span id="nav-sessions-count" class="nav-badge hidden"></span>');
      init();
    },
    show,
  });
  window.SessionsView = { show, findTab, openNew, focusTerminal, shownTerminalId };
})();
