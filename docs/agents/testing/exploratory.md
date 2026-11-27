# Exploratory tests

The exploratory battery run before each release push: the whole onboarding (Settings and creating a project) with every variant, then the first runs on projects with planted defects.

## Purpose and when

The exploratory tests use Craftorio as a person would: open the app for the first time, set it up, create or import a project, and run workflows on projects with planted defects. They find what the automated tests miss: screens that get stuck, gates that make no sense, English texts in pt-BR, unexpected costs.

Run them before each release push, on the local main with everything merged, and after a large change to the onboarding. A session of its own follows this page and returns the report below. Every variant has a code (C1, O2, A3…) so the report names exactly what passed or failed.

## Safety rules

- **The test app only.** Never open, close or change the owner's own app, the engine server in WSL (port 7300), the owner's workspace or `HKCU\Software\Craftorio`. The test app has its own workspace and data folder (`CRAFTORIO_WORKSPACE`, `CRAFTORIO_USER_DATA`).
- **Ask before closing a window** the battery did not open itself.
- **Fake secrets only.** The secret-scan test uses a made-up token (e.g. `ghp_` plus random letters).
- **Nothing leaves the computer.** No push, no issue, no comment without the owner's yes. PR mode uses a local bare copy.
- **Installs:** the ▶ Install buttons are checked up to their confirmation, never run: they install system-wide.
- **Gates:** the battery answers the test app's gates as a tester would; never the owner's real app's.
- **Processes:** stop the test app by its PID after checking its command line, never by name.

## Isolated environment

1. **Windows:** a clean clone of the version under test (e.g. `%USERPROFILE%\craftorio-xt-win`), `npm install`, the app opened with `npm start` and new `CRAFTORIO_WORKSPACE` and `CRAFTORIO_USER_DATA` folders; when a release has packages, the extracted `.zip` too.
2. **WSL (Linux):** a worktree of the local main (`~/craftorio-xt`), the app on a virtual display (Xvfb) with a remote-debugging port, with its own workspace and data folder.
3. **A real first start:** the data folder starts empty, so the app opens the Setup as for a new user.
4. **Test projects:** created from scratch in new folders (below).

