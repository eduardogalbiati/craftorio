# Multiagent Orchestrator

### PARA OS BETA USERS
Seus betinhas, obrigado por participar do beta

O que funciona hoje:
- Importação de Projetos (Existing Project)
- Tela de Projetos
- Criação de workflows (recomendo usar o Feature / Fix / Release) que já vem com o projeto

O que falta ajustar
- PO (não use o PO para priorizar, ele coloca as configs de workflow erradas, tem uma issue pra resolver isso)
- Plan & Design (está em progresso)
- Monitor (draft)


Depois de rodar o app com npm i && npm start
Importem algum projeto
E usem uma IA externa (claude, codex) para interagir com o sistema.
Peça para a sua IA priorizar itens, colocar no backlog, startar o roadmap, analisar performance etc....

Happy coding, qualquer problema podem abrir issues

O épico que preciso finalizar porém acabou meus credittos é
https://github.com/eduardogalbiati/multiagent-orchestrator/issues/785

Se forem importar o APP dentro do APP para poder contribuir use esse workflow
ai-development-remote-hero.yaml

Electron app that runs multi-agent workflows defined in YAML (`<workspace>/workflows/`), opening
**Claude Code**, **Codex CLI** and **Grok Build** sessions and recording the observability of each session
(open/active time, tokens, cost, prompts, thinking, tool calls, output).

## Running

```bash
npm install
npm start
```

### Getting started

