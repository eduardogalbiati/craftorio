/* global esc, t */
// #633 (spec R9, mock-5): the new-project wizard's step 3 work model section, split out of
// project-wizard.js (its size cap). window.ProjectWizardWorkModel({ cur, recommended }) gives the wizard, over its own
// state (`cur()`: the model's name and cur.workModel, one of the wizard's saved picks):
// - section(): wizard-work-model, two columns: "How work on <name> is documented" with the three radios
//   wizard-work-model-light / -standard / -full (OnboardingModel.WORK_MODELS; #851: Light checked by default, with
//   the Recommended label, `recommended()` of project-wizard-workflows.js), and, #851 only while Standard or Full is
//   picked, wizard-work-model-files, "Where the files live": docs/work/<item>/ intent.md · spec.md · plan.md in
//   the repository (D16: no HTML is committed; the write-doc pre-flow writes them at their gates, never the
//   Code & Build run) and the chips fix: issue only, feature: Standard, release: notes;
// - onInput(e): a radio's change sets cur.workModel; true when handled (the wizard renders and saves);
// - picked(): the work model Finish saves on the project (workModel), the default when untouched.
// Uses app.js globals (esc, t) and window.OnboardingModel.

(function () {
  // A repository path, the same in every language.
  const FILES_PATH = 'docs/work/<item>/intent.md · spec.md · plan.md'; // i18n-ignore

  window.ProjectWizardWorkModel = function ({ cur, recommended }) {
    const M = window.OnboardingModel;
    const picked = () => (M.WORK_MODELS.includes(cur()?.workModel) ? cur().workModel : M.DEFAULT_WORK_MODEL);

    function onInput(e) {
      const id = String(e.target?.dataset?.testid || '');
      if (!id.startsWith('wizard-work-model-')) return false;
      const value = String(e.target.value || id.slice('wizard-work-model-'.length));
      if (!M.WORK_MODELS.includes(value)) return false;
      cur().workModel = value;
      return true;
    }

    // #851: Light, the default, carries the Recommended label
    const choice = (id) => `<label class="wizard-choice">
        <input type="radio" name="wizard-work-model" value="${esc(id)}" id="wizard-work-model-${esc(id)}" data-testid="wizard-work-model-${esc(id)}"${picked() === id ? ' checked' : ''}>
        <span><strong>${esc(t(`onboarding.work_model_${id}`))}${id === 'light' && recommended ? recommended() : ''}</strong><span class="muted small">${esc(t(`onboarding.work_model_${id}_text`))}</span></span>
      </label>`;

    // "Where the files live": #851 only for Standard and Full (Light writes nothing to docs/work/)
    function files() {
      if (picked() === 'light') return '';
      const chip = (key, accent) => `<span class="wizard-chip${accent ? ' accent' : ''}">${esc(t(key))}</span>`;
      return `<div class="wizard-column" data-testid="wizard-work-model-files">
          <h3>${esc(t('onboarding.work_model_files_title'))}</h3>
          <span class="small muted">${esc(t('onboarding.work_model_in_repo'))}</span>
          <div class="wizard-work-model-path">${esc(FILES_PATH)}</div>
          <p class="muted small">${esc(t('onboarding.work_model_files_line'))}</p>
          <div class="wizard-chips">${chip('onboarding.work_model_chip_fix', true)}${chip('onboarding.work_model_chip_feature', true)}${chip('onboarding.work_model_chip_release', false)}</div>
        </div>`;
    }

    function section() {
      return `<section class="wizard-columns wizard-work-model" data-testid="wizard-work-model">
        <div class="wizard-column">
          <h3>${esc(t('onboarding.work_model_title', { name: cur().model.name }))}</h3>
          <p class="muted">${esc(t('onboarding.work_model_line'))}</p>
          <div class="wizard-starts" role="radiogroup" aria-label="${esc(t('onboarding.work_model_title', { name: cur().model.name }))}">${M.WORK_MODELS.map(choice).join('')}</div>
        </div>
        ${files()}
      </section>`;
    }

    return {
      onInput,
      picked,
      section,
    };
  };
}());
