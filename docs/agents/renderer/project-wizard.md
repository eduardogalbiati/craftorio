# The new-project wizard

The first project's onboarding: the wizard, its progress tray, the review and the project page's Next steps card (#629).

## Where it lives

- `fronts/build/views/projects/project-wizard.js` (and `project-wizard.css`): the wizard
  (`window.ProjectWizard = { open, close }`, the `openProjectWizard` action) and the progress tray. Its
  header lists every test id and the channels it calls.
- `packages/shared/onboarding-model.js` (`window.OnboardingModel`, pure, dual-load): the steps, the
  wizard's state, the workflow suggestions from the profile and the cost sum.
- `packages/engine/service/areas/project-onboarding.js` and `channels/onboarding.js`: the jobs after an
  import (clone → facts → profile ∥ project map; #730: no Product Owner ranking, and no finding sent
  anywhere on its own), `onboarding:start | status | analyze | retry`
  and the `onboarding:changed` event.
- `fronts/analyser/views/project/project.js`: the Next steps card (`project-next-steps`), shown after
  Finish until dismissed, remembered per project in localStorage `craftorio.nextSteps`.

## Who opens it

Home's empty state (`home-empty-create-project`, `packages/ui-kit/views/dashboard/dashboard.js`, #644),
Projects › New project (`projects.js`) and the Setup's First project step (`packages/ui-kit/setup.js`, #643),
each through `window.Actions.call('openProjectWizard')`: the ui-kit never imports the build front, so
Home has no fallback when the action is not registered (#741: the old New / Edit project dialog is gone).
A card's Edit opens the project's page with its settings open (`project-settings`,
`fronts/analyser/views/project/project-settings.js`): the one place to edit a project's name, folder,
repository, base branch, local preview and per-project flags, next to its ways of working and workflows.

## Resuming an unfinished onboarding (#741)

The wizard's step and the owner's picks (repository, name, the workflows column, the analysis choice, the
refactor / finding picks, the idea) are saved with the project's record on every change
(`onboarding:save-wizard`, `onboarding: { step, picks, finished }` in `packages/engine/domains/project/projects.js`);
Finish calls `onboarding:finish`. `fronts/build/views/projects/project-wizard-resume.js` (split out of the
wizard for its size cap) saves and loads that state. `ProjectWizard.open({ projectId })` reopens an
unfinished onboarding at its step with its picks; the card of such a project shows "Onboarding not
finished" (`project-onboarding-unfinished`) with Continue. New project with the URL of a repository whose
project exists (`onboarding:start`, same repository whatever its case, trailing slash or `.git`) resumes it
when unfinished, and for a finished one says it exists with Open the project: never a second project.

## The work model (#633)

Step 3's workflows screen ends with the work model (`wizard-work-model`,
`fronts/build/views/projects/project-wizard-work-model.js`, split out of the wizard for its size cap): how work on
the project is documented, Light / Standard / Full, three tiles over their radios (`wizard-work-model-<model>`,
`WORK_MODELS` and `DEFAULT_WORK_MODEL` of `packages/shared/onboarding-model.js`). The pick is the `workModel` of
the saved picks (resumed like the others) and Finish writes it on the project (`updateProject`'s `workModel`, an
unknown value ignored).

#851 (owner's decision, 2026-11-19): **Light is the default** and carries the **Recommended** badge
(`wizard-recommended`, also on Analyze with AI). Owner's decision, 2026-11-26: **Standard and Full are not ready
yet**: their tiles are shown disabled with "Coming soon" (`wizard-work-model-soon`), a saved `standard` / `full`
is read as `light`, and so the "where the files live" block (`wizard-work-model-files`) never shows. Standard is
Anthropic's [AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) simplified
(intent → spec → plan → code), Full the whole playbook (+ REVIEW.md and evals).

## A new project's step 3 and review (#850)

A new project (source `new`): `OnboardingModel.next()` from its repository step sets `analyzeLater: true`
(the one source for step 3 and the review; an import's is set by its step 3's Continue, #100). Its step 3
opens on the workflows' rows (from the step 2 answers), with no job list. The review never says the analyses were
skipped; "How it is worked on" is the step 2 answer (`onboarding.new_mode_<mode>`). The Next steps'
release CI entry of a project with a `release` workflow says `onboarding.next_steps_release_ci_reason_ready`
(still disabled).

## The review's loading state (#852)

A card whose analysis runs shows `wizard-review-running` (spinner + "running") in its header beside its action; the project
card shows `wizard-review-languages-loading` (skeleton bar, `languagesBlock()` of `project-wizard-activity.js`) until the facts
arrive, then the bar, or `wizard-review-languages-failed`. Under `prefers-reduced-motion: reduce` nothing animates.

## The steps

The screens follow the spec's mockups (#669, `docs/work/first-project-onboarding/images/mock-1, 2, 4, 6, 7.jpg`): what
phase 1 does not do yet stays visible and disabled. The panel has the numbered step pills (`wizard-steps`, one
`wizard-step-pill` each, the current one `aria-current="step"`) over a divider, the step's body (its title is
`#project-wizard-title`) and the footer (`wizard-footer`) over a divider: Cancel (`wizard-cancel`, step 1) or Back on
the left, the step's action on the right.

1. **start** (mock-1): "Add a project", two cards with an icon (`wizard-card-icon`) and three points:
   import a repository (`wizard-source-import`, picked when the wizard opens); create new
   (`wizard-source-new`, #632, the create step below in place of step 2). Other sources (`wizard-other-sources`): Any git
   URL (`wizard-source-git-url`, the URL field of step 2) and A folder on this computer
   (`wizard-source-folder`, a folder pick, then step 2 with its `file://` URL).
2. **repository** (mock-2): `#wizard-repo`, `#wizard-name`, the GitHub / GitLab toggle (`#wizard-provider`,
   it follows the URL), the gh / glab sign-in badges (`wizard-cli-account`, read through `onboarding:accounts`
   when the wizard opens, then from the import's own check), the signed-in account's five latest
   repositories under the URL field (`wizard-repo-list`, `wizard-repo-option`, through `onboarding:repos`;
   a pick fills the full https URL; a typed `owner/repo` becomes the toggle's provider's https URL before
   `onboarding:start`, since the engine does not take the short form), and the line "Will be cloned into
   <workspace>/repos/<owner-repo>" (`wizard-clone-into`, the engine's own rule `repoNameFromUrl` of
   `packages/shared/onboarding-model.js`; #84: a local path gives `repos/<name>`, the engine adds a suffix when that
   folder holds another repository). #79: once the clone is ready the engine checks it can push (state `pushCheck`,
   also after **Create a fork**); a refusal shows the push notice with git's fix and, when the platform CLI has one,
   a button running its setup-git (`onboarding:setup-git`); it never fails the import. #739: the name (`wizard-name`)
   follows the URL, typed, pasted or picked from the list, with one rule (`displayNameFromUrl` of the model:
   `acme/ai-memory` → "Ai Memory") until the owner types a name; clearing it makes it follow again. "Next: clone and
   continue" calls `onboarding:start`. #743: the access check and the clone read as one wait in place: `wizard-next`
   shows a spinner (`wizard-spinner`) and "Cloning <name>…" (`aria-busy`), the fields read-only, no status card; the
   button is disabled only while `onboarding:start` is in flight, then a click goes on to the analysis step without
   waiting (#641: the clone keeps running); the clone done goes straight to the analysis step. The panel
   (`wizard-panel`) has one fixed size on every step and state: its body scrolls. A refused access shows
   `wizard-error` `data-error="no-access"` with Retry, Sign in and Edit the URL (`wizard-edit-repo`: a new import from
   the same fields, the failed one stays in the tray); a failed clone, `data-error="clone-failed"`. A missing or
   signed-out gh / glab is a warning (`wizard-cli-warning`), the import goes on.
   **Create new** (#632, mock-3, step 2 with the Create card): on the left the name (`wizard-new-name`),
   what it starts with (`wizard-new-starts` radios: README and .gitignore with a first commit on `main`, or
   Empty, `git init` only), the private remote's checkbox (`wizard-new-remote`, unchecked, disabled without a
   signed-in gh / glab) with its platform (`wizard-new-remote-provider`) and hint (`wizard-new-remote-hint`),
   and the folder `<workspace>/projects/<slug>` (`wizard-new-folder`, `slugify` of the onboarding model).
   On the right the four questions (`wizard-question` `data-question="mode | ci | release | kind"`, one
   `wizard-chip` per answer, `CREATE_ANSWERS` / `CREATE_DEFAULTS`). #57: `kind` (default frontend) is saved
   on the project: the review's Project kind opens on it, never on "Detect from the files". Next calls
   `onboarding:create` (`create` in `project-onboarding.js`: the local repository, then the remote only when
   asked and signed in; a failed remote leaves `remote.status = 'failed'` and the local project). The project is ready at once, the stepper's third pill reads "Workflows" and step 3 follows.
3. **analysis** (`fronts/build/views/projects/project-wizard.js` `analysisStep()`): one screen at a time, by the
   workflows' state (`wizard-analysis` `data-state`, `workflowsColumnState` of the model, #725):
   - `choose`: the step's title, the question and two big cards, Analyze with AI
     (`wizard-workflows-choice-analyze`, recommended, with what it may cost, `wizard-workflows-choice-cost`; the
     only control that starts the analysis, `onboarding:analyze`) and Define manually
     (`wizard-workflows-choice-manual`, nothing runs). Nothing else: the jobs already done are not listed.
   - `analyzing` (the profile job runs): the progress (`wizard-cost`: `wizard-progress`, a bar of the jobs ended;
     the job rows with their status, an "AI" badge `wizard-job-paid` on one that will call a model, the total
     `wizard-cost-total`) and the analysis' phases (`wizard-workflows-analyzing`, #781,
     `project-wizard-activity.js`: `wizard-phase-git`, `-files`, `-oracle`, read from `workflows:interviewState`).
     The rows are in the DOM (`wizard-workflows-rows` `aria-busy`, inert), not shown. A failed job's row reads the
     reason (`wizard-job-error-<id>`) with Retry (`wizard-job-retry-<id>`, `api.retryOnboarding`); the rows also
     show in any state while a job failed.
   - `failed`: the profile's reason with Retry (`wizard-workflows-retry`) and Define manually
     (`wizard-workflows-failed`), over the job rows.
   - `analyzed` / `manual`: the workflows on the whole width. Each row (`wizard-workflow` `data-kind`) offers its
     choices as tiles (`wizard-workflow-tile`, an icon, a title and one line from the choice's label split at
     " · "; the picked one `aria-pressed`); the row's `wizard-workflow-select` stays in the DOM, not shown. The
     Default row (a repository whose manifest names a default, #790) keeps its select, and carries the acceptance
     notice (`wizard-default-awaiting-acceptance`, #40) in its hint's place. Analysed rows say why
     (`wizard-workflow-reason`); `wizard-way-of-working` (#738) sits on the lead line. While the rest of the
     analysis still runs, `wizard-progress` stays above the rows. Manual keeps Analyze with AI as a link.
     Under the rows, the work model (`wizard-work-model`, below).
   #100 (owner's decision, 2026-11-26): Continue (`wizard-next`) is disabled until the workflows are defined
   (`choose` and `failed` on an import; a new project's rows show at once) and starts nothing: on an import it goes
   to the review with `analyzeLater: true` unless the analysis was asked for. There is no "Skip, analyze later".
   Before this step, a repository the owner can't push to (`fork.status` suggested or failed) holds the import
   step on `wizard-fork-notice` (Create a fork `wizard-create-fork`, Work locally `wizard-work-locally`).
   The footer: the clone's progress (`wizard-clone-progress`, the clone job's `data-status`, `wizard-spinner`
   while it runs; not shown once done), Back and Continue on the right.
4. **review** (`wizard-review`, `fronts/build/views/projects/project-wizard-review.js`, split out of the wizard for
   its size cap): the project's name is the step's title (`#project-wizard-title`, with where it comes from), then
   two columns. At the left the project (`wizard-review-project`): its code (#781 the Health tab's language bar,
   `wizard-review-languages`), its kind as tiles (`wizard-kind-tile`, the picked one `aria-pressed`; it opens on the
   kind the analysis found, marked `wizard-kind-detected`, "Detect from the files" only while no kind is known; the
   select `wizard-kind-select` stays in the DOM, not shown) and its workflows, with the short acceptance notice
   when the default awaits it. At the right what the analyses found: the city (`wizard-review-city`, a strip, with
   Finish and open the city, `wizard-open-city`), the findings (`wizard-review-findings`, #730: the Oracle's report
   from the project map run, one line each, the list scrolls inside its block), the backlog (#781: the activity
   line `wizard-review-backlog-activity` says from where it reads and how far, `backlog:progress`, then the
   summary or that it is empty; this sync, `backlog:sync` with `followed`, reads the list in steps, the adapter's
   `issueListSteps`; a read that fails shows its reason with `wizard-review-backlog-retry`) and #74 what each
   analysis cost on one line (`wizard-review-costs`, absent when skipped). Under both, an idea for the Inbox on one
   line (`wizard-review-idea`). Each section has `data-state="ready | pending | failed | skipped | later"`; each
   finding (`wizard-review-finding`) has its severity and Create issue (`wizard-review-create-issue`) / Create
   issue and prioritize (`wizard-review-create-issue-prioritize`), both through `architecture:createIssue`; once
   filed the issue's link (`wizard-review-finding-issue`) replaces the buttons. `wizard-finish` never waits: the
   project's page opens with the Next steps card and the idea goes to the Inbox; nothing is filed without its own
   click. The body does not scroll on either step.

The Next steps card (mock-7) has five entries in a grid of three (`next-step-<id>`): the refactors to file and add, the first
idea, the refactor cadence ("Turn on" only opens the Health tab, #730: there the findings become issues), and release CI and
screenshots, shown disabled (later phases). #75: no screenshots entry without a user interface: the picked kind decides, else what
the files say now (`projects:inputHints`' `detectedKind`: `backend` with no code, none for an empty project (#57), never saved as the picked kind). The heading adds "· city and
refactor backlog done" once the proposals are there, and the workflow count for a project's own set (an import has none).

The tray (`onboarding-tray`, one `tray-item` per import with `data-status`) follows `onboarding:changed`; its code is
`fronts/build/views/projects/project-wizard-tray.js` (`window.ProjectWizardTray`, over the wizard's maps of states and names).
#724: it is hidden while the wizard is open (the wizard shows the import's progress itself, nothing covers its footer); with
the wizard closed it lists only what needs attention: an import running (with `tray-spinner`) or failed (its reason and
Retry). A finished import (ready or analyzed, no paid job failed) leaves it about 5 s later with the toast "<name> imported"
and Open the project (no toast when the wizard showed it, nor when Finish's own toast says the analysis ended). Empty: hidden.

## Texts

Every text of the wizard, the tray, the review and the Next steps card is an `onboarding.*` key of `packages/shared/i18n/en.json`
and `pt-BR.json` (the same set in both); `apps/desktop/test/i18n-every-screen-330.test.js` fails a literal visible text.

## Checking it

- Screenshots: `npm run screenshot -- --view onboarding --mode <start | repository | cloning |
  access-error | analysis | review>` (`scripts/screenshot/views/onboarding.js`): the wizard over Home in
  a new workspace, driven through its own controls. analysis and review import a local git repository
  (file://, no network) and run the analyses simulated; cloning says `cloning` on the real
  `onboarding:changed` channel for the project a failed import made (a local clone ends too fast).
  The imported repository has a manifest with `default` and `kinds` (#790, #791): `--mode analysis
  --click "[data-testid=wizard-workflows-choice-manual]"` shows the Default row.
- E2E: `features/onboarding.feature` (steps in `features/steps/onboarding.steps.js` and
  `onboarding-journey.steps.js`), simulated: from the empty Home to the Next steps card, and the
  no-access path with Edit the URL. `npm run test:e2e -- --grep @issue-644`.
- Spec and plan: `docs/work/first-project-onboarding/`; the decisions in `docs/agents/decisions.md` (#629).
