---
order: 160
---

<!-- section:workflows -->
Sessions: the developer, the CI pusher and the PR babysitter come back many times for small
turns (a fix, a CI check), so they run in `handoff` sessions: every turn is a fresh session that
starts from the agent's latest handoff note, instead of carrying 200k+ tokens of history. The
other agents keep one conversation (`persistent`) up to `max_context: 150k`. Each agent may only
use what its `capabilities` declare (e.g. the CI pusher: read, `git`, `gh`, `glab`; no edits, no web).
