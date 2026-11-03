/* global api */
// #486: the "Workflows" block of a project's page (Projects › Overview, views/project/project.js), with
// the repository manifest's errors (.multiagent/project.yaml, api.projectManifest). #741: the old Create
// Project dialog's block went with the dialog (creating is the wizard only, its step 3 suggests the workflows).
// #729: the Overview shows only the project's workflows, one card each (pj-wf-card: name, category,
// the wizard's variant and CI pick, a clamped description, the Default badge, Make default / Remove),
// and "+ Add a workflow" (pj-wf-add) opens a dialog (pj-wf-add-dialog) of the installed workflows not on
// the project, by category, with a search; each action saves (api.updateProject: workflows, defaultWorkflow).
// Uses app.js globals ($, esc, t, state, errMsg, showToast), workflows.js's
// WF_SECTIONS, wfSectionOf and wfSectionName, DefaultWorkflow.firstBuild
// (the default's rule, shared with packages/engine/domains/project/projects.js) and OnboardingModel's
// variant labels (packages/shared/onboarding-model.js).

window.ProjectWorkflows = (() => {
  const bare = (s) => String(s || '').replace(/\.ya?ml$/i, '');
  // the repository's own and the manifest's entries are listed by the manifest itself
  const listed = (w) => !w.error && w.origin !== 'repository' && w.origin !== 'manifest';
  const nameOf = (w) => bare(w.file) || w.name;

  // api.listWorkflows(), read again at each opening of the dialog or the page (a workflow saved in
  // the Builder since then is listed)
  async function installed() {
    try { return (await api.listWorkflows()).filter(listed); } catch { return []; }
  }

  // ---- the project's page (Overview) --------------------------------------------------------
  // #729: the last draw ({ p, list, manifest, box }) and the Add dialog while open ({ query, focus })
  let pageSeq = 0;
  let page = null;
  let adding = null;
  let searchTimer = null;

  // the wizard's pick as step 3 names it ('remote-code' → "Remote PRs · code first"), else the value itself
  function choiceLabel(kind, value) {
    const M = window.OnboardingModel;
    if (!value || !M) return value || '';
    const s = kind === 'ci' ? M.ciChoice(null) : M.suggestWorkflows(null).suggestions.find((x) => x.id === kind);
    const label = s?.choices?.find((c) => c.value === value)?.label; // #726: an i18n key
    return label ? t(label) : value;
  }

  function cardHtml(w, known, def) {
    const name = bare(w.name);
    const inst = known.get(name);
    const description = w.description || inst?.description || '';
    const variant = choiceLabel(name, w.variant);
    const ci = w.ci ? t('projects.workflows_ci', { ci: esc(choiceLabel('ci', w.ci)) }) : '';
    const isDefault = name === def;
    return `<li class="pj-wf-card" data-testid="pj-wf-card" data-workflow-id="${esc(name)}">
        <div class="pj-wf-card-head"><span class="mono pj-wf-card-name text-cut" title="${esc(name)}">${esc(name)}</span>
          ${isDefault ? `<span class="badge ok" data-testid="pj-wf-default-badge">${t('projects.workflows_default_badge')}</span>` : ''}</div>
        <div class="pj-wf-card-meta"><span class="badge">${esc(wfSectionName(wfSectionOf(w.category || inst?.category)))}</span>
          ${variant ? `<span class="muted small text-cut" title="${esc(variant)}">${esc(variant)}</span>` : ''}
          ${ci ? `<span class="muted small text-cut">${ci}</span>` : ''}</div>
        ${description ? `<p class="pj-wf-card-desc muted small" title="${esc(description)}">${esc(description)}</p>` : ''}
        <div class="pj-wf-card-actions">
          ${isDefault ? '' : `<button type="button" class="link-btn small" data-testid="pj-wf-make-default" data-workflow-id="${esc(name)}">${t('projects.workflows_make_default')}</button>`}
          <button type="button" class="link-btn small" data-testid="pj-wf-remove" data-workflow-id="${esc(name)}" aria-label="${esc(t('projects.workflows_remove_aria', { name }))}">${t('projects.workflows_remove')}</button>
        </div>
      </li>`;
  }

  // the installed workflows not on the project (never the manifest's: a retired one has no file), by
  // the Workflows screen's sections, filtered by the search
  function addHtml() {
    const { p, list } = page;
    const on = new Set((p.workflows || []).map((w) => bare(w?.name)));
    const q = adding.query.trim().toLowerCase();
    const rows = list.map((x) => ({ name: nameOf(x), origin: x.origin || 'workspace', category: x.category, description: x.description }))
      .filter((r) => r.name && !on.has(r.name) && (!q || r.name.toLowerCase().includes(q)));
    const by = new Map();
    for (const r of rows) {
      const k = wfSectionOf(r.category);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    const groups = Object.keys(WF_SECTIONS).filter((k) => by.has(k)).map((k) => `
      <div class="pj-wf-group" data-category="${esc(k)}">
        <div class="pj-wf-group-head"><span class="pj-wf-group-name" role="heading" aria-level="4">${esc(wfSectionName(k))}</span>
          <span class="hint">${esc(t(WF_SECTIONS[k]))}</span></div>
        ${by.get(k).map((r) => `<button type="button" class="pj-wf-add-option" data-testid="pj-wf-add-option" data-workflow-id="${esc(r.name)}">
            <span class="mono text-cut">${esc(r.name)}</span>${r.description ? `<span class="muted small pj-wf-card-desc">${esc(r.description)}</span>` : ''}</button>`).join('')}
      </div>`).join('');
    return `<div class="modal pj-wf-add-modal" id="pj-wf-add-modal">
        <div class="modal-card pj-wf-add-card" id="pj-wf-add-dialog" role="dialog" aria-modal="true" aria-labelledby="pj-wf-add-title" data-testid="pj-wf-add-dialog">
          <h3 id="pj-wf-add-title" class="text-cut">${esc(t('projects.workflows_add_title', { name: p.name || p.id }))}</h3>
          <input type="search" id="pj-wf-add-search" data-testid="pj-wf-add-search" value="${esc(adding.query)}" placeholder="${esc(t('projects.workflows_add_search'))}" aria-label="${esc(t('projects.workflows_add_search'))}" />
          <div class="pj-wf-add-list">${groups || `<p class="muted small">${t('projects.workflows_add_none')}</p>`}</div>
          <div class="modal-actions"><button type="button" class="btn ghost" data-testid="pj-wf-add-close">${t('common.close')}</button></div>
        </div>
      </div>`;
  }

  function draw() {
    const { p, list, manifest, box } = page;
    const known = new Map(list.map((w) => [nameOf(w), w]));
    const def = bare(p.defaultWorkflow);
    const mine = (p.workflows || []).filter((w) => bare(w?.name));
    const on = new Set(mine.map((w) => bare(w.name)));
    // #487: the workflows the repository's .multiagent/ declares, not on the project
    const repo = [...new Set((manifest?.workflows || []).map((w) => bare(w?.name)).filter((n) => n && !on.has(n)))];
    const addBtn = `<button type="button" class="btn sm ghost pj-wf-add" data-testid="pj-wf-add">${t('projects.workflows_add')}</button>`;
    box.innerHTML = `
      <div class="pj-wf" data-testid="project-workflows-block">
        <div class="pj-wf-head"><span class="pj-wf-title">${t('projects.workflows')}</span>
          <span class="muted small" data-testid="project-default-workflow">${t('projects.workflows_default')}: <span class="mono">${esc(def || t('projects.workflows_settings_default'))}</span></span></div>
        ${manifest?.errors?.length ? `<p class="error small" data-testid="project-workflows-manifest-errors">${t('projects.workflows_manifest_errors', { errors: esc(manifest.errors.join('; ')) })}</p>` : ''}
        ${mine.length ? `<ul class="pj-wf-cards">${mine.map((w) => cardHtml(w, known, def)).join('')}<li class="pj-wf-add-cell">${addBtn}</li></ul>`
          : `<p class="muted small" data-testid="pj-wf-empty">${t('projects.workflows_empty')}</p>${addBtn}`}
        ${repo.length ? `<p class="pj-wf-repo small"><span class="muted">${t('projects.workflows_in_repository')}:</span> ${repo.map((n) => `<span class="badge mono" data-testid="project-repository-workflow">${esc(n)}</span>`).join(' ')}</p>` : ''}
      </div>${adding ? addHtml() : ''}`;
    if (!adding) return;
    const search = $('#pj-wf-add-search');
    if (search) {
      search.oninput = (e) => {
        adding.query = String(e.target.value || '');
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          if (!adding || !page) return;
          // the caret where the owner left it, not at the end, across the redraw
          const at = $('#pj-wf-add-search')?.selectionStart;
          adding.caret = Number.isFinite(at) ? at : adding.query.length;
          adding.focus = true;
          draw();
        }, 120);
      };
      if (adding.focus) { const at = adding.caret ?? adding.query.length; search.focus?.(); search.setSelectionRange?.(at, at); }
    }
    const dialog = $('#pj-wf-add-dialog');
    if (dialog) dialog.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation?.(); closeAdd(); } };
  }

  async function showPage(p, box) {
    if (!p || !box) return;
    const seq = ++pageSeq;
    const [list, manifest] = await Promise.all([
      installed(),
      p.folder ? api.projectManifest({ folder: p.folder }).catch(() => null) : null,
    ]);
    if (seq !== pageSeq) return;
    if (page?.p?.id !== p.id) adding = null;
    page = { p, list, manifest, box };
    draw();
  }

  // the dialog lists api.listWorkflows read again (a workflow saved in the Builder since then is offered)
  async function openAdd() {
    if (!page) return;
    adding = { query: '', focus: true };
    const list = await installed();
    if (!page || !adding) return;
    page = { ...page, list };
    draw();
  }

  function closeAdd() {
    clearTimeout(searchTimer);
    adding = null;
    if (page) draw();
    $('#project-workflows [data-testid="pj-wf-add"]')?.focus?.();
  }

  // true when saved
  async function save(patch) {
    const pv = state.pv;
    if (!pv) return false;
    let ok = true;
    try {
      pv.project = { ...pv.project, ...(await api.updateProject(pv.id, patch)) };
      // the backlog's pickers read the header project's set and default from state.projects
      state.projects = (state.projects || []).map((p) => (p.id === pv.id ? { ...p, ...pv.project } : p));
    } catch (err) {
      ok = false;
      showToast(t('projects.workflows_save_failed'), errMsg(err));
    }
    showPage(pv.project, $('#project-workflows'));
    return ok;
  }

  // Remove, in one click: the toast's Undo puts the set (its variants) and the default back
  async function remove(name) {
    const before = { workflows: state.pv.project?.workflows || [], defaultWorkflow: state.pv.project?.defaultWorkflow ?? null };
    if (!(await save(removePatch(name)))) return;
    showToast(t('projects.workflows_removed', { name }), '', null, null, { action: { label: t('common.undo'), run: () => save(before) } });
  }

  // the set without `name`, the others as they were; the default kept, else the service's rule for a new
  // project (packages/shared/default-workflow.js), else the first, else none (Settings' default)
  function removePatch(name) {
    const workflows = (state.pv.project?.workflows || []).filter((w) => bare(w?.name) !== name);
    const cur = bare(state.pv.project?.defaultWorkflow);
    const defaultWorkflow = cur && cur !== name ? cur : (DefaultWorkflow.firstBuild(workflows) || bare(workflows[0]?.name) || null);
    return { workflows, defaultWorkflow };
  }

  function addPatch(name) {
    const x = (page?.list || []).find((w) => nameOf(w) === name);
    const workflows = [...(state.pv.project?.workflows || []), { name, origin: x?.origin || 'workspace', ...(x?.category ? { category: x.category } : {}) }];
    const cur = bare(state.pv.project?.defaultWorkflow);
    return { workflows, defaultWorkflow: cur || DefaultWorkflow.firstBuild(workflows) };
  }

  // the Overview's delegated click: a card's action, "+ Add a workflow" and the dialog's
  function onClick(e) {
    const hit = (id) => e.target.closest?.(`[data-testid="${id}"]`);
    if (!state.pv) return false;
    let btn;
    if ((btn = hit('pj-wf-make-default'))) save({ defaultWorkflow: btn.dataset.workflowId });
    else if ((btn = hit('pj-wf-remove'))) remove(btn.dataset.workflowId);
    else if ((btn = hit('pj-wf-add-option'))) {
      clearTimeout(searchTimer);
      adding = null;
      const patch = addPatch(btn.dataset.workflowId);
      draw(); // the dialog closes at once: a second click cannot save again
      save(patch);
    } else if (hit('pj-wf-add-close') || e.target.id === 'pj-wf-add-modal') closeAdd();
    else if (hit('pj-wf-add')) openAdd();
    else return false;
    return true;
  }

  return { onClick, showPage };
})();
