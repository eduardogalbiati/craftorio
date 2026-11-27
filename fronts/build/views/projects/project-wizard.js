/* global api */
// @ts-check
// The new-project wizard (#641, onboarding step 4 of docs/work/first-project-onboarding/plan.md; spec
// R1-R3, R5): a modal over the page with the steps of OnboardingModel (packages/shared/onboarding-model.js),
// and the onboarding's progress tray. window.ProjectWizard = { open(), close() } opens it: Projects › New project
// (projects.js) and the Setup's First project step (#643, packages/ui-kit/setup.js); #741: open({ projectId }) (a
// card's Continue) resumes that project's onboarding at its saved step, Finish marks it finished, and the step and
// picks are saved at each change (project-wizard-resume.js); creating a project is the wizard only.
// - #project-wizard (data-testid="project-wizard", role="dialog"), laid out as the spec's mockups (#669,
//   docs/work/first-project-onboarding/images/mock-1, -2, -4, -6.jpg): the numbered pills over a divider
//   (wizard-steps, one wizard-step-pill data-step="<id>" per step reading "<n> <label>", the current one
//   aria-current="step", the done ones a check), the step with its own heading (#project-wizard-title), and
//   the footer over a divider (wizard-footer). The steps: start ("Add a project": wizard-source-import, selected
//   when the wizard opens, and wizard-source-new (#632: Create new project, below), each with its
//   wizard-card-icon and three points; wizard-other-sources with wizard-source-git-url, step 2's URL field,
//   and wizard-source-folder, api.pickFolder() then step 2 with the folder's file:// URL), repository (the
//   GitHub / GitLab toggle #wizard-provider read from the URL, the gh / glab badges wizard-cli-account
//   data-cli (api.onboardingAccounts when the wizard opens; the import's own check once the engine answered),
//   #wizard-repo with the signed-in account's repositories under it (wizard-repo-list, api.onboardingRepos:
//   one wizard-repo-option data-repo="owner/repo" each, a click fills the URL and the name), #wizard-name
//   (#739: it follows the URL, OnboardingModel.displayNameFromUrl, typed or picked, until the owner types a
//   name; cleared, it follows again), wizard-clone-into (the clone's folder, OnboardingModel.repoNameFromUrl);
//   #743: once Next is pressed, the access check and the clone are one wait in place: wizard-next shows
//   wizard-spinner and "Cloning <name>…" (disabled only while onboarding:start is in flight, #641), the fields read-only, no status card, then the analysis
//   step at once), analysis (wizard-analysis data-state = the workflows' state, one screen each: choose, the two cards
//   wizard-workflows-choice-analyze / -manual; analyzing, the progress in wizard-cost (wizard-progress, the jobs with
//   wizard-job-paid on one that will call a model, wizard-cost-total, data-part="profile" | "projectMap", #74,
//   project-wizard-costs.js; a failed job reads its reason wizard-job-error-<id> with wizard-job-retry-<id>,
//   api.retryOnboarding) and #781 the activity lines (project-wizard-activity.js); analyzed / manual, the workflows on
//   the whole width (wizard-workflows-column, #725, project-wizard-workflows.js: each row's choices as
//   wizard-workflow-tile) over the work model (project-wizard-work-model.js); wizard-clone-progress in the footer
//   (data-status = the clone job's status, wizard-spinner while it runs))
//   and review (#642, spec R10; project-wizard-review.js):
//   wizard-review with the project's block wizard-review-project (#781: wizard-review-languages, #852 its loading / failed
//   placeholder; #850: a new project's "How it is worked on" is its step 2 answer, no "analyses were skipped" line), wizard-review-city (Open the
//   city: Finish, then the project's City tab) / -findings / -backlog, each data-state="ready" | "pending" (its analysis still running: words
//   say so, #852 and wizard-review-running, spinner + "running", beside the card's action) | "failed" | "skipped" (its analysis answered without
//   a result) | "later" (the analyses were skipped), #730: one wizard-review-finding data-finding="<index>" per report
//   finding with wizard-review-create-issue / -prioritize, then its link wizard-review-finding-issue, #74 wizard-review-costs (what each analysis cost and the total), and the idea field
//   wizard-review-idea (an answer arriving while it has the focus renders at its blur). Navigation in the
//   footer: wizard-cancel (step 1: closes, nothing imported) or wizard-back, then wizard-next (step 3:
//   "Continue"; #100: disabled until the workflows are defined, by hand or by the analysis, and it starts nothing) or, on the review,
//   wizard-finish (never disabled, never waits): it closes the wizard on the project's page with its Next steps
//   card (openProject with nextSteps, project.js; #846: never the Start drawer), then sends the idea to the Inbox (no finding is filed without its own click, #730); an analysis still running at Finish shows a toast when it ends. wizard-close (×, Esc too) sits beside the pills.
// - #632 Create new project (mock-3, spec R4): its repository step is two columns: the name wizard-new-name,
//   the radios wizard-new-starts value="readme" (default) | "empty", the box wizard-new-remote (unchecked,
//   disabled while api.onboardingAccounts reports no gh / glab signed in) with its platform wizard-new-remote-provider and the hint wizard-new-remote-hint (<account>/<slug>), #25/#35 wizard-no-remote-hint (without a repository the issues live in a local backlog), the folder line
//   wizard-new-folder (<workspace>/projects/<slug>, #108: OnboardingModel.newProjectFolderName, <slug>-2… when a
//   project holds it), #108 wizard-name-required (the line under an empty name, the field's aria-describedby); then the questions
//   wizard-question data-question="mode" | "ci" | "release" | "kind" (#57: frontend / full-stack / backend,
//   saved as the project's kind) with their wizard-chip buttons (aria-pressed on the
//   pick, OnboardingModel.CREATE_ANSWERS / CREATE_DEFAULTS). Next (api.createOnboarding) creates it, ready at
//   once: step 3 ("Workflows") without the clone; a private repository not made shows wizard-remote-warning.
// - errors: wizard-error data-error="no-access" | "clone-failed" with the engine's reason and Retry
//   (api.retryOnboarding); no-access also offers Edit the URL (wizard-edit-repo: the fields open again for a new
//   import, the failed one stays in the tray); #107: an import refused before anything was made (no projectId)
//   shows its cause (repo-not-found | repo-no-access | not-a-git-repo) on the repository step, Edit the URL and Retry
//   start it again, typing clears it; the gh / glab warning wizard-cli-warning data-error="cli-missing" |
//   "cli-signed-out" (the import goes on) with Open Setup, on the repository and the analysis steps. #740: Open
//   Setup and Sign in open Settings › Agents & CLIs, the wizard hidden meanwhile (project-wizard-cli.js).
// - the provider (its label, its CLI) is the adapter of window.Platforms.platformOfRepoUrl, the engine's rule too;
//   amounts go through I18n.formatCost (the interface's language). Tab stays in the dialog; close() gives the focus back to what opened it.
// - #onboarding-tray (project-wizard-tray.js) follows onboarding:changed (api.onOnboardingChanged, subscribed when the script loads); #724: hidden while the wizard is open, the wizard shows the progress itself.
// - #732: onboarding:changed also reads api.listProjects again into state.projects (a new project, a status change such as the clone done), so the screens reading the cached list see the project and its folder.
// Channels: onboarding:start / create / analyze / retry (packages/engine/service/channels/onboarding.js),
// architecture:estimate and seeds:estimate (what the analyses may cost), and for the review architecture:city / facts / report,
// architecture:createIssue (never runNow), the backlog and api.createDiscoveryCard (an Inbox idea).
// window.ProjectWizard = { analyzing(projectId), close, open }: #846 analyzing is true while that project's onboarding clones or analyses it (ACTIVE, from onboarding:changed); the Start drawer then refuses analyze-project.
// Uses app.js globals (esc, t, showToast, errMsg), window.Actions and window.ProjectWizardCli.

