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
   (`wizard-source-new`) is disabled, "soon" (phase 4). Other sources (`wizard-other-sources`): Any git
   URL (`wizard-source-git-url`, the URL field of step 2) and A folder on this computer
   (`wizard-source-folder`, a folder pick, then step 2 with its `file://` URL).
2. **repository** (mock-2): `#wizard-repo`, `#wizard-name`, the GitHub / GitLab toggle (`#wizard-provider`,
   it follows the URL) and the gh / glab badge once the engine checked it. "Next: clone and continue"
   calls `onboarding:start`; `wizard-import-status` follows the clone. A refused access shows `wizard-error`
   `data-error="no-access"` with Retry, Sign in and Edit the URL (`wizard-edit-repo`: a new import from
   the same fields, the failed one stays in the tray); a failed clone, `data-error="clone-failed"`. A
   missing or signed-out gh / glab is a warning (`wizard-cli-warning`), the import goes on.
3. **analysis** (mock-4): on the left the jobs from the clone on with their status and the cost before the
   click (`wizard-cost`, `wizard-cost-total`, one `data-part` per paid analysis, `wizard-skip`); on the
   right the suggested workflows, disabled (chosen in a later phase). "Analyze and continue"
   (`wizard-analyze`) is in the footer. Nothing paid starts without the click.
4. **review** (`wizard-review`, mock-6): three cards, the project (how it is worked on, its workflows),
   the city (`wizard-review-city`, Open the city) and the refactor backlog, then the backlog and an idea
   for the Inbox; each section `data-state="ready | pending | failed | skipped | later"`; each refactor
   with its file's score and quadrant and an unchecked pick. `wizard-finish` never waits: the project's
   page opens with the Next steps card, the picked refactors go to the roadmap as planned items and the
   idea to the Inbox.

The Next steps card (mock-7) has five entries in a grid of three (`next-step-<id>`): the refactors to
file and add, the first idea, the refactor cadence, and release CI and screenshots, shown disabled (later
phases).

The tray (`onboarding-tray`, one `tray-item` per import with `data-status`) follows `onboarding:changed`
and stays when the wizard closes; a failed import keeps its reason and Retry there.

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
