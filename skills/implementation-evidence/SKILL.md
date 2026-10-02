---
name: implementation-evidence
description: Collects evidence that a change works, after its tests passed and it was built - UI screenshots original/modified, HTTP requests with their responses, CLI output, or the log lines of a simulated run - picked by the kind of change, local and simulated only, saved in the run folder and returned as a list tied to each issue. Never changes the working tree and never blocks the run.
uses: [long-commands]
summary: "Evidence by kind of change (screenshots, HTTP request/response, CLI output, logs), local and simulated only, one list per issue"
used_by: "evidence"
---

# Implementation evidence

The tests say the code does what its tests check; evidence shows the change doing what the task
asked, in a form the owner can look at: a screenshot, a request and its response, a command and
its output. You run after the tests passed and the build succeeded, and before the verifier, who
uses what you collect to prove each claim. You run unattended: never ask, record a default.

## 1. Pick the kind of evidence per issue

Start from the developer's **evidence plan** (in your prompt: per issue, the screen, request or
command that shows the change) and `git diff <base>...<branch> --stat`. Read a file only when the
plan leaves out how to reach the screen or run the command. No plan: pick from the task and the
diff stat. For each issue, pick what shows its behaviour best, usually one piece and at most two:

| The change touches | Evidence |
|---|---|
| UI (screens, components, styles) | **screenshot**: the affected screen original (the base) and modified (the branch) |
| An HTTP API (routes, handlers, a server) | **http**: the request (method, path, relevant headers, body) and the response (status, relevant headers, body excerpt), original and modified when the behaviour changed |
| A CLI, script or command | **cli**: the command and the relevant part of its output (and exit code), original and modified |
| An engine, job, workflow or background process | **log**: the lines of a simulated run's log or events that show the new behaviour |
| Nothing observable (refactor, docs, tests only, types) | none: say why in `note` |

Original = the base, modified = the branch, with the **same** command or scenario. When the base
can't show it (a new screen, a new endpoint), capture only "modified" and say so; a screen the
change removes has only "original".

## 2. Budget

Every tool call re-reads your whole context, so exploring is what makes this step expensive.

- **Don't re-discover the change**: no reading source files, tests or docs beyond the plan and the
  diff stat (one targeted `grep` to find a selector or a route is fine).
- **Don't verify**: no unit tests, no test suite, no checking that docs or skills were updated.
  The tests already passed; the verifier checks each claim after you.
- **At most 2 captures per issue** (original + modified), no trial captures (e.g. to `/tmp`) and no
  re-captures to improve framing. A capture that fails once: one corrected retry, then `note`.
  UI changes: plus one "modified" capture per interaction state the plan lists (an edit form, an
  empty or error state opened with `--click`), at most 4 more per issue.
- **Look at each PNG at most once**, only to check it shows the intended screen (images are
  expensive to read).
- **One command per call**, in the worktree (you are already there: no `cd`).

## 3. Rules for every kind

