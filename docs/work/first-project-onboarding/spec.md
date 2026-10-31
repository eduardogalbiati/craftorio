---
item: first-project-onboarding
issue: "#628"
stage: design
status: signed off        # by the product owner (and tech lead for the workflow changes) on 2026-10-31
intent: intent.md (accepted)
approver: Eduardo Galbiati (product owner)
date: 2026-10-31
translation: spec.pt-BR.md
---

# Spec: first project onboarding

## Requirements

**R1. Entry.** A four-step wizard (Start · Repository · Analysis & workflows · Review), opened as Setup's last step and from Projects › New project. Setup loses its Workflows step. The old dialog stays for Edit project only.

**R2. Source.** Two cards: "Create new project" and "Import a repository". GitHub and GitLab share one card, with the provider detected from the URL. Smaller links lead to any git URL and a local folder.

![Step 1](images/mock-1.jpg)

**R3. Import.**
- The repository (a URL or `owner/repo`, with the `gh`/`glab` list when signed in) and the project name.
- On Next, it checks access with `git ls-remote` and starts the clone in the background, with a progress tray.
- With no access, it offers the URL's provider sign-in. With no CLI, the import goes on, warning that issues and PRs will be unavailable.

![Step 2](images/mock-2.jpg)

**R4. Create new.**
- `git init`, a README, `.gitignore` and the first commit on `main`.
- An optional private remote on GitHub or GitLab, only with the CLI signed in and a click.
- Three questions: where changes land (Local or Local + remote), CI (none, on releases, or on PRs and releases) and the release style.

![Create new](images/mock-3.jpg)

**R5. Analysis.**
- What is free always runs: the clone, the facts and the Ways of working profile from git.
- What costs comes checked, with the total shown, and runs only on the click: the city + architecture analysis (`project-map`) and the refactor ranking.
- Ways of working calls the model only for the fields git cannot settle.
- "Skip, analyze later" leaves everything to the tabs.

![Step 3](images/mock-4.jpg)

**R6. Ways of working profile, revisited.**
- `team` leaves.
- `mode: local | remote`.
- `ci: none | release | pr+release`, read from the CI files' triggers.
- `tests: unit | unit+e2e` and `e2eCommand`, read from configs, scripts and the order of the CI jobs.
- Unchanged: `release`, `testCommand`, `checkCommand` and `languages`.

**R7. Workflows suggested by rules**, each with its reason and a selector to change it:

| Field | Rule |
|---|---|
| `mode` | local: merge into the local base and **push main as the workflow's last step** (the project auto-push goes away); remote: a PR on GitHub/GitLab, followed and merged there |
| `ci` | pr+release: remote feature waits for the PR's CI; release: the release pushes the tag and waits for the CI run; none: the local suite only |
| `tests` | unit+e2e: feature with E2E first, fix with E2E after; unit: implement, then write the unit tests |
| `release` | with tags: a hotfix branches from the last tag and ships as a patch; per-merge: from main |

**R8. The workflow set (Code & Build).** From 15 to 11, with aliases for the old names (manifests, `hiddenWorkflows`, the roadmap and the run history keep working):

| Today | New |
|---|---|
| `ai-development-local-hero`, `software-development-local-hero`, `software-development`, `multi-model-review` | `feature` (local/remote, E2E first/code first, single or multi-model review) and `fix` (new, with its hotfix mode) |
| `release`, `e2e-release` | `release` (E2E becomes a step) |
| `project-map`, `refactor-proposals` | `analyze-project` |
| `test-batch`, `run-retrospective` | `test-backfill`, `retrospective` |
| `refactor`, `backlog-refresh` | unchanged |
| `writer-reviewer`, `ai-arena`, `issue-tracker` | out (next proposal) |

**R9. Work model.**
- The project picks Light (issue → feature/fix), Standard (intent → spec → plan → code) or Full (+ `REVIEW.md` + evals).
- Feature starts at Standard and fix at Light.
- The artifacts (markdown, English source with a `.pt-BR.md` translation, plus their images) are committed in `docs/work/<item>/` by the run, at its usual gate. A reader renders the markdown at runtime.

![Work model](images/mock-5.jpg)

**R10. Review.**
- Shows the profile, the workflows, the city and the refactor backlog with each file's score (0 to 100) and quadrant, as on the Facts view.
- Finish works at any time, and what is left arrives on the project page with a notification.

![Review](images/mock-6.jpg)

**R11. Next steps.**
- The cards: add chosen refactors to the roadmap, capture the first idea, the refactor cadence, "Set up release CI" when there is no release CI, and "Investigate screenshots".
- "Investigate screenshots" puts a spike on the project's roadmap to find how to run its front end in a sandbox.
- Nothing enters the roadmap without a click.

![Next steps](images/mock-7.jpg)

**R12. Monitor (last phase).**
- A new menu group, with Errors and the Night watch.
- The app polls production errors from connected sources and groups them with no model.
- The diagnosis becomes `intent.md` in an Inbox card. "Propose fix" starts `fix`, which stops at the gate.

![Monitor](images/mock-8.jpg)

## Design

- **Wizard:** `fronts/build/views/projects/project-wizard.js`. The pure rules (steps, suggestions, the cost sum) live in `packages/shared/onboarding-model.js`, testable with no DOM.
- **Background jobs:** `packages/engine/service/areas/project-onboarding.js` chains by dependency: clone → facts → (profile ∥ `project-map`) → refactor ranking. It respects the machine's slots and tells the UI through `onboarding:*` channels.
- **Project:** created with `status: cloning`, then `ready` or `failed`, with Retry.
- **Suggestion:** #487's `composeWorkflowSet`, extended for mode/ci/tests and to generate feature/fix/release.
- **Aliases:** in the workflow loader, where an old name resolves to the new one with its variant's inputs.
- **Where things live:** the project's workflows are referenced in the project's JSON, in the workspace. "Customize" writes to `.multiagent/`, uncommitted.

## Areas of concern

- **For the tech lead (the workflow changes):**
  - renaming workflows touches repository manifests, the saved roadmap and tests;
  - the aliases must land before any rename;
  - fix is the only new workflow.
- **Push in Local mode:** removing the auto-push and adding a final push step closes the #617 race, but it changes a behaviour that users with auto-push on already rely on.
- **Cost:** the model analyses cost about $1–2 per import (an unmeasured estimate) and count toward the daily budget.
- **Writes to the user's repository:** the artifacts (R9), CI (R11) and the screenshot harness only come through a run, with a gate.
- **Monitor security:** the sources' tokens live in the system keychain. A webhook only after the security review (#466–#470).

## Open questions (from the intent and new)

1. How long do the aliases last? *Proposed: two releases.*
2. Which work model comes checked? *Proposed: Standard for feature, Light for fix.*
3. Is the artifacts folder configurable? *Proposed: yes. The default is `docs/work/<item>/`, and Ways of working detects a folder already in use (`docs/rfcs`, `adr/`).*
4. Which error sources does the Monitor support first? *Proposed: Sentry and a log URL or file.*
5. Monorepo with several projects? *Proposed: one project per repository, for now.*
