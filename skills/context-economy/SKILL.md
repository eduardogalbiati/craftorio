---
name: context-economy
description: Keeps an unattended agent's context small - maps the code with exploration sub-agents, reads excerpts instead of whole files, and leaves a handoff note that lets the next turn start fresh. Use for agents with long first turns that come back for fixes (e.g. the developer).
---

# Context economy

Every request of your turn re-sends the whole conversation. A turn that reads twenty whole files
early on pays for them again on every later request, and a follow-up turn in the same session
pays for all of it before doing anything. Your first turn can't be split safely, so keep it lean.

## Map before you read

- **Explore with a sub-agent** when you need to find where something lives or how a feature is
  wired (more than two or three searches). Ask it for a short map: files, functions and line
  ranges, and how they connect. Only its summary comes back into your context.
- Search first (`Grep`, `Glob`, `git grep`), then read what the search points to.

## Read excerpts, not files

- Read the lines you need (a function, a block around a match), not the whole file. Read a whole
  file only when it is small or you are about to rewrite most of it.
- Don't re-read a file you already read in this turn unless it changed.
- Keep command output short: filter it (`git log --oneline -20`, `git diff --stat`, a test
  runner's summary or its failures only) instead of dumping everything.

## Leave a good handoff note

Your next turn may start in a fresh session that only has your handoff note (the orchestrator
asks for it at the end of each turn). Write it so that turn can act without re-exploring:
- the branch, the commits (hashes) and what each one does;
- what is left, in order, and the decisions you made with their reasons;
- the key files with the line ranges that matter;
- what failed and why (commands, error lines), so nobody retries it blindly.

Point to files and commits; the code is in git. Never paste code into the note.