(function () {
  const M = window.OnboardingModel;
  const JOBS = ['facts', 'profile', 'projectMap'];
  const PAID = ['projectMap'];
  // mock-2's toggle: the registry's platforms with a CLI (#351: no platform literal outside the adapters)
  const providers = () => (window.Platforms?.PLATFORMS || []).filter((p) => p.cli).map((p) => p.id);
  const svg = (d) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON = { check: svg('M3.5 8.5l3 3 6-7'), download: svg('M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10'), plus: svg('M8 3v10M3 8h10'), folder: svg('M1.5 4.5v8h13V6h-6L7.5 4.5z') };
  // the engine's statuses past the clone: the repository step goes on to the analysis by itself
  const CLONED = ['ready', 'analyzing', 'analyzed'];
  const ACTIVE = ['cloning', 'analyzing'];

  let root = null;
  // { model: OnboardingModel state, projectId, onboarding: the engine's state, estimate, profileEstimate, busy, provider (the
  // toggle's pick while the URL names none), and the
  // review's: review { backlog, city, facts, report } (undefined: not read yet), reading, filing (the finding
  // whose issue is being filed), idea }
  let cur = null;
  const freshReview = () => ({ review: {}, reading: new Set(), filing: null, idea: '', interview: null, backlogProgress: null, backlogError: null });
  let opener = null; // the element that had the focus when the wizard opened
  const names = new Map(); // projectId → the name typed in the wizard (the event carries no name)
  const states = new Map(); // projectId → the engine's last state, in arrival order
  const finished = new Set(); // projectIds finished in the wizard with an analysis still running
  const SPINNER = (testid) => `<span class="spinner" data-testid="${testid}" aria-hidden="true"></span>`;

  const platformOfRepo = (url) => window.Platforms?.platformOfRepoUrl?.(url) || null;
  const platformById = (id) => window.Platforms?.findPlatform?.(id) || null;
  const usd = (n) => (window.I18n?.formatCost ? window.I18n.formatCost(n) : `$${Number(n).toFixed(2)}`);
  const money = (n) => (n > 0 && n < 0.01 ? `< ${usd(0.01)}` : usd(n));
  const statusText = (s) => t(`onboarding.status_${s}`);
  // #725: Continue on the analysis step never waits for the analysis (running, done or failed); #100: it waits for
  // the workflows to be defined, by hand or by the analysis (a new project's rows show at once)
  const canNext = () => (cur.model.step === 'analysis' ? M.canGoNext(cur.model) && column.defined()
    : M.canGoNext(cur.model) && cur.onboarding?.status !== 'failed' && !cur.busy);
  // #738: the fork notice's two choices, each one engine call; the answer moves on to analysis
  // #79: push-fix, the push notice's setup-git button
  const FORK_CALLS = { 'fork-create': 'forkOnboarding', 'push-fix': 'setupGitOnboarding', 'work-locally': 'workLocallyOnboarding' };
  const activity = window.ProjectWizardActivity({ cur: () => cur, jobOf: (id) => jobOf(id), loadReview: () => loadReview(), platformLabel: (id) => platformById(id)?.label || id, renderSoon: () => renderSoon() }); // #781
  const column = window.ProjectWizardColumn({ cur: () => cur, jobOf: (id) => jobOf(id), costHint: () => costs.estimateText(), icons: () => ANSWER_ICON, phasesHtml: activity.analysisPhases, renderSoon: () => renderSoon() });
  const workModel = window.ProjectWizardWorkModel({ cur: () => cur, recommended: column.recommended }); // #633: step 3's work model section
  const resume = window.ProjectWizardResume({ close: () => close(), cur: () => cur, names, remember: (s) => remember(s), render: () => render(), toAnalysis: () => toAnalysis() });
  const {
    jobReason,
    kindField,
    pickedWorkflows,
    profileOf,
    workflowsColumn,
  } = column;
  // the repository step's notices (CLI missing or signed out; #738 no push access)
  const cliWarning = (cli) => column.cliWarning(cli);
  const forkNotice = (o) => column.forkNotice(o);
  const forkPending = (o) => column.forkPending(o);
  const pushNotice = (o) => column.pushNotice(o);
  const failedPaid = (s) => PAID.find((id) => s?.jobs?.[id]?.status === 'failed') || null;
  // #724: the progress tray, hidden while the wizard is open (project-wizard-tray.js)
  const tray = window.ProjectWizardTray({
    active: ACTIVE,
    failedPaid,
    finished,
    jobReason,
    names,
    remember: (s) => remember(s),
    shownInWizard: (pid) => cur?.projectId === pid,
    spinner: SPINNER,
    states,
    statusText,
    wizardOpen: () => !!cur && !root?.hidden, // #740: hidden while Settings › Agents & CLIs is open
  });
  // #740: the gh / glab error, Open Setup → Settings › Agents & CLIs (project-wizard-cli.js)
  const { errorBlock, openSetup, titleOf } = window.ProjectWizardCli({
    cur: () => cur,
    refresh: (checkAgain) => { tray.refresh(); if (checkAgain) loadAccounts(); },
    render: () => render(),
    root: () => root,
  });
  const retryButton = (id) => `<button type="button" class="btn sm" data-act="retry" data-testid="wizard-job-retry-${id}">${esc(t('onboarding.retry'))}</button>`;
  const costs = window.ProjectWizardCosts({ column, cur: () => cur, jobOf: (id) => jobOf(id), jobs: JOBS, money, paid: PAID, renderSoon: () => renderSoon(), retryButton }); // #74

  function stepper() {
    const at = M.STEPS.findIndex((s) => s.id === cur.model.step);
    // #632 (mock-3): a new project has no analysis to run, its step 3 is its workflows
    const label = (s) => (s.id === 'analysis' && cur.model.source === 'new' ? t('onboarding.step_analysis_new') : t(`onboarding.step_${s.id}`));
    const pill = (s, i) => `<li data-step="${s.id}" data-testid="wizard-step-pill" class="wizard-step${i < at ? ' done' : ''}"${i === at ? ' aria-current="step"' : ''}>
        <span class="wizard-step-num">${i < at ? ICON.check : i + 1}</span> ${esc(label(s))}</li>`;
    return `<ol class="wizard-steps" data-testid="wizard-steps">${M.STEPS.map(pill).join('')}</ol>`;
  }

  // a source card of step 1: its icon, title, line and three points (mock-1)
  function sourceCard(id, icon, extra) {
    const points = [1, 2, 3].map((n) => `<li>${esc(t(`onboarding.${id}_point_${n}`))}</li>`).join('');
    return `<span class="wizard-card-icon" data-testid="wizard-card-icon" aria-hidden="true">${icon}</span>
          <strong class="wizard-card-title">${esc(t(`onboarding.${id}_title`))}${extra}</strong>
          <span class="muted">${esc(t(`onboarding.${id}_text`))}</span>
          <ul class="wizard-points">${points}</ul>`;
  }

  function startStep() {
    // the folder card is an import too (its file:// URL): cur.fromFolder tells the two cards apart
    const source = cur.model.source === 'new' ? 'new' : cur.fromFolder ? 'folder' : 'import';
    const picked = (s) => (source === s ? ' selected' : '');
    return `<h2 id="project-wizard-title">${esc(t('onboarding.start_title'))}</h2>
      <p class="muted">${esc(t('onboarding.start_line'))}</p>
      <div class="wizard-sources">
        <button type="button" class="card wizard-source${picked('new')}" data-act="source-new" data-testid="wizard-source-new" aria-pressed="${source === 'new'}">
          ${sourceCard('new', ICON.plus, '')}
        </button>
        <button type="button" class="card wizard-source${picked('import')}" data-act="source-import" data-testid="wizard-source-import" aria-pressed="${source === 'import'}">
          ${sourceCard('import', ICON.download, '')}
        </button>
        <button type="button" class="card wizard-source${picked('folder')}" data-act="source-folder" data-testid="wizard-source-folder" aria-pressed="${source === 'folder'}">
          ${sourceCard('folder', ICON.folder, '')}
        </button>
      </div>
      <p class="wizard-other muted" data-testid="wizard-other-sources">${esc(t('onboarding.other_sources'))}
        <button type="button" class="link-btn" data-act="source-git-url" data-testid="wizard-source-git-url">${esc(t('onboarding.source_git_url'))}</button></p>`;
  }

  // the provider: read from the URL, else the one picked on the toggle (GitHub by default)
  const pickedProvider = () => platformOfRepo(cur.model.repository)?.id || cur.provider || window.Platforms?.DEFAULT_PLATFORM || providers()[0];

  // the platform's own mark (the Setup's logos, setup.js), else its initial
  const providerLogo = (id) => window.SetupRows?.LOGOS?.[platformById(id)?.cli || ''] || esc((platformById(id)?.label || id).slice(0, 1));
  // a provider's sign-in line in its tile: the import's own check once the engine answered (its provider only),
  // else gh / glab on this machine
  function cliStatus(id) {
    const o = cur.onboarding?.cli;
    if (o) return o.provider === id ? cliBadge(o) : '';
    const a = (cur.accounts || []).find((x) => x.provider === id);
    return a ? accountBadge(a) : '';
  }
  // mock-2's GitHub / GitLab toggle as two tiles (logo, name, the CLI's sign-in): it follows the URL as it is
  // typed (onInput) and picks the hint
  function providerToggle() {
    const on = pickedProvider();
    const b = (id) => `<button type="button" class="wizard-provider-tile${on === id ? ' active' : ''}" id="wizard-provider-${id}" data-act="provider" data-provider="${id}" aria-pressed="${on === id}">
          <span class="wizard-tile-icon wizard-provider-logo" data-logo="${esc(platformById(id)?.cli || id)}" aria-hidden="true">${providerLogo(id)}</span>
          <span class="wizard-tile-title">${esc(platformById(id)?.label || id)}</span>
          <span class="wizard-provider-status" id="wizard-cli-status-${id}">${cliStatus(id)}</span></button>`;
    return `<div class="wizard-provider" id="wizard-provider" data-testid="wizard-provider" role="group" aria-label="${esc(t('onboarding.provider_label'))}">${providers().map(b).join('')}</div>`;
  }

  // the provider's CLI as the engine found it (gh signed in, glab missing…)
  function cliBadge(cli) {
    const name = platformById(cli.provider)?.cli || cli.provider || '';
    const key = cli.status === 'ok' ? 'onboarding.cli_ok' : cli.status === 'missing' ? 'onboarding.cli_missing' : 'onboarding.cli_signed_out';
    return `<span class="badge ${cli.status === 'ok' ? 'cli-ok' : 'cli-off'}">${esc(t(key, { cli: name }))}</span>`;
  }

  // gh / glab on this machine before any import (mock-2: "gh signed in as eduardo", "glab not signed in")
  function accountBadge(a) {
    const key = !a.installed ? 'onboarding.cli_not_installed' : !a.signedIn ? 'onboarding.cli_not_signed_in'
      : a.account ? 'onboarding.cli_signed_in_as' : 'onboarding.cli_ok';
    return `<span class="badge ${a.signedIn ? 'cli-ok' : 'cli-off'}" data-testid="wizard-cli-account" data-cli="${esc(a.cli || '')}">${esc(t(key, { cli: a.cli || '', account: a.account || '' }))}</span>`;
  }

  // mock-2's list under the field (#848, #103: project-wizard-repos.js)
  const repoUrl = (name) => `https://${(platformById(pickedProvider()) || platformById(window.Platforms?.DEFAULT_PLATFORM))?.host}/${name}`;
  const { repoList } = window.ProjectWizardRepos({ cur: () => cur, pickedProvider: () => pickedProvider(), platformById, repoUrl });

  // the badges and the list arrive after the step is drawn: only their own parts change (the caret stays)
  function refreshAccounts() {
    // #632: the create step's box and platforms follow the sign-in; a render unless the name is being typed
    if (cur.model.step === 'repository' && cur.model.source === 'new') {
      if (document.activeElement?.id === 'wizard-new-name') refreshCreate(); else render();
      return;
    }
    for (const id of providers()) { const status = document.getElementById(`wizard-cli-status-${id}`); if (status) status.innerHTML = cliStatus(id); }
    repoSlot();
  }
  function repoSlot() { const slot = document.getElementById('wizard-repo-slot'); if (slot) slot.innerHTML = repoList(); }

  // read once per opening of the wizard: gh / glab's sign-in, then each signed-in account's repositories
  async function loadAccounts() {
    const mine = cur;
    const accounts = await Promise.resolve().then(() => api.onboardingAccounts()).catch(() => null);
    if (cur !== mine || !Array.isArray(accounts)) return;
    cur.accounts = accounts;
    refreshAccounts();
    await Promise.all(accounts.filter((a) => a.signedIn).map(async (a) => {
      const repos = await Promise.resolve().then(() => api.onboardingRepos(a.provider)).catch(() => null);
      if (cur !== mine || !Array.isArray(repos)) return;
      cur.repos[a.provider] = repos;
      refreshAccounts();
    }));
  }

  // the repository the import sends: the short form of the placeholder and of mock-2 (`acme/shop`, no scheme,
  // no `@` or `:`) is the picked provider's https URL; a URL or a local folder stays as typed
  const SHORT_REPO = /^[A-Za-z0-9_][\w.-]*(\/[\w.-]+)+$/;
  const typedRepo = () => {
    const repo = cur.model.repository.trim();
    return SHORT_REPO.test(repo) ? repoUrl(repo.replace(/\.git$/, '')) : repo;
  };

  // mock-2's line under the fields: where the engine clones the repository (its rule, OnboardingModel.repoNameFromUrl)
  const cloneFolder = () => `<workspace>/repos/${M.repoNameFromUrl(typedRepo())}`; // i18n-ignore
  const cloneInto = () => (cur.model.repository.trim() ? cloneFolder() : ''); // under its own label ("The copy goes to")

  // a local folder as the repository (step 1's folder card, or an onboarding resumed on one), as a path people
  // read; its file:// URL stays the repository
  const pickedFolder = () => (/^file:\/\//i.test(cur.model.repository) ? windowsPath(decodeURI(cur.model.repository.replace(/^file:\/\//i, '')).replace(/^\/([A-Za-z]:)/, '$1')) : '');
  // a Windows drive path with backslashes, as Explorer shows it
  const windowsPath = (path) => (/^[A-Za-z]:/.test(path) ? path.replace(/\//g, '\\') : path);

  // step 2 for a folder: its path and Change folder, without the GitHub / GitLab parts of an import
  function folderStep(o, locked) {
    const path = pickedFolder();
    const into = cloneFolder();
    return `<div class="wizard-columns">
        <div class="wizard-column">
          <h2 id="project-wizard-title">${esc(t('onboarding.folder_title'))}</h2>
          <div class="wizard-fields">
            <label class="wizard-field wizard-name-lead"><span>${esc(t('onboarding.name_label'))}</span>
              <input id="wizard-name" data-testid="wizard-name" type="text" value="${esc(cur.model.name)}"${locked}></label>
            <div class="wizard-field" role="group" aria-labelledby="wizard-folder-label"><span id="wizard-folder-label">${esc(t('onboarding.folder_label'))}</span>
              <div class="wizard-folder">
                <span class="wizard-folder-box">${ICON.folder}<code class="wizard-folder-path" data-testid="wizard-folder-path" title="${esc(path)}">${esc(path)}</code></span>
                <button type="button" class="btn sm" data-act="pick-folder" data-testid="wizard-folder-change"${cur.projectId || cur.busy ? ' disabled' : ''}>${esc(t('onboarding.folder_change'))}</button>
              </div>
              <input id="wizard-repo" data-testid="wizard-repo" type="hidden" value="${esc(cur.model.repository)}">
              <span class="muted small">${esc(t('onboarding.folder_help'))}</span></div>
          </div>
        </div>
        <div class="wizard-column">
          <h3>${esc(t('onboarding.folder_next_title'))}</h3>
          <ul class="wizard-points">${[1, 2, 3].map((n) => `<li>${esc(t(`onboarding.folder_next_${n}`))}</li>`).join('')}</ul>
          <div class="wizard-field"><span>${esc(t('onboarding.folder_into_label'))}</span>
            <p class="mono wizard-work-model-path" id="wizard-clone-into" data-testid="wizard-clone-into" title="${esc(into)}">${esc(into)}</p></div>
        </div>
      </div>
      ${o?.status === 'failed' ? errorBlock(o) : ''}
      ${o ? cliWarning(o.cli) : ''}`;
  }

  function repositoryStep() {
    const o = cur.onboarding;
    // #743: read-only from Next on (the access check and the clone are one wait, shown on the Next button)
    const locked = cur.projectId || cur.busy ? ' readonly' : '';
    if (pickedFolder()) return folderStep(o, locked);
    return `<div class="wizard-columns wizard-import">
        <div class="wizard-column">
          <h2 id="project-wizard-title">${esc(t('onboarding.import_title'))}</h2>
          <div class="wizard-fields">
            <label class="wizard-field wizard-name-lead"><span>${esc(t('onboarding.name_label'))}</span>
              <input id="wizard-name" data-testid="wizard-name" type="text" value="${esc(cur.model.name)}" placeholder="${esc(t('onboarding.name_placeholder_import'))}"${locked}></label>
            <div class="wizard-field wizard-pick"><span>${esc(t('onboarding.repo_pick_label'))}</span>
              <div class="wizard-pick-bar">${providerToggle()}
                <input id="wizard-repo-filter" data-testid="wizard-repo-filter" type="text" spellcheck="false" value="${esc(cur.repoFilter || '')}" placeholder="${esc(t('onboarding.repo_filter'))}" aria-label="${esc(t('onboarding.repo_filter'))}"${cur.projectId ? ' disabled' : ''}></div>
              <div id="wizard-repo-slot">${repoList()}</div></div>
            <label class="wizard-field wizard-repo-url"><span>${esc(t('onboarding.repo_url_label'))}</span>
              <input id="wizard-repo" data-testid="wizard-repo" type="text" spellcheck="false" value="${esc(cur.model.repository)}" placeholder="${esc(t(`onboarding.repo_placeholder_${pickedProvider()}`))}"${locked}>
              <span class="muted small">${esc(t('onboarding.repo_help'))}</span></label>
          </div>
        </div>
        <div class="wizard-column">
          <h3>${esc(t('onboarding.folder_next_title'))}</h3>
          <ul class="wizard-points">${[1, 2, 3].map((n) => `<li>${esc(t(`onboarding.import_next_${n}`))}</li>`).join('')}</ul>
          <div class="wizard-field"><span>${esc(t('onboarding.folder_into_label'))}</span>
            <p class="mono wizard-work-model-path" id="wizard-clone-into" data-testid="wizard-clone-into" data-empty="&lt;workspace&gt;/repos/…">${esc(cloneInto())}</p></div>
        </div>
      </div>
      ${o?.status === 'failed' ? errorBlock(o) : ''}
      ${forkNotice(o)}
      ${o ? cliWarning(o.cli) : ''}`;
  }

  // #632 (mock-3): Create new project. The accounts signed in with gh / glab, the platform the private
  // repository goes to (the owner's pick, else the first signed in), the new project's slug and folder
  const signedIn = () => (cur.accounts || []).filter((a) => a.signedIn && providers().includes(a.provider));
  const remoteProvider = () => cur.remoteProvider || signedIn()[0]?.provider || providers()[0];
  const newSlug = () => M.slugify(cur.model.name);
  // #108: the folder it really gets, <slug>-2… when a project (cur.taken, api.listProjects at open) holds the slug
  // a resumed project already has its folder (the taken list holds its own id)
  const newFolder = () => `<workspace>/projects/${cur.projectId || M.newProjectFolderName(cur.model.name, cur.taken)}`; // i18n-ignore
  async function loadTaken() {
    const list = await Promise.resolve(api.listProjects?.()).catch(() => null);
    if (!cur || !Array.isArray(list)) return;
    cur.taken = list.map((p) => p.id);
    if (cur.model.source === 'new' && cur.model.step === 'repository') refreshCreate();
  }
  // the answer's i18n key: pr+release → onboarding.new_ci_pr_release
  // #57: the kind's chips read the kinds' own labels (KIND_LABELS)
  const answerLabel = (q, v) => t(q === 'kind' && M.KIND_LABELS?.[v] ? M.KIND_LABELS[v] : `onboarding.new_${q}_${String(v).replace(/[^a-z0-9]+/gi, '_')}`);

  // under the box: the repository it makes (<account>/<slug>), or how to sign in when no CLI is
  function remoteHint() {
    if (!signedIn().length) return t('onboarding.new_remote_hint_none', { clis: providers().map((id) => platformById(id)?.cli || id).join(' / ') });
    const on = remoteProvider();
    const account = signedIn().find((a) => a.provider === on)?.account;
    const other = platformById(providers().find((id) => id !== on));
    return t('onboarding.new_remote_hint', { repo: account ? `${account}/${newSlug()}` : newSlug(), other: other?.label || '', cli: other?.cli || '' });
  }

  // the platforms to pick, the ones not signed in disabled; the app's select markup (#383)
  function remoteSelect(locked) {
    const ins = signedIn().map((a) => a.provider);
    const options = providers().map((id) => [id, platformById(id)?.label || id, { disabled: !ins.includes(id) }]);
    const attrs = `id="wizard-new-remote-provider" data-testid="wizard-new-remote-provider" aria-label="${esc(t('onboarding.provider_label'))}"${locked || !ins.length ? ' disabled' : ''}`;
    return window.Select.markup(attrs, options, remoteProvider());
  }

  // the answers' icons (16px strokes, as ICON), by question and value
  const ANSWER_ICON = {
    mode: { local: 'M2.5 3.5h11v7h-11zM1 13h14', remote: 'M4 5.5v5M5.5 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M5.5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M13.5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M12 10.5V7a2 2 0 0 0-2-2H7.5M9 3.5 7.5 5 9 6.5' },
    ci: { none: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11M4.2 11.8l7.6-7.6', release: 'M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11zM2.5 5 8 7.5 13.5 5M8 7.5v6', 'pr+release': 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11M5.5 8.2l1.8 1.8 3.4-3.8' },
    release: { milestone: 'M2.5 2.5h5l6 6-5 5-6-6zM5.3 5.3h.01', 'per-merge': 'M6 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M6 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M13 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M4.5 5.5v5M4.5 5.5c0 2.5 2 3.5 5.5 3.5', train: 'M3 3.5h10v9H3zM3 6.5h10M5.5 2v3M10.5 2v3', 'rc-stable': 'M2.5 8h7M7 4.5 10.5 8 7 11.5M13 4v8' },
    tests: { e2e: 'M2 3.5h12v9H2zM2 6h12M5.8 9.3l1.4 1.4 3-3.1', code: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5' },
    kind: { frontend: 'M2 3.5h12v9H2zM2 6h12', 'full-stack': 'M8 2.5 2.5 5.5 8 8.5l5.5-3zM2.5 8 8 11l5.5-3M2.5 10.5 8 13.5l5.5-3', backend: 'M2.5 3h11v4h-11zM2.5 9h11v4h-11zM5 5h.01M5 11h.01' },
  };

  // one question of the right column: its title and its answers as tiles (an icon, a short title and one
  // line on what it means), the picked one aria-pressed; a tile's accessible name is the answer's whole label
  function question(q, locked) {
    const tile = (v) => {
      const key = `onboarding.tile_${q}_${String(v).replace(/[^a-z0-9]+/gi, '_')}`;
      return `<button type="button" class="wizard-chip" data-act="answer" data-question="${q}" data-value="${esc(v)}" data-testid="wizard-chip" aria-label="${esc(answerLabel(q, v))}" aria-pressed="${cur.answers[q] === v}"${locked}>
          <span class="wizard-tile-icon" aria-hidden="true">${ANSWER_ICON[q]?.[v] ? svg(ANSWER_ICON[q][v]) : ''}</span>
          <span class="wizard-tile-title">${esc(t(key))}</span>
          <span class="wizard-tile-text">${esc(t(`${key}_text`))}</span></button>`;
    };
    const answers = M.CREATE_ANSWERS[q];
    return `<div class="wizard-question" data-testid="wizard-question" data-question="${q}" role="group" aria-labelledby="wizard-question-${q}">
        <span class="wizard-question-title" id="wizard-question-${q}">${esc(t(`onboarding.new_${q}`))}</span>
        <div class="wizard-chips" data-count="${answers.length}">${answers.map(tile).join('')}</div>
      </div>`;
  }

  function createStep() {
    // once created (Back from step 3), the step shows what was sent
    const locked = cur.projectId ? ' disabled' : '';
    const required = !cur.projectId && M.nameRequired(cur.model); // #108: the line under an empty name
    const starts = (v) => `<label class="wizard-choice"><input type="radio" name="wizard-new-starts" data-testid="wizard-new-starts" value="${v}"${cur.starts === v ? ' checked' : ''}${locked}>
          <span><strong>${esc(t(`onboarding.new_${v}`))}</strong><span class="muted small">${esc(t(`onboarding.new_${v}_text`))}</span></span></label>`;
    return `<div class="wizard-columns">
        <div class="wizard-column">
          <h2 id="project-wizard-title">${esc(t('onboarding.new_title'))}</h2>
          <label class="wizard-field wizard-name-lead"><span>${esc(t('onboarding.name_label'))}</span>
            <input id="wizard-new-name" data-testid="wizard-new-name" type="text" value="${esc(cur.model.name)}" aria-describedby="wizard-name-required"${cur.projectId ? ' readonly' : ''}></label>
          <p class="error small" id="wizard-name-required" data-testid="wizard-name-required"${required ? '' : ' hidden'}>${esc(required ? t(required) : '')}</p>
          <div class="wizard-field"><span>${esc(t('onboarding.new_folder_label'))}</span>
            <p class="mono wizard-work-model-path" id="wizard-new-folder" data-testid="wizard-new-folder" title="${esc(newFolder())}">${esc(newFolder())}</p></div>
          <fieldset class="wizard-starts"><legend>${esc(t('onboarding.new_starts'))}</legend>${['readme', 'empty'].map(starts).join('')}</fieldset>
          <div class="wizard-remote">
            <label class="wizard-choice"><input type="checkbox" id="wizard-new-remote" data-testid="wizard-new-remote"${cur.remote ? ' checked' : ''}${locked || !signedIn().length ? ' disabled' : ''}>
              <strong>${esc(t('onboarding.new_remote'))}</strong></label>
            ${remoteSelect(locked)}
            <p class="muted small wizard-remote-hint" id="wizard-new-remote-hint" data-testid="wizard-new-remote-hint">${esc(remoteHint())}</p><p class="muted small" data-testid="wizard-no-remote-hint">${esc(t('onboarding.no_remote_hint'))}</p>
          </div>
          ${cur.onboarding ? remoteWarning(cur.onboarding.remote) : ''}
        </div>
        <div class="wizard-column">
          <h3>${esc(t('onboarding.new_questions'))}</h3>
          ${Object.keys(M.CREATE_ANSWERS).map((q) => question(q, locked)).join('')}
        </div>
      </div>`;
  }

  // the private repository asked for and not made (gh signed out, the CLI failed): the local project stays;
  // while gh / glab creates it, a muted line
  function remoteWarning(remote) {
    if (remote?.status === 'creating') {
      return `<p class="muted small" data-testid="wizard-remote-creating">${esc(t('onboarding.new_remote_creating', { provider: platformById(remote.provider)?.label || remote.provider }))}</p>`;
    }
    if (!remote || remote.status === 'created') return '';
    return `<div class="wizard-alert warn" data-testid="wizard-remote-warning" data-error="remote-${esc(remote.status)}">
        <strong>${esc(t('onboarding.new_remote_failed'))}</strong>
        <p>${esc(remote.reason || t('onboarding.no_reason'))}</p>
      </div>`;
  }

  // the create step's live parts as the name is typed or gh / glab answers (the caret stays)
  function refreshCreate() {
    const box = /** @type {HTMLInputElement | null} */ (document.getElementById('wizard-new-remote'));
    if (box) box.disabled = !!cur.projectId || !signedIn().length;
    const hint = document.getElementById('wizard-new-remote-hint');
    if (hint) hint.textContent = remoteHint();
    const folder = document.getElementById('wizard-new-folder');
    if (folder) { folder.textContent = newFolder(); folder.setAttribute?.('title', newFolder()); }
    const line = document.getElementById('wizard-name-required');
    const required = !cur.projectId && M.nameRequired(cur.model);
    if (line) { line.hidden = !required; line.textContent = required ? t(required) : ''; }
  }

  function analysisStep() {
    const o = cur.onboarding || {};
    // one screen at a time, by the workflows' state (data-state): the two ways in (choose); the progress of the
    // analysis (analyzing: the bar, the jobs and their cost, the activity lines); then the workflows on the whole width
    // with the work model under them (analyzed, manual). The jobs also show while one of them failed (reason, Retry)
    const at = column.state();
    const rows = at === 'analyzed' || at === 'manual';
    return `<div class="wizard-analysis" data-state="${at}">
        <h2 id="project-wizard-title">${esc(t(column.sourceKey('onboarding.analyze_title'), { name: cur.model.name }))}</h2>
        ${at === 'analyzing' ? `<p class="muted">${esc(t(column.sourceKey('onboarding.read_only')))}</p>` : ''}
        ${costs.costBlock({ rows: at === 'analyzing' || at === 'failed', running: o.status === 'analyzing' })}
        ${o.status === 'failed' ? errorBlock(o) : ''}
        ${cliWarning(o.cli)}
        ${remoteWarning(o.remote)}
        ${pushNotice(o)}
        ${workflowsColumn()}
        ${rows ? workModel.section() : ''}
      </div>`;
  }

  const jobOf = (id) => cur.onboarding?.jobs?.[id] || {};
  const jobDone = (id) => jobOf(id).status === 'done';
  // an analysis was asked for: it runs or ran, or the engine waits for the clone to start it (#100, #102)
  const analysisAsked = () => ['analyzing', 'analyzed'].includes(cur.onboarding?.status) || !!cur.onboarding?.wanted;

  const review = window.ProjectWizardReview({ activity, analysisAsked, column, costs, cur: () => cur, jobOf: (id) => jobOf(id), jobReason, kindField, platformOfRepo, profileOf,
    pushNotice, render: () => render(), renderSoon: () => renderSoon(), retryButton, spinner: SPINNER }); // the review step (project-wizard-review.js)
  const { createIssue, reviewStep } = review;

  const BODY = { analysis: analysisStep, repository: () => (cur.model.source === 'new' ? createStep() : repositoryStep()), review: reviewStep, start: startStep };

  // the analysis step's footer: "Cloning <name>", a bar and the clone job's status (mock-4); #724: the
  // import's progress stays in the wizard: a spinner while the clone runs (a failure's reason and Retry are
  // the step's errorBlock, above)
  function cloneProgress() {
    const s = jobOf('clone').status || (CLONED.includes(cur.onboarding?.status) ? 'done' : 'running');
    return `<div class="card wizard-clone-progress" data-testid="wizard-clone-progress" data-status="${esc(s)}">
        ${s === 'running' ? SPINNER('wizard-spinner') : ''}<span class="text-cut" title="${esc(cur.model.name)}">${esc(t(s === 'done' ? 'onboarding.cloned_name' : 'onboarding.cloning_name', { name: cur.model.name }))}</span>
        <span class="wizard-bar job-${esc(s)}" aria-hidden="true"></span>
        <span class="badge job-${esc(s)}">${esc(t(`onboarding.job_status_${s}`))}</span>
      </div>`;
  }

  // #743: the repository step's Next while the access check and the clone run: a spinner and
  // "Cloning <name>…" in place (no card under the fields), until the analysis step; disabled only while
  // the start call is in flight, then a click goes on to the analysis while the clone runs (#641)
  const cloningInPlace = () => cur.model.step === 'repository' && cur.model.source !== 'new'
    && (cur.busy || cur.onboarding?.status === 'cloning');

  function render() {
    if (!root || !cur) return;
    const step = cur.model.step;
    // #725: Continue to the review at any point of the analysis step (analyzing starts from the workflows
    // column); review is the last step
    const showNext = step !== 'review';
    // #632: a new project is not cloned (mock-3's plain Next)
    const nextLabel = step === 'analysis' ? 'onboarding.continue'
      : step === 'repository' && cur.model.source !== 'new' ? 'onboarding.next_clone' : 'onboarding.next';
    const cloning = cloningInPlace();
    const nextText = cloning ? `${SPINNER('wizard-spinner')}${esc(t('onboarding.cloning_wait', { name: cur.model.name.trim() }))}` : esc(t(nextLabel));
    const next = showNext ? `<button type="button" class="btn primary" id="wizard-next" data-act="next" data-testid="wizard-next"${cloning ? ' aria-busy="true"' : ''}${canNext() && !cur.busy ? '' : ' disabled'}>${nextText}</button>` : '';
    const back = step === 'start'
      ? `<button type="button" class="btn" data-act="cancel" data-testid="wizard-cancel">${esc(t('onboarding.cancel'))}</button>`
      : `<button type="button" class="btn" data-act="back" data-testid="wizard-back">${esc(t('onboarding.back'))}</button>`;
    // Finish never waits: not disabled by an analysis still running nor by a call in flight
    const finish = step === 'review' ? `<button type="button" class="btn primary" data-act="finish" data-testid="wizard-finish">${esc(t('onboarding.finish'))}</button>` : '';
    // Cancel / Back beside the step's action on the right on every step, as the Setup's footer (mock-4: the
    // clone's progress on the left)
    const foot = `${step === 'analysis' && cur.model.source !== 'new' ? cloneProgress() : ''}<span class="wizard-spacer"></span>${back}${next}${finish}`;
    root.innerHTML = `<div class="wizard-panel wizard-at-${step}" data-testid="wizard-panel" tabindex="-1">
        <header class="wizard-head">
          ${stepper()}
          <button type="button" class="btn ghost wizard-close" data-act="close" data-testid="wizard-close" aria-label="${esc(t('common.close'))}">×</button>
        </header>
        <section class="wizard-body">${cur.exists ? resume.existsBody() : BODY[step]()}</section>
        <footer class="wizard-foot" data-testid="wizard-footer">${cur.exists ? back : foot}</footer>
      </div>`;
    // #108: a no-op in a real DOM; the unit tests' fake DOM keeps an element by id across innerHTML
    const nextBtn = /** @type {HTMLButtonElement | null} */ (showNext ? document.getElementById('wizard-next') : null);
    if (nextBtn) nextBtn.disabled = !(canNext() && !cur.busy);
    resume.save();
  }

  // ---- the engine's state ----------------------------------------------------------------------

  // a render from an answer or an event waits while the owner types the idea (the caret stays): the
  // idea field's blur renders what arrived meanwhile
  function renderSoon() {
    if (cur && document.activeElement?.id === 'wizard-review-idea') { cur.stale = true; return; }
    render();
  }

  function remember(state) {
    if (!state?.projectId) return;
    costs.onState(states.get(state.projectId), state); // #74: the header's cost
    states.delete(state.projectId);
    states.set(state.projectId, state);
    tray.scheduleLeave(state);
    tray.render();
    // #632: the project being created, pushed before create() answers (its remote: creating)
    if (cur && !cur.projectId && cur.creating && state.name === cur.creating) {
      cur.projectId = state.projectId;
      names.set(state.projectId, state.name);
    }
    // spec R10: what was left at Finish arrives on the project's page with a notification
    if (finished.has(state.projectId) && ['analyzed', 'failed'].includes(state.status)) {
      finished.delete(state.projectId);
      const name = names.get(state.projectId) || state.projectId;
      // #725: analyzed with a failed paid job is a stopped analysis too
      showToast(t(state.status === 'analyzed' && !failedPaid(state) ? 'onboarding.finished_analyzed' : 'onboarding.finished_failed', { name }));
    }
    if (cur && cur.projectId === state.projectId) {
      cur.onboarding = state;
      // #738: the fork suggestion holds the repository step until the owner chooses
      if (cur.model.step === 'repository' && CLONED.includes(state.status) && !forkPending(state)) toAnalysis();
      else if (CLONED.includes(state.status)) column.loadManifest(); // #790: the clone's folder may be known now
      if (cur.model.step === 'analysis' && CLONED.includes(state.status)) costs.readEstimates(); // #74: git says now what is left open
      if (cur.model.step === 'review') loadReview(); // an analysis done meanwhile: read what it made
      activity.followAnalysis(); // #781
      renderSoon();
    }
  }

  // The review's reads, without waiting: each one once its analysis is done (the backlog at once, synced
  // when it was never read: a project just imported has no cache); a failed read counts as answered with nothing
  // (#781: the backlog's says why, with its Retry)
  function loadReview() {
    const pid = cur.projectId;
    if (!pid) return;
    /** @type {[string, () => any, any][]} */
    const reads = [['backlog', () => activity.readBacklog(pid), true], ['city', () => api.architectureCity?.(pid), jobDone('projectMap')],
      ['facts', () => activity.readFacts(pid), jobDone('facts')], ['report', () => api.architectureReport?.(pid), jobDone('projectMap')]];
    for (const [key, read, due] of reads) {
      if (!due || cur.review[key] !== undefined || cur.reading.has(key)) continue;
      cur.reading.add(key);
      const answer = (value) => {
        if (!cur || cur.projectId !== pid) return;
        cur.reading.delete(key);
        cur.review[key] = value ?? null;
        renderSoon();
      };
      new Promise((resolve) => resolve(read())).then(answer, () => answer(null));
    }
    activity.followBacklog(); // #781
  }

  // Finish: the project's page at once (with its Next steps card), then the idea to the Inbox, in the
  // background (#730: a finding becomes an issue only from its own button); an analysis still running
  // notifies when it ends (remember); #846: no Start drawer here, the page only. city: the review's Open the city finishes the same way, then shows
  // the project's City tab
  function finish({ city = false } = {}) {
    const pid = cur.projectId;
    const idea = cur.idea.trim();
    const running = ACTIVE.includes(cur.onboarding?.status);
    const workflows = pickedWorkflows();
    const extra = { platform: platformOfRepo(cur.model.repository)?.id || cur.provider || null, kind: cur.kind || null, workModel: workModel.picked() };
    const defaultWorkflow = column.pickedDefault(workflows); // #790, #791, read before close()
    close();
    if (!pid) return;
    if (running) finished.add(pid);
    const failed = (e) => showToast(t('onboarding.finish_failed'), errMsg(e));
    new Promise((resolve) => resolve(api.finishOnboarding(pid))).catch(failed); // #741: no longer "Onboarding not finished"
    // #729: the step 3 workflows on the project, feature the default (DefaultWorkflow.firstBuild's rule), saved before
    // the project's page opens: its reads (listProjectRuns) then see them; the page opens whether the save succeeds or fails.
    // The saved record goes into state.projects (the backlog's pickers read the set and default there), as project-workflows.js's
    // save() does. #745: the platform picked (a self-hosted host its URL does not name: the Backlog never asks again); #735: the kind
    const patch = { workflows, defaultWorkflow, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) };
    new Promise((resolve) => resolve(api.updateProject(pid, patch)))
      .then((saved) => {
        if (typeof state === 'undefined' || !Array.isArray(state.projects)) return;
        const record = saved && typeof saved === 'object' ? saved : patch;
        state.projects = state.projects.map((p) => (p.id === pid ? { ...p, ...record } : p));
      })
      .catch(failed)
      .finally(() => {
        window.Actions.call('openProject', pid, { nextSteps: true });
        if (city) window.Actions.call('openProject', pid, { tab: 'city' });
      });
    if (idea) Promise.resolve(api.createDiscoveryCard(pid, idea.slice(0, 200), idea, 'idea')).catch(failed);
  }

  function toAnalysis() {
    cur.model = { ...(cur.model.step === 'repository' ? M.next(cur.model) : cur.model), step: 'analysis' }; // #850: the model's move (analyzeLater)
    column.loadManifest();
    costs.readEstimates();
  }

  async function call(fn) {
    cur.busy = true;
    render();
    try {
      remember(await fn());
      return true;
    } catch (e) {
      showToast(t('onboarding.action_failed'), errMsg(e));
      return false;
    } finally {
      if (cur) { cur.busy = false; render(); }
    }
  }

  // step 2's Next answered: where the wizard goes from the engine's state
  function begun(state, name) {
    const refused = state?.status === 'failed' && !state.projectId;
    // #107: the wizard was closed while the import was checked: its cause in a toast, nothing else to show
    if (!cur) { if (refused) showToast(titleOf(state.code), state.reason || ''); return; }
    // #107: an import refused before anything was made (no projectId): its cause shows on this step
    if (refused) cur.onboarding = state;
    // #741: a finished project of this repository: say it exists; an unfinished one resumes at its step
    else if (state?.exists) cur.exists = state.projectId;
    else resume.at(state, name);
  }

  async function next() {
    if (!canNext()) return;
    // the folder card: Next asks for the folder, then step 2 with its URL (a cancelled pick stays here)
    if (cur.model.step === 'start' && cur.model.source !== 'new' && cur.fromFolder) { await fromFolder(); return; }
    if (cur.model.step === 'repository' && !cur.projectId) {
      const name = cur.model.name.trim();
      // #632: a new project is created (ready at once, its private remote only when ticked); else imported
      const creating = cur.model.source === 'new';
      let begin;
      if (creating) {
        const data = { name, starts: cur.starts, remote: cur.remote && signedIn().length ? { provider: remoteProvider() } : null, answers: { ...cur.answers } };
        begin = () => api.createOnboarding(data);
      } else {
        const repo = typedRepo();
        cur.model = { ...cur.model, repository: repo };
        begin = () => api.startOnboarding({ name, repo });
      }
      cur.busy = true;
      if (creating) cur.creating = name;
      render();
      try {
        begun(await begin(), name);
      } catch (e) {
        showToast(t(creating ? 'onboarding.new_create_failed' : 'onboarding.start_failed'), errMsg(e));
      } finally {
        if (cur) { cur.busy = false; cur.creating = null; }
        render();
      }
      return;
    }
    if (cur.model.step === 'repository') toAnalysis();
    else if (cur.model.step === 'analysis' && cur.model.source !== 'new') { // #100: Continue starts nothing: workflows defined by hand leave the analysis for later
      cur.model = M.next({ ...cur.model, analyzeLater: !analysisAsked() });
    } else cur.model = M.next(cur.model);
    if (cur.model.step === 'review') loadReview();
    render();
  }

  // step 1's other sources: step 2 with the URL field ready to type in, filled from a picked folder
  function toRepository(fields = {}) {
    cur.model = { ...cur.model, ...fields, source: 'import', step: 'repository' };
    if (!cur.projectId) cur.onboarding = null; // #107: another folder picked after a refused import
    render();
    // a local folder has no URL field to type in: its name takes the focus
    document.getElementById(pickedFolder() ? 'wizard-name' : 'wizard-repo')?.focus?.();
  }

  // a folder on this computer: its file:// URL (the engine clones it as any git URL) and its name
  async function fromFolder() {
    const folder = await api.pickFolder();
    if (!folder || !cur) return;
    const slashed = String(folder).replace(/\\/g, '/');
    const url = `file://${slashed.startsWith('/') ? '' : '/'}${encodeURI(slashed)}`;
    toRepository({ repository: url, name: cur.model.name || slashed.split('/').filter(Boolean).pop() || '' });
  }

  // #632: the Create card and the chips of the create step's questions; true when it was one of them
  function onCreateClick(act, e) {
    if (act === 'source-new') { cur.model = { ...cur.model, source: 'new' }; cur.fromFolder = false; }
    else if (act === 'answer' && !cur.projectId) {
      const chip = e.target.closest('[data-question]');
      cur.answers = { ...cur.answers, [chip.dataset.question]: chip.dataset.value };
    }
    else return false;
    render();
    return true;
  }

  // #632: the create step's fields (name, starts with, the remote's switch and platform); true when it was one
  function onCreateInput(e, id) {
    if (e.target?.dataset?.testid === 'wizard-new-starts') {
      if (e.target.checked) cur.starts = String(e.target.value || 'readme');
    }
    else if (id === 'wizard-new-remote') cur.remote = !!e.target.checked;
    else if (id === 'wizard-new-remote-provider') { cur.remoteProvider = String(e.target.value || '') || null; refreshCreate(); }
    else if (id === 'wizard-new-name') {
      cur.model = { ...cur.model, name: String(e.target.value || '') };
      refreshCreate();
      const nextBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('wizard-next'));
      if (nextBtn) nextBtn.disabled = !canNext();
    }
    else return false;
    return true;
  }

  // the repository step's clicks (the provider toggle, a pick in the account's repositories): true when handled
  function onRepoClick(act, e) {
    if (act === 'provider') {
      cur.provider = e.target.closest('[data-provider]').dataset.provider;
      render();
      document.getElementById('wizard-repo')?.focus?.();
    }
    else if (act === 'pick-repo') {
      const repo = e.target.closest('[data-repo]').dataset.repo;
      // #739: the typed URL's rule; a name the owner typed stays
      cur.model = { ...cur.model, repository: repoUrl(repo), name: cur.nameTyped ? cur.model.name : M.displayNameFromUrl(repo) };
      if (!cur.projectId) cur.onboarding = null; // #107: another repository after a refused import
      render();
      const nameField = /** @type {HTMLInputElement | null} */ (document.getElementById('wizard-name'));
      if (nameField) nameField.value = cur.model.name;
      document.getElementById('wizard-name')?.focus?.();
    }
    else return false;
    return true;
  }

  // Analyze the repository (only an import offers it); #74: before the analysis started it runs a failed profile
  // too (Retry alone never pays); #101: a refused start gives the step (and the saved picks) back as it was, the toast says why
  async function analyze() {
    const c = cur, before = { mode: c.workflowsMode, later: c.model.analyzeLater };
    c.workflowsMode = 'analyze';
    c.model = { ...c.model, analyzeLater: false };
    const again = jobOf('profile').status === 'failed' && ['analyzing', 'analyzed'].includes(c.onboarding?.status);
    if (await call(() => (again ? api.retryOnboarding(c.projectId) : api.analyzeOnboarding(c.projectId)))) return;
    if (cur !== c || c.workflowsMode !== 'analyze') return; // another wizard, or the owner picked again meanwhile
    c.workflowsMode = before.mode;
    c.model = { ...c.model, analyzeLater: before.later };
    render();
  }

  // a tile picked: a workflow's variant (step 3), the project's kind (the review; #735: as its select's change)
  function onTileClick(act, e) {
    const tile = e.target.closest('[data-act]');
    if (act === 'workflow-pick') cur.workflows = { ...cur.workflows, [tile.dataset.kind]: tile.dataset.value };
    else if (act === 'pick-kind') cur.kind = tile.dataset.value;
    else return false;
    render();
    return true;
  }

  // the clicks that leave the wizard: Finish, Open the city, and (#40) the default awaiting acceptance,
  // which opens on Workflows › Definitions (the onboarding goes on, in the tray)
  function onLeaveClick(act, e) {
    if (act === 'finish') finish();
    else if (act === 'open-city') finish({ city: true });
    else if (act === 'review-accept') { const file = e.target.closest('[data-act]').dataset.file; close(); window.Actions?.call('showWorkflowDefinition', file); }
    else return false;
    return true;
  }

  async function onClick(e) {
    const act = e.target?.closest?.('[data-act]')?.dataset.act;
    if (!act || !cur) return;
    if (act === 'close' || act === 'cancel') close();
    else if (act === 'source-import') { cur.model = { ...cur.model, source: 'import' }; cur.fromFolder = false; render(); }
    else if (onCreateClick(act, e) || onRepoClick(act, e) || onLeaveClick(act, e) || onTileClick(act, e)) return;
    else if (act === 'pick-folder') await fromFolder();
    else if (act === 'source-git-url') { cur.fromFolder = false; toRepository(); }
    else if (act === 'source-folder') { cur.model = { ...cur.model, source: 'import' }; cur.fromFolder = true; render(); }
    else if (act === 'create-issue') {
      const button = e.target.closest('[data-act]');
      await createIssue(Number(button.dataset.finding), button.dataset.prioritize !== undefined);
    }
    else if (act === 'next') await next();
    else if (act === 'back') { cur.model = M.back(cur.model); if (!cur.projectId) cur.onboarding = null; render(); } // #107: a refusal stays on step 2
    else if (await onFailureClick(act)) return;
    // #738: the fork suggestion's two choices; the answer (cloned, the fork chosen) moves on to analysis
    else if (FORK_CALLS[act] && cur.projectId) await call(() => api[FORK_CALLS[act]](cur.projectId));
    // #725: the workflows column's two ways in; Analyze the repository starts the analysis (the paid part too; #20: an earlier Skip no longer holds), or runs again a failed profile job
    else if (act === 'workflows-manual') { cur.workflowsMode = 'manual'; render(); }
    else if (act === 'workflows-analyze' && cur.projectId) await analyze();
    else if (act === 'setup') openSetup();
  }

  // a failed import's Retry and Edit the URL; true when the click was one of them
  async function onFailureClick(act) {
    if (act === 'retry' && cur.projectId) await call(() => api.retryOnboarding(cur.projectId));
    else if (act === 'retry') { cur.onboarding = null; await next(); } // #107: a refused import, started again
    else if (act === 'edit-repo') {
      // a new import from the same fields; the failed one stays in the tray with its Retry
      cur = { ...cur, projectId: null, onboarding: null, estimate: undefined, profileEstimate: undefined, estimatedAt: undefined, workflowsMode: undefined, manifest: undefined, manifestFor: undefined, repoWorkflows: undefined, ...freshReview() };
      render();
      document.getElementById('wizard-repo')?.focus?.();
    }
    else return false;
    return true;
  }

  // typing updates the model and the parts that depend on it, never the whole markup (the caret stays)
  function onInput(e) {
    const id = e.target?.id || e.target?.dataset?.testid;
    if (!cur) return;
    if (id === 'wizard-review-idea') { cur.idea = String(e.target.value || ''); return; }
    if (e.target?.dataset?.testid === 'wizard-kind-select') { cur.kind = String(e.target.value || ''); render(); root.querySelector('[data-testid="wizard-kind-select"]')?.focus?.(); return; } // #735; #781: "Detected" goes at once
    // #630: the owner's pick of a suggested workflow's variant (kept across renders)
    if (e.target?.dataset?.testid === 'wizard-workflow-select') { cur.workflows = { ...cur.workflows, [e.target.dataset.workflowKind]: String(e.target.value || '') }; return; }
    if (workModel.onInput(e)) { render(); return; } // #633: the work model's radios
    if (onCreateInput(e, id)) return;
    if (id === 'wizard-repo-filter') { cur.repoFilter = String(e.target.value || ''); repoSlot(); return; } // the list only: the caret stays
    if (id !== 'wizard-repo' && id !== 'wizard-name') return;
    const value = String(e.target.value || '');
    cur.model = { ...cur.model, [id === 'wizard-repo' ? 'repository' : 'name']: value };
    // #739: the name follows the URL until the owner types one; cleared, it follows again
    if (id === 'wizard-name') cur.nameTyped = value.trim() !== '';
    else if (!cur.nameTyped) {
      cur.model = { ...cur.model, name: M.displayNameFromUrl(value) };
      const nameField = /** @type {HTMLInputElement | null} */ (document.getElementById('wizard-name'));
      if (nameField) nameField.value = cur.model.name;
    }
    if (id === 'wizard-repo') repoSlot(); // the list marks the repository the typed URL names
    afterRepoInput();
  }

  // what follows the URL or the name typed, in place
  function afterRepoInput() {
    // the provider toggle follows the URL (its buttons keep their place: the caret stays)
    const on = pickedProvider();
    for (const id of providers()) {
      const b = document.getElementById(`wizard-provider-${id}`);
      b?.setAttribute?.('aria-pressed', String(on === id));
      b?.classList?.toggle?.('active', on === id);
    }
    const into = document.getElementById('wizard-clone-into');
    if (into) into.textContent = cloneInto();
    // #107: a refused import's error goes once the URL or the name changes (Next works again)
    if (!cur.projectId && cur.onboarding?.status === 'failed') { cur.onboarding = null; root.querySelector?.('[data-testid="wizard-error"]')?.remove?.(); }
    const nextBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('wizard-next'));
    if (nextBtn) nextBtn.disabled = !canNext();
  }

  // Tab stays inside the dialog (diff-viewer.js's trapFocus)
  function trapFocus(e) {
    const list = [...(root.querySelectorAll?.('button:not([disabled]), input, select, textarea, [tabindex="0"]') || [])].filter((x) => x.offsetParent !== null);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const to = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
    e.preventDefault();
    list[to].focus({ preventScroll: true });
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab') trapFocus(e);
    else if (e.key === 'Enter' && e.target?.tagName === 'INPUT') next();
  }

  function open({ projectId = null } = {}) {
    opener = document.activeElement || null;
    if (!root) {
      root = document.createElement('div');
      root.setAttribute('id', 'project-wizard');
      root.setAttribute('data-testid', 'project-wizard');
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-labelledby', 'project-wizard-title');
      root.className = 'project-wizard';
      root.addEventListener('click', (e) => { if (!resume.onClick(e) && !activity.onClick(e)) onClick(e); }); // #741: the "already exists" notice first; #781: the Backlog's Retry
      root.addEventListener('input', onInput);
      root.addEventListener('change', (e) => { onInput(e); if (cur) resume.save(); }); // #741: a pick made without a render
      root.addEventListener('keydown', onKey);
      root.addEventListener('focusout', (e) => { if (cur?.stale && /** @type {HTMLElement | null} */ (e.target)?.id === 'wizard-review-idea') { cur.stale = false; render(); } });
      document.body.appendChild(root);
    }
    // Import is selected when the wizard opens (mock-1); #632: the create step's choices start at mock-3's
    cur = { model: { ...M.initialState(), source: 'import' }, projectId: null, onboarding: null, estimate: undefined, profileEstimate: undefined, estimatedAt: undefined, busy: false, accounts: undefined, repos: {}, starts: 'readme', remote: false, remoteProvider: null, answers: { ...M.CREATE_DEFAULTS }, workflowsMode: undefined, workModel: undefined, nameTyped: false, ...freshReview() };
    root.hidden = false;
    render();
    tray.refresh(); // #724: hidden while the wizard is open
    root.querySelector('.wizard-panel')?.focus?.();
    loadAccounts();
    loadTaken();
    if (projectId) resume.load(projectId);
  }

  function close() {
    cur = null;
    activity.stop(); // #781
    tray.refresh(); // #724: back with what still needs attention
    // #741: the open Projects screen reads its cards again (an onboarding closed before Finish reads "not finished")
    if (state.view === 'projects') window.ProjectsView?.refresh?.().catch(() => {});
    if (!root) return;
    root.hidden = true;
    root.innerHTML = '';
    const back = opener;
    opener = null;
    if (back?.isConnected !== false) back?.focus?.();
  }

  // #732: the Projects list (state.projects, read by Analyze, the backlog's pickers, the header) follows the
  // onboarding: read again when a project shows up and at each status change (its clone done: its folder)
  const listedStatus = new Map(); // projectId → the status the list was last read at
  let listReads = 0; // only the latest read applies: an older answer arriving late never wins
  async function refreshProjectList(ev) {
    if (!ev?.projectId || listedStatus.get(ev.projectId) === ev.status) return;
    listedStatus.set(ev.projectId, ev.status);
    const read = ++listReads;
    let list;
    try { list = await api.listProjects(); } catch { return; } // the list stays as it was
    if (read !== listReads || !Array.isArray(list)) return;
    state.projects = list;
    const fresh = list.find((p) => p.id === ev.projectId);
    if (fresh && state.pv?.id === fresh.id && state.pv.project) state.pv.project = { ...state.pv.project, ...fresh };
    window.CurrentProject?.refresh?.();
    if (state.view === 'projects') window.ProjectsView?.render?.(); // the open Projects screen draws its cards again
  }

  if (typeof window.api?.onOnboardingChanged === 'function') {
    window.api.onOnboardingChanged(remember);
    window.api.onOnboardingChanged(refreshProjectList);
  }
  // #726: a live language switch draws the open wizard again, the owner's picks kept (cur.workflows)
  window.I18n?.onChange?.(() => render());

  window.ProjectWizard = {
    analyzing: (projectId) => ACTIVE.includes(states.get(projectId)?.status),
    close,
    open,
  };
  window.Actions.register('openProjectWizard', (opts) => open(opts || {})); // Setup's First project step asks for it (setup.js)
})();
