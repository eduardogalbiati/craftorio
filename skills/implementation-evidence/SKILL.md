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

Start from the developer's **evidence plan** (in your prompt: per issue, the screen, request or
command that shows the change) and `git diff <base>...<branch> --stat`. Read a file only when the
plan leaves out how to reach the screen or run the command. No plan: pick from the task and the
diff stat. For each issue, pick what shows its behaviour best, usually one piece and at most two:

| The change touches | Evidence |
|---|---|
| UI (screens, components, styles) | **screenshot**: the affected screen before (base) and after (branch) |
| An HTTP API (routes, handlers, a server) | **http**: the request (method, path, relevant headers, body) and the response (status, relevant headers, body excerpt), before and after when the behaviour changed |
| A CLI, script or command | **cli**: the command and the relevant part of its output (and exit code), before and after |
| An engine, job, workflow or background process | **log**: the lines of a simulated run's log or events that show the new behaviour |
| Nothing observable (refactor, docs, tests only, types) | none: say why in `note` |

Before = the base, after = the branch, with the **same** command or scenario. When the base can't
show it (a new screen, a new endpoint), capture only "after" and say so.

## 2. Budget

Every tool call re-reads your whole context, so exploring is what makes this step expensive.

- **Don't re-discover the change**: no reading source files, tests or docs beyond the plan and the
  diff stat (one targeted `grep` to find a selector or a route is fine).
- **Don't verify**: no unit tests, no test suite, no checking that docs or skills were updated.
  The tests already passed; the verifier checks each claim after you.
- **At most 2 captures per issue** (before + after), no trial captures (e.g. to `/tmp`) and no
  re-captures to improve framing. A capture that fails once: one corrected retry, then `note`.
  UI changes: plus one "after" capture per interaction state the plan lists (an edit form, an
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
  For "before", use the command's option for a git ref when it has one; otherwise a temporary
  worktree of the base (`git worktree add --detach <temp> <base>`, removed afterwards).
- **Files go to the run folder**, never to the repository: screenshots in
  `<run_dir>/screenshots/`, other evidence in your answer (excerpts, not whole dumps).
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
- Only the screens the change affects, the same scenario before and after, at most one view per
  issue of the run, plus the interaction states the plan lists (after only).
- When the ui-conventions skill is loaded, review the UI screenshots against it and return
  `ui_findings` (its section 3); otherwise skip the visual review.
- Save the PNGs and a `screenshots.json` in `<run_dir>/screenshots/`:
  `[{ "path": "<after>.png", "caption": "<screen>", "before": "<before>.png" }]` (`before` omitted
  for a new screen; some commands write the manifest themselves). Return the same list in
  `screenshots`: a PR/MR workflow publishes it on the PR/MR.
- This orchestrator's own repository: `npx electron scripts/screenshot.js --view <view> [options]`
  (`--help` for all of them). Views: dashboard, sessions, projects, project, backlog, artifacts,
  workflows, agents, skills, usage, analytics, settings, duo, arena, run-chat, run. Options:
  `--tab`, `--mode`, `--click <css>` (repeatable), `--ref <git ref>` ("before" without a
  checkout), `--out`, `--name`, `--caption` (short plain text), `--before`, `--wait`. The `run` view
  shows a simulated run and waits 20 s by itself.
- Example (the script writes `screenshots.json` itself):
  1. `npm run screenshot -- --view settings --tab general --ref <base> --out <run_dir>/screenshots --name settings-before`
  2. `npm run screenshot -- --view settings --tab general --out <run_dir>/screenshots --name settings-after --caption "Settings > General" --before settings-before.png`

## 5. HTTP, CLI and logs

- **http**: start the server locally, send the request with the project's own client or a plain
  `node -e`/`curl` call against `localhost`, record method, path, status and the body excerpt.
  Same request on the base and on the branch when the behaviour changed.
- **cli**: run the command exactly as a user would, from the worktree; record the command, exit
  code and the lines that matter.
- **log**: run the project's simulated/mock mode when it has one (this orchestrator:
  `npm run run -- --file <workflow> --mock --auto-approve …`; the run already sets
  `MULTIAGENT_SIMULATION_ONLY=1` in your environment, never prefix it), then
  quote the log or event lines that show the new behaviour.

## 6. Answer

One entry per piece of evidence in `evidence`: `issue` (its URL when the run has several),
`kind` (`screenshot` | `http` | `cli` | `log`), `title` (what it shows, one line), `command`
(what you ran), `before` and `after` (excerpts, or file names for screenshots). `screenshots`
repeats the screenshot manifest. `note` says what has no evidence and why.

## Done when

- every issue of the run has evidence, or a one-line reason in `note`;
- nothing in the working tree changed and nothing you started is still running;
- no evidence contains a secret or comes from a real external service.
