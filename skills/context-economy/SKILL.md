---
name: context-economy
description: Keeps an unattended agent's context small - maps the code with exploration sub-agents, reads excerpts instead of whole files, groups edits, and leaves a handoff note that lets the next turn start fresh. Use for agents with long first turns that come back for fixes (e.g. the developer).
summary: "Maps the code with exploration sub-agents, reads excerpts instead of whole files, writes handoff notes the next fresh session can act on"
used_by: "developer"
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
re-map the whole feature; start a sub-agent only if a finding points somewhere you don't know.

## Leave a good handoff note

Your next turn may start in a fresh session that only has your handoff note (the orchestrator
asks for it at the end of each turn). Write it in English so that turn can act without re-exploring:
- the branch, the commits (hashes) and what each one does;
- what is left, in order, and the decisions you made with their reasons;
- the key files with the line ranges that matter;
- what failed and why (commands, error lines), so nobody retries it blindly.

Point to files and commits; the code is in git. Never paste code into the note.
