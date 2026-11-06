/* global api, uiLocale */
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
//   step at once), analysis (the jobs
//   from the clone on in wizard-cost, with wizard-cost-total and the paid part data-part="projectMap"
//   (#730: no Product Owner ranking any more) before the click, checked and locked, a running row with a spinner (#724),
//   wizard-clone-progress in the footer (data-status = the clone job's status, wizard-spinner while it runs,
//   its reason and Retry when it failed), and wizard-skip; a
//   failed job reads its reason wizard-job-error-<id> (OnboardingModel's code, full error on hover), "—" as
//   amount and wizard-job-retry-<id> (api.retryOnboarding); #725: the suggested workflows beside them (wizard-workflows-column,
//   project-wizard-workflows.js); #781: activity lines say what runs (project-wizard-activity.js)) and review (#642, spec R10):
//   wizard-review with the project's card (#781: wizard-review-languages), wizard-review-city (Open the
//   city: Finish, then the project's City tab) / -findings / -backlog, each data-state="ready" | "pending"
//   (its analysis still running: words say so) | "failed" | "skipped" (its analysis answered without a result)
//   | "later" (the analyses were skipped), #730: one wizard-review-finding data-finding="<index>" per report
//   finding with wizard-review-create-issue / -prioritize, then its link wizard-review-finding-issue, and the idea field
//   wizard-review-idea (an answer arriving while it has the focus renders at its blur). Navigation in the
//   footer: wizard-cancel (step 1: closes, nothing imported) or wizard-back, then wizard-next (step 3:
//   "Continue", enabled whatever the analysis does; before any analysis it skips it) or, on the review,
//   wizard-finish (never disabled,
//   never waits): it closes the wizard on the project's page with its Next steps
//   card (openProject with nextSteps, project.js), then sends the idea to the Inbox (no finding is filed
//   without its own click, #730); an analysis still running at Finish shows a toast when it ends. wizard-close (×, Esc too) sits beside the pills.
// - #632 Create new project (mock-3, spec R4): its repository step is two columns: the name wizard-new-name,
//   the radios wizard-new-starts value="readme" (default) | "empty", the box wizard-new-remote (unchecked,
//   disabled while api.onboardingAccounts reports no gh / glab signed in) with its platform
//   wizard-new-remote-provider and the hint wizard-new-remote-hint (<account>/<slug>), the folder line
//   wizard-new-folder (<workspace>/projects/<slug>, OnboardingModel.slugify); then the three questions
//   wizard-question data-question="mode" | "ci" | "release" with their wizard-chip buttons (aria-pressed on the
//   pick, OnboardingModel.CREATE_ANSWERS / CREATE_DEFAULTS). Next (api.createOnboarding) creates it, ready at
//   once: step 3 ("Workflows") without the clone; a private repository not made shows wizard-remote-warning.
// - errors: wizard-error data-error="no-access" | "clone-failed" with the engine's reason and Retry
//   (api.retryOnboarding); no-access also offers Edit the URL (wizard-edit-repo: the fields open again for a new
//   import, the failed one stays in the tray); the gh / glab warning wizard-cli-warning data-error="cli-missing" |
//   "cli-signed-out" (the import goes on) with Open Setup, on the repository and the analysis steps. #740: Open
//   Setup and Sign in open Settings › Agents & CLIs, the wizard hidden meanwhile (project-wizard-cli.js).
// - the provider (its label, its CLI) is the adapter of window.Platforms.platformOfRepoUrl, the engine's rule too;
//   amounts go through I18n.formatCost (the interface's language). Tab stays in the dialog; close() gives the focus
//   back to what opened it.
// - #onboarding-tray (project-wizard-tray.js) follows onboarding:changed (api.onOnboardingChanged, subscribed
//   when the script loads); #724: hidden while the wizard is open, the wizard shows the progress itself.
// - #732: onboarding:changed also reads api.listProjects again into state.projects (a new project, a status
//   change such as the clone done), so the screens reading the cached list see the project and its folder.
// Channels: onboarding:start / create / analyze / retry (packages/engine/service/channels/onboarding.js),
// architecture:estimate (the project map's cost), and for the review architecture:city / facts / report,
// architecture:createIssue (never runNow), the backlog and api.createDiscoveryCard (an Inbox idea).
// Uses app.js globals (esc, t, showToast, errMsg), window.Actions and window.ProjectWizardCli.