The helper scripts (start the test app, create the test repositories, drive the app through the debugging port, wait for a run's gate or end, summarise a run, stop the app) still live outside the repository; moving them to `scripts/exploratory/` is a follow-up. Keep the test folders until the owner has read the report.

## Onboarding part 1: Settings

### The Setup (first start)

| Code | Variant | Check |
|---|---|---|
| C1 | "Connect your AIs" with Claude Code and Codex ready | cards with logos and "ready"; Next enabled |
| C2 | One AI ready (e.g. Claude only) | Next enabled; the other shown as optional |
| C3 | No AI ready | Next locked; "Continue with simulation only" goes on and the app opens in simulation |
| C4 | An AI installed but not signed in | ▶ Sign in; after signing in, "Check again" updates the card |
| C5 | ▶ Install on a missing CLI | the confirmation shows the command, its button in the action colour (not red); not run |
| C6 | "Version control" with Git, Gitleaks, GitHub CLI and GitLab CLI | Git required (orange); the others optional with their reason |
| C7 | Git missing (stubbed on the page) | Next locked, with the reason |
| C8 | Gitleaks missing | goes on; runs show "secrets not scanned" |
| C9 | Interface language pt-BR and English | both steps with no text in the other language |
| C10 | Back, and reopen from Settings › Agents & CLIs › Set up again | back where it was, choices kept |

### The Settings screen

For each option: change it, see its effect, restart the app, check it was saved.

| Code | Tab and option | Check |
|---|---|---|
| C11 | General › Language (interface, AI agents, issues) | the interface changes at once; agents and issues use it in a run |
| C12 | General › Workspace folder › Change… | takes an empty folder; refuses one holding another app's files; the app opens on the new one |
| C13 | Agents & CLIs › Check again, limits per model | an invalid factor or cost limit is refused with its message; a valid one applies to the next run |
| C14 | Execution › Engine (this computer / remote) | switch to a remote engine and back; the badge changes |
| C15 | Execution › Concurrent runs, test workers | automatic from the machine; a manual value wins; "simulations count toward the limits" |
| C16 | Execution › Base check | **off by default** (#85); on with a red base: "issue only" and "issue + fix item" |
| C17 | Execution › Daily and night budget | a low budget stops a run at the cap |
| C18 | Execution › Notifications, keep awake, confirm before stop, open the run on start | each has a visible effect |
| C19 | Execution › Allow outside sessions to control this app | on: the control channel answers; off: refused |
| C20 | Night watch | defaults retry on, skip off (#87); limits ×1.5, ×2, ×3; permissions saved |
| C21 | Phone gates | serve the page, pair (QR), revoke; needs the owner's phone: manual |
| C22 | About | shows the version under test |

## Onboarding part 2: creating a project

The wizard has 4 steps: **Start** (the source), **the project** (depends on the source), **Analysis and workflows**, **Review**.

### Step 1: the sources

| Code | Source | Check |
|---|---|---|
| O1 | Create a new project | leads to the new-project questions |
| O2 | Import a repository (GitHub) | "Your repositories" with tabs and filter, then the URL field |
| O3 | Local repository (a folder) | the system folder picker |
| O4 | "Import from any git URL" link | takes GitLab, another host and a local path |

### Step 2: the project

| Code | Variant | Check |
|---|---|---|
| N1 | New: default answers (full-stack, no CI) | the name first; the tiles picked |
| N2 | New: each kind (frontend, backend, full-stack, docs) | the kind reaches the review and the workflows |
| N3 | New: with release CI | the release workflow appears |
| N4 | New: empty, repeated or invalid name | refused with the reason, nothing stuck |
| G1 | Import from "Your repositories" | the filter finds it; the name comes from the repository (#84) |
| G2 | Import by pasting the URL | the URL does not filter the list; it clones |
| G3 | No access, or a URL that does not exist | a clear error in the interface language |
| G4 | A repository already in the workspace | says so instead of cloning again |
| L1 | Folder with git and a GitHub remote | keeps its name; push works (#79) |
| L2 | Folder with git, no remote | local backlog (#25, #38) |
| L3 | Folder without git | what the app does today (#98) |
| L4 | Docs-only folder | not detected as Backend (#84) |
| U1 | GitLab URL | clones; the right provider tab |
| U2 | Another host or a file path | clones; no provider tab lit |

### Step 3: Analysis and workflows

Since #100, on an imported project Continue stays locked until the workflows are set and never starts the analysis; only the "Analyze with AI" card analyses.

| Code | Variant | Check |
|---|---|---|
| A1 | Imported: "Analyze with AI" | the cost before; the progress; then the suggested workflows |
| A2 | Imported: "Set manually" | the workflows with no cost; analysing later stays possible |
| A3 | Imported: Continue before choosing | locked |
| A4 | An analysis that fails | the failed state; Continue locked; retry works |
| A5 | Reopen an analysed project, click "Analyze with AI" | nothing charged again; straight to the workflows |
| A6 | The repository's default workflow awaiting acceptance | the notice on the Default row; accept it there (#40) |
| A7 | New project | the workflows at once, no two cards |
| A8 | Work model | only "Light"; Standard and Full "Coming soon" |
| A9 | Change each row's workflow with its tiles | the choice reaches the review |

### Step 4: Review

| Code | Variant | Check |
|---|---|---|
| R1 | Kind detected | its tile picked; changing it works |
| R2 | Kind not known yet (analysis skipped) | "Detect from the files" (#57) |
| R3 | An idea written | saved, and shown as done in the next steps |
| R4 | Backlog with open issues, empty, failed | each with its text |
| R5 | "Finish and open the city" | the city opens; the project page shows the next steps (#744) |

### Whole paths (Start to the city)

Each path goes through every step and ends in a first run (next section); together they cover every variant above at least once.

| Path | Source | Step 2 | Step 3 | Review | First run |
|---|---|---|---|---|---|
| P1 | O1 new | N1 full-stack | A7, A8 | R3, R5 | feature |
| P2 | O1 new | N2 docs, N3, N4 | A7 | R1 | none |
| P3 | O2 GitHub | G1 list | A1 analyse (real, once) | R1, R4 | fix |
| P4 | O2 GitHub | G2 URL, G3, G4 | A2 manual, A3, A9 | R2 | feature in PR mode |
| P5 | O3 folder | L1 with remote | A2, A6 | R1 | feature |
| P6 | O3 folder | L2 no remote | A1 simulated, A4, A5 | R4 | fix |
| P7 | O3 folder | L3 no git, L4 docs | A2 | R2 | none |
| P8 | O4 URL | U1 GitLab, U2 path | A2 | R1 | refactor |

## After the onboarding: runs and flows

| Code | Variant | Project | Check |
|---|---|---|---|
| F1 | feature, local mode | lista-tarefas (new) | reaches the local merge; push only with a remote |
| F2 | feature, PR mode | a bare copy | opens the PR on the local copy; the PR monitor follows it |
| F3 | fix with a failing test | rust-calc | clippy runs (#82); cargo test records its counts |
| F4 | fix with a type error | ts-calc | the project's typecheck runs (#50); the suite picks the right tests when the test script compiles first |
| F5 | refactor with lint | eslint-js | the project's lint runs; no dependency upgrade |
| F6 | Node project with `node_modules/` in .gitignore | eslint-js or ts-calc | no loop at the test step's gate (the cache link is ignored) |
| F7 | Project with no test runner | html-site | said up front, no stop at test_failed (#81) |
| F8 | Screenshots | html-site, edugalbs | captures and the visual review (#57, #58) |
| F9 | UI reviewer on a user's project | lista-tarefas | follows the project's own conventions, asks for no unrequested Undo |
| F10 | A vulnerability already on the base | edugalbs (Next 13) | does not block the build; no unrequested major upgrade |
| F11 | A fake secret in the task | ts-calc | the agent does not commit it; if it does, gitleaks catches it (#49) |
| F12 | Base check on, red base | rust-calc | the issue (and the fix item) as set in C16 (#78) |
| F13 | Roadmap by the Product Owner | an imported project | the plan, the roadmap items, the stage starting; pt-BR texts (#95) |
| F14 | Night watch on a failing stage | any project | retries by default, never skips unless Skip is on (#87) |
| F15 | The Oracle from the workspace folder | the test workspace | a session in the folder reads AGENTS.md, lists the projects, starts a simulated run through the control channel |
| F16 | Install through an AI | a computer without Craftorio (simulated) | the landing page's prompt following INSTALL.md up to the hand-over to the Oracle |

## Test projects

| Project | What it is | Planted defect | Used in |
|---|---|---|---|
| eslint-js | JavaScript with ESLint 9 and node tests | 4 lint errors and a long function | F5, F6 |
| ts-calc | TypeScript compiled by tsc | a type error; the test runs the compiled copy | F4, F6, F11 |
| rust-calc | Rust with cargo test | a wrong conversion, 2 failing tests | F3, F12 |
| html-site | a static HTML site, no tests | none (captures, no test runner) | F7, F8 |
| lista-tarefas | created by the wizard (new project) | none | P1, F1, F9 |
| craftorio-teste-rc | the owner's test repository on GitHub | none | P3, P4 |
| edugalbs | the owner's site (Next.js 13), as a local copy | old Next.js advisories | F8, F10 |

## Cost and models

- **Free, in simulation:** all of part 1 and most of part 2; the simulated analysis (A1 in P6) costs nothing.
- **Real models:** one real analysis (A1 in P3) and the runs of "After the onboarding".
- **Estimate:** the battery of 2026-11-26 (9 runs) cost about US$ 12; this whole guide about US$ 15 to 25.
- **Cap:** the session stops and tells the owner past US$ 30.
- **Models:** the app's defaults; a run whose cost is unknown is noted.

## Report

In Brazilian Portuguese:

1. **A table per variant:** code, result (passed, failed, blocked, not tested), evidence (screenshot path or run id) and cost.
2. **The bugs found:** what happened, how to reproduce, the evidence, and whether it **blocks the release**.
3. **What passed that failed before**, against the previous battery.
4. **What was not tested and why** (e.g. phone gates without the phone).
5. **The total cost** and time.

No issue is opened and nothing is fixed during the battery: the owner decides what becomes an issue and what blocks the push.
