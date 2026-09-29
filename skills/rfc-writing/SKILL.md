---
name: rfc-writing
description: Writes and scores engineering RFCs (Request for Comments) - a proposal to change a system, API or process put up for review, with motivation, a guide-level and a reference-level explanation, drawbacks, alternatives, prior art, rollout and unresolved questions, plus the rubric used to score proposals. Use to write, critique or merge an RFC.
---

# RFC (Request for Comments)

Structure adapted from the Rust RFC template (github.com/rust-lang/rfcs) and common engineering
RFC practice (proposals circulated for review before a significant change).

An RFC **proposes** a significant change (a new API, a cross-team process, a protocol, a
platform change) and invites review before anything is built. It must convince a skeptical
reviewer: it explains the problem, shows the change from the user's point of view first, then
specifies it precisely enough to implement, and argues honestly against itself.

## Before writing

- Use only what you were given (the request plus project context, if any). If the working
  directory has code or docs, read enough to describe the current behaviour accurately.
- **Never invent facts** (usage numbers, incidents, benchmarks). State missing data as an
  assumption or an unresolved question.
- Write for the reviewer who has to say yes or no: lead with the problem and the user-visible
  change, not with internals.
- Examples beat descriptions: show how the change is used (a request/response, a config, a
  workflow), in prose or pseudo-code, never as file paths or real code snippets that go stale.
- You run unattended: nobody answers questions now. Every unresolved question gets a
  **recommended default**.

## Required structure

Use exactly these sections, in this order, in Markdown:

```
# RFC: <title>

- Status: draft
- Area: <system, API or process affected>
- Reviewers: <roles whose approval is needed>

## 1. Summary
One paragraph: what changes and why, understandable without reading further.

## 2. Motivation
The problem, who has it, the use cases it enables and the expected outcome. Evidence, or
assumptions marked as such. Why now.

## 3. Guide-level explanation
The proposal as its users will learn it: new concepts, how to use it, examples, how existing
users migrate, how error messages and docs change.

## 4. Reference-level explanation
The precise specification: interfaces and contracts, behaviour, data model changes,
interactions with existing features, edge cases and failure modes. Detailed enough to implement.

## 5. Drawbacks
Why we might NOT do this: cost, complexity, migration burden, risks.

## 6. Rationale and alternatives
Why this design is the best in the space of possible designs; the alternatives considered and
why they were not chosen; the impact of doing nothing.

## 7. Prior art
How other systems, teams or products solved it, what worked and what did not (only what you
know or found; cite sources).

## 8. Compatibility, security and operations
Backward compatibility and versioning, security and privacy impact, observability,
performance, cost. Only what applies, with numbers when known.

## 9. Rollout plan
Phases (flag, pilot, general availability), migration and deprecation steps, rollback, and the
criterion to move from one phase to the next.

## 10. Unresolved questions
Q-1. <question> (to settle: before acceptance / during implementation). Recommended default: <answer and why>.

## 11. Future possibilities
Natural extensions, explicitly out of scope for this RFC.
```

## Scoring rubric (0–10 each)

| Criterion | 10 means |
|---|---|
| **Motivation** | a real, evidenced problem with concrete use cases; "why now" is clear |
| **Clarity for users** | the guide-level section lets a user understand and adopt it from examples |
| **Precision** | the reference-level section is implementable: contracts, edge cases, failure modes |
| **Self-criticism** | drawbacks are real and the cost of the change is not hidden |
| **Alternatives** | credible alternatives, including doing nothing, with the reason they lost |
| **Compatibility and risk** | migration, compatibility, security and operations addressed |
| **Rollout** | phased, reversible, with criteria to advance and a rollback path |
| **Honesty** | nothing invented; assumptions marked, every unresolved question with a default |
| **Scope** | one coherent proposal; extensions parked in future possibilities |

Final score = simple average of the criteria, one decimal place.

## Done when

All sections are present, the guide-level section has at least one example, the drawbacks and
alternatives are real, the rollout can be reversed, and every unresolved question has a default.