(function () {
  const M = window.OnboardingModel;
  const JOBS = ['facts', 'profile', 'projectMap'];
  const PAID = ['projectMap'];
  // mock-2's toggle: the registry's platforms with a CLI (#351: no platform literal outside the adapters)
  const providers = () => (window.Platforms?.PLATFORMS || []).filter((p) => p.cli).map((p) => p.id);
  const svg = (d) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON = { check: svg('M3.5 8.5l3 3 6-7'), download: svg('M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10'), plus: svg('M8 3v10M3 8h10') };
  // the engine's statuses past the clone: the repository step goes on to the analysis by itself
  const CLONED = ['ready', 'analyzing', 'analyzed'];
  const ACTIVE = ['cloning', 'analyzing'];

  let root = null;
  // { model: OnboardingModel state, projectId, onboarding: the engine's state, estimate, busy, provider (the
  // toggle's pick while the URL names none), and the
  // review's: review { backlog, city, facts, report } (undefined: not read yet), reading, filing (the finding
  // whose issue is being filed), idea }
  let cur = null;
  const freshReview = () => ({ review: {}, reading: new Set(), filing: null, idea: '', interview: null, backlogProgress: null });
  let opener = null; // the element that had the focus when the wizard opened
  const names = new Map(); // projectId → the name typed in the wizard (the event carries no name)
  const states = new Map(); // projectId → the engine's last state, in arrival order
  const finished = new Set(); // projectIds finished in the wizard with an analysis still running
  const SPINNER = (testid) => `<span class="spinner" data-testid="${testid}" aria-hidden="true"></span>`;

  const platformOfRepo = (url) => window.Platforms?.platformOfRepoUrl?.(url) || null;
  const platformById = (id) => window.Platforms?.findPlatform?.(id) || null;
  const usd = (n) => (window.I18n?.formatCost ? window.I18n.formatCost(n) : `$${Number(n).toFixed(2)}`);
  const money = (n) => (n > 0 && n < 0.01 ? `< ${usd(0.01)}` : usd(n));
  const costText = (n) => (n == null ? t('onboarding.cost_not_known') : money(n));
  const statusText = (s) => t(`onboarding.status_${s}`);
  // #725: Continue on the analysis step never waits for the analysis (running, done or failed)
  const canNext = () => (cur.model.step === 'analysis' ? M.canGoNext(cur.model)
    : M.canGoNext(cur.model) && cur.onboarding?.status !== 'failed' && !cur.busy);
  // #738: the fork notice's two choices, each one engine call; the answer moves on to analysis
  const FORK_CALLS = { 'fork-create': 'forkOnboarding', 'work-locally': 'workLocallyOnboarding' };
  const activity =window.ProjectWizardActivity({ cur: () => cur, jobOf: (id) => jobOf(id), platformLabel: (id) => platformById(id)?.label || id, renderSoon: () => renderSoon() }); // #781
  const column = window.ProjectWizardColumn({ cur: () => cur, jobOf: (id) => jobOf(id), phasesHtml: activity.analysisPhases });
  const workModel = window.ProjectWizardWorkModel({ cur: () => cur }); // #633: step 3's work model section
  const resume = window.ProjectWizardResume({ close: () => close(), cur: () => cur, names, remember: (s) => remember(s), render: () => render(), toAnalysis: () => toAnalysis() });
  const {
    jobReason,
    kindField,
    pickedWorkflows,
    profileOf,
    textOf,
    workflowsColumn,
  } = column;
  // the repository step's notices (CLI missing or signed out; #738 no push access)
  const cliWarning = (cli) => column.cliWarning(cli);
  const forkNotice = (o) => column.forkNotice(o);
  const forkPending = (o) => column.forkPending(o);
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
  const { errorBlock, openSetup } = window.ProjectWizardCli({
    cur: () => cur,
    refresh: (checkAgain) => { tray.refresh(); if (checkAgain) loadAccounts(); },
    render: () => render(),
    root: () => root,
  });
  const retryButton = (id) => `<button type="button" class="btn sm" data-act="retry" data-testid="wizard-job-retry-${id}">${esc(t('onboarding.retry'))}</button>`;

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
    const picked = (s) => (cur.model.source === s ? ' selected' : '');
    return `<h2 id="project-wizard-title">${esc(t('onboarding.start_title'))}</h2>
      <p class="muted">${esc(t('onboarding.start_line'))}</p>
      <div class="wizard-sources">
        <button type="button" class="card wizard-source${picked('new')}" data-act="source-new" data-testid="wizard-source-new" aria-pressed="${cur.model.source === 'new'}">
          ${sourceCard('new', ICON.plus, '')}
        </button>
        <button type="button" class="card wizard-source${picked('import')}" data-act="source-import" data-testid="wizard-source-import" aria-pressed="${cur.model.source === 'import'}">
          ${sourceCard('import', ICON.download, '')}
        </button>
      </div>
      <p class="wizard-other muted" data-testid="wizard-other-sources">${esc(t('onboarding.other_sources'))}
        <button type="button" class="link-btn" data-act="source-git-url" data-testid="wizard-source-git-url">${esc(t('onboarding.source_git_url'))}</button>
        <span aria-hidden="true">·</span>
        <button type="button" class="link-btn" data-act="source-folder" data-testid="wizard-source-folder">${esc(t('onboarding.source_folder'))}</button></p>`;
  }

  // the provider: read from the URL, else the one picked on the toggle (GitHub by default)
  const pickedProvider = () => platformOfRepo(cur.model.repository)?.id || cur.provider || window.Platforms?.DEFAULT_PLATFORM || providers()[0];

  // mock-2's GitHub / GitLab toggle: it follows the URL as it is typed (onInput) and picks the hint
  function providerToggle() {
    const on = pickedProvider();
    const b = (id) => `<button type="button" class="${on === id ? 'active' : ''}" id="wizard-provider-${id}" data-act="provider" data-provider="${id}" aria-pressed="${on === id}">${esc(platformById(id)?.label || id)}</button>`;
    return `<div class="seg wizard-provider" id="wizard-provider" data-testid="wizard-provider" role="group" aria-label="${esc(t('onboarding.provider_label'))}">${providers().map(b).join('')}</div>`;
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
  const cliBadges = () => (cur.onboarding?.cli ? cliBadge(cur.onboarding.cli) : (cur.accounts || []).map(accountBadge).join(''));

  // "updated 2 days ago" in the interface's language
  function updatedAgo(iso) {
    const s = (Date.parse(iso) - Date.now()) / 1000;
    if (!Number.isFinite(s)) return '';
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    const [unit, size] = units.find(([, n]) => Math.abs(s) >= n) || units[units.length - 1];
    try {
      const lang = typeof uiLocale === 'function' ? uiLocale() : undefined;
      return t('onboarding.repo_updated', { ago: new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(Math.round(s / size), unit) });
    } catch { return ''; }
  }

  // mock-2's list under the field: the account's five latest repositories on the picked provider
  const repoUrl = (name) => `https://${(platformById(pickedProvider()) || platformById(window.Platforms?.DEFAULT_PLATFORM))?.host}/${name}`;
  function repoList() {
    const repos = cur.projectId ? [] : (cur.repos[pickedProvider()] || []).slice(0, 5);
    if (!repos.length) return '';
    const typed = cur.model.repository.trim().replace(/\.git$/, '');
    const item = (r) => {
      const meta = [t(r.private ? 'onboarding.repo_private' : 'onboarding.repo_public'), updatedAgo(r.updatedAt)].filter(Boolean).join(' · ');
      return `<li><button type="button" class="wizard-repo-item" data-act="pick-repo" data-repo="${esc(r.name)}" data-testid="wizard-repo-option" aria-pressed="${typed === repoUrl(r.name)}">
          <span class="text-cut" title="${esc(r.name)}">${esc(r.name)}</span><span class="muted">${esc(meta)}</span></button></li>`;
    };
    return `<ul class="wizard-repos" data-testid="wizard-repo-list" aria-label="${esc(t('onboarding.repo_list'))}">${repos.map(item).join('')}</ul>`;
  }

  // the badges and the list arrive after the step is drawn: only their own parts change (the caret stays)
  function refreshAccounts() {
    // #632: the create step's box and platforms follow the sign-in; a render unless the name is being typed
    if (cur.model.step === 'repository' && cur.model.source === 'new') {
      if (document.activeElement?.id === 'wizard-new-name') refreshCreate(); else render();
      return;
    }
    const badges = document.getElementById('wizard-cli-badges');
    if (badges) badges.innerHTML = cliBadges();
    const list = document.getElementById('wizard-repo-slot');
    if (list) list.innerHTML = repoList();
  }

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
  const cloneInto = () => (cur.model.repository.trim()
    ? t('onboarding.clone_into', { folder: `<workspace>/repos/${M.repoNameFromUrl(typedRepo())}` }) : ''); // i18n-ignore

  function repositoryStep() {
    const o = cur.onboarding;
    // #743: read-only from Next on (the access check and the clone are one wait, shown on the Next button)
    const locked = cur.projectId || cur.busy ? ' readonly' : '';
    return `<div class="wizard-title-row">
        <h2 id="project-wizard-title">${esc(t('onboarding.import_title'))}</h2>
        <div class="wizard-title-side">${providerToggle()}<span class="wizard-cli-badges" id="wizard-cli-badges">${cliBadges()}</span></div>
      </div>
      <div class="wizard-fields">
        <label class="wizard-field"><span>${esc(t('onboarding.repo_label'))}</span>
          <input id="wizard-repo" data-testid="wizard-repo" type="text" spellcheck="false" value="${esc(cur.model.repository)}" placeholder="${esc(t(`onboarding.repo_placeholder_${pickedProvider()}`))}"${locked}>
          <span class="muted small">${esc(t('onboarding.repo_help'))}</span></label>
        <div id="wizard-repo-slot">${repoList()}</div>
        <label class="wizard-field"><span>${esc(t('onboarding.name_label'))}</span>
          <input id="wizard-name" data-testid="wizard-name" type="text" value="${esc(cur.model.name)}"${locked}></label>
      </div>
      <p class="mono muted small text-cut" id="wizard-clone-into" data-testid="wizard-clone-into">${esc(cloneInto())}</p>
      ${o?.status === 'failed' ? errorBlock(o) : ''}
      ${forkNotice(o)}
      ${o ? cliWarning(o.cli) : ''}`;
  }

  // #632 (mock-3): Create new project. The accounts signed in with gh / glab, the platform the private
  // repository goes to (the owner's pick, else the first signed in), the new project's slug and folder
  const signedIn = () => (cur.accounts || []).filter((a) => a.signedIn && providers().includes(a.provider));
  const remoteProvider = () => cur.remoteProvider || signedIn()[0]?.provider || providers()[0];
  const newSlug = () => M.slugify(cur.model.name);
  const newFolder = () => `<workspace>/projects/${newSlug()}`; // i18n-ignore
  // the answer's i18n key: pr+release → onboarding.new_ci_pr_release
  const answerLabel = (q, v) => t(`onboarding.new_${q}_${String(v).replace(/[^a-z0-9]+/gi, '_')}`);

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

  // one question of the right column: its title and its chips, the picked one aria-pressed
  function question(q, locked) {
    const chip = (v) => `<button type="button" class="wizard-chip" data-act="answer" data-question="${q}" data-value="${esc(v)}" data-testid="wizard-chip" aria-pressed="${cur.answers[q] === v}"${locked}>${esc(answerLabel(q, v))}</button>`;
    return `<div class="wizard-question" data-testid="wizard-question" data-question="${q}" role="group" aria-labelledby="wizard-question-${q}">
        <span class="wizard-question-title" id="wizard-question-${q}">${esc(t(`onboarding.new_${q}`))}</span>
        <div class="wizard-chips">${M.CREATE_ANSWERS[q].map(chip).join('')}</div>
      </div>`;
  }

  function createStep() {
    // once created (Back from step 3), the step shows what was sent
    const locked = cur.projectId ? ' disabled' : '';
    const starts = (v) => `<label class="wizard-choice"><input type="radio" name="wizard-new-starts" data-testid="wizard-new-starts" value="${v}"${cur.starts === v ? ' checked' : ''}${locked}>
          <span><strong>${esc(t(`onboarding.new_${v}`))}</strong><span class="muted small">${esc(t(`onboarding.new_${v}_text`))}</span></span></label>`;
    return `<div class="wizard-columns">
        <div class="wizard-column">
          <h2 id="project-wizard-title">${esc(t('onboarding.new_title'))}</h2>
          <label class="wizard-field"><span>${esc(t('onboarding.name_label'))}</span>
            <input id="wizard-new-name" data-testid="wizard-new-name" type="text" value="${esc(cur.model.name)}"${cur.projectId ? ' readonly' : ''}></label>
          <fieldset class="wizard-starts"><legend>${esc(t('onboarding.new_starts'))}</legend>${['readme', 'empty'].map(starts).join('')}</fieldset>
          <div class="wizard-remote">
            <label class="wizard-choice"><input type="checkbox" id="wizard-new-remote" data-testid="wizard-new-remote"${cur.remote ? ' checked' : ''}${locked || !signedIn().length ? ' disabled' : ''}>
              <strong>${esc(t('onboarding.new_remote'))}</strong></label>
            ${remoteSelect(locked)}
            <p class="muted small wizard-remote-hint" id="wizard-new-remote-hint" data-testid="wizard-new-remote-hint">${esc(remoteHint())}</p>
          </div>
          <p class="mono muted small text-cut" id="wizard-new-folder" data-testid="wizard-new-folder" title="${esc(newFolder())}">${esc(newFolder())}</p>
          ${cur.onboarding ? remoteWarning(cur.onboarding.remote) : ''}
        </div>
        <div class="wizard-column">
          <h3>${esc(t('onboarding.new_questions'))}</h3>
          ${Object.keys(M.CREATE_ANSWERS).map((q) => question(q, locked)).join('')}
          <p class="muted">${esc(t('onboarding.new_answers_line'))}</p>
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
    const box = document.getElementById('wizard-new-remote');
    if (box) box.disabled = !!cur.projectId || !signedIn().length;
    const hint = document.getElementById('wizard-new-remote-hint');
    if (hint) hint.textContent = remoteHint();
    const folder = document.getElementById('wizard-new-folder');
    if (folder) folder.textContent = newFolder();
  }

  // mock-4's left column: one row per job from the clone on (its status dot, what it reads, its cost), the
  // paid ones data-part, then the estimated total with "Skip, analyze later" before the click
  function costBlock(started) {
    const jobs = cur.onboarding?.jobs || {};
    const loading = cur.estimate === undefined;
    const sum = M.costSummary(PAID.map((id) => ({ id, estimate: id === 'projectMap' ? cur.estimate : null, checked: true })));
    // #725: a failed job has no amount ("—"); a done one its cost, "free" for a free job, "—" for a paid
    // one whose cost is not known
    const amount = (id) => {
      const s = jobs[id]?.status;
      const p = sum.parts.find((x) => x.id === id);
      if (s === 'failed') return '—';
      if (s === 'done') return p ? (Number.isFinite(p.estimate) ? money(p.estimate) : '—') : t('onboarding.cost_free');
      return p ? (loading ? t('onboarding.estimating') : costText(p.estimate)) : t('onboarding.cost_free');
    };
    const row = (id) => {
      const s = jobs[id]?.status || 'waiting';
      // #630 (mock-4): the profile row says the ways of working it found once its job is done
      const found = id === 'profile' && textOf(M.profileLine(profileOf())); // #726: keys, in the interface's language
      const line = id === 'clone' ? cur.model.repository : found ? t('onboarding.profile_found', { profile: found }) : t(`onboarding.job_${id}_text`);
      const testid = id === 'profile' ? ' data-testid="wizard-profile"' : '';
      // mock-4's pick of a paid analysis: both run in this phase (shown checked, disabled)
      const pick = PAID.includes(id) ? `<input type="checkbox" checked disabled aria-label="${esc(t(`onboarding.job_${id}`))}">` : '';
      // #725: a failed job says why under its title (the full error on hover), with its Retry
      const failed = s === 'failed' && id !== 'clone'
        ? `<span class="small wizard-job-error" data-testid="wizard-job-error-${id}" title="${esc(jobs[id].error || jobs[id].reason || '')}">${esc(jobReason(jobs[id]))}</span>` : '';
      const retry = failed ? retryButton(id) : '';
      return `<li class="wizard-job"${PAID.includes(id) ? ` data-part="${id}"` : ''}>
          <span class="${s === 'running' ? 'spinner wizard-job-spinner' : 'wizard-dot'} job-${esc(s)}" role="img" aria-label="${esc(t(`onboarding.job_status_${s}`))}" title="${esc(t(`onboarding.job_status_${s}`))}"></span>
          <span class="wizard-job-text"><strong class="wizard-job-title">${pick}${esc(t(`onboarding.job_${id}`))}</strong><span class="muted small text-cut"${testid} title="${esc(line)}">${esc(line)}</span>${failed}</span>
          <span class="wizard-amount muted">${esc(amount(id))}</span>${retry}
        </li>`;
    };
    const unknown = !loading && sum.total != null && sum.unknown.length
      ? `<span class="muted small">${esc(t('onboarding.cost_partial'))}</span>` : '';
    const skip = started ? '' : `<button type="button" class="btn sm" data-act="skip" data-testid="wizard-skip">${esc(t('onboarding.skip'))}</button>`;
    return `<div class="wizard-cost" data-testid="wizard-cost">
        <ul class="wizard-jobs">${(cur.model.source === 'new' ? JOBS : ['clone', ...JOBS]).map(row).join('')}</ul>
        <div class="card wizard-cost-total-row"><span>${esc(t('onboarding.cost_real_models'))}</span>
          <strong class="wizard-amount" data-testid="wizard-cost-total">${esc(loading ? t('onboarding.estimating') : costText(sum.total))}</strong>${skip}</div>
        ${unknown}
      </div>`;
  }

  function analysisStep() {
    const o = cur.onboarding || {};
    const started = ['analyzing', 'analyzed'].includes(o.status);
    const said = started ? `<p class="muted small">${esc(t(o.status === 'analyzed' ? 'onboarding.analysis_done' : 'onboarding.analysis_running'))}</p>` : '';
    return `<div class="wizard-columns">
        <div class="wizard-column">
          <h2 id="project-wizard-title">${esc(t('onboarding.analyze_title', { name: cur.model.name }))}</h2>
          <p class="muted">${esc(t('onboarding.read_only'))}</p>
          ${costBlock(started)}
          ${said}
          ${o.status === 'failed' ? errorBlock(o) : ''}
          ${cliWarning(o.cli)}
          ${remoteWarning(o.remote)}
        </div>
        ${workflowsColumn()}
      </div>${workModel.section()}`;
  }

  const jobOf = (id) => cur.onboarding?.jobs?.[id] || {};
  const jobDone = (id) => jobOf(id).status === 'done';

  // a section's state: ready (its analysis and read done), failed / skipped (its analysis answered without
  // a result), later (the analyses were skipped in the wizard) or pending (still running or reading)
  function sectionState(job, read) {
    if (!job) return read ? 'ready' : 'pending';
    const s = jobOf(job).status;
    if (s === 'done') return read ? 'ready' : 'pending';
    if (s === 'failed' || s === 'skipped') return s;
    return cur.model.analyzeLater && !ACTIVE.includes(cur.onboarding?.status) ? 'later' : 'pending';
  }

  // a card of the review: its head (title, then an action or the pending badge), then its body once ready; #781: `pending`: a key, or its markup's function
  function reviewSection(id, title, job, read, body, pending, action = '') {
    const state = sectionState(job, read);
    const own = state === 'pending' && typeof pending === 'function';
    const words = {
      // #725: the failed job's reason, as its row of step 3 says it
      failed: () => jobReason(jobOf(job)),
      later: () => t('onboarding.review_section_later'),
      pending: () => t(pending),
      skipped: () => t('onboarding.review_section_skipped'),
    };
    const badge = state === 'pending' && !own ? `<span class="badge job-running">${esc(t('onboarding.job_status_running'))}</span>` : '';
    return `<section class="card wizard-review-section" data-testid="wizard-review-${id}" data-state="${state}">
        <header class="wizard-review-head"><h3>${esc(t(title))}</h3>${action || badge}</header>
        ${state === 'ready' ? body() : own ? pending() : `<p class="muted small">${esc(words[state]())}</p>`}
      </section>`;
  }

  // mock-6's city: a bar per district (its files, the largest first), then the counts in words
  function cityBody() {
    const model = cur.review.city?.model;
    const districts = model?.districts || [];
    if (!districts.length) return `<p class="muted small">${esc(t('onboarding.review_city_empty'))}</p>`;
    // the city model's buildings (packages/shared/city-model.js), each naming its district
    const sizes = districts.map((d) => d.buildings?.length || d.files || 0);
    const files = Array.isArray(model.buildings) ? model.buildings.length : sizes.reduce((n, s) => n + s, 0);
    const top = Math.max(1, ...sizes);
    const bars = sizes.slice(0, 12).map((s, i) => `<span class="wizard-city-bar" style="height: ${Math.max(8, Math.round((s / top) * 100))}%" title="${esc(districts[i].name || districts[i].id || '')}"></span>`).join('');
    return `<div class="wizard-city-bars" aria-hidden="true">${bars}</div>
      <p class="muted small">${esc(t('onboarding.review_city', { districts: districts.length, files }))}</p>`;
  }

  function backlogBody() {
    const issues = cur.review.backlog?.issues || [];
    if (!issues.length) return activity.backlogDone(0);
    return `${activity.backlogDone(issues.length)}<ul class="wizard-review-list">${issues.map((i) => `<li class="fit-box"><span class="mono muted">#${esc(i.number)}</span> <span class="text-cut" title="${esc(i.title)}">${esc(i.title)}</span></li>`).join('')}</ul>`;
  }

  // #730: each finding of the Oracle's report, its severity, then Create issue / Create issue and prioritize,
  // or its issue's link once filed
  function findingsBody() {
    const findings = cur.review.report?.findings || [];
    if (!findings.length) return `<p class="muted small">${esc(t('onboarding.review_findings_empty'))}</p>`;
    const row = (f, i) => {
      const target = f.files?.[0]?.path || f.kind || '';
      const busy = cur.filing != null ? ' disabled' : '';
      const action = f.filed
        ? `<a class="small" data-testid="wizard-review-finding-issue" href="${esc(f.filed.issueUrl || '')}" target="_blank" rel="noopener">#${esc(f.filed.issue)}</a>`
        : `<button type="button" class="btn sm" data-act="create-issue" data-testid="wizard-review-create-issue" data-finding="${i}"${busy}>${esc(t('project_architecture.create_issue'))}</button>
          <button type="button" class="btn sm" data-act="create-issue" data-testid="wizard-review-create-issue-prioritize" data-finding="${i}" data-prioritize${busy}>${esc(t('project_architecture.create_issue_prioritize'))}</button>`;
      return `<li class="wizard-review-finding fit-box" data-testid="wizard-review-finding" data-finding="${i}">
          <span class="badge${f.severity === 'high' ? ' warn' : ''}">${esc(f.severity || '')}</span>
          <span class="text-cut" title="${esc(`${f.title} · ${target}`)}">${esc(f.title)}</span>
          <span class="wizard-review-badges">${action}</span>
        </li>`;
    };
    return `<ul class="wizard-review-list">${findings.map(row).join('')}</ul>`;
  }

  // Create issue (and prioritize) for the review's finding `index`: the row then shows the issue's link
  async function createIssue(index, prioritize) {
    const pid = cur?.projectId;
    const reportId = cur?.review.report?.report?.id;
    if (!pid || !reportId || cur.filing != null) return;
    const c = cur;
    c.filing = index; render();
    try {
      const { filed } = await api.createFindingIssue(pid, reportId, index, { prioritize });
      const f = c.review.report?.findings?.[index];
      if (f) f.filed = filed;
    } catch (e) {
      showToast(t('onboarding.finish_failed'), errMsg(e));
    }
    c.filing = null;
    if (cur === c) renderSoon();
  }

  // mock-6's first card: the project, how it is worked on (what the analyses read so far; #781: the Health tab's language bar) and its workflows
  function projectCard() {
    const name = cur.model.name;
    const folder = (typeof state === 'object' && state?.projects?.find?.((p) => p.id === cur.projectId)?.folder) || '';
    const where = [cur.model.repository, folder].filter(Boolean).join(' · ');
    const chips = [platformOfRepo(cur.model.repository)?.label].filter(Boolean);
    const languages = cur.review.facts ? `<div class="wizard-review-languages" data-testid="wizard-review-languages">${window.ProjectHealth?.languagesHtml(cur.review.facts.model?.languages) || ''}</div>` : '';
    const how = chips.length ? `<div class="wizard-chips">${chips.map((c) => `<span class="wizard-chip">${esc(c)}</span>`).join('')}</div>`
      : languages ? '' : `<p class="muted small">${esc(t('onboarding.review_how_pending'))}</p>`;
    const flows = M.suggestWorkflows(null).suggestions.map((s) => `<span class="wizard-chip accent text-cut" title="${esc(s.id)}">${esc(s.id)}</span>`).join('');
    return `<section class="card wizard-review-section wizard-review-project">
        <h3 id="project-wizard-title" class="text-cut" title="${esc(name)}">${esc(name)}</h3>
        <span class="mono muted small text-cut" title="${esc(where)}">${esc(where)}</span>
        <h4>${esc(t('onboarding.review_how', { name }))}</h4>${how}${languages}${kindField()}
        <h4>${esc(t('onboarding.review_workflows'))}</h4><div class="wizard-chips">${flows}</div>
      </section>`;
  }

  // what the analyses found so far (each section pending until its analysis and its read are done): mock-6's
  // three cards, then the backlog and the idea for the Inbox
  function reviewStep() {
    const r = cur.review;
    const later = cur.model.analyzeLater ? `<p class="muted small">${esc(t('onboarding.review_later'))}</p>` : '';
    const openCity = `<button type="button" class="btn sm" data-act="open-city" data-testid="wizard-open-city">${esc(t('onboarding.open_city'))}</button>`;
    return `<div class="wizard-review" data-testid="wizard-review">${later}
        <div class="wizard-review-grid">
          ${projectCard()}
          ${reviewSection('city', 'onboarding.review_city_title', 'projectMap', r.city !== undefined, cityBody, 'onboarding.review_pending_city', openCity)}
          ${reviewSection('findings', 'onboarding.review_findings_title', 'projectMap', r.report !== undefined, findingsBody, 'onboarding.review_pending_findings', jobOf('projectMap').status === 'failed' ? retryButton('projectMap') : '')}
        </div>
        <div class="wizard-review-more">
          ${reviewSection('backlog', 'onboarding.review_backlog_title', null, r.backlog !== undefined, backlogBody, activity.backlogLine)}
          <label class="wizard-field"><span>${esc(t('onboarding.review_idea_label'))}</span>
            <textarea id="wizard-review-idea" data-testid="wizard-review-idea" rows="2">${esc(cur.idea)}</textarea>
            <span class="muted small">${esc(t('onboarding.review_idea_help'))}</span></label>
        </div>
      </div>`;
  }

  const BODY = { analysis: analysisStep, repository: () => (cur.model.source === 'new' ? createStep() : repositoryStep()), review: reviewStep, start: startStep };

  // the analysis step's footer: "Cloning <name>", a bar and the clone job's status (mock-4); #724: the
  // import's progress stays in the wizard: a spinner while the clone runs (a failure's reason and Retry are
  // the step's errorBlock, above)
  function cloneProgress() {
    const s = jobOf('clone').status || (CLONED.includes(cur.onboarding?.status) ? 'done' : 'running');
    return `<div class="card wizard-clone-progress" data-testid="wizard-clone-progress" data-status="${esc(s)}">
        ${s === 'running' ? SPINNER('wizard-spinner') : ''}<span class="text-cut" title="${esc(cur.model.name)}">${esc(t('onboarding.cloning_name', { name: cur.model.name }))}</span>
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
    // mock-4's footer: the clone's progress on the left, Back beside the step's action on the right
    const foot = step === 'analysis' ? `${cur.model.source === 'new' ? '' : cloneProgress()}<span class="wizard-spacer"></span>${back}${next}`
      : `${back}<span class="wizard-spacer"></span>${next}${finish}`;
    root.innerHTML = `<div class="wizard-panel wizard-at-${step}" data-testid="wizard-panel" tabindex="-1">
        <header class="wizard-head">
          ${stepper()}
          <button type="button" class="btn ghost wizard-close" data-act="close" data-testid="wizard-close" aria-label="${esc(t('common.close'))}">×</button>
        </header>
        <section class="wizard-body">${cur.exists ? resume.existsBody() : BODY[step]()}</section>
        <footer class="wizard-foot" data-testid="wizard-footer">${cur.exists ? back : foot}</footer>
      </div>`;
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
      if (cur.model.step === 'review') loadReview(); // an analysis done meanwhile: read what it made
      activity.followAnalysis(); // #781
      renderSoon();
    }
  }

  // The review's reads, without waiting: each one once its analysis is done (the backlog at once, synced
  // when it was never read: a project just imported has no cache); a failed read counts as answered with nothing
  function loadReview() {
    const pid = cur.projectId;
    if (!pid) return;
    const backlogRead = () => Promise.resolve(api.getBacklog?.(pid)).then((data) => data || api.syncBacklog?.(pid));
    const reads = [['backlog', backlogRead, true], ['city', () => api.architectureCity?.(pid), jobDone('projectMap')],
      ['facts', () => api.architectureFacts?.(pid), jobDone('projectMap')], ['report', () => api.architectureReport?.(pid), jobDone('projectMap')]];
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
  // notifies when it ends (remember). city: the review's Open the city finishes the same way, then shows
  // the project's City tab
  function finish({ city = false } = {}) {
    const pid = cur.projectId;
    const idea = cur.idea.trim();
    const running = ACTIVE.includes(cur.onboarding?.status);
    const workflows = pickedWorkflows();
    const extra = { platform: platformOfRepo(cur.model.repository)?.id || cur.provider || null, kind: cur.kind || null, workModel: workModel.picked() };
    close();
    if (!pid) return;
    if (running) finished.add(pid);
    const failed = (e) => showToast(t('onboarding.finish_failed'), errMsg(e));
    new Promise((resolve) => resolve(api.finishOnboarding(pid))).catch(failed); // #741: no longer "Onboarding not finished"
    // #729: the step 3 workflows on the project, feature the default (DefaultWorkflow.firstBuild's rule), saved before
    // the project's page opens: its reads (listProjectRuns) then see them; the page opens whether the save succeeds or fails.
    // The saved record goes into state.projects (the backlog's pickers read the set and default there), as project-workflows.js's
    // save() does. #745: the platform picked (a self-hosted host its URL does not name: the Backlog never asks again); #735: the kind
    const patch = { workflows, defaultWorkflow: DefaultWorkflow.firstBuild(workflows) || 'feature', ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) };
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
    cur.model = { ...cur.model, step: 'analysis' };
    if (cur.estimate !== undefined) return;
    const pid = cur.projectId;
    Promise.resolve(api.architectureEstimate?.(pid)).then((r) => {
      if (!cur || cur.projectId !== pid) return;
      cur.estimate = Number.isFinite(r?.estimate?.usd) ? r.estimate.usd : null;
      render();
    }).catch(() => { if (cur?.projectId === pid) { cur.estimate = null; render(); } });
  }

  async function call(fn) {
    cur.busy = true;
    render();
    try {
      remember(await fn());
    } catch (e) {
      showToast(t('onboarding.action_failed'), errMsg(e));
    } finally {
      if (cur) { cur.busy = false; render(); }
    }
  }

  async function next() {
    if (!canNext()) return;
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
        const state = await begin();
        // #741: a finished project of this repository: say it exists; an unfinished one resumes at its step
        if (state?.exists) cur.exists = state.projectId;
        else resume.at(state, name);
      } catch (e) {
        showToast(t(creating ? 'onboarding.new_create_failed' : 'onboarding.start_failed'), errMsg(e));
      } finally {
        if (cur) { cur.busy = false; cur.creating = null; }
        render();
      }
      return;
    }
    if (cur.model.step === 'repository') toAnalysis();
    // #725: Continue before the analysis was started is "analyze later" (the review says so, not pending)
    else if (cur.model.step === 'analysis' && !['analyzing', 'analyzed'].includes(cur.onboarding?.status)) cur.model = M.skipAnalysis(cur.model);
    else cur.model = M.next(cur.model);
    if (cur.model.step === 'review') loadReview();
    render();
  }

  // step 1's other sources: step 2 with the URL field ready to type in, filled from a picked folder
  function toRepository(fields = {}) {
    cur.model = { ...cur.model, ...fields, source: 'import', step: 'repository' };
    render();
    document.getElementById('wizard-repo')?.focus?.();
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
    if (act === 'source-new') cur.model = { ...cur.model, source: 'new' };
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
      const nextBtn = document.getElementById('wizard-next');
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
      render();
      const nameField = document.getElementById('wizard-name');
      if (nameField) nameField.value = cur.model.name;
      document.getElementById('wizard-name')?.focus?.();
    }
    else return false;
    return true;
  }

  async function onClick(e) {
    const act = e.target?.closest?.('[data-act]')?.dataset.act;
    if (!act || !cur) return;
    if (act === 'close' || act === 'cancel') close();
    else if (act === 'source-import') { cur.model = { ...cur.model, source: 'import' }; render(); }
    else if (onCreateClick(act, e) || onRepoClick(act, e)) return;
    else if (act === 'source-git-url') toRepository();
    else if (act === 'source-folder') await fromFolder();
    else if (act === 'open-city') finish({ city: true });
    else if (act === 'create-issue') {
      const button = e.target.closest('[data-act]');
      await createIssue(Number(button.dataset.finding), button.dataset.prioritize !== undefined);
    }
    else if (act === 'next') await next();
    else if (act === 'back') { cur.model = M.back(cur.model); render(); }
    else if (act === 'retry' && cur.projectId) await call(() => api.retryOnboarding(cur.projectId));
    // #738: the fork suggestion's two choices; the answer (cloned, the fork chosen) moves on to analysis
    else if (FORK_CALLS[act] && cur.projectId) await call(() => api[FORK_CALLS[act]](cur.projectId));
    // #725: the workflows column's two ways in; Analyze the repository starts the analysis (the paid part
    // too), or runs again a failed profile job
    else if (act === 'workflows-manual') { cur.workflowsMode = 'manual'; render(); }
    else if (act === 'workflows-analyze' && cur.projectId) {
      cur.workflowsMode = 'analyze';
      const again = jobOf('profile').status === 'failed';
      await call(() => (again ? api.retryOnboarding(cur.projectId) : api.analyzeOnboarding(cur.projectId)));
    }
    else if (act === 'skip') { cur.model = M.skipAnalysis(cur.model); loadReview(); render(); }
    else if (act === 'finish') finish();
    else if (act === 'edit-repo') {
      // a new import from the same fields; the failed one stays in the tray with its Retry
      cur = { ...cur, projectId: null, onboarding: null, estimate: undefined, workflowsMode: undefined, ...freshReview() };
      render();
      document.getElementById('wizard-repo')?.focus?.();
    }
    else if (act === 'setup') openSetup();
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
    if (id !== 'wizard-repo' && id !== 'wizard-name') return;
    const value = String(e.target.value || '');
    cur.model = { ...cur.model, [id === 'wizard-repo' ? 'repository' : 'name']: value };
    // #739: the name follows the URL until the owner types one; cleared, it follows again
    if (id === 'wizard-name') cur.nameTyped = value.trim() !== '';
    else if (!cur.nameTyped) {
      cur.model = { ...cur.model, name: M.displayNameFromUrl(value) };
      const nameField = document.getElementById('wizard-name');
      if (nameField) nameField.value = cur.model.name;
    }
    // the provider toggle follows the URL (its buttons keep their place: the caret stays)
    const on = pickedProvider();
    for (const id of providers()) {
      const b = document.getElementById(`wizard-provider-${id}`);
      b?.setAttribute?.('aria-pressed', String(on === id));
      b?.classList?.toggle?.('active', on === id);
    }
    const into = document.getElementById('wizard-clone-into');
    if (into) into.textContent = cloneInto();
    const nextBtn = document.getElementById('wizard-next');
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
      root.addEventListener('click', (e) => { if (!resume.onClick(e)) onClick(e); }); // #741: the "already exists" notice first
      root.addEventListener('input', onInput);
      root.addEventListener('change', (e) => { onInput(e); if (cur) resume.save(); }); // #741: a pick made without a render
      root.addEventListener('keydown', onKey);
      root.addEventListener('focusout', (e) => { if (cur?.stale && e.target?.id === 'wizard-review-idea') { cur.stale = false; render(); } });
      document.body.appendChild(root);
    }
    // Import is selected when the wizard opens (mock-1); #632: the create step's choices start at mock-3's
    cur = { model: { ...M.initialState(), source: 'import' }, projectId: null, onboarding: null, estimate: undefined, busy: false, accounts: undefined, repos: {}, starts: 'readme', remote: false, remoteProvider: null, answers: { ...M.CREATE_DEFAULTS }, workflowsMode: undefined, workModel: undefined, nameTyped: false, ...freshReview() };
    root.hidden = false;
    render();
    tray.refresh(); // #724: hidden while the wizard is open
    root.querySelector('.wizard-panel')?.focus?.();
    loadAccounts();
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
    close,
    open,
  };
  window.Actions.register('openProjectWizard', (opts) => open(opts || {})); // Setup's First project step asks for it (setup.js)
})();
