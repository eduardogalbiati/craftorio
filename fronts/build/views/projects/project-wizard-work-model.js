/* global esc, t */
// #633 (spec R9, mock-5): the new-project wizard's step 3 work model section, split out of
// project-wizard.js (its size cap). window.ProjectWizardWorkModel({ cur, recommended }) gives the wizard, over its own
// state (`cur()`: the model's name and cur.workModel, one of the wizard's saved picks):
// - section(): wizard-work-model, under step 3's workflow rows: "How the work is documented" and three tiles over
//   the radios wizard-work-model-light / -standard / -full (OnboardingModel.WORK_MODELS; #851: Light checked by
//   default, with the Recommended label, `recommended()` of project-wizard-workflows.js). Standard and Full are not
//   ready yet (the owner's call, 2026-11-26): disabled, marked wizard-work-model-soon ("Coming soon"), so
//   wizard-work-model-files ("Where the files live", only for Standard or Full) never shows for now;
// - onInput(e): a radio's change sets cur.workModel; true when handled (the wizard renders and saves);
// - picked(): the work model Finish saves on the project (workModel): the default when untouched or not ready yet.
// Uses app.js globals (esc, t) and window.OnboardingModel.

(function () {
  // A repository path, the same in every language.
  const FILES_PATH = 'docs/work/<item>/intent.md · spec.md · plan.md'; // i18n-ignore

  window.ProjectWizardWorkModel = function ({ cur, recommended }) {
    const M = window.OnboardingModel;
    // Standard and Full are not ready yet (the owner's call): shown, disabled, marked "Coming soon"; a pick of one of
    // them saved earlier falls back to the default
    const READY = ['light'];
    const picked = () => (READY.includes(cur()?.workModel) ? cur().workModel : M.DEFAULT_WORK_MODEL);
    const soon = (id) => (READY.includes(id) ? '' : ` <span class="badge wizard-soon" data-testid="wizard-work-model-soon">${esc(t('onboarding.coming_soon'))}</span>`);

    function onInput(e) {
      const id = String(e.target?.dataset?.testid || '');
      if (!id.startsWith('wizard-work-model-')) return false;
      const value = String(e.target.value || id.slice('wizard-work-model-'.length));
      if (!READY.includes(value)) return false;
      cur().workModel = value;
      return true;
    }

    // #851: Light, the default, carries the Recommended label, after a space: the radio's name reads
    // "Light Recommended …", not "LightRecommended …" (the badge is an inline element of the label)
    // each model a tile (an icon, its name, one line), the radio stretched invisible over it: one, two, three sheets
    const MODEL_ICON = { light: 'M4 2.5h8v11H4zM6.5 6h3M6.5 9h3', standard: 'M5.5 4.5h8v9h-8zM3 11V2.5h8M8 8h3M8 10.5h3', full: 'M6.5 6.5h7.5v7.5H6.5zM4.5 11.5V4.5H12M2.5 9.5v-7H10M9 10.2l1.2 1.2 2-2.4' };
    const choice = (id) => `<label class="wizard-choice wizard-model-tile${READY.includes(id) ? '' : ' disabled'}">
        <input type="radio" name="wizard-work-model" value="${esc(id)}" id="wizard-work-model-${esc(id)}" data-testid="wizard-work-model-${esc(id)}"${picked() === id ? ' checked' : ''}${READY.includes(id) ? '' : ' disabled'}>
        <span class="wizard-tile-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path d="${MODEL_ICON[id] || ''}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span><strong>${esc(t(`onboarding.work_model_${id}`))}${id === 'light' && recommended ? ` ${recommended()}` : ''}${soon(id)}</strong><span class="muted small">${esc(t(`onboarding.work_model_${id}_text`))}</span></span>
      </label>`;

    // "Where the files live": #851 only for Standard and Full (Light writes nothing to docs/work/)
    function files() {
      if (picked() === 'light') return '';
      const chip = (key, accent) => `<span class="wizard-chip${accent ? ' accent' : ''}">${esc(t(key))}</span>`;
      return `<div class="wizard-work-model-files" data-testid="wizard-work-model-files" title="${esc(t('onboarding.work_model_files_line'))}">
          <div class="wizard-work-model-where"><strong class="small">${esc(t('onboarding.work_model_files_title'))}</strong>
            <span class="wizard-chips">${chip('onboarding.work_model_chip_fix', true)}${chip('onboarding.work_model_chip_feature', true)}${chip('onboarding.work_model_chip_release', false)}</span></div>
          <div class="wizard-work-model-where"><span class="wizard-work-model-path">${esc(FILES_PATH)}</span><span class="small muted">${esc(t('onboarding.work_model_in_repo'))}</span></div>
        </div>`;
    }

    function section() {
      return `<section class="wizard-work-model" data-testid="wizard-work-model">
        <div class="wizard-work-model-head">
          <div class="wizard-column">
            <h3>${esc(t('onboarding.work_model_title', { name: cur().model.name }))}</h3>
            <p class="muted small">${esc(t('onboarding.work_model_line'))}</p>
          </div>
          ${files()}
        </div>
        <div class="wizard-starts wizard-model-tiles" role="radiogroup" aria-label="${esc(t('onboarding.work_model_title', { name: cur().model.name }))}">${M.WORK_MODELS.map(choice).join('')}</div>
      </section>`;
    }

    return {
      onInput,
      picked,
      section,
    };
  };
}());
