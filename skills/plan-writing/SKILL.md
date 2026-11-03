---
name: plan-writing
description: Writes and scores the plan of a work item (docs/work/<item>/plan.md and its pt-BR translation) - the files that change, the order of work, the risks and the proof, plus the rubric the reviewer scores it with. Use in the write-doc workflow for the plan stage, once the spec is signed off; the accepted plan replaces the developer's brief and the issues of the Code & Build runs are filed from it.
summary: "Plan structure (files that change, order of work, risks, proof) and scoring rubric"
used_by: "write-doc (`document: plan`)"
---

# Plan

The plan turns a signed-off spec into the work the Code & Build runs do. The owner (engineer or
tech lead) accepts it (Accept plan) before the issues are filed from it; the developer reads the
issue, never a separate brief. The runs never write `docs/work/`: the post-flow (`sdlc-record`,
`sdlc-test`, `sdlc-release`) records what they produced.

## Before writing

- Start from the signed-off spec of the item; every step of the plan serves its requirements
  (name them: R1, R2…).
- Read the code the plan touches: name the files and modules that change, never line numbers.
- **Never invent facts**: what you do not know is a risk or an assumption, said as such.
- You run unattended: every open decision gets a `**Recommended:**` line with your answer.
- Keep the headings in the same order in the English source and in the pt-BR translation (the
  editor aligns them).

## Required structure

Front matter (`item`, `stage: plan`, `status: draft`, `date`), then exactly these sections:

```
# Plan: <Item title>

## Files that change
**New** and **Changed**: one line per file or module, what it gets.

## Order of work
The steps in order, each small enough for one issue, with the requirements it serves.

## Risks
What can go wrong (migrations, size caps, security, a contract other code reads), each with its
mitigation.

## Proof
How each requirement is shown done: the tests (unit, E2E scenarios), the screenshots, a
simulated run.
```

A `## Progress` section may follow; the post-flow (`sdlc-record`) fills it, never the writer.

## Scoring rubric (0–10 each)

| Criterion | 10 means |
|---|---|
| **Traceability** | every step serves a requirement of the spec, and every requirement has a step |
| **Files** | the files and modules that change are named, new apart from changed |
| **Order** | the steps are in a buildable order, each one an issue's size |
| **Risks** | the real risks found, each with a concrete mitigation |
| **Proof** | every requirement has a check a reviewer can run or look at |
| **Translation** | the pt-BR file has the same sections in the same order |

Final score = simple average of the criteria, one decimal place.

## Done when

The four sections are present in both languages, the front matter is complete, every requirement
of the spec has a step and a proof, and every open decision has its **Recommended:** line.