- **Local and simulated only.** Never call external services, never sign in, never start real
  workflow runs or paid model calls, never use real credentials. Servers you need are started
  locally from the worktree (the project's dev/start command, simulation settings on), in the
  foreground or inside one command that stops them; stop what you started before you answer.
  Anything that would need a real account or network: skip it and say so.
- **Read-only on the working tree.** No edits, no commits, no stash, no checkout of another branch.
  For "original", use the command's option for a git ref when it has one; otherwise a temporary
  worktree of the base (`git worktree add --detach <temp> <base>`, removed afterwards).
- **Files go to the run folder**, never to the repository: screenshots in
  this step's round folder (section 4), other evidence in your answer (excerpts, not whole dumps).
- **No secrets in evidence**: redact tokens, cookies, keys and personal data in requests and outputs.
- **Short**: a response body or an output is trimmed to the part that proves the point (with `…`).
- **Time**: the step has a time limit and evidence is optional; when most of it is spent, stop
  and return what you have, with the rest in `note`. Never retry a failing capture in a loop.
- **Never blocks**: a capture that fails is reported (`note`), not fixed. You don't fix code.

## 4. Screenshots (UI)

- Use the project's own screenshot command: a `screenshot` script in `package.json`
  (`npm run screenshot -- <options>`) or the one the project's docs (README, CLAUDE.md, AGENTS.md)
  describe; its `--help` (or the usage at the top of the script) lists screens and options. Never
  write your own browser or
  desktop-app script. No such command: skip screenshots and say so.
- Simulated data only; run captures in the foreground, one at a time; the command must stop by itself.
- Only the screens the change affects, the same scenario original and modified, at most one view
  per issue of the run, plus the interaction states the plan lists (modified only).
- When the ui-conventions skill is loaded, review the UI screenshots against it and return
  `ui_findings` (its section 3); otherwise skip the visual review.
- **Where and how they are named.** Save every PNG in this step's round folder, the
  `evidence_dir` your prompt gives (`<run_dir>/evidence/<step>/round-<n>/`), never flat in the run
  folder: `<issue>-<screen>-<state>.original.png` (the app on the base) and
  `<issue>-<screen>-<state>.modified.png` (the app with the change), e.g.
  `144-roadmap-stage-header.original.png` + `144-roadmap-stage-header.modified.png`; a new screen
  has only `.modified.png`, a removed one only `.original.png`. The two images of a pair share
  the name. The orchestrator indexes the folder in `<run_dir>/evidence/manifest.json` after your
  step (the last round that captured is the final set, the one the gate, the verifier and the PR
  show): no other index to write.
- Return the captions in `screenshots`: `[{ "path": "<file name in your round folder>", "caption":
  "<screen>" }]`, one per image (a pair: its modified image).
- **The developer's shots may already exist.** A workflow with a screenshots step before the
  owner's check (software-development's `developer_screenshots`, #144) captured the states the
  developer listed into `<run_dir>/evidence/developer/round-<n>/` (listed in the manifest). Read
  that folder first: a pair of the latest round taken at the commit you are checking (the manifest's
  `commit`) can be reused (say so in `evidence`, with its path) instead of captured again; capture
  only what is missing, failed there, or changed since.
- This orchestrator's own repository: `npx electron scripts/screenshot.js --view <view> [options]`
  (`--help` for all of them). Views: dashboard, sessions, projects, project, backlog, artifacts,
  workflows, agents, skills, usage, analytics, settings, duo, arena, run-chat, run. Options:
  `--tab`, `--mode`, `--click <css>` (repeatable), `--ref <git ref>` (the original without a
  checkout), `--out`, `--name`, `--side original|modified`, `--caption` (short plain text; records
  the shot with its commit in the manifest), `--wait`. The `run` view shows a simulated run and
  waits 20 s by itself.
- Example (the script names the files by side and records them in the manifest itself):
  1. `npm run screenshot -- --view settings --tab general --ref <base> --out <evidence_dir> --name 12-settings-general --caption "Settings > General"` → `12-settings-general.original.png`
  2. `npm run screenshot -- --view settings --tab general --out <evidence_dir> --name 12-settings-general --caption "Settings > General"` → `12-settings-general.modified.png`

## 5. HTTP, CLI and logs

- **http**: start the server locally, send the request with the project's own client or a plain
  `node -e`/`curl` call against `localhost`, record method, path, status and the body excerpt.
  Same request on the base (original) and on the branch (modified) when the behaviour changed.
- **cli**: run the command exactly as a user would, from the worktree; record the command, exit
  code and the lines that matter.
- **log**: run the project's simulated/mock mode when it has one (this orchestrator:
  `npm run run -- --file <workflow> --mock --auto-approve …`; the run already sets
  `MULTIAGENT_SIMULATION_ONLY=1` in your environment, never prefix it), then
  quote the log or event lines that show the new behaviour.
- This orchestrator's own repository: simulated runs you start land in the run's scratch workspace
  (`MULTIAGENT_WORKSPACE`, already set; its `runs/`), and `npm run screenshot -- --run <dir>` takes
  a run folder from there. Never pass, read or write a path under the owner's workspace `runs/`.
  Copy what you keep (logs, PNGs) to `<run_dir>/logs/` and your round folder (`evidence_dir`): the
  scratch workspace is removed with the run's worktree.

## 6. Answer

One entry per piece of evidence in `evidence`: `issue` (its URL when the run has several),
`kind` (`screenshot` | `http` | `cli` | `log`), `title` (what it shows, one line), `command`
(what you ran), `original` and `modified` (excerpts, or file names for screenshots). `screenshots`
gives the captions of your round's images. `note` says what has no evidence and why.

## Done when

- every issue of the run has evidence, or a one-line reason in `note`;
- nothing in the working tree changed and nothing you started is still running;
- no evidence contains a secret or comes from a real external service.
