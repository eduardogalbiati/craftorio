---
order: 150
---

<!-- section:engine -->
### The Oracle

The Oracle is a built-in agent (Agents lists it; model and effort editable, default
`claude-opus-5-5`, high) with **one persistent conversation for the whole app**: it plays Product
Owner, supervisor, reliability engineer and operator's assistant in the same context. Its panel is
docked on **Home** (its Overview tab); on every other screen the **Oracle** button at the top right of the
header opens the same conversation as a drawer that knows the screen you are on (Esc closes it).
The button's badge counts the answers that arrived while the conversation was out of view.

- **What it reads**, read-only: the runs (events, summaries, sessions, decisions, handoff notes,
  costs), the roadmaps, the Backlog caches and queues, local merges not pushed, the workflows and
  skills (and whether a newer default exists), your projects' repositories (git log/diff/show,
  files) and the app's own code when its repository is a project. Run ids, `#<number>` issues and
  run files in an answer open in the app; other paths copy on click. Paste a screenshot into the
  input (PNG, JPEG, GIF or WebP, up to 5 MB each and 4 per message): it is saved in
  `<workspace>/oracle/attachments/` and the Oracle looks at it.
- **Memory**: your standing decisions ("reply in Portuguese", "validated mode for UI changes"),
  edited only by you from the drawer's **Memory** button and read at every session start.
  **New session** starts over from a handoff note; the conversation and the memory are kept. Past
  the context threshold, or after an idle gap longer than the model's cache (55 min), the next
  turn starts a fresh session from the skill, the memory and a state note the app keeps
  (`oracle/state.md`), with no extra model call; the drawer's header shows the model and whether
  the last turn resumed or started fresh.
