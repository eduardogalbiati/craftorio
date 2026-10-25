---
name: clarity-score
description: Scores how clear an item is (idea, PRD, RFC, task, bug, hotfix) from 0 to 100% with a rubric per kind, lists what is missing, and holds it to the 85% bar an item needs before a run implements it. Inside a run it never asks - each gap becomes an open question on the item; with a person present ("Grill me") it interviews them one question at a time. Use when writing, triaging or refreshing an item, and when asked to grill someone about one.
summary: "Clarity rubric per kind (0-100%), the 85% bar, gaps as open questions, the Grill me interview"
used_by: "the Discovery board (its score and Grill me, src/domains/discovery/clarity.js); issue-tracker (issue_writer); backlog-refresh (refresher); the Product Owner (Register an issue)"
---

# Clarity score

An item is **ready** when a run can implement it without coming back with questions. The score
measures that before tokens are spent: a number from 0 to 100% and, more useful than the number,
**the list of what is missing**. Two people scoring the same item should land within a few points.

## 1. The rubric

A point counts when the item **states it** (a section, a paragraph, a list: something written, not
a heading over "TBD"). Score = the weight of the points covered ÷ the total weight of the kind's
points, as a whole percentage.

| Point | Weight | Covered when the item says |
|---|---|---|
| Problem | 3 | what is wrong or missing today, and for whom |
| Goal | 2 | what is true when it is done |
| Scope | 2 | which parts change |
| Non-goals | 1 | what is left out on purpose |
| Acceptance criteria | 3 | the criteria that say it is done, each one verifiable (a check someone can run or see) |
| Decisions | 1 | what was decided, and by whom ("Decision (owner): ...") |
| Open questions | 1 | what is still undecided, each with a recommended default; "None" when nothing is |
| Dependencies | 1 | what it needs first or blocks; "None" when nothing |
| Evidence | 1 | what shows the problem is real: file:line, a run id, a log line, a number |

Every kind has these points. Some kinds add their own:

| Kind | Extra points (weight) |
|---|---|
| idea | none |
| task | none |
| PRD | Users (2): who uses it and in which situation; Success metrics (2): the metric and its target |
| RFC | Alternatives considered (2): the other options and why each one loses |
| bug | Steps to reproduce (3); Observed (2): the error text, the wrong value; Expected (2) |
| hotfix | the same as a bug |

A point half covered (acceptance criteria nobody can verify, a goal that restates the title) does
not count: list it as a gap and say what is weak.

## 2. What you return

- `clarity`: the percentage;
- the **gaps**, one line per point not covered, each as a question someone can answer
  ("Acceptance criteria: how do we check the export is complete?");
- who scored it and when, when the place you write to keeps them.

The score describes the text. **Never edit the item's text to raise it**, and never invent the
missing answer: a guess written as a fact hides the gap from the person who must close it.

## 3. The bar: 85%

An item reaches Ready (and from there To do, the roadmap, a run) at **85% or more**, so a few
points may stay open. A project may set another bar, and one per kind (a hotfix may pass lower).
Below the bar the item **needs grilling**. Only the owner moves an item past the bar, with a
reason; you never do, and you never treat a human gate as passed.

## 4. Inside a run: no questions

You run unattended, nobody can answer. Score with the rubric and:

- write each gap as an **open question** in the item you produce (its "Open questions" section,
  with the default you would take), never as a silent assumption;
- say `clarity: <n>%` and, below the bar, **needs grilling**, in the item and in your answer;
- go on with the rest of your task: a low score is a finding, not a reason to stop.

## 5. Grill me: with a person present

Only where a person opened the conversation (a discovery card's thread, the Product Owner's chat),
and only when they ask for it. Then you interview them:

1. **One question at a time**, the most blocking gap first (the rubric's order: problem, goal, the
   kind's own points, scope, non-goals, acceptance criteria, then the rest).
2. Walk the **open branches**: when an answer opens a new decision ("by e-mail" → to whom, how
   often), ask it before moving on; when it closes others, drop them.
3. **Propose an answer when you can** (from the item, the code, a similar item): "I would say X
   because Y. Right?" A yes is a decision; record it as theirs.
4. **Record each decision in the item** as you go, in the section it belongs to, in the person's
   words. Score again after each answer.
5. **Stop** when the score reaches the bar, or when the person ends it. Say the score and what is
   still open.

You never edit an issue on the git platform without the person's click: you propose the text, they
file it.

## Done when

The item has its percentage and its gaps; below the bar it says "needs grilling" and every gap is
an open question (inside a run) or was asked (Grill me); nothing in the item was guessed.
