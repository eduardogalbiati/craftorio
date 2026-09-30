---
name: issue-writing
description: Writes a GitHub/GitLab issue that someone else (a person or an agent) can pick up and finish without asking - a concrete context with evidence, the decisions already taken, and a checklist of verifiable acceptance criteria. Use when filing a bug, an enhancement or a follow-up.
---

# Issue writing

Platform-neutral: the `issue-creator-<platform>` skill says which command searches, creates or
updates the issue. The issue must stand alone: whoever implements it has not seen the
conversation, the run or the review that produced it.

## Before writing

- **Search first.** If an issue already covers the problem, add a comment or update its task
  list instead of opening a duplicate. Link related issues instead of repeating them.
- **One problem per issue.** Split when the parts can ship independently or the task list
  goes past ~8 items; link the pieces to each other.
- **Kind**: `bug` (something that exists behaves wrongly), `enhancement` (new or changed
  behaviour), `documentation`. Use the repository's existing labels only.

## Title

Imperative or outcome-first, under ~80 characters, naming the behaviour that changes, not the
files: "Wait for CI without the LLM, and a cheaper model for ci_pusher",
"Human gates inside the run, not in a full-screen modal". No "Fix bug", no issue-type
prefixes, no trailing period.

## Body

```
<Context: one or two short paragraphs. What happens today, concretely: where (screen, step,
 file, command), what the user or the system sees, and why it matters (cost, time, risk,
 confusion). For a bug: observed vs expected, and how to reproduce.>

<Evidence, when there is any: the real case (run id, PR/issue number, log line, numbers,
 file:line). Mark estimates as estimates ("~8k tokens, to confirm").>

**Decision (<who>): <the decision already taken>**   ← only when one was taken

<Optional: a small table when the issue compares roles, options, states or columns.>

## Tasks

- [ ] **<Short bold lead>**: <one verifiable acceptance criterion: observable behaviour,
      where it applies, edge cases, what must NOT change>.
- [ ] ...
- [ ] **Tests**: <what proves it: unit/integration test, the scenario, what it asserts>.
- [ ] **Docs**: <README/docs sections that change>, when user-facing or architectural.

Related: #<n> (<why>), #<n>.
```

## Writing the tasks (the acceptance criteria)

- Each task is **checkable by someone else**: a behaviour you can see, a command that passes,
  a value you can measure. "Improve performance" is not a task; "the `ci` step makes no model
  call while checks are pending" is.
- Lead with a **bold phrase** naming the capability, then the details after a colon.
- Say **where** it applies (screens, steps, files, platforms: Windows/macOS/Linux, GitHub/GitLab)
  and the **edge cases** (empty state, failure, retry, concurrent use, offline).
- Keep the **invariants** explicit: "never crosses a human gate", "the conversation is not
  deleted", "simulated runs never call a real model".
- Propose the implementation only as far as it was decided; otherwise give it as an example
  ("e.g. a `wait:` block or a built-in step type") and leave the choice open.
- Open questions become tasks with a recommended default ("Decide whether X; default: Y
  because Z"), never questions to a person.
- Include a **measure** task when the issue claims a gain (tokens, time, cost): before/after on
  one real case.
- Order tasks by dependency; the last ones are tests, docs and measurement.

## Rules

- Write in the repository's language for issues (English here).
- Concrete over general: names, numbers, paths, ids. No filler, no marketing tone.
- No secrets, tokens, personal data or internal URLs that are not already in the repository.
- Don't blame people or agents; describe what happened and why.
- Unattended agents record assumptions instead of asking; say which ones in the context.

## Done when

The issue has a specific title, a context someone new can understand, the decisions already
taken, a task list where every item is verifiable (including tests), and links to related
issues — and no duplicate of it exists.
