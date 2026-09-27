---
name: prd-writing
description: Writes and scores PRDs (Product Requirements Documents) - required structure with user stories, traceable requirements, testing decisions and open questions with recommended defaults, plus the rubric used to score proposals. Use to write, critique or merge a PRD.
---

# PRD (Product Requirements Document)

A PRD answers **what** and **why**, not the detailed technical how. Product, design and
engineering must be able to make decisions from it without asking the author, and engineering
must be able to slice it into independently shippable pieces.

## Before writing

- Use only what you were given (the request plus project context, if any). If the working
  directory has code or docs, read enough not to contradict what already exists.
- **Never invent facts** (current metrics, user counts, contracts). When you need data you do
  not have, write it as an assumption in "Assumptions" or as a question in "Open questions".
- Be specific: "cut from 5 to 2 clicks" beats "improve usability".
- You run unattended: nobody answers questions now. Every open question gets a **recommended
  default** that downstream agents will use unless a human overrides it.
- **Durability**: no file paths, line numbers or code snippets; they go stale. Name modules,
  interfaces and contracts instead.

## Required structure

Use exactly these sections, in this order, in Markdown:

```
# <Initiative name>

## 1. Summary
3–5 lines: the problem, for whom, the proposed solution and the expected outcome.

## 2. Problem and context
Current pain, evidence (or assumptions marked as such), why now.

## 3. Goals and success metrics
| Goal | Metric | Baseline | Target | Deadline |
Include at least one guardrail metric (what must not get worse).

## 4. Non-goals
What is explicitly not done in this version.

## 5. Personas and user stories
2–4 personas at most. Then a numbered list:
US-1. As a <persona>, I want <capability>, so that <benefit>.

## 6. Functional requirements
| ID | Requirement | Stories | Priority (Must/Should/Could) | Acceptance criterion |
Every requirement traces to at least one US-n. Acceptance criteria are testable
(Given/When/Then when it helps).

## 7. Non-functional requirements
Performance, availability, security/privacy (GDPR/LGPD), accessibility, observability,
compatibility. Only the ones that apply, with numbers.

## 8. User experience
Main flow step by step, empty/error states, decision points.

## 9. Implementation and testing decisions
- Modules/interfaces/contracts that change (no file paths).
- One-way-door decisions (hard to reverse, surprising, a real trade-off): one line each with the reason.
- Testing: the public seams where behaviour will be verified and what a good test looks like here.

## 10. Dependencies and risks
| Risk | Likelihood | Impact | Mitigation |
Dependencies on other teams, systems or vendors.

## 11. Delivery plan
Vertical slices (each cuts through every layer and is demoable alone): MVP first, then
increments, with what enters each one and the criterion to move on.

## 12. Assumptions
Everything assumed without confirmation.

## 13. Open questions
Q-1. <question> (owner: <role>). Recommended default: <answer and why>.
```

## Scoring rubric (0–10 each)

| Criterion | 10 means |
|---|---|
| **Problem clarity** | problem, audience and "why now" are unambiguous; anyone can explain it in one sentence |
| **Metrics** | measurable goals with baseline/target and a guardrail metric |
| **Scope** | explicit non-goals; a lean MVP consistent with the problem |
| **Testable requirements** | every requirement has a verifiable acceptance criterion, a priority and a story |
| **Coverage** | edge cases, error states, relevant NFRs (security, privacy, accessibility) |
| **Risks and dependencies** | real risks identified with concrete mitigation |
| **Honesty** | nothing invented; assumptions and questions marked, each question with a default |
| **Sliceability** | the delivery plan is made of vertical, independently demoable slices |
| **Durability** | no paths, line numbers or details that will go stale |

Final score = simple average of the criteria, one decimal place.

## Done when

All 13 sections are present, every requirement traces to a story and has an acceptance
criterion, and every open question has a recommended default.
