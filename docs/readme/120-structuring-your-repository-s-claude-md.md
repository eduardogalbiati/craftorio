## Structuring your repository's AGENTS.md (CLAUDE.md) for unattended agents

Every workflow agent that works in a repository starts with its instructions and pays for all of them
on every request. Codex loads `AGENTS.md` by itself. An isolated Claude agent gets them from the app:
the root's `CLAUDE.md` with the files it imports (`@path`, inside the repository only), or
`AGENTS.md` when there is no `CLAUDE.md`; a subfolder's own `AGENTS.md` / `CLAUDE.md` is not loaded for
it. The run log names the files each Claude session started with. Keep one file, `AGENTS.md`, and make
`CLAUDE.md` the single line `@AGENTS.md` (Claude Code's file import), so every CLI reads the same
instructions. Keep it a short index (a few KB) and move the details to topic docs the agents read only
when their task needs them:

- `AGENTS.md`: what the project is, the hard rules (what must never happen), the commands, and one
  line per topic doc saying **when** to read it (e.g. "before changing the database schema").
- `docs/agents/<topic>.md`: the code map, architecture notes, gotchas, testing, deployment...
  Each section of the old file lands in exactly one doc; the user docs (README) are not duplicated.
- A test that fails when `AGENTS.md` grows past its limit, points to a missing doc, or `CLAUDE.md`
  stops being the import keeps it honest.

This repository does it itself: its `CLAUDE.md` went from 25 KB to 4 KB (now `AGENTS.md`), and a
Claude agent's first request from 22.0k to 15.7k tokens (with isolation; 41.1k before both changes;
measured when Claude Code still loaded the file by itself).
