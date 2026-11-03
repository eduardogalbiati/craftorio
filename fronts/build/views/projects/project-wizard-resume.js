/* global api, esc, t */
// #741: the new-project wizard's memory, split out of project-wizard.js (its size cap). An onboarding closed
// before Finish is not lost: the engine keeps the wizard's step and the owner's picks with the project
// (onboarding:save-wizard, the project record's onboarding { step, picks, finished }), and the wizard opens
// on them again: Projects › a card's Continue (ProjectWizard.open({ projectId }), onboarding:status) or New
// project with the same repository (onboarding:start answers the saved wizard). A finished project imported
// again answers { exists, finished, projectId }: the wizard says so (wizard-project-exists) and offers Open the
// project (wizard-open-existing, the project's page), never a second project.
// window.ProjectWizardResume({ cur, render, close }) gives the wizard, over its own state (`cur()`):
// - save(): the step and the picks (the model's source, repository, name and analyzeLater, workflowsMode, the
//   suggested workflows' variants, kind, idea) to the engine once the project exists, only when they changed
//   since the last save (fire and forget: a failed save never stops the wizard);
// - apply(wizard): the saved step and picks onto the wizard's state (a pick not saved keeps its value);
// - existsBody(): the markup of a finished project imported again;
// - onClick(act): Open the project, and Back from that notice; true when it handled the click.
// Uses app.js globals (esc, t) and window.Actions.

(function () {
  const STEPS = ['repository', 'analysis', 'review'];
  const MODEL_PICKS = ['source', 'repository', 'name', 'analyzeLater'];
  const OWN_PICKS = ['workflowsMode', 'workflows', 'kind', 'idea'];

  window.ProjectWizardResume = function ({ cur, render, close }) {
    const sent = new Map(); // projectId → the last step and picks sent (JSON)

    function snapshot() {
      const c = cur();
      const picks = {};
      for (const k of MODEL_PICKS) if (c.model[k] !== undefined && c.model[k] !== null) picks[k] = c.model[k];
      for (const k of OWN_PICKS) if (c[k] !== undefined && c[k] !== null && c[k] !== '') picks[k] = c[k];
      return { step: c.model.step, picks };
    }

    function save() {
      const c = cur();
      if (!c?.projectId || c.exists) return;
      const snap = snapshot();
      const key = JSON.stringify(snap);
      if (sent.get(c.projectId) === key) return;
      sent.set(c.projectId, key);
      new Promise((resolve) => resolve(api.saveOnboardingWizard({ projectId: c.projectId, ...snap }))).catch(() => {});
    }

    function apply(wizard) {
      const c = cur();
      if (!c || !wizard || typeof wizard !== 'object') return;
      const picks = wizard.picks && typeof wizard.picks === 'object' ? wizard.picks : {};
      const model = { ...c.model };
      for (const k of MODEL_PICKS) if (picks[k] !== undefined) model[k] = picks[k];
      if (STEPS.includes(wizard.step)) model.step = wizard.step;
      c.model = model;
      for (const k of OWN_PICKS) if (picks[k] !== undefined) c[k] = picks[k];
      if (picks.name) c.nameTyped = true;
      if (c.projectId) sent.set(c.projectId, JSON.stringify(snapshot()));
    }

    function existsBody() {
      return `<h2 id="project-wizard-title" class="wizard-title">${esc(t('onboarding.project_exists_title'))}</h2>
        <div class="wizard-alert" role="status" data-testid="wizard-project-exists">
          <p>${esc(t('onboarding.project_exists', { name: cur().model.name.trim() }))}</p>
          <div class="wizard-actions"><button type="button" class="btn primary" data-act="open-existing" data-testid="wizard-open-existing">${esc(t('onboarding.open_existing'))}</button></div>
        </div>`;
    }

    function onClick(act) {
      const c = cur();
      if (!c?.exists) return false;
      if (act === 'open-existing') {
        const pid = c.exists;
        close();
        window.Actions.call('openProject', pid);
      }
      else if (act === 'back') { c.exists = null; render(); }
      else return false;
      return true;
    }

    return { apply, existsBody, onClick, save };
  };
})();
