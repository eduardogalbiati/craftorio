/* global api */
// Mockup editor (#625, D6-D10): the page of the editor window (apps/desktop/host/mockups-window.js loads
// index.html?window=mockup&project=<id>&slug=<slug>). Like the Agents window (packages/ui-kit/agents-window.js),
// the shell gives way (body.mockup-window-page) to the editor: the canvas, a sandboxed iframe
// (allow-scripts only: an opaque origin, no window.api) on mockup://<project>/screens/<slug>/index.html, at
// the chosen frame's width (Q-5: Desktop 1440, Tablet 768, Phone 390); the versions (one commit per turn,
// D10: Restore makes a new commit); and the designer chat (AgentChat, pasted images become refs/, D9).
// A click on the canvas reaches the inspector inside the frame (mockup-inspector.js), whose
// postMessage({ type: 'mockup:select' }) becomes a selection chip in the chat's compose slot (a click
// replaces the selection, Shift/Ctrl/⌘ adds to it); Send builds MockupModel.buildChatMessage's fields
// (selection, refs, frame, message) for mockups:chat (one turn of the screen's persistent designer
// session, D8), then draws the new version, the designer's reply and the kit lint's problems (D11).
// The axe the canvas runs on each version (mockup:axe, apps/desktop/host/mockups-window.js) is the
// mockup-axe badge. The chat's head slot shows the next turn's estimate (D15, chat-edit) and what this
// mockup's chat has cost so far (Q-8, MockupModel.chatCostUsd). Not yet (phase 2): a selection's cropped
// image (`crop`) and the Area mode for regions. A second open of the window (mockups-window:show)
// switches the screen. #835: a new frame reloads the canvas (axe on the frame shown); variants are the
// mockup repository's branches (the current one's badge, a switch per variant, New variant → a name
// dialog, Keep asks first: the others are deleted); the chat saves on the current variant; Compare shows
// the two latest versions side by side (iframes on mockup://…?at=<sha>, the inspector outlines the
// changed data-mids, mockups:compare); Interact posts mockup:mode to the canvas, whose clicks come back as
// mockup:navigate and follow the chosen flow (MockupModel.flowTarget); the Flows box links the selected
// element to another screen (mockups:save-flow); Promote to kit (one selected element, a name dialog);
// Attach on a version: a Discovery card gets '<slug>@<sha7>.mockup.json' (mockups:attach, frozen).
// Test ids: mockup-editor, mockup-canvas, mockup-chat, mockup-selection-chip,
// mockup-frames, mockup-versions, mockup-lint, mockup-axe, mockup-chat-cost, mockup-variant-current,
// mockup-variants, mockup-variant-new, mockup-variant-keep, mockup-name-dialog, mockup-compare-open,
// mockup-compare, mockup-compare-before, mockup-compare-after, mockup-compare-close, mockup-changed (inside
// a side), mockup-interact, mockup-flows, mockup-flow-select, mockup-flow-new, mockup-link-target,
// mockup-link, mockup-promote, mockup-attach, mockup-attach-dialog.
// Uses app.js globals at call time (esc, api, errMsg, showToast, fmtCost), AgentChat, MockupModel.
(() => {
  const query = () => { try { return new URLSearchParams(window.location?.search || ''); } catch { return new URLSearchParams(); } };
  const isWindowPage = () => query().get('window') === 'mockup';
  // projectId, slug, frame (a FRAMES id), selection ([inspector descriptions]), versions, problems (kit
  // lint), axe (the canvas' violations, null before it reports), totalUsd (the chat's cost so far)
  // #835: variant / variants (the repository's branches), screens (mockups:list), flows ([{ name }]), flow
  // (the chosen flow { name, links } or null), mode ('select' | 'interact'), compare (null or { from, to,
  // changed }), dialog (what the name dialog does: 'variant' | 'promote')
  const ed = {
    projectId: null, slug: null, frame: null, selection: [], versions: [], problems: [], axe: null, totalUsd: 0, chat: null, root: null,
    variant: 'main', variants: [], screens: [], flows: [], flow: null, mode: 'select', compare: null, dialog: null, attach: null,
  };
  const frames = () => window.MockupModel.FRAMES;
  const money = (n) => (window.I18n?.formatCost ? window.I18n.formatCost(n) : `$${(Number(n) || 0).toFixed(2)}`);
  const q = (sel) => ed.root?.querySelector(sel) || null;
  const screenUrl = (query) => `mockup://${encodeURIComponent(ed.projectId)}/screens/${encodeURIComponent(ed.slug)}/index.html${query}`;
  const canvasUrl = (bust) => screenUrl(bust ? `?v=${encodeURIComponent(bust)}` : '');

  function markup() {
    const seg = frames().map((f) => `<button type="button" data-mockup-frame="${esc(f.id)}" aria-pressed="${f.id === ed.frame}" class="${f.id === ed.frame ? 'active' : ''}">${esc(f.label)} <span class="muted mono">${f.width}</span></button>`).join('');
    return `
      <div class="mockup-editor" data-testid="mockup-editor">
        <header class="mockup-editor-head">
          <div class="mockup-editor-title">
            <h1 id="mockup-title"></h1>
            <span id="mockup-version" class="badge neutral mono"></span>
            <span id="mockup-lint" class="badge" data-testid="mockup-lint"></span>
            <span id="mockup-axe" class="badge neutral hidden" data-testid="mockup-axe"></span>
          </div>
          <div class="mockup-editor-tools">
            <span class="muted small">${t('mockups.variant_current')}</span>
            <span id="mockup-variant-current" class="badge neutral mono" data-testid="mockup-variant-current" title="${t('mockups.variant_current')}"></span>
            <div id="mockup-variants" class="seg sm" role="group" aria-label="${t('mockups.variants')}" data-testid="mockup-variants"></div>
            <button type="button" class="btn sm" data-testid="mockup-variant-new" data-mockup-variant-new>${t('mockups.variant_new')}</button>
            <button type="button" class="btn sm ghost hidden" id="mockup-variant-keep" data-testid="mockup-variant-keep" data-mockup-variant-keep>${t('mockups.keep_variant')}</button>
            <button type="button" class="btn sm" id="mockup-compare-open" data-testid="mockup-compare-open" data-mockup-compare disabled>${t('mockups.compare')}</button>
            <button type="button" class="btn sm" id="mockup-interact" data-testid="mockup-interact" data-mockup-interact aria-pressed="false">${t('mockups.interact')}</button>
            <div class="seg sm" role="group" aria-label="${t('mockups.frame')}" data-testid="mockup-frames">${seg}</div>
          </div>
        </header>
        <p id="mockup-error" class="error small" role="alert"></p>
        <div class="mockup-editor-body">
          <div class="mockup-stage">
            <iframe id="mockup-canvas" class="mockup-canvas" data-testid="mockup-canvas" sandbox="allow-scripts" title="${t('mockups.canvas')}"></iframe>
            <div id="mockup-compare" class="mockup-compare hidden" data-testid="mockup-compare"></div>
          </div>
          <aside class="mockup-side">
            <details class="mockup-versions-box">
              <summary>${t('mockups.versions')}</summary>
              <ol id="mockup-versions" class="mockup-versions" data-testid="mockup-versions"></ol>
            </details>
            <details class="mockup-versions-box" data-testid="mockup-flows">
              <summary>${t('mockups.flows')}</summary>
              <div id="mockup-flows" class="mockup-flows"></div>
            </details>
            <div id="mockup-chat" class="mockup-chat" data-testid="mockup-chat"></div>
          </aside>
        </div>
        <div id="mockup-name-dialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="mockup-name-heading" data-testid="mockup-name-dialog">
          <form id="mockup-name-form" class="modal-card mockups-new-form">
            <h3 id="mockup-name-heading"></h3>
            <label for="mockup-name-input">${t('mockups.name')}</label>
            <input id="mockup-name-input" type="text" maxlength="80" autocomplete="off" />
            <p id="mockup-name-help" class="muted small"></p>
            <p id="mockup-name-error" class="error small" role="alert"></p>
            <div class="modal-actions">
              <button type="button" class="btn ghost" data-mockup-name-cancel>${t('common.cancel')}</button>
              <button type="submit" id="mockup-name-submit" class="btn primary"></button>
            </div>
          </form>
        </div>
        <div id="mockup-attach-dialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="mockup-attach-heading" data-testid="mockup-attach-dialog">
          <form id="mockup-attach-form" class="modal-card mockups-new-form">
            <h3 id="mockup-attach-heading">${t('mockups.attach_to_card')}</h3>
            <label for="mockup-attach-card">${t('mockups.attach_card')}</label>
            <select id="mockup-attach-card"></select>
            <p class="muted small">${t('mockups.attach_help')}</p>
            <p id="mockup-attach-error" class="error small" role="alert"></p>
            <div class="modal-actions">
              <button type="button" class="btn ghost" data-mockup-attach-cancel>${t('common.cancel')}</button>
              <button type="submit" class="btn primary">${t('mockups.attach')}</button>
            </div>
          </form>
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

  // #835 a new frame reloads the canvas: axe (and the lint badge's turn) run on the frame shown
  function reloadCanvas() {
    const canvas = q('#mockup-canvas');
    if (!canvas || !ed.projectId || !ed.slug) return;
    ed.axe = null;
    canvas.src = canvasUrl(`${ed.versions[0]?.commit || Date.now()}-${ed.frame}`);
    renderHead();
  }

  // the canvas' inspector follows the editor's mode after every load (a flow's click loads another screen)
  function postMode() {
    q('#mockup-canvas')?.contentWindow?.postMessage({ type: 'mockup:mode', mode: ed.mode }, '*');
  }

  function renderTools() {
    q('#mockup-variant-current').textContent = ed.variant || '';
    const others = ed.variants.length > 1 ? ed.variants : [];
    q('#mockup-variants').innerHTML = others.map((v) => `<button type="button" data-mockup-variant="${esc(v.name)}" aria-pressed="${v.name === ed.variant}" class="${v.name === ed.variant ? 'active' : ''}">${esc(v.name)}</button>`).join('');
    q('#mockup-variants').classList.toggle('hidden', !others.length);
    q('#mockup-variant-keep').classList.toggle('hidden', !others.length);
    q('#mockup-compare-open').disabled = ed.versions.length < 2;
    const interact = q('#mockup-interact');
    interact.setAttribute('aria-pressed', String(ed.mode === 'interact'));
    interact.classList.toggle('active', ed.mode === 'interact');
  }

  function renderHead() {
    const latest = ed.versions[0];
    renderTools();
    q('#mockup-title').textContent = ed.slug || '';
    q('#mockup-version').textContent = latest ? `v${ed.versions.length} · ${String(latest.commit).slice(0, 7)}` : '';
    const lint = q('#mockup-lint');
    lint.className = `badge ${ed.problems.length ? 'warning' : 'success'}`;
    lint.textContent = ed.problems.length ? t('mockups.lint_problems', { count: ed.problems.length }) : t('mockups.lint_clean');
    lint.title = ed.problems.map((p) => `${p.rule}: ${p.value}`).join('\n');
    const axe = q('#mockup-axe');
    axe.classList.toggle('hidden', !ed.axe);
    if (ed.axe) {
      const v = ed.axe.violations || [];
      axe.className = `badge ${ed.axe.error || v.length ? 'warning' : 'success'}`;
      axe.textContent = v.length ? t('mockups.axe_problems', { count: v.length }) : t('mockups.axe_clean');
      axe.title = ed.axe.error || v.map((x) => `${x.id} (${x.impact || '—'}, ${x.nodes}): ${x.help}`).join('\n');
    }
  }

  // D15/Q-8: the next turn's estimate and the chat's total, in the chat's head slot
  function renderCost() {
    const box = ed.chat?.slot?.('head');
    if (!box) return;
    const e = window.MockupModel.estimateCost('chat-edit');
    const estimate = t('mockups.estimate', { min: money(e.min), max: money(e.max), model: e.model || '—' });
    box.innerHTML = `<p class="muted small mockup-chat-cost" data-testid="mockup-chat-cost">${esc(t('mockups.chat_cost', { estimate, total: money(ed.totalUsd) }))}</p>`;
  }

  function renderVersions() {
    const list = q('#mockup-versions');
    if (!list) return;
    list.innerHTML = ed.versions.map((v, i) => `
      <li class="row">
        <span class="mono small" title="${esc(v.commit)}">${esc(String(v.commit).slice(0, 7))}</span>
        <span class="small mockup-version-msg" title="${esc(v.message || '')}">${esc(v.message || '')}</span>
        ${i === 0 ? `<span class="badge neutral">${t('mockups.current')}</span>` : `<button type="button" class="btn sm ghost" data-mockup-restore="${esc(v.commit)}">${t('mockups.restore')}</button>`}
        <button type="button" class="btn sm ghost" data-testid="mockup-attach" data-mockup-attach="${esc(v.commit)}" aria-label="${esc(t('mockups.attach_named', { commit: String(v.commit).slice(0, 7) }))}">${t('mockups.attach')}</button>
      </li>`).join('');
  }

  // ---- #835 flows: link the selected element to another screen; Interact follows the links ---------
  function renderFlows() {
    const box = q('#mockup-flows');
    if (!box) return;
    const others = ed.screens.filter((s) => s.slug !== ed.slug);
    const links = (ed.flow?.links || []).filter((l) => l.from.screen === ed.slug);
    const one = ed.selection.length === 1;
    box.innerHTML = `
      <div class="row mockup-flows-pick">
        <label class="sr-only" for="mockup-flow-select">${t('mockups.flows')}</label>
        <select id="mockup-flow-select" data-testid="mockup-flow-select">
          <option value="">${t('mockups.flow_none')}</option>
          ${ed.flows.map((f) => `<option value="${esc(f.name)}"${ed.flow?.name === f.name ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn sm ghost" data-testid="mockup-flow-new" data-mockup-flow-new>${t('mockups.flow_new')}</button>
      </div>
      ${ed.flow ? `
        <ul class="mockup-flow-links small">${links.length ? links.map((l) => `<li><span class="mono">${esc(l.from.mid)}</span> → ${esc(l.to)}</li>`).join('') : `<li class="muted">${t('mockups.flow_no_links')}</li>`}</ul>
        <div class="row mockup-flows-pick">
          <label class="sr-only" for="mockup-link-target">${t('mockups.link_to')}</label>
          <select id="mockup-link-target" data-testid="mockup-link-target"${others.length ? '' : ' disabled'}>
            ${others.map((s) => `<option value="${esc(s.slug)}">${esc(s.title || s.slug)}</option>`).join('')}
          </select>
          <button type="button" class="btn sm" data-testid="mockup-link" data-mockup-link${one && others.length ? '' : ' disabled'} title="${esc(t('mockups.link_help'))}">${t('mockups.link_selection')}</button>
        </div>` : `<p class="muted small">${t('mockups.flow_help')}</p>`}`;
  }

  async function chooseFlow(name) {
    try { ed.flow = name ? await api.readMockupFlow(ed.projectId, name) : null; } catch (e) { errorLine(errMsg(e)); ed.flow = null; }
    renderFlows();
  }

  async function linkSelection() {
    const to = q('#mockup-link-target')?.value;
    const mid = ed.selection[0]?.mid;
    if (!ed.flow || !to || !mid) return;
    const links = [...ed.flow.links.filter((l) => !(l.from.screen === ed.slug && l.from.mid === mid)), { from: { screen: ed.slug, mid }, to }];
    try {
      await api.saveMockupFlow(ed.projectId, ed.flow.name, links);
      ed.flow = { name: ed.flow.name, links };
      showToast(t('mockups.linked', { mid, to }), ed.flow.name);
      renderFlows();
    } catch (e) { errorLine(errMsg(e)); }
  }

  function toggleInteract() {
    ed.mode = ed.mode === 'interact' ? 'select' : 'interact';
    if (ed.mode === 'interact') { ed.selection = []; renderChips(); }
    postMode();
    renderTools();
  }

  // ---- #835 Compare: the two latest versions side by side, the changed data-mids highlighted --------
  async function openCompare() {
    const [newer, older] = ed.versions;
    if (!newer || !older) return;
    try {
      const r = await api.compareMockupVersions(ed.projectId, ed.slug, older.commit, newer.commit);
      ed.compare = { from: older.commit, to: newer.commit, changed: Array.isArray(r?.changed) ? r.changed : [] };
    } catch (e) { errorLine(errMsg(e)); return; }
    const side = (id, commit, label) => `
      <figure class="mockup-compare-side">
        <figcaption class="small"><span class="muted">${label}</span> <span class="mono">${esc(String(commit).slice(0, 7))}</span></figcaption>
        <iframe class="mockup-compare-frame" data-testid="${id}" sandbox="allow-scripts" title="${esc(`${label} ${String(commit).slice(0, 7)}`)}" src="${screenUrl(`?at=${encodeURIComponent(commit)}`)}"></iframe>
      </figure>`;
    const box = q('#mockup-compare');
    box.innerHTML = `
      <div class="row mockup-compare-head">
        <span class="badge ${ed.compare.changed.length ? 'warning' : 'neutral'}">${t('mockups.compare_changed', { count: ed.compare.changed.length })}</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm ghost" data-testid="mockup-compare-close" data-mockup-compare-close>${t('mockups.compare_close')}</button>
      </div>
      <div class="mockup-compare-sides">${side('mockup-compare-before', older.commit, t('mockups.compare_before'))}${side('mockup-compare-after', newer.commit, t('mockups.compare_after'))}</div>`;
    box.querySelectorAll('iframe').forEach((f) => f.addEventListener('load', () => f.contentWindow?.postMessage({ type: 'mockup:highlight', mids: ed.compare?.changed || [] }, '*')));
    box.classList.remove('hidden');
    q('#mockup-canvas').classList.add('hidden');
  }

  function closeCompare() {
    ed.compare = null;
    const box = q('#mockup-compare');
    if (box) { box.innerHTML = ''; box.classList.add('hidden'); }
    q('#mockup-canvas')?.classList.remove('hidden');
  }

  // ---- #835 the name dialog: New variant, Promote to kit, New flow --------------------------------
  const DIALOGS = {
    variant: { title: 'mockups.variant_new', submit: 'mockups.create', help: 'mockups.variant_help' },
    promote: { title: 'mockups.promote', submit: 'mockups.promote_submit', help: 'mockups.promote_help' },
    flow: { title: 'mockups.flow_new', submit: 'mockups.create', help: 'mockups.flow_name_help' },
  };
  function openNameDialog(kind) {
    ed.dialog = kind;
    const d = DIALOGS[kind];
    q('#mockup-name-heading').textContent = t(d.title);
    q('#mockup-name-submit').textContent = t(d.submit);
    q('#mockup-name-help').textContent = t(d.help);
    q('#mockup-name-input').value = '';
    q('#mockup-name-error').textContent = '';
    openModal('#mockup-name-dialog');
    q('#mockup-name-input').focus({ preventScroll: true });
  }

  async function submitName(e) {
    e.preventDefault();
    const name = q('#mockup-name-input').value.trim();
    if (!name) { q('#mockup-name-error').textContent = t('mockups.give_a_name'); return; }
    try {
      if (ed.dialog === 'variant') {
        await api.createMockupVariant(ed.projectId, name);
        showToast(t('mockups.variant_created', { name }), ed.slug);
      } else if (ed.dialog === 'promote') {
        await api.promoteMockupToKit(ed.projectId, ed.slug, ed.selection[0]?.mid, name);
        showToast(t('mockups.promoted', { name }), ed.slug);
        ed.selection = [];
        renderChips();
      } else if (ed.dialog === 'flow') {
        const out = await api.saveMockupFlow(ed.projectId, name, []);
        ed.flow = { name: String(out?.file || name).replace(/^flows\/|\.json$/g, ''), links: [] };
      }
      closeModal('#mockup-name-dialog');
      await load(ed.projectId, ed.slug, { bust: String(Date.now()) });
    } catch (x) { q('#mockup-name-error').textContent = errMsg(x); }
  }

  async function switchVariant(name) {
    try {
      await api.switchMockupVariant(ed.projectId, name);
      await load(ed.projectId, ed.slug, { bust: `${name}-${Date.now()}` });
    } catch (e) { errorLine(errMsg(e)); }
  }

  // keep the current variant: it cannot be undone (the other branches are deleted), so it asks first
  async function keepVariant() {
    const name = ed.variant;
    const ask = typeof confirmDialog === 'function' ? confirmDialog : (title, message) => Promise.resolve(window.confirm(`${title}\n${message}`));
    if (!await ask(t('mockups.keep_variant'), t('mockups.keep_variant_confirm', { name }), t('mockups.keep_variant'))) return;
    try {
      await api.keepMockupVariant(ed.projectId, name);
      showToast(t('mockups.variant_kept', { name }), ed.slug);
      await load(ed.projectId, ed.slug, { bust: `keep-${Date.now()}` });
    } catch (e) { errorLine(errMsg(e)); }
  }

  // ---- #835 attach a version (frozen) to a Discovery card ------------------------------------------
  async function openAttach(commit) {
    ed.attach = commit;
    q('#mockup-attach-error').textContent = '';
    let cards = [];
    try { cards = await api.listDiscoveryCards?.(ed.projectId) || []; } catch (e) { q('#mockup-attach-error').textContent = errMsg(e); }
    q('#mockup-attach-card').innerHTML = cards.length
      ? cards.map((c) => `<option value="${esc(c.id)}">${esc(c.title || c.id)}</option>`).join('')
      : `<option value="">${t('mockups.attach_no_cards')}</option>`;
    openModal('#mockup-attach-dialog');
    q('#mockup-attach-card').focus({ preventScroll: true });
  }

  async function submitAttach(e) {
    e.preventDefault();
    const cardId = q('#mockup-attach-card').value;
    if (!cardId) { q('#mockup-attach-error').textContent = t('mockups.attach_no_cards'); return; }
    try {
      const att = await api.mockupAttachment(ed.projectId, ed.slug, ed.attach);
      const bytes = new TextEncoder().encode(JSON.stringify(att, null, 2));
      const data = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
      await api.addDiscoveryAttachment(ed.projectId, cardId, undefined, att.name, data);
      closeModal('#mockup-attach-dialog');
      showToast(t('mockups.attached', { commit: String(att.commit).slice(0, 7) }), att.name);
    } catch (x) { q('#mockup-attach-error').textContent = errMsg(x); }
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
      </span>`).join('')
      // #835 one selected element can become a kit component
      + (ed.selection.length === 1 ? `<button type="button" class="btn sm ghost" data-testid="mockup-promote" data-mockup-promote>${t('mockups.promote')}</button>` : '');
    renderFlows();
  }

  function onMessage(e) {
    const canvas = q('#mockup-canvas');
    if (!canvas || e.source !== canvas.contentWindow) return;
    if (e.data?.type === 'mockup:axe') { ed.axe = { violations: Array.isArray(e.data.violations) ? e.data.violations : [], error: e.data.error || null }; renderHead(); return; }
    // #835 Interact mode: the chosen flow says where a click on this element goes
    if (e.data?.type === 'mockup:navigate') {
      const to = ed.mode === 'interact' ? window.MockupModel.flowTarget(ed.flow, ed.slug, String(e.data.mid || '')) : null;
      if (to) load(ed.projectId, to);
      return;
    }
    if (e.data?.type !== 'mockup:select' || !e.data.mid) return;
    const { mid, selector, kit, text, box, html, add } = e.data;
    const picked = { mid: String(mid), selector, kit: kit || null, text, box, html };
    const at = ed.selection.findIndex((s) => s.mid === picked.mid);
    if (!add) ed.selection = [picked];
    else if (at >= 0) ed.selection.splice(at, 1);
    else ed.selection.push(picked);
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
    closeCompare();
    try {
      const [versions, history, variants, flows, screens] = await Promise.all([
        api.listMockupVersions(projectId, slug),
        api.readMockupChat(projectId, slug),
        api.listMockupVariants?.(projectId),
        api.listMockupFlows?.(projectId),
        api.listMockups?.(projectId),
      ]);
      ed.versions = Array.isArray(versions) ? versions : [];
      ed.totalUsd = window.MockupModel.chatCostUsd(history);
      ed.chat?.setMessages(Array.isArray(history) ? history : []);
      ed.variant = variants?.current || 'main';
      ed.variants = Array.isArray(variants?.variants) ? variants.variants : [];
      ed.flows = Array.isArray(flows) ? flows : [];
      ed.screens = Array.isArray(screens) ? screens : [];
      if (ed.flow && !ed.flows.some((f) => f.name === ed.flow.name)) ed.flow = null;
    } catch (e) { errorLine(errMsg(e)); }
    ed.axe = null; // the new version's axe comes from the canvas
    if (canvas) canvas.src = canvasUrl(bust || ed.versions[0]?.commit || '');
    renderHead();
    renderCost();
    renderVersions();
    renderFlows();
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
    if (frame) { ed.frame = frame.dataset.mockupFrame; applyFrame(); reloadCanvas(); return; }
    const back = e.target.closest('[data-mockup-restore]');
    if (back) { restore(back.dataset.mockupRestore); return; }
    const un = e.target.closest('[data-mockup-unselect]');
    if (un) { ed.selection.splice(Number(un.dataset.mockupUnselect), 1); renderChips(); return; }
    const variant = e.target.closest('[data-mockup-variant]');
    if (variant) { if (variant.dataset.mockupVariant !== ed.variant) switchVariant(variant.dataset.mockupVariant); return; }
    const attach = e.target.closest('[data-mockup-attach]');
    if (attach) { openAttach(attach.dataset.mockupAttach); return; }
    const actions = {
      mockupVariantNew: () => openNameDialog('variant'),
      mockupVariantKeep: keepVariant,
      mockupCompare: openCompare,
      mockupCompareClose: closeCompare,
      mockupInteract: toggleInteract,
      mockupPromote: () => openNameDialog('promote'),
      mockupFlowNew: () => openNameDialog('flow'),
      mockupLink: linkSelection,
      mockupNameCancel: () => closeModal('#mockup-name-dialog'),
      mockupAttachCancel: () => closeModal('#mockup-attach-dialog'),
    };
    const hit = Object.keys(actions).find((k) => e.target.closest(`[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`));
    if (hit) actions[hit]();
  }

  function onChange(e) {
    if (e.target.id === 'mockup-flow-select') chooseFlow(e.target.value);
  }

  function mount(el) {
    ed.root = el;
    ed.frame = window.MockupModel.DEFAULT_FRAME;
    el.innerHTML = markup();
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    q('#mockup-name-form').addEventListener('submit', submitName);
    q('#mockup-attach-form').addEventListener('submit', submitAttach);
    q('#mockup-canvas').addEventListener('load', postMode);
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
