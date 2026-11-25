---
translation: CHANGELOG.pt-BR.md
---

# Changelog

Every release of the app, newest first. Items link to their SDLC documents; `#123` links to the issue.

## [1.0.0] - 2026-11-25

> The first release under the name Craftorio. Versions start again; the releases below are of the Multiagent Orchestrator, the same app.

### Added
- **Craftorio**: the new name of the app, its packages and its variables. What an older install left (workspace, settings, account) is still found.
- **Install from one prompt**: an AI session installs the app and the workspace, from [INSTALL.md](INSTALL.md) (#44).
- **The Oracle in the workspace**: a Claude Code or Codex session opened in the workspace folder manages the app, through its control channel (#32, #42, #43).
- A project with no remote gets a local backlog (#25, #35).
- A release run chooses its product, the app or the engine (#46).
- First project onboarding, written as AI-native SDLC documents ([first-project-onboarding](docs/work/first-project-onboarding/)).

### Changed
- The app and the engine are released apart, from one repository with Turborepo and Changesets.
- The agents run on the current models: Fable 5.2, Sonnet 5.5 and Haiku 5.5 (#56).
- A run that opens a pull request waits in a PR monitor instead of an Approve step.
- The first start after the rename uses this computer's engine, even when the old install was a client of a remote one; its address and token stay saved, and Settings › Execution › Engine switches back (#64).
- **Accept your repository workflows again**: a changed copy must be accepted on the Workflows screen.
- The onboarding, the first issue and the roadmap speak pt-BR (#23, #28, #36).

### Fixed
- Run agents on Claude load the repository's CLAUDE.md / AGENTS.md again (#45).
- A missing dependency in a first run stops once at a gate instead of sending the developer back (#30).
- A simulated run shows no spend (#31).
- The Product Owner drawer does not carry another project's unsent text (#26); Start opens on the project's default workflow (#27).
- Backlog Refresh works on a project created from a local folder: it finds the GitHub or GitLab repository behind the folder, and stops before any model call when there is none (#63, #65).
- The guard for a server left in the foreground stops the right one on Windows and Linux, by its start time, never the one the agent started in the background (#66).

## [1.4.0] - 2026-10-26

> Release candidates before every stable, and the app split into an engine package and modular fronts.

### Added
- Releases as release candidates and stable: one rc per push, and a person promotes the stable.
- The engine discovers channels and areas from the installed fronts (#591).

### Changed
- npm workspaces: `packages/engine`, `packages/shared` and `packages/ui-kit`; the screens move to the build, plan, analyser and ai fronts (#563, #580–#596).
- Electron 45, three 0.186 and Playwright 1.64.

### Fixed
- Simulations use Chromium's mock keychain: no macOS keychain dialog in the smoke test, screenshots or E2E (#584).

## [1.3.0] - 2026-10-23

> The app speaks your language, learns how your project works, and can run on another computer.

### Added
- Interface language: every screen translated, and agents write in the chosen language (#330).
- Ways of working: an analysis seed reads the repository and composes the workflows (#487).
- Repository workflows: `.multiagent/project.yaml`, accepted per commit (#485).
- Remote engine: the desktop app as a window onto an engine on another computer (#420).
- A live terminal on deterministic steps: follow a suite, E2E or screenshots step as it runs (#465).
- The roadmap bar shows what the planned roadmap costs and how long it takes, per release (#421).

### Fixed
- The roadmap no longer refetches the whole backlog on every run event (#491).
- A repository copy of a workflow no longer shadows the owner's edited copy (#554).

### Security
- Open-source readiness checklist and security review (#484).

## [1.1.2] - 2026-10-13

### Changed
- Type checking with `checkJs` and JSDoc types, file by file, with a ratchet (#346).
- Simulation as injected machine adapters instead of mock branches in the engine (#353).

## [1.1.1] - 2026-10-13

### Added
- Contract tests over HTTP against any engine URL, and a version handshake (#339).
- The session tail and control client as Rust binaries: the packaged app needs no Node (#342).

## [1.1.0] - 2026-10-12

> Watch a workflow run as a 3D floor.

### Added
- Run 3D view: a workflow run as a floor of steps and agents, live and in replay, dark or light.
- A review step writes the release summary shown at the Ship gate (#290).

## [orchestrator-1.0.0] - 2026-10-05

> The first stable release.

### Added
- Multi-agent workflows in YAML, run by Claude Code, Codex CLI and Grok Build as headless agents.
- A deterministic engine, with an AI supervisor called when a step fails.
- Human approval gates that no automation crosses.
- The roadmap with cut lines, and the release workflow with a human-only Ship gate (#260).
- Windows, macOS and Linux builds.
