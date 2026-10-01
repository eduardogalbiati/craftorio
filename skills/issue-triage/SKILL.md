---
name: issue-triage
description: Rates a requested change before it is filed - the code involved (file:line), the files likely to change, impact 1-5 and complexity 1-5 with a one-line reason each, duplicates and work already in flight, and whether it should run alone or can be grouped with other open issues. Use when analysing a request for the issue tracker or the Backlog.
summary: "Rubric for impact 1-5 and complexity 1-5, estimated files, duplicates, run alone vs group with #n"
used_by: "issue-tracker (code_analyzer, issue_writer); the Product Owner (Register an issue)"
---

# Issue triage

The scores must be **comparable between issues**: two analysts given the same request should land
on the same numbers, give or take one. Ground every claim in the code; mark every estimate as one.
You run unattended: when something is unclear, record the assumption and score the most likely
reading.

## 1. Find the code involved

- Search before describing (`grep`/`Grep`, `git grep`, the file index of the project): name the
  files, functions and lines (`src/engine/gates.js:142, openGate()`) and today's behaviour, with
  today's numbers when there are any ("~20 native checkboxes, only `.switch` styled").
- When the project records runs (a `runs/` folder, logs), quote the run id, the error text, the
  time or the tokens of a real case. A small real timeline beats a paragraph.

## 2. Files likely to change

List each file with one line on what changes there, then count them. It is an **estimate**: say
so (`files_estimate: true`). Count tests and docs separately from production files.

## 3. Impact (1-5): what it costs when it is not done

| Score | Meaning |
|---|---|
| 1 | Cosmetic, or a rare corner case with an easy workaround. |
| 2 | Annoying on some screens or runs; a workaround exists. |
| 3 | Slows a common task, wastes noticeable time or tokens, or confuses users on a main path. |
| 4 | Breaks a feature for some users or projects, or costs money on many runs; no good workaround. |
| 5 | Blocks work, loses data or money, crosses a safety rule (a human gate, a real run in a check), or affects every run. |

## 4. Complexity (1-5): how big the change is

| Score | Meaning |
|---|---|
| 1 | One file, a few lines; no new test file. |
| 2 | 2-3 files in one area (e.g. one screen, one skill, one workflow). |
| 3 | 4-7 files or two areas (e.g. main process + renderer), new tests. |
| 4 | Many files across modules, a new step type, IPC or file format, or a change several workflows depend on. |
| 5 | Engine or data-model changes, a migration of recorded runs or workspace files, or a cross-platform/packaging change. |

Give each score with **one line** of reason pointing to the evidence ("complexity 3: renderer
backlog view + main sync + labels, 5 files").

## 5. Duplicates and work in flight

- Search open **and closed** issues with two different keyword sets, and the **open PRs/MRs**
  (the `issue-creator-<platform>` skill has the commands). An open issue that covers the request
  means "add to #n" (a comment or a task-list edit), not a new issue.
- An open PR that already covers part of it: say which part, so the issue covers only the rest.

## 6. Run alone or group

Look at the open issues that touch the same files (their bodies name files, or the same area).
- **Group with #n** when both are complexity ≤ 2, touch the same files or the same area, and
  neither changes a shared contract (engine, data model, a file format) the other depends on.
- **Run alone** when the complexity is ≥ 4, it touches conflict hotspots (files many open issues
  name, shared lists, the engine), or it changes a contract.
- **Order** when one should land first ("do #77 first: #78 builds on its step type").
- **Avoid running together** two issues that edit the same lines in parallel runs.

## 7. Follow-ups

Smells noticed while analysing (a stray folder, a wrong-language output, a dead option) are
listed as **separate suggestions**, never bundled into this issue.

## Labels

`impact:<1-5>`, `complexity:<1-5>`, the kind (`bug`, `enhancement` or `documentation`), and
optional areas (`area:engine`, `area:renderer`, `area:workflows`, `area:docs`).

## Done when

Every claim about today's behaviour cites a file (and a line or function); the files list is
marked as an estimate; impact and complexity each have one score and one line of reason from the
tables above; duplicates and open PRs were searched; the grouping advice names the issues and why.
