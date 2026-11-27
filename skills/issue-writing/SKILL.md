---
name: issue-writing
description: Writes a GitHub/GitLab issue that someone else (a person or an agent) can pick up and finish without asking - a concrete context with evidence, the decisions already taken, and a checklist of verifiable acceptance criteria. Use when filing a bug, an enhancement or a follow-up.
summary: "Issue structure: concrete context with evidence, decisions taken, a checklist of verifiable acceptance criteria, related issues"
used_by: "via `uses`; Write & Review (`document_skill`); issue (issue_writer); the Product Owner (Register an issue)"
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

## Expected files

- `<repository-relative path>`: <why it changes>
- `<path of a file to create>` (new): <what it holds>

## Tasks

- [ ] **<Short bold lead>**: <one verifiable acceptance criterion: observable behaviour,
      where it applies, edge cases, what must NOT change>.
- [ ] ...
- [ ] **Tests**: <what proves it: unit/integration test, the scenario, what it asserts>.
- [ ] **Docs**: <README/docs sections that change>, when user-facing or architectural.
      With a product-wide decision line: "record the decision in `docs/agents/decisions.md`".

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
- A **product-wide "Decision (owner)" line** (a rule for the whole product, not one screen's
  layout) gets a Docs task "record the decision in `docs/agents/decisions.md`" (date, decision,
  why, issue; newest first), so the run that implements the issue adds the entry, or replaces the
  one it changes. Use the repository's own decisions log when it keeps one elsewhere; skip the
  task when it keeps none.

## UI acceptance criteria (any issue that touches a screen)

What a screen does is not enough: a view can reorder, move and edit everything it should and still
be hard to use. For each screen, dialog or component the issue adds or changes, add tasks that say
**how** it looks and is used:

- **What leads**: the screen's one message (what a person gets from it in five seconds), the
  primary information of each element (an issue's title, not a file name), what is secondary, and
  how long text is cut (ellipsis, full text on hover).
- **The hierarchy, not only the content**: listing the sections to show is not enough. Say the
  text budget (a card: a one-line title and at most two lines before "more"), which numbers are
  shown as bars, scores or chips, and what sits behind "more" or an ⓘ (caveats, commands, raw
  lists only experts need).
- **Which controls**: a select or segmented toggle for a fixed list, a checkbox or switch for a
  flag, a badge for a state, text only for free values; where each edit happens (inline, an Edit
  form with Save/Cancel, a toggle saved at once).
- **The states**: empty, edit, error, running/loading, and read-only (what can't be edited, when).
- **The shared components to reuse** (the project's badges, form fields, rows, switches, buttons),
  named, instead of new markup.
- **The screenshots that prove it**: the default view and each state opened by a click, with demo
  data that has the new fields.

Example: #110 (Roadmap items: issue titles first, badges, the mode editable in one click, an Edit
form with proper controls and Save/Cancel).

## Rules

- Write in the issues language the Language line names (Settings › Language; the interface language when unset).
  An addition to an existing issue is in that language too; never rewrite existing text only to
  translate it. `- [ ]`, `#n`, closing keywords (`Closes #n`) and label names never change.
- Concrete over general: names, numbers, paths, ids. No filler, no marketing tone.
- `## Expected files` lists only the files the change is expected to modify or create, one
  repository-relative path per line in backticks, a file to create marked `(new)`; files read as
  evidence or context stay in the context. It is an estimate: the project city's impact preview
  reads it first and measures it against the run's diff (#429). Omit it when no file can be named.
- No secrets, tokens, personal data or internal URLs that are not already in the repository.
- Don't blame people or agents; describe what happened and why.
- Unattended agents record assumptions instead of asking; say which ones in the context.

## Done when

The issue has a specific title, a context someone new can understand, the decisions already
taken, a task list where every item is verifiable (including tests), UI acceptance criteria when
it touches a screen, and links to related issues — and no duplicate of it exists.
