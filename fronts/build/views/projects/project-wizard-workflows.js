/* global esc, t */
// #725: the new-project wizard's step 3 right column, "Suggested workflows" (mock-4, #630), split out of
// project-wizard.js (its size cap). window.ProjectWizardColumn({ cur, jobOf }) gives the wizard, over its
// own state (`cur()`: the onboarding, the model, the owner's picks and cur.workflowsMode):
// - workflowsColumn(): wizard-workflows-column data-state = OnboardingModel.workflowsColumnState: choose
//   (wizard-workflows-choice-analyze / -manual, no rows), analyzing (wizard-workflows-rows aria-busy, inert,
//   selects disabled, under wizard-workflows-analyzing with wizard-workflows-spinner), failed
//   (wizard-workflows-failed: the reason, wizard-workflows-retry and Define manually), analyzed (the rows
//   with the profile's reasons, wizard-workflow-reason) and manual (the rows editable, no reason, Analyze
//   still offered). Each row: wizard-workflow data-kind with wizard-workflow-select (select.js, #383).
// - jobReason(job): a failed job in the interface's language from the engine's code (failureOf in
//   packages/engine/service/areas/project-onboarding.js), its reason else.
// - profileOf(), workflowChoices(), pickedWorkflows() (#729: Finish saves them as the project's workflows).
// - #726 textOf(x): the model's i18n keys (a key, { key, params }, an array) in the interface's language: the
//   reasons (after the highlighted wizard-workflow-why "Why:" label), the selects' options, the profile line.
// Uses app.js globals (esc, t), window.OnboardingModel and window.Select.

