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
- One app process answers: in a second window the drawer shows the conversation and names the
  process that owns it; that window is read-only (no wake-ups, no actions).
