# The new-project wizard

The first project's onboarding: the wizard, its progress tray, the review and the project page's Next steps card (#629).

## Where it lives

- `fronts/build/views/projects/project-wizard.js` (and `project-wizard.css`): the wizard
  (`window.ProjectWizard = { open, close }`, the `openProjectWizard` action) and the progress tray. Its
  header lists every test id and the channels it calls.
- `packages/shared/onboarding-model.js` (`window.OnboardingModel`, pure, dual-load): the steps, the
  wizard's state, the workflow suggestions from the profile and the cost sum.
- `packages/engine/service/areas/project-onboarding.js` and `channels/onboarding.js`: the jobs after an
  import (clone → facts → profile ∥ project map → ranking), `onboarding:start | status | analyze | retry`
  and the `onboarding:changed` event.
- `fronts/analyser/views/project/project.js`: the Next steps card (`project-next-steps`), shown after
  Finish until dismissed, remembered per project in localStorage `multiagent.nextSteps`.

## Who opens it

Home's empty state (`home-empty-create-project`, `packages/ui-kit/views/dashboard/dashboard.js`, #644),
Projects › New project (`projects.js`) and the Setup's First project step (`packages/ui-kit/setup.js`, #643),
each through `window.Actions.call('openProjectWizard')`: the ui-kit never imports the build front, so
Home falls back to the old dialog (`openProjectModal`) when the action is not registered. Edit keeps the
old dialog.

## The steps

The screens follow the spec's mockups (#669, `docs/work/first-project-onboarding/images/mock-1, 2, 4, 6,
7.jpg`): what phase 1 does not do yet stays visible and disabled. The panel has the numbered step pills
(`wizard-steps`, one `wizard-step-pill` each, the current one `aria-current="step"`) over a divider, the
step's body (its title is `#project-wizard-title`) and the footer (`wizard-footer`) over a divider: Cancel
(`wizard-cancel`, step 1) or Back on the left, the step's action on the right.

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
   `packages/shared/onboarding-model.js`). #739: the name (`wizard-name`) follows the URL, typed, pasted or
   picked from the list, with one rule (`displayNameFromUrl` of the model: `acme/ai-memory` → "Ai Memory")
   until the owner types a name; clearing it makes it follow again. "Next: clone and continue"
   calls `onboarding:start`. #743: the access check and the clone read as one wait in place: `wizard-next`
   is disabled with a spinner (`wizard-spinner`) and "Cloning <name>…", the fields read-only, no status
   card; the clone done goes straight to the analysis step. The panel (`wizard-panel`) has one fixed size
   on every step and state: its body scrolls. A refused access shows `wizard-error`
   `data-error="no-access"` with Retry, Sign in and Edit the URL (`wizard-edit-repo`: a new import from
   the same fields, the failed one stays in the tray); a failed clone, `data-error="clone-failed"`. A
   missing or signed-out gh / glab is a warning (`wizard-cli-warning`), the import goes on.
   **Create new** (#632, mock-3, step 2 with the Create card): on the left the name (`wizard-new-name`),
   what it starts with (`wizard-new-starts` radios: README and .gitignore with a first commit on `main`, or
   Empty, `git init` only), the private remote's checkbox (`wizard-new-remote`, unchecked, disabled without a
   signed-in gh / glab) with its platform (`wizard-new-remote-provider`) and hint (`wizard-new-remote-hint`),
   and the folder `<workspace>/projects/<slug>` (`wizard-new-folder`, `slugify` of the onboarding model).
   On the right the three questions (`wizard-question` `data-question="mode | ci | release"`, one
   `wizard-chip` per answer, `CREATE_ANSWERS` / `CREATE_DEFAULTS` of the model). Next calls
   `onboarding:create` (the engine's `create` in `project-onboarding.js`: the local repository, then the
   remote only when asked and signed in; a failed remote leaves `remote.status = 'failed'` and the local
   project). The project is ready at once, the stepper's third pill reads "Workflows" and step 3 follows.
