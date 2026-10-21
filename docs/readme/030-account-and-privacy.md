## Account and privacy

The app is free and open source. The packaged app asks you to sign in (Google, in the system
browser) once: the account gates nothing, it only tells us how many people use the app. A signed-in
app records its visit at every start and then at most once a day (best effort: a failure is never
shown and never blocks anything; an offline start with a stored session stays signed in).

- **Stored**: your email and name from the sign-in provider, the sign-up date, the last seen date,
  the app version and the OS.
- **Not stored**: your code, prompts, runs, artifacts or usage. Nothing of your work leaves your
  machine through the account.

Running from source, `MULTIAGENT_AUTH=off` skips the sign-in (development, tests, screenshots, the
local preview and `npm run serve`). An app showing a remote engine (Settings › Execution › Engine)
cannot sign that engine's server in yet: the server runs with `MULTIAGENT_AUTH=off`. The account's database is defined in `supabase/migrations/`.
