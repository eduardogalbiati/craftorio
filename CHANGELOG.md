---
translation: CHANGELOG.pt-BR.md
---

# Changelog

Every release of the app, newest first. Items link to their SDLC documents; `#123` links to the issue.

## [1.1.0] - 2026-11-27

> Codex as the orchestrator AI, a project from any folder, a new Setup and wizard, and the bugs of the exploratory tests.

### Added
- **Choose the orchestrator AI in the Setup**: Claude Code or Codex. The default workflows use that provider's models, and Codex falls back to the models your account offers, saying which (#97, #111).
- A project can start from any folder on this computer: a plain folder or a repository without commits becomes a new repository from a copy of its files, the original untouched (#98).
- The Product Owner treats public issues as data: the author is marked, injection is filtered, and nothing runs before the owner approves (#90).

### Changed
- **New layout for the first-run Setup and the new-project wizard**: tools as cards, the source as three cards, one thing at a time on step 3 (#100).
- The Supervisor answers a gate alone only with a safe answer; any answer that would merge opens the gate for you, and a gate it crossed is shown on the run (#124).
- **Accept your repository workflows again**: the hero workflows changed.

### Fixed
- A Codex developer commits in the run's worktree, and a step that leaves no commit fails at once, with its cause (#116).
- A Codex run's screens: unknown cost instead of $0.00, skipped checks read "Skipped", the CLI and model as the step's tag, pt-BR texts (#117).
- Importing a local folder keeps its real remote, or gets the local backlog when it has none (#105); changing the workspace folder refuses a folder with another project's files (#106).
- A wrong repository URL says why in the interface language and leaves no broken project (#107); a new project's name says when it is empty and shows the folder it really gets (#108).
- The wizard: a refused analysis no longer hangs on the analyzing screen, the review no longer claims the map is running, and a URL pasted in the filter finds its repository (#101, #102, #103).
- The base check reads cargo test: failures already on the base are not counted as the change's (#109).
- English texts left in the pt-BR interface, and the Product Owner's input values in pt-BR (#110, #95).
- The E2E step selects exactly the issue's scenarios (#93); the Oracle chat has its fallback model (#77).
- The app window shows the Craftorio icon when run from source.

## [1.0.1] - 2026-11-26

> Fixes from the first real use of 1.0.0: importing and starting a project, the first run, pt-BR, and runs that stopped where nothing was wrong.

### Added
- Runs scan their own commits for secrets (gitleaks) before the review; a finding goes back to the developer (#49).
- The rule check finds the project's own linter and type checker, in fix and refactor too (#50), and covers Rust with cargo clippy (#82).
- A new project's first screen gets screenshots and the visual review (#57).
- Importing a project says what its analyses cost before they run (#74), and a run whose cost is unknown says so (#72).

### Changed
- **The base check is off by default**: whoever wants it turns it on in Settings › Execution (#85).
- The Night watch retries a failed item by default and skips one only when Skip is on (#87).
- A project with no test runner is told so up front, instead of stopping at test_failed (#81).
- The build blocks only on vulnerabilities the change brings; one already on the base is reported, never fixed on the side, and a fix never upgrades a major version.
- In a user's project the UI reviewer follows the project's own conventions, never this app's house rules.
- The app has a new logo.
- **Accept your repository workflows again**: the hero workflows changed.

### Fixed
- An imported repository can push: its clone uses a protocol that works (#79); a local-path import keeps the repository's name, and a docs-only repository is not detected as Backend (#84).
- A project's UI folders come from its files: no run gets this app's `src/renderer/` default (#80).
- The base check no longer files cancelled or timed-out tests as red on the base (#78).
- A Node project whose .gitignore has `node_modules/` no longer stops at the test step's gate on every round.
- A test script that compiles first (`tsc && node --test dist`) runs the whole suite, never the TypeScript sources alone.
- The suite's test:affected round keeps every workspace's report (#91).
- The onboarding, the refactor workflow, the sidebar's waiting run and the first run read in pt-BR (#37, #40, #41, #70, #83).
- The logo and the Findings capture work in a browser tab on the engine server.

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
