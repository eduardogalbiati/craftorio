/* global api, DefaultWorkflow, esc, state, t */
// #725: the new-project wizard's step 3 right column, "Suggested workflows" (mock-4, #630), split out of
// project-wizard.js (its size cap). window.ProjectWizardColumn({ costHint, cur, jobOf, phasesHtml }) gives the wizard, over
// its own state (`cur()`: the onboarding, the model, the owner's picks and cur.workflowsMode):
// - workflowsColumn(): wizard-workflows-column data-state = OnboardingModel.workflowsColumnState: choose
//   (wizard-workflows-choice-analyze / -manual, no rows; #74: Analyze says what it may cost, costHint(),
//   wizard-workflows-choice-cost), analyzing (wizard-workflows-rows aria-busy, inert,
//   selects disabled, under wizard-workflows-analyzing with the analysis' activity lines, #781 phasesHtml(),
//   project-wizard-activity.js), failed (wizard-workflows-failed: an ActivityLine with the reason and
//   wizard-workflows-retry, then Define manually), analyzed (the lines ended when the analysis ran in this wizard,
//   the rows with the profile's reasons, wizard-workflow-reason) and manual (the rows editable, no reason, Analyze
//   still offered). Each row: wizard-workflow data-kind with wizard-workflow-select (select.js, #383).
//   #790: a repository whose manifest declares a `default` gets one more row, data-kind="default", offering
//   the manifest's workflows on that default (cur.manifest, read by project-wizard.js; the owner's pick in
//   cur.workflows.default is the project's default at Finish).
//   #738: above the rows (analyzed and manual), wizard-way-of-working: Local / Remote / Fork + PR, from the
//   fork choice of a repository the owner can't push to, else the profile's mode.
// - cliWarning(cli), forkNotice(onboarding), forkPending(onboarding): the repository step's notices (the
//   CLI missing or signed out; #738 no push access: Create a fork / Work locally).
// - jobReason(job): a failed job in the interface's language from the engine's code (failureOf in
//   packages/engine/service/areas/project-onboarding.js), its reason else.
// - profileOf(), workflowChoices(), pickedWorkflows() (#729: Finish saves them as the project's workflows).
// - #850 profileSourceKey(): step 3's profile line key, "from your answers" (a new project) or "from the git history".
// - #21 sourceKey(key): step 3's text key for the source, `<key>_new` for a new project (heading, subtitle, suggestions).
// - #851 recommended(): the wizard-recommended label, on Analyze the repository here and on Light (work model).
// - #790 loadManifest(): reads cur.manifest for the Default row; pickedDefault(workflows): Finish's default.
// - #726 textOf(x): the model's i18n keys (a key, { key, params }, an array) in the interface's language: the
//   reasons (after the highlighted wizard-workflow-why "Why:" label), the selects' options, the profile line.
// Uses app.js globals (esc, t), window.OnboardingModel and window.Select.

