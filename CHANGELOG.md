---
translation: CHANGELOG.pt-BR.md
---

# Changelog

Every release of the app, newest first. Items link to their SDLC documents; `#123` links to the issue.

## [Unreleased]

> On main, waiting for the next release.

### Added
- A new app icon: a hub conducting five agents (#624).
- First project onboarding, written as AI-native SDLC documents ([first-project-onboarding](docs/work/first-project-onboarding/), #635).

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

## [1.0.0] - 2026-10-05

> The first stable release.

### Added
- Multi-agent workflows in YAML, run by Claude Code, Codex CLI and Grok Build as headless agents.
- A deterministic engine, with an AI supervisor called when a step fails.
- Human approval gates that no automation crosses.
- The roadmap with cut lines, and the release workflow with a human-only Ship gate (#260).
- Windows, macOS and Linux builds.
