---
name: testing-principles
description: Language-agnostic rules for writing unit tests that verify behaviour through public seams, avoid tautological and implementation-coupled tests, and mock only at system boundaries. Loaded by every unit-test-writer-<language> skill.
---

# Testing principles

The language skill tells you the framework and commands. These rules decide what a good test is.

## Seams first

A **seam** is a public boundary where behaviour can be observed without reaching inside:
an exported function, a class's public methods, an HTTP endpoint, a CLI command.

Before writing tests, list the seams you will test at the top of your answer:
- prefer seams that already exist, at the highest level that still gives a fast, deterministic test;
- fewer is better, often one per change;
- never test private functions directly. If the only way to test something is to reach inside,
  report it as a testability finding instead of exposing internals.

## A good test

- Describes **what** the unit does, in the test name ("rejects an expired token"), not how.
- Goes through the seam only; survives a refactor that keeps behaviour.
- Checks one logical behaviour; asserts on outputs and observable state, not on call counts or
  call order of your own collaborators.
- Covers the happy path, edges (empty, null/zero value, limits, unicode, time zones) and
  expected errors.

## Anti-patterns (reject them in your own tests)

- **Tautological test**: the expected value is computed with the same logic as the production
  code, so it passes by construction. Expected values come from literals, worked examples or
  the spec (`expect(total).toBe(15)`, not `expect(total).toBe(price * qty)`).
- **Implementation-coupled test**: mocks internal modules, inspects private state, or asserts
  which helper was called. It breaks on refactor and proves nothing about behaviour.
- **Horizontal slicing**: writing tests for imagined future behaviour. Test what the change does now.

## Mocking

- Mock only at system boundaries: network/external APIs, time, randomness, and sometimes the
  filesystem or database (prefer a temp dir or a test database).
- Never mock the module under test or code the project owns.
- If code builds its own clients internally (`new StripeClient()` inside a function), prefer
  injecting the dependency; if you cannot change production code, report it as a finding.

## Bug fixes: red before green

A regression test must fail against the unfixed code. Show it failing (run it before the fix,
or on the base commit) or explain why that is not possible. A test that never failed is not
evidence of a fix.

## Nobody can answer questions

You run unattended. When something is ambiguous (which seam, which expected value), choose the
option most consistent with the existing tests and code, and list it under **Assumptions** in
your answer.

## Visual changes: screenshots

A change to the UI is checked by looking at it. When the diff touches the UI (the language skill
lists the usual paths; the project's docs may name others), capture the affected screens **before**
(the base) and **after** (the branch):

- Use the project's own screenshot command (the language skill says where to look). Never write your
  own browser or desktop-app script to take them. No such command: skip the capture and say so.
- Simulated data only: never sign in, start real runs or call paid services to fill a screen.
- Run the captures in the foreground, one at a time; the command must stop by itself.
- Pick only the screens the change affects (usually one to three), the same scenario before and after.
- Save the PNGs and a `screenshots.json` in the folder the orchestrator gives you (the run's
  `screenshots/` folder, not the repository): `[{ "path": "<after>.png", "caption": "<screen>",
  "before": "<before>.png" }]` (`before` omitted for a new screen; some screenshot commands write
  it for you). Return the same list in your answer. The files are not test files: never commit them.
- Not a visual change (no UI path in the diff): say so in one line and skip.

## Done when

- every seam you listed has at least one test for the behaviour that changed;
- a UI change has before/after screenshots, or the reason there are none;
- the full suite was run with the project's command and the result (pass/fail counts) is reported;
- every failure is reported as test name, error, and probable cause (production bug vs outdated test).
