---
item: first-project-onboarding
issue: "#629 (phase 1 of epic #628)"
stage: build
scope: phase 1 (MVP): the wizard with what exists; phases 2–6 get their own plan.md
status: accepted          # accepted by the owner (engineer / tech lead) on 2026-10-31
spec: spec.md (signed off)
date: 2026-10-31
translation: plan.pt-BR.md
---

# Plan: first project onboarding, phase 1 (MVP)

Scope of this phase: R1, R2, R3, R5, R7 (with today's workflows), R10 and R11 (without "Set up release CI" and "Investigate screenshots"). Left for the next phases, each with its own plan:
- the revisited profile (R6) and the new workflow set (R8): phase 2;
- the rest of the reorganization: phase 3;
- create new (R4): phase 4;
- the work model (R9): phase 5;
- the Monitor (R12): phase 6.

## Files that change

**New**
- `packages/shared/onboarding-model.js`: the steps, the wizard's state, the workflow suggestions from the profile and the cost sum. Pure, dual-load.
- `fronts/build/views/projects/project-wizard.js` and `project-wizard.css`: the wizard, the progress tray and the review.
- `packages/engine/service/areas/project-onboarding.js`: the jobs (clone → facts → profile ∥ project-map → ranking), the state per project and Retry.
- `packages/engine/service/channels/onboarding.js`: `onboarding:start`, `onboarding:status`, `onboarding:analyze` and `onboarding:retry`, with their events.
- `scripts/screenshot/views/onboarding.js`: the seed of each step and state (cloning, access error, analyzing, review).
- `features/onboarding.feature`: the path from the empty Home to a ready project, simulated.
- Tests in `fronts/build/test/` and `packages/engine/test/`.

**Changed**
- `packages/engine/domains/project/projects.js`: the clone moves out of `createProject` into a job; `status` (`cloning | ready | failed`) and `checkAccess` (`git ls-remote`) are added.
- `packages/ui-kit/setup.js` and `packages/shared/setup-model.js`: three steps, no Workflows; the last one opens the wizard.
- `fronts/build/views/projects/projects.js`: New project opens the wizard; the dialog stays for Edit.
- `fronts/analyser/views/project/project.js`: the "Next steps" card.
- `packages/engine/service/areas/workflow-interview.js`: the free profile always, and the model only for the null fields.
- `packages/shared/i18n/*`: the `onboarding.*` keys.
- Docs: `docs/agents/renderer/` (a page for the wizard), the header of each new file, and the signed-off decisions in `docs/agents/decisions.md`.

## Order of work

1. **`onboarding-model.js` and its tests:** steps, suggestions by R7's rules (with today's workflows), cost.
2. **The clone as a job:** `checkAccess`, the project status, Retry, and tests with a fake git (no network).
3. **`project-onboarding.js` and the channels:** the chain, the machine's slots, the events, and the error paths (no access, no `gh`/`glab`, the clone failed).
4. **The wizard in the UI:** steps 1 to 3, the progress tray, and the cost before the click.
5. **The review and "Next steps":** each file's score in the refactor backlog; chosen refactors to the roadmap; capture an idea.
6. **Setup without its Workflows step**, opening the wizard; Projects › New project opening the wizard.
7. **The screenshot seed, the E2E feature, i18n and the docs.**

## Risks

- **A race between the clone and the analyses:** no analysis starts before the clone ends (tested with a slow fake clone).
- **A half-created project:** if the app closes during the clone, it shows `failed` on reopening, with Retry, never `ready`.
- **Unexpected cost:** in simulation nothing calls a model (`MULTIAGENT_SIMULATION_ONLY=1`); for real, the analysis starts only on the click, and its cost comes from `seeds:estimate`.
- **Setup in older workspaces:** an existing `setupDone` never reopens Setup; the Workflows step goes away without clearing anyone's `hiddenWorkflows`.

## Proof

- **Unit:**
  - `onboarding-model` (suggestions for the local/remote × CI × tests profiles; the cost sum);
  - the clone as a job (success, no access, failure and Retry);
  - the chain of jobs (order and slots).
- **E2E (`features/onboarding.feature`, simulated):** from the empty Home, import a sample repository, step 3 with simulated analyses, the review with the city and backlog, Finish, the "Next steps" card.
- **Screenshots:** `npm run screenshot -- --view onboarding --mode <start|repository|cloning|access-error|analysis|review>`, with the axe checks.
- **No real run** in the checks; a short real session only with the owner's notice and consent.

## Progress

Filled in by the Code & Build workflows at each step: the run, the commit and the PR (in remote mode) or the local merge. Nobody edits this table by hand.

| Step | Status | Run | Commit / PR |
|---|---|---|---|
| 1. `onboarding-model.js` and tests | done | 20261031-143716-3710e990 | d7ba344d, local merge into main |
| 2. The clone as a job | done | 20261031-145746-8dfe137a | 4349332d, local merge into main |
| 3. Jobs and channels | pending | — | — |
| 4. Wizard in the UI | pending | — | — |
| 5. Review and Next steps | pending | — | — |
| 6. Setup and Projects | pending | — | — |
| 7. Seed, E2E, i18n, docs | pending | — | — |
