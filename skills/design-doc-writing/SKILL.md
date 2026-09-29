---
name: design-doc-writing
description: Writes and scores software design docs - context and scope, goals and non-goals, the design with its trade-offs (architecture, APIs, data, failure modes), alternatives considered, cross-cutting concerns, rollout and open questions, plus the rubric used to score proposals. Use to write, critique or merge a design doc.
---

# Design doc

Structure adapted from the design doc practice described in "Design Docs at Google"
(industrialempathy.com). For a smaller, usage-first sketch before code, use `design-sketch`.

A design doc explains **how** a system or feature will be built and, above all, **why this way**:
it is the place to write down the trade-offs. It is worth writing when the solution is
ambiguous or the change is large; it is not an implementation manual. Reviewers must be able to
spot a wrong direction before the code exists.

## Before writing

- Use only what you were given (the request plus project context, if any). If the working
  directory has code or docs, read enough to describe the current architecture accurately and
  to reuse what exists instead of reinventing it.
- **Never invent facts** (traffic, latency, costs, SLAs). State missing data as an assumption or
  an open question, and design for a stated range.
- **Trade-offs over detail**: for every significant choice, say what it optimizes, what it gives
  up and why that is right for the goals. Skip what any competent engineer would do anyway.
- Show the design at the right altitude: components and their responsibilities, the contracts
  between them, the data and its ownership. Diagrams as text (ASCII or Mermaid) are welcome.
- You run unattended: nobody answers questions now. Every open question gets a **recommended
  default**.
- **Durability**: no file paths, line numbers or code snippets; name components, interfaces and
  contracts instead.

## Required structure

Use exactly these sections, in this order, in Markdown:

```
# Design: <system or feature>

- Status: draft
- Reviewers: <roles>

## 1. Context and scope
The landscape and what is being built, in objective terms: the current system, the problem and
the boundaries of this design. Link the requirements (PRD) when there is one.

## 2. Goals and non-goals
Goals as a bulleted list, measurable when possible. Non-goals: things that could reasonably be
goals but are deliberately left out (not negated goals such as "the system should not crash").

## 3. Overview
The design in one or two paragraphs and a high-level diagram: the main components and how a
request or event flows through them.

## 4. Detailed design
- Components and responsibilities.
- APIs and contracts (operations, inputs/outputs, errors, versioning), in prose or pseudo-code.
- Data model and storage: entities, ownership, consistency, retention, migrations.
- Key flows step by step, including failure modes: timeouts, retries, idempotency, partial
  failure, recovery.
- Every significant choice with its trade-off.

## 5. Alternatives considered
Each credible alternative, what it would optimize, and the trade-off that made us not choose it.

## 6. Cross-cutting concerns
Security (threats, authn/authz, secrets), privacy (personal data, GDPR/LGPD), observability
(logs, metrics, traces, alerts), performance and scalability (with numbers or ranges),
reliability (SLOs, degradation), cost, accessibility. Only what applies.

## 7. Rollout, migration and testing
Phases and feature flags, data migration and backfill, backward compatibility, rollback, and the
testing strategy (the seams where behaviour is verified, load or chaos tests if needed).

## 8. Risks
| Risk | Likelihood | Impact | Mitigation |

## 9. Assumptions and open questions
Assumptions made without confirmation. Then:
Q-1. <question> (owner: <role>). Recommended default: <answer and why>.
```

## Scoring rubric (0–10 each)

| Criterion | 10 means |
|---|---|
| **Context** | objective, accurate context; the scope and boundaries are clear |
| **Goals** | measurable goals and real non-goals that bound the design |
| **Design clarity** | components, contracts, data ownership and key flows are understandable and complete |
| **Trade-offs** | every significant choice states what it optimizes and what it gives up |
| **Alternatives** | credible alternatives with the reason they lost; no straw men |
| **Failure modes** | timeouts, retries, partial failure, recovery and data consistency addressed |
| **Cross-cutting** | security, privacy, observability, performance and cost handled where they apply |
| **Rollout** | phased, reversible, with migration and a testing strategy |
| **Honesty** | nothing invented; assumptions and questions marked, each question with a default |

Final score = simple average of the criteria, one decimal place.

## Done when

All sections are present, every significant choice has its trade-off, at least one real
alternative is discussed, failure modes are covered, and every open question has a default.
