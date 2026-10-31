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

1. **start**: import a repository (`wizard-source-import`); create new (`wizard-source-new`) is
   disabled, "soon" (phase 4).
2. **repository**: `#wizard-repo`, `#wizard-name`, the provider badge read from the URL. Next calls
   `onboarding:start`; `wizard-import-status` follows the clone. A refused access shows `wizard-error`
   `data-error="no-access"` with Retry, Sign in and Edit the URL (`wizard-edit-repo`: a new import from
   the same fields, the failed one stays in the tray); a failed clone, `data-error="clone-failed"`. A
   missing or signed-out gh / glab is a warning (`wizard-cli-warning`), the import goes on.
3. **analysis**: the jobs with their status, the cost before the click (`wizard-cost`,
   `wizard-cost-total`, one `data-part` per paid analysis), `wizard-analyze` or `wizard-skip`. Nothing
   paid starts without the click.
4. **review** (`wizard-review`): the city, the backlog and the refactor backlog, each
   `data-state="ready | pending | failed | skipped | later"`; each refactor with its file's score and
   quadrant and an unchecked pick; an idea for the Inbox. `wizard-finish` never waits: the project's page
   opens with the Next steps card, the picked refactors go to the roadmap as planned items and the idea
   to the Inbox.

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
