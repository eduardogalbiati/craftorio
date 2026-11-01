---
item: documentation-agent
issue: "#658"
stage: plan
status: proposed          # proposed → accepted | rejected (product owner)
author: Claude (Code session), from the owner's request
approver: Eduardo Galbiati (product owner)
date: 2026-10-31
depends_on:
  - first-project-onboarding   # phase 2 rebuilds feature / fix / release (#630), phase 5 adds the work model (#633)
  - write-doc                  # intent and spec stay with the write doc flow (#636)
translation: intent.pt-BR.md
---

# Intent: documentation agent

## Problem

The AI-native SDLC artifacts in `docs/work/<item>/` only stay true if someone updates them after every run. Today that is a manual task in each roadmap item:
- the `## Progress` row of `plan.md`;
- the evidence in `test.md`;
- the release fields in `deploy.md`;
- the entry in `CHANGELOG.md`.

The public page (`site/`) reads exactly these files: "plan: N of M steps", shipped and lead time, the changelog chips, the milestones. A file nobody updated is a wrong page. And the owner's agents are meant to only commit to git, with the page republished from `main`. So the updates have to come from the workflows themselves.

## Proposed outcome

A **documentation agent** keeps each item's documents current, in real time, as a **post-flow outside Code & Build**: the chain (`then`) starts it when a Code & Build run finishes with success, and it reads that run's declared outputs (branch, merged commit, PR, the evidence paths) and records them. The `feature`, `fix` and `release` workflows never read or write `docs/work/` (owner decision, 2026-11-01), so every workflow, a user's own included, gets the documents without a step of its own. Projects opt in when they are created, through a new onboarding option, **"Add the realtime documentation model"**.

It arrives in two parts:

1. **After the workflows** (chained after `feature`, `fix`, `release`):
   - `plan.md`: the front matter (`status`, `date`) and the `## Progress` row (Status `done`/`pending`, the run, the commit or PR), after each feature or fix run;
   - `test.md`: the suite and E2E results and the run's before/after screenshots;
   - `deploy.md`: the review findings, and on release `release:` and `released:` (which the page needs for shipped and lead time);
   - `CHANGELOG.md` (+ `CHANGELOG.pt-BR.md`) at the root, in the Keep a Changelog format: the `release` workflow adds each version, and a `docs/work/<item>/` link becomes the item's chip.
2. **With the work model and the Monitor** (after #633, with #634):
   - `maintain.md`: incidents and post-mortems;
   - milestones in `docs/work/<name>/milestone.md` (`kind: milestone`, `expected:`, `reached:`);
   - an intent born from an incident (a new item's `intent.md` with its Inbox card).

It **does not write `intent.md` or `spec.md`**. That is the write doc flow (#636). This agent only updates their status in the front matter after the human gate.

## Affected users and systems

- **Users:**
  - the owner and readers of the public page, who see true progress without anyone editing files by hand;
  - contributors, who find each item's state in the repository.
- **Systems:**
  - the `feature`, `fix` and `release` workflows: unchanged, except an `evidence` output they declare for the post-flow;
  - the chain (`then`), which needs a default per project or roadmap item so the post-flow starts on its own;
  - the onboarding wizard (a new option at project creation);
  - the work model (#633) and the Monitor (#634);
  - `docs/work/CONVENTIONS.md`, which the agent follows;
  - the public page, which reads what it writes.

## Constraints

- **AGENTS.md rules:**
  - the app in English;
  - agents run unattended;
  - no automation crosses a `human_approval`;
  - checks in simulation only.
- It follows `docs/work/CONVENTIONS.md`: the English file first, then the `.pt-BR.md` translation beside it.
- It writes to the user's repository only as its own run, merged the way the project works (local or PR), never inside a Code & Build run. Onboarding never writes.
- **Cost:** the step is deterministic where it can be (tables, front matter, release fields), and calls a model only for prose (the test summary, the changelog entry). The cost is shown and counted toward the daily budget.

## Open questions

1. A separate agent turn, or a deterministic step for the tables plus a model only for prose? *Proposed: deterministic where possible, a model turn only for prose.*
2. Default of the onboarding option? *Proposed: on for the Standard and Full work models, off for Light.*
3. Does the release write the changelog from the items' intents, or from the merged commits? *Proposed: from the items shipped in the release (their intent titles and links), with the commits as a fallback for changes outside any item.*
4. Who updates the documents of a run that fails or stops at a gate? *Proposed: the step runs at the end of a successful run only. A stopped run leaves Progress `pending`, and its gate shows why.*
