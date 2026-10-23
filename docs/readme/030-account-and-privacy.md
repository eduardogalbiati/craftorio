## Account and privacy

The app is free and open source. The packaged app asks you to sign in (Google, in the system
browser) once: the account gates nothing, it only tells us how many people use the app. A signed-in
app records its visit at every start and then at most once a day (best effort: a failure is never
shown and never blocks anything; an offline start with a stored session stays signed in).

- **Stored**: your email and name from the sign-in provider, the sign-up date, the last seen date,
  the app version and the OS.
- **Not stored**: your code, prompts, runs, artifacts or usage. Nothing of your work leaves your
  machine through the account.
- **Retention and deletion**: the account row is kept until you ask for it to be deleted. Open an
  issue or write to the maintainer from the account's email, and the row (and its sign-in identity)
  is deleted; nothing else about you is kept.
- **Forks**: the Supabase URL and publishable key are built into `src/auth-config.js`, so a fork that
  ships its own build must use its own Supabase project (replace both constants and apply
  `supabase/migrations/`), or it reports its users to this project.

**What a repository controls**: a project you clone or a PR branch you run can ship `CLAUDE.md` /
`AGENTS.md` and a `.claude/` folder. Agents read the instructions files (they can try to steer an
agent, which still has only its workflow's tools), but isolated agents never load the checkout's
`.claude/settings*.json` (hooks, permission rules), and the app never marks `repos/`, `worktrees/` or
your project folders as trusted for the CLIs. Agents, the project's tests and the terminals get an
allowlisted environment: cloud keys, API keys and the SSH agent stay out; GitHub/GitLab tokens reach
only agents allowed to run `gh`/`glab`. A workflow lists any other variable its tests need in
`env: { passthrough: [...] }`.

Running from source, `MULTIAGENT_AUTH=off` skips the sign-in (development, tests, screenshots, the
local preview and `npm run serve`). An app showing a remote engine (Settings › Execution › Engine)
cannot sign that engine's server in yet: the server runs with `MULTIAGENT_AUTH=off`. The account's database is defined in `supabase/migrations/`.