(function () {
  const WORKFLOW_KINDS = ['feature', 'fix', 'release', 'ci'];

  window.ProjectWizardColumn = function ({ cur, jobOf }) {
    const M = window.OnboardingModel;
    const jobReason = (job) => {
      const reason = job?.reason || job?.error || t('onboarding.no_reason');
      return M.FAILURE_CODES.includes(job?.code)
        ? t(`onboarding.job_failed_${job.code.replace(/-/g, '_')}`, { cli: job.cli || '', reason })
        : t('onboarding.job_failed', { reason });
    };

    // #726: a model text in the interface's language: a key, { key, params } (each param a key or
    // { key, params } too), or an array of those joined with ' · '
    const textOf = (x) => {
      if (Array.isArray(x)) return x.map(textOf).join(' · ');
      if (x && typeof x === 'object') {
        const params = Object.fromEntries(Object.entries(x.params || {}).map(([k, v]) => [k, typeof v === 'string' || (v && typeof v === 'object') ? textOf(v) : v]));
        return t(x.key, params);
      }
      return x ? t(String(x)) : '';
    };

    // #630 (mock-4): the ways-of-working profile { mode, ci, tests } the profile job found, or null
    const profileOf = () => cur().onboarding?.profile || jobOf('profile').profile || null;

    // one row per suggested workflow (feature, fix, release) and the CI row, each with why the profile
    // suggests it and its selector on the profile's pick (#630); the owner's pick stays (cur.workflows)
    const workflowChoices = () => [...M.suggestWorkflows(profileOf()).suggestions, M.ciChoice(profileOf())];

    // #729: step 3's picks as the project's workflows: feature, fix and release with their variant (the
    // owner's pick, else the profile's suggestion), the CI pick on release
    function pickedWorkflows() {
      const all = workflowChoices();
      const pick = (kind) => cur().workflows?.[kind] || all.find((x) => x.id === kind)?.value || '';
      // the category from the installed workflow's YAML (the app's state.workflows) when known, 'build' else
      const installed = (typeof state !== 'undefined' && Array.isArray(state.workflows)) ? state.workflows : [];
      const categoryOf = (name) => installed.find((w) => String(w.file || '').replace(/^.*[\\/]/, '').replace(/\.ya?ml$/, '') === name)?.category || 'build';
      return ['feature', 'fix', 'release'].map((name) => ({
        name, origin: 'bundled', category: categoryOf(name), variant: pick(name), ...(name === 'release' && pick('ci') ? { ci: pick('ci') } : {}),
      }));
    }

    // the column's state: a new project's (#632) profile is its three answers, so its rows show at once
    const columnState = () => M.workflowsColumnState({ mode: cur().workflowsMode || (cur().model.source === 'new' ? 'analyze' : undefined), profileJob: { ...jobOf('profile'), profile: profileOf() } });

    // one of the two ways in (Analyze the repository / Define manually): a card with its hint, or a plain
    // button (`inline`, beside Retry)
    const choiceButton = (id, inline = false) => `<button type="button" class="${inline ? 'btn' : 'card wizard-workflows-choice'}" data-act="workflows-${id}" data-testid="wizard-workflows-choice-${id}">
        <strong>${esc(t(`onboarding.workflows_choice_${id}`))}</strong>${inline ? '' : `<span class="muted small">${esc(t(`onboarding.workflows_choice_${id}_hint`))}</span>`}</button>`;

    // by its state: the two choices first; then the rows, dimmed under a loading notice while the profile
    // job runs, with the profile's reasons once it is done, without reasons when defined by hand; a failed
    // profile job gives its reason, Retry and Define manually
    function workflowsColumn() {
      const name = cur().model.name;
      const at = columnState();
      const all = workflowChoices();
      const busy = at === 'analyzing';
      const select = (kind, choices, value) => {
        const attrs = `data-testid="wizard-workflow-select" data-workflow-kind="${esc(kind)}" aria-label="${esc(t(`onboarding.workflow_${kind}`))}"${busy ? ' disabled' : ''}`;
        return window.Select.markup(attrs, choices.map((c) => [c.value, textOf(c.label)]), value);
      };
      const row = (kind) => {
        const s = all.find((x) => x.id === kind);
        // #726: "Why:" its own highlighted label, the reason after it in the interface's language
        const reason = at === 'analyzed'
          ? `<p class="muted small wizard-workflow-reason" data-testid="wizard-workflow-reason"><strong class="wizard-workflow-why" data-testid="wizard-workflow-why">${esc(t('onboarding.workflow_why_label'))}</strong> ${esc(textOf(s.reason))}</p>` : '';
        return `<li class="card wizard-workflow" data-testid="wizard-workflow" data-kind="${esc(kind)}">
          <label class="wizard-workflow-head"><strong>${esc(t(`onboarding.workflow_${kind}`))}</strong>
            ${select(kind, s.choices, cur().workflows?.[kind] || s.value)}</label>
          ${reason}
        </li>`;
      };
      const head = `<h3>${esc(t('onboarding.workflows_title'))}</h3>
        <p class="muted">${esc(t(at === 'choose' ? 'onboarding.workflows_choose_line' : 'onboarding.workflows_line', { name }))}</p>`;
      let body;
      if (at === 'choose') body = `<div class="wizard-workflows-choices">${choiceButton('analyze')}${choiceButton('manual')}</div>`;
      else if (at === 'failed') {
        const job = jobOf('profile');
        // Retry: the engine's retry runs a failed profile job again, and one done without a valid profile
        const why = job.status === 'failed' ? jobReason(job) : t('onboarding.workflows_no_profile');
        body = `<div class="wizard-alert error" role="alert" data-testid="wizard-workflows-failed">
            <strong>${esc(t('onboarding.workflows_failed'))}</strong>
            <p title="${esc(job.error || '')}">${esc(why)}</p>
            <div class="wizard-actions"><button type="button" class="btn primary" data-act="retry" data-testid="wizard-workflows-retry">${esc(t('onboarding.retry'))}</button>${choiceButton('manual', true)}</div>
          </div>`;
      } else {
        const list = `<ul class="wizard-workflows" data-testid="wizard-workflows-rows"${busy ? ' aria-busy="true" aria-disabled="true" inert' : ''}>${WORKFLOW_KINDS.map(row).join('')}</ul>`;
        const overlay = busy ? `<div class="wizard-workflows-analyzing" data-testid="wizard-workflows-analyzing" role="status">
            <span class="spinner" data-testid="wizard-workflows-spinner" role="progressbar" aria-label="${esc(t('onboarding.workflows_analyzing', { name }))}"></span>
            <span>${esc(t('onboarding.workflows_analyzing', { name }))}</span></div>` : '';
        // Define manually keeps Analyze the repository on offer
        const analyze = at === 'manual' ? `<div class="wizard-workflows-choices">${choiceButton('analyze')}</div>` : '';
        body = `<div class="wizard-workflows-stage">${list}${overlay}</div>${analyze}`;
      }
      return `<div class="wizard-column wizard-workflows-column" data-testid="wizard-workflows-column" data-state="${at}">${head}${body}
        <p class="muted small">${esc(t('onboarding.workflows_more'))}</p></div>`;
    }

    // #735: the review's project kind, confirmed by the owner (empty: the engine detects it from the
    // files, projectFacts); a backend gets no UI step. wizard-kind-select, cur().kind
    function kindField() {
      const value = cur().kind || '';
      const kinds = [['', t('onboarding.kind_detect')], ...Object.entries(M.KIND_LABELS || {}).map(([v, key]) => [v, t(key)])];
      const attrs = `data-testid="wizard-kind-select" aria-label="${esc(t('ways_of_working.f_kind'))}"`;
      const control = window.Select.markup(attrs, kinds, value);
      return `<div class="field"><span class="small muted">${esc(t('ways_of_working.f_kind'))}</span>${control}</div>`;
    }

    return {
      jobReason,
      kindField,
      pickedWorkflows,
      profileOf,
      textOf,
      workflowChoices,
      workflowsColumn,
    };
  };
}());
