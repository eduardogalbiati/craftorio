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
// Test ids: mockups-view, mockups-empty, mockups-build-kit, mockups-new, mockups-gallery, mockups-card,
// mockups-open, mockups-new-dialog, mockups-kit.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, api, errMsg,
// openModal, closeModal, showToast, showView), MockupModel (packages/shared/mockup-model.js), CurrentProject.
(() => {
  // projectId: the header's; screens: mockups:list's rows; kit: mockups:kit (null before it is built)
  const mk = { projectId: null, screens: [], kit: null, seq: 0, busy: false };
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

  function render(kitEstimate) {
    const body = $('#mockups-body');
    if (!body) return;
    if (!mk.projectId) { body.innerHTML = `<p class="muted">${t('mockups.choose_a_project')}</p>`; return; }
    if (!mk.kit && !mk.screens.length) { body.innerHTML = emptyHtml(kitEstimate); return; }
    body.innerHTML = `${kitHtml(kitEstimate)}
      ${mk.screens.length
    ? `<div class="mockups-gallery" data-testid="mockups-gallery">${mk.screens.map(cardHtml).join('')}</div>`
    : `<p class="muted">${t('mockups.no_screens_yet')}</p>`}`;
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

  async function openNew() {
    $('#mockups-new-title').value = '';
    $('#mockups-new-prompt').value = '';
    $('#mockups-new-error').textContent = '';
    $('#mockups-new-estimate').textContent = estimateText(await estimate('generate-screen'));
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
      await create({ projectId: mk.projectId || await currentProjectId(), title, prompt });
      closeModal('#mockups-new-dialog');
      await refresh();
    } catch (x) { $('#mockups-new-error').textContent = errMsg(x); } finally { mk.busy = false; }
  }

  function onBodyClick(e) {
    if (e.target.closest('[data-mockups-build-kit]')) return buildKit();
    const open = e.target.closest('[data-mockups-open]');
    if (open) return openEditor(open.dataset.mockupsOpen);
    return undefined;
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
          <button type="button" id="btn-mockups-new" class="btn primary" data-testid="mockups-new">${t('mockups.new_mockup')}</button>
        </div>
        <p id="mockups-error" class="error small" role="alert"></p>
        <div id="mockups-body" class="mockups-body"></div>
        <div id="mockups-new-dialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="mockups-new-heading" data-testid="mockups-new-dialog">
          <form id="mockups-new-form" class="modal-card mockups-new-form">
            <h3 id="mockups-new-heading">${t('mockups.new_mockup')}</h3>
            <label for="mockups-new-title">${t('mockups.title')}</label>
            <input id="mockups-new-title" type="text" maxlength="200" autocomplete="off" />
            <label for="mockups-new-prompt">${t('mockups.prompt')}</label>
            <textarea id="mockups-new-prompt" rows="5" maxlength="20000" placeholder="${t('mockups.prompt_placeholder')}"></textarea>
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
      $('#btn-mockups-new').onclick = openNew;
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
