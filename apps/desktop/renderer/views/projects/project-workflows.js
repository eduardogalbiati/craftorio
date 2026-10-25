/* global api */
// #486: the "Workflows" block of a project: in Create Project (views/projects/projects.js, once a
// repository URL or a folder is given) and on the project's page (Projects › Overview,
// views/project/project.js). With a repository manifest (.multiagent/project.yaml, read through
// api.projectManifest before cloning) its workflows come checked in their categories and nothing is
// asked; the others wait under "Add another workflow". Without one, the bundled and workspace
// workflows by category (the Workflows screen's sections and hints, workflows.js WF_SECTIONS), none
// checked, and "Create one for this project" (the Builder). The Overview saves each change
// (api.updateProject: workflows, defaultWorkflow). Each workflow is a checkbox carrying
// data-workflow / data-origin / data-category; its label starts with the workflow's name.
// Uses app.js globals ($, esc, t, state, errMsg, showToast, closeModal), workflows.js's
// WF_SECTIONS, wfSectionOf, wfSectionName and showWorkflowsTab, and DefaultWorkflow.firstBuild
// (the default's rule, shared with packages/engine/domains/project/projects.js).

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

  // [{ name, origin, category, description, checked }]: the chosen ones first, then the others
  function rowsOf({ chosen, extra = [], list }) {
    const known = new Map(list.map((w) => [nameOf(w), w]));
    const rows = chosen.map((w) => ({ name: bare(w.name), origin: w.origin, category: w.category || known.get(bare(w.name))?.category, description: w.description || known.get(bare(w.name))?.description, checked: true }));
    const seen = new Set(rows.map((r) => r.name));
    for (const w of [...extra, ...list.map((x) => ({ name: nameOf(x), origin: x.origin || 'workspace', category: x.category, description: x.description }))]) {
      if (!w.name || seen.has(bare(w.name))) continue;
      seen.add(bare(w.name));
      rows.push({ ...w, name: bare(w.name), checked: false });
    }
    return rows;
  }

  // #487: a workflow the repository's .multiagent/ declares (the interview writes it, even uncommitted)
  const rowHtml = (r, { isDefault = false, canDefault = false } = {}) => `
    <div class="pj-wf-row"${r.origin === 'manifest' ? ' data-testid="project-repository-workflow"' : ''}>
      <label class="check small"><input type="checkbox" data-workflow="${esc(r.name)}" data-origin="${esc(r.origin || 'workspace')}" data-category="${esc(r.category || '')}"${r.checked ? ' checked' : ''} /><span><span class="mono">${esc(r.name)}</span>${r.description ? ` <span class="muted">${esc(r.description)}</span>` : ''}</span></label>
      ${r.origin === 'manifest' && !r.checked ? `<span class="badge">${t('projects.workflows_in_repository')}</span>` : ''}
      ${isDefault ? `<span class="badge ok">${t('projects.workflows_default_badge')}</span>` : ''}
      ${canDefault ? `<button type="button" class="link-btn small" data-pwf-default="${esc(r.name)}">${t('projects.workflows_make_default')}</button>` : ''}
    </div>`;

  // the rows by the Workflows screen's sections, in their order, each with its one-line hint
  function groupsHtml(rows, rowOpts = () => ({})) {
    const by = new Map();
    for (const r of rows) {
      const k = wfSectionOf(r.category);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    return Object.keys(WF_SECTIONS).filter((k) => by.has(k)).map((k) => `
      <div class="pj-wf-group" data-testid="project-workflows-category" data-category="${esc(k)}">
        <div class="pj-wf-group-head"><span class="pj-wf-group-name" role="heading" aria-level="4">${esc(wfSectionName(k))}</span>
          <span class="hint" data-testid="project-workflows-category-hint">${esc(t(WF_SECTIONS[k]))}</span></div>
        ${by.get(k).map((r) => rowHtml(r, rowOpts(r))).join('')}
      </div>`).join('');
  }

  // manifest: { workflows } | { pending, message } | null; create: offer "Create one for this project"
  function blockHtml({ manifest, rows, intro, create, head = '', rowOpts }) {
    const chosen = rows.filter((r) => r.checked);
    const others = rows.filter((r) => !r.checked);
    const collapse = !!manifest?.workflows?.length;
    return `
      <div class="pj-wf" data-testid="project-workflows-block">
        <div class="pj-wf-head"><span class="pj-wf-title">${t('projects.workflows')}</span>${head}</div>
        ${manifest?.pending ? `<p class="hint warn-text">${t('projects.workflows_after_cloning')}</p>` : ''}
        ${manifest?.errors?.length ? `<p class="error small" data-testid="project-workflows-manifest-errors">${t('projects.workflows_manifest_errors', { errors: esc(manifest.errors.join('; ')) })}</p>` : ''}
        ${intro ? `<p class="hint">${intro}</p>` : ''}
        ${rows.length ? '' : `<p class="muted small">${t('projects.workflows_none_installed')}</p>`}
        ${collapse ? groupsHtml(chosen, rowOpts) : groupsHtml(rows, rowOpts)}
        ${collapse && others.length ? `<details class="pj-wf-more"><summary>${t('projects.workflows_add_another')}</summary>${groupsHtml(others, rowOpts)}</details>` : ''}
        ${create ? `<button type="button" id="btn-pj-wf-create" class="btn sm ghost" data-testid="project-workflows-create">${t('projects.workflows_create')}</button>` : ''}
      </div>`;
  }

  // [{ name, origin, category? }] of the block's checked boxes, in their order
  const selected = (box) => [...(box?.querySelectorAll('input[data-workflow]') || [])].filter((i) => i.checked)
    .map((i) => ({ name: i.dataset.workflow, origin: i.dataset.origin || 'workspace', ...(i.dataset.category ? { category: i.dataset.category } : {}) }));

  // ---- Create Project ------------------------------------------------------------------------
  let dialogSeq = 0;
  let dialogTimer = null;
  // reads the manifest of the dialog's folder, else of its repository URL, and draws the block
  async function showDialog(box, { folder, url }) {
    const seq = ++dialogSeq;
    let manifest = null;
    try {
      if (folder) manifest = await api.projectManifest({ folder });
      if (!manifest && url) manifest = await api.projectManifest({ url });
    } catch { manifest = null; }
    const list = await installed();
    if (seq !== dialogSeq || !box) return;
    const chosen = (manifest?.workflows || []).map((w) => ({ ...w, origin: 'manifest' }));
    const rows = rowsOf({ chosen, list });
    box.innerHTML = blockHtml({
      manifest,
      rows,
      create: !chosen.length,
      intro: chosen.length ? t('projects.workflows_from_manifest') : t('projects.workflows_pick_hint'),
    });
    const create = $('#btn-pj-wf-create');
    if (create && chosen.length === 0) {
      create.onclick = () => {
        closeModal('#project-modal');
        // #486: the next issue's interview takes over; until then, the Builder
        showWorkflowsTab('builder');
      };
    }
  }
  // the folder and URL fields' input: one read 400 ms after the last key
  function scheduleDialog(box, target) {
    clearTimeout(dialogTimer);
    dialogTimer = setTimeout(() => showDialog(box, target()), 400);
  }

  // ---- the project's page (Overview) --------------------------------------------------------
  let pageSeq = 0;
  async function showPage(p, box) {
    if (!p || !box) return;
    const seq = ++pageSeq;
    const [list, manifest] = await Promise.all([
      installed(),
      p.folder ? api.projectManifest({ folder: p.folder }).catch(() => null) : null,
    ]);
    if (seq !== pageSeq) return;
    const extra = (manifest?.workflows || []).map((w) => ({ ...w, origin: 'manifest' }));
    const rows = rowsOf({ chosen: p.workflows || [], extra, list });
    const def = bare(p.defaultWorkflow);
    const head = `<span class="muted small" data-testid="project-default-workflow">${t('projects.workflows_default')}: <span class="mono">${esc(def || t('projects.workflows_settings_default'))}</span></span>`;
    box.innerHTML = blockHtml({
      manifest: manifest?.errors?.length ? { errors: manifest.errors } : null,
      rows,
      head,
      intro: t('projects.workflows_page_hint'),
      rowOpts: (r) => ({ isDefault: r.checked && r.name === def, canDefault: r.checked && r.name !== def }),
    });
  }

  async function save(patch) {
    const pv = state.pv;
    if (!pv) return;
    try {
      pv.project = { ...pv.project, ...(await api.updateProject(pv.id, patch)) };
      // the backlog's pickers read the header project's set and default from state.projects
      state.projects = (state.projects || []).map((p) => (p.id === pv.id ? { ...p, ...pv.project } : p));
    } catch (err) {
      showToast(t('projects.workflows_save_failed'), errMsg(err));
    }
    showPage(pv.project, $('#project-workflows'));
  }

  // the Overview's delegated change: a box checked or cleared saves the set (and a default still in it)
  function onChange(e) {
    const input = e.target.closest?.('#project-workflows input[data-workflow]');
    if (!input || !state.pv) return false;
    const workflows = selected($('#project-workflows'));
    const cur = bare(state.pv.project?.defaultWorkflow);
    // the service's rule for a new project (packages/shared/default-workflow.js)
    const defaultWorkflow = workflows.some((w) => w.name === cur) ? cur : DefaultWorkflow.firstBuild(workflows);
    save({ workflows, defaultWorkflow });
    return true;
  }

  function onClick(e) {
    const btn = e.target.closest?.('[data-pwf-default]');
    if (!btn || !state.pv) return false;
    save({ defaultWorkflow: btn.dataset.pwfDefault });
    return true;
  }

  return { onChange, onClick, scheduleDialog, selected, showDialog, showPage };
})();
