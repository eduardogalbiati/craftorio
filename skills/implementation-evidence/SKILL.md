---
name: implementation-evidence
description: Collects evidence that a change works, after its tests passed and it was built - UI screenshots before/after, HTTP requests with their responses, CLI output, or the log lines of a simulated run - picked by the kind of change, local and simulated only, saved in the run folder and returned as a list tied to each issue. Never changes the working tree and never blocks the run.
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

Read the task (each issue of the run) and the diff against the base
(`git diff <base>...<branch> --stat`, then the files). For each issue, pick what shows its
behaviour best, usually one piece and at most three:

| The change touches | Evidence |
|---|---|
| UI (screens, components, styles) | **screenshot**: the affected screen before (base) and after (branch) |
| An HTTP API (routes, handlers, a server) | **http**: the request (method, path, relevant headers, body) and the response (status, relevant headers, body excerpt), before and after when the behaviour changed |
| A CLI, script or command | **cli**: the command and the relevant part of its output (and exit code), before and after |
| An engine, job, workflow or background process | **log**: the lines of a simulated run's log or events that show the new behaviour |
| Nothing observable (refactor, docs, tests only, types) | none: say why in `note` |

Before = the base, after = the branch, with the **same** command or scenario. When the base can't
show it (a new screen, a new endpoint), capture only "after" and say so.

## 2. Rules for every kind

- **Local and simulated only.** Never call external services, never sign in, never start real
  workflow runs or paid model calls, never use real credentials. Servers you need are started
  locally from the worktree (the project's dev/start command, simulation settings on), in the
  foreground or inside one command that stops them; stop what you started before you answer.
  Anything that would need a real account or network: skip it and say so.
- **Read-only on the working tree.** No edits, no commits, no stash, no checkout of another branch.
  For "before", use the command's option for a git ref when it has one; otherwise a temporary
  worktree of the base (`git worktree add --detach <temp> <base>`, removed afterwards).
- **Files go to the run folder**, never to the repository: screenshots in
  `<run_dir>/screenshots/`, other evidence in your answer (excerpts, not whole dumps).
- **No secrets in evidence**: redact tokens, cookies, keys and personal data in requests and outputs.
- **Short**: a response body or an output is trimmed to the part that proves the point (with `…`).
- **Time**: the step has a time limit and evidence is optional; when most of it is spent, stop
  and return what you have, with the rest in `note`. Never retry a failing capture in a loop.
- **Never blocks**: a capture that fails is reported (`note`), not fixed. You don't fix code.

## 3. Screenshots (UI)

- Use the project's own screenshot command: a `screenshot` script in `package.json`
  (`npm run screenshot -- <options>`) or the one the project's docs (README, CLAUDE.md, AGENTS.md)
  describe; read its usage line for screens and options. Never write your own browser or
  desktop-app script. No such command: skip screenshots and say so.
- Simulated data only; run captures in the foreground, one at a time; the command must stop by itself.
- Only the screens the change affects, the same scenario before and after, at most one view per
  issue of the run.
- Save the PNGs and a `screenshots.json` in `<run_dir>/screenshots/`:
  `[{ "path": "<after>.png", "caption": "<screen>", "before": "<before>.png" }]` (`before` omitted
  for a new screen; some commands write the manifest themselves). Return the same list in
  `screenshots`: a PR/MR workflow publishes it on the PR/MR.
- Example (this orchestrator's own repository; the script writes `screenshots.json` itself):
  1. `npm run screenshot -- --view settings --tab general --ref <base> --out <run_dir>/screenshots --name settings-before`
  2. `npm run screenshot -- --view settings --tab general --out <run_dir>/screenshots --name settings-after --caption "Settings > General" --before settings-before.png`

## 4. HTTP, CLI and logs

- **http**: start the server locally, send the request with the project's own client or a plain
  `node -e`/`curl` call against `localhost`, record method, path, status and the body excerpt.
  Same request on the base and on the branch when the behaviour changed.
- **cli**: run the command exactly as a user would, from the worktree; record the command, exit
  code and the lines that matter.
- **log**: run the project's simulated/mock mode when it has one (this orchestrator:
  `npm run run -- --file <workflow> --mock --auto-approve …` with `MULTIAGENT_SIMULATION_ONLY=1`), then
  quote the log or event lines that show the new behaviour.

## 5. Answer

One entry per piece of evidence in `evidence`: `issue` (its URL when the run has several),
`kind` (`screenshot` | `http` | `cli` | `log`), `title` (what it shows, one line), `command`
(what you ran), `before` and `after` (excerpts, or file names for screenshots). `screenshots`
repeats the screenshot manifest. `note` says what has no evidence and why.

## Done when

- every issue of the run has evidence, or a one-line reason in `note`;
- nothing in the working tree changed and nothing you started is still running;
- no evidence contains a secret or comes from a real external service.
