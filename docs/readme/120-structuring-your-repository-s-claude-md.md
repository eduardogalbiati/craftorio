## Structuring your repository's AGENTS.md (CLAUDE.md) for unattended agents

Codex loads a repository's `AGENTS.md` and Claude Code its `CLAUDE.md` into every session that
works in it, on every request: each workflow agent pays for all of it, on every turn. Keep one file,
`AGENTS.md`, and make `CLAUDE.md` the single line `@AGENTS.md` (Claude Code's file import), so every
CLI reads the same instructions. Keep it a short index (a few KB) and move the details to topic docs
the agents read only when their task needs them:

- `AGENTS.md`: what the project is, the hard rules (what must never happen), the commands, and one
  line per topic doc saying **when** to read it (e.g. "before changing the database schema").
- `docs/agents/<topic>.md`: the code map, architecture notes, gotchas, testing, deployment...
  Each section of the old file lands in exactly one doc; the user docs (README) are not duplicated.
- A test that fails when `AGENTS.md` grows past its limit, points to a missing doc, or `CLAUDE.md`
  stops being the import keeps it honest.

This repository does it itself: its `CLAUDE.md` went from 25 KB to 4 KB (now `AGENTS.md`), and a
Claude agent's first request from 22.0k to 15.7k tokens (with isolation; 41.1k before both changes).