3. **analysis** (mock-4): on the left the jobs from the clone on with their status and the cost before the
   click (`wizard-cost`, `wizard-cost-total`, one `data-part` per paid analysis, `wizard-skip`). A failed
   job is a state of the analysis, never "not started": its row reads the reason in the error colour
   (`wizard-job-error-<id>`, the engine's `code` — cli-missing, invalid-ranking, no-folder, refused,
   timeout, failed — translated, the full error on hover), "—" as its amount, and Retry
   (`wizard-job-retry-<id>`, `api.retryOnboarding`, which reruns only what failed or never ran: a done
   project map is not paid twice). On the right the suggested workflows (`wizard-workflows-column`,
   #725, `workflowsColumnState` of the model) start with two choices: Analyze the repository
   (`wizard-workflows-choice-analyze`, starts the analysis) and Define manually
   (`wizard-workflows-choice-manual`); no row before that. Analyzing dims the rows (`wizard-workflows-rows`
   `aria-busy`, inert) under an overlay with a spinner (`wizard-workflows-analyzing`,
   `wizard-workflows-spinner`); then the profile's picks and reasons. A failed profile shows its reason,
   Retry (`wizard-workflows-retry`) and Define manually (`wizard-workflows-failed`). Manual shows the rows
   editable without a reason, Analyze still offered; a running job's row has a spinner instead of its dot.
   The footer shows the clone's progress (`wizard-clone-progress`, `data-status` the clone job's, with
   `wizard-spinner` while it runs) on the left, Back and Continue (`wizard-next`) on the right: always enabled,
   the analysis goes on in the background and the review shows what is pending. Nothing paid starts
   without Analyze; Continue before it skips the analysis.
4. **review** (`wizard-review`, mock-6): three cards, the project (how it is worked on, its workflows),
   the city (`wizard-review-city`, Open the city) and the refactor backlog, then the backlog and an idea
   for the Inbox; each section `data-state="ready | pending | failed | skipped | later"`; each refactor
   with its file's score and quadrant and an unchecked pick. `wizard-finish` never waits: the project's
   page opens with the Next steps card, the picked refactors go to the roadmap as planned items and the
   idea to the Inbox.

The Next steps card (mock-7) has five entries in a grid of three (`next-step-<id>`): the refactors to
file and add, the first idea, the refactor cadence ("Turn on" opens the Refactor tab, where the cadence is
turned on), and release CI and screenshots, shown disabled (later phases). Its heading adds "· city and
refactor backlog done" once the refactor proposals are there, and the number of the project's workflows
only when the project has its own set (a wizard import has none, so no count).

The tray (`onboarding-tray`, one `tray-item` per import with `data-status`) follows `onboarding:changed`.
#724: it is hidden while the wizard is open (the wizard shows the import's progress itself, nothing
covers its footer); with the wizard closed it lists only what needs attention: an import running (with
`tray-spinner`) or failed (its reason and Retry). A finished import (ready or analyzed, no paid job
failed) leaves it about 5 s later with the toast "<name> imported" and Open the project (no toast when
the wizard showed it, nor when Finish's own toast says the analysis ended). No item left: hidden.

## Texts

Every text of the wizard, the tray, the review and the Next steps card is an `onboarding.*` key of
`packages/shared/i18n/en.json` and `pt-BR.json` (the same set in both); `apps/desktop/test/i18n-every-screen-330.test.js`
fails a literal visible text.

## Checking it

- Screenshots: `npm run screenshot -- --view onboarding --mode <start | repository | cloning |
  access-error | analysis | review>` (`scripts/screenshot/views/onboarding.js`): the wizard over Home in
  a new workspace, driven through its own controls. analysis and review import a local git repository
  (file://, no network) and run the analyses simulated; cloning says `cloning` on the real
  `onboarding:changed` channel for the project a failed import made (a local clone ends too fast).
- E2E: `features/onboarding.feature` (steps in `features/steps/onboarding.steps.js` and
  `onboarding-journey.steps.js`), simulated: from the empty Home to the Next steps card, and the
  no-access path with Edit the URL. `npm run test:e2e -- --grep @issue-644`.
- Spec and plan: `docs/work/first-project-onboarding/`; the decisions in `docs/agents/decisions.md` (#629).
