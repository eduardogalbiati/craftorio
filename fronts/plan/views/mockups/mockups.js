/* global api */
// Mockups screen (#625, Plan & Design › Mockups, D1): the header's project's mockup screens, kept in
// <workspace>/mockups/<projectId>/ (the mockups: channels, fronts/plan/engine/channels/mockups.js). What leads:
// the screens by title (the gallery, one card each, Open → the editor window, mockups:open-editor; the
// editor is fronts/plan/views/mockups/mockup-editor.js). Before the visual kit and the first screen, the
// empty state says what to do next: Build the visual kit (the deterministic machine step, then the
// ui-kit-map workflow when real) with its D15 estimate shown first (mockups:estimate, build-kit:
// $1.50–$4.00). New mockup is a dialog (Title, Prompt, Create) with the generate-screen estimate; the
// simulated designer (MULTIAGENT_SIMULATION_ONLY) writes the screen at once, a real one starts a
// mockup-generate run. A Discovery card's "Mock this card" calls MockupsActions.fromCard.
// #835: once the kit exists, a tablist Gallery | Kit; the Kit tab lists the components (name, file:line
// source, a live preview: a sandboxed iframe on mockup://<id>/kit/components.html#c-<slug>), the tokens
// (a swatch for a colour) and the inferred gaps (kit.json inferences, not a gate); Export .zip
// (mockups:export, base64 → a Blob download).
// #836: Recreate from the running app opens the same dialog in recreate mode (Title, an optional app page,
// the recreate-screen estimate first) → mockups:recreate (refused without Run App / Local preview). In
// the main window, the editor's handoff (AgentsWindow.onNavigate): 'mockups:start-run' opens the Start
// panel (openDrawer) with the `mockup` input filled, never a run; 'mockups:prepare-issues' opens the #258
// commit dialog (DiscoveryCommit.open) of the Discovery card the mockup is attached to, with the crops.
// Test ids: mockups-view, mockups-empty, mockups-build-kit, mockups-new, mockups-gallery, mockups-card,
// mockups-open, mockups-new-dialog, mockups-kit, mockups-gallery-tab, mockups-kit-tab, mockups-kit-panel,
// mockups-kit-token, mockups-kit-component, mockups-kit-preview, mockups-export, mockup-recreate-from-app.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, api, errMsg,
// openModal, closeModal, showToast, showView), MockupModel (packages/shared/mockup-model.js), CurrentProject.
(() => {
  // projectId: the header's; screens: mockups:list's rows; kit: mockups:kit (null before it is built)
  // tab: 'gallery' or 'kit' (#835); dialog: what the New mockup dialog does, 'new' or 'recreate' (#836)
  const mk = { projectId: null, screens: [], kit: null, seq: 0, busy: false, tab: 'gallery', dialog: 'new' };
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M3 8h18M8 21h8M12 18v3" /></svg>';

  const currentProjectId = async () => (await (window.CurrentProject?.resolve?.() ?? window.CurrentProject?.get?.())) || null;
  const errorLine = (msg) => { const p = $('#mockups-error'); if (p) p.textContent = msg || ''; };
  const money = (n) => (window.I18n?.formatCost ? window.I18n.formatCost(n) : `$${(Number(n) || 0).toFixed(2)}`);

  // D15: the estimate of an action from the service (the page's MockupModel when it has none)
  async function estimate(action) {
    let e = null;
    try { e = await api.estimateMockupCost?.(action); } catch { e = null; }
    return e || window.MockupModel?.estimateCost?.(action) || { model: null, min: 0, max: 0 };
  }
  const estimateText = (e) => t('mockups.estimate', { min: money(e.min), max: money(e.max), model: e.model || '—' });

  // ---- the page ---------------------------------------------------------------------------------
  async function refresh() {
    const seq = ++mk.seq;
    const projectId = await currentProjectId();
    let screens = [];
    let kit = null;
    let error = '';
    if (projectId) {
      try {
        [screens, kit] = await Promise.all([api.listMockups(projectId), api.readMockupKit?.(projectId) ?? null]);
      } catch (e) { error = errMsg(e); }
    }
    const kitEstimate = await estimate('build-kit');
    if (seq !== mk.seq) return; // a newer refresh answers
    Object.assign(mk, { projectId, screens: Array.isArray(screens) ? screens : [], kit: kit || null });
    errorLine(error);
    render(kitEstimate);
  }

  function emptyHtml(kitEstimate) {
    return `
      <div class="mockups-empty" data-testid="mockups-empty">
        <h2>${t('mockups.no_mockups_yet')}</h2>
        <p class="muted">${t('mockups.empty_next_step')}</p>
        <p class="mockups-estimate small"><span class="badge neutral">${esc(estimateText(kitEstimate))}</span> <span class="muted">${t('mockups.free_when_simulated')}</span></p>
        <button type="button" class="btn primary" data-testid="mockups-build-kit" data-mockups-build-kit>${t('mockups.build_the_visual_kit')}</button>
      </div>`;
  }

  // the kit's line above the gallery: its token count, or Build with its estimate
  function kitHtml(kitEstimate) {
    const tokens = mk.kit?.kit?.tokens?.length ?? 0;
    const body = mk.kit
      ? `<span class="badge success">${t('mockups.kit_ready')}</span> <span class="muted small">${t('mockups.kit_tokens', { count: tokens })}</span>`
      : `<span class="badge neutral">${t('mockups.no_kit')}</span> <span class="muted small">${esc(estimateText(kitEstimate))}</span>
         <button type="button" class="btn sm" data-testid="mockups-build-kit" data-mockups-build-kit>${t('mockups.build_the_visual_kit')}</button>`;
    return `<div class="mockups-kit row" data-testid="mockups-kit">${body}</div>`;
  }

  function cardHtml(s) {
    const title = String(s.title || s.slug);
    const initial = esc(title.trim().charAt(0).toUpperCase() || '?');
    return `
      <article class="mockups-card" data-testid="mockups-card" data-slug="${esc(s.slug)}">
        <div class="mockups-thumb" aria-hidden="true">${initial}</div>
        <div class="mockups-card-body">
          <h3 class="mockups-card-title" title="${esc(title)}">${esc(title)}</h3>
          <p class="muted small mono" title="${esc(s.slug)}">${esc(s.slug)}</p>
        </div>
        <button type="button" class="btn sm" data-testid="mockups-open" data-mockups-open="${esc(s.slug)}" aria-label="${esc(t('mockups.open_named', { title }))}">${t('mockups.open')}</button>
      </article>`;
  }

  // ---- #835 the Kit tab: components with a live preview, tokens, inferred gaps (not a gate) ----------
  // the model's colour rule, anchored: a token whose whole value is a colour
  const isColor = (value) => {
    const color = window.MockupModel?.COLOR;
    return !!color && new RegExp(`^(?:${color.source})$`, 'i').test(value);
  };
  function kitPanelHtml() {
    const kit = mk.kit?.kit || {};
    const tokens = Array.isArray(kit.tokens) ? kit.tokens : [];
    const components = Array.isArray(kit.components) ? kit.components.filter((c) => c?.name) : [];
    const gaps = Array.isArray(kit.inferences) ? kit.inferences : [];
    const gallery = `mockup://${encodeURIComponent(mk.projectId)}/kit/components.html`;
    const slug = (name) => window.MockupModel?.slugify?.(name) || '';
    const comp = (c) => `
      <article class="mockups-kit-component" data-testid="mockups-kit-component">
        <div class="mockups-kit-component-head">
          <h4 title="${esc(c.name)}">${esc(c.name)}</h4>
          ${c.source ? `<span class="muted small mono" title="${esc(c.source)}">${esc(c.source)}</span>` : ''}
        </div>
        <iframe class="mockups-kit-preview" data-testid="mockups-kit-preview" sandbox="allow-scripts" loading="lazy" tabindex="-1"
          title="${esc(t('mockups.kit_preview_of', { name: c.name }))}" src="${gallery}#c-${esc(slug(c.name))}"></iframe>
      </article>`;
    const token = (tk) => `<li class="mockups-kit-token" data-testid="mockups-kit-token" title="${esc(`${tk.name}: ${tk.value}${tk.file ? ` (${tk.file}:${tk.line})` : ''}`)}">`
      + `${isColor(String(tk.value || '').trim()) ? `<span class="mockups-swatch" style="background:${esc(tk.value)}" aria-hidden="true"></span>` : ''}`
      + `<span class="mono small">${esc(tk.name)}</span> <span class="muted small mono">${esc(tk.value)}</span></li>`;
    return `
      <div class="mockups-kit-panel" role="tabpanel" id="mockups-kit-panel" aria-labelledby="mockups-tab-kit" data-testid="mockups-kit-panel">
        <h3>${t('mockups.kit_components', { count: components.length })}</h3>
        ${components.length ? `<div class="mockups-kit-components">${components.map(comp).join('')}</div>` : `<p class="muted small">${t('mockups.kit_no_components')}</p>`}
        <h3>${t('mockups.kit_tokens', { count: tokens.length })}</h3>
        ${tokens.length ? `<ul class="mockups-kit-tokens">${tokens.map(token).join('')}</ul>` : `<p class="muted small">${t('mockups.kit_no_tokens')}</p>`}
        <h3>${t('mockups.kit_inferences')}</h3>
        ${gaps.length ? `<ul class="mockups-kit-gaps small">${gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : `<p class="muted small">${t('mockups.kit_no_inferences')}</p>`}
      </div>`;
  }

  function tabsHtml() {
    const tab = (id, label) => `<button type="button" role="tab" id="mockups-tab-${id}" class="tab${mk.tab === id ? ' active' : ''}" aria-selected="${mk.tab === id}" aria-controls="mockups-${id}-panel" data-mockups-tab="${id}"${id === 'kit' ? ' data-testid="mockups-kit-tab"' : ' data-testid="mockups-gallery-tab"'}>${label}</button>`;
    return `<div class="tabs mockups-tabs" role="tablist" aria-label="${t('mockups.mockups')}">${tab('gallery', t('mockups.gallery_tab'))}${tab('kit', t('mockups.kit_tab'))}</div>`;
  }

  function render(kitEstimate) {
    const body = $('#mockups-body');
    if (!body) return;
    if (!mk.projectId) { body.innerHTML = `<p class="muted">${t('mockups.choose_a_project')}</p>`; return; }
    if (!mk.kit && !mk.screens.length) { body.innerHTML = emptyHtml(kitEstimate); return; }
    const gallery = mk.screens.length
      ? `<div class="mockups-gallery" data-testid="mockups-gallery">${mk.screens.map(cardHtml).join('')}</div>`
      : `<p class="muted">${t('mockups.no_screens_yet')}</p>`;
    const panel = mk.tab === 'kit' && mk.kit
      ? kitPanelHtml()
      : `<div role="tabpanel" id="mockups-gallery-panel" aria-labelledby="mockups-tab-gallery">${gallery}</div>`;
    body.innerHTML = `<div class="row mockups-bar">${mk.kit ? tabsHtml() : ''}${kitHtml(kitEstimate)}
        ${mk.screens.length ? `<button type="button" class="btn sm ghost" data-testid="mockups-export" data-mockups-export>${t('mockups.export_zip')}</button>` : ''}</div>
      ${panel}`;
  }

  // #835 the static .zip export (screens, kit, flows), saved as a file by the page
  async function exportZip() {
    try {
      const b64 = await api.exportMockupsZip(mk.projectId);
      const bytes = Uint8Array.from(atob(String(b64 || '')), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `mockups-${mk.projectId}.zip` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(t('mockups.exported'), `mockups-${mk.projectId}.zip`);
    } catch (e) { errorLine(errMsg(e)); }
  }

  // ---- actions ----------------------------------------------------------------------------------
  async function buildKit() {
    if (mk.busy || !mk.projectId) return;
    mk.busy = true;
    try {
      const out = await api.buildMockupKit(mk.projectId);
      showToast(t('mockups.kit_built'), t('mockups.kit_tokens', { count: out?.tokens ?? 0 }));
      await refresh();
    } catch (e) { errorLine(errMsg(e)); } finally { mk.busy = false; }
  }

  async function openEditor(slug) {
    try {
      const out = await api.openMockupEditor(mk.projectId, slug);
      if (out && out.opened === false) showToast(t('mockups.editor_desktop_only'), slug);
    } catch (e) { errorLine(errMsg(e)); }
  }

  // the New mockup dialog, or (#836) its recreate mode: a page of the running app, an optional url
  async function openNew(mode = 'new') {
    const recreate = mode === 'recreate';
    mk.dialog = recreate ? 'recreate' : 'new';
    $('#mockups-new-heading').textContent = recreate ? t('mockups.recreate_from_app') : t('mockups.new_mockup');
    $('#mockups-new-prompt-field').classList.toggle('hidden', recreate);
    $('#mockups-new-url-field').classList.toggle('hidden', !recreate);
    $('#mockups-new-title').value = '';
    $('#mockups-new-prompt').value = '';
    $('#mockups-new-url').value = '';
    $('#mockups-new-error').textContent = '';
    $('#mockups-new-estimate').textContent = estimateText(await estimate(recreate ? 'recreate-screen' : 'generate-screen'));
    openModal('#mockups-new-dialog');
    $('#mockups-new-title').focus({ preventScroll: true });
  }

  async function create({ projectId, title, prompt, source = null }) {
    const out = await api.createMockupScreen(projectId, title, prompt, source);
    showToast(t('mockups.created', { title }), out?.runId ? t('mockups.designer_started') : '');
    return out;
  }

  async function submitNew(e) {
    e.preventDefault();
    if (mk.busy) return;
    const title = $('#mockups-new-title').value.trim();
    const prompt = $('#mockups-new-prompt').value.trim();
    if (!title) { $('#mockups-new-error').textContent = t('mockups.give_a_title'); return; }
    mk.busy = true;
    try {
      const projectId = mk.projectId || await currentProjectId();
      if (mk.dialog === 'recreate') {
        const out = await api.recreateMockupFromApp(projectId, title, $('#mockups-new-url').value.trim());
        showToast(t('mockups.created', { title }), out?.runId ? t('mockups.designer_started') : '');
      } else await create({ projectId, title, prompt });
      closeModal('#mockups-new-dialog');
      await refresh();
    } catch (x) { $('#mockups-new-error').textContent = errMsg(x); } finally { mk.busy = false; }
  }

  function onBodyClick(e) {
    if (e.target.closest('[data-mockups-build-kit]')) return buildKit();
    if (e.target.closest('[data-mockups-export]')) return exportZip();
    const tab = e.target.closest('[data-mockups-tab]');
    if (tab) { mk.tab = tab.dataset.mockupsTab; render(null); $(`#mockups-tab-${mk.tab}`)?.focus({ preventScroll: true }); return undefined; }
    const open = e.target.closest('[data-mockups-open]');
    if (open) return openEditor(open.dataset.mockupsOpen);
    return undefined;
  }

  // ---- #836 the editor window's handoff, run in the main window ------------------------------------
  // Start a development run: the Start panel (openDrawer, read at call time) with the project and the
  // `mockup` input filled; it never starts a run
  // with the remembered workflow when it declares `mockup`, else feature.yaml (the drawer drops an input
  // its workflow does not declare)
  async function openStartRun(target) {
    let workflow = 'feature.yaml';
    try {
      const [settings, workflows] = await Promise.all([api.getSettings(), api.listWorkflows()]);
      const last = (workflows || []).find((w) => w?.file === settings?.lastWorkflow);
      if (last?.inputs?.mockup) workflow = last.file;
    } catch { /* the default */ }
    window.openDrawer?.({ project: target?.projectId || null, workflow, inputs: target?.inputs || {} });
  }

  // Prepare issues: the #258 commit dialog of the Discovery card the mockup is attached to, with the crops
  async function openPrepareIssues(target) {
    const { projectId, slug, commit, crops = [] } = target || {};
    try {
      const cards = await api.listDiscoveryCards(projectId);
      const attachedTo = (c, exact) => (c.attachments || []).some((n) => {
        const a = window.MockupModel?.parseAttachmentName?.(n);
        return a && a.slug === slug && (!exact || String(commit || '').startsWith(a.commit));
      });
      const attached = (cards || []).filter((c) => attachedTo(c, false));
      if (!attached.length) { showToast(t('mockups.prepare_needs_card'), slug || ''); return; }
      // only a Ready card can be committed (#258): the exact version first
      const ready = attached.filter((c) => c.column === 'ready');
      const card = ready.find((c) => attachedTo(c, true)) || ready[0];
      if (!card) { showToast(t('mockups.prepare_needs_ready'), attached[0].title || slug || ''); return; }
      showView('discovery');
      window.DiscoveryCommit?.open?.({ projectId, card, crops, done: (out, problems) => window.DiscoveryActions?.committed?.(out, problems) });
    } catch (e) { showToast(errMsg(e), slug || ''); }
  }

  // D5: a Discovery card's "Mock this card" (views/discovery/discovery.js): a screen from its title and text
  window.MockupsActions = {
    fromCard: async ({ projectId, cardId, title, text = '' }) => {
      const out = await create({ projectId, title, prompt: text, source: { kind: 'discovery', card: cardId || null } });
      if (projectId && window.CurrentProject?.get?.() !== projectId) window.CurrentProject?.set?.(projectId, { redraw: false });
      showView('mockups');
      return out;
    },
  };

  registerView({
    id: 'mockups',
    nav: { label: 'Mockups', order: 117, group: 'plan', title: 'Draw high-fidelity screens of the project and edit them with the designer', icon: ICON },
    markup: () => `
      <section id="view-mockups" class="view hidden" data-testid="mockups-view">
        <div class="page-head">
          <div>
            <h1>${t('mockups.mockups')}</h1>
            <p class="muted small">${t('mockups.subtitle')}</p>
          </div>
          <div class="row">
            <button type="button" id="btn-mockups-recreate" class="btn" data-testid="mockup-recreate-from-app">${t('mockups.recreate_from_app')}</button>
            <button type="button" id="btn-mockups-new" class="btn primary" data-testid="mockups-new">${t('mockups.new_mockup')}</button>
          </div>
        </div>
        <p id="mockups-error" class="error small" role="alert"></p>
        <div id="mockups-body" class="mockups-body"></div>
        <div id="mockups-new-dialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="mockups-new-heading" data-testid="mockups-new-dialog">
          <form id="mockups-new-form" class="modal-card mockups-new-form">
            <h3 id="mockups-new-heading">${t('mockups.new_mockup')}</h3>
            <label for="mockups-new-title">${t('mockups.title')}</label>
            <input id="mockups-new-title" type="text" maxlength="200" autocomplete="off" />
            <div id="mockups-new-prompt-field" class="mockups-new-field">
              <label for="mockups-new-prompt">${t('mockups.prompt')}</label>
              <textarea id="mockups-new-prompt" rows="5" maxlength="20000" placeholder="${t('mockups.prompt_placeholder')}"></textarea>
            </div>
            <div id="mockups-new-url-field" class="mockups-new-field hidden">
              <label for="mockups-new-url">${t('mockups.app_page')}</label>
              <input id="mockups-new-url" type="text" maxlength="2000" autocomplete="off" placeholder="http://localhost:3000/orders" />
              <p class="muted small">${t('mockups.recreate_needs_preview')}</p>
            </div>
            <p id="mockups-new-estimate" class="muted small"></p>
            <p id="mockups-new-error" class="error small" role="alert"></p>
            <div class="modal-actions">
              <button type="button" id="btn-mockups-new-cancel" class="btn ghost">${t('common.cancel')}</button>
              <button type="submit" class="btn primary">${t('mockups.create')}</button>
            </div>
          </form>
        </div>
      </section>`,
    mount() {
      $('#btn-mockups-new').onclick = () => openNew('new');
      $('#btn-mockups-recreate').onclick = () => openNew('recreate');
      window.AgentsWindow?.onNavigate?.('mockups:start-run', openStartRun);
      window.AgentsWindow?.onNavigate?.('mockups:prepare-issues', openPrepareIssues);
      $('#mockups-body').onclick = onBodyClick;
      $('#mockups-new-form').onsubmit = submitNew;
      $('#btn-mockups-new-cancel').onclick = () => closeModal('#mockups-new-dialog');
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('#mockups-new-dialog').classList.contains('hidden')) closeModal('#mockups-new-dialog');
      });
    },
    // the header's project changed: CurrentProject shows this screen again, so it follows
    show: () => refresh(),
  });
})();
