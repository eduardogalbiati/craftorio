---
name: context-economy
description: Keeps an unattended agent's context small - does code research through exploration sub-agents (the first map, wide searches, long outputs, unmapped findings), reads excerpts instead of whole files, groups edits, and leaves a handoff note that lets the next turn start fresh. Use for agents with long turns that come back for fixes (e.g. the developer, the test writer).
summary: "Does code research through exploration sub-agents, reads excerpts instead of whole files, writes handoff notes the next fresh session can act on"
used_by: "developer, test_writer"
# "## Test writer: ..." reaches only the test_writer agent's prompt, "## Developer: ..." only the
# developer's (#300, #347)
role_sections: [developer, test_writer]
---

# Context economy

Every request of your turn re-sends the whole conversation. A turn that reads twenty whole files
early on pays for them again on every later request, and a follow-up turn in the same session
pays for all of it before doing anything. Your first turn can't be split safely, so keep it lean.

## Map with one sub-agent before the first edit

- On a non-trivial task (more than about three files to find or change), **start one exploration
  sub-agent before your first edit** (the `Task`/`Agent` tool, e.g. the `Explore` type when it is
  offered) and let it do the searching and reading. Give it the task and ask for a short map back:
  - each file that matters, with the functions and **line numbers** to change or reuse;
  - how the pieces connect (who calls what, where the data comes from);
  - the existing tests that cover them and the conventions to follow.
  Only its summary enters your context: the files it read do not.
- Several independent questions: one sub-agent with all of them, or a few started together, not
  one after another.
- Then read in your own context **only the files you will edit**, at the lines the map points to.
- A small task (one or two known files): search (`Grep`, `Glob`, `git grep`) and read what the
  search points to; no sub-agent needed.

## Sub-agents are the default for code research

Not only for the first map: whenever the answer is a summary of many files or of a long output,
ask a sub-agent for the summary instead of bringing the material into your own context.
- **A wide search**: a question whose answer spans more than about three files you will not edit
  (who calls this, where is this configured, which tests cover that).
- **A long output**: a failing suite, a build or CI log, a long diff. Have the sub-agent read it
  (from the log file you wrote it to) and return only the failures with their file and line.
- **An unmapped finding**: a review, verifier or test finding that points to code you have not
  mapped yet.
- Several independent questions go to sub-agents **started together**, in one message.
- A small question about one or two known files stays a plain `Grep`/`Read`.

Never through a sub-agent: sub-agents are read-only exploration (e.g. the `Explore` type).
**Edits**, the **test runs or builds whose result decides your step**, commits, and anything that
crosses a gate stay in your own turn. A sub-agent may read a log of a run you made; it never
replaces running it. When your CLI offers no sub-agent tool (Codex, Grok), do the same research
yourself with focused searches and excerpts.

A sub-agent maps; it never reviews your branch's diff. When your workflow has a review step, the
reviewer is the next step, in its own fresh session: never start an "independent review" of your
own diff in your turn and keep working "meanwhile" (#303).

## Test writer: map the behaviours before writing tests

Before writing tests, start one exploration sub-agent with the developer's `test_notes` and the
diff of the branch, and ask it for, with file and line numbers:
- each changed behaviour and the production lines that implement it;
- the existing tests that cover it (file, test name), and the ones the change makes obsolete;
- the test helpers, fixtures and conventions the suite uses (where they live, how a test of this
  kind is set up).

Then read in your own context only the test files you edit and the production lines under test.
When the suite fails, have a sub-agent read its log and return the failing tests with their
errors; rerun the suite yourself to decide.

## Developer: reuse before you add

Before you add a function, a constant or a mapping table, search the repository for an existing
helper, constant or mapping that already does it (#347): by its name and synonyms, by the literal
values it would map (`'claude-code'`, a status name, a stage id), and by the rule it computes (a
cost correction, a "current stage"). Ask the first exploration sub-agent for it with the map.
- Found one: call it. When it is private, export it or move it to a shared module next to the
  data it reads; never write a second table or a second copy of the rule.
- Found none: add yours where the next developer will look for it (next to the related code).
- When unsure whether two rules are the same, record the assumption in the decision log; never ask.
- In your handoff note (and `summary`), name what you reused and where it lives, or say you
  searched and found nothing to reuse.

## Read excerpts, not files

- Read the lines you need (a function, a block around a match), not the whole file. Read a whole
  file only when it is small or you are about to rewrite most of it.
- Don't re-read a file you already read in this turn unless it changed.
- Keep command output short: filter it (`git log --oneline -20`, `git diff --stat`, a test
  runner's summary or its failures only) instead of dumping everything.

## Group your edits

- Each tool call re-sends the conversation: make several changes to one file in **one** edit
  (one larger `Edit` covering the block, or a `Write` of a small file you rewrite), not one `Edit`
  per line.
- Plan the change of a file before editing it, so you edit it once or twice, not ten times.

## Fix turns: read only what the findings name

When you come back after a review, a failed test or a failed build, work from the findings: read
only the files and lines they name (plus your handoff note), fix them, and stop. Don't re-read or
re-map the whole feature; start a sub-agent when a finding points somewhere you have not mapped,
or to read a long failure output.

## Leave a good handoff note

Your next turn may start in a fresh session that only has your handoff note (the orchestrator
asks for it at the end of each turn). Write it in English so that turn can act without re-exploring:
- the branch, the commits (hashes) and what each one does;
- what is left, in order, and the decisions you made with their reasons;
- the key files with the line ranges that matter;
- what failed and why (commands, error lines), so nobody retries it blindly.

Point to files and commits; the code is in git. Never paste code into the note.
