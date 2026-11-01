---
name: spec-writing
description: Writes and scores the spec of a work item (docs/work/<item>/spec.md and its pt-BR translation) - numbered testable requirements, the design, the areas of concern and the open questions with a recommended answer, plus the rubric the reviewer scores it with. Use in the write-doc workflow for the spec stage, once the intent is accepted.
summary: "Spec structure (requirements R1…, design, areas of concern, open questions) and scoring rubric"
used_by: "write-doc (`document: spec`)"
---

# Spec

The spec turns an accepted intent into requirements the tests can check and a design the tech
lead signs. The owner signs it off (Sign off spec) before the epic and its phase issues are
created.

## Before writing

- Start from the accepted intent of the item; every requirement serves its outcome.
- Read the code and the docs the design touches; name modules and contracts, not line numbers.
- **Never invent facts**: what you do not know is an assumption or an open question.
- You run unattended: every open decision gets a `**Recommended:**` line with your answer.
- Keep the headings and the **R1.** / **D1.** labels in the same order in the English source and
  in the pt-BR translation (the editor aligns them).

## Required structure

Front matter (`item`, `stage: spec`, `status: draft`, `date`), then exactly these sections:

```
# <Item title>

## Requirements
**R1. <one testable requirement>** Its acceptance criterion.
**R2. …** numbered in order, without gaps.

## Design
How the requirements are met: modules, contracts, data, screens; one-way-door decisions with
their reason.

## Areas of concern
Risks, migrations, security and privacy, what a reviewer must look at, each with its mitigation.

## Open questions
**D1. <question>**
**Recommended:** <answer and why>.
```

## Scoring rubric (0–10 each)

| Criterion | 10 means |
|---|---|
| **Traceability** | every requirement serves the intent's outcome |
| **Testable requirements** | each R<n> has a verifiable criterion, numbered in order |
| **Design** | it meets every requirement, names the contracts, records the hard-to-reverse choices |
| **Concerns** | the real risks found, each with a concrete mitigation |
| **Questions** | every open decision labelled, each with a recommended answer |
| **Translation** | the pt-BR file has the same sections and labels in the same order |

Final score = simple average of the criteria, one decimal place.

## Done when

The four sections are present in both languages, the requirements are numbered R1, R2… without
gaps, the front matter is complete and every open question has its **Recommended:** line.
