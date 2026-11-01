---
item: documentation-agent
issue: "#658"
stage: plan
status: proposed          # proposed → accepted | rejected (product owner)
author: Claude (Code session), from the owner's request
approver: Eduardo Galbiati (product owner)
date: 2026-11-01
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

On 2026-11-01 first project onboarding phase 1 (#629) showed it: seven Code & Build runs ran the suite, E2E and screenshots, `test.md` stayed the skeleton, and the page kept the item in Build, because an accepted plan is not an advance point and nothing marks the plan built. The Progress rows were right only because every issue (#638-#644) gave the developer a task to write them, and evidence cannot come that way: it is produced after develop.

The public page (`site/`) reads exactly these files: "plan: N of M steps", shipped and lead time, the changelog chips, the milestones. A file nobody updated is a wrong page. And the owner's agents are meant to only commit to git, with the page republished from `main`. So the updates have to come from the workflows themselves.

## Proposed outcome

A **documentation agent** step in the Code & Build workflows keeps each item's documents current, in real time, as part of the run that changed the item. It is committed by that run, at its usual gate. Projects opt in when they are created, through a new onboarding option, **"Add the realtime documentation model"**.

It arrives in three parts:

1. **With the workflows** (`feature`, `fix`, `release`, after #630):
   - `plan.md`: the front matter (`status`, `date`) and the `## Progress` row (Status `done`/`pending`, the run, the commit or PR), after each feature or fix run;
   - `test.md`: a row per run (the run, the unit and E2E counts, the screenshots taken or why none were, the axe findings), the run's final before/after screenshots copied to `images/`, and `status: collecting`;
   - `deploy.md`: the review findings, and on release `release:` and `released:` (which the page needs for shipped and lead time);
   - `CHANGELOG.md` (+ `CHANGELOG.pt-BR.md`) at the root, in the Keep a Changelog format: the `release` workflow adds each version, and a `docs/work/<item>/` link becomes the item's chip.
2. **The Test stage** (with part 1): when every Progress row is `done`, the step sets `plan.md` to `status: built` and the reader moves the item from Build to Test. A **Test workflow**, started from the Roadmap on a built item (never automatically), runs the quality gates on the integrated base:
   - the full suite with coverage and the full E2E, every `@visual` scenario with a committed baseline (#696);
   - each of the item's screens compared with its spec mockup, with the coverage listed (#670);
   - the evals, in the Full work model;
   - then `status: in review` and a `human_approval` for the code owner, who approves by reading `test.md`: `passed` moves the item to Deploy, `failed` files the findings as fix issues.
3. **With the work model and the Monitor** (after #633, with #634):
   - `maintain.md`: incidents and post-mortems;
   - milestones in `docs/work/<name>/milestone.md` (`kind: milestone`, `expected:`, `reached:`);
   - an intent born from an incident (a new item's `intent.md` with its Inbox card).

It **does not write `intent.md` or `spec.md`**. That is the write doc flow (#636). This agent only updates their status in the front matter after the human gate.

## Affected users and systems

- **Users:**
  - the owner and readers of the public page, who see true progress without anyone editing files by hand;
  - contributors, who find each item's state in the repository.
- **Systems:**
  - the `feature`, `fix` and `release` workflows (a documentation step before the merge);
  - a new Test workflow and its code owner's gate;
  - the reader's stages (`built` advances Build to Test);
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
- Its tests use fixtures, never a live document under `docs/work/` (#695); a docs-only commit runs no tests, so the step runs the document lint itself.
- It follows `docs/work/CONVENTIONS.md`: the English file first, then the `.pt-BR.md` translation beside it.
- It writes to the user's repository only through the run, at its usual gate. Onboarding never writes.
- **Cost:** the step is deterministic where it can be (tables, front matter, release fields), and calls a model only for prose (the test summary, the changelog entry). The cost is shown and counted toward the daily budget.

## Open questions

1. A separate agent turn, or a deterministic step for the tables plus a model only for prose? *Decided (owner, 2026-11-01): a machine step, `record_docs` (no model), for the tables and front matter, before the merge of each run; a model turn only for prose.*
2. Default of the onboarding option? *Proposed: on for the Standard and Full work models, off for Light.*
3. Does the release write the changelog from the items' intents, or from the merged commits? *Proposed: from the items shipped in the release (their intent titles and links), with the commits as a fallback for changes outside any item.*
4. Who updates the documents of a run that fails or stops at a gate? *Proposed: the step runs at the end of a successful run only. A stopped run leaves Progress `pending`, and its gate shows why.*