On a new workspace, after the workspace folder and the sign-in, the app opens **Setup** (#319), a
stepper you can leave at any time with **Skip** (Esc):

1. **Agents**: one row per CLI (Claude Code and Git are required; Codex CLI and Grok Build enable
   the multi-model workflows; GitHub CLI or GitLab CLI enable Backlog sync and pull requests), with
   its status (Ready / Not signed in / Not installed), version and account. **▶ Install** and
   **▶ Sign in** run the CLI's own command in the terminal dock, and the row checks again when that
   terminal ends. Claude Code's sign-in is read from its credentials file (the Keychain on macOS),
   never by calling a model.
2. **Try it safely**: real runs use your own CLI subscriptions or credits; **Show simulation mode**
   (on here) adds the Simulation checkbox to Start, which shows a whole flow for free. Turn it off
   later in Settings › Execution › Developer mode.
3. **Workflows**: the bundled workflows by category, each with what it needs ("Needs Codex") and
   whether this computer has it; the ready ones are picked, and the others are hidden from Start and
   Home (Workflows › Definitions › **Show in Start** brings one back; nothing is deleted).
4. **First project**: adds a project; **Finish** opens Start on the first picked workflow, with
   Simulation checked.

Finish or Skip records `setupDone` in `settings.json`, so Setup does not open by itself again;
Settings › Agents & CLIs › **Run setup again** reopens it. Workspaces created before Setup existed
are marked as set up.

### Screens

<!-- generated:screens -->
| Menu | What it has |
|---|---|
| Home | The first screen (#255): one overview of the flow from an idea to a release, with two tabs. **Overview**, for the header's project: the **flow strip** (Inbox → Discovery → Ready → Backlog To do → Running → Merged locally → Released, each stage with its count; a count opens its screen on that stage: the Inbox, the Backlog's board, Workflows › Runs filtered on the runs in progress, Releases; a stage whose screen does not exist yet, the Discovery board, is hidden); **What needs you** (the gates waiting, of every project, with how long they have waited and, while Phone gates is on, the gate's phone link; the discovery cards whose thread ends with a question, e.g. one an agent asked while shaping the idea, until a note answers it; and the roadmap's failed items, each with one button: **Open run**, **Answer** (the Inbox with the card open) or **Open roadmap** (at the item's stage)); **Today** (the real cost of the day and of the last night, i.e. the last Night watch's window or tonight's while it is on, the runs finished and failed, the 24/7 occupancy and the roadmap's next stage); the last Night watch's morning summary; and the Oracle's docked panel. A new workspace (no project, no run) shows how to start instead: create a project, capture a first idea, run a workflow. **Analytics**: the Analytics screen with its own tabs (see Home › Analytics). The start panel opens from Home, Projects › Start, Workflows › Definitions (Run) and the Backlog (#412: the header has no Start button any more): it remembers the workflow, project, `mode` and Advanced parameters between runs; the main task field starts empty for each run. **Start workflow** starts the run and shows it; **Start and create another** starts it and keeps the panel open with the task cleared, to queue several runs in a row (with concurrent runs off, only one can start) |
| Home › Analytics | A tab of Home (#255, no menu entry of its own; the Oracle is its drawer there), with five tabs of its own (the selected tab, scope and range are remembered). **Usage**: tokens, cost and session metrics per day, provider, model and project over a date range, for the orchestrator's runs or every CLI session on this machine (#369: a Claude turn on a model the installed Claude Code does not know counts its cost estimated from tokens, cache writes included, or the CLI's figure when the model has no price); "Ask the supervisor" writes a report on the range (a real model call). **Performance** (repository performance): the project it analyses is picked at the top of the tab (every workspace project; one without a git folder is listed but disabled, with the reason; the choice is remembered per window), and the summary line names it, its folder, the runs counted and the range. It shows how well the repository takes parallel runs. The files most runs edit moved to the project's **Conflict map** tab (#354, see Projects): a one-line link "Conflict map: in Projects › <project>" leads there, where each file edited by more than 20% of the runs has a **recommendation** from offline rules (a generated file → edit its generator; a shared registry or list → one file per entry; a stylesheet → per-screen CSS; a doc → per-topic docs; a test file → one test file per feature; a large file → split it by area) with **Create issue** (the Issue tracker drawer, prefilled; a file with an open issue links to it instead) and **Ask for a plan** (the supervisor's deeper suggestion, a real model call it asks for first, refused in simulation-only mode). This tab keeps the share of runs that hit a merge conflict (the `resolve_merge` / `resolve_conflict` step or a failed `gh pr merge` / `glab mr merge`) and their share of the cost, with the list of those runs and the files their conflict named, the runs and roadmap stages active at once per day and the hours runs were active. A marker (a date or a commit) splits every number into before and after, to check the targets of a change such as epic #158. Computed offline from the run folders, the index and the local clone's `git log`. **Run** (#228): one run in depth (search by id, issue or title, or **Open in Analytics** from the run's page and the runs list): its header (workflow, issues, status, cost, cost per issue, duration, active vs waiting at gates), a timeline with one row per agent in its role colour and one for the orchestrator's machine steps (suite, merge…), gate waits hatched with their name and wait; time (active vs waiting on tools), turns, cost and tokens per agent (new input, output, cache read, cache creation, every model call of the agent's turns with their sub-agents' and, #308, "of which sub-agents: n calls, m tokens" when they started any; and the effective $/M tokens); steps with visits and durations, suite rounds with failures and pre-existing failures, the 10 slowest tool calls; and the comparison with the last 30 successful real runs of the same workflow (median, p25–p75, ▲/▼ with the difference, better or worse; fewer than 3 runs: says so). **24/7** (#188): how close the machine is to always working, measured locally: occupancy (time with at least one real run active, a gate wait not counted) over 24 h, 7 and 30 days, the active streak, the week's longest idle gap and its cause, average and peak runs at once; a day-by-day chart of active vs idle time by cause (no work, blocked, waiting for you at a gate, app closed / machine asleep from the app's heartbeat log, other) and a 24-hour heat strip per day in your local time; the idle gaps over 15 minutes with their cause and what ended them; the Night watch split (inside vs outside its windows: occupancy, idle by cause, issues delivered, cost) and its nights next to the nights without it; the cost per active hour, per delivered issue and per 100 lines with a trend; the split by the Product Owner's calibration (runs per stage, `resolve_merge` share, review rounds, cost per issue); and one plain hint when an idle cause dominates (Live roadmap, Keep awake, or day-time gates). **Agents** (#280): what the three conversational agents cost in the screen's date range, read from their usage files (`oracle/usage.jsonl`, `backlog/product-owner.usage.jsonl`, `supervisor/usage.jsonl`; simulated answers are not recorded): a card per agent (Oracle, Product Owner, Supervisor) led by its robot, with its cost and tokens (input, output, cache read, cache write), turns and sessions, cost per turn and its share of the three, plus the Oracle's spend today against its daily budget and its wake-ups against questions, and the Product Owner's projects; the cost per day stacked by agent (US$ or tokens, remembered); and the sessions, newest first, 50 at a time, with why each one started (first, compaction, model change, idle 55 min, reset, cleared, one-shot) and ended (the next session's start, answered, or still open), their turns, context at the end, cost and tokens. A click on a card lists only that agent's sessions. Turns from before the start reasons were recorded show "—"; the Supervisor chat's earlier turns count with their cost only. No model call, no network |
| Plan & Design › Inbox | The raw ideas of the project chosen in the header, kept as private discovery cards in the workspace (`discovery/`), never on the git platform (#256). **Quick capture**: a title and a text (paste or drop images and files, or **Attach files**; the mic dictates the text), **Enter** captures an `idea` card. The list shows the Inbox cards newest first with author, age and attachment count. A click opens a card next to the list: its document (**Edit**, then **Save** / **Cancel**), its attachments (any file up to 50 MB; an image opens in the viewer) and its thread of notes. Triage: **Accept** (to Discovery › Triage), **Merge into…** another card (the documents and attachments join, the merged card is archived with a link to it), **Discard** (archived with a reason). **Esc** closes the open card. **Import…** brings in a backlog that already exists (#322): a `.md` or `.txt` file (chosen or dropped) or pasted text is cut into items without any model call (each top-level heading, or each top-level list item; its sub-items and paragraphs are its text and its `- [ ]` lines its acceptance criteria; plain prose is one item, with a note). The preview lists each item's title, first lines, number of criteria and the clarity score its card gets, and marks a duplicate of an open card or an open synced issue (keep it, skip it or merge it into that card); rename, **Drop**, **Merge into…** or **Nest under…** items (**Undo** takes the last edit back). Nothing is written until the confirm button: then each item becomes an `idea` card in the Inbox, in the document's order, with its criteria in `acceptance.md`, the source file attached and a history entry naming it; all the cards or none. Over 200 cards it asks first; **Cancel** or **Esc** leaves the workspace unchanged. An import never files an issue: cards reach the platform only through the commitment point |
| Plan & Design › Discovery | The upstream board of the project chosen in the header (#257): the discovery cards accepted in the Inbox, worked on until they are clear enough to commit, in the columns **Triage → Shape → Define → Ready**. A card shows its title, type, age in the column, clarity score and estimate when known, and its attachment and thread counts; it moves by drag and drop (also within a column, to order it) or with its **Move to…** menu. **WIP limits**: Shape and Define show `n / limit` (5 by default; the pencil in the header changes it); a move past the limit asks to confirm and the header turns amber, nothing is blocked. **Fast lane**: bug and hotfix cards run in the swimlane at the top and may go from Triage straight to Define (another card that skips Shape asks first). **Filters**: type, tag, author, and a search over titles and documents. A click opens the card in a side panel: type and tags, the document (**Preview** / **Edit**, then **Save** / **Cancel**), the acceptance criteria, attachments (drop or paste to add), the thread, and the **version history** (a version on each move, restore and run result: **Open** or **Restore**; the replaced document is kept as a version). In Shape, **Open in Write & Review** and **Open in AI Arena** prefill that screen with the card's document; when the run finishes, its document comes back to the card as a new version and a thread entry. **Clarity** (#166): every card has a score from 0 to 100% (`clarity 72%`, amber below the bar), computed from a rubric for its type (problem, goal, scope, non-goals, verifiable acceptance criteria, decisions, open questions, dependencies, evidence; plus users and success metrics for a PRD, alternatives considered for an RFC, steps to reproduce with observed and expected for a bug or hotfix: the `clarity-score` skill) each time its document, acceptance criteria or type change; the panel lists the missing points, who scored it and when. **The bar**: a card enters Ready only at **85%** or more (**Bar and night…** above the columns changes it per project, with an optional bar per type). Below it the move is refused and the card offers **Grill me**, an interview in its thread that asks one missing point at a time, proposes an answer when the card already holds one and writes each answer into the card until it reaches the bar or you end it, and **Move anyway**, which needs a reason and is recorded on the card with its score. A card already in Ready is never moved back. **Ready forecast**: above the columns, how much work is ready as nights of agent work (`2 nights ready (about 19 h of agent work, an estimate)`), counting only the Ready cards at or above the bar, from their estimates and the hours of your night (23:00 to 08:00 by default). **Commit to the backlog** (#258): the commitment point. A Ready card with a clarity of **85%** or more is committed from its panel; under 85% (a card moved to Ready anyway, or a type with a lower bar) the button is disabled, the panel lists the gaps and offers **Grill me**, which interviews a Ready card up to 85%. The dialog shows the Product Owner's proposed split, one row per issue (title, complexity, workflow and the tasks taken from the acceptance criteria, all editable; **merge with issue n** joins two) and **Plan them in the roadmap, in this order**; **File the issues** files them on the project's repository, each starting with `From discovery card <id>` and carrying its tasks and the card's document as evidence (in simulation-only mode they only join the workspace's backlog and the split is rule-based: no model, no gh/glab; in developer mode the split is rule-based too and **File the issues** only previews the commands: nothing is filed, the card stays in Ready). While the issues are being filed the dialog cannot be cancelled. A committed card leaves the columns for the **Committed** list beside the board and follows its issues: **In delivery** with the counts to do, running, merged locally and done and each issue's Backlog column, **Delivered** when all are done, **Released** with the version once a release shipped them. It never returns to the board and its panel is read-only; **New card from this one** starts new learning as a new Inbox card linked to it. **Esc** closes the card |
| Plan & Design › Documents | The work items of the project chosen in the header, read from its repository's `docs/work/<item>/` (#647, [spec](../work/write-doc/spec.md)): each with its stage and its documents (`intent.md`, `spec.md`, each with its `pt-BR` translation) and their status (**Draft**, **Accepted**, **Signed off**). **New item** asks for a title, creates the intent from the playbook's skeleton (one commit) and starts the `write-doc` workflow: the writer drafts it, then the run waits at its `human_edit` gate. The editor draws the document in a sandboxed page without scripts; select a passage and the chip above the writer's chat names it; ask for a change (paste images too): each request is one writer turn whose lines replace the selection in the source and its translation, **one commit per request**. **Changes by request** lists them with the count of unreviewed changes: **Mark reviewed**, or **Undo this change** (a revert commit; the later requests stay). Only **Send to review** ends the edit: the reviewer anchors its notes to the sections, then the approval gate offers **Accept intent** or **Sign off spec** (the front matter of both languages changes, with the approver and the date, one commit) or **Back to the edit**. An accepted intent offers **Write the spec** on its item. A signed-off spec offers **Create epic and phase issues** (the Backlog) and **Start the Build** (the Roadmap): nothing is filed or started before that click. |
| Projects | The projects (#354: in the menu under Code & Build, before Backlog; a tab of Settings from #254 until then): the project cards with **Start workflow**, **Open folder**, **Edit** and **Remove**, and **Open folder** (the projects' folder) and **New project** in the header; with no project, an empty state with **New project**. The header's selector chooses the one every screen shows, and opening a project makes it the header's. Projects in `<workspace>/projects/<id>.json`. Every project has a folder and optionally a git repository. With a repository and no folder, it is cloned into `<workspace>/repos/<owner>-<repo>`; without either, the folder is `<workspace>/projects/<id>/`. The dialog's **Workflows** block (#486) reads the repository's `.multiagent/project.yaml` once a folder or a URL is given (a remote one through `gh api` / `glab api`, or a public raw read, before cloning): its workflows come checked with their categories and nothing is asked; a private repository the app cannot read says it will be read after cloning. Without a manifest it lists the bundled and workspace workflows by category, none checked, a hint per category, and **Create one for this project** (opens the Builder). The project keeps the checked set and its default workflow (the first solo or team one), which the roadmap's new items and the Product Owner use instead of Settings' default; the project page's Overview shows the same block to change both later. Clicking a card opens the project's page, with four tabs (the selected one is remembered per project; choosing another project in the header switches the page to it). **Overview**: the folder, the repository, the commits not pushed yet, and every workflow run in it (status, cost, task), and for each run its sessions, with **Live terminal** / **Open in CLI** to watch or resume any of them, then two columns: **Artifacts** (what the run produced first, **Show all** for its notes and logs, chips by category and kind, as in the run's Details) and **Repository** (the run's branch and its state, its commits newest first, **Review changes** opening the changes viewer, a click on a commit opening it on that commit). Runs are linked by the project id they were started with (older ones by the project's current or previous folders). **Conflict map**: one table of the files most runs edit, merging the saved conflict map (see The conflict map) and the repository performance of a date range: each file with the runs that edited it, its share of the runs (marked past the shared limit), a **hot** badge past the Product Owner's threshold (more than half of the last 20 runs) and the merge conflicts that named it; a click on a row shows the runs behind the count, the single lines of that file most changed, the trend (the newer half of the map's runs against the older half) and the file's recommendation with **Create issue**. Its controls: 7, 30 or 90 days or a From-To range, the before/after marker, **Refresh** and **Ask for a plan** (the supervisor's suggestion for the files over the limit, a real model call it asks for first). It says when the folder is not a git repository or no run with commits is in the range. **Architecture**: a **Facts \| City** switch leads it (the choice is remembered per window), and one action leads both: **Analyze this project**, with its estimate next to it (≈ US$, the project map run from past real runs plus the Oracle's turn from past real analyses; "no estimate yet" before the first real run), starts one run with no gate: the cartographer writes or refreshes the city plan (a refresh keeps the names you saw), then the Oracle analyses the hotspots. The tab follows the run ("Analyzing this project" with its step) and shows the city with the new plan and the report when it ends, or its error. **Facts**: a lead row first (the report's verdict in one line, the top 3 risks with their 0-100 score, the Danger Zone count, the languages bar as on GitHub), then the latest Oracle report (a three-line summary, the verdict per area as chips, findings ranked by score with one line each and **Read more** for the evidence and the refactor, filters by severity and new / kept, **Send to Refactor** per finding or **Send all to Refactor**) and the git facts (the quality gate as one row of chips, the exclusions and the complexity in one line each, hotspots, the Danger Zone scatter; the caveats behind the ⓘ next to the title). **City**: the project as a 3D city drawn like the run's 3D view (same themes and toggle) and like the approved proof of concept: a building per file (its footprint grows with the lines, its height with the complexity, a few ledges from the functions, a mast for the worst function), with streets between the buildings, raised district plates named on the ground, sidewalks, avenues with lane marks between the zones, and the zone names along them; districts inside zones in the city plan's order with avenues and streets between them, landmarks with a beacon, ports past the edge with arcs to the files that talk to them. The header names the project, its files, zones and districts, the Danger Zone count, the plan's coverage and the commit; **Colour by** Quadrant, Zone or Churn with its legend, a **Tests** toggle, and a search that flies to a file or a district. Hovering shows a card and the arcs to what a file requires and what requires it, lighting those buildings without greying the rest; a click pins the card, whose **Open in Facts** shows the file's hotspot row, and dims the city outside the file's connections. A **Most connected** panel lists the files with the most connections (requires and required by, the top 30, with a search): a click flies to a file and pins its connections, outgoing and incoming in their colours, until it is clicked again; several files can be pinned at once and **Clear pins** removes them all; in a language whose imports are not read the panel says so. **Expand** opens the city over the whole window (Close or Esc brings it back, the camera where it was). Without a city plan the districts are the folders, with **Analyze this project** and its estimate; a stale plan, the plan's problems and over 5,000 files (small files grouped per district) are noted under the header; without WebGL the view says so and points to the Facts. The City shows the agents of the project's runs in progress at work, live: a pin on a building's roof marks the file an agent last changed or reads, and a card lists each agent with its robot, name, step and whether it changes or only reads that file (a click opens its run); each run's last 10 changed files light up in its colour, a building with uncommitted changes gets a crane pin, a file the city does not have yet is listed on the card as under construction in its district, and a building two runs in progress change is marked as a **collision risk** with a link to the Conflict map. With no run in progress it says "No agent is working on this project"; runs of other projects are not shown. **Replay on the map** on a finished run's screen opens its project's City and plays the files its agents touched, with a timeline, **Play** / **Pause** and a speed. **Refactor**: the proposals sent from the Architecture findings |
| Backlog | The issues of the project chosen in the header (#254), synced from its git platform: **GitHub** (gh CLI) or **GitLab** (glab CLI); Bitbucket is listed but has no sync yet. The default platform is in Settings › General › Backlog and can be switched on the screen. The last sync is kept in `<workspace>/backlog/<project id>.json` (shown instantly, a new sync runs each time the screen opens). **List** view (open/closed/archived filters, labels, task-list progress, the issue rendered as Markdown; an issue filed from a discovery card shows the card's badge, `card: <title>`, which opens the card read-only on the Discovery board, #258) or **Kanban**: **To do**, **In progress** (running, failed, or its run succeeded but the issue is still open, e.g. its PR/MR isn't merged yet), **Waiting for approval** (its run is at a human gate; **Review approval** opens it), **Merged locally** (not pushed yet) and **Done** (closed on the platform). Select To do issues and **Assign workflow…** (workflows with a `task` input; their other inputs are asked once and remembered per project and workflow; simulation in developer mode): they are planned in the roadmap as one new stage at the end, in the order selected (#446). Nothing starts until the roadmap does, unless **Run now** is checked: that new stage then starts on its own, as the stage menu's **Run this stage** does (#141), within Settings › Execution › **Concurrent runs**. With two or more issues selected, the dialog asks how to send them: **Separate runs** (the default: one run, branch and PR/MR per issue) or **One run for all**: one roadmap item, one run, one branch and one PR/MR that closes every issue (the note says what will happen: "3 issues → 1 run, 1 PR closing #53, #65, #77"); at most Settings › General › Backlog › **Issues per run** (5 by default). Every card of a group shows the same run (status, waiting, Done) with a "grouped with #a, #b" badge. Each run records its issues; `software-development` gets them as the `issue` (the first) and `issues` (every URL) inputs: for a group, the task lists every issue, the developer and the PR/MR account for each one, the review and the verifier check each one, and an issue the developer could not do stops at a gate (continue without it / stop), never dropped silently. There is no separate queue (#446): the roadmap is the one way to run planned issues, paused and resumed there. A project an older version left with queued items gets them once as a planned roadmap stage at the end, without the old queue's pause; `<id>.queue.json` is no longer read or written. Each sync also reads the open PRs/MRs that refer to an issue (a closing keyword or a link to it in the description, `#<number>` in the title, GitHub's closing references) and shows them as badges linking to them; **Assign workflow…** warns about selected issues that already have one (or a run in progress or waiting) and skips them unless you assign them anyway. The git platform is the **source of truth** for issues (#168): roadmap items keep a read-only copy of each issue that every sync refreshes until the item starts, and right before a roadmap item starts, its issues are read again from the platform: the run's task uses the current title and body, an issue closed meanwhile is skipped, and the run records the version it used (`updatedAt`). If the platform cannot be read, the run starts from the last sync (or the planned copy, when it is newer), logs a warning ("Issue #n read from the cache of HH:MM: …") and its card shows an **issue from cache** badge. Nothing writes local issue text back to the platform; only the explicit, previewed actions below do (Save to issue, create, close, epics). Runs started by hand are linked when their task or a text input mentions the issue URL or `#<number>`; **Enrich in Write & Review** on an open issue (list row, kanban card, expanded details) opens Write & Review prefilled with it (an enriched issue by default; title, number, URL, labels and body in the prompt; nothing starts by itself), and once its document is accepted, **Save to issue** replaces the description (the original kept in a collapsed block) or adds it as a comment, after a preview and your click; the issue is read again after the save. Such a run shows as "being enriched" / "enriched" and never moves the card's column . **Roadmap** (a screen of its own, Code & Build › Roadmap, #254): a roadmap is a plan, and the one way to run planned issues (#446). It lists **stages** in order, each with one or more items (a workflow with one issue or a group, its inputs, simulated or real), a name and a note on why this order, in `<workspace>/backlog/<id>.roadmap.json`. **Assign workflow…** plans the selection as a new stage (with **Run now**, it starts on its own); a Product Owner proposal (JSON) is added or replaces the roadmap, always as **planned**. Stages and items move up/down or by drag, an issue can be dragged from one item to another, items are removed and their inputs edited. **Start** (optionally **Simulated**) runs the first stage's items in parallel within the concurrency limit; the next stage starts only when **every item of the current one finished successfully and merged** (a local merge, the PR/MR merge action, a simulation that succeeded, or a successful run of a workflow that never merges, `metadata.merges: false`, such as **Backlog Refresh**); a run waiting at a human gate keeps its stage open. A failed, cancelled or interrupted run **pauses** the roadmap with a notice: resume the run (Resume from step…: the new run takes the item's place), **Retry** or **Skip** the item, or **Stop** the roadmap; it never skips a failure nor answers a gate by itself. A start the roadmap could not make (kept work of an ended run, #170) pauses it the same way: the item shows its error, wrapped, with **Retry** (it asks: resume the old run or start from scratch) and **Skip**, and the page's alert offers **Retry**, **Skip** and **Show the item**, which scrolls to it; several such items ask in turn. **The bar** (#269) shows the roadmap's state as a dot before its name (blue and pulsing while running, amber paused, red paused by a failure, grey planned, green done), **Pause** (amber) and **Stop** (red, after a confirmation) with their icons, and a **⋮** menu with **Clear** and **Restore an earlier version…**; the filters (epic, Planned / All, date range, Group by epic) sit on a row above it. **Alerts** (#270): what the Board and the Roadmap have to tell you shows at the top of the page, one alert at a time with a counter ("1/3") and arrows, errors first: a roadmap paused by an item (red), a Backlog Refresh that is due or the retired `deprioritized` label (amber), local merges not pushed (light blue, with **Push…** and **Auto-push**). **Ask the Oracle about this failure** (#271): a card whose item failed, was interrupted or stopped, or could not start opens the Oracle beside the roadmap, already asking what happened to that run and what to do (a real question: it costs like any Oracle question); the Oracle may propose an action card, which runs only on your click. **Undo** (#281): removing or moving an item, a stage or an issue, renaming a stage, removing a cut line, Clear and Replace show a toast with **Undo** for 10 seconds; it puts back what that edit changed (items that started since keep their runs) or says why it cannot. The roadmap as it was before each of your last 20 edits is kept in `backlog/<project>.roadmap.history/` and restored from the ⋮ menu. Undo and Restore never stop a run nor answer a gate. **The item card** (#282) reads in three bands: its **issues** (the titles, then "4 issues · complexity 9") beside its **cost and time** (the estimate; once it runs, the real value against it with a verdict, a sign and a bar, the time being the run's live timer) and its **status** (the progress ring with the estimated %, the status and the current step, the fix round; then Retry / Skip, or move and Remove); the **Workflow band** with the workflow's name, **Open run →** or **Edit**, the **mode** toggle (Automatic / Validated, saved at once; locked while the item runs), the other inputs, and the **pipeline**: one station per stage of the workflow, always visible, done, at work (with the agent's name), sent back ("asked for fixes"), not reached yet, and the owner's gate that Validated adds ("Your check"); a station opens the run there; then the Product Owner's reason. The ring's estimate counts the steps done along the workflow's usual path, weighted by each step's typical time in past runs (never 100% before the end); hover or click it for the run's summary. A stage's rarely used actions are in its **⋮** menu: **Disable** / **Enable**, **Run this stage**, **Release here**, Run earlier / later (past the stages the view hides, which keep their order: the lowest drawn stage goes to the end, #426) and its note. **A disabled stage** (#284) is skipped while the roadmap runs: nothing of it starts, its cut line holds nothing and the stage after it runs as if it were not there; it stays in the list in its place, dimmed, with a **Disabled** badge, and is counted apart ("5 stages, 1 disabled"). With every enabled stage finished the roadmap is done and says how many disabled stages were left out; enabling one never starts it by itself. Start, Resume and Run this stage list the items whose workflow pushes and opens PRs while the default development workflow merges locally (their card says "Pushes a PR/MR"): **Switch them** to the default, or **Start anyway**. Long reasons, notes, errors and inputs wrap or end with … inside the card: the roadmap never scrolls sideways. A started roadmap continues after an app restart. Issue cards show their place ("Roadmap: stage 2"); an issue belongs to at most one planned item: assigning it again asks first and takes it out of its earlier item, and items whose issues are all closed are skipped. **Group by epic** shows the roadmap's items under their issues' epics. **Live roadmap** (#164, a switch in a box below the last stage; on only while the roadmap runs, so turning it on asks to start it): when the last stage ends, the roadmap does not end: the Product Owner picks the next open issues (not in the roadmap, no open PR/MR or run in progress, not an epic, not flagged to enrich first, `complexity:n` up to a cap, lowest first) and adds them as new planned stages (a stage note says when, and what its answer cost), and the roadmap goes on, again and again. While it is on, the box turns a muted red with **LIVE** and a banner with a blinking dot sits on top of every Backlog view (last refill, **Turn off**). It stops by itself when nothing is left to pick or the daily budget (runs and refills over 24 h) is reached: the roadmap ends done with the reason and live stays on (Start tries again); a failure pauses it as usual, and turning it off lets the current stages finish. Refills only add planned stages: they never answer a gate. Settings › General › Live roadmap: the complexity cap (2), the stages per refill (3), the daily budget (US$ 50) and a sync before each refill. **Epics** (the Backlog's second tab, #138; an epic shows only there, #253: the Board's list, kanban, counts and filters leave epics out, and an epic cannot be selected, assigned to a workflow or planned in the roadmap): on GitHub an epic is an issue labelled `epic` (or of the organization issue type "Epic") whose **sub-issues** are its members; on GitLab a group epic, or an issue labelled `epic` whose members carry the scoped label `epic::<name>`. Each sync reads them into the cache; every card shows its epic as a badge (a click filters by it) and the **epic filter** (a select with counts, "No epic" included) narrows the list and the kanban, together with the labels and the search. The view lists each epic with its progress (open, closed, done in the roadmap) and members, the issues in no epic, **Auto-place new issues** (per project: a new issue the Product Owner registers, or the Issue Tracker files, joins the existing epic it clearly matches; a new epic always asks) and **Organize into epics…**, which asks the Product Owner to propose epics for the open issues. **Product Owner** (the robot button at the bottom right, every view): a built-in agent that opens a drawer on the right, with suggested questions ("Analyze the backlog and propose runs", "What should not run together?", "Build a roadmap", "Which issues are too big or unclear?", "Which issues are too big to run as one?", "Organize the open issues into epics") and a free text box. **Send to Product Owner (n)** (#169), next to **Assign workflow… (n)** when issues are selected (list or kanban), opens the drawer with them attached as removable chips (`#129`, `#130`) and an editable suggested question ("What is the best strategy to put these issues in the roadmap? Should any other open issue join them?"): nothing is sent until you press **Ask**, and the selection is kept. **Archive (n)** (#238), in the selection bar and in each open issue's **⋯** menu (at the right end of a list row, in the top right corner of a kanban card), closes the issues on the platform (GitHub: as not planned) and labels them `archived` (created, grey, when the repository lacks it), after a confirm that names them ("Close #12, #15 as not planned on GitHub and label them archived?"): they leave the Open view at once and show under the **Archived** chip (**Closed** keeps the finished work; the kanban hides them), where **Restore** reopens an issue and removes the label. An issue planned in the roadmap (planned or running item) or with a run in progress cannot be archived: its Archive is disabled with the reason ("Planned in stage 41: remove it from the roadmap first"); a failure (no permission, offline, CLI missing) is shown per issue and leaves it as it was, the others still go through. The Product Owner's report, its plans and the roadmap leave archived issues out (one cannot be added to a stage). Archive replaces the retired `deprioritized` label: issues that still carry it get a one-time alert offering to archive them. Attached issues are read in full and stay attached for follow-up questions until removed (or the conversation is cleared); the answer plans only them and lists, per group, similar open issues that could join as **suggested, not selected** checkboxes (unchecked: a checked one joins on **Assign…**, **Add to roadmap** and **Add all to the roadmap**). An attached issue closed meanwhile is struck through and left out of the proposal; the button is disabled while the Product Owner is answering. It reads the synced issues (bodies clipped unless the question names or attaches them), the runs in progress, local merges not pushed, the roadmap and the project's finished runs (agent time, cost, tokens, merge conflicts and the files they hit), plus the project's code, read-only. Each answer shows its cost and proposes **groups** (issues, workflow and inputs, why they belong together, files, stage), the issues that **must not run in parallel** and why, the issues to **enrich first** (#103), and each group's **size**: the sum of its `complexity:n` labels (3 when missing), a time and cost **estimate** from past runs of similar size, and a warning at complexity 7 (context limit) or 5 in a group (test time budget). Nothing is applied until you click: **Assign…** opens the Assign dialog prefilled (the issues selected as one run, the workflow and inputs), **Add to roadmap** plans the group as a new stage, **Add all to the roadmap** adds every group as planned stages. One agent call per question (Claude Code, the model and effort set in Agents, 15 min at most), refused when Claude Code reached a blocking monthly budget; developer and simulated mode answer from a simulated Product Owner (no model call). It never edits issues, starts runs or answers a gate. **Live progress** (#180): while it answers, the drawer shows under your question what it is doing, like a Claude Code conversation: an activity line with a spinner and a timer ("Starting the Product Owner…", "Reading packages/engine/domains/roadmap/roadmap.js", "Searching the code for dispatchRoadmaps", "Listing open issues (gh)", "Thinking…"), its last steps as a collapsible list ("6 steps"), then the answer as it is written, rendered as Markdown (the JSON block at its end never shows; the groups and their buttons appear when the turn ends). **Stop** ends the turn and keeps what was written, marked **Stopped**; a failure keeps it too, after the error; with no news for a minute the line says "Still working: last step 1 min ago". Simulated mode streams a few fake steps and the simulated answer. **Split what is too big** (#124): an issue of complexity 4–5, with more than 8 tasks, tasks in unrelated areas of the code, parts that could ship on their own, or the size of past runs that hit the context limit or the test time budget is flagged with its reasons, and the answer proposes 2–4 child issues (title, the parent's tasks each takes — every task in exactly one child —, complexity, stage: children of one stage can run together) and whether the parent becomes an umbrella or is closed; **Edit…** moves a task to another child, renames or merges children, and **Split** (or **Split + roadmap**, the children planned by stage with the workflow of the select next to the buttons, the default development workflow of Settings › General › Backlog until changed; the same select is next to **Create + roadmap** in the chat) files them, each with the parent's context, then adds a `- [ ] #n` task list to the parent or comments and closes it. **Epics** (#138): the answer places issues in existing epics (**Place in epic**) and proposes new ones (title, goal, members: **Create epic**), and names epics to merge or split; a drafted issue may name its epic, and **Create** places it there when "Place in epic" is checked. Everything that writes to GitHub/GitLab waits for your click (previews only in developer mode). The conversation is kept per project in `<workspace>/backlog/<id>.po.jsonl` until **Clear**. **Backlog Refresh banner** (#161): when the project's last successful Backlog Refresh run is older than Settings › General › Backlog › **Suggest a backlog refresh every** (24 h by default; Off) and its base branch got merges since (or no refresh ever ran), a warning in the page's alerts (#270) says "Backlog refreshed 26 h ago · 14 merges since" with **Refresh now** (the Start panel on `backlog-refresh.yaml`, prefilled with the project, its platform, the base and `since` = the last refresh's start; nothing starts until you press Start, simulated in developer mode) and **Dismiss for today** (kept in `<workspace>/backlog/<id>.refresh.json`). While a refresh run is live the alert says "Refreshing the backlog…" with a link to the run. When the run ends the Backlog syncs the project; the issues it updated show a **refreshed** badge for a day, and the issues it closed leave the roadmap as usual (an item whose issues are all closed is skipped). **Show on the map** (#375), on an issue card and in a list row's **⋯** menu, opens the project's city (Architecture › City) with the issue's expected footprint: the files its body cites (`file:line` and plain paths; globs are ignored), the files of the Product Owner's group for it (read from its saved answers, never asked again) and, after a run, the files that run changed, each building coloured by its source and the rest grey. A header shows the issue, the counts by district and zone and the share of the files in the Danger Zone; a predicted file the repository does not have yet is listed apart ("new file, expected in <district>" when a city plan rule matches it). After the issue's run it shows changed as predicted, predicted but untouched and changed but not predicted, with a hit rate kept per issue. No model call |
| Roadmap | The roadmap of the project chosen in the header, on a screen of its own (#254; a tab of the Backlog until then): the ordered stages of runs, **Start** / **Pause** / **Stop**, each stage's **⋮** menu (**Disable** / **Enable**, **Run this stage**, **Pause after current step**, **Stop** (#412: stops the stage's live runs after a confirm naming them; the roadmap then pauses and offers Resume / Retry / Skip; disabled with the reason when no run of the stage is live), **Release here**), the live roadmap and the Product Owner's drawer, as described under Backlog. A **Planned \| All** switch (remembered) chooses what shows: Planned is the open work (every item but the done and skipped ones; a stage's finished items fold under a green **+n done** chip that unfolds that stage only), All is every item. A **date range** (last 24 hours by default, up to Total) filters by each item's last activity: the finished items in Planned (open items always show), every item in All; the header counts "12 of 87 items · last 24 hours". Long roadmaps load in pages as you scroll, starting around the current stage. An item's card (#282) shows its issues, its cost and time against their estimates (the time of a run at work is a live timer, coloured once past its estimate), one status block (the readable status, pulsing while it runs, the current step, and "Round 2 · fix round after Code review" when the run was sent back, with the progress it had earned kept) and a **Workflow** band: the workflow's name with **Open run →**, the mode toggle and the pipeline of the workflow's stations. A disabled stage (#284) stays listed, dimmed, and is skipped while the roadmap runs. The epic select narrows it to one epic. A release (#291) shows as a block of its own after its stage (its cut line's, or the last stage with a run in it for a release started from the Releases screen): **Release <version>** with its release run's state (Checking, Waiting for you at Ship, Shipped, On hold, Failed), its stations (Unit tests, E2E scenarios, Fix, Ship) with their rounds, its time, cost and fixes and **Open run**; it is not a stage (no number, no menu, cannot be moved or dropped on) and replaces the cut line's row once its release run started. A dashed line follows it: shipped, the version, when, its issues, runs, cost, tag and short commit with **Open in Releases**; not shipped, its state and what the stages below wait for. The **Release** select of the filter row (remembered with the others) shows **All**, **Next release (not shipped)** or one shipped release: only the stages and items whose runs are in it (Planned does not hide them), counted in the header ("Release 1.0.0: 56 stages · 94 runs; 27 runs of this release are not in the roadmap"). An item whose run was interrupted, failed or was cancelled has **Resume run** next to Retry and Skip (#288): Resume from step… for that run, where it stopped preselected. The bar's **Pause** (#391) opens a menu: **Pause after this stage** (first, the default) lets every item of the current stage still start and finish, those waiting for a free slot too, while the bar shows **Pausing after stage N** with **Cancel pause** (read from the roadmap file, so it survives a reload); when the stage is over the roadmap pauses with "Stage N done", before the next stage, a cut line's release run or a live roadmap's refill, which **Resume** starts. A failure in the stage still pauses at once and human gates still wait for you. **Pause now** is the pause as it was: nothing new starts, runs in progress go on. **Pause after current step** (#368, a stage's ⋮ menu) pauses the stage's runs once their agents finish their current turn (nothing is cut) and pauses the roadmap: the stage shows "Pausing: waiting for <agent> to finish its turn (<step>)", then "Paused after the current step" and when, never as failed; its paused items offer no Retry, Skip, Edit or Move, and the roadmap's **Resume** continues the paused runs where they stopped before any new item starts. Links that opened the Backlog's Roadmap tab (a roadmap's notification, the 24/7 hint, the Product Owner's "In roadmap" badges) open this screen. **Show on the map** (#375) on an item opens the project's city with its issues' expected footprint, as on the Backlog; **Show the stage on the map**, in a stage's header, colours the files of every item of the stage, one colour per item, and marks red the buildings two items would both change (the Product Owner's rule that one stage shares no files, #150) |
| Releases | The releases of the project chosen in the header (#260). **Next release**: what merged locally since the last one (its issues, the commits not pushed, the runs and their cost), with release notes generated from them and editable until Ship (saved when you leave the field), and **Run the release checks**, which starts the [release workflow](#release-workflowsreleaseyaml); a roadmap's cut line ("Release here" on a stage of the Roadmap) starts it too and holds the stages after the line. Above the version field (and the cut line dialog's name, #436): the last three shipped releases ("1.1.2 · 2026-10-13 · 4 issues", or "No release yet") and **Suggest version**, which fills the field from the labels of the issues since the last one (`breaking` major, `enhancement` minor, else patch; a leading `v` kept) with a line saying why; no model call, and it never submits. **Shipped**: each release with its version, date, issues, runs, cost, unit and E2E results and notes, and the **Release summary** its release run wrote (#290) when the run needed a fix. Each release also shows on the Roadmap (#291): a release block after its stages, a dashed line with its version, and the Roadmap's Release filter. **Show on the map** on a tagged release (#376) opens the project city as it was at the previous tag, in grey, with what the release changed in colour: new files in green, changed files on a ramp by the lines changed, renamed files on their old building, removed files marked as ghosts (a grey "removed" marker on their old building, not an outline), and a header with the counts by status, district and zone. Its two-tag picker compares any two releases (the latest commits for a project without tags), its issue filter keeps the files of one issue (the commits that name it), and **Save image** saves a PNG of the view with the project, the release and the counts in a caption, for release notes. Nothing is pushed from this screen: Ship is the release run's own gate |
| Sessions | Every Claude Code, Codex and Grok conversation recorded on this machine (read from `~/.claude/projects`, `~/.codex/sessions`, `~/.grok/sessions`), newest first, with its project, model and folder; filter by provider or search. Clicking one reopens it in its CLI (`claude --resume`, `codex resume`, `grok --resume`) in an embedded terminal, in the session's folder. **New session** starts a CLI with a provider, model, effort and project (or folder). Terminals keep running while you use other screens; sessions created by workflow agents are hidden unless you ask for them |
| Workflows | The menu's **Workflows** group has one entry per tab of the screen (#254): Definitions, Runs, Builder and Pipelines. **Runs**: every run, live or finished, with the runs' **Artifacts** as its second tab; an expanded run shows its run id, then at the right **Resume from step…** (resumable runs), **◆ Send to supervisor** (the Supervisor's chat opens with the run attached; nothing is sent until you write and send, and the button waits while the Supervisor answers) and **Open run** (its Run screen, always on the Details tab; the Chat tab replays it) (#409), its sessions, then its **Artifacts** (Produced first, **Show all** for its notes and logs, chips by category and kind) beside its **Repository** (the branch and its state, the commits newest first, **Review changes**). **Pipelines**: the saved pipelines alone. The round **Supervisor** button at the bottom right of every tab opens the Supervisor's chat as a drawer (#409). **Definitions**: the YAMLs in `<workspace>/workflows/` with their steps, agents/models, skills, `/goal`, `/loop`, parallel steps and branches. **Builder**: draw a workflow instead of writing YAML (see [Visual builder](#visual-builder)). Each definition is marked **default** (untouched copy of a workflow bundled with the app), **modified** (a default you edited; **Restore default** moves your copy to the trash and restores the bundled one, and **newer default** means the app ships a newer version than the one you edited) or **custom** (created by you). **Download** on every card saves its YAML as it is on disk, named `<file>.yaml`; **Import file** (or a YAML dropped on the tab) and **Import URL** (https only) bring one in: the app validates it first, then a dialog lists what it does (steps, agents and their tools, `action:` commands, `ship`, `requires`) and reminds you that a workflow is code that runs on this machine; **Import** writes it as **custom** under the name you give (an existing name only with **Replace** ticked), **Cancel** writes nothing, and a workflow the loader rejects or that requires a newer app shows the reasons instead (#488). The screen opened with `?import=<url>` starts that import, the link a public page can offer. **Keep awake** (the switch in the header of Runs and Definitions, the same setting as Settings › Execution, per workspace, off by default): while a run is in progress, or a roadmap is running, the app keeps the computer from sleeping (a run waiting at a gate counts only when a roadmap continues after it). The switch shows **Active: 2 runs, roadmap stage 3/6**, **On: waiting for work** or **Off**, and the sidebar shows **Keeping awake** while it holds; the display may still turn off, and choosing Sleep, closing the lid or the Windows power plan still apply |
| Workflows › Runs › Artifacts | A tab of Workflows › Runs (#254). Every file a run produced (documents, proposals, reviews, reports), grouped by run and filterable by project. The viewer renders Markdown (tables, table of contents; sanitized with DOMPurify), pretty-prints JSON and shows TSV/CSV as tables. Also listed per run in the project view, in the Run screen's **Artifacts** tab (the first tab, before Session and Events, open by default when a run is opened, #410; updated live, previewed in place) and on the approval gates that try the change. Right-click a file (or Shift+F10) for **Copy to clipboard** (an image as an image, a text file as its text), **Copy file** (paste it in Explorer or a chat; desktop app only) and **Copy path**; right-click an open image for **Copy image** |
| Workflows › Supervisor | The Supervisor's chat, a drawer on the right that knows the screen you are on (e.g. "Workflows, builder tab, editing workflow X"). The round **Supervisor** button at the bottom right of every Workflows tab opens it (its robot, with a yellow dot while an answer is unseen, like the Product Owner's on the Backlog; #254, #264, #409: no menu entry, no header or top bar button), and a run card's **◆ Send to supervisor** (Workflows › Runs and the Projects screen) opens it with that run attached to your next question; **Expand** widens it to the whole conversation and the list of what it can read. Requests from the other agents (the Oracle, the Product Owner) arrive in the same conversation. It reads the app's data through read-only tools (workflows, projects, runs, skills, agents, usage, analytics) served by its own MCP server, never the repositories' code; it never answers a human gate and routes code problems to the workflow's agents. Each message is one model call (developer mode: the simulated supervisor, no cost). While it answers, the chat shows what it is doing (an activity line with a timer, its last steps), then the answer as it is written; **Stop** ends the turn and keeps what was written, marked Stopped (#180) |
| Agents | Reusable agents in `<workspace>/agents/<id>.json`: a robot look (main color, shell, visor, glow, eyes, emblem; live preview of the animated states), a prompt with what the agent is for and the skills it always gets. The built-in **Supervisor** is always listed: its prompt and skills are fixed, only its look can be changed (it shows wherever the supervisor appears, e.g. Write & Review). The built-in **Product Owner** (the Backlog's planner, skill `backlog-product-owner`, a teal robot with a clipboard) is listed second: its prompt and skills are fixed; its look, its model (default `claude-opus-5-5`), its effort (default high) and its **Planning** calibration (a Speed ↔ Quality slider, default Speed-leaning; see "Calibrating the Product Owner") can be changed, each with a "What this changes" line. Neither can be removed. The visual builder imports them into desks, or picks one at random when a run starts. The **workflows' own agents** (the `agents:` of each workflow in `<workspace>/workflows/`, edited and custom ones included) follow, one section per workflow with a `workflow` badge: readable name, provider, model and effort (a value the user picks when starting a run shows the workflow's default, marked "picked at start"), session, skills (a templated skill shows its family) and capabilities; a workflow that fails to load shows its error once. They are read-only: **Customize look** opens them (their prompt, skills, capabilities and the steps that use them, read-only) and only their look can be changed (saved in `agents/workflows/<file>/<agent>.json`, shown wherever that workflow's runs draw them: the run chat, the progress chips, Write & Review and the run's 3D view); an agent whose look was never customised is drawn as the run draws it, its provider's robot painted in its role colour, and **Reset look** brings a customised one back to that; **Open in workflow** jumps to Workflows › Definitions; **Duplicate as my agent** makes an editable copy |
| Skills | One folder per skill in `<workspace>/skills/<id>/SKILL.md` (Claude Code format) |
| Usage | Tokens and cost per provider this month and today, monthly budgets (USD and/or tokens), per-model prices for CLIs that do not report cost (and for a Claude model the installed Claude Code does not know: its turns are estimated from tokens, marked "estimated from tokens" in the run lists and on the Run screen, or "no price for <model>" when it has no price, #369), recent runs, and the GitHub Actions minutes of the month against the included quota (warning at 80%, see CI/CD). The topbar widget shows this month's total; click it for a per-provider popover. The top bar (#412) reads: the brand, the Project select, the **24/7** chip and this usage widget, then at the right end the Oracle's button, the notifications bell and the account chip (its pop-up opens aligned to the right edge). A run's status, cost, Stop and Pause live on its Run screen, not in the top bar |
| Night watch | The Oracle's night shift (#172). It leads with the switch: **Off**, or **On until 07:30** with who turned it on and when (an end time is required, at most 24 hours; a preset sets 8 h from now). The owner's checklist says what the Oracle may do **without asking** while it is on (retry a failed roadmap item, skip an item, regroup or reorder planned items, start from scratch over kept work, refresh issue text, restore a workflow or skill default, append low-complexity issues, restart the dispatch, commit a workflow or skill fix to the local main, file an issue, promote a release: push the stable tag of the last release candidate, #489), each with what it does and its undo; defaults: retry and refresh. Answering a human gate, any other push, closing issues, deleting data and paid calls outside the plan are shown locked, never allowed. Each night is measured from the Oracle's own log (`oracle/night-log.jsonl`) and the runs' events: incidents by kind, autonomy, escalation, resolution, TTD and TTR (median, p90), idle hours by cause, hours saved (an estimate), work unblocked, gate wait, precision (undone actions), loops, false alarms, the watch's cost, the night's yield and the safety counters (a red alarm when a gate was crossed or a never-allowed action ran), a timeline, the actions with their permission, backup and Undo, and a table to compare nights against the baseline night. While the watch is on, the sidebar entry shows a moon and the runs it watches; when it ends, a notification and a card on Home's Overview give the morning summary. Simulated mode can replay a sample night. While **Self-healing** is on (#278, Settings › Execution › Oracle) the watch has no end time: the screen says **Self-healing is on** in place of the end time, its switch is the setting (turned off in Settings), the same checklist applies by day, and each Self-healing day (UTC) is a window of the report with its own counts: detected, repaired alone, waiting for you, and the Oracle's cost with tokens |
| Settings | Workspace, voice input (**General › Voice input**: OS dictation, the whisper.cpp CLI, model download and language, see Voice input below), CLI status (Claude Code, Codex, Grok Build, GitHub CLI, GitLab CLI, Git) and run preferences (`<workspace>/settings.json`). There is no global default workflow (#790): the workflow used wherever one is not picked by hand (the Product Owner's plans, Split + roadmap, Create + roadmap, the Assign dialog with nothing remembered, Fix the base) is the project's own default, from its page or its repository's `.multiagent/project.yaml`; an older `defaultWorkflow` setting is copied once to the projects without one and then dropped. **General › Language** (#327, #328, #329), next to the time zone: **Interface** (#329; English or Português (Brasil), the languages with a translation) sets the language of every screen (#330: Home, Inbox, Discovery, Backlog and Roadmap, Run, Sessions, Releases, Projects, Workflows, Agents, Skills, Analytics, Usage, Night watch, the Oracle, Product Owner and Supervisor drawers and the Agents window), the First-run setup, OS notifications and desktop dialogs, with dates, numbers and percentages in that language and costs in US$ with its separators ("US$ 6,48"); until you choose one it follows the computer's language when the app has it, else English, and a change redraws every open window at once, without a restart (your content, workflow texts, agents' messages and logs are not translated; to add a language, copy `packages/shared/i18n/en.json` to `<lang>.json`, translate its values and add it to `PAGE_LANGUAGES` in `packages/shared/i18n.js`; a key it lacks shows the English text); **AI agents** ("Same as the interface", the default, which follows the Interface language; or English, Português (Brasil), Español, Français, Deutsch, Italiano, 日本語, 中文, 한국어) sets the language of every chat reply (Oracle, Product Owner, Supervisor, Grill me), step summary, handoff note, decision log and generated document; **Issues** (English by default, same list) sets the language of issue titles and bodies, issue comments, PR/MR descriptions and review replies, and the commit messages agents write, with the headings the app writes itself (`## Tasks`, `Related:`, `Decision (owner):`) translated where the language has them. Each agent turn carries one Language line naming both; JSON keys and enum values, paths, branches, labels, `- [ ]` checkboxes, `#n` references and closing keywords (`Closes #n`) never change, and code comments follow the project. A change applies from each session's next turn. **Execution › Keep awake**: the switch of the Workflows screen (see Workflows), off by default: no sleep while runs, a roadmap or a queue have work to do. **Execution › Concurrent runs**: off by default (one run at a time); on, several workflows run at the same time up to a **maximum** (default 2), with an optional **maximum per project**; simulations count toward the limits only if you say so. **Machine profile** (#367): Concurrent runs shows one line sizing the runs from this machine ("This machine: 20 threads, 32 GB → up to 5 runs at once, 1 test worker per run": runs = min(threads ÷ 4, GB ÷ 6), between 1 and 6; the test workers are the machine's divided by the runs), with its state: **Auto** (the maximum and the **test workers per run** follow the machine), **Manual** (a value you typed wins, stays as it is on another machine; **back to auto** drops it) or **Unknown** (the machine could not be read: 2 runs, 2 workers). **Use these values** turns concurrent runs on with the machine's values. Every run gets its test workers as `MULTIAGENT_TEST_WORKERS` / `MULTIAGENT_E2E_WORKERS`. When the memory guard held or stopped runs on 2 or more days of the last 7, it suggests one run fewer, with the days and runs, and changes nothing until you click **Apply** (Undo in its toast). **Execution › Memory guard** (#276): on by default; a process a real run started (a test, a build, a script, a suite or a screenshot capture) that uses more than the **limit** (25% of the RAM by default, 5–90; the hint gives it in GB for this machine) is stopped with its children within seconds, and suites and new real runs wait while less than the **floor** of the memory is free (10% by default, 0–50, 0 = no hold); the agent CLI itself, the app and your other programs are never stopped. **Execution › Oracle › Self-healing** (#278): off by default; on, the Oracle watches every run and roadmap day and night, with no end time, and repairs what its permissions allow (**What it may do alone (3 of 10)** opens the Night watch's checklist, one list for both); it never answers a gate, pushes, closes an issue or deletes data, and the row is disabled with the reason while the Oracle cannot start in the workspace. A value out of its range is marked and not saved; turning it off applies to the runs started afterwards. Each run has its own git worktree, and the monthly budgets count every run in progress. The **Run** menu item then lists the runs in progress (status, workflow, project/issue): click one to show it on the Run screen; a badge counts the human gates waiting across runs, and a gate never pops up over another screen: a toast names its run |
| Oracle | The Oracle's one conversation for the whole app (see The Oracle below): docked on Home (its Overview tab), and a drawer on every other screen from the **Oracle** button at the top right of the header (#254, next to the notifications bell), whose badge counts the answers that arrived while it was closed. The Oracle, the Product Owner and the Supervisor also open in their own **Agents window** (#263: each drawer's **Open in a window** button, or Ctrl+Shift+A): a rail on the left with the three agents (an unread count, busy while one answers) and the selected one's conversation, the same as in its drawer; the window remembers its size and position and the last agent shown. Answers render Markdown and tables, with their time, model, cost and tokens; run ids, issues and run files open in the app; pasted screenshots are sent with the question; **Memory** edits its standing decisions and **New session** starts over from a handoff note. The footer shows today's spend against the daily budget (Settings › Execution); paused by budget or answering in another app process, the input is replaced by a notice. While it answers, the chat shows what it is doing (an activity line with a timer, its last steps), then the answer as it is written; **Stop** ends the turn and keeps what was written, marked Stopped (#180) |
| Setup | The first-run Setup (#319), a large modal that opens once per workspace after the workspace folder and the sign-in (Settings › Agents & CLIs › **Run setup again** reopens it): a stepper **Agents · Try it safely · Workflows · First project** with Back / Next / Skip (Enter = Next, Esc = Skip after a confirm). **Agents**: one row per CLI with its status (Ready / Not signed in / Not installed / Checking…), version, account and what it is for, and one action (**▶ Install** or **▶ Sign in**, run in the terminal dock; the row checks again when that terminal ends, and **Check again** checks them all). **Try it safely**: **Show simulation mode** (Developer mode, on by default here), and the machine profile's line (#367: how many runs at once and test workers per run this machine allows, set in Settings › Execution › Concurrent runs). **Workflows**: the bundled workflows by category with their requirement badges ("Needs Codex") and Ready / Missing state; the ready ones are picked, the others are hidden from Start and Home (`hiddenWorkflows` in `settings.json`). **First project**: the New project dialog; **Finish** opens Start on the first picked workflow. Finish or Skip records `setupDone` in `settings.json`, so it never opens by itself again; workspaces created before Setup existed count as set up. |
<!-- /generated:screens -->

The **Start** button at the top (next to Stop) opens the right side panel: pick the workflow,
the project (its folder becomes `repo_path`/`project_path`) and the input. During and after a
run, **Run** shows up at the bottom of the menu with the sessions and events.

**Pause after current step** (#368, next to Stop) holds a run without cutting any agent: the agents
at work finish their turns (every agent of a parallel step, and a build or suite command its run),
then the run ends **Paused**, its worktree, branch, outputs and sessions kept. While it waits the Run
screen says "Pausing: waiting for developer to finish its turn (develop)" with **Cancel pause**;
then "Paused at code_review, next: reviewer's turn" and when, with **Resume**, which continues there
(also after the app or a CLI was updated): no finished turn runs again, and the confirmation shows
what each agent's next turn re-reads (a cold cache with its extra cost). A run waiting at a gate
pauses at once and asks the same gate again on Resume. Only you resume a paused run: the Night watch,
the Oracle and the supervisor never do. A roadmap stage's ⋮ menu pauses all its runs the same way.
The roadmap bar's **Pause** (#391) is another pause: **Pause after this stage** (the default) lets
the current stage finish, then pauses before the next one ("Stage N done"); **Pause now** starts
nothing new and lets the runs in progress go on.

Each agent session shows its **Next turn** (#320; the run's session table in Projects › Runs and
Workflows › Runs, and a metric on the Run screen's session cards): "fresh from note" (it starts a
new session from its handoff note), "warm · 42 min left" (it resumes while its prompt cache lives),
"cold since 04:57 · ~337K tokens ≈ $X" (resuming writes its whole context to the cache again),
"new session", or "—" when the session is closed. The cache's lifetime is an estimate: one hour for
Claude on a subscription, five minutes on an API key, unknown for Codex and Grok. Every open gate
card says what **Continue** will re-read, one entry per agent ("Continue: developer fresh from note
~20K · reviewer resumes cold ~140K ≈ $0.70"), in the Run screen, the run chat and the phone page.
The bundled workflows set `fresh_after_idle: 55m`, so a persistent agent with a handoff note that
waited past the cache's lifetime starts fresh instead of resuming cold.

Running from source requires Node 24 LTS (`.nvmrc`; `engines` in package.json). The app runs on
Electron 44, which bundles Node 24 too. The packaged app needs no Node: what it starts outside its
own process (the supervisor's MCP server, the external live terminal, the control channel's
client) are the Rust binaries shipped in `resources/bin/` (`multiagent-mcp`, `multiagent-tail`,
`multiagent-ctl`). npm 11 only runs install scripts that are approved in `allowScripts`
(package.json): `node-pty` is approved; after upgrading it, run `npm approve-scripts node-pty`.

From the terminal (no UI):

```bash
npm test
```

Runs the unit tests (`test/`, node:test) and the full flow in mock mode. This is what CI runs.

`npm test` must pass on **Windows, Linux and macOS**, locally and in CI (`ci.yml` runs it on all
three). Tests must not depend on the machine:
- git: the worktree tests run with an empty global config and no system config
  (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`) and pass identity, `init.defaultBranch` and
  `core.autocrlf` with `-c`; match git messages that changed across versions loosely;
- paths: build them with `path.join` under `os.tmpdir()` (no hard-coded `C:/`, `/tmp` or
  separators) and compare them with `samePath`/`canonicalPath` (`packages/engine/engine/worktree.js`). The
  worktree tests deliberately pass non-canonical spellings: a symlink (a junction on Windows) and,
  on Windows, an 8.3 short name, since git prints canonical paths (macOS `/var` is
  `/private/var`; the GitHub Windows runner's temp folder is `C:\Users\RUNNER~1\...`);
- line endings: files may be checked out with CRLF (Windows `core.autocrlf`); do not compare raw
  file contents with `\n`-only literals.

```bash
npm run run -- --task "Task description" --repo C:/path/to/repo --input language=python --input git_platform=gl
```

Runs the workflow for real. `--file write-doc.yaml` picks another workflow: a name or relative path is
looked up in `<workspace>/workflows/` first, then in the repository's `workflows/`; an absolute path is
used as is (e.g. to try an edited repository copy while the workspace copy is modified). `--auto-approve`
approves every human gate without interaction (tests only: in practice the AI must not cross the gates).

### Engine server (HTTP + WebSocket)

```bash
npm run serve -- --port 7300 --host 127.0.0.1 --workspace C:/path/to/workspace
```

**The token is full control of this machine**: whoever has it opens a shell, approves human gates
and starts paid runs, as you would in the desktop app. Share it only with yourself.

`--host` is `127.0.0.1` by default; `tailscale` listens on this computer's Tailscale address only
(100.x.y.z), and the server then prints the addresses another computer can type. Any other address
(`0.0.0.0`, a LAN IP) serves plain HTTP to the network and is refused unless you add
`--insecure-http`: use it only behind a VPN or a reverse proxy with TLS.

Runs the engine without Electron and serves the same UI to a browser: open the printed
`http://…/?token=…` URL (shown once: clear it from the shell history and the scrollback if others
can read them), or open the server's address and type the token in its sign-in form (`POST /session`,
the token stays out of the address bar). The token (from `MULTIAGENT_SERVER_TOKEN`, else random) is
then kept in an HttpOnly, SameSite=Strict cookie for a week (`Secure` when the request came over
HTTPS, e.g. `X-Forwarded-Proto: https` from a TLS proxy); API clients send
`Authorization: Bearer <token>`. On `127.0.0.1` the server answers only requests whose `Host` is
`localhost`, `127.0.0.1` or `[::1]` (DNS rebinding), plus the names it allows: this computer's
MagicDNS name, read at start from `tailscale status --json`, and each `--allow-host <name>` (repeat
it for several names). They match exactly, with any port and in any case, never as a suffix. The
start banner lists them, or says that only the loopback names are answered (for example when
Tailscale is not running). A proxy in front must send one of these names as `Host`.

- API: `POST /api/<channel>` with `{ "arg": … }` → `{ "result": … }` or `{ "error": … }`. The channels are the
  desktop app's IPC channels (`projects:list`, `run:start`, `artifacts:read`, `auth:state`, …).
- `GET /ws` (WebSocket): the server pushes `{ "channel", "payload" }` for `run:event`, `term:data`,
  `term:exit` and `auth:changed`; the client sends `term:input` / `term:resize` the same way.
- Requests from another origin are refused. Beyond `127.0.0.1` the traffic is plain HTTP: put the
  server behind a reverse proxy with TLS.
- The server asks for the same account as the app (sign in from the browser UI; the sign-in page
  opens on the server machine). `MULTIAGENT_AUTH=off` disables it in development.

### The app on one computer, the engine on another

The desktop app can be only a window: the engine (runs, CLIs, terminals, the workspace) runs on
another computer of yours with `npm run serve`, and the app shows it. The simple setup is both
computers on the same [Tailscale](https://tailscale.com) tailnet.

On the computer that runs the engine (a source checkout), in PowerShell:

```powershell
$env:MULTIAGENT_SERVER_TOKEN = "<a long random secret, at least 16 characters>"
$env:MULTIAGENT_AUTH = "off"
npm run serve -- --host tailscale --port 7300
```

Close the desktop app on that computer first: like the app, the server locks its workspace (one
engine per workspace) and refuses to start on a workspace the app has open (or pass
`--workspace <another folder>`). Keep `MULTIAGENT_SERVER_TOKEN` the same: the app saves the token,
and without the variable the server makes a new one at every start. `--host tailscale` keeps the engine off the local network;
`--host 0.0.0.0 --insecure-http` listens everywhere over plain HTTP (only behind a VPN or a TLS proxy).

On the computer with the app: **Settings › Execution › Engine › Change…**, choose **Remote engine**,
type the address (the machine's MagicDNS name such as `my-pc.tailnet.ts.net`, its `100.x.y.z`
address, `host:port`, or a full `http(s)://` URL; port 7300 by default; pasting the `…/?token=…` URL
the server printed fills both fields) and the token, then **Test connection** (the engine's version
and interface, or why not: unreachable, refused token, not an engine) and **Test, save and restart**.
The app restarts as a window onto that engine, named in its title bar: it runs no engine of its
own, opens no workspace and starts nothing that needs one (workspace lock, Night watch, phone
gates, Keep awake, the control channel). The setting is per computer, in the app's own data folder
with the token encrypted by the OS, never in the workspace. A computer that offers no encryption
(Linux without a keyring) stores it as plain text, and the connection page says so.

- When the engine cannot be reached at start (or the window is reloaded while it is down), or it
  refuses the token, the app shows the connection page with the reason: **Retry**, **Change the
  address** or **Use this computer**.
- Back to this computer: Settings › Execution › Engine › Change… › **This computer** (the address
  and token stay saved for later). `MULTIAGENT_ENGINE=local` forces this computer for one start.
- On the engine's computer, not in the window: the CLIs and their sign-ins, the terminals (shown
  in the window, running there), files and folders (type that computer's paths: the folder picker is
  not available), desktop notifications, Keep awake, the control channel, the ↗ external terminal
  and the microphone.
- **Language**: while Settings › General › Language › Interface is unset, the window shows its own
  computer's language, but the AI agents ("Same as the interface") follow the engine's computer's
  language, where they run. To make them agree, choose Interface or AI agents there.
- **Sign-in**: a remote app cannot sign the server in yet (the provider's page would open on the
  engine's computer), so the server runs with `MULTIAGENT_AUTH=off`; the account only counts users.
- Plain HTTP over Tailscale is encrypted by WireGuard. For HTTPS, leave `npm run serve` on
  `127.0.0.1` and put `tailscale serve` in front of it on that computer:

  ```powershell
  npm run serve -- --host 127.0.0.1 --port 7300 --allow-host <machine>.<tailnet>.ts.net
  tailscale serve --bg 7300
  ```

  Then type `https://<machine>.<tailnet>.ts.net` in the app or the browser
  (`tailscale serve --bg --https=8443 7300` serves it on `:8443`). `tailscale serve` forwards that
  name as `Host`; the server allows its own MagicDNS name when Tailscale is running at start, and
  `--allow-host` keeps it allowed when it is not. Check the start banner: `Also answers (tailscale
  serve): …` must list the name. `tailscale serve` proxies only to loopback: pointed at this
  computer's own Tailscale address (`http://100.x.y.z:7300`, a server on `--host tailscale`) it
  answers 502.
- Any other plain `http://` address (a LAN IP such as `192.168.1.10`, a server on `0.0.0.0`) is not
  encrypted: the token and every page could be read or replaced on the network. Saving it needs
  **Allow an insecure connection**, and the connection page warns about it every time it shows it.
  The app sends the token in an `Authorization` header, never in the address, and lets the engine's
  page read the clipboard only over https (writing to it works on http too).
- Desktop-only actions (native folder picker, opening files in their app, external console
  windows, changing the workspace) are not available in the browser; folder paths are typed.
  **Keep awake** is disabled there ("Not available in the browser client"): only the desktop app
  keeps the computer from sleeping.

Local build: `npm run build` (writes `build/`) or `npm run package` (writes `dist/`, used by the deploy).
Both build for the current machine; `npm run package -- --platform darwin|linux|win32 --arch arm64|x64`
picks another target (the macOS signature step needs a Mac).

## Install

Download the file for your system from the latest
[GitHub Release](https://github.com/eduardogalbiati/multiagent-orchestrator/releases/latest). The
builds are not signed yet, so each system warns once before the first start.

- **Windows** (x64): `MultiagentOrchestrator-win32-x64.zip`. Unzip it anywhere and run
  `MultiagentOrchestrator.exe`. If SmartScreen says "Windows protected your PC", click **More info**,
  then **Run anyway**.
- **macOS** (Apple Silicon: `MultiagentOrchestrator-darwin-arm64.zip`; Intel:
  `MultiagentOrchestrator-darwin-x64.zip`). Unzip it and move `MultiagentOrchestrator.app` to
  Applications. The app is not notarized, so the first start is blocked: open it once, then
  **System Settings › Privacy & Security**, and click **Open Anyway** next to the message about
  the app (or, in Terminal: `xattr -dr com.apple.quarantine /Applications/MultiagentOrchestrator.app`).
  Voice input asks for the microphone the first time you use it.
- **Linux** (x64): `MultiagentOrchestrator-linux-x64.AppImage`. Make it executable and run it:
  `chmod +x MultiagentOrchestrator-linux-x64.AppImage && ./MultiagentOrchestrator-linux-x64.AppImage`
  (if it does not start because FUSE is missing, run it with `--appimage-extract-and-run`). On systems that forbid unprivileged user namespaces (Ubuntu 23.10
  and later, the AppArmor default) the AppImage can only start with Chromium's sandbox off: it says
  so on stderr and in **Settings › About**. Without the sandbox, a compromised page of the app is a
  compromise of the whole app process. To keep the sandbox on, allow unprivileged user namespaces:
  `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0` (for every start: a file in
  `/etc/sysctl.d/` with `kernel.apparmor_restrict_unprivileged_userns=0`). That is your choice, with
  its trade-off: it applies to the whole system, so every program may create user namespaces again,
  a kernel attack surface Ubuntu closed on purpose. `MultiagentOrchestrator-linux-x64.tar.gz`
  is the same app as a folder: run `./MultiagentOrchestrator` inside it; if it stops with "The SUID
  sandbox helper binary was found, but is not configured correctly", give the sandbox helper its
  rights once: `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`.

**Check the download.** Every release has a `SHA256SUMS` file (one line per package: its SHA-256,
then its name), the same sums in its notes, and `SHA256SUMS.sigstore.json`, a signature that ties
`SHA256SUMS` to this repository's Deploy workflow. Download them next to your package, compute the
hash of the package and compare it with its line in `SHA256SUMS` (or in the release notes):

- **Windows** (PowerShell): `Get-FileHash -Algorithm SHA256 MultiagentOrchestrator-win32-x64.zip`.
- **macOS**: `shasum -a 256 MultiagentOrchestrator-darwin-arm64.zip` (or `shasum -a 256 --ignore-missing -c SHA256SUMS`).
- **Linux**: `sha256sum MultiagentOrchestrator-linux-x64.AppImage` (or `sha256sum --ignore-missing -c SHA256SUMS`).

Then check that `SHA256SUMS` itself comes from this repository, with
[cosign](https://docs.sigstore.dev/cosign/system_config/installation/) (any system):

```
cosign verify-blob SHA256SUMS --bundle SHA256SUMS.sigstore.json \
  --certificate-identity-regexp '^https://github.com/eduardogalbiati/multiagent-orchestrator/.github/workflows/deploy.yml@refs/(tags/v.+|heads/main)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

It prints `Verified OK`. A different hash or a failed check means the file is not the one the
release published: do not run it. This checks the download, not the app: the packages themselves
are still not code-signed.

**Sizing.** Each run in progress takes about 4 threads and 6 GB of RAM (its agent CLI, its tests,
its tooling). The app reads this machine at start and proposes how many runs at once (1 to 6) and
how many test workers per run (Settings › Execution › Concurrent runs, also shown in the Setup); a
value you set by hand always wins.

The CLIs the workflows use are installed separately: see
[Installing the CLIs on Windows](#installing-the-clis-on-windows) and its macOS and Linux part.

**App icon.** `apps/desktop/assets/icon.ico` (Windows), `apps/desktop/assets/icon.icns` (macOS) and `apps/desktop/assets/icon.png` (Linux)
are generated from one source image, `apps/desktop/assets/icon-source.png` (its origin and license are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). To replace the icon, put a square PNG of 1024 px or more at `apps/desktop/assets/icon-source.png` (or pass its path)
and run `npm run icons`, then commit the four files.

## Account and privacy

The app is free and open source. **Sign-in is off for now** (`enabled: false` in
`packages/engine/domains/account/auth-config.js`): the app opens without an account and records nothing.
The rest of this section describes the app with sign-in on.

With sign-in on, the packaged app asks you to sign in (Google, in the system
browser) once: the account gates nothing, it only tells us how many people use the app. A signed-in
app records its visit at every start and then at most once a day (best effort: a failure is never
shown and never blocks anything; an offline start with a stored session stays signed in).

- **Stored**: your email and name from the sign-in provider, the sign-up date, the last seen date,
  the app version and the OS.
- **Not stored**: your code, prompts, runs, artifacts or usage. Nothing of your work leaves your
  machine through the account.
- **Retention and deletion**: the account row is kept until you ask for it to be deleted. Open an
  issue or write to the maintainer from the account's email, and the row (and its sign-in identity)
  is deleted; nothing else about you is kept.
- **Forks**: the Supabase URL and publishable key are built into `packages/engine/domains/account/auth-config.js`, so a fork that
  ships its own build must use its own Supabase project (replace both constants and apply
  `supabase/migrations/`), or it reports its users to this project.

**What a repository controls**: a project you clone or a PR branch you run can ship `CLAUDE.md` /
`AGENTS.md` and a `.claude/` folder. Agents read the instructions files (they can try to steer an
agent, which still has only its workflow's tools), but isolated agents never load the checkout's
`.claude/settings*.json` (hooks, permission rules), and the app never marks `repos/`, `worktrees/` or
your project folders as trusted for the CLIs. Agents, the project's tests and the terminals get an
allowlisted environment: cloud keys, API keys and the SSH agent stay out; GitHub/GitLab tokens reach
only agents allowed to run `gh`/`glab`. A workflow lists any other variable its tests need in
`env: { passthrough: [...] }`.

Running from source, `MULTIAGENT_AUTH=off` skips the sign-in (development, tests, screenshots, the
local preview and `npm run serve`). An app showing a remote engine (Settings › Execution › Engine)
cannot sign that engine's server in yet: the server runs with `MULTIAGENT_AUTH=off`. The account's database is defined in `supabase/migrations/`.

## Workflows, skills and seeds are code

Workflows, skills and seeds are code: install only ones you trust. A workflow runs shell commands
(transition `action:`, `ship.build`) and its templates run in the app's process; a skill or a seed
tells agents that have tools what to do. The app refuses the template tricks it knows at load time
(a template reaching `constructor`, `__proto__`, `require` or `process`, agent output put unquoted
into a shell command; `npm run check` reports them too), and the Builder asks once before saving a
workflow that was not bundled with the app (again when its file changed outside the app).

## Security model

What the app limits, and what it does not. Read it before you run a repository you did not write;
how to report a vulnerability is in [SECURITY.md](SECURITY.md).

- **Agents run as you.** An agent turn is a headless CLI (`claude -p`, `codex exec`, `grok`) started
  with your user, your environment, your credentials and your network; the allowlisted environment
  (see "Account and privacy") keeps cloud keys, API keys and the SSH agent out, nothing more.
- **The engine shapes what the CLI offers the model; only Codex's sandbox is enforced by the OS.**
  For Claude (`acceptEdits` and `--allowedTools`) and Grok (`--always-approve`) the tool limits are
  prefix rules: `bash:git` becomes `Bash(git:*)`, and an allowed program steps around it
  (`git -c alias.x='!cmd' x`, `npm exec` / `npm run <script>`, `node -e`, a `cargo` build script, a
  `cat` of any file). A read-only agent is a convention, not a sandbox.
- **The repository can add instructions.** `CLAUDE.md`, `AGENTS.md`, the README, the issues and the
  PR comments an agent reads can try to steer it, with the tools its workflow gives it. Isolated
  agents never load the checkout's `.claude/settings*.json`, but treat a repository's hooks as code
  that may run until #468 is closed.
- **Workflows, skills and seeds are code**: a workflow runs shell commands and templates in the
  app's process, a skill or a seed tells agents with tools what to do. In short, workflows, skills
  and seeds are code: install only ones you trust.
- **The serve token is full control of the machine** (`npm run serve`): a shell, gate approval and
  paid runs. Keep it like a password.
- **The control endpoint file is readable by agents.** `<workspace>/control/endpoint.json` holds the
  token of the loopback control channel; the agents run as you and can read it. Its allowlist
  (`packages/engine/control/allowlist.js`) never resolves a human gate and never changes settings.

Recommendation: run untrusted repositories only in a VM, a container or with Codex's sandbox
(`workspace-write`), and assume every secret in the agents' environment is readable by them (see
#470 for what is filtered).

<!-- generated:workflows -->
## Feature (`workflows/feature.yaml`)

Code & Build (#630, #631). The development workflow: one issue (or several in one branch) from the
acceptance tests to the merge. It replaces `software-development`, its two local heroes and
`multi-model-review`: those old names still run, as `feature.yaml` with the inputs of the old
variant (`packages/shared/default-workflow.js`, `ALIASES`).

acceptance tests → red check → Warm Up → develop → code review → suite → build → evidence → verify → merge

| Stage | Agent | What it does | Skills |
|---|---|---|---|
| Acceptance tests | Test Writer (Opus 5.5) | The issue's tests from its criteria, not from the implementation, on the run's branch; with `test_order: e2e_first`, its E2E scenarios too. It gets the project's code → tests map (`test_map: true`). A task with nothing testable goes straight to develop | `unit-test-writer-<language>`, `e2e-test-writer-<language>` |
| Red check | (no agent) | Runs exactly those files once (`expect: red`). A test already green is reported to the developer; a file that cannot run goes back to the test writer once. The existing tests related to them come from the code → tests graph | |
| Warm Up | Mapper (the developer's model) | Before the first develop turn only, maps per issue the files and lines to change, the conventions and the tests to run (#301, #304); a failed Warm Up goes on without a map | `code-mapping` |
| Develop | Developer (Opus 5.5 or Fable 5.1) | Implements until the acceptance tests pass; the engine refuses a turn that changes one (`protect_files`), while the developer may add its own internal tests | `long-commands`, `bug-diagnosis`, `merge-conflict-resolver`, `context-economy`, `decision-log` |
| Code review | Code Review (Opus 5.5) | The diff on correctness, spec, standards and reuse; with `review: multi_model`, a second independent reviewer on another model in parallel | `code-review` |
| Suite | (no agent) | `scope: affected`: the test files the change reaches each round, then the whole suite once when they pass | |
| Build, evidence, verify | Builder, Evidence, Verifier | Build and dependency audit; what shows the change working (screenshots, requests, CLI output); the claims proven on the base and on the branch | `build-audit-<language>`, `implementation-evidence`, `claim-verification` |

The inputs that choose the run:
- `mode`: `local` (default) merges the run's branch into the local `base_branch` and pushes it (push
  main); `remote` pushes the branch, opens a PR/MR and waits for its CI (`git_platform`: `gh` or `gl`);
  the team merges it on the platform.
- `validation`: `auto` (default) goes from the developer straight to the review; `validated` stops at
  `developer_check` so you try the change first (an old `mode: auto | validated` still means this).
- `test_order`: `e2e_first` (default) writes the issue's E2E scenarios with the acceptance tests;
  `code_first` writes unit tests only.
- `review`: `single` (default) or `multi_model` (what `multi-model-review.yaml` did).
- `retrospective` (#631, off by default): when the run ends, `retrospective.yaml` analyses it (what the
  old `develop-to-retrospective` pipeline did; one more model call).
- `language`: `js`, `python`, `go`, `java`, `csharp` or `rust`, or several, main one first (#340);
  `developer_model` and `developer_effort` (#286); `unit_tests` and `e2e_tests` (#203).

Local mode:

<!-- generated:local-hero -->
- Each run still gets its own git worktree, started from your **local** `base_branch` (nothing is fetched, so a run sees the local merges of earlier runs you haven't pushed).
- **No merge approval**: once `verify_change` passes, the engine merges the run's branch into the local `base_branch` automatically: rebased onto it first if it moved (another run merged meanwhile), fast-forward only (linear history). The run's worktree and branch are then removed.
- **Conflicts are resolved automatically**: a failed merge goes to `resolve_merge`, where the developer rebases onto the local base and resolves the conflicts (skill `merge-conflict-resolver`). Then only what the resolution changed is checked again: the review covers the rebase against the last approved commit (`git range-diff`), the tests are the ones related to the files the resolution touched plus a smoke check (the full suite when it touched more than 5 files), the build runs, the verifier re-checks only the claims whose files were touched, and the merge is attempted right after. A resolution that changes behaviour (`behaviour_changed: true`) goes through the full review, suite and verification. Merges of concurrent runs go one at a time. At most 3 rounds; what the developer can't fix stops at the `merge_blocked` gate (retry / stop).
- **Merge conflicts in test files** (#380): a protected test file that only combines both sides is accepted; a test conflict that needs new or changed test lines is handed to the test writer, then the developer finishes the rebase.
- **E2E scenarios** (#143): the test writer writes end-to-end BDD scenarios only when the issue has user-visible behaviour, at most 3 per issue, and runs only the run's ones by their issue tag (`@issue-<n>`); the full E2E suite belongs to the release workflow.
- **Tests on or off** (#203): the same `unit_tests` / `e2e_tests` inputs and the same `suite` step (the orchestrator runs the whole suite once per round, #177) in both modes. With unit tests off nothing is reported as tested: `verify_failed` and the verifier say so, and the run's Details show it.
- **Suite red outside the change** (#396, input `suite_red_outside_change`): *Ask* (default) = a red suite opens `test_failed` as before; *Continue* = a suite whose failures are all outside the change goes on to the build and the merge, the run marked **Not tested green** (Run screen, chat, `summary.json` `tested`). A failure in the change still opens the gate.
- **Validation**: the input `validation: auto | validated` (the old `mode: auto | validated`, #630). In `auto` nothing waits for you (the run merges locally by itself); in `validated` the run stops at `developer_check` after the developer so you try the change (Run locally, Open the worktree) and approve it or ask for changes before the review and the tests. `human_review` offers Run locally too.
- **Context limit**: `orchestrator.limits.max_total_context: 20M`. Past 20M tokens of context the run pauses before its next agent turn; choose **Continue** (another 20M) or **Stop**.
- **Issues close when you push**: commits end with `Closes #<n>` for the run's issues, so GitHub closes them when you push the base branch. Until then the Backlog shows them in **Merged locally** (a "not pushed" badge), not in Done: Done means closed on GitHub/GitLab.
- **Push from the Backlog**: when the project's local base has commits that `origin/<base>` hasn't (checked with a fetch on every Backlog sync and after every local merge), a bar above the issues says how many and which issues they close. **Push…** lists the commits, then runs `git push origin <base>` in the project's repository (the clone under `<workspace>/repos/`, not your own checkout): never forced, never another branch. The Backlog syncs afterwards, so the closed issues move to Done. The sidebar's Backlog item and the project's page show the count of commits not pushed; the run's chat and its notification say "merged locally, not pushed yet".
- **When `origin` moved** (a PR merged meanwhile), the push is rejected: **Update and push** runs `git pull --rebase origin <base>` where the base is checked out (a temporary worktree when it is checked out nowhere), then pushes. A conflict undoes the update (the local base keeps every local commit), lists the files, and offers **Resolve in a run**: a run of the local workflow whose developer merges `origin/<base>` into the local commits and resolves the conflict; after review, tests and the local merge, **Push** goes through as a fast-forward. The run calls the agents' CLIs (real cost) unless simulated.
- **Auto-push** (per project, off by default): the checkbox on the Backlog's bar pushes the base after every successful local merge; a rejected push only notifies you.
- Or push yourself: `git push origin main` from the repository.
<!-- /generated:local-hero -->

Engine options behind it: `orchestrator.worktree.remote: false`, a transition with `merge: local` and `on_error`, and `orchestrator.limits.max_total_context` (see `docs/agents/worktrees.md` and `docs/agents/engine.md`).

Human gates: `developer_check` in validated mode, a doubtful PR/MR comment in remote mode, and the
gates a run cannot get past alone (`merge_blocked`, `verify_failed`, `check_failed`). Agents never talk
to each other: the orchestrator (engine) hands failures to the developer and returns the result to
the agent that asked.

**Modes: automatic or validated** (input `mode`, in the Start drawer next to the task, the
Backlog's **Assign to a workflow** dialog and the Workflows screen; remembered per workflow and
shown in the run's Details). `auto` (default) goes from the developer straight to the review, as
above. `validated` stops right after the developer at the `developer_check` gate, before any review
or test token is spent: its message has the developer's summary, the issues (done / not done), the
files changed, the commits on the branch, the diff command, the `test_notes` and `evidence_plan`,
and the worktree path and branch. On a wide window the gate has two columns: on the left a short
list (the summary and one line per issue: done / not done, the full message expandable), the
tools and the choices; on the right the run's **Artifacts** so far, newest first (handoff notes,
`decisions.tsv`, documents, screenshots), the **changed files** (each opens its diff) and the
developer's test notes and evidence plan, each previewed in place. Try it (**Run App**, **Open
the worktree**, **Terminal there**), then:
- **Approve**: on to `code_review`;
- **Ask for changes** (needs a text): the developer gets it as your change request, fixes it on the
  same branch with a new commit, answers each point, and the run comes back to `developer_check`.
  No automatic limit: you decide when to stop;
- **Stop**: ends the run (`cancelled`); its branch keeps the work to resume it.

Only the first implementation and your own change requests stop there; the reviewer's, the tests',
the build's and the verifier's fix rounds go on without it, unless **Validate every round** is on (`validate_every_round: true`, a switch shown under Validated).
It is a human gate: no timeout, no supervisor, no retry ever answers it. The time a run waits for
you at its gates is recorded apart from agent time (`summary.timing.gate_wait_ms`, the Details
panel and the Time tooltip).

**Answering gates from the phone** (#226, Settings › Phone gates). The running app can serve a
small page with only the open gates (each gate's summary, recommendation, evidence links and
buttons) on `http://127.0.0.1:7400`, this computer only; nothing else of the app (runs control,
files, terminals, settings, the API) is reachable there. To use it:

1. Settings › Phone gates › **Pair a phone**: scan the QR code with the phone (or open the page
   and type the one-time code, valid 10 minutes). The phone keeps a device token; **Revoke** it
   there at any time.
2. Reach the page privately from outside: [Tailscale](https://tailscale.com) on the computer and
   the phone, then `tailscale serve --bg 7400` (only your devices reach the https address it
   prints), or a named Cloudflare Tunnel to `http://127.0.0.1:7400` behind a Cloudflare Access
   policy that allows only your email. Never a public address without access rules. Paste the
   address in **Address from outside** and press **Check** to see whether it answers.
3. A gate's notification carries the link to that gate's page: signed for that gate only, valid
   30 minutes. Every answer asks you to confirm, showing what the button does ("Merges the branch
   into main"), and is recorded as yours from the phone (`answered_by: owner`, `via: mobile`, the
   device and the time on the gate's `approval.resolved` event).

An agent, a script or the supervisor never answers a gate there: an answer needs a paired device,
the gate's link and your confirmation.

The phone page follows the workspace's **Interface** language in Settings, with English as the
fallback. Reload an open page after changing the language. Gate messages, button meanings and your
notes keep their original text. The pairing code and note fields have labels, status changes are
announced to screen readers, and the page supports keyboard navigation and narrow phone screens.

The gate starts with its short summary, recommendation and the action needed from you. **Full
details** keeps the complete message available without putting a long report above the choices.
The confirmation repeats this context and its evidence links. When your choice differs from the
recommendation, it says so beside the confirmation; the decision is still yours.

If the connection fails while reading the list, **Try again** reads it again without removing the
pairing. A pairing that is no longer valid asks for a new code; an expired or invalid gate link
offers the list so you can open a fresh link. An answered gate says it is no longer waiting.

If the connection fails after you confirm an answer, its result may be unknown: the app might
already have received it. **Check gate status** only reads the gate; it never resends the answer.
If the gate is still open, choose and confirm again yourself. If it has ended, the page says so
without claiming which answer ended it. There is no offline queue or automatic retry of answers.

**Tests: on or off, per workflow and per run** (#203; inputs `unit_tests` and `e2e_tests`, shown
like `mode` in the Start drawer, the roadmap item's Edit form and the Backlog's Assign dialog, with
the workflow's default). The test step is the largest cost of a run (about half of it), so:
- `unit_tests`: **Write and run** (default) = the test writer writes the change's tests and runs the
  focused ones, then the orchestrator runs the whole suite; **Run existing** = no test writer for
  unit tests, the suite runs once without an agent and its failures go to the developer; **Off** =
  no suite at all.
- `e2e_tests`: **Write** (default) = the issue's BDD scenarios are written and checked to parse (run
  at release by `e2e-release`); **Write and run** = also run here (slow: it starts the app);
  **Off** = none.
- Both off: the run goes from the code review straight to the build (no test step); the build,
  the evidence, the verification and the merge always run. Nothing off is reported as tested: the
  run's Details show a badge per input ("Unit tests: Off", the source on hover: workflow default or
  chosen for this run), and the gates and the verifier get the same sentence. To test later, all
  together: the `test-backfill` workflow.
- Your own defaults: change `default:` of these inputs in the workspace copy of the workflow. A
  copy changed only in its inputs' defaults still gets the app's new versions (your values kept).

**The orchestrator runs the suite, not an agent** (#177): after the test writer's turn, the `suite`
step (no agent) runs the project's whole test suite once (`test_command`, else found from the
project's files: `npm test`, `go test ./...`, `mvn test`, `dotnet test`, `pytest`…), saves the output
in the run's `logs/suite-<round>.log` and gives the test writer only the failing tests (name, file,
first lines of the error) and the log's path: at most 2 rounds, then the `test_failed` gate. Tests
that also fail on the base (the test writer's pre-existing failures) are reported, never chased.
The test writer runs only focused tests; a whole-suite command it starts anyway is noted in the
run as a warning. The summary counts the suite runs (`suite_runs: { engine, agents }`).
A round cut by its timeout is checked like a failure (#396): each test file still running reruns
alone on the branch and, when it hangs there too, alone on the base (each with its own timeout, at
least 2 min); a file that passes alone, or hangs or fails on the base too, is reported outside the
change instead of failing "the whole suite".

**Control channel for outside sessions** (#336, Settings › Execution › *Allow outside sessions to
control this app*, off by default). A terminal or another agent on this computer (a Claude Code
session working as Oracle or Product Owner on the workspace) drives the running app through the
same channels its screens use, instead of editing workspace files: an action takes effect at once
(a `roadmap:start` dispatches like the Roadmap screen's button) and an edit merges with an open
form on the screen (#287). When the switch is on, the app listens on `127.0.0.1` only, on a free
port, and writes `<workspace>/control/endpoint.json` (`{ "url", "token" }`, a new token on every
start); off, or the app quitting, closes the port and deletes the file. The setting shows the port
and the file's path.

- Only an allowlist of channels answers (`packages/engine/control/allowlist.js`): reading runs, events,
  roadmaps, the backlog and settings (`runs:list`, `runs:active`, `runs:events`, `roadmap:get`,
  `roadmap:versions`, `backlog:get`, `settings:get`, `projects:list`, `workflows:list`) and the
  roadmap actions (`roadmap:save`, `roadmap:pause`, `roadmap:cancel-pause`, `roadmap:start`,
  `roadmap:item`, `roadmap:undo`). Anything else gets `403` naming the channel; a missing or wrong token gets
  `401`; a request from a web page (another origin) gets `403`.
- What the operation sessions need (#399):
  - `roadmap:pause-stage` (#368, *Pause after current step*) and `roadmap:park-stage` (#395, *Move on
    from this stage*) act as on the screen: the same refusals (nothing of the stage running; Move on
    while an item runs an agent turn), a line in the roadmap history and an `edit` in the answer for
    `roadmap:undo`. A stage pause is resumed with `roadmap:start`.
  - `runs:resume` `{ runId, step }` resumes a run as the Resume dialog does; `runs:resumeOptions`
    `{ runId }` lists the steps it offers. A resume that would go past a gate the previous run decided
    gets the dialog's refusal. A real (non-mock) `runs:resume` costs the owner's money, like
    `roadmap:start`; it is refused under `MULTIAGENT_SIMULATION_ONLY`.
  - `workflows:restore` puts a workspace copy back to its bundled default, the old copy to the trash.
    Through this channel it is refused, naming the steps, when the copy has a `human_approval` step its
    default lacks (the app's Restore button still restores it).
  - Reads for watching: `notifications:list`, `gates:interrupted`, `nightwatch:state`,
    `nightwatch:report`, `usage:get` (any scope, `machine` included: computed off the main process, #389).
- **Human gates stay closed**: no gate channel is reachable (`approval:resolve`, `gate:*`,
  `phonegates:*`), any argument `confirmGate` is refused, and settings are read-only from outside.
- Left out on purpose: `run:stop` (at a gate, stopping the run is one of the gate's answers);
  `nightwatch:permissions`, `nightwatch:limits`, `oracle:act` and `oracle:nightWatch` (they change what
  automation may do on its own); `settings:set` (it could turn gates or this channel off).
- Every call is appended to `<workspace>/control/calls.jsonl` (time, channel, a short summary of
  the arguments, the status, the result's summary or the error).
- The endpoint is part of the running app: nothing here opens a second engine on the workspace (#112).

Calling a channel (`POST /api/<channel>`, body `{ "arg": ... }`, answer `{ "result": ... }` or
`{ "error": "..." }`). With the client shipped next to the app, `multiagent-ctl` (#342, no Node
needed; Settings › Execution shows its path to copy while the switch is on: `resources/bin/` in
the installed app). It reads `endpoint.json` from `MULTIAGENT_WORKSPACE` or `--workspace <dir>`,
checks the app's contract version (`GET /api/version`) and prints the result as JSON:

```
multiagent-ctl roadmap:get "{\"projectId\":\"my-app\"}" --workspace C:/Users/me/multiagent-workspace
multiagent-ctl --list
```

`multiagent-ctl --list` prints the allowed channels with their argument schemas (`GET /api/channels`).
Exit codes: `0` the result printed, `1` a refused or failed call (the reason on stderr), `2` no
endpoint (the switch is off), `3` the app speaks another contract version (use the client shipped
with that app). In a development checkout, `scripts/ctl.js` does the same under Node.

With `curl` (the URL and the token from `control/endpoint.json`):

```
curl -s -X POST http://127.0.0.1:<port>/api/roadmap:pause -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"arg\":{\"projectId\":\"my-app\"}}"
```

With PowerShell, which works with the packaged app too:

```
$ep = Get-Content "$env:USERPROFILE\multiagent-workspace\control\endpoint.json" | ConvertFrom-Json
Invoke-RestMethod -Method Post -Uri "$($ep.url)/api/roadmap:start" -Headers @{ Authorization = "Bearer $($ep.token)" } -ContentType 'application/json' -Body (@{ arg = @{ projectId = 'my-app' } } | ConvertTo-Json -Depth 10)
```

The `tools/roadmap` scripts, as channel calls. An edit is `roadmap:get`, then `roadmap:save` with
the changed `stages` (`[{ id?, name, note, items: [{ id?, workflow, issues: [{ number }], mock }] }]`,
keep the ids of what stays), a `label` saying what it did, and `base` (the `updatedAt` read): no
backup to write first, every edit is kept as a version (`roadmap:versions`) and the last one can be
taken back with `roadmap:undo` (`{ projectId, editId }` from the save's answer).

| `tools/roadmap` | Channel calls |
|---|---|
| `pause` | `roadmap:pause` `{ projectId }` (`stop: true`: back to a plan; #391 `after: 'stage'`: the current stage finishes first, `roadmap:cancel-pause` takes it back; nothing passed or `'now'`: at once) |
| `resume` | `roadmap:start` `{ projectId }`: dispatches at once |
| `new-stage` | `roadmap:get`, then `roadmap:save` with a new stage `{ name, items: [] }` appended to `stages` |
| `new-stage-at` | `roadmap:get`, then `roadmap:save` with the new stage inserted at its index |
| `add-to-stage` | `roadmap:get`, then `roadmap:save` with the issue added to an item's `issues` or as a new item of that stage |
| `append-issue` | `roadmap:get`, then `roadmap:save` with a new item `{ workflow, issues: [{ number }] }` in the last stage |
| `swap` | `roadmap:get`, then `roadmap:save` with the two stages (or items) exchanged in `stages` |
| `add-task` | `roadmap:get`, then `roadmap:save` with a new item for the task's issue (a local task is created in the Backlog first: `backlog:get` lists it) |
| `restore-stage` | `roadmap:undo` for the last edit; an older stage: `roadmap:versions`, then `roadmap:save` with that stage put back |
| `move-stage-after` | `roadmap:get`, then `roadmap:save` with the stage moved after the other one |

A retry or a skip of the item that paused a roadmap: `roadmap:item` `{ projectId, itemId, action: "retry" | "skip" }`.

**Run App at a gate.** `developer_check`, `human_review` and `approve_merge` (any gate with
`local_preview: true`) always offer **Run App** (its label says what it runs, e.g. "Run App: npm
start"). It uses the project's Local preview (Projects › Edit › Local preview), else the
workflow's:

```yaml
orchestrator:
  local_preview:
    install: "npm ci"      # only when dependencies are missing or the lockfile changed
    command: "npm start"   # or "npm run dev"
    url: null              # or "http://localhost:5173" (a link at the gate; a busy port is reported)
```

It runs in the run's worktree in an embedded terminal (the dock, labelled with the run's issues),
with **■ Stop**, and stops by itself when the gate is answered or the run ends. It never answers the
gate. The copy runs in simulation only (`MULTIAGENT_SIMULATION_ONLY=1`) on a scratch workspace
(`<workspace>/local-previews/<run>/`: a copy of your projects, agents, skills, workflows and
settings, never your runs) with its own user-data folder, so trying this app can't spend on real
models or touch your workspace; **real workspace** (with a warning) points it at yours instead.
"Local preview started/stopped" is recorded in the run's history and chat. The gate shows the
app's state (running / stopped / failed, with the busy-port message), **Terminal** to show or hide
its terminal and **Open URL** when a URL is set.

Which command runs, first match wins: the project's Local preview (Projects › Edit) > the
repository's `.multiagent/local-preview.yaml` > the workflow's `orchestrator.local_preview` >
detection. A repository declares how it runs once, committed, and everyone gets one-click Run App:

```yaml
# .multiagent/local-preview.yaml
install: npm ci          # optional
command: npm run dev
url: http://localhost:5173   # optional
cwd: apps/web            # optional: a monorepo's app
env:                     # optional
  API_URL: http://localhost:8080
```

Running a repository's command is code execution on your machine, so Run App asks once per
project, in one click: a small popover over the gate, "Run with `npm ci` + `npm start` (from
package.json)? **Run** · **Edit**". A declared command that changes (the file edited) asks again;
your own Local preview never asks. With nothing declared, it detects: package.json's `start`/`dev`
script (`npm ci` / `yarn` / `pnpm` per lockfile, a framework URL), a monorepo's apps (workspaces or
several package.json: pick one, stored as `cwd`), Docker Compose (`docker compose up`, the first
published port), a dev container's `postStartCommand` (forwarded port), a Procfile's `web:`, a
Makefile `run`/`dev`/`start` target, the README's run command, Django, Go, Rust or .NET; each
suggestion says where it came from. **Run** saves a detected command as the project's Local preview;
**Edit** opens the fields, and **Save and run** can also write them to
`.multiagent/local-preview.yaml` in the project folder (a change you commit). Projects › Edit
shows what the project's folder declares or is detected to run with (**Use it**), before any gate;
Projects › Add detects nothing until the project is saved (only a project's folder or a run's
worktree is read, so a browser on `npm run serve` cannot list any folder of the machine). For this
app itself it proposes `npm ci` and `npm start`. In a simulation (no git worktree) the gate's
**Changed files** are the ones the simulated developer reported, labelled "simulated".
`developer_check` also offers **Show the diff**: the branch's changes since the base branch, in the
diff viewer (see Reviewing a run's changes).

### Reviewing a run's changes

The diff viewer shows a run's changed files the way GitHub's "Files changed" does. It opens from a
gate's **Show the diff**, from a **Changed files** entry of the gate's Artifacts panel (on that
file), and from **Review changes** on the Run screen of any run with a worktree or reported files.
The changes are `git diff --find-renames <base>...HEAD` in the run's worktree: everything since
the merge base with the run's base branch. They are read-only: nothing is checked out or written.

- **Files** on the left are grouped by folder. Each has an added / modified / deleted / renamed
  icon and `+n −m` counts, and a filter box narrows the list. Mark a file **Viewed** to track your
  progress ("n of m viewed", remembered per run). ↑ / ↓ or j / k move between files.
- **The diff** is **Split** (before | after, aligned, line numbers on both sides) or **Unified**,
  switchable at any time and remembered. Both modes have syntax highlighting, word-level
  highlights and **Wrap lines**. Unchanged regions are collapsed; ↑ 20 / ↓ 20 / **Expand all**
  shows them.
- **Binary files** say "Binary file changed", and images show before and after previews (click to
  enlarge). Huge files such as lockfiles are collapsed with **Load diff**.
- **Commits** shows all the branch's changes or only one of its commits, e.g. the developer's new
  commit after *Ask for changes*.
- **Esc** or ✕ closes it, and the gate is still there. A simulated run (no worktree) lists the files
  the developer reported, with a "Simulated: no diff" note.

Failure gates (a step that ran out of fix rounds, or a failure no commit can fix) only offer what
can change the outcome:

| Gate | Options |
|---|---|
| `test_failed`, `verify_failed` | continue anyway / stop (`failed`) |
| `build_failed` (also reached at once by an `infra` build failure, e.g. a file locked by a running process) | continue to verification anyway / build again (after fixing the environment) / stop (`failed`) |
| `ci_failed` | one more fix round by the developer / check CI again (stuck or flaky pipeline) / stop (`failed`) |
| `preview_failed` | publish the same commit again (infrastructure) / send it to the developer (then CI, PR check, preview) / stop (`failed`) |
| `merge_failed` (a merge that failed for another reason than a conflict, a blocked developer, or 2 conflict rounds) | merge now (checked right before) / send it to the developer to resolve / stop (`failed`) |
| `deploy_failed` (after the merge) | new development cycle / track the deploy again (after re-running it yourself) / stop (`failed`) |
| `human_review`, `approve_merge` | rejecting ends the run as `cancelled` |

Once a fix loop reaches its limit the engine goes to the gate without asking for yet another fix,
and a gate never re-runs the same failed thing as the only way forward.

A suite red only outside the change (#396): every counted failure of the suite says whether it is
**in the change** (its test file is changed or reaches a changed file through the import graph) or
**outside the change** (it reaches none, passes alone, or fails or hangs on the base too), with the
reason, in the gate's summary. AI Development (local hero) has the input **Suite red outside the
change**: *Ask* (default) opens `test_failed` as for any red suite; *Continue* lets such a run go on
to the build and the merge without the gate. A failure in the change always opens it. A run that
reaches the build without a green suite (the policy, or your Continue at the gate) shows a **Not
tested green** badge on the Run screen and in its chat, `tested: "not green"` with the failures in
its `summary.json`, and its build and verification prompts get the failures.

**Merge conflicts at the approval.** With several runs at once, a PR/MR that was clean when checked
can conflict by the time you approve it. The engine checks the PR/MR itself (`gh pr view` /
`glab mr view`, no model call) right before `approve_merge` opens (the message says "CI green and
mergeable, checked at …"), again whenever another run merges into the same repository while the
gate is open, and once more right before the merge; merges of concurrent runs go one at a time. A
PR/MR that is not mergeable is never merged and never offered for approval: the run supervisor
decides first. A conflict sends the run back to `resolve_conflict` (the developer merges
`origin/<base>` into the branch and resolves it, skill `merge-conflict-resolver`), then
`code_review` of the resolution only (the merge commit, not the whole change), the full suite, CI,
the PR check, a new preview and `approve_merge` again: the code changed after your first "yes", so
you approve again. The supervisor's record ("went back to resolve_conflict at 00:10 UTC because
PR #64 conflicted with main after the #35 merge") shows in the run chat, `decisions.tsv` and the
Backlog card. Anything else, 2 rounds, or no supervisor interventions left → the `merge_failed` gate,
with the supervisor's diagnosis.

`/goal` and `/loop` are declared per step in the YAML (`goal.until`, `loop.interval`,
`loop.max_duration`). The engine repeats the step until the goal is met and injects the /goal
and /loop instructions (current iteration, interval and limit) into the agent's prompt.
A loop whose agent is blocked also stops early, at `goal.on_exhausted`: after `loop.max_blocked`
iterations in a row (default 3, `0` turns it off) in which it checked nothing (every tool call
refused by its allowlist, or none made) or had calls refused and gave the same answer again.
The reason goes to the run log and `decisions.tsv`. Many refused calls in one turn also log a
warning that the supervisor sees.

Polling without the model: a `/loop` step can declare `wait:`. Between the agent's turns the
engine checks the PR/MR or the CI run itself with `gh`/`glab` (no tokens) and calls the agent only
when there is something to think about:

```yaml
wait:
  probe: pr_checks                         # pr_checks | pr_changes | workflow_run
  target: "{{ steps.ci.output.pr_url }}"   # the PR/MR URL (or the run/pipeline URL)
  output: { ci_status: success, failure_log: "" }  # all green: finish the step with this, no agent turn
  grace: 10m                               # no check registered this long after the agent's last turn: ask it
```

- `pr_checks`: running checks → poll again; a failed check, a conflict with the base, a merged or
  closed PR/MR, an unknown state → the agent; all passed → `output` (or the agent without it).
- `pr_changes`: the agent is called again only when the PR/MR changed since its last turn (head
  commit, comments, reviews, review decision, checks, mergeability).
- `workflow_run`: a GitHub Actions run or a GitLab pipeline; the agent is called when it ends.

The first visit, a visit after a delegation (a fix was pushed) and a check that could not run
always go to the agent. Each check is a `step.probe` event (run chat, supervisor timeline), and
`summary.probes` counts, per step, the checks made without the agent, the agent turns they asked
for and the steps they finished. In software-development, `ci` (the CI pusher only pushes, opens
the PR/MR and triages failures), `pr_babysitter`, `deploy_test` and `deploy_prod` use it.

Sessions: the developer, the CI pusher and the PR babysitter come back many times for small
turns (a fix, a CI check), so they run in `handoff` sessions: every turn is a fresh session that
starts from the agent's latest handoff note, instead of carrying 200k+ tokens of history. The
other agents keep one conversation (`persistent`) up to `max_context: 150k`. Each agent may only
use what its `capabilities` declare (e.g. the CI pusher: read, `git`, `gh`, `glab`; no edits, no web).

## Fix (`workflows/fix.yaml`)

Code & Build (#630). A bug from its reproduction to the merge: reproduce → develop → code review →
suite → verify → merge. The developer first gets one command that shows the bug for the reported
reason (a failing regression test when it can), then fixes the root cause with the regression test
that failed before it (skill `bug-diagnosis`). `mode` works as in Feature: `local` merges into the
local base and pushes it, `remote` opens a PR/MR and waits for its CI. `hotfix` marks the urgent lane:
the smallest change, meant for a patch release from the last tag.

## Release (`workflows/release.yaml`)

Code & Build (#630: the old `e2e-release.yaml` name still runs it; the whole E2E suite is part of
every release). Decides "this set is good, ship it" (#260): the work of many runs merges into the
local base one after another, and a release run checks their sum. For a Node project (a
`package.json`), it first writes the release's version (a semver such as `1.2.0` or `v1.2.0`) into
`package.json` and the root of its lockfile and commits it on the run's branch, so the suites check
the commit Ship tags (#325; a name that is not a semver, a project without `package.json` or a lower
version writes nothing and the run log says why). It runs the project's whole unit suite, then its
whole E2E suite (`e2e_suite: skip` for a project without one), in its own worktree of the local
base, with no agent while they are green; a test that fails there is never waved through as
"failing on the base too". A red suite calls the developer with the history since the last release
(the runs, their issues, decisions and handoff notes, the commits) to find and fix the regression,
then both suites run again, at most `max_rounds`: the unit suite whole, the E2E suite first only on
the feature files that failed in its previous round, then whole once they pass (#324: only a green
whole pass leads to Ship). Then the **Ship** gate, yours only (never the supervisor, a timeout or
`--auto-approve`): **Ship** merges the run's version commit and fix, pushes the local base to
origin (never forced), tags it with the release's name and runs the optional `build_command`; it
is refused when the local base moved since the suites ran (another
run merged: check the release again) or when the tag already names another commit. **Hold** ends
the run with nothing pushed (resume it from the gate to ship later).

When the run needed a fix or a second round, a **Release summary** step runs before Ship (#290): a
cheap read-only agent (Sonnet, one turn, 5 minutes, no edit, no web) gets the round-by-round trail,
every fix round's `summary`, `regression`, `test_notes` and commit, both suites' results, the fix
branch's `git log --stat`, the release's version, the project's version and its last tags, and
writes a verdict line, a Timeline table, The fixes (what, why, and whether each was a regression, an
older defect or the machine), Before you ship (the diff's size, what Ship does, anything that does
not match, e.g. the version against `package.json`) and Follow-ups. It leads the Ship gate's
message, is saved as `release-summary.md` (Reports in the run's Artifacts) and is linked from the
release on the Releases screen. It is a recommendation: the choices are unchanged and only you
answer the gate. A run with one green round of each suite skips it; a review that fails or times out
never blocks: the gate opens with a line saying the summary is missing.

It starts from Code & Build › Releases, or when a roadmap reaches a **cut line**: "Release here"
on a stage of the Roadmap draws one after it, with the release's name, and the stages after the
line wait until that release shipped (a held or failed release pauses the roadmap there; a release
run of that name started from the Releases screen is the line's too). Roadmaps without cut lines
run as before. A release is an item of the roadmap of its own (#555), not a field of the stage
before it: `{ kind: 'release', id, name, status?, runId?, shippedAt? }` between two stages of
`roadmap.stages`. Disabling, emptying, moving or removing a stage leaves it in place, and a
disabled stage before it is skipped without holding it. The owner adds it ("Release here"), moves
it (↑ ↓ on its dashed line, one stage at a time, onto a stage with no release), renames and removes
it, each edit in the roadmap's history (Undo); a running or shipped release cannot be moved nor
renamed. Right after its dashed line the Roadmap draws its card in every state, a planned one
included: Planned, the stages it closes and the release run's estimate. The screen draws and edits
the roadmap folded (`RoadmapModel.foldReleases`: each entry as the `release` of the stage before it,
the ones with no stage before them in `leadReleases` with their place) and saves it unfolded
(`unfoldReleases`); the service gives a new release its id. An older roadmap's
`release` on a stage is read as a release entry right after that stage, with its status, run and
shipped date. Shipping records the release (version, date, issues, runs, cost, test results,
notes) in `<workspace>/releases/<project>.json` and marks its issues **Released** on the Backlog.
The discovery cards linked to one of those issues (`links.issues`) are marked Released too: their
`links.release` becomes the release's version, and a card keeps the first release that shipped it.

**Release candidates and stable releases** (#489). There are two kinds of release. A **candidate**
(`vX.Y.Z-rc.N`, N counting the merges since the last stable) is recorded for every merge into the
base, with its run and its issues, and the project's Deploy workflow publishes it as a prerelease,
never as the latest. The **stable** release is a candidate promoted without a rebuild: its commit is
tagged `vX.Y.Z` and pushed, and Deploy renames that candidate's release and marks it latest. Code &
Build › Releases lists the candidates since the last stable (newest first): **Promote to stable**
opens a dialog with the suggested version (the #436 suggestion over the issues since the last
stable: major on `breaking`, minor on `enhancement`, else patch), editable before you confirm; a
commit without a candidate is refused with the reason. **Hold** keeps the night's train from
promoting a candidate (click again to release it); the next merge makes a new candidate. The
**release train** runs when the Night watch ends: with merges since the last stable and the base
check green on the last candidate's commit, it promotes it when the night permission **Promote a
release** is on (off by default), else proposes it for the morning; a red base check or a candidate
on Hold holds it and says why. A cut line still starts the full release run above.

### Findings: report what is on screen (development)

The **Findings** button (bottom-right corner, or **Ctrl+Shift+F**) is a tool for the people
building the app, after the `sightline` seed of Kent Beck's
[ToolSeeds](https://github.com/KentBeck/ToolSeeds). It shows when the app runs from source
(`npm start`), or when **Settings › General › Findings button** is on (off by default). It never
shows in `scripts/screenshot.js` captures unless that setting is on.

- **Freeze**: a click captures the window's real pixels and the view stops updating while you mark
  it. **Esc** or **Cancel** closes it and nothing is saved.
- **Mark**: numbered **Pins**, **Circle**, **Box**, **Arrow** and **Freehand**, each with an
  optional note, and a note for the finding. A pin resolves to the element under it: its
  `data-testid`, the view and tab, the ids it carries (run, step, stage, item, issue, session) and
  its bounding box; a pin on empty space says so.
- **Save** writes the finding to `<workspace>/findings/<timestamp>/`: `screenshot.png`,
  `marked.png`, `marks.json`, `context.json` (view and tab, project, visible runs, window size,
  theme, app version and commit, the last 50 UI actions, the last 50 service calls with their
  errors, the last 200 lines of the main log) and `note.md`. Tokens, auth state, environment
  variables and file contents are never written. **Open folder** shows it.
- **File as issue** sends the finding to the Product Owner's inbox. The Product Owner writes the
  issue (English, UI criteria) with the marked image and names the finding's folder, so a run can
  read the bundle.
- **Settings › General › Findings** lists the saved findings with their status: Saved, Sent
  (waiting in the Product Owner's inbox) or Filed.

## Test backfill (`workflows/test-backfill.yaml`)

Code & Build (#203, #631; the old `test-batch.yaml` name still runs it). Write features first and test
them later, all together: for runs made with unit or E2E tests off, it covers a range of local commits
(since `since`, else since the last green backfill, `refs/multiagent/test-batch-last-green`, a local
ref; or the commits that close the run's issues) in its own worktree of the local base. One test
writer session writes the missing unit tests (and E2E scenarios when `e2e_tests` is on) on the branch
`test-batch-<run_id>`; the orchestrator runs the whole suite once per round (`suite` step, no agent)
and sends the failing tests back to the test writer, at most `max_rounds`, then a human gate. A
failure caused by the production code goes to the developer; then you approve the merge (nothing
reviewed the fix). Green: the branch merges into the local base and the commit becomes the last green
backfill. Start it by hand, from the Backlog or as a roadmap item: the Product Owner's Cost step
(Economy) follows the untested issues of a stage with a `test-backfill.yaml` item. It never pushes,
tags or publishes.

## Refactor (`workflows/refactor.yaml`)

Code & Build (#355). One refactor, done safely, in any language the workflows support (`language`
picks `unit-test-writer-<language>` and `build-audit-<language>`). The target is an issue of the
project's refactor list (the usual issue inputs) or a free `target` (files or functions) with the
expected improvement in the task. Behaviour is pinned before the structure changes (Kent Beck: never
mix structural and behavioural changes in one commit):

1. **Pin the behaviour** (`pin_behaviour`, the test writer): characterization tests of the target's
   current behaviour, committed first, in their own commit; it also records the target's figures
   before the change (lines, files, complexity where a parser exists for the language).
2. **Green check** (`green_check`, no agent): the orchestrator runs exactly those files on the
   unchanged code (`expect: green`). A pinned test that fails, or a listed file that is not in the
   worktree, goes back to the test writer, never on; after two rounds the `pin_failed` gate asks
   you (one more round, or stop).
3. **Refactor** (`refactor`, the developer): structure only. It may not edit any test
   (`edits_tests: false`) and the pinned tests are locked (`protect_files`): a turn that changes one
   is refused. No behaviour change, no dependency upgrade, no rename of a public interface the issue
   does not name.
4. **Gates**: the project's full suite (`suite`, no agent; in this repository it includes the
   code-health ratchets) and the build audit (`build`).
5. **Review** (`review`): one question, "same behaviour, simpler structure?", answered from the
   before/after figures of the target (lines, files touched by the change, complexity, or the
   reviewer's reading). A behaviour change goes back to the refactor.

Green: the branch merges into the local base (`merge: local`, never pushed). The run's
`summary.json` records the target's `before` and `after` figures with its cost, so a month of refactor
runs can be compared with `run_analysis` (#184).

## Write doc (`workflows/write-doc.yaml`)

Plan & Design. One run per stage document of a work item (`docs/work/<item>/intent.md`, `spec.md`
or `plan.md`, with its pt-BR translation next to it), started from the **Documents** screen's
**New item** panel. The writer drafts the document, you edit it with the writer by selection, a
reviewer anchors notes to its sections and you sign it off.

| Stage | Who | What it does |
|---|---|---|
| scope | writer | Reads the item and lists the screens of the app worth showing |
| evidence | the screenshot command | Captures those screens (never blocks) |
| compete | up to 5 writers **in parallel** (`writers` 2-5 only) | **Arena mode** ("Several writers", #648): each writer drafts the document on its own; at least one must answer |
| draft | writer | Writes the first draft and its translation (`document.md` in the run folder); in Arena mode it merges the best of the drafts into one |
| edit | you + the writer | Each request of the Documents screen (a selection, its text, pasted images) is a writer turn; one commit per request. **Send to review** ends it |
| review | reviewer | Notes anchored to the sections, scored on the document skill's rubric |
| approval | you | Accept intent / Sign off spec / Accept plan, or send it back to the edit |

Outputs (pipelines, chains): `document` (the draft's text) and `issue` (the issue the run was
started from, when there is one). #648: the former Writer & Reviewer (`writer-reviewer.yaml`) and
AI Arena (`ai-arena.yaml`) workflows are aliases of this one: a saved pipeline, a repository
manifest or a roadmap stage that names them runs `write-doc.yaml`. Their screens left the menu;
past runs still open from Workflows › Runs › **Open run**.

**Enrich a Backlog issue**: **Enrich in Write & Review** in an open issue's **⋯** menu (list row, kanban
card) opens this screen prefilled: an enriched issue by default, a prompt with the
issue's title, number, URL, labels and full body, a default goal for the document type (it follows
the type until you edit it), and the Backlog's project (read-only). Nothing starts by itself. The run
records its issue (`issues` in `workflow.started`): the chat shows it, and the Backlog card shows
"being enriched" / "enriched" with a link to the run (it never moves the card's column). Once you
accept the document, **Save to issue #n…** (in the chat and in Run Details, so you can save later or
again) shows a preview of the text and the command, and saves only when you click it:
- **Replace the description** (default for an enriched issue): the document becomes the body and the
  original description is kept at the end in a collapsed `<details><summary>Original description</summary>`
  block (saving again keeps the first original, never nested);
- **Add as a comment** (default for an RFC, PRD or design doc): the description stays as it is.

It uses the Backlog's CLI: `gh issue edit <n> --body-file` / `gh issue comment <n> --body-file`, or
`glab issue update <iid> --description` / `glab issue note <iid> --message`. Then the Backlog reads the
issue again (new body, task progress, labels), and the run records the save (`issue-saves.json`, the
text sent in `issue-save.md`), shown in Details and Artifacts. A failure (no auth, issue closed or
deleted, network) shows the CLI's message; the document stays in `document.md`. Agents and the
supervisor never save to an issue. A simulated run only shows the preview, and
`MULTIAGENT_SIMULATION_ONLY=1` refuses every real save, so automated checks never call `gh`/`glab`.

## Issue (`workflows/issue.yaml`)

Plan & Design (#648: the former issue tracker; `issue-tracker.yaml` is an alias of it). Turns a request in a few words (any language), or a signed-off spec (the `spec` input, e.g. `docs/work/<item>/spec.md`), into triaged GitHub/GitLab issues.
Start it from the Backlog's **New issue…** button (the selected project and platform are filled in)
or from the Start panel. Inputs: `request`, `project_path`, `mode` (**Validated**, the default, or
**Automatic**, shown next to the request), `git_platform` (`gh`/`gl`), and the optional `related`
("#41, #79"), `attachments` (screenshots, logs), `max_revisions` and `assign_workflow`.

| Step | Agent | What it does |
|---|---|---|
| `analyze` | `code_analyzer` (Sonnet, read-only: git and gh/glab to read) | Finds the code involved and today's behaviour (file:line), estimates the files to change, rates **impact** and **complexity** 1–5 (`issue-triage` rubric), searches issues and open PRs/MRs for duplicates and work in flight, advises running it alone or grouped with #n, lists the labels the repository lacks. |
| `write` | `issue_writer` (Opus, read-only) | Drafts the issue(s) in English with `issue-writing`: evidence, "Decision (owner): …", tasks as acceptance criteria, a Triage section, labels. Independent parts become cross-linked issues. |
| `review` | you (Validated; Automatic skips it) | The scores, the grouping advice and the draft(s), in the run chat. **Create**, **Create and plan** (a chain to the roadmap, see *Chaining workflows*: once the run succeeds, the new issues become a new last roadmap stage for `assign_workflow`, as one item when grouping was advised, planned and never started by itself), **Revise** (your note goes back to the writer, `max_revisions` rounds), **Add to #n instead** (comment on the existing issue), **Discard**. |
| `file` | `issue_filer` (Sonnet, gh/glab only) | Creates the issue(s) or comments on the existing one, with the labels, and reports the URLs. |

**Automatic mode** (`mode: auto`): `write` goes straight to `file`, which creates the drafts as
they are: no review, no revise rounds, nothing queued for `assign_workflow` (the issues show on the
Backlog after its next sync). You chose it at start, so no gate is skipped on your behalf. Two
cases still need you: a draft that found an existing issue (a possible duplicate) stops at the
review, with a line saying why; and missing labels are not created (the filer uses the existing
ones and lists the skipped ones in its summary), since only a person confirms new labels.

**Labels**: `impact:1`…`impact:5`, `complexity:1`…`complexity:5`, the kind (`bug`, `enhancement`,
`documentation`) and optional `area:engine`, `area:renderer`, `area:workflows`, `area:docs`. The ones
the repository does not have are listed at the review and created once, by the filer, only after
your choice there; the generic `issue-creator-*` skills keep using existing labels only. On the
Backlog, the triage labels show as `I3`/`C2` badges on each issue, the **Sort** menu orders by impact
or complexity, and the Labels filter narrows by them (e.g. `complexity:1 OR complexity:2`).

## Backlog Refresh (`workflows/backlog-refresh.yaml`)

Plan & Design, read-only on the code. Issues are written against the code of the day they were
filed; after a few merges their paths, line numbers and task lists drift. The `refresher` (Claude
Sonnet, git and gh/glab only to read, exploration sub-agents in batches, skill
`backlog-refresh-<git_platform>` on top of the shared `backlog-refresh`) reviews every open issue
(or the `issues` listed) against `base_branch` and the changes since `since`, and answers per issue
`current`, `update`, `partly_done`, `done`, `obsolete` or `duplicate` with evidence, exact
`{ find, replace }` edits for the safe fixes (paths, lines, renamed symbols, tasks done with
evidence), a new `complexity` when the size changed, and `scope` proposals. A transition action runs
the skill's `apply.js --platform gh|gl --mode safe` (no model): each `find` must match the current
body exactly once, an issue edited after the review (`updatedAt`) or closed is skipped, the refresh
note goes after a `<!-- backlog-refresh -->` marker (replacing an older one), and the platform keeps
the earlier bodies. The `scope` decision gate lists the proposed closes; only your **Apply** runs
`--mode scope` (closes with a comment); rewrites are only reported, and the supervisor never answers
the gate. The run never merges (`metadata.merges: false`): as a roadmap stage it is done when it
succeeds. The Backlog suggests it every 24 hours (see the Backlog screen). Run folder:
`refresh.json`, `report.md`, `applied-safe.json` / `applied-scope.json`, `bodies/<n>.md`.

## Retrospective (`workflows/retrospective.yaml`)

Monitor & Improve (#631; the old `run-retrospective.yaml` name still runs it). Given a `run_id`
(default `latest`: the most recent run of another workflow; an id with no run folder is refused before
the run starts), reads that run's `events.jsonl`, sessions, `decisions.tsv` and `summary.json` with the
`run-retrospective` skill, and proposes evidence-backed edits to skills and workflows
(`retrospective.md`, also copied into the analyzed run's folder; the `findings` output). It only
proposes; a human applies. Feature's `retrospective` input chains it on the run that just ended.

## Analyze project (`workflows/analyze-project.yaml`)

Monitor & Improve (#372, #378, #631: the old `project-map.yaml` and `refactor-proposals.yaml` names
still run it). The project's city, its architecture analysis and its refactor proposals in one
workflow, started from a project's Architecture tab ("Analyze this project", its estimate next to it:
one click, no confirmation), by hand from Workflows or by a pipeline. Inputs: `repo_path`,
`project_id`, `mode` (`auto` or `validated`), `analyze` (on by default), `since` and `limit` (the
issues to file, default 5).

**The map** (without `since`). The `facts` step counts the tracked files by folder and by file-name
pattern, lists the manifests and reads #371's folder city with its edges (no model). The cartographer
(skill `project-map`, read-only on the project) answers a city plan: zones, districts, landmarks and
ports as path rules. `validate` runs the city model's validator (schema, duplicate ids, unknown zones,
at least 95% of the drawn files in a district); a failing plan goes back to the cartographer with the
report at most twice, then the run fails and nothing is saved. A valid plan is saved at once
(`<workspace>/architecture/<project id>/city-plan.json`; the plan it replaces goes to
`city-plan-history/`). In validated mode the gate shows the plan's zones and districts and its
validation first, and only an approval saves. Then `analyze` runs the Oracle's architecture analysis
of the project (one Oracle turn in its daily budget, saved as the Architecture tab's reports are). A
refresh starts from the saved plan and keeps its ids and names. The tab advises a refresh when more
than 5% of the drawn files match no district or a new top-level folder appears.

**The refactor proposals** (with `since`, a tag or a commit: the "since the last tag" mode, what
`refactor-proposals.yaml` did). The map is skipped:
1. **Facts** (no agent): the Architecture facts at the project's default branch and the files changed
   since `since`.
2. **Analysis** (the analyst, read-only, the one real model call): #356's report, with the
   Architecture tab's own schema.
3. **Proposals** (no agent): the findings become Refactor tab proposals; one that matches an open or
   dismissed proposal, or an open `refactor` issue, is dropped and the run names it.
4. **Ranking**: #357's Product Owner ranking; the top `limit` kept.
5. **Gate** (validated mode only): dismiss the ones to drop on the Refactor tab, then approve.
6. **File**: "File as issue" for each kept proposal, with the `refactor` label (a simulation previews,
   no `gh`).

Outputs: `issues` (the filed issues, for a pipeline's `product_owner` or `queue` target) and `report`.
The bundled pipeline **`pipelines/release-then-refactors.yaml`** runs a release, then this workflow
since the release's previous tag (`since` ← `previous_version`), then the Product Owner places the
filed issues in the roadmap. The release's gates and Ship stay human; the analysis is one real model
call (about $0.50, estimated like the Architecture tab's).

## Visual builder

Workflows › **Builder** draws a workflow as a vertical flow of **desks**, each with an agent seated at it
(the same isometric robots as the rest of the app), plus **approval gates**; **+ Desk** / **+ Approval gate** after each arrow insert one right there. Per desk you set:

- what the agent does in the step (its prompt for the step); by default the desk also gets the
  run's task, the previous desk's answer and the notes typed at the gates;
- the agent: **Custom** (a prompt saying who it is, and skills), **Import an agent** (a list of the Agents menu's cards, in a modal) from the
  Agents menu (its look, prompt and skills, still editable) or **Random agent** (one of your
  agents, picked when the run starts; the pick is logged and kept on resume);
- the skills, checked in a list;
- the CLI, model and effort (**default** = the CLI's own, no effort flag), and whether it may only
  read the project folder or also edit files and run commands.

A gate is approved by **a person** (amber arch, a person with a clipboard) or by **an AI agent**
(violet arch with a scanner beam and the agent's robot). A person's gate waits for them; if
rejected it stops the run (cancelled) or sends the work back to an earlier desk with the notes.
An AI check is an agent step (its own CLI, model, effort and prompt, or an imported agent) that
reads the previous desk's answer against your criteria and answers `approved` + `notes`; if
rejected it stops the run (failed) or sends the work back with its notes, up to a number of
rounds (then the run fails). **Save** writes a regular YAML to
`<workspace>/workflows/<name>.yaml` (the engine runs it unchanged; the builder's own data sits
in `x-builder`), **Run** saves and opens the start panel. The workflows it makes take a `task`
and an optional `project_path` (the folder the agents work in; empty = the run folder).
**Send to builder** (Definitions) shows any workflow in the builder:
- the workflows bundled with the app are **read-only**: **Clone** makes your own copy
  (`<name>-copy.yaml`, comments kept);
- your workflows that use what the builder doesn't draw (loops, parallel steps, output schemas,
  other inputs) show them as badges; their agents (CLI, model, effort, prompt, skills, look) and
  the step prompts can be changed, the steps themselves are edited as YAML, and everything else
  in the file is kept;
- workflows made with the builder are fully editable. Hand edits to `providers`, `defaults`,
  `orchestrator` and `observability` are kept when the builder saves again.
<!-- /generated:workflows -->

### The project's default workflow and its workflow per kind

The default development workflow (the one a plan, Split + roadmap, Create + roadmap, the Assign
dialog and Fix the base use when nothing is picked) comes from the project, never from a global
setting: the project's own default (the Workflows block of its page), then the repository manifest's
`default`, then the first build workflow of the project's set, then `feature`. A project imported
from a repository whose `.multiagent/project.yaml` declares `default: <name>` gets it at once.

The manifest's `kinds` map names the workflow, and the inputs, of each kind of issue, which the
import saves on the project and the project's page lets you change (its Feature and Fix workflows):

```yaml
default: ai-development-remote-hero
kinds:
  feature: { name: ai-development-remote-hero }
  fix: { name: fix, mode: remote }
```

The Product Owner classifies each issue as a Feature, a Fix or a Refactor (a `bug` label suggests a
Fix, a `refactor` label a Refactor, the content decides) and gives each one that kind's workflow: a
Fix and a Feature never share a run, a recommendation shows its kind as a badge with a one-line
reason, the plan sums up its runs by kind, and a Feature | Fix | Other control swaps the workflow
(Other lists every workflow that takes a task). Without a map, a Feature runs the project's default
and a Fix runs `fix` in the project's way of working (Local, Remote or Fork + PR). Both names must be
among the manifest's `workflows`, and an entry with a `file` must be named after that file: anything
else is reported as a manifest error and ignored. The map has `feature` and `fix` only (a Refactor
runs on the Feature entry; another key is an error too), and a manifest with errors counts as none
(its workflows, default and kinds are all ignored).

## Workflows in your repository

A repository can declare the workflows it is worked on with in `.multiagent/project.yaml`:
`{ name }` for a bundled or workspace workflow, `{ name, file: workflows/<x>.yaml }` for its own
copy in `.multiagent/workflows/`, each with an optional `category` (`intake`, `solo`, `team`,
`release`). Open the project in the app and the Workflows screen shows them in their sections with
a "repository @ <sha>" badge. A repository's own workflow is code from the checkout: it stays off
until you accept it for that commit (a later change shows the diff and asks again), and even then
it cannot ship, runs its `action:`s only in the run's worktree and gets only the tools your
workspace allows. Your per-agent model choices stay in the workspace: a workflow you edited in the
workspace runs instead of the repository's copy of the same name (both cards say which one runs),
and when the repository's copy runs (no edited copy, or the project's "Prefer the repository's
workflows" setting) your models still apply on top. This repository declares its
four flows this way. Details: [`docs/agents/engine/repository-workflows.md`](docs/agents/engine/repository-workflows.md).

## Ways of working: an interview that writes your workflows

On a project's page, **Ways of working** opens a drawer that proposes how to work on the
repository instead of drawing a workflow from scratch. It shows the price first (the
`ways-of-working` analysis seed, read-only, one or two turns); **Analyze** then reads the commit
history (authors, merges, squash vs merge), tags and releases, CI files, test and build scripts and
the Architecture facts, and shows the profile with its evidence ("one author, merges straight to
main, a tag every two weeks: Solo: local merge + Release: milestone"). The interview asks only what
the analysis could not settle (validation, budget per issue, screenshots, review rigour, and the
team, merge or release style when the history does not say); every answer has a default from the
profile, and **Edit profile** overrides any inferred field (team, merge, release, CI, test and
check commands, languages). The proposed set (intake, development in the chosen style, release in
the chosen style) is composed from the step fragments with the project's facts in the prompts.
**Open in Builder** opens the development workflow unsaved; **Write to the repository** puts the
files under `.multiagent/workflows/` and merges them into `.multiagent/project.yaml` (other
entries are kept), uncommitted: you commit them.

The way changes land is one of three modes:
- **Local**: the run merges into the local base and pushes main as its last step; no pull request.
- **Remote**: the run pushes its branch to `origin`, opens a pull request and waits for its CI; it
  is merged on the platform.
- **Fork + PR** (#738): for a repository you can't push to (the onboarding reads gh's push
  permission, or glab's access level on GitLab, below Developer = no push, and offers **Create a fork** or **Work locally**). `origin` is your fork, `upstream`
  the original: before each run the fork's default branch is fast-forwarded to upstream's and
  pushed to the fork; the run's branch goes to the fork and its pull request to upstream's default
  branch (following the repository's CONTRIBUTING.md and PR template), and the run waits for that
  PR's CI. Nothing is ever pushed to `upstream`: the merge is the maintainer's. A roadmap item can
  depend on an earlier one (`dependsOn`): its run starts from that item's branch on the fork, and by
  default its pull request waits for the earlier one to merge (the engine checks the parent's PR
  itself, without calling the agent, and the wait does not count in the step's time limit) and is
  rebased onto the synced default branch (or opens at once saying "Depends on #N", the project's `depends-on` setting).

Details:
[`docs/agents/seeds.md`](docs/agents/seeds.md) and [`docs/agents/engine.md`](docs/agents/engine.md).

## Project run defaults: a run starts from the project's configuration

A run's inputs are resolved in one order everywhere (the run dialog, the Roadmap's stages and
`scripts/run.js`, `resolveRunInputs` in `packages/engine/domains/project/project-run-defaults.js`):
**what you type in the dialog > the roadmap item's inputs > the project's run defaults > the
workflow's defaults**. The dialog marks the fields filled from the project with a "from the
project" hint. On the CLI, `--project <id>` (or the project whose folder is `--repo`) picks the
project.

A roadmap item keeps only the inputs chosen for it (#785): what the owner changed in the Product
Owner's recommendation or in the item's Edit form, or what the plan set on purpose (the Cost step's
tests and screenshots). A value equal to the one shown anyway is not saved, and neither is an empty
one, so the project's configuration reaches the run. The Edit form and the recommendation say where
each value comes from ("from the project", "from the workflow", "on this item"). An item saved
before this keeps its values; its Edit form lists the ones that differ from the project's, with
"Use the project's values".

The project's run defaults come from the wizard's picks (#729: the `local-*` / `remote-*` /
`fork-*` variants), the Ways of working profile (Edit profile saves them on the project, with the
project's kind) and the facts read from the files; a value saved on the project
(`project.runDefaults`) wins over a derived one. No Node toolchain is assumed: a Rust project gets
`cargo test`, and no `npm …` command is offered without a `package.json`.

**The project's kind** (backend / frontend / full-stack) is detected from the files (web
frameworks, UI folders, a server, an E2E suite) and confirmed on the wizard's review or in Ways of
working. A backend project has no UI defaults: `ui_folders` empty, `screenshots: off`,
`e2e_tests: off`, no `steps_folders`; the existing conditions then skip the developer's
screenshots, the test id check and the UI Reviewer, and the run screen shows those steps dimmed
with "Doesn't apply: no UI in this project".

Where each input of feature, fix and release gets its project value:

| Input | Project value |
| --- | --- |
| `mode` | the wizard's variant (`local-*`, `remote-*`, `fork-*`), else the profile's mode (`fork` when you can't push to the repository, #738) |
| `test_order` | the wizard's variant: `*-code` is `code_first`, `*-e2e` is `e2e_first` (#785) |
| `language` | every language detected from the project's files, comma-separated (#785) |
| `parent_branch` | set by the Roadmap for an item that `dependsOn` an earlier one (#738): its branch on the fork |
| `base_branch` | the repository's default branch |
| `test_command` (release: `unit_command`) | the profile's test command, else discovery (`package.json`, `go.mod`, `Cargo.toml` → `cargo test`, …) |
| `check_command` | the profile's check command, else the project's check discovery |
| `e2e_tests` (release: `e2e_suite`) | `off` for a backend, a unit-only profile or no E2E suite found |
| `e2e_command` | the profile's E2E command or the suite found (Playwright / Cypress config); empty otherwise |
| `ui_folders` | the UI folders found; empty for a backend |
| `screenshots` | `off` for a backend, else the workflow's default |
| `steps_folders` | the step folders found; empty for a backend |
| CI wait, budgets, review rigour, validation | none: the workflow's defaults |

Platform (#745): the Backlog, Roadmap and Epics use the project's platform (github.com → GitHub,
gitlab.com or a GitLab host → GitLab, else the platform stored on the project at onboarding); the
platform select appears only for a host the URL cannot name, and the choice is saved on the
project.

## Skills

Skills are reusable instructions (`SKILL.md` + support files) that the engine injects into the
agents, for Claude **and** Codex. The YAML keeps the contract (who, when, schema, transitions);
the skill keeps the know-how.

```yaml
agents:
  test_writer:
    skills: ["unit-test-writer-{{ inputs.language }}"]   # system prompt (1st turn); templates allowed
steps:
  - id: compete
    skills: ["{{ inputs.document_skill }}"]              # the step's prompt
```

```yaml
# SKILL.md frontmatter
name: unit-test-writer-go
description: ...
uses: [testing-principles]   # loaded first, once, cycles ignored
```

- The `SKILL.md` body goes inline; support files (e.g. `rules/python.md`) are listed with their
  absolute path so the agent reads only the relevant ones.
- Lookup: `<workspace>/skills/<name>` first, then the app's `skills/`. The app's skills are copied
  into the workspace on startup. When the app ships a new version of a skill, untouched copies are
  updated; copies you edited are kept, and skills you deleted are not brought back.
- `providers.<p>.skill_args` lets the agent read the skill folder, which is outside `working_dir`
  (Claude: `["--add-dir", "{{ skill_dir }}"]`; Codex in `read-only` can already read any path).

### Naming convention

Language- or platform-specific skills are named `<capability>-<suffix>`, and every family has
one skill per suffix (a test enforces it):
- language suffixes: `js`, `python`, `go`, `java`, `csharp`, `rust`;
- platform suffixes: `gh` (GitHub), `gl` (GitLab).

What is shared by a family lives in a suffix-less skill referenced with `uses:`.

### Bundled skills

<!-- generated:skills -->
| Skill | Used by | Content |
|---|---|---|
| `adr-writing` | arena (`document_skill`) | ADR (after MADR 4.0): one decision, drivers, real options with pros/cons, consequences, confirmation, rubric |
| `arena-synthesis` | arena synthesizer | Merge method and the arena appendix |
| `backlog-product-owner` | the Product Owner (Backlog screen, on demand) | Groups of issues per run, pairs that must not run in parallel, the order (stages), sizes from past runs, issues to enrich first, splits of issues too big for one run, and epics; read-only |
| `backlog-refresh` | backlog-refresh (refresher), through backlog-refresh-gh / backlog-refresh-gl | Open issues vs today's code: exact find/replace fixes (paths, lines, done tasks, complexity), scope proposals (close, duplicate, rewrite) for the owner |
| `backlog-refresh-{gh,gl}` | backlog-refresh (refresher) | Backlog refresh on GitHub: read issues and PRs with `gh`, apply.js --platform gh |
| `blast-radius` | multi-model review | Boundary changes, their consumers, and the safety fact proven on an evidence ladder |
| `bug-diagnosis` | developer | Red feedback loop first, ranked hypotheses, regression test, cleanup |
| `build-audit-{js,python,go,java,csharp,rust}` | builder | Build and audit commands, production vs development scope per ecosystem |
| `ci-failure-triage` | via `uses` | Classify a failure (code, environment, infrastructure, needs-human) and write a root-cause report |
| `ci-pipeline-{gh,gl}` | CI pusher | Push, PR/MR, mergeability (conflicts fail fast), CI status, missing checks, fetching failed logs, retrying flaky jobs |
| `claim-verification` | verifier | Falsifiable claim, baseline vs treatment with the same command, verified / not_verified / inconclusive |
| `clarity-score` | the Discovery board (its score and Grill me, src/clarity.js); issue (issue_writer); backlog-refresh (refresher); the Product Owner (Register an issue) | Clarity rubric per kind (0-100%), the 85% bar, gaps as open questions, the Grill me interview |
| `code-mapping` | mapper | Maps the files, functions, line numbers, connections, tests and conventions of a task before the first edit, in a map of at most 300 lines |
| `code-review` | reviewer | Correctness, spec and standards axes, severities, `rules/` per language (JS/TS, Python, Go, Java/Kotlin, C#, Rust, SQL, Shell/CI) and `rules/smells.md` |
| `context-economy` | developer, test_writer | Does code research through exploration sub-agents, reads excerpts instead of whole files, writes handoff notes the next fresh session can act on |
| `decision-log` | developer, PR babysitter | Agents end answers with a ```` ```decisions ```` block; the engine appends it to `<run>/decisions.tsv` |
| `dependency-audit-policy` | via `uses` | Severity from CVSS, how to report blockers with a fix, redaction |
| `deploy-{gh,gl}` | deployer | Preview and production deploy tracking and cleanup |
| `design-doc-writing` | arena, Write & Review (`document_skill`) | Design doc (after Google's practice): context, goals/non-goals, design with trade-offs, alternatives, failure modes, cross-cutting concerns, rollout, rubric |
| `design-sketch` | arena (`document_skill: design-sketch`) | Usage-first design: usage snippets, types and signatures, trade-offs, alternatives, design red-flag screen, rubric |
| `design-system` | developer (ai-development-local-hero: builds with the tokens); ui_reviewer (ai-development-local-hero, code_review fan-out: checks against them) | UI changes: the app's design tokens (colours, spacing, typography, alignment) from packages/ui-kit/style.css, to build with and to review against |
| `e2e-scenarios` | via `uses` | User-visible changes only, at most 3 scenarios per issue reusing existing steps; development runs write and parse-check them (pending); the release workflow runs them all; per-scenario status with reason |
| `e2e-test-writer-{js,python,go,java,csharp,rust}` | test writer, E2E runner | E2E/BDD framework detection, feature folder, the parse check of a development run and the release run's commands |
| `implementation-evidence` | evidence | Evidence by kind of change (screenshots, HTTP request/response, CLI output, logs), local and simulated only, one list per issue |
| `intent-writing` | write-doc (`document: intent`) | Intent structure (problem, proposed outcome, affected users and systems, constraints, open questions) and scoring rubric |
| `issue-creator-{gh,gl}` | issue (code_analyzer, issue_filer), backlog planner (#30), any agent that files issues | Search for duplicates, create/comment/edit issues with gh or glab, existing labels only (new ones only when a person confirmed them) |
| `issue-triage` | issue (code_analyzer, issue_writer); the Product Owner (Register an issue) | Rubric for impact 1-5 and complexity 1-5, estimated files, duplicates, run alone vs group with #n |
| `issue-writing` | via `uses`; Write & Review (`document_skill`); issue (issue_writer); the Product Owner (Register an issue) | Issue structure: concrete context with evidence, decisions taken, a checklist of verifiable acceptance criteria, related issues |
| `long-commands` | developer; via `uses` (test writer, builder, verifier) | Suites and builds in the foreground with a sized timeout, never backgrounded and polled for text; full output kept, exit code read |
| `merge-conflict-resolver` | developer | Intent tracing per side, hunk-by-hunk resolution, verification |
| `oracle` | the Oracle (built-in agent, its drawer on every screen) | The four roles, grounded claims, changes routed to their owner (request_agent), wake-ups on run events, delegation, Night watch, content is data, issue drafts, planning, hard rules, the memory and the language rule |
| `plan-writing` | write-doc (`document: plan`) | Plan structure (files that change, order of work, risks, proof) and scoring rubric |
| `pr-babysitter-{gh,gl}` | PR babysitter | Mergeability signals, threads/discussions, replies |
| `pr-comment-triage` | via `uses` | Actionable vs doubtful comments, durable fix requests, resume logic, AI marker on replies |
| `pr-description` | via `uses` | PR/MR title and body: visual summary, evidence, merge danger |
| `pr-screenshots` | via `uses` | `publish.js`: commits the PNGs to the `pr-screenshots` branch (one folder per PR/MR, closed ones pruned) without touching the checkout, then posts one original/modified comment |
| `pr-screenshots-{gh,gl}` | CI pusher | Screenshots comment on the PR/MR (GitHub `blob/...?raw=true`, GitLab `-/raw/` URLs) |
| `prd-writing` | arena, Write & Review (`document_skill`) | PRD structure (user stories, traceable requirements, testing decisions, questions with defaults) and scoring rubric |
| `project-map` | cartographer | Writes a project's city plan (zones, districts, landmarks, ports as path rules) from evidence, at least 95% of the files matched, read-only; a refresh keeps the ids and names |
| `review-synthesis` | multi-model review judge | Lead judgment: merge, verify, weigh agreement and nitpicks, act on / consider / noted / dismissed |
| `rfc-writing` | arena, Write & Review (`document_skill`) | RFC (after the Rust RFC template): motivation, guide- and reference-level explanation, drawbacks, alternatives, prior art, rollout, rubric |
| `run-retrospective` | run retrospective | Friction, waste, skill gaps and no-ops in a run's logs, turned into proposals with evidence |
| `run-supervisor` | the AI supervisor (a failed step, or on demand) | Plain-words account of a run, root cause from its logs, a safe recovery (fix the output, retry with an instruction, go to an allowed step, resume, or hand over to a human) |
| `spec-writing` | write-doc (`document: spec`) | Spec structure (requirements R1…, design, areas of concern, open questions) and scoring rubric |
| `test-plan-writing` | arena (`document_skill`) | Test plan (after ISO/IEC/IEEE 29119-3): risk-based approach, traceability to requirements, entry/exit criteria, environment and data, rubric |
| `testing-principles` | via `uses` | Seams first, no tautological or implementation-coupled tests, mocks only at boundaries, red before green for bug fixes, each suite run once, pre-existing failures reported instead of chased |
| `ui-conventions` | developer (software-development workflows, when the change touches the UI); evidence (the visual review); ui_reviewer (ai-development-local-hero, with design-system) | UI changes: shared components, controls that follow the data, a readability checklist, a design section, states to capture, and the visual review of the screenshots (ui_findings) |
| `unit-test-writer-{js,python,go,java,csharp,rust}` | test writer | Framework detection, commands, idioms per language |
<!-- /generated:skills -->

`bug-diagnosis`, `merge-conflict-resolver`, `pr-description`, `testing-principles` and parts of
`code-review` adapt ideas from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT);
`claim-verification`, `blast-radius`, `review-synthesis`, `design-sketch`, `decision-log` and
`run-retrospective` adapt ideas from [cursor/plugins](https://github.com/cursor/plugins) (MIT).
All of them are rewritten for agents that run unattended: where the originals ask the user, ours
record an assumption or a recommended default instead.

<!-- generated:engine -->
### AI supervisor

The engine is deterministic (same graph, same gates, auditable); an AI **supervisor** (skill
`run-supervisor`, model from `orchestrator:` in the YAML) steps in only when something goes wrong:

```yaml
orchestrator:
  provider: claude
  model: claude-sonnet-5
  supervisor:
    enabled: true
    max_interventions: 2   # per step (max_total: 6 per run)
```

- **During a run**, when a step fails (agent error, output that never validates), the engine gives
  the supervisor the step, the error, the agent's last answer and the recent timeline. It answers
  with an explanation and one action, which the engine validates:
  - `fix_output`: rebuild the output from the agent's answer, accepted only if it matches the step's schema;
  - `retry`: run the step again with an instruction added to the agent's prompt;
  - `goto`: continue at one of the step's own targets (never a human gate);
  - `ask_human`: an approval with the explanation (retry with the suggestion / stop); when the
    supervisor says a retry would fail the same way (`retry_would_fail`), the gate offers
    "Resume from <step>" at the step it names instead of Retry, and still waits for the person;
  - `fail`: fall back to `on_error`, or end the run.
  It shows up as a `supervisor` session, and its decisions in the orchestrator log
  (`supervisor.decision` events).
- **When a transition's action fails** (a merge, a deploy command, or the engine's check right
  before a merge), on a transition with `on_error` and `recover: [steps]`: the supervisor gets the
  error and the PR/MR state and either sends the run back to one of those steps with an instruction
  (a known case, e.g. a conflict), recorded with where, when and why, or escalates to the `on_error`
  gate with its diagnosis. An action failure never ends the run without one or the other.
- **On demand**, "Ask the supervisor" on any run (Run view, orchestrator; a run card's **◆ Send to
  supervisor** attaches the run to the Supervisor's chat instead, #409): it reads
  the run (timeline, every attempt of the failing step, artifacts), explains what happened and the
  root cause, and recommends actions: **resume** from a step (a new run that reuses the previous
  steps' outputs and the agents' conversations, with an instruction for that step), **rerun**, or
  something only a person can change. The analysis is saved as `supervisor/analysis-*.md` in the
  run folder (an artifact). **Chat in terminal** opens the supervisor's CLI in the run folder,
  read-only, to ask follow-up questions.

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
  summary with Undo when it ends. Turning it off stops at once. Gates stay yours. With "Skip an
  item" allowed, a roadmap run that waits at a human gate for 15 minutes (Settings › Oracle, "Move
  on past a gate after") while nothing else of its roadmap runs is moved past (#395): the next stage
  starts, the gate keeps waiting for you, and a notification names it. Without that permission the
  gate is only reported to you.
- **Move on** (#395): an item whose run waits at a human gate has "Move on" on its roadmap card (and
  the stage menu has "Move on from this stage"): the item is parked, the next stage starts without
  its change, and the gate stays yours to answer. Answered later, the item ends done or failed;
  it never pauses the roadmap after the fact.
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
  yet"). More than 30% above (thresholds in `packages/engine/domains/run/step-regressions.js` REGRESSION_DEFAULTS) is a
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

**What the Oracle knows and can do** (#184), like the outside Claude Code session that plans the work:

- **Knowledge**: besides its own skill (`oracle`: judge a run's change on the whole branch, check
  a claim in its primary source before saying it, mark hypotheses, correct itself explicitly,
  delegate heavy reading), every session starts with a digest of the skills
  `backlog-product-owner`, `run-supervisor`, `issue-writing` and `context-economy`
  (`skills/oracle/knowledge.md`). A test fails when one of them changes and its digest was not
  reviewed: `node scripts/oracle-knowledge.js` lists them, `--write` records the new hashes.
- **Seeded memory**: the first start writes the owner's standing decisions to
  `oracle/memory.md` (answer in your language, the product in English, UI issues carry UI
  criteria, only the test writer writes tests, one app per workspace, edited workspace copies
  freeze, real runs cost money); after that only you change it. **Import** in the Memory form adds
  the decisions of a pasted text (e.g. a Claude Code memory index) to the draft; **Save** keeps them.
- **Run analysis**: `run_analysis` (run ids, or the runs since a date) gives per run and in total
  the cost and tokens by agent and step, review rounds, timeouts, invalid outputs, refused calls,
  merge conflicts, commands cut by a tool timeout, the test writer's turns × context and cache
  re-read, and the whole-suite starts with their durations. Free: no model. Its `focus` (#321)
  answers other questions on the same runs: `cost` (the default, the figures above); `time`
  (minutes and visits per step, tool vs model time, the slowest tool calls, gaps over 3 min, the
  gates' owner time); `context` (one agent's turns, the developer by default: requests, mean and
  peak context, the read above 100K/150K/200K, the main turn's growth by tool kind); `tools` (calls
  by tool and Bash kind, re-read files, edits, sub-agents, failed calls by cause, test commands);
  `cache` (the turns that resumed a session after its prompt cache expired, their cost); `tests`
  (the suite log's time per test file, two runs compared, E2E vs unit time in the test step);
  `regressions` (#335, over all the real successful runs, not a run list: each workflow step whose
  median cost per complexity point or minutes over its last 3 runs is more than 30% above its
  baseline, the median of its runs before them with the same provider, model and effort; with the
  baseline vs recent figures and the run ids behind both. A class with fewer than 5 baseline runs
  is not measurable yet; simulated runs never count).
- **Platform**: `issues_search`, `issue_view` and `labels` read a project's issues and labels
  through gh / glab, read-only. An issue card uses existing labels and says whether a duplicate
  was searched.
- **Verify by running**: the `checker` runs a test file or command on a scratch checkout of a
  branch with `MULTIAGENT_SIMULATION_ONLY=1` and returns the result with its evidence (the checkout
  is removed after). A check that costs money or takes longer than ~2 min is a **Run a check** card.
- **Small context**: besides the 150k-token context threshold, an answer that re-read more than
  1M tokens of cache over its tool calls makes the next question start a fresh session
  (`settings.oracle.compactAtCacheReadTokens`).

**Gates: Interact with Oracle** (#183). Every human gate card (Run screen, run chat, Write &
Review) has an **Interact with Oracle** button with the Oracle's avatar at the end of its choices.
It opens the drawer beside the gate (no backdrop: the gate stays answerable on the left) with a
removable context chip such as "Run 20261002-105416-a6668cf0 · #143 · developer_check · branch
feat/143-…". Each question then carries the gate: the run, project, issues, step, workflow and
version, branch and base, the gate's message and choices and the developer's output (summary,
files changed, test notes, evidence plan, left out). The diff is not pasted: the Oracle reads it
and the files with its tools (from the branch when the worktree was removed). Starters under the
box: "What was implemented, in plain words?", "Does it cover every task of the issue?", "What could
break?", "Should I approve or ask for changes?"; you can also type or use voice. While it answers
about that gate its avatar thinks; while it answers another question the button says "Oracle is
answering…" and your question waits in line. When the talk leads to a change request it proposes
the text as a card: **Use this text** fills the gate's feedback box and you still pick the answer.
The Oracle never answers the gate.

### The conflict map

Parallel runs collide in a few hub files (registries, the shared stylesheet, one import line with
many names), even when their issues look unrelated. The **conflict map** counts, per file and per
single line, the finished runs that changed it (from git and the runs' commits only: no model call;
simulated runs never count; a project with no merged run starts from its last commits). It is saved
as `backlog/<project>.conflict-map.json` and rebuilt after each run that merges. When the Product
Owner plans and finds none, it never waits for a whole build (#526): the first **Analyze** runs
without the map (its prompt has no conflict-map section), and once its agent is done the map is built
in the background and saved, so the next Analyze uses it. One build per project at a time; an Analyze
asked while it runs waits a few seconds for it at most. The Product Owner reads it to put groups that touch one hot file
in different stages, and lists each hot spot (changed by more than half of the last 20 runs) under
**Decongest** with a fix in the repository's terms; **File as issue** files one on your click. The
project's page shows the map on its **Conflict map** tab (#354, merged with the repository
performance of a date range; the Roadmap links to it): click a row to see the runs behind its count,
the lines most changed in the file and the trend.

### The Architecture tab

How healthy a project's code is, in any language, and how it changes as runs pile up (#356). The
project's page (**Projects › a project › Architecture**) shows facts the app reads from git, with
no model: per file its lines, its commits (churn), its hotspot rank (lines × commits) and the file
it changes with most (pairs together in at least 60% of the commits of either file), and the
languages by line count. Churn is read on the default branch's current commit (not the checked-out
branch), merges skipped, the creating commit not counted, renames followed,
`.git-blame-ignore-revs` honoured; commits that touched more than 25% of the files are listed as
mass changes (counted by default, with a toggle). Lock files, build output, tests, vendored code and
`.gitattributes`' `linguist-generated` / `linguist-vendored` files are excluded, with a count per
group, plus an editable list per project. The commit, the window (From / To) and a shallow clone are
shown. Complexity per function comes only from a real parser or tool, never a guess (#385):
JavaScript and TypeScript are measured inside the app, with no tool to install and no Python, read
at the facts' commit with the same parser and rules as `scripts/code-health.js` (acorn; one core,
`packages/shared/code-complexity.js`, so both give the same numbers; TypeScript's types are stripped
first, so `enum`, `namespace` and JSX files are not measured). The other languages (Python, Go,
Rust, Java, C#, C/C++, Kotlin, PHP, Ruby, Swift) come from lizard when the machine has it and the
checkout is at that commit, its output checked before use. Without it, the tab names the languages
not measured and how to measure them (`pip install lizard`, which needs Python); their files show no
complexity ("—"), never 0, and churn and size only. Each measured file has its total complexity and its worst function, sits in a quadrant (Danger Zone, Cowboy Code,
Fertile Ground, Healthy Closure, split at the medians on `log1p` axes), the Danger Zone ranks by
`sqrt(u² + v²)` with each axis normalized by its maximum, and monthly frames list the files that
entered or left it. The numbers come from a pure core (`packages/shared/architecture-model.js`, shared
with `scripts/code-health.js --hotspots`), cached per commit. The project's own quality gate
(complexity, coverage, duplication in its CI) is listed as measured, pending or missing: missing
evidence is never shown as clean.

**Analyze this project** (#381: the tab's one action, its combined estimate on the button, ≈ US$
from the project map's past real runs and the last analyses, "no estimate yet" before the first)
starts one run: the project map (the city plan, no gate) and then the Oracle's analysis, one
Oracle turn in its daily budget: it reads the top hotspots and the co-change pairs with its
read-only repository tools and writes a report in English: a summary, a verdict per area, and
findings (kind, files with lines, evidence, severity, one refactor sized as one issue). It never
edits code and never prescribes a fix to a run. An invalid answer is an error, never half a report.
Reports are saved as `architecture/<project id>/<date>.json` in the workspace with their real cost
and tokens; the tab shows the latest (or one you pick), its findings marked **new** or **gone**
since the previous one, and how many real runs finished since. **Send to Refactor** makes a finding
a proposal of the Refactor tab, files its issue and plans it in the roadmap's disabled stage
"Refactor (waiting for your OK)" at the end (#435; see the Refactor tab). The button then stays in
place, disabled, reading "Sent to Refactor", with a link to its issue and stage next to it ("#432 ·
stage 117, waiting for your OK", #447). The same finding from a later analysis adds its evidence to
the existing proposal instead of a second one.

**The project city** (#371) adds structure to the same facts: which area of the product each file
belongs to, and how areas depend on each other, as one deterministic model for the 3D view (#373).
A **city plan** (`architecture/<project id>/city-plan.json` in the workspace, written by the plan
workflow (#372) and checked against its JSON Schema; the plan it replaces is kept in
`city-plan-history/`) names the zones (each one of nine kinds: civic, commercial, industrial,
infrastructure, logistics, power, workshop, library, campus), the districts with `include` /
`exclude` path globs, the landmarks, the ports and the files not drawn (`ignore`). Each drawn file
is a building in the first district whose rules match it (a pattern without a slash matches at any
depth, a leading `/` anchors to the root); the unmatched ones go to the **Outskirts** district. A
building carries its lines, churn, last change and, only when a real parser or tool measured them, its
complexity, worst function and function count ("not measured" otherwise). Without a plan the
districts come from folders: top-level folders are zones, their subfolders districts, a subfolder
under 3 files folds into its parent. Dependency edges are read at the facts' commit: between files
from relative `require`/`import` (JavaScript, TypeScript), between districts from each `Cargo.toml`
dependency on a sibling crate (Rust); for any other language the model says they are not read,
never an empty graph. The validation comes with the model: the share of drawn files matched and the
first 30 unmatched, districts with no files or under 3, unknown zones, duplicate ids, landmark and
port paths missing at the commit, and the plan's schema errors. Same commit, plan and exclusions,
same model (no clock, keys sorted); no model call.

What the numbers can't tell, shown on the tab: churn from a planned migration looks like
instability; complexity tools disagree with each other; code moved between files resets both
metrics; churn says nothing about bugs unless it is joined with fix commits.

### Analysis seeds

Analyses written as prompts, run on any project (#360). A **seed** (`seeds/<name>/seed.md`, seeded
into the workspace like skills; an edited copy is kept) says what it produces, its data and layout
rules, a VERIFY section and what to report back. Four come bundled, adapted from Kent Beck's
ToolSeeds (MIT): `churn-complexity`, `dependency-map`, `quality-gate-report` and
`pipeline-anatomy`.

The **Seeds** section of **Projects › a project › Architecture** lists them with their last run's
date, cost and status (never run, running, stale with the commits since, error, tool available).
**Run** shows the cost estimate first, then the Oracle runs the seed read-only on the project in one
turn of its daily budget. The result, a self-contained HTML page and a JSON model with secrets
scrubbed, is saved as `architecture/<project id>/seeds/<seed>/<date>/` in the workspace;
**Open result** shows it in a sandboxed frame with no network, and **History** lists the earlier
runs.

**Make it a tool** has the Product Owner file an issue in the project's tracker (a preview in
simulation) to build the seed as a deterministic tool in the project's repository: a pure core with
I/O at the edge, network data fetched by a separate step into a cache, JSON with sorted keys and
commit timestamps, a golden test and the seed's VERIFY steps as tests. Once the tool's command is
recorded in the project's settings (`seedTools`), running the seed runs that command instead, free.
A seed reads the network only as it declares, through the platform adapters (the CI's recent runs:
`gh run list` / the GitLab pipelines API). Nothing crosses a human gate.

### Agents: calibrating the Product Owner

How the Backlog's Product Owner trades speed for quality when it plans is the owner's call: a
**Speed ↔ Quality** slider with five steps, in Agents › Product Owner (its **Planning** section,
saved with Save) and in the Product Owner's drawer (the settings button next to **Clear**: a panel
over the conversation, with the model and the effort too; each change saves at once and applies to
the next answer). Both edit the same setting, `calibration` (1-5, default 2) in
`<workspace>/agents/product-owner.json`. Each step's tooltip (hover or keyboard focus) and the text
under the slider say what it prioritises:

| | Speed (1) | 2 | Balanced (3) | 4 | Quality (5) |
|---|---|---|---|---|---|
| parallel runs per stage | as many as do not share files | up to 4 | up to 3 | up to 2 | 1-2 |
| max complexity per group | 6 | 6 | 5 | 5 | 4 |
| UI issues mode | auto unless the owner asks | validated for new screens | validated for new screens | validated for any screen | validated for any screen |
| placement | earliest stage without shared files | earliest stage without shared files | after the work it builds on | after the work it builds on | its own stage after the most stable base |
| review rounds | - | - | - | - | a developer self-review (#179) when the workflow has it |

The Product Owner's prompt states the step and its parameters (they replace the skill's defaults),
the simulated Product Owner follows them, and every plan answer is kept to the step's runs per stage
(a stage with more groups is cut into consecutive stages) with a warning on a group over its
complexity. Plan questions in the drawer, the Oracle's questions to the Product Owner, the "place it
in the roadmap" chain step and the live roadmap's refills all use the saved step, so Add to roadmap
applies groups planned with it. Each answer shows the step it planned with ("Planned for Speed").

**For one question only**: the chip next to the settings button shows the step of the next
question; pick another one there, or write it in the question ("plan this one for quality"), and
only that question uses it: the saved setting does not change.

**The second axis, Cost: Economy ↔ Generous** (#205). Most of a run's cost is decided when the work
is planned: how many runs (each pays a fixed overhead), which tests run (#203) and which models the
agents use. A second five-step slider sits under Speed ↔ Quality in both places (same tooltips and
"what this step does" line), saved as `cost` (1-5, default 3) in the same file:

| | Economy (1) | 2 | Balanced (3) | 4 | Generous (5) |
|---|---|---|---|---|---|
| max complexity per group | 8 | 7 | the Speed ↔ Quality step's | 5 | 4 |
| grouping | issues of one area or files packed into one run ("grouped to pay the run overhead once") | the same | as Speed ↔ Quality plans | as Speed ↔ Quality plans | as Speed ↔ Quality plans |
| `unit_tests` | run existing, then a `test-backfill` item after the stage | write and run | write and run | write and run | write and run |
| `e2e_tests` | write | write | write | write | write and run |
| `screenshots` | off | changed screens | changed screens | all | all |
| agents | cheaper models and a medium effort where the workflow has an input for them | the same | the workflow's | the workflow's | the workflow's |

When the two sliders disagree, cost wins: the group cap is the Cost step's (Speed + Economy gives
fewer, larger runs); the runs per stage stay the calibration's. The orchestrator applies the step to
every planned group, whatever the model wrote: it packs a stage's groups that share an area (name,
files, epic or topic label) within the cap, sets `unit_tests`, `e2e_tests` and `screenshots` when the
group's workflow declares them, and at Economy adds a stage with one `test-backfill` item for the issues
that ran with their existing tests only (a test-backfill item may name issues another item holds, and
runs even when they are closed). An input a workflow does not declare is not adjustable: the group
says so (the bundled development workflows have no model or effort input, so "agents: not
adjustable"), and no workflow is edited. Each group, and the roadmap item added from it, carries a
cost badge with these choices; you can still change the item's inputs. Each plan answer shows both
steps ("Planned for Speed · Economy") and the plan's estimated total. For one question: the Cost chip
next to the calibration chip, or "plan this one cheap" in the question.

**Screenshots on or off** (`screenshots` input of both development workflows, #205): `all` (the
default: as before), `changed` (only the screens the issue changes, original and modified) or `off`
(no `developer_screenshots` step, no `npm run screenshot` by the test or evidence agents: the evidence
is the diff, the logs and the test results, and the gates say "Screenshots: off"). The evidence step
costs about $0.3-1.5 and 5-10 minutes of Electron time per run.

To measure: compare $/run and $/issue over a week at Economy with the baseline of 2026-10-01/02
(~$11.7-11.9 per run, the test step about half of it), from the runs' `summary.json` or Usage.

### From a finding to an issue (#730; the Refactor tab of #357 is gone)

A finding of the Oracle's report becomes an issue from where it is: **Projects › a project › Health**
(and the onboarding's review). There is no separate proposals list and no Product Owner ranking any
more: the finding is the diagnosis and the issue is what gets worked on.

- **Create issue** (`architecture:createIssue`, `fronts/analyser/engine/channels/architecture.js`):
  files the finding in the project's tracker with its text, files and evidence and the `refactor`
  label (created first when missing on GitHub; GitLab creates it on filing), naming the Refactor
  workflow (`runDraft` of `packages/engine/domains/refactor/refactor-issues.js`). The finding then shows
  the issue's link instead of the button; a finding already filed is not filed again. **Create issues**
  files the selected findings the same way.
- **Create issue and prioritize**: the same, then the issue is planned as a roadmap item in the waiting
  stage below; the finding shows its stage too.
- **Older proposals** (`<workspace>/refactor/<project>/proposals.json`, made before #730) stay
  readable, listed under the finding they came from, with their issue when they have one. The store,
  the cadence and the success-on-the-map records below keep working for them; nothing new is added to
  the proposals store from the page, and the onboarding sends nothing there on its own.

The rest of this section describes the #357/#435 rules the issue path reuses:

- **The waiting stage** (#435): Create issue and prioritize (the Health tab) files the issue and plans an item on the Refactor workflow in a disabled stage at the end of the
  roadmap, "Refactor (waiting for your OK)", created when there is none; the proposal records its
  `before` score. Nothing runs until the owner enables that stage: enabling it is the authorization.
  Later sends join it while it is disabled; once it is enabled, the next send opens a new waiting
  stage at the end. Stages the Product Owner or the cadence add go before it, so it stays last. A
  proposal on a file an item of the stage already changes joins that item (one run). Each row
  names its issue and stage ("#432 · stage 117, waiting for your OK"). Without a synced backlog the
  send only creates the proposal.
- **Add to roadmap now**: one item on the Refactor workflow in the waiting stage, as above. **Run
  now** plans it instead by the Product Owner's rules (the earliest stage that shares no file with
  it, never before an item it conflicts with), and never inside the stage in progress: at the
  earliest the stage after it, enabled.
- **Dismiss** asks a reason; dismissed proposals stay under the **Dismissed** filter.
- **The cadence** "Add a refactor to the roadmap every X runs" (off by default, X from 3 to 50):
  after every X finished real runs of the project, the top ranked proposal that has an issue and no
  unfinished roadmap item joins the roadmap by those rules (not in the waiting stage). With none ready, nothing is added and the
  tab says "Nothing ready to add: prioritize or file a proposal". The item counts in the budget cap
  like any other, and nothing answers a gate.
- **Success on the map**: when a refactor joins the roadmap its target's quadrant and Danger Zone
  score are kept with the proposal; after its run the row says whether it left the Danger Zone or how
  much its score dropped, and marks a target that did not improve. The header counts the files that
  left the Danger Zone through refactor runs in the last 30 and 90 days.

### Roadmap cost estimates and the spending budget

**Estimates before running** (#206, `packages/engine/domains/usage/cost-estimate.js`). Each roadmap item shows "≈ $X" and each
stage "≈ $Y" (the sum of its items). The tooltip says how it was computed and from how many runs.
An item's estimate comes from the last 30 successful real runs of its workflow in the project. Each
past run's cost is split by step (its sessions' `step_id`) and divided by its complexity (the
`complexity:n` labels of its issues, 3 for an issue without one). The estimate is the median per
step × the item's complexity. A step the item's inputs change is read from past runs with the same
inputs when there are at least 3, else scaled:
- the test step by `unit_tests` / `e2e_tests` (#203): run existing ×0.35, off ×0.25, E2E write and
  run ×1.3;
- the evidence step by `screenshots` (#205): changed ×0.75, off ×0.5. With screenshots off, the
  `developer_screenshots` step costs nothing.

So the Cost step shows up in the estimate through the inputs it sets and the size of its groups. An
item without history says "no estimate yet". Once an item has a run, its real cost shows next to the
estimate ("so far" while it runs). The Product Owner's plan answers show the plan's estimated total.
Codex reports no cost, so its sessions are priced from tokens × the model prices of Usage, and the
estimate is marked estimated.

**The roadmap's summary** (#421, `packages/shared/roadmap-summary.js`). The roadmap bar shows "Planned
≈ $X · ≈ T (n items, m stages)" for what is left: the items of the enabled stages that are not
finished, a running item for its estimate minus what its run has spent and elapsed (never below
zero). Disabled stages, done and skipped items are left out. Stages run one after another and a stage
lasts as long as its longest item, so the time is the sum of the stages' times: work time, human
gates not included. Items without an estimate are listed as "+ n without estimate" (the tooltip
names them), never counted as zero. "Spent $Y" next to it is the real cost of the roadmap's done and
running items, since its oldest item. With release cut lines (#260), **By release** lists each cut
line's stages (from the previous line) plus its release run when the release workflow has history,
then the part after the last line.

**A budget that pauses before overspending** (Settings › General › Budget: `budget.dailyUsd` per
local day, `budget.nightlyUsd` per Night watch night, from its start; empty = no cap). Spending is
what real runs recorded (their sessions' `cost_usd`, live runs included). The cap stops starts,
never runs mid-way or gates. Before a roadmap starts a real item, if what is spent plus the item's
estimate would pass a cap, the roadmap pauses before it. You get a notification: "Budget reached:
$X of $Y today; next stage ≈ $Z". The roadmap bar then offers two buttons:
- **Raise for today** (or tonight): the cap becomes what is spent plus the next stage, for that day
  or that night only (`budget.raised`).
- **Resume anyway**: this roadmap ignores the cap until the day or the night ends (the roadmap's
  `budgetWaived`).

A run already started finishes, and no human gate is answered. The live roadmap's refills (#164)
and the Night watch's roadmaps respect the same cap. The top bar shows today's spending next to the
month's usage, "$38 / $60 today", or tonight's while the Night watch is on.

### Agent providers per run, fallbacks and limits per model

**Any agent's provider and model, for one run** (#262). The Start drawer (under Advanced
parameters), the Backlog's Assign dialog and a roadmap item's Edit list each agent of the workflow
under **Agents**: its provider, model and effort, with the workflow's values as defaults. A change
applies to that run only. It is recorded in the run (`workflow.started` `agents`), and a resume
applies it again. The workflow file and the next runs keep their own values. A workflow no longer
needs its own `*_model` inputs for this. AI Development's `developer_model` is one case of it.

**Fallbacks when a provider runs out of credits** (#262). There are two places to declare an
ordered list of entries:
- a workflow, per agent or in `defaults`: `fallbacks: [claude:claude-opus-5-5, codex:gpt-6-luna]`;
- Settings › Agents & CLIs › Fallbacks, one list per provider, for the agents whose workflow
  declares none.

A turn can fail with the provider's quota, credit or usage-limit message. Claude, Codex and Grok are
recognized, e.g. "You've hit your usage limit" or "Credit balance is too low". Then the engine reruns
that turn on the next entry, in a fresh session started from the agent's handoff note, and keeps that
choice for the rest of the run. It tells you three ways:
- a "fell back" line in the run chat, with the reason;
- a mark in the run's agents table;
- a notification, since the provider may be out of credits.

Each turn in the run chat shows the provider and model that answered it. Other errors keep the
normal retries. With no entry left, the run fails with the provider's message. A fallback never
skips a step or a gate.

**Limits that follow the model** (#262). Declare them once per model, in a workflow
(`models: { claude-fable-5-1: { timeout_factor: 3 } }`) or in Settings › Agents & CLIs › Limits per
model. An agent on that model gets its turn timeout multiplied by the factor. A run with an agent on
it may spend up to the model's `max_total_cost_usd` when that is above the workflow's cost limit.

### Chaining workflows: When it finishes

A run can hand its result to what comes next. The Start panel, the Backlog's Assign dialog and a
roadmap item's Edit form have an optional **When it finishes** choice:

- **Nothing** (the default).
- **Start a workflow with it**: pick the workflow; each of its inputs can take one of this run's
  declared outputs (e.g. `issues ← issues`, `task ← document`), proposed for the pair and editable,
  and its own short inputs (`mode`…) are set there too. Its folder, branch and language come from
  this run. The next run shows "← from <run>".
- **Ask the Product Owner to place it in the roadmap**: the Product Owner gets the produced issues
  and proposes where they go, as planned roadmap stages. Nothing starts until you press Start.
- **Plan the issues in the roadmap**: what the issue tracker's **Create and plan** does (it is the
  same chain, set by that gate choice): the produced issues become a new last roadmap stage with the
  chosen workflow, planned, never started by itself. A chain saved by an older version with the
  Backlog queue as its target plans the stage the same way.

Under the choice, the workflows that will run and a rough cost from your past runs, marked as an
estimate. The next step starts only when the run finished with **success** (a development workflow
must also have merged). A run that failed, was cancelled or stopped at a gate **pauses** its chain
with a notification: the Run screen's chain banner then offers **Resume chain**, **Edit** and **Drop
chain**. While the run goes, the banner edits or cancels the chain. Chaining never answers a gate:
each workflow's gates still wait for you. Simulated runs only chain simulated runs.

Each workflow declares what it hands over (`outputs:`, recorded in `summary.json`): issue
`issues`; write-doc `document`, `issue`; feature `branch`,
`merged_commit`, `issues`, `pr_url`; analyze-project `issues`, `report`; retrospective `findings`. The run
lists and the run chat show "→ then: <workflow>" on a chained run. Engine details:
[docs/agents/engine/chaining.md](docs/agents/engine/chaining.md).

### A workflow as a step (child runs)

A step can run another workflow, once or once per item of a list, and use its outputs:

```yaml
- id: develop
  type: workflow
  workflow: software-development.yaml
  inputs: { task: "{{ item.title }}", repo_path: "{{ inputs.repo_path }}" }
  foreach: "{{ steps.plan.output.issues }}"   # optional: one child run per item
  max_parallel: 2                             # optional, with foreach (default 1)
```

Each child is a normal run (its own folder, worktree, sessions and gates), listed under its parent;
the Run screen links both ways. Its gates wait for you, and so does the parent.

- **Limits and cost**: a child takes a slot of Settings › Execution › Concurrent runs like any run;
  its parent, which only waits, lends it its own slot. When no slot is free the child waits for one
  instead of failing (with a limit of 1 the children run one at a time). Children count in the
  monthly budgets. Each child has its own context limit (`max_total_context`); the parent's
  `max_total_cost_usd` includes what its children cost. The run lists and the Run screen show the
  children's total cost next to the parent's own.
- **Stop and resume**: stopping the parent stops its running children, and the Stop button asks
  first. Resuming the parent from that step reuses the children that succeeded and resumes the
  others from where they stopped (gates still ask again), instead of starting them from scratch.

Engine details: [docs/agents/engine/workflow-step.md](docs/agents/engine/workflow-step.md).

### Resuming a run from a step

A finished, failed, cancelled or interrupted run (e.g. by an app restart) can go on from any step
without asking the supervisor: **Resume from step…** in the Run view (Details), in the run's row in
**Workflows › Runs** and **Projects › a project**, and in the run chat's end-of-run note. An interrupted run (the app closed while it ran or waited at a gate, #288) ends its chat with "Interrupted at <step> (the app closed)", its cost and time so far and a primary **Resume**, which opens the dialog with that step (the gate's, when it stopped at one) preselected; a gate it left open says it was waiting when the run was interrupted, its choices are disabled, and it offers Resume too. A roadmap item whose run ended this way has **Resume run**. It is not
offered while the run is active, and it makes no LLM call.

The dialog lists the workflow's steps in order, marks the ones the run reached and where it stopped,
and pre-selects that step (or the failed one). An optional **Instruction for the agents** goes to
the chosen step. It says what is kept (the previous steps' outputs, the agents' sessions and handoff
notes, the worktree and branch, or a new worktree from the base when it was removed) and what runs
again (the chosen step and the steps its transitions lead to). The resume is a new run.

Human gates are never crossed by automation: every gate reached again asks again, and a step after
a gate the run already decided is refused (resume from the gate instead), unless you tick **Approve
<gate> again** in the dialog. That box shows the commit approved at the gate and the branch's
current commit, and is only offered while they are the same; your confirmation is recorded in the
new run as your approval ("confirmed at resume"). The supervisor and the roadmap never confirm a
gate. The dialog pre-selects the step where the run stopped (or the nearest allowed step before
it). A run stopped by a limit (the context limit's gate, the cost or time limits) resumes at that step, and the dialog says the resumed run counts its limits from zero: it is a new run, so its own turns' context, cost and time start again (the gate asks again only once it reaches the limit). In Developer mode the dialog has the Simulation toggle; a simulated run always resumes as one.

### Roadmap: kept work from an ended run

A failed, cancelled or interrupted run keeps its work on its branch. When a start would do the same issues again (roadmap
**Retry**, Resume on a paused queue, Start/Assign on an issue, Write & Review from an issue), the
app asks first, with the same question everywhere (#288), e.g. **#282 + #284 + #285: a run stopped at Evidence**:

- why it stopped, in one line: at a human gate (which one) when the app closed, the app closed, a
  failure (its first line), a limit, or cancelled by the owner;
- what is done (the steps passed), what is left, and what it cost (US$ and time); when main moved,
  "main moved 13 commits since: the run merges it at the end";
- when the item groups more issues than the old run had: "the old run only covers #113";
- **Details**: the commits the old run made **itself**, how far its base is behind today's main, the
  files it changed and how many of them changed on main too;
- **Resume** resumes the old run at once, at the step where it stopped; **choose another step…**
  under the buttons opens Resume from step… instead;
- **Start over**: a new run from today's main, saying what it spends again; the old commits stay in
  their branch.

Resume is the primary button (Enter) when the old run has commits of its own; Start over only when
it ended before any commit. Cancel (Esc) never is. Automation never answers: the roadmap and the
queue pause with the same text until you choose.

### Parallel steps

Steps with `agents: [a, b, c]` run in parallel (fan-out; `min_success` sets how many must answer)
and return `{ results: { agent: output }, succeeded, failed }`. `save_as` writes the answer to a
file (relative to the run folder); an entry `{ path, content: "{{ output.document }}" }` writes one
field of a JSON answer instead.

An agent's `provider`, `model` and `effort` can be templates over the inputs
(`model: "{{ inputs.writer_model }}"`), so the user picks them per run; `cli_args` can then be a map
keyed by provider. A provider's `effort_args` (e.g. `["--effort", "{{ effort }}"]`) are added when the
agent sets an `effort`. `max_visits` and `loop.max_iterations` accept templates too. An agent's
`enabled` (a boolean or a template, e.g. `"{{ inputs.contender_5_provider != 'none' }}"`) leaves it
out of the run: fan-out steps run without it and `min_success` is capped at the agents left.

A `human_approval` step with `feedback: true` (or `{ label, placeholder }`) also asks for an optional
free text: it is the gate's `output.feedback`, and every non-empty one is added to `feedback`
(`[{ step, choice, text }]`, the whole run) for the next prompts. `previous_step` is the id of the step
that ran before the current one.

An agent step with `ask_human: true` (and an `output_schema`) lets its agent ask the owner (#567): an
answer with `needs_human: { question, options: [{ id, label }], default }` opens a `kind: decision`
gate on the step with the question, the options and free text; the answer comes back to the same
agent's next turn as `human_answer` (and in its prompt), and the step's transitions run only after
that turn. Without the field the answer's `needs_human` is an ordinary field (a warning). See
`docs/agents/engine/gates-and-run-end.md`.

`on_error: <step>` keeps a failing step (agent error, output that never validates) from ending the
run: its output becomes `{ error }` and the flow continues at that step (the arena's `verify` uses it,
so a verifier failure still reaches the human review with the document). When an answer does not
validate, the engine asks again with the schema; ephemeral agents also get the task and their
previous answer back, since their retry runs in a fresh session.

A transition can also take `on_error: <step>`: when its `action` (or `merge: local`) fails, the run
goes there with the error in `action_error`, instead of failing. Merges can be guarded:

```yaml
- id: approve_merge
  type: human_approval
  check:                        # checked right before the gate opens, and after other runs' merges
    probe: pr_mergeable
    target: "{{ steps.ci.output.pr_url }}"
    on_fail: merge_failed       # not mergeable: the gate is not opened (or is withdrawn)
    recover: [resolve_conflict] # ...and the supervisor may send the run back there first
  transitions:
    - when: "approved"
      precheck: true            # the check again, right before the action (one merge at a time)
      action: "gh pr merge ..."
      on_error: merge_failed
      recover: [resolve_conflict]
      goto: deploy_prod
```

`set: { name: value }` on a transition sets a run variable (`vars.name` in templates), e.g. the
local-hero workflow's `vars.recheck == 'resolution'` scopes the checks after a conflict.

### Transitions: limits and how a run ends

```yaml
transitions:
  - when: "output.tests_status == 'fail'"
    delegate: { agent: developer, prompt: "Fix: {{ output.failure_report }}" }
    goto: test
    max_visits: 3              # this transition, at most 3 times per run...
    on_exhausted: test_failed  # ...then here, WITHOUT the delegation (nothing would check that fix)
  - when: "rejected"
    goto: end
    status: failed             # the run's outcome: success (default), failed or cancelled
```

- `goto: end` ends the run as `success`. Add `status: failed` or `status: cancelled` when the run
  ends without delivering: a rejected failure gate is `failed`, a rejected merge or review is
  `cancelled`. `status` also applies when `on_exhausted: end` ends the run (e.g. the arena's redo
  limit), and is rejected on a transition that cannot end the run.
- The outcome is the `status` of the `workflow.finished` event and of `summary.json` (with an
  error such as `Run ended as failed at step "preview_failed" (choice == 'stop')`), and the
  `step.transition` event to `end` carries it. Like any failed or cancelled run, the worktree is
  kept so the run can be resumed, and the UI shows it as failed/cancelled.
- `goto: fail` still ends the run as `failed` with "retry limit reached"; it is the default of
  `on_exhausted`.

### Step groups: progress in the runs list

```yaml
groups:                        # optional; the graph ignores it (transitions still name step ids)
  - name: Develop
    steps: [develop]
  - name: Review
    steps: [code_review, human_review]
  - name: Validate
    steps: [test, test_failed, build, build_failed, evidence, verify_change, verify_failed]
```

- Each run in the runs lists (Workflows › Runs, Projects › a project) shows the groups it has
  visited so far, in order: the robot of each agent that worked there (a person for a human gate;
  hover for step, agent, provider/model, duration and cost), the group name and its state: ✓ done,
  the step running, "waiting for you" at a gate, ✕ and the step where the run failed. Coming back
  to a group shows it as "Develop ×2".
- The Run screen's sidebar lists only the steps that ran, one collapsible section per group (the
  current step's group open); "Show all steps" adds the others.
- A step in no group is shown on its own, by its readable name; a workflow without `groups:` shows
  each visited step. `loadWorkflow` rejects unknown step ids, a step in two groups and duplicate
  group names.
- Names on screen (#245): a step or an agent may set `display: "Final verification"` (1 to 40
  characters); without it the screens make the id readable (`acceptance_tests` → "Acceptance
  tests"). The id stays in the tooltip; prompts, events and transitions keep using the ids. The
  Workflows editor edits it ("Display name").

  ```yaml
  agents:
    verifier:
      display: Final verifier
  steps:
    - id: verify_change
      display: Final verification
      agent: verifier
  ```
- The engine records the groups in `workflow.started` and, in `summary.json`, `progress`: the step
  visits in order with their agents, status, duration and cost. Runs without it (in progress,
  interrupted, older) get it from `events.jsonl`.

### Run titles and PRs

- Every run has a **display title**: its issue ("#12 Notifications"), else the first line of its
  task. Hover it and click the pencil to give it your own ("Notifications, 2nd try after
  conflict"); an empty title goes back to the default. It is saved in `runs/<id>/meta.json`
  (`events.jsonl` is never changed), a resumed run inherits it, and it is shown everywhere a run is
  listed: Workflows › Runs, Projects › a project, the left sidebar's run list, the Run screen, the run
  chat, Backlog cards, toasts and desktop notifications. The workflow name stays next to it.
- A run that opened a pull/merge request (the latest step output with `pr_url` / `pr_number`, e.g.
  the `ci` step; a resumed run shows the PR of the run it resumes) shows it in the same places: the
  pull-request icon coloured by the PR state and its number, a link that opens the PR in the
  browser. Blue: open, checks running; green: ready to merge; red: checks failing; orange with "!":
  conflict; grey: draft (or state unknown); purple: merged; grey struck: closed without merge. The
  tooltip says the state in words and when it was checked. The app reads it with
  `gh pr view` / `glab mr view` (no model call): every minute and on run events for the runs in
  progress, when a list shows them for finished runs (cached 5 minutes; merged and closed PRs are
  final). Simulated runs' PRs are not real and are not read.
- **Open run** (a run card, #409) opens any run in the Run screen on its Details tab, also one this window never saw: a finished run is
  rebuilt from its `events.jsonl`, read-only (no Stop, no gates). After a reload (Ctrl+R) or
  reopening the app, the runs in progress are rebuilt the same way, so their steps, sessions,
  orchestrator log and pending gates are all there.
- **The Run screen's tab row** (#410, #412) is its first row, the same on the run chat: the tabs
  **Chat | Details | 3D**, the run's status and id, then on the right the run's actions (on Details:
  "+ When it finishes…" for a live run without a chain, Ask the supervisor, Watch, Resume from
  step…, Review changes, Save to issue…, Open in Analytics, the map buttons) and, for a live run
  of this window, **Pause after current step** and **Stop**. On a narrow window the actions wrap
  to a second line. The fail, pause, chain and gate banners come below it; a live run without a
  chain shows no chain banner. In Details the right panel opens on **Artifacts**, before Session
  and Events.

### A git worktree per run

A workflow whose agents change a repository can give every run its own checkout, so runs never
share (or leak) branches, dirty files or a stale local base, and two runs of the same repository
can go at the same time:

```yaml
orchestrator:
  worktree:
    repo: "{{ inputs.repo_path }}"   # the repository (a subfolder works too)
    base: "{{ inputs.base_branch }}" # fetched from origin at run start
defaults:
  working_dir: "{{ worktree_dir }}"  # agents work in the run's worktree
```

- **Start**: `git fetch origin <base>` (no network or no remote only warns and falls back to the
  local base), then `git worktree add --detach <workspace>/worktrees/<run_id> origin/<base>`.
  `worktree_dir` (templates) points to it, and actions (e.g. the merge command) run there.
  `git worktree prune` runs on the repository first. The worktree is outside the run folder, so it
  never shows up as an artifact.
- **Success**: the worktree is removed (`git worktree remove --force` + `prune`) and the run's
  local branch is deleted if it is merged into `origin/<base>` (squash merges included); otherwise
  the branch is kept.
- **Failed, cancelled or interrupted**: the branch keeps the work, not the folder. A detached
  worktree gets a branch (run/<run id>), anything uncommitted becomes a WIP commit naming the run,
  then the folder, the run's scratch and its temp folder are removed (the branch never is). **Resume** from a step
  recreates the folder, at the same path, from the run's branch (so resumed CLI sessions keep their
  working directory) and gives the WIP back as uncommitted work. The app cleans up the folders of
  ended runs at start and every 30 minutes; a run in progress, live in another app window or waiting
  at a human gate keeps its folder.
- **Temp folder and antivirus**: every process of a run (the agents' CLIs, the suite and e2e
  steps) gets `TMP`, `TEMP` and `TMPDIR` pointing to `runs/<id>/tmp`, removed when the run ends
  (any end but paused). So everything a run writes, the tests' temp files included, is inside the
  workspace: exclude the workspace folder from your antivirus (Windows Defender: Virus & threat
  protection › Exclusions) to keep parallel suites from saturating the CPU.
- The path, branch and outcome are in `summary.json` (`worktree`) and in the `worktree.ready`,
  `worktree.kept` and `worktree.removed` events. Sessions record their `cwd`; a session terminal of
  a removed worktree opens in the repository folder instead.
- **Processes left running**: after each agent step (delegations included) and when the run ends,
  the engine stops the processes started from the worktree that are still running (an Electron UI
  check, a dev server), with their process trees: their executable is inside the worktree (Windows,
  Linux, macOS) or, on Linux/macOS, their working directory is (processes with a terminal, such as
  your own shell there, are spared). Nothing outside the worktree is touched, nor the app itself
  and its terminals. What was stopped is logged (`worktree.processes_stopped` event and a warning).
  Otherwise such a process locks files and every later `npm ci` fails with EBUSY.
- **Not a git repository**, or a simulation (mock) run: no worktree, `worktree_dir` is the
  repository folder itself (the old behaviour).
- **Orphans**: at startup the app removes worktrees whose run succeeded (a removal that failed) and
  worktrees unused for 14 days; failed runs' worktrees stay until then so they can be resumed.
- A fresh worktree has no installed dependencies: the developer and the test/build skills install
  them when missing (`npm ci`, `uv sync`, `dotnet restore`…).
- **Starting a run executes the repository's own scripts** (#472): the dependency install at
  checkout (`npm ci`, with its `postinstall`), `npm run check` when `package.json` has one, and the
  detected test command run with your privileges before or without any agent turn. The run's first
  `log` event names them. The project setting **Install dependencies without running their
  scripts** (Projects › Edit) adds `--ignore-scripts` to the install; it is off for your own
  folders and on for a repository the app cloned (Backlog / Discovery). The check and test
  commands still run: only use repositories you trust.
- Merge action: `gh pr merge` runs with `--repo <owner/repo>`, so gh merges and deletes the remote
  branch server side only. Without it, `--delete-branch` also checks out the base and deletes the
  local branch, which fails in a worktree (the base is checked out in the main checkout, and a
  branch checked out in a worktree cannot be deleted). The engine deletes the local branch itself.

Enabled in `software-development`. The other bundled workflows only read a folder
(`multi-model-review` reviews whatever branch the given checkout has) and do not use it.
<!-- /generated:engine -->

## CI/CD

GitHub Actions run only for a release (owner decision of 2026-10-31): a push to `main` and a pull
request build nothing, so no Actions minutes are spent between releases.

- `.github/workflows/ci.yml`: **by hand only** (Actions › CI › Run workflow): a syntax check,
  `npm test` on Ubuntu, Windows and macOS (checks `test (<os>)`) and a production `npm audit`. When
  pull requests trigger it again, it plans per PR: Ubuntu and Windows, macOS too when the PR touches a
  platform-sensitive path (worktrees, processes, terminals, packaging, dependencies, CI) or has the
  `ci:macos` label (from the next push). A docs-only PR
  (`.md` files other than `AGENTS.md`, `CLAUDE.md`, `docs/agents/`, `skills/`, `docs/screens/` and `docs/features/`,
  which the tests read) runs no
  tests. A new push to a PR cancels the previous run. The `test` check is green only when every
  planned OS is: use that name in branch protection. Each run records a `ci/tested` commit status
  on the PR head (a PR's checks belong to GitHub's merge commit, not the head): pending when it
  starts, then success or failure, so only the latest run counts. The
  plan lives in `scripts/ci-plan.js`.
- `.github/workflows/preview.yml`: test environment. Triggered by the Deployer, publishes the
  pre-release `preview-pr-<n>` from the PR branch: the Windows build by default, `-f os=macos`,
  `linux` or `all` for the others. It keeps the builds a pre-release of the same commit already has
  (`-f rebuild=true` forces them) and skips `npm test` when the PR head has `ci/tested`.
- `.github/workflows/deploy.yml`: production. A pushed `vX.Y.Z` tag (the app's **Promote to stable**
  pushes it) packages the app on `windows-latest` (win32 x64), `macos-latest` (darwin arm64),
  `macos-15-intel` (darwin x64) and `ubuntu-latest` (linux x64, AppImage and tar.gz), runs
  `npm test` on each, launches each package in simulation until it quits by itself
  (`scripts/smoke-package.js`, `xvfb-run` on Linux; a failure stops the release) and publishes all of
  them as the release `vX.Y.Z`, marked latest. A manual run on `main` publishes a prerelease
  `vX.Y.Z-rc.N` instead, to try a build before tagging it. A job skips `npm test` only when the PR's
  CI tested the same tree.
- `.github/workflows/pages.yml`: the public page (`site/`, `npm run site`) on GitHub Pages, published
  with each `vX.Y.Z` tag, on a push to `main` that changes `docs/work/`, the changelog or `site/`, or by
  hand; off until the repository variable `SITE_PAGES` is `on`.

Standard GitHub-hosted runners are free for public repositories; CI still runs only what a change
needs, so it stays fast, and every job has a `timeout-minutes`. A pull request from a fork gets the
same tests and a green or red `test` check, but records no `ci/tested` status (its token is
read-only), so preview and deploy run the tests themselves. Never use a self-hosted runner
(`runs-on: self-hosted`) on a public repository: a fork's pull request could run its code on that
machine.

**Actions quota in the app.** The Usage screen has a **GitHub Actions** card: this month's quota
minutes (multipliers applied) against the included ones (`actionsIncludedMinutes` in
`settings.json`, 2,000 by default for GitHub Free), per runner, with a warning at 80%. It reads
`gh api users/<login>/settings/billing/usage`, which needs gh's `user` scope
(`gh auth refresh -s user`, optional: without it the card says so). When the quota is exhausted,
the `ci` step of `software-development` does not wait for checks that never start: it finishes as
`failed` with `failure_class: infra` and "GitHub Actions quota exhausted until <date>", and goes
straight to the `ci_failed` gate (no fix round).

The CI/CD agents use the GitHub CLI (`gh`) or the GitLab CLI (`glab`), which must be
authenticated (`gh auth login` / `glab auth login`).

## Providers, availability and budgets

Workflows use three CLIs: **Claude Code**, **Codex CLI** and **Grok Build**. Install and log in to
all three (free plans are enough to start). Before a real run, the app checks that every CLI the
workflow's agents use is installed; if one is missing, the run does not start and the error says
what to install. Simulation mode needs none of them.

**Budgets** (Usage screen, stored in `settings.json`): a monthly limit per provider in USD and/or
tokens. Usage comes from every non-mock run's `summary.json` plus the run in progress. The engine
checks the budget before each agent turn: it logs a warning at 80% and, when "block runs" is on,
stops the turn at 100% (a run that would start over budget is refused).

- Claude Code and Grok report the cost of each turn. On subscription plans that cost is the
  API-equivalent value: treat it as a usage indicator.
- Codex does not report cost: set a price per model (USD per 1M tokens) in Usage to estimate it,
  or use a token budget.
- Tokens = input + output + cache read + cache write (reasoning is already inside output).

**Scope toggle** (Usage screen and the topbar popover):
- **Orchestrator**: only this app's runs (their summary.json files).
- **This machine**: everything the CLIs recorded locally, including use outside the orchestrator
  (interactive Claude Code sessions, other tools running the CLIs). Read from
  `~/.claude/projects/**/*.jsonl` (Claude Code; chunks of the same message counted once),
  `~/.codex/sessions/**/rollout-*.jsonl` (Codex) and `~/.grok/sessions/**/usage.json` (Grok), by
  `packages/engine/domains/local/local-usage.js`. The orchestrator's part is matched by provider session id.
- Codex is metered by the ChatGPT plan's rate-limit windows and credits: its logs carry the plan
  type, the % used of each window and the credit balance, shown on the Codex card.
- Claude Code's local logs have no cost, so outside usage is priced only if you set model prices.
- Account-wide usage (claude.ai web/mobile, other machines) is not available: subscription plans
  have no public usage API.
- A budget can **count usage outside the orchestrator** (per provider option): the pre-run check
  and the per-turn checks then use this machine's totals.

## How sessions are opened (no tmux)

Each turn of each agent is a headless child process of Electron:

| Provider | Command | Stream |
|---|---|---|
| Claude Code | `claude -p --output-format stream-json --verbose --model <m>` | thinking, text, tool_use, `result` with usage/cost |
| Codex CLI | `codex exec --json --skip-git-repo-check -m <m> -` | reasoning, agent_message, command_execution, `turn.completed` with usage |
| Grok Build | `grok --output-format streaming-json -m <m> --prompt-file <tmp>` | thought/text deltas, tool_call(_update), `end` with session id, usage and cost |

- The prompt is sent via **stdin** (avoids escaping problems with `cmd.exe`), or through a temporary
  file for CLIs that need one (`prompt_file_arg`, used by Grok).
- `persistent` sessions are resumed with the `session_id` returned by the provider
  (`--resume <id>` / `codex exec ... resume <id>` / `grok --resume <id>`).
- The command lines live under `providers:` in the YAML and can be changed without touching code.

### Session modes and handoff notes

```yaml
defaults:
  max_context: 150k        # persistent agents: a fresh session once a turn ends above this
agents:
  developer:
    session: handoff       # persistent (default) | ephemeral | handoff
```

- `persistent`: one conversation for the whole run. With `max_context`, a turn that ends above it
  (its largest request) makes the next turn start a fresh session from the agent's handoff note;
  a turn is never cut in the middle.
- `ephemeral`: a fresh session per turn with only the step prompt.
- `handoff`: a fresh session per turn that gets the system prompt, the skills, the agent's latest
  handoff note and the new request. The code itself is in git, so the note stays short.
- **Handoff notes**: persistent and handoff agents end each turn with a ```` ```handoff ```` block
  (goal, branch and commits, done, left, decisions and why, key files, known problems). The engine
  takes it out of the answer and saves it as `runs/<id>/handoffs/<step>-v<visit>-<agent>.md`; it
  shows in the run chat (under the answer) and in Artifacts. When a turn that needs one forgets it,
  one short follow-up in the same conversation asks only for the note. The supervisor reads the
  notes instead of full transcripts, and a resumed run starts its agents from them.
- Works the same for Claude Code, Codex and Grok (a fresh session = no `--resume`). The context size
  per request comes from Claude's and Grok's streams; Codex doesn't report it, so `max_context` does
  not rotate Codex agents (use `handoff` for them).

### Agent capabilities and isolation

What an agent may use is declared per agent (and per step when needed); the engine turns it into
each CLI's own flags. This is context economy (fewer tools offered, a smaller prompt), not a
security boundary: only Codex's sandbox is enforced by the OS (see "Security model"):

```yaml
agents:
  ci_pusher:
    capabilities:
      tools: [read, bash:git, bash:gh, bash:glab]   # also edit, write, bash (any command)
      web: false            # web search / fetch
      mcp: []               # MCP servers from the workflow's mcp_servers, none by default
      subagents: false      # the CLI's own sub-agents
steps:
  - id: research
    agent: ci_pusher
    capabilities: { web: true }   # this step only, merged over the agent's
```

- **Isolated by default**: agents run the user's CLIs headless, but without the user's personal
  setup: no MCP servers (e.g. a logged-in browser), plugins, user settings, CLI skill listings or
  auto-memory; only the project and what the workflow declares. `isolation: false` on an agent (or
  in `defaults`) turns it off. Claude Code drops the user's setup (the agent still runs as you);
Codex drops the user's MCP servers,
  plugins, apps, browser/computer use and memories; Grok has no flags for it (only its tools are
  restricted). What a CLI can't enforce is written to the run log.
- **Fewer tool definitions**: tools an agent can't use aren't offered at all (Claude `--tools`), which
  shrinks every request. Measured on a Claude agent's first request: 41.1k tokens with the user's
  setup, 22.0k isolated with the developer's capabilities.
- Per CLI: Claude gets `--tools` / `--allowedTools` (`bash:git` → `Bash(git:*)`) and `acceptEdits`
  when it may edit; Codex gets a `read-only` or `workspace-write` sandbox (it can't restrict which
  commands run) and web search off; Grok gets a read-only tool list, `--disable-web-search` and
  `--no-subagents`.
- `loadWorkflow` validates capabilities; the Workflows screen shows each agent's session mode and
  capabilities. `cli_args` still work for anything else; `permissions:` (documentation only) is gone.
- Agents with `bash:gh` / `bash:glab` call them bare, in the Bash tool, one command per call (the
  only form the allowlist accepts); the engine refreshes PATH so that works inside runs.

**Terminals** (Run view session detail and Project view, for any run, including past ones):
- They open in an **embedded terminal dock** at the bottom of the app, with tabs (xterm.js). The
  **↗** button next to each opens the same thing in an external console window instead (Windows).
- **Live terminal** follows a session as it runs: prompts, thinking, text, tool calls, results and
  usage. For the **orchestrator** it follows the whole run: steps, transitions, sessions,
  approvals, actions and logs. It is read by the app itself (`packages/engine/domains/session/session-tail.js`), no child process.
- **Open in CLI** runs the provider's interactive CLI resuming the same conversation in the
  session's folder (`claude --resume <id>`, `codex resume <id>`, `grok --resume <id>`) in a real
  pseudoterminal (node-pty: ConPTY on Windows, forkpty on macOS/Linux; `packages/engine/domains/machine/terminals.js`). Only
  between turns; whatever you send there becomes part of the agent's conversation for its next turn.
- Keys: **Ctrl+C** copies when text is selected, otherwise interrupts; **Ctrl+V** / Shift+Insert
  paste; Ctrl+Shift+C always copies; right-click copies the selection or pastes. On macOS, Cmd
  instead of Ctrl.
- node-pty ships prebuilt binaries for Windows and macOS; on Linux `npm install` compiles it
  (needs python3, make and a C++ compiler). The package keeps it outside app.asar.

## Installing the CLIs on Windows

Claude Code (native installer, PowerShell):

```powershell
irm https://claude.ai/install.ps1 | iex
```

Codex CLI:

```bash
npm install -g @openai/codex
```

Grok Build: install it from x.ai (it lands in `%USERPROFILE%\.grok\bin`, which must be on the PATH).

Then log in once to each, interactively (`claude`, `codex login` and `grok login`).
The app shows in Settings whether it found each command on the PATH.

### macOS and Linux

The app looks for each CLI as an executable file on the PATH plus `~/.local/bin`, `~/.grok/bin`,
`~/.npm-global/bin`, npm's global prefix (`prefix` in `~/.npmrc`), `/opt/homebrew/bin` and
`/usr/local/bin`. An app opened from Finder or the Dock gets a minimal PATH, so once per launch
the app also asks your login shell (`$SHELL -ilc`, 3 s at most) for its PATH and puts it first.
A CLI found nowhere shows as not installed, with its install hint (Homebrew on macOS, the distro
package or the official script on Linux). Claude Code's `CLAUDE_CONFIG_DIR` and Codex's
`CODEX_HOME` are honoured for sessions, usage and folder trust.

Every program the app starts (the Install and Sign in terminals, Sessions, shells, the supervisor
chat, agent turns and what they run, such as an agent's `gh`) gets those extra folders on its
PATH too, after your own PATH and only the ones that exist, checked again on each launch: a CLI
that Install puts in `~/.local/bin` signs in right away, without restarting the app. On Windows
the same holds for `~\.local\bin` and `%APPDATA%\npm`.

On macOS the one-click installs of `gh`, `git`, `glab` and `whisper-cli` use Homebrew, and Setup
offers them only when it finds `brew`. Without Homebrew (https://brew.sh), Setup says so and
shows the alternative: the GitHub CLI's macOS installer from https://cli.github.com, the GitLab
CLI from its releases page (https://gitlab.com/gitlab-org/cli/-/releases), and git through
`xcode-select --install` (Apple's Command Line Tools); `whisper-cli` needs Homebrew.

## Voice input

- **OS dictation, no setup**: `Win+H` on Windows, Dictation on macOS. It types into any focused
  field of the app.
- **Mic button** on the long text fields (supervisor questions, gate feedback, the Start drawer's
  task and issue intake, Write & Review and Arena prompts, the resume instruction): click to
  record and click again to stop, or hold it and release to stop (push-to-talk). `Ctrl+Shift+M`
  toggles it in the focused field and `Escape` discards a recording. It records up to 2 minutes.
  While the recording is transcribed, the field shows "Transcribing..." and stays editable until
  the text is inserted. The transcript is inserted at the cursor for you to review; it is never
  sent by itself.
- **Local and private**: the page records the audio, converts it to a 16 kHz mono WAV and sends it
  to the engine (`audio:transcribe`), which runs [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
  (`whisper-cli`). The audio goes to a temp folder for the CLI and is deleted right after; nothing
  leaves the machine and nothing is kept.
- **Setup** (Settings › General › Voice input): install `whisper-cli` (see
  [environment.md](docs/agents/environment.md)), pick a model (Tiny 75 MB to Medium 1.5 GB: bigger
  is better and slower; Small is the default) and click **Download** (stored in the app's user data
  folder, `speech-models/`, not the workspace), and choose the language (Portuguese by default, or
  auto-detect). A missing CLI or model is reported with what to install.
- The microphone is allowed only for the app's own page (audio only); every other web permission
  is denied. In the browser UI (`npm run serve`) the browser asks, and only on `localhost` or HTTPS.

### Paste images

- **Ctrl+V with an image** (a `Win+Shift+S` screenshot, an image copied in a browser) in the same
  fields as the mic button, above all the Start drawer's input, adds it under the field as a chip:
  a thumbnail (click it to enlarge), `image-1.png · 240 KB` and × to remove it. A clipboard that
  holds text pastes the text as before, even when it also holds an image (a copy from Office).
- PNG, JPEG, GIF or WebP, at most 10 MB each and 10 per field; a refused image shows a red chip
  with the reason and the field keeps its text.
- Pasting sends nothing. The images go with the field when you send it: starting a workflow (the
  steps whose prompt uses that input see them), answering a gate (the next agent step), asking the
  Supervisor, resuming a run (the first resumed step). The run keeps a copy in
  `runs/<id>/attachments/`, shown as thumbnails under the run's inputs.
- Until then they wait in `<workspace>/attachments/pending/`; a removed chip deletes its file and
  what was never sent is cleared at the next start. Nothing is uploaded except through the provider
  CLI of the step (see `docs/agents/capabilities.md` for which CLIs open images). The browser UI
  pastes the same way.

## Workspace

Everything the app produces lives in a local workspace folder:

<!-- generated:workspace-tree -->
```
<workspace>/
  runs/      logs of each run (see Observability)
  repos/     cloned repositories
  worktrees/ one git worktree per run (<run_id>), see "A git worktree per run"
  projects/  projects (one .json per project)
  skills/    skills (one folder with SKILL.md per skill)
  backlog/   last issue sync of each project (one .json per project; <id>.po.jsonl = the Product Owner's conversation)
  agents/    user-defined agents (one .json per agent; supervisor.json = the supervisor's look, product-owner.json = the Product Owner's look, model, effort, Speed ↔ Quality calibration and Economy ↔ Generous cost)
  workflows/ workflow definitions (one .yaml per workflow)
  settings.json  app preferences, budgets and prices
  index.db   SQLite index next to the files: runs cache, pending gates, notifications
  attachments/pending/  images pasted into prompt fields, until sent (cleared at the next start)
  findings/<timestamp>/ findings saved by the Findings button (screenshot, marks, context, note)
  discovery/<project>/  private discovery cards (Inbox, Discovery board): board.json, cards/<id>/ (card.json, document.md, acceptance.md, versions/, attachments/, conversation.jsonl, filed/), archive/<id>/
  .lock      the app that has the workspace open (pid, host, heartbeat)
```
<!-- /generated:workspace-tree -->

<!-- generated:workspace -->
- **One app per workspace.** The app locks the workspace it opens. A second copy on the same
  workspace (or on the same user data folder) says so and offers a **scratch copy** (your agents,
  skills, workflows and settings copied to a new workspace, simulations only) or to quit; it never
  opens your workspace read-write. A lock left by an app that died is taken over. Each run in
  progress records its owner (`runs/<id>/owner.json`, refreshed every few seconds): another copy
  shows it as **running (another window)**, never as interrupted, and its roadmap, Retry and Resume
  leave it alone. A run is only interrupted once its owner is gone.
- **Trying a run's worktree**: use **Run App** at the gate. Started by hand from
  `<workspace>/worktrees/<id>` (`npm start`), the app uses a scratch workspace and user data folder
  of its own (`<workspace>/local-previews/app-<id>/`), simulations only, as Run App does.
- **Safe state files**: the roadmap and queue files are checked before each write (an invalid one
  is refused and logged), written atomically, and the previous version is kept as `<file>.bak`.

- **The files are the source of truth; `index.db` is an index next to them** (built into Node, no
  extra dependency). It caches the run list (Workflows › Runs, Projects, Usage and Analytics read it
  instead of every run folder), records the gates waiting
  for you (after a restart, gates of runs that did not survive show as interrupted) and every
  notification (the bell at the top right of the header: history, unread count, mark as read; kept for
  **Settings › Execution › Keep notifications** days). Deleting it loses no run and no planned issue (only the notification history): the app rebuilds it
  at the next start, and **Settings › General › Index › Rebuild index** reads every run again.
  Details: `docs/agents/storage.md`.

- **Discovery cards stay private.** Ideas captured in **Plan & Design › Inbox** are cards in
  `<workspace>/discovery/<project id>/cards/<card id>/` (`<yyyymmdd>-<4 hex>`): `card.json`, the
  working document `document.md`, `acceptance.md`, a snapshot of the document in `versions/` on
  each column move, the files in `attachments/` (any type, up to 50 MB each, original names) and the
  thread in `conversation.jsonl`. A card whose thread ends with a question (an entry of kind
  `question`) waits for the owner: Home lists it under **What needs you** until a note answers it.
  `board.json` keeps the columns and the card order; a discarded or
  merged card moves to `archive/<card id>/` with its reason (and the card it was merged into).
  An accepted card lands in Triage on the **Plan & Design › Discovery** board (Triage → Shape →
  Define → Ready): `board.json` also keeps the WIP limits of Shape and Define (5 by default) and
  each card's place in its column, and `versions/` also gets the document a restored version or a
  Write & Review / AI Arena result replaced, and the result itself (also noted in the thread).
  **Column automations**: a column of `board.json` may declare `on_enter`, a saved pipeline or a
  workflow run on a card when it enters the column, its inputs from the card (`{{ card.document }}`,
  `{{ card.acceptance }}`, `{{ card.attachments }}`, `{{ card.type }}`); Shape offers **AI Arena →
  Write & Review** on the card's document, Ready the clarity check (Grill me). Each one is **Ask me**
  (the move proposes it with its cost estimate from past runs; the default), **On** or **Off**, set
  from the column's header. The run counts in the project's slots and budgets like any run, the card
  shows **Running…** meanwhile, and its `document` output comes back as a new version with a thread
  entry naming the run and its cost (`card.json`'s `automation`). An automation never moves or
  commits a card and never answers a gate: the run's gates wait for you like any run's.
  `card.json` keeps the card's **clarity** (`clarity`: `score` 0 to 100, `gaps`, `ts`, `by`, and
  `override` with the score, the reason and who moved it to Ready below the bar); `board.json` keeps
  the project's bar (`clarity`: `bar`, 85 by default, `byKind`, and `night`, the hours the ready
  forecast counts in). The score never edits a card's text; only **Grill me**, with a person
  answering in the card's thread, writes the answers into it.
  **Commit to the backlog** is the one place where a card's content leaves the workspace, on the
  owner's click: a Ready card at 85% clarity or more becomes one or more issues on the project's
  repository, each starting with `From discovery card <id>` and holding the card's title, its tasks
  and the first 4000 characters of its document. The card keeps the issue numbers in
  `links.issues`, the text of each issue in `filed/`, and the column `committed`: it is in no board
  column any more and never moves again. A card started from it keeps the link in `links.from`
  (an `intent` filed from a run's finding keeps `{ workflow, runId, finding }` there instead, #633);
  `links.release` is the release that shipped its issues.
  Nothing else under `discovery/` goes to the git platform: the folder carries a `.gitignore` that ignores
  everything, and the screens, the Oracle and agents reach a card only through the card API (the
  `discovery:` channels). Through the browser UI (`npm run serve`) a pasted or dropped file is
  limited by the server's request size (15 MB); the desktop app takes the full 50 MB.

- **Bundled defaults.** The app folder (read-only `app.asar` in the packaged app) only holds the
  default skills and workflows; the app and `scripts/run.js` copy them into `skills/` and
  `workflows/` on startup, and everything is read and edited there. `.seeded.json` in each folder
  records the content hash of each copied default:
  - a default not copied yet is copied (unless you already have a file with that name, which is kept);
  - an untouched copy is updated when a new app version ships a new version of it (e.g.
    `software-development` 0.9.0 → 0.10.0);
  - a copy you edited is never overwritten; Workflows > Definitions shows it as **modified**, with
    **newer default** when the app ships a newer version, and **Restore default** (your copy goes to
    the trash);
  - a default you deleted is not brought back (to get it back, remove its entry from `.seeded.json`);
  - files you created are never touched.
- Runs record the workflow file name. Resuming a run (or opening its sessions or supervisor) reads
  the workflow from `<workspace>/workflows/`; if you deleted it, the bundled copy is used and the run
  log says so.

- On startup the app looks for `%USERPROFILE%\multiagent-workspace`. If it does not exist, it asks
  whether to create it or pick another folder.
- The chosen path is stored in the Windows registry at
  `HKCU\Software\MultiagentOrchestrator\WorkspacePath` and reloaded on the next launches
  (on other OSes, in `~/.multiagent-orchestrator.json`). If the stored folder disappears, the app asks again.
- Settings shows the current workspace, with **Open** and **Change…**.
- The `repo_path` input accepts a git URL (`https://…` or `git@…`): the app clones it into
  `repos/<owner>-<repo>` (or runs `git fetch` if already cloned) and runs the workflow on that copy.
- `MULTIAGENT_WORKSPACE=<folder>` overrides the workspace without writing to the registry (used by `npm test`).
- `scripts/run.js` uses the same workspace; with nothing stored, it creates the default folder.
<!-- /generated:workspace -->

## Structuring your repository's AGENTS.md (CLAUDE.md) for unattended agents

Codex loads a repository's `AGENTS.md` and Claude Code its `CLAUDE.md` into every session that
works in it, on every request: each workflow agent pays for all of it, on every turn. Keep one file,
`AGENTS.md`, and make `CLAUDE.md` the single line `@AGENTS.md` (Claude Code's file import), so every
CLI reads the same instructions. Keep it a short index (a few KB) and move the details to topic docs
the agents read only when their task needs them:

- `AGENTS.md`: what the project is, the hard rules (what must never happen), the commands, and one
  line per topic doc saying **when** to read it (e.g. "before changing the database schema").
- `docs/agents/<topic>.md`: the code map, architecture notes, gotchas, testing, deployment...
  Each section of the old file lands in exactly one doc; the user docs (README) are not duplicated.
- A test that fails when `AGENTS.md` grows past its limit, points to a missing doc, or `CLAUDE.md`
  stops being the import keeps it honest.

This repository does it itself: its `CLAUDE.md` went from 25 KB to 4 KB (now `AGENTS.md`), and a
Claude agent's first request from 22.0k to 15.7k tokens (with isolation; 41.1k before both changes).

## Observability

Each run writes to `<workspace>/runs/<run_id>/`:

- `events.jsonl`: every event (step, transition, session, approval, saved file…)
- `sessions/<id>.jsonl`: each session's events (prompts, thinking, tools, output)
- `summary.json`: final metrics per session (duration, active, idle, tokens, cost) and, in `context`,
  per agent: the context at the start and peak of each turn, total tokens, fresh sessions, and the
  tokens spent on turns that could not progress (`waste`: every tool call refused, or a blocked `/loop`
  iteration). The run chat shows each turn's context (start → peak). In `timing`, per step: the
  agents' time split into active (the model working), waiting (a command running) and stalled
  (waiting with no output for longer than `idleWarningMinutes`, default 5, which also logs a
  warning in the run and its chat).
- `handoffs/`: the agents' handoff notes, one per turn
- files written by `save_as` (e.g. `arena/`, `review.md`)
- `decisions.tsv`: the agents' decision log (time, agent, step, phase, decision, why, evidence, result)

Recordings are redacted before they are written (#475): a baseline the app always applies (bearer
tokens, `…KEY=` / `…TOKEN=` / `…SECRET=` / `…PASSWORD=` pairs, PEM private keys, `ghp_`,
`github_pat_`, `sk-` and `xox…` tokens, the `env` values of an agent's `--mcp-config`, the values
of a `printenv` / `env` output), then the workflow's own `observability.capture.redact` rules.
Still check a recording before you share it.

The **24/7 chip** in the top bar (#188) shows one number: the share of the last 24 h with at least
one real run active (**24/7 · 87%**; a run waiting at a human gate does not count, simulated runs
never do), green from 90%, amber from 60%, red below, with a dot that pulses while a run is active.
Its tooltip says the active hours and how long it has been idle; a click opens **Analytics › 24/7**
(see Screens). It is computed locally from the runs' `events.jsonl`, the Night watch's log and the
app's heartbeat log (`<workspace>/app-sessions.json`, written every minute by the app that holds the
workspace lock: its gaps are "app closed / machine asleep"), refreshed when a run starts or ends and
every minute; no model call. **Settings › Execution › 24/7 chip in the top bar** hides it.

Notes:
- Claude Code reports cost; Codex does not, so the cost of Codex sessions is empty.
- The Anthropic API counts thinking tokens inside `output`; `reasoning` is only separate for Codex.

## Structure

<!-- generated:structure -->
```
apps/desktop/host/main.js              Electron main process + IPC
apps/desktop/host/preload.js           safe API exposed to the renderer
packages/engine/domains/workspace/workspace.js         workspace folder (Windows registry, runs/, repos/, workflows/, clone)
packages/engine/domains/project/projects.js          projects: CRUD and folder/repository setup
packages/engine/domains/backlog/backlog.js           backlog: project issues via gh/glab, sync cache, issue ↔ run links, workflow queue
packages/engine/domains/roadmap/roadmap.js           backlog roadmap: ordered stages of runs, each after the previous one merged
packages/engine/domains/local/local-push.js        local merges not pushed: status (commits, issues they close), push, update and push
packages/engine/domains/seed/seed.js              seeding of bundled defaults into the workspace (.seeded.json, origin status, restore)
packages/engine/domains/agents/skills.js            skills: CRUD, lookup, seeding and prompt block
packages/engine/domains/agents/agents.js            agents: CRUD, appearance validation, the built-in supervisor, the workflows' agents (read-only)
packages/engine/domains/workflow/workflows.js         workflows: seeding, origin status, lookup (workspace, then bundled)
packages/engine/domains/workflow/workflow-builder.js  visual builder: spec <-> workflow YAML, what the builder can't draw
packages/engine/domains/usage/usage.js             token/cost usage per provider and scope, budgets and the pre-run CLI check
packages/engine/domains/local/local-usage.js       readers of the CLIs' own local usage logs (Claude Code, Codex, Grok)
packages/engine/domains/usage/actions-usage.js     GitHub Actions minutes of the month vs the included quota (Usage, CI step)
packages/engine/engine/workflow.js   engine that runs the YAML graph
packages/engine/engine/providers.js  claude / codex / grok / mock adapters
packages/engine/engine/capabilities.js  agent capabilities and isolation → each CLI's flags
packages/engine/engine/recorder.js   writes to disk (jsonl + summary)
packages/engine/engine/worktree.js   git worktree per run: create, reuse on resume, remove, orphan cleanup
packages/ui-kit/         the UI kit every page starts from: the shell, the run kernel, the controls, Home and Settings (plain HTML/CSS/JS, no bundler)
fronts/<id>/             the fronts analyser, build, plan, ai: each its screens (views/), features and tests
apps/desktop/renderer/   the desktop page (index.html, generated from apps/desktop/composition.js) and the engine connection page
apps/web/                the browser UI the engine serves at / (its composition, page and api-http.js)
workflows/               bundled workflow definitions (copied into <workspace>/workflows)
skills/                  bundled skills (copied into <workspace>/skills)
.github/workflows/       CI (PRs) and deploy (merge into main)
scripts/                 terminal runner, tests, build, UI smoke test and UI screenshots (screenshot.js)
test/                    unit tests (node:test) and fixtures
AGENTS.md, docs/agents/  context for coding agents working on this repository (short index, imported by CLAUDE.md, + topic docs)
docs/12-factor-agents/   the engine read against 12-Factor Agents: one page per factor, what applies here and what is missing
```
<!-- /generated:structure -->

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) for the setup and the
checks, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md) to report a
vulnerability privately.

## License

[MIT](LICENSE), Copyright (c) 2026 Eduardo Galbiati. Some bundled skills and workflows are adapted
from other MIT projects: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

**Trademarks**: this project is not affiliated with Anthropic, OpenAI or xAI. Claude Code, Codex and
Grok are their trademarks. The app drives the CLIs you install and sign in to: you are responsible
for each CLI's terms of service and for the costs its runs incur.
