# Factor 11: Trigger from anywhere, meet users where they are

## The factor

An agent should start from any channel a user or a system already uses (a chat message, an e-mail,
a webhook, a cron) and report back the same way. Agents that only live in one UI are used only when
someone remembers to open it. ([factor 11](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-11-trigger-from-anywhere.md))

## In this project

- **Several front doors, one service.** The Electron app; the CLI (`npm run run -- --file ... --input
  ...`); the engine server with the UI in a browser (`npm run serve`), reachable from another
  machine; a paired phone for gates (`phone-gates/`, #226); the roadmap and the Night watch, which
  start and sequence runs while the owner is away (`src/domains/night/`, `src/domains/roadmap/`); the
  Oracle, which starts runs from a conversation. All of them call the same channels
  (`src/service/channels/`, the manifest in `src/service/manifest.js`).
- **Runs trigger runs.** A finished run hands its declared `outputs:` to the next one with `then:`
  (chaining, #134); a `type: workflow` step starts a child run and waits for it.
- **A repository can bring its own workflows.** `.craftorio/project.yaml` names the workflows a
  project is worked on with; opening the clone in the app shows them (#485).
- **Platform events start runs** (#568). A `triggers:` rule in `.craftorio/project.yaml` ("an issue
  labelled `ready` starts `feature`", "an `@orchestrator` comment on a pull request starts `fix`", "a
  failed CI on `main` starts `fix`") is polled with `gh api` / `glab api` every 2 minutes once the owner
  turns the project on in Settings; each new event starts one run, which comments back on the issue or
  pull request with its id. Budgets, occupancy, the merge queue and the human gates hold: a trigger
  starts work, never ships it (`packages/engine/domains/triggers/`, `docs/agents/engine/repository-workflows.md`).
- **Answers come back where the question was.** A gate answered on the phone is recorded with
  `via: "mobile"` and the device; notifications and toasts carry the gate's headline; the Night watch
  writes a morning summary.

## Gaps

- **Polling, not push.** Platform triggers poll (a delay of up to the interval, API calls on each
  pass); a webhook receiver on the engine server (`POST /hooks/triggers/<project>?key=`) would feed
  the same rules, but needs a reachable address and is not built (`docs/agents/decisions.md`).
- **No chat or e-mail channel.** Gates and reports are in the app and on the phone only.

## References

- [12-Factor Agents, factor 11](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-11-trigger-from-anywhere.md)
- `docs/agents/engine/chaining.md`, `docs/agents/engine/repository-workflows.md`
- `docs/agents/storage.md`: phone gates, the Night watch's state
