# What you know besides this skill

Digests of the skills the other agents follow. The whole skills are in the workspace's `skills/`
folder (`repo_read` on the app's project, or `seed_status`) when you need a detail.

<!-- skill: backlog-product-owner sha256:b152da5486de -->
## backlog-product-owner (planning the backlog)

- One group of issues = one run (one branch, one PR). The owner applies a plan; you never edit
  issues, start runs or answer gates.
- Group issues that change the same files or functions, are one feature split in several issues,
  or where one reuses what the other adds. A tests-only issue never runs alone: group it with the
  production issue its tests cover. A group's complexity sum is at most 6 (7 hit the context limit).
- Keep apart (other stage) issues that edit the same files (README sections, the shared stylesheet,
  central lists count), a repo-wide refactor (alone, its own stage), or one that needs the other
  merged. Past merge conflicts are evidence. Shared test files count too (#380): two issues adding
  scenarios to one `.feature` file or tests to one test file conflict at the merge.
- The conflict map (#150, `backlog/<project>.conflict-map.json`, from git, no model call): groups
  touching one hot file or line (changed by more than half of the last 20 runs) go to different
  stages or one group; every hot spot is listed under Decongest with a fix in the repository's
  terms, which the owner files as an issue with one click.
- Stages: as few as possible, every non-conflicting group in the same stage. Dependencies are per
  task: a task naming another open issue or its feature ("in the 24/7 tab (#188)") goes after that
  issue or in its run; otherwise the run stops at the requirements_left_out gate (#137, #189).
- The calibration (Speed/Quality) and the Cost (Economy/Generous) replace the defaults; cost wins.
- Leave out ideas and RFCs, epic trackers, issues merged locally, issues already running, queued
  or planned; issues without `complexity:n` count as 3 and the missing label is said.
- Mode: `validated` for anything the owner can try in the app (a screen), `auto` otherwise.
- Enrich first: an issue too vague to implement, or a screen whose criteria only list sections
  (no hierarchy: what leads, the text budget, what goes behind "more").
- Too big for one run (complexity 4-5, more than ~8 tasks, unrelated areas): split into 2-4
  children, every parent task in exactly one child.
- Work left by an ended run: start from scratch when stale, resume when recent.
- Refactor proposals (#357, the Refactor tab): rank each open one by value (Danger Zone score)
  against risk (unfinished roadmap items on its files, the conflict map) and cost (complexity 1-5),
  with a one-line reason; a cadence adds the top one with an issue every X runs.
- Never invent sizes: the app computes them from past runs.

<!-- skill: run-supervisor sha256:41fbfb23ff8f -->
## run-supervisor (explaining and recovering runs)

- Read the evidence first: the failing step, its error, the agent's last answer, the timeline
  (events.jsonl), earlier outputs, the artifacts.
- Failure classes: format (fix the output from the answer only), instruction (retry with a precise
  instruction), context (ask the human), environment (retry once if transient), locked worktree
  (EBUSY under node_modules: a process started from the worktree holds it; give a command scoped to
  the worktree, never a kill by name), capability, workflow design (say what to change in the YAML).
- Never invent results; two failed interventions on one step mean escalate; don't retry expensive
  steps for cosmetic problems. When a retry would fail the same way (#380: the work is already on
  the branch), ask the human with `retry_would_fail` and the step to resume from. An idle agent: wait when the command can end on its own, interrupt
  when it polls forever. Never prescribe a code fix: route evidence and hypotheses to the agents.
- Roadmap and workspace problems (each happened): kept work from a cancelled run (#112, #170:
  start from scratch when stale, resume when recent); nothing starts by itself (only when a run
  finishes or the app opens); a workflow or skill edited in the workspace is a frozen copy that
  stops receiving updates (src/seed.js); two apps on one workspace start runs twice (#112: close the
  old app before opening the new one); a run uses the issue text saved in its roadmap/queue item
  (#168); "Cannot find module" only in the project's clone = a stale install there; merged locally
  but not pushed = the issues stay open until the owner pushes.

<!-- skill: issue-writing sha256:0c0feb7ea0d6 -->
## issue-writing (issues someone else can finish)

- Search first: no duplicate; link related issues. One problem per issue; split past ~8 tasks.
- Kind `bug` / `enhancement` / `documentation`, only the repository's existing labels.
- Title: outcome-first, under ~80 characters, the behaviour that changes, no trailing period.
- Body: the context (what happens today, where, why it matters), the evidence (run id, PR,
  file:line, numbers; estimates marked as estimates), the decision taken (`**Decision (who): …**`),
  `## Expected files` (one path per line, `(new)` for a file to create; only the files the change
  modifies or creates, not the evidence: the city's impact preview reads it first, #429), then
  `## Tasks`: checkboxes, each a bold lead and one verifiable criterion (where, edge cases,
  invariants), ending with Tests, Docs and a measure task when a gain is claimed. `Related: #n`.
- A product-wide "Decision (owner)" line gets the Docs task "record the decision in
  `docs/agents/decisions.md`".
- Any screen: UI criteria (what leads, which controls, the states, the shared components, the
  screenshots that prove it) and its hierarchy (#387: the 5-second message, the text budget, what
  goes behind "more"), not only the sections to show.
- Open questions become tasks with a recommended default; never a question to a person.
- In the issues language the Language line names (headings translated where it has them); `- [ ]`,
  `#n`, `Closes #n` and labels never change; never rewrite existing text only to translate it.

<!-- skill: context-economy sha256:0705cbff1809 -->
## context-economy (small context)

- Every call of an answer re-sends the whole conversation: a big tool result is paid again on
  every later call.
- Map with one sub-agent (here: `delegate`) instead of reading many files; read excerpts, not whole
  files; never re-read what you already read.
- A long output (a diff, a run's events, a log, the backlog) goes to a delegate that returns a
  summary with file and line.
- Group your work in few calls; leave a handoff note good enough to continue without re-exploring.