- **Cost**: each answer shows its time, model, cost and tokens (the turn's own cost: Claude reports
  a resumed session's total, the app keeps the difference); the footer shows today's spend
  against the **daily budget** (Settings › Execution, default 20 USD, 0 = no cap). Once reached,
  the Oracle is paused until the next day (UTC); a refused question stays in the chat. Its spend
  counts in the monthly budgets like the runs. `node scripts/oracle-usage-report.js --dir
  <workspace>/oracle` prints the spend per day. Developer mode and automated checks answer from the
  simulated Oracle: no model call, no cost.
- **Woken by run events**: a gate waiting, a merge conflict, a limit, a stall or a supervisor
  decision, repeated invalid outputs. A run that finished, was cancelled or interrupted (or seen in
  another app process) and a supervisor retry or resume are notices written by the app, with no
  model call. Events are batched over 30 seconds, each batch is one short turn (3 min at most); a
  question sent meanwhile waits for it; routine events never wake it. Settings › Execution › Oracle chooses which runs (every run,
  watched runs only, off) and which events; **Mute** on a wake-up silences one run. Ask it to
  "watch this run" (or a project's roadmap): it follows that run until it ends.
- **Asks the other agents**: the Product Owner (a backlog analysis, a roadmap proposal, an issue
  draft), the supervisor (a run diagnosis, a recommendation for a gate it never answers) and a free
  analyzer (a run's tool calls and costs). Only their answer comes back into the chat, with its cost.
- **Acts only with your click**: each change is a card (what changes, where, the backup) that runs
  when you click **Do it**: file or update an issue, resume, retry or stop a run, retry or skip a
  roadmap item, edit the roadmap, restore a workflow or skill default, commit a workflow or skill
  change to a project's local main, stop a stray process. **Dismiss** drops it; **Undo** puts the
  backup back. A card that content asked for (an issue body, a run output) says so. Every action is
  logged in `<workspace>/oracle/actions.jsonl`. It never answers a gate, pushes or closes issues.
- **Night watch**: before you leave, turn it on with an end time. Until then the Oracle fixes what
  stops the roadmap without asking (retry or skip a failed item, regroup or reorder planned items,
  refresh issue text, restore a default, restart the dispatch), notifies each action and posts a
  summary with Undo when it ends. Turning it off stops at once. Gates stay yours.
- **Limits tonight** (#337): the turn-on form's "Limits tonight" group expands every run limit for
  the night, so no run waits on a limit sized for the day. One switch, "Expand all limits", with a
  multiplier (×1.5, ×2 by default, ×3); "Customize" opens one row per limit with its day value:
  context, cost and duration per run, agent turn timeouts (each workflow's own values × a factor)
  and the nightly budget (raised for that night only). Off: "Runs keep each workflow's limits"; on:
  one line, e.g. "×2 tonight: context 80M, cost US$ 240, duration 16h, turns ×2; nightly budget
  US$ 150"; no nightly budget: a warning that nothing caps tonight's spending. While the watch is on
  the screen shows the limits in force and they can be changed. Runs in progress get a raise at their
  next check, and keep the highest limit they were granted after the watch ends; runs that start
  afterwards get the day limits. A `context_limit` gate already open stays open for you (with a note).
  Never relaxed: a workflow without a limit, the provider monthly budgets, the memory guard. Only you
  set them: the Oracle has no permission over them, and Self-healing never expands limits. The night
  log records each change (`oracle.limits`); the morning summary lists each run that went past a day
  limit ("#262: context 58M of 80M tonight (day limit 40M), US$ 61 of US$ 240") and the spending
  above the day limits.
- **Step regressions** (#335): after each real run that ends while the Night watch or Self-healing
  is on, each workflow step is compared with its own history in the same class (provider, model and
  effort): the median cost per complexity point and the median minutes of its last 3 successful
  runs against the baseline, the median of its runs before them (at least 5; fewer: "not measurable
  yet"). More than 30% above (thresholds in `src/step-regressions.js` REGRESSION_DEFAULTS) is a
  `regression` finding, logged once per step and class with the baseline, the recent figures and
  the run ids, and again only after the step recovers. Home's morning card lists each one led by the
  step and the rise ("test: +42% cost over 3 runs") with links to its runs. Simulated runs never
  count, and a step moved to another model starts a new class instead of regressing. Report only:
  it never pauses the roadmap, changes a model or effort, wakes the Oracle or answers a gate; the
  roadmap's budget cap stays the only automatic stop.
- **Self-healing** (Settings › Execution › Oracle, off by default): the same watch, day and night,
  with no end time. While it is on, an action whose permission you checked ("What it may do alone":
  the Night watch's checklist, one list for both) runs alone by day exactly as at night, with its
  backup, its Undo and its notification; anything else stays a card in its owner's inbox. Detectors
  in code, with no model call until one fires, look inside the runs: `memory` (a process stopped by
  the memory guard, or a low-memory hold), `cost-gap` (a turn recorded at US$ 0 with tokens, or below
  what the CLI reported for it), `environment` (test files failing in runs of different issues within
  an hour and passing on the base) and `repeat` (the same command failing or stopped three times in
  one step). Each finding is logged once per run and kind with its evidence and wakes the Oracle,
  which may ask the Product Owner to file an issue with that evidence in the run's project and to
  append it to that project's roadmap ("File an issue" and "Append" permissions); it never edits a
  project's code: the roadmap's workflow agents implement the fix. A cause in this app, when the
  app's repository is not a project of the workspace, is only reported to you. Its turns count in
  the Oracle's daily budget; while the budget pauses it the detectors keep logging and you get one
  notification that findings are waiting. The Night watch screen and Home's morning card report each
  Self-healing day (detected, repaired alone, waiting for you, cost with tokens). Turning it off ends
  the watch at once. It never answers a gate, pushes, closes an issue or deletes data.
- **Apply merged fixes to this app** (under Self-healing, off by default; only when the app runs
  from a source checkout and a project of the workspace is its repository, else the row says why):
  the app takes the fixes merged into that project's local main after a roadmap stage ends. In code, with no model call: the roadmap pauses
  ("Updating the app"), the runs in progress finish (a gate is waited for, never answered), the app
  folder is fast-forwarded (refused with uncommitted changes or a diverged history: nothing changes
  and the roadmap resumes), dependencies are installed only when `package-lock.json` changed (a
  failed install goes back), the app restarts and the roadmap resumes by itself. You get a
  notification before ("Updating the app: febef8b → 5d9be33, 11 commits") and after; Undo is "Go
  back to <commit>" in the Night watch's actions. If the new code does not start, the next start
  shows a banner with the command to go back.
- One app process answers: in a second window the drawer shows the conversation and names the
  process that owns it; that window is read-only (no wake-ups, no actions).
