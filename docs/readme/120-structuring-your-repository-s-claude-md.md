## Structuring your repository's CLAUDE.md for unattended agents

Claude Code loads a repository's `CLAUDE.md` (Codex: `AGENTS.md`) into every session that works
in it, on every request: each workflow agent pays for all of it, on every turn. Keep it a short
index (a few KB) and move the details to topic docs the agents read only when their task needs them:

- `CLAUDE.md`: what the project is, the hard rules (what must never happen), the commands, and one
  line per topic doc saying **when** to read it (e.g. "before changing the database schema").
- `docs/agents/<topic>.md`: the code map, architecture notes, gotchas, testing, deployment...
  Each section of the old file lands in exactly one doc; the user docs (README) are not duplicated.
- A test that fails when `CLAUDE.md` grows past its limit or points to a missing doc keeps it honest.

This repository does it itself: `CLAUDE.md` went from 25 KB to 4 KB, and a Claude agent's first
request from 22.0k to 15.7k tokens (with isolation; 41.1k before both changes).