(function () {
  const WORKFLOW_KINDS = ['feature', 'fix', 'release', 'ci'];

  window.ProjectWizardColumn = function ({ costHint, cur, jobOf, phasesHtml, renderSoon }) {
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
    // #850: where step 3's profile line says the profile comes from: a new project's (#632) is its step 2 answers,
    // an import's the git history
    const profileSourceKey = () => (cur().model.source === 'new' ? 'onboarding.profile_found_answers' : 'onboarding.profile_found');
    // #21: a step 3 text key for the wizard's source: a new project's own `<key>_new`, an import's `<key>`
    const sourceKey = (key) => (cur().model.source === 'new' ? `${key}_new` : key);
    // #21: the line above the suggested workflows: a new project's come from its step 2 answers, an import's from how it is worked on
    const suggestionsKey = () => sourceKey('onboarding.workflows_line');

    // #851: the "Recommended" label of the choice most owners should pick (Light, Analyze the repository)
    const recommended = () => `<span class="badge wizard-recommended" data-testid="wizard-recommended">${esc(t('onboarding.recommended'))}</span>`;

    // the repository step's warning when the platform's CLI is missing or signed out (wizard-cli-warning)
    function cliWarning(cli) {
      if (!cli || !['missing', 'signed-out'].includes(cli.status)) return '';
      const name = window.Platforms?.findPlatform?.(cli.provider)?.cli || cli.provider || '';
      return `<div class="wizard-alert warn" data-testid="wizard-cli-warning" data-error="cli-${esc(cli.status)}">
          <strong>${esc(t(cli.status === 'missing' ? 'onboarding.cli_missing' : 'onboarding.cli_signed_out', { cli: name }))}</strong>
          <p>${esc(cli.reason || '')}</p>
          <p class="muted small">${esc(t('onboarding.cli_hint'))}</p>
          <div class="wizard-actions"><button type="button" class="btn" data-act="setup">${esc(t('onboarding.open_setup'))}</button></div>
        </div>`;
    }

    // #738: the repository can't be pushed to (gh's permissions.push false): wizard-fork-notice suggests a
    // fork (wizard-create-fork) or working locally (wizard-work-locally) on the repository step; a failed
    // fork keeps the notice with its reason (the owner tries again or works locally)
    const forkPending = (o) => ['suggested', 'failed'].includes(o?.fork?.status);
    function forkNotice(o) {
      if (!forkPending(o)) return '';
      const failed = o.fork.status === 'failed' ? `<p class="small">${esc(t('onboarding.fork_failed', { error: o.fork.reason || t('onboarding.no_reason') }))}</p>` : '';
      const off = cur().busy ? ' disabled' : '';
      return `<div class="wizard-alert warn" data-testid="wizard-fork-notice">
          <strong>${esc(t('onboarding.fork_notice', { repo: o.fork.repo || '' }))}</strong>
          ${failed}
          <div class="wizard-actions"><button type="button" class="btn primary" data-act="fork-create" data-testid="wizard-create-fork"${off}>${esc(t('onboarding.fork_create'))}</button>
            <button type="button" class="btn" data-act="work-locally" data-testid="wizard-work-locally"${off}>${esc(t('onboarding.fork_work_locally'))}</button></div>
        </div>`;
    }

    // #738: the way of working (Local / Remote / Fork + PR): the fork choice of a repository the owner
    // can't push to (made or reused: fork, declined: local) over the profile's mode; null while unknown
    const wayOf = () => {
      const fork = cur().onboarding?.fork;
      if (['created', 'reused'].includes(fork?.status)) return 'fork';
      if (fork?.status === 'declined') return 'local';
      return profileOf()?.mode || null;
    };

    // #738: wizard-way-of-working, the mode's label as a badge (Local adds "no pull request"), shown in the
    // analyzed and manual states (Define manually keeps the fork choice)
    function wayOfWorking() {
      const mode = wayOf();
      if (!mode) return '';
      const label = [t(`onboarding.profile_mode_${mode}`), mode === 'local' ? t('onboarding.way_no_pull_request') : ''].filter(Boolean).join(' · ');
      return `<p class="small wizard-way-of-working"><span class="muted">${esc(t('onboarding.way_of_working'))}</span>
          <span class="badge" data-testid="wizard-way-of-working" data-mode="${esc(mode)}">${esc(label)}</span></p>`;
    }

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
    // #74: git's profile waiting for an analysis nobody asked for (a restart before its Oracle turn ended) is a choice again
    const unasked = () => cur().workflowsMode === 'analyze' && !cur().busy && cur().onboarding?.status === 'ready'
      && jobOf('profile').status === 'waiting' && !!jobOf('profile').profile;
    const columnMode = () => (unasked() ? undefined : cur().workflowsMode || (cur().model.source === 'new' ? 'analyze' : undefined));
    const columnState = () => M.workflowsColumnState({ mode: columnMode(), profileJob: { ...jobOf('profile'), profile: profileOf() } });

    // one of the two ways in (Analyze the repository / Define manually): a card with its hint, or a plain
    // button (`inline`, beside Retry); #851: Analyze the repository is the recommended one
    const choiceCost = (id, inline) => {
      const cost = id === 'analyze' && !inline ? costHint() : '';
      return cost ? `<span class="muted small" data-testid="wizard-workflows-choice-cost">${esc(cost)}</span>` : '';
    };
    const choiceButton = (id, inline = false) => `<button type="button" class="${inline ? 'btn' : 'card wizard-workflows-choice'}" data-act="workflows-${id}" data-testid="wizard-workflows-choice-${id}">
        <strong>${esc(t(`onboarding.workflows_choice_${id}`))}${id === 'analyze' ? recommended() : ''}</strong>${inline ? '' : `<span class="muted small">${esc(t(`onboarding.workflows_choice_${id}_hint`))}</span>`}${choiceCost(id, inline)}</button>`;

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
      // #790: the manifest's default, among the manifest's workflows
      const defaultRow = () => {
        const manifest = cur().manifest;
        const bare = (s) => String(s || '').replace(/\.ya?ml$/i, '');
        if (!manifest?.default) return '';
        const names = [...new Set([bare(manifest.default), ...(manifest.workflows || []).map((w) => bare(w?.name))].filter(Boolean))];
        const attrs = `data-testid="wizard-workflow-select" data-workflow-kind="default" aria-label="${esc(t('onboarding.workflow_default'))}"${busy ? ' disabled' : ''}`;
        return `<li class="card wizard-workflow" data-testid="wizard-workflow" data-kind="default">
          <label class="wizard-workflow-head"><strong>${esc(t('onboarding.workflow_default'))}</strong>
            ${window.Select.markup(attrs, names.map((n) => [n, n]), bare(cur().workflows?.default) || bare(manifest.default))}</label>
          <p class="muted small wizard-workflow-reason">${esc(t('onboarding.workflow_default_hint'))}</p>
        </li>`;
      };
      const head = `<h3>${esc(t('onboarding.workflows_title'))}</h3>
        <p class="muted">${esc(t(at === 'choose' ? 'onboarding.workflows_choose_line' : suggestionsKey(), { name }))}</p>`;
      let body;
      if (at === 'choose') body = `<div class="wizard-workflows-choices">${choiceButton('analyze')}${choiceButton('manual')}</div>`;
      else if (at === 'failed') {
        const job = jobOf('profile');
        // Retry: the engine's retry runs a failed profile job again, and one done without a valid profile
        const why = job.status === 'failed' ? jobReason(job) : t('onboarding.workflows_no_profile');
        const retry = { label: t('onboarding.retry'), attrs: 'data-act="retry" data-testid="wizard-workflows-retry"' };
        body = `<div class="wizard-alert error" data-testid="wizard-workflows-failed">
            <strong>${esc(t('onboarding.workflows_failed'))}</strong>
            <div title="${esc(job.error || '')}">${window.ActivityLine.html({ state: 'failed', reason: why, retry })}</div>
            <div class="wizard-actions">${choiceButton('manual', true)}</div>
          </div>`;
      } else {
        const list = `<ul class="wizard-workflows" data-testid="wizard-workflows-rows"${busy ? ' aria-busy="true" aria-disabled="true" inert' : ''}>${defaultRow()}${WORKFLOW_KINDS.map(row).join('')}</ul>`;
        const overlay = busy ? `<div class="wizard-workflows-analyzing" data-testid="wizard-workflows-analyzing" role="status">${phasesHtml()}</div>` : '';
        // #781: once analyzed in this wizard the lines stay, ended, with what they found (a new project's rows have no analysis)
        const ended = at === 'analyzed' && cur().workflowsMode === 'analyze' ? phasesHtml() : '';
        // Define manually keeps Analyze the repository on offer
        const analyze = at === 'manual' ? `<div class="wizard-workflows-choices">${choiceButton('analyze')}</div>` : '';
        body = `${ended}${busy ? '' : wayOfWorking()}<div class="wizard-workflows-stage">${list}${overlay}</div>${analyze}`;
      }
      return `<div class="wizard-column wizard-workflows-column" data-testid="wizard-workflows-column" data-state="${at}">${head}${body}
        <p class="muted small">${esc(t('onboarding.workflows_more'))}</p></div>`;
    }

    // #735: the review's project kind, confirmed by the owner (empty: the engine detects it from the
    // files, projectFacts); a backend gets no UI step. wizard-kind-select, cur().kind
    // #781: it opens on the kind the analysis found (profile.kind), marked wizard-kind-detected until the owner
    // changes it; "Detect from the files" stays only while no kind is known. Not changed, no kind is sent (#735)
    function kindField() {
      const labels = M.KIND_LABELS || {};
      const found = profileOf()?.kind;
      const detected = labels[found] ? found : '';
      const value = cur().kind || detected;
      const kinds = [...(detected ? [] : [['', t('onboarding.kind_detect')]]), ...Object.entries(labels).map(([v, key]) => [v, t(key)])];
      const attrs = `data-testid="wizard-kind-select" aria-label="${esc(t('ways_of_working.f_kind'))}"`;
      const control = window.Select.markup(attrs, kinds, value);
      const mark = detected && !cur().kind ? `<span class="small muted" data-testid="wizard-kind-detected">${esc(t('onboarding.kind_detected', { kind: t(labels[detected]) }))}</span>` : '';
      return `<div class="field"><span class="small muted">${esc(t('ways_of_working.f_kind'))}</span>${control}${mark}</div>`;
    }

    const recordOf = (pid) => (typeof state === 'object' && state?.projects?.find?.((p) => p.id === pid)) || null;

    // #790: the repository's workflows manifest (api.projectManifest: the clone's folder once the record has it,
    // else the URL), for step 3's Default row and Finish's default; read again when the folder becomes known
    function loadManifest() {
      const pid = cur().projectId;
      if (!pid || typeof api.projectManifest !== 'function') return;
      const folder = recordOf(pid)?.folder || '';
      const target = folder ? { folder } : { url: cur().model.repository };
      const key = JSON.stringify(target);
      if (cur().manifestFor === key) return;
      cur().manifestFor = key;
      const current = () => cur()?.projectId === pid && cur().manifestFor === key;
      Promise.resolve(api.projectManifest(target)).then((m) => {
        if (!current()) return;
        cur().manifest = m && typeof m === 'object' ? m : null;
        renderSoon();
      }).catch(() => { if (current()) cur().manifest = null; });
    }

    // #790: the default Finish saves: the owner's pick in the Default row, else the repository manifest's
    // `default`, else what the clone saved on the record (its manifest's default), else the first build
    // workflow; #791: the Feature and Fix picks stay in `workflows` with their variant
    // (projects.workflowForKind resolves them), a clone's manifest map stays on the record untouched
    function pickedDefault(workflows) {
      return cur().workflows?.default || cur().manifest?.default || recordOf(cur().projectId)?.defaultWorkflow || DefaultWorkflow.firstBuild(workflows) || 'feature';
    }

    return {
      cliWarning,
      forkNotice,
      forkPending,
      jobReason,
      loadManifest,
      pickedDefault,
      kindField,
      pickedWorkflows,
      profileOf,
      profileSourceKey,
      recommended,
      sourceKey,
      textOf,
      workflowChoices,
      workflowsColumn,
    };
  };
}());
