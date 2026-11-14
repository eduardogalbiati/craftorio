/* global api */
// Mockup editor (#625, D6-D10): the page of the editor window (apps/desktop/host/mockups-window.js loads
// index.html?window=mockup&project=<id>&slug=<slug>). Like the Agents window (packages/ui-kit/agents-window.js),
// the shell gives way (body.mockup-window-page) to the editor: the canvas, a sandboxed iframe
// (allow-scripts only: an opaque origin, no window.api) on mockup://<project>/screens/<slug>/index.html, at
// the chosen frame's width (Q-5: Desktop 1440, Tablet 768, Phone 390); the versions (one commit per turn,
// D10: Restore makes a new commit); and the designer chat (AgentChat, pasted images become refs/, D9).
// A click on the canvas reaches the inspector inside the frame (mockup-inspector.js), whose
// postMessage({ type: 'mockup:select' }) becomes the selection chip in the chat's compose slot; Send builds
// MockupModel.buildChatMessage's fields (selection, refs, frame, message) for mockups:chat, then draws the
// new version, the designer's reply and the kit lint's problems (D11). A second open of the window
// (mockups-window:show) switches the screen. Test ids: mockup-editor, mockup-canvas, mockup-chat,
// mockup-selection-chip, mockup-frames, mockup-versions, mockup-lint.
// Uses app.js globals at call time (esc, api, errMsg, showToast), AgentChat, MockupModel.
(() => {
  const query = () => { try { return new URLSearchParams(window.location?.search || ''); } catch { return new URLSearchParams(); } };
  const isWindowPage = () => query().get('window') === 'mockup';
  // projectId, slug, frame (a FRAMES id), selection ([inspector descriptions]), versions, problems (kit lint)
  const ed = { projectId: null, slug: null, frame: 'desktop-1440', selection: [], versions: [], problems: [], chat: null, root: null };
  const frames = () => window.MockupModel?.FRAMES || [{ id: 'desktop-1440', label: 'Desktop', width: 1440 }];
  const q = (sel) => ed.root?.querySelector(sel) || null;
  const canvasUrl = (bust) => `mockup://${encodeURIComponent(ed.projectId)}/screens/${encodeURIComponent(ed.slug)}/index.html${bust ? `?v=${encodeURIComponent(bust)}` : ''}`;

  function markup() {
    const seg = frames().map((f) => `<button type="button" data-mockup-frame="${esc(f.id)}" aria-pressed="${f.id === ed.frame}" class="${f.id === ed.frame ? 'active' : ''}">${esc(f.label)} <span class="muted mono">${f.width}</span></button>`).join('');
    return `
      <div class="mockup-editor" data-testid="mockup-editor">
        <header class="mockup-editor-head">
          <div class="mockup-editor-title">
            <h1 id="mockup-title"></h1>
            <span id="mockup-version" class="badge neutral mono"></span>
            <span id="mockup-lint" class="badge" data-testid="mockup-lint"></span>
          </div>
          <div class="seg sm" role="group" aria-label="${t('mockups.frame')}" data-testid="mockup-frames">${seg}</div>
        </header>
        <p id="mockup-error" class="error small" role="alert"></p>
        <div class="mockup-editor-body">
          <div class="mockup-stage">
            <iframe id="mockup-canvas" class="mockup-canvas" data-testid="mockup-canvas" sandbox="allow-scripts" title="${t('mockups.canvas')}"></iframe>
          </div>
          <aside class="mockup-side">
            <details class="mockup-versions-box">
              <summary>${t('mockups.versions')}</summary>
              <ol id="mockup-versions" class="mockup-versions" data-testid="mockup-versions"></ol>
            </details>
            <div id="mockup-chat" class="mockup-chat" data-testid="mockup-chat"></div>
          </aside>
        </div>
      </div>`;
  }

  const errorLine = (msg) => { const p = q('#mockup-error'); if (p) p.textContent = msg || ''; };

  // ---- the canvas and its frame -----------------------------------------------------------------
  function applyFrame() {
    const f = frames().find((x) => x.id === ed.frame) || frames()[0];
    const canvas = q('#mockup-canvas');
    if (canvas) canvas.style.width = `${f.width}px`;
    ed.root?.querySelectorAll('[data-mockup-frame]').forEach((b) => {
      const on = b.dataset.mockupFrame === f.id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function renderHead() {
    const latest = ed.versions[0];
    q('#mockup-title').textContent = ed.slug || '';
    q('#mockup-version').textContent = latest ? `v${ed.versions.length} · ${String(latest.commit).slice(0, 7)}` : '';
    const lint = q('#mockup-lint');
    lint.className = `badge ${ed.problems.length ? 'warning' : 'success'}`;
    lint.textContent = ed.problems.length ? t('mockups.lint_problems', { count: ed.problems.length }) : t('mockups.lint_clean');
    lint.title = ed.problems.map((p) => p.message || p.kind || '').join('\n');
  }

  function renderVersions() {
    const list = q('#mockup-versions');
    if (!list) return;
    list.innerHTML = ed.versions.map((v, i) => `
      <li class="row">
        <span class="mono small" title="${esc(v.commit)}">${esc(String(v.commit).slice(0, 7))}</span>
        <span class="small mockup-version-msg" title="${esc(v.message || '')}">${esc(v.message || '')}</span>
        ${i === 0 ? `<span class="badge neutral">${t('mockups.current')}</span>` : `<button type="button" class="btn sm ghost" data-mockup-restore="${esc(v.commit)}">${t('mockups.restore')}</button>`}
      </li>`).join('');
  }

  // ---- the selection chips (the inspector's descriptions) ---------------------------------------
  function renderChips() {
    const box = ed.chat?.slot?.('compose');
    if (!box) return;
    box.innerHTML = ed.selection.map((s, i) => `
      <span class="mockup-chip" data-testid="mockup-selection-chip" title="${esc(s.selector || '')}">
        <span class="mono small">${esc(s.kit || s.selector?.split(' > ').pop() || s.mid)}</span>
        <span class="mockup-chip-text">${esc(s.text || '')}</span>
        <button type="button" class="btn sm ghost" data-mockup-unselect="${i}" aria-label="${t('mockups.remove_selection')}">×</button>
      </span>`).join('');
  }

  function onMessage(e) {
    const canvas = q('#mockup-canvas');
    if (!canvas || e.source !== canvas.contentWindow || e.data?.type !== 'mockup:select' || !e.data.mid) return;
    const { mid, selector, kit, text, box, html } = e.data;
    ed.selection = [{ mid: String(mid), selector, kit: kit || null, text, box, html }];
    renderChips();
    ed.chat?.refresh?.();
  }

  // ---- loading a screen -------------------------------------------------------------------------
  async function load(projectId, slug, { bust = null } = {}) {
    ed.projectId = projectId;
    ed.slug = slug;
    errorLine('');
    if (!projectId || !slug) { errorLine(t('mockups.no_screen_chosen')); return; }
    const canvas = q('#mockup-canvas');
    try {
      const [versions, history] = await Promise.all([api.listMockupVersions(projectId, slug), api.readMockupChat(projectId, slug)]);
      ed.versions = Array.isArray(versions) ? versions : [];
      ed.chat?.setMessages(Array.isArray(history) ? history : []);
    } catch (e) { errorLine(errMsg(e)); }
    if (canvas) canvas.src = canvasUrl(bust || ed.versions[0]?.commit || '');
    renderHead();
    renderVersions();
  }

  // ---- the designer chat ------------------------------------------------------------------------
  async function send(text, attachments) {
    const refs = [];
    for (const a of attachments || []) {
      if (!a?.dataUrl) continue;
      const ext = (/^data:image\/(\w+)/.exec(a.dataUrl) || [])[1] || 'png';
      refs.push(await api.saveMockupRef(ed.projectId, a.dataUrl, ext));
    }
    const out = await api.sendMockupChat(ed.projectId, ed.slug, text, ed.selection, refs, null, ed.frame);
    ed.problems = Array.isArray(out?.problems) ? out.problems : [];
    ed.selection = [];
    renderChips();
    await load(ed.projectId, ed.slug, { bust: out?.commit || String(Date.now()) });
    if (out?.runId) showToast(t('mockups.designer_started'), ed.slug);
    return { ok: true };
  }

  function mountChat() {
    if (!window.AgentChat?.create) return;
    ed.chat = window.AgentChat.create(q('#mockup-chat'), {
      agent: t('mockups.designer'),
      agentId: 'designer',
      placeholder: t('mockups.say_what_to_change'),
      pasteImages: true,
      send: (text, attachments) => send(text, attachments),
      emptyHtml: () => `<p class="muted small">${t('mockups.select_then_ask')}</p>`,
    });
  }

  async function restore(commit) {
    try {
      const out = await api.restoreMockupVersion(ed.projectId, ed.slug, commit);
      showToast(t('mockups.restored', { commit: String(commit).slice(0, 7) }), ed.slug);
      await load(ed.projectId, ed.slug, { bust: out?.commit || commit });
    } catch (e) { errorLine(errMsg(e)); }
  }

  function onClick(e) {
    const frame = e.target.closest('[data-mockup-frame]');
    if (frame) { ed.frame = frame.dataset.mockupFrame; applyFrame(); return; }
    const back = e.target.closest('[data-mockup-restore]');
    if (back) { restore(back.dataset.mockupRestore); return; }
    const un = e.target.closest('[data-mockup-unselect]');
    if (un) { ed.selection.splice(Number(un.dataset.mockupUnselect), 1); renderChips(); }
  }

  function mount(el) {
    ed.root = el;
    ed.frame = window.MockupModel?.DEFAULT_FRAME || ed.frame;
    el.innerHTML = markup();
    el.addEventListener('click', onClick);
    window.addEventListener('message', onMessage);
    mountChat();
    applyFrame();
    load(query().get('project'), query().get('slug'));
    api.onMockupsWindowShow?.((m) => { if (m?.projectId && m?.slug) load(m.projectId, m.slug); });
    // a real designer run ends: its version is in the folder
    api.onEvent?.((ev) => { if (['workflow.finished', 'run.finished'].includes(ev?.type) && ed.slug) load(ed.projectId, ed.slug, { bust: String(Date.now()) }); });
  }

  if (window.document?.addEventListener) {
    window.document.addEventListener('DOMContentLoaded', () => {
      if (!isWindowPage()) return;
      window.document.body.classList.add('mockup-window-page');
      const el = window.document.createElement('div');
      el.id = 'mockup-editor-root';
      window.document.body.appendChild(el);
      mount(el);
    });
  }

  window.MockupEditor = { isWindowPage, mount };
})();
