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
- **A repository can bring its own workflows.** `.multiagent/project.yaml` names the workflows a
  project is worked on with; opening the clone in the app shows them (#485).
- **Answers come back where the question was.** A gate answered on the phone is recorded with
  `via: "mobile"` and the device; notifications and toasts carry the gate's headline; the Night watch
  writes a morning summary.

## Gaps

- **Nothing starts from the platform.** A new issue label, an `@orchestrator` comment on a pull
  request or a failed CI run on `main` does not start anything: the owner or the roadmap does. The
  Night watch and the Backlog refresh *poll* the platform on their own schedule, which covers the
  night, not the day. An inbound trigger (a webhook endpoint on the engine server, or a short
  polling loop over `gh api` events mapped to workflows by a rule in `project.yaml`) would make the
  app meet the team where it works. Tracked as #568 under the epic #565.
- **No chat or e-mail channel.** Gates and reports are in the app and on the phone only.

## References

- [12-Factor Agents, factor 11](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-11-trigger-from-anywhere.md)
- `docs/agents/engine/chaining.md`, `docs/agents/engine/repository-workflows.md`
- `docs/agents/storage.md`: phone gates, the Night watch's state
