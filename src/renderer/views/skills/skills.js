/* global api */
// Skills screen: the skill cards (Folder, Remove; a click edits it) and the New / Edit skill dialog
// (name, description, SKILL.md body). Registers itself with registerView (view-registry.js); uses
// app.js globals ($, esc, state, api, errMsg, dateOf, openModal, closeModal, confirmDialog).

async function refreshSkills() {
  state.skills = await api.listSkills();
  const box = $('#skills-list');
  if (!state.skills.length) {
    box.innerHTML = `<div class="empty-state"><b>${t('skills.no_skills_yet')}</b><p class="muted">${t('skills.skills_are_reusable_instructions_skill_md')}</p><button class="btn primary" id="empty-new-skill">${t('skills.new_skill')}</button></div>`;
    $('#empty-new-skill').onclick = () => openSkillModal(null);
    return;
  }
  box.innerHTML = state.skills.map((s) => `
    <div class="card clickable" data-id="${esc(s.id)}">
      <div class="card-head">
        <span class="card-icon bolt"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg></span>
        <b class="card-title mono">${esc(s.name)}</b>
      </div>
      <p class="muted small clamp">${esc(s.error ? `Error: ${s.error}` : s.description || 'No description.')}</p>
      <div class="card-actions">
        <span class="muted small">${s.updatedAt ? `updated ${esc(dateOf(s.updatedAt))}` : ''}${s.files?.length ? ` · +${s.files.length} file(s)` : ''}</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-act="open">${t('skills.folder')}</button>
        <button class="btn sm ghost danger" data-act="remove">${t('skills.remove')}</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('.card').forEach((c) => (c.onclick = async (e) => {
    const s = state.skills.find((x) => x.id === c.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'open') return api.openPath(s.path);
    if (act === 'remove') {
      if (await confirmDialog('Remove skill', `Move the skill "${s.name}" to the trash?`, 'Remove')) { await api.removeSkill(s.id); refreshSkills(); }
      return;
    }
    openSkillModal(s);
  }));
}

let editingSkill = null;
function openSkillModal(s) {
  editingSkill = s;
  $('#skill-modal-title').textContent = s ? s.name : 'New skill';
  $('#sk-name-field').classList.toggle('hidden', !!s);
  $('#sk-name').value = '';
  $('#sk-description').value = s?.description || '';
  $('#sk-body').value = s?.body ?? '# Instructions\n\n- \n';
  $('#btn-sk-folder').classList.toggle('hidden', !s);
  $('#btn-sk-folder').onclick = () => s && api.openPath(s.path);
  $('#sk-error').textContent = '';
  openModal('#skill-modal');
  (s ? $('#sk-description') : $('#sk-name')).focus({ preventScroll: true });
}

async function saveSkill(e) {
  e.preventDefault();
  const data = { name: $('#sk-name').value, description: $('#sk-description').value, body: $('#sk-body').value };
  try {
    if (editingSkill) await api.saveSkill(editingSkill.id, data);
    else await api.createSkill(data);
    closeModal('#skill-modal');
    refreshSkills();
  } catch (err) {
    $('#sk-error').textContent = errMsg(err);
  }
}

registerView({
  id: 'skills',
  nav: { label: 'Skills', order: 80, group: 'ai', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>' },
  markup: `
      <section id="view-skills" class="view hidden">
        <div class="page-head">
          <div>
            <h1>${t('skills.skills')}</h1>
            <p class="muted small">${t('skills.one_folder_per_skill_with_a')} <span class="mono">${t('skills.skill_md')}</span> ${t('skills.claude_code_format_in')} <span id="skills-dir" class="mono"></span></p>
          </div>
          <div class="row">
            <button id="btn-skills-folder" class="btn ghost">${t('skills.open_folder')}</button>
            <button id="btn-new-skill" class="btn primary">${t('skills.new_skill')}</button>
          </div>
        </div>
        <div id="skills-list" class="card-grid"></div>
      </section>`,
  modals: `
  <div id="skill-modal" class="modal hidden">
    <form id="skill-form" class="modal-card wide">
      <h3 id="skill-modal-title">${t('skills.new_skill')}</h3>
      <div class="field" id="sk-name-field">
        <label for="sk-name">${t('skills.name')} <span class="req">*</span></label>
        <input type="text" id="sk-name" name="name" placeholder="${t('skills.e_g_code_review_checklist')}" />
      </div>
      <div class="field">
        <label for="sk-description">${t('skills.description')} <span class="muted">${t('skills.when_the_agent_should_use_the')}</span></label>
        <input type="text" id="sk-description" name="description" />
      </div>
      <div class="field">
        <label for="sk-body">${t('skills.instructions_markdown')}</label>
        <textarea id="sk-body" name="body" rows="14" class="mono"></textarea>
      </div>
      <p id="sk-error" class="error small"></p>
      <div class="modal-actions">
        <button type="button" id="btn-sk-folder" class="btn ghost hidden">${t('skills.open_folder')}</button>
        <span class="spacer"></span>
        <button type="button" id="btn-sk-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="submit" class="btn primary">${t('common.save')}</button>
      </div>
    </form>
  </div>`,
  mount() {
    $('#btn-new-skill').onclick = () => openSkillModal(null);
    $('#btn-skills-folder').onclick = () => api.openPath(state.ws.skills);
    $('#skill-form').onsubmit = saveSkill;
    $('#btn-sk-cancel').onclick = () => closeModal('#skill-modal');
  },
  show: refreshSkills,
});
