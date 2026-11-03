/* global api, $, esc, t, openModal, closeModal, showToast, errMsg */
// #742: a project card's Remove (projects.js), in the app's confirm modal (data-testid="confirm-modal"):
// what goes with the project (its roadmap, architecture reports, onboarding state) and what stays (the runs'
// history), and the box "Also delete the folder <path>" (data-testid="project-remove-folder", unticked).
// Remove calls projects:remove ({ id, deleteFolder }); the engine may answer:
// - { needsConfirm, dirty, unpushed }: the folder has uncommitted changes or commits on no remote: the dialog
//   lists them (projects.remove_folder_changes) and asks again (confirmed: true);
// - { needsName }: a folder the app did not make (outside <workspace>/repos/ and projects/): the owner types the
//   project's name (projects.remove_type_name, data-testid="project-remove-name") to delete it;
// - { refused, running: [run ids] } while a run of the project is running: a toast naming the runs
//   (projects.remove_running_run), nothing removed.
// window.ProjectRemove.remove(p) resolves true once the project is removed. Uses app.js globals.

(function () {
  // one question in the confirm modal: lines listed under the message, and an extra control (a checkbox or a
  // text field); resolves { checked, text } on Remove, null on Cancel
  function ask({ title, message, lines = [], check = null, input = null }) {
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    const list = $('#confirm-details');
    list.innerHTML = lines.map((l) => `<li>${esc(l)}</li>`).join('');
    list.classList.toggle('hidden', !lines.length);
    const extra = document.createElement('div');
    extra.className = 'field project-remove-extra';
    if (check) extra.innerHTML = `<label class="check small"><input type="checkbox" id="project-remove-folder" data-testid="project-remove-folder" /><span class="mono">${esc(check)}</span></label>`;
    else if (input) extra.innerHTML = `<label for="project-remove-name">${esc(input)}</label><input type="text" id="project-remove-name" data-testid="project-remove-name" autocomplete="off" />`;
    if (check || input) list.after(extra);
    $('#btn-confirm-yes').textContent = t('common.remove');
    openModal('#confirm-modal');
    return new Promise((resolve) => {
      const done = (answer) => {
        closeModal('#confirm-modal');
        extra.remove();
        resolve(answer);
      };
      $('#btn-confirm-yes').onclick = () => done({
        checked: !!extra.querySelector?.('input[type="checkbox"]')?.checked,
        text: String(extra.querySelector?.('input[type="text"]')?.value || '').trim(),
      });
      $('#btn-confirm-no').onclick = () => done(null);
    });
  }

  async function remove(p) {
    const title = t('projects.remove_project');
    const lines = [t('projects.remove_goes'), t('projects.remove_stays')];
    const first = await ask({ title, message: t('projects.remove_message', { name: p.name }), lines, check: p.folder ? t('projects.remove_delete_folder', { folder: p.folder }) : null });
    if (!first) return false;
    let req = { id: p.id, deleteFolder: first.checked };
    for (;;) {
      let out;
      try { out = await api.removeProject(req); }
      catch (e) {
        showToast(t('projects.remove_failed'), errMsg(e));
        return false;
      }
      if (out?.running?.length) {
        showToast(t('projects.remove_running_run', { run: out.running.join(', ') }));
        return false;
      }
      if (out?.needsName) {
        const typed = await ask({ title, message: t('projects.remove_type_name', { name: p.name, folder: out.folder || p.folder }), input: t('projects.name') });
        if (!typed) return false;
        req = { ...req, confirmName: typed.text };
      }
      else if (out?.needsConfirm) {
        const changes = [...(out.dirty || []), ...(out.unpushed || [])].slice(0, 20);
        const again = await ask({ title, message: t('projects.remove_folder_changes', { folder: out.folder || p.folder }), lines: changes });
        if (!again) return false;
        req = { ...req, confirmed: true };
      }
      else return true;
    }
  }

  window.ProjectRemove = { remove };
})();
