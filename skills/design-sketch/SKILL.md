---
name: design-sketch
description: Writes and scores a usage-first design sketch before code - how callers will use it, the types, signatures and modules, trade-offs, rejected alternatives and a design red-flag screen. Use as the document for an AI Arena on architecture decisions, or before implementing a non-trivial feature.
---

# Design sketch

Adapted from the architect skill (rationale template and design red flags) in cursor/plugins
pstack (MIT). A sketch decides the **shape** of a change before anyone writes it: interfaces,
not implementations. You run unattended: open questions get a recommended default.

## Before writing

- Read the code around the change: existing modules, naming, error handling, the seams tests use.
- Start from the callers: write how the new thing is **used** before how it is built.
- Prefer deep modules: a small interface that hides a lot of behaviour.
- Signatures and types are welcome here (they are the design); function bodies are not.

## Required structure

```
# <Design name>

## 1. Problem
What must become possible, for whom, and the constraints (performance, compatibility, deadlines).

## 2. Usage
Two or three short snippets of calling code, in the project's language, for the main cases
and one error case. This is the contract.

## 3. Shape
- Modules and their responsibilities (one line each), and which existing ones change.
- Public types and function signatures.
- Data flow for the main case (a numbered list or a small sequence diagram).
- Errors: what can fail, how callers see it.

## 4. Trade-offs
What this shape makes easy, what it makes hard, and what it costs (complexity, performance, migration).

## 5. Alternatives considered
At least one structurally different shape, and why it lost.

## 6. Red-flag screen
For each, "clear" or the issue and how the shape avoids it:
- shallow module (interface as complex as its implementation);
- information leakage (the same design decision encoded in several modules);
- temporal decomposition (modules split by execution order instead of by knowledge);
- pass-through methods/variables (layers that only forward);
- special-casing in general code (flags and ifs for one caller).

## 7. Testing
The public seams where behaviour will be tested, and what a good test looks like.

## 8. Migration and rollout
One-way doors (data, public APIs), feature flags, order of changes (expand → migrate → contract).

## 9. Open questions
Q-1. <question>. Recommended default: <answer and why>.
```

## Scoring rubric (0–10 each)

| Criterion | 10 means |
|---|---|
| **Usage clarity** | the usage snippets alone explain the design; the common case is trivial for callers |
| **Depth** | small interfaces hiding substantial behaviour; no pass-through layers |
| **Fit** | consistent with the existing code's structure, naming and conventions |
| **Trade-off honesty** | costs and the rejected alternatives are stated, not hidden |
| **Red flags** | the screen is done seriously and the shape avoids the flags |
| **Testability** | clear seams; behaviour testable without mocking internals |
| **Evolvability** | likely next changes fit without reshaping the interface |
| **Rollout safety** | one-way doors identified with a safe order of changes |

Final score = simple average, one decimal place.

## Done when

All 9 sections are present, the usage snippets compile in principle against the stated
signatures, at least one alternative is given, and every open question has a default.
