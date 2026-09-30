---
name: test-plan-writing
description: Writes and scores test plans - scope and test items, risk-based approach, test levels and types, traceability from requirements to test conditions, entry/exit and suspension criteria, environment and data, roles, schedule, risks and reporting, plus the rubric used to score proposals. Use to write, critique or merge a test plan.
summary: "Test plan (after ISO/IEC/IEEE 29119-3): risk-based approach, traceability to requirements, entry/exit criteria, environment and data, rubric"
used_by: "arena (`document_skill`)"
---

# Test plan

Structure adapted from the test plan contents of ISO/IEC/IEEE 29119-3 (which superseded
IEEE 829), kept lean for product teams. See also the `testing-principles` skill.

A test plan says **what** will be tested, **how deeply** and **why that depth**: it turns the
product risks into a testing approach, and defines when testing can start, stop and be called
done. A reader must be able to run the effort from it and a manager must be able to judge the
residual risk of shipping.

## Before writing

- Use only what you were given (the request plus project context, if any). If the working
  directory has code, docs or existing tests, read enough to know what exists: the test levels
  already automated, the CI, the environments.
- **Never invent facts** (coverage numbers, defect rates, environments, team size). State
  missing data as an assumption or an open question.
- **Risk first**: the depth of testing follows the product risk (likelihood × impact), not the
  number of features. Say what is deliberately tested lightly or not at all, and why.
- Test conditions must be **verifiable**: an expected result, not "check that it works".
- You run unattended: nobody answers questions now. Every open question gets a **recommended
  default**.
- **Durability**: no file paths or line numbers; name features, components and interfaces.

## Required structure

Use exactly these sections, in this order, in Markdown:

```
# Test plan: <product or release>

## 1. Introduction
Purpose, the product/release under test, references (PRD, design docs), audience.

## 2. Scope
Test items (features, components, interfaces) in scope, and what is explicitly out of scope
with the reason.

## 3. Product risks
| ID | Risk | Likelihood | Impact | Test response (level, type, depth) |
Security, data loss, money, compliance and accessibility risks are considered explicitly.

## 4. Approach
Test levels (unit, integration, contract, end-to-end, exploratory, acceptance) and types
(functional, performance, security, accessibility, compatibility, recovery) that apply, what
each covers, what is automated vs manual, and the techniques (boundary values, state
transitions, pairwise, risk-based exploratory charters).

## 5. Test conditions and traceability
| ID | Requirement / story | Test condition | Level | Priority | Expected result |
Every in-scope requirement traces to at least one condition; high risks have negative and edge cases.

## 6. Entry, exit and suspension criteria
Entry (what must be ready to start), exit (when testing is done: measurable, e.g. all Must
conditions pass, no open critical defect, performance targets met), suspension and resumption.

## 7. Test environment and data
Environments, configurations, devices/browsers, external dependencies (real, stubbed or
simulated), test data sources, and how personal data is protected (anonymization, synthetic data).

## 8. Roles and responsibilities
Who designs, automates, executes, triages defects and signs off (roles, not names).

## 9. Schedule and milestones
Test activities aligned with the delivery plan, in phases; dependencies that can block them.

## 10. Project risks and contingencies
| Risk to the testing effort | Mitigation / contingency |
Environment availability, late builds, flaky tests, missing skills.

## 11. Defect management and reporting
Severity/priority definitions, triage flow, the metrics reported (progress, pass rate, open
defects by severity, residual risk) and how often.

## 12. Assumptions and open questions
Assumptions made without confirmation. Then:
Q-1. <question> (owner: <role>). Recommended default: <answer and why>.
```

## Scoring rubric (0–10 each)

| Criterion | 10 means |
|---|---|
| **Scope** | test items and exclusions are explicit, each exclusion with a reason |
| **Risk basis** | real product risks drive the depth of testing; the highest risks get the most |
| **Approach fit** | levels and types match the system and the risks; automation choices justified |
| **Traceability** | every in-scope requirement maps to verifiable conditions with expected results |
| **Edge and negative cases** | failure paths, boundaries and non-functional risks are covered |
| **Criteria** | measurable entry, exit and suspension criteria |
| **Environment and data** | realistic environments and data, with dependencies and privacy handled |
| **Operability** | roles, schedule, defect flow and reporting let someone run it tomorrow |
| **Honesty** | nothing invented; assumptions and questions marked, each question with a default |

Final score = simple average of the criteria, one decimal place.

## Done when

All sections are present, every high risk has a test response, every in-scope requirement
traces to a condition with an expected result, and the exit criteria are measurable.
