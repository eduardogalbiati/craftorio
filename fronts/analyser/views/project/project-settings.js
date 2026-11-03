/* global api, $, esc, t, state, errMsg, showToast, runAppCommandHtml */
// #741: the one place to edit a project, on its page's Overview (project.js): the section "Project settings"
// (data-testid="project-settings", a framed disclosure, closed unless asked: a card's Edit opens it,
// openProject with { settings: true }). Its fields are what the old New / Edit project dialog had and what the
// new-project wizard set: name, description, repository, folder (… picks one, api.pickFolder), base branch (the
// project's run default base_branch, #735: empty follows the repository's default branch), Local preview
// (install / command / URL, with the command detected in the folder, #115: api.suggestLocalPreview, "Use it"),
// "Install without scripts" (#472, data-testid="project-ignore-scripts") and "Prefer the repository's workflows"
// (#554, data-testid="project-prefer-repository-workflows"). The workflows (project-workflows.js) and the
// ways of working (project-ways-of-working.js) stay where they are, on the same page. Save (project-settings-save)
// sends api.updateProject once (the name and the folder are required), Cancel puts the saved values back;
// nothing saves while typing. The page redraws on run events: the form is drawn again (and the folder's command
// detected again) only when the project's saved fields changed, never while it has unsaved edits.
// window.ProjectSettings.show(project, box, { open }). Uses app.js globals.

