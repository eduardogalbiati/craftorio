---
item: first-project-onboarding
issue: "#628"
stage: plan
status: accepted          # accepted by the product owner on 2026-10-31
author: Claude (Code session), from the owner's request
approver: Eduardo Galbiati (product owner)
date: 2026-10-31
translation: intent.pt-BR.md
---

# Intent: first project onboarding

## Problem

Adding the first project is the first thing anyone does in the app, and today it does not leave the project ready for the whole flow.

- Setup ends by opening the generic **New project** dialog. It asks for a name, a URL, a folder and 15 workflow checkboxes before the app knows the project.
- The clone runs **inside** Create (`createProject` awaits `git clone`): with a big repository, the screen hangs.
- The analysis (**Ways of working**), the **city** and the **refactor backlog** already exist, but they sit behind buttons and tabs of the project's page, to be found later.
- The 15 bundled workflows overlap. The owner uses one (`ai-development-local-hero`), and that same flow serves both features and fixes.
- The ways of working profile asks "solo or team", which does not change the flow. It does not separate what really changes: working only locally or locally with remote PRs, and where CI runs.

![Setup › First project today](images/setup-project.jpg)
![New project today](images/new-project.jpg)

## Proposed outcome

In a few minutes, whoever opens the app leaves with a project ready to work on:

- the code cloned (or a new repository created);
- how the project is worked on today, read from git (local or remote mode, CI, tests, release);
- three default workflows, chosen and explained: **feature**, **fix** (with its hotfix mode) and **release**;
- the project's city and a ranked refactor backlog, with each file's score;
- the project's work model: which artifacts (intent, spec, plan) each item produces;
- clear next steps, and nothing entering the roadmap without the user's choice.

## Affected users and systems

- **Users:** whoever installs the app for the first time, and whoever adds one more project. Often not technical (they sell or plan the product), but they work with git.
- **Systems:**
  - Setup (`packages/ui-kit/setup.js`) and Projects (`fronts/build/views/projects/`);
  - `createProject` (`packages/engine/domains/project/projects.js`);
  - Ways of working (#487: seed, interview, compose);
  - `project-map` and Refactor (#357);
  - the bundled workflows and the pipelines;
  - the project auto-push, which goes away;
  - the Backlog and the Roadmap.

## Constraints

- **AGENTS.md rules:**
  - the app in English;
  - the workspace is the product;
  - agents run unattended (only Grill me asks);
  - no automation crosses a `human_approval`;
  - checks in simulation only.
- A real-model call only with its cost shown first and the user's click.
- Onboarding never writes to the user's repository. Project files (artifacts, CI, the screenshot harness) only come through a run, at its usual gate.
- Actions that leave the machine (creating a remote repository, signing in to `gh`/`glab`) only on an explicit click.
- GitHub and GitLab take the same path.
- The **Planning** workflows (writer-reviewer, ai-arena, issue-tracker) stay out: they are the next proposal.

## Open questions

1. Does Setup's Workflows step go away? *Proposed: yes.*
2. Do the model analyses come checked? *Proposed: yes, with the total shown and "Skip, analyze later".*
3. Is hotfix a workflow of its own or a mode of fix? *Proposed: a mode of fix.*
4. How long do the workflows' old names keep working? *Proposed: two releases, through aliases.*
5. Is the Monitor (production errors becoming intents) part of this delivery? *Proposed: no, it is the last phase.*
