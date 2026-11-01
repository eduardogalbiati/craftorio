---
name: intent-writing
description: Writes and scores the intent of a work item (docs/work/<item>/intent.md and its pt-BR translation) - the problem, the proposed outcome, who and what it affects, the constraints and the open questions with a recommended answer, plus the rubric the reviewer scores it with. Use in the write-doc workflow for the intent stage.
summary: "Intent structure (problem, proposed outcome, affected users and systems, constraints, open questions) and scoring rubric"
used_by: "write-doc (`document: intent`)"
---

# Intent

The intent is the first stage document of a work item: it says **what hurts** and **what good
looks like**, not how to build it. The owner accepts it (Accept intent) before anybody writes the
spec.

## Before writing

- Read what exists of the item (docs/work/<item>/) and the screens it is about; ground every claim
  in the product as it is.
- **Never invent facts**: what you do not know is an assumption or an open question.
- You run unattended: every open question gets a `**Recommended:**` line with your answer.
- One requirement of the editor: keep the headings and the **D1.** labels in the same order in the
  English source and in the pt-BR translation (the editor aligns them).

## Required structure

Front matter (`item`, `stage: intent`, `status: draft`, `date`), then exactly these sections:

```
# <Item title>

## Problem
Who has the problem, how it shows today (screens, numbers), why now.

## Proposed outcome
What is true once the item is done, observable by the owner; no design.

## Affected users and systems
The people, screens, services and workflows the change touches.

## Constraints
What must not change or break, budgets, deadlines, dependencies.

## Open questions
**D1. <question>**
**Recommended:** <answer and why>.
```

## Scoring rubric (0–10 each)

| Criterion | 10 means |
|---|---|
| **Problem** | the pain, the people and "why now" fit in one sentence anybody repeats |
| **Outcome** | observable, testable by the owner, free of design choices |
| **Reach** | every affected user, screen and system named |
| **Constraints** | real limits stated, nothing invented |
| **Questions** | every open decision labelled, each with a recommended answer |
| **Translation** | the pt-BR file has the same sections and labels in the same order |

Final score = simple average of the criteria, one decimal place.

## Done when

The five sections are present in both languages, the front matter is complete and every open
question has its **Recommended:** line.