(function () {
  let cur = null; // { id, dirty, detected (the suggestion "Use it" took) }

  const field = (id, label, value, opts = {}) => `<div class="field">
      <label for="${id}">${esc(label)}${opts.optional ? ` <span class="muted">${esc(t('projects.optional'))}</span>` : ''}</label>
      ${opts.row ? `<div class="row"><input type="text" id="${id}" value="${esc(value || '')}" />${opts.row}</div>` : `<input type="text" id="${id}" value="${esc(value || '')}"${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''} />`}
      ${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}
    </div>`;

  const check = (id, testid, label, hint, on) => `<div class="field">
      <label class="check small"><input type="checkbox" id="${id}" data-testid="${testid}"${on ? ' checked' : ''} /><span>${esc(label)}</span></label>
      <div class="hint">${esc(hint)}</div>
    </div>`;

  function markup(p, open) {
    const lp = p.localPreview || {};
    return `<details class="pr-settings panel" data-testid="project-settings"${open ? ' open' : ''}>
      <summary><b>${esc(t('project.settings'))}</b> <span class="muted small">${esc(t('project.settings_hint'))}</span></summary>
      <form id="ps-form" class="pr-settings-form" novalidate>
        <div class="pr-settings-grid">
          ${field('ps-name', t('projects.name'), p.name)}
          ${field('ps-description', t('projects.description'), p.description, { optional: true })}
          ${field('ps-repo', t('projects.git_repository'), p.repo, { optional: true, placeholder: t('projects.https_github_com_owner_repo_git') })}
          ${field('ps-folder', t('projects.folder_2'), p.folder, { row: `<button type="button" id="ps-pick" class="btn sm" aria-label="${esc(t('project.settings_pick_folder'))}">…</button>` })}
          ${field('ps-base', t('project.settings_base_branch'), p.runDefaults?.base_branch, { optional: true, hint: t('project.settings_base_branch_hint') })}
        </div>
        <div class="field">
          <label for="ps-lp-command">${esc(t('projects.local_preview'))} <span class="muted">${esc(t('projects.optional'))}</span></label>
          <div class="row">
            <input type="text" id="ps-lp-install" value="${esc(lp.install || '')}" placeholder="${esc(t('projects.install_npm_ci'))}" aria-label="${esc(t('projects.install_npm_ci'))}" />
            <input type="text" id="ps-lp-command" value="${esc(lp.command || '')}" placeholder="${esc(t('projects.run_npm_start'))}" />
            <input type="text" id="ps-lp-url" value="${esc(lp.url || '')}" placeholder="${esc(t('projects.url_http_localhost_5173'))}" aria-label="${esc(t('projects.url_http_localhost_5173'))}" />
          </div>
          <div id="ps-lp-detected" class="hint pj-lp-detected hidden"></div>
          <div class="hint">${esc(t('projects.how_to_run_a_run_s'))}</div>
        </div>
        ${check('ps-ignore-scripts', 'project-ignore-scripts', t('projects.install_without_scripts'), t('projects.install_without_scripts_hint'), p.ignoreInstallScripts)}
        ${check('ps-prefer-repo-workflows', 'project-prefer-repository-workflows', t('projects.prefer_repository_workflows'), t('projects.prefer_repository_workflows_hint'), p.preferRepositoryWorkflows)}
        <p id="ps-error" class="error small" role="alert"></p>
        <div class="modal-actions">
          <button type="button" id="ps-cancel" class="btn ghost" data-testid="project-settings-cancel">${esc(t('common.cancel'))}</button>
          <button type="submit" id="ps-save" class="btn primary" data-testid="project-settings-save">${esc(t('common.save'))}</button>
        </div>
      </form>
    </details>`;
  }

  // What the folder declares or is detected to run with (#115): "Use it" fills Local preview
  async function detect(p) {
    const box = $('#ps-lp-detected');
    const folder = $('#ps-folder')?.value.trim();
    if (!box || !folder || p.localPreview?.command || typeof api.suggestLocalPreview !== 'function') return;
    let s = null;
    try { s = await api.suggestLocalPreview(folder); } catch { /* an unreadable folder suggests nothing */ }
    if (!s?.command || !cur || cur.id !== p.id) return;
    box.innerHTML = `${esc(t('project.settings_detected'))} ${runAppCommandHtml(s)}${s.url ? ` · ${esc(s.url)}` : ''} <span class="muted">${t('projects.from_value', { value: esc(s.from || 'the folder') })}</span>
      <button type="button" class="btn sm ghost" id="ps-lp-use">${esc(t('projects.use_it'))}</button>`;
    box.classList.remove('hidden');
    $('#ps-lp-use').onclick = () => {
      $('#ps-lp-install').value = s.install || '';
      $('#ps-lp-command').value = s.command;
      $('#ps-lp-url').value = s.url || '';
      cur.detected = s;
      cur.dirty = true;
      box.classList.add('hidden');
    };
  }

  async function save(e, p, box) {
    e.preventDefault();
    const val = (id) => String($(id)?.value || '').trim();
    const command = val('#ps-lp-command');
    // the fields show install / command / URL; a monorepo app's folder and the env are kept
    const kept = cur.detected?.command === command ? cur.detected : p.localPreview || {};
    const base = val('#ps-base');
    const patch = {
      name: val('#ps-name'), description: val('#ps-description'), repo: val('#ps-repo'), folder: val('#ps-folder'),
      localPreview: { cwd: kept.cwd, env: kept.env, install: val('#ps-lp-install'), command, url: val('#ps-lp-url') },
      ignoreInstallScripts: !!$('#ps-ignore-scripts')?.checked,
      preferRepositoryWorkflows: !!$('#ps-prefer-repo-workflows')?.checked,
      runDefaults: { ...(p.runDefaults || {}), base_branch: base || null },
    };
    $('#ps-error').textContent = '';
    if (!patch.name) { $('#ps-error').textContent = t('project.settings_name_required'); return; }
    // an empty folder would resolve to the engine's own folder: the project keeps one
    if (!patch.folder) { $('#ps-error').textContent = t('project.settings_folder_required'); return; }
    const btn = $('#ps-save');
    btn.disabled = true;
    try {
      const saved = await api.updateProject(p.id, patch);
      const record = saved && typeof saved === 'object' ? saved : { ...p, ...patch };
      state.projects = (state.projects || []).map((x) => (x.id === p.id ? { ...x, ...record } : x));
      if (state.pv?.id === p.id) state.pv.project = { ...(state.pv.project || {}), ...record };
      window.CurrentProject?.refresh?.();
      cur.dirty = false;
      showToast(t('project.settings_saved', { name: record.name || patch.name }));
      show(state.pv?.project || record, box, { open: true, force: true });
    } catch (err) {
      $('#ps-error').textContent = errMsg(err);
    } finally {
      btn.disabled = false;
    }
  }

  // the fields the form shows: the page redraws on run events, the form only when these change
  const signature = (p) => JSON.stringify([p.name, p.description, p.repo, p.folder, p.localPreview, p.runDefaults?.base_branch,
    !!p.ignoreInstallScripts, !!p.preferRepositoryWorkflows]);

  function show(p, box, { open = false, force = false } = {}) {
    if (!p || !box) return;
    // unsaved edits of this project, or the same saved values, stay as they are (the focus too); open: a card's
    // Edit asks for the section
    const sig = signature(p);
    if (!force && cur?.id === p.id && (cur.dirty || cur.sig === sig) && box.querySelector?.('#ps-form')) {
      if (open) {
        box.querySelector('details')?.setAttribute('open', '');
        box.scrollIntoView?.({ block: 'start' });
      }
      return;
    }
    const wasOpen = !!box.querySelector?.('details[open]') && cur?.id === p.id;
    cur = { id: p.id, dirty: false, detected: null, sig };
    box.innerHTML = markup(p, open || wasOpen);
    const form = $('#ps-form');
    form.oninput = () => { cur.dirty = true; };
    form.onchange = () => { cur.dirty = true; };
    form.onsubmit = (e) => save(e, p, box);
    $('#ps-cancel').onclick = () => show(p, box, { open: true, force: true });
    $('#ps-pick').onclick = async () => {
      const d = await api.pickFolder();
      if (!d) return;
      $('#ps-folder').value = d;
      cur.dirty = true;
      detect({ ...p, localPreview: null });
    };
    if (open) box.scrollIntoView?.({ block: 'start' });
    detect(p);
  }

  window.ProjectSettings = { show };
})();
