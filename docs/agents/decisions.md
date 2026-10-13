# Owner decisions

The owner's standing product decisions, newest first: the date, the decision, why, and the
issue(s). Read the entry of an area before changing behaviour an earlier decision set; to change
one, ask the owner in an issue, and the run that implements it updates the entry (the issue skills
add that Docs task when an issue has a product-wide "Decision (owner)" line). A replaced decision
appears once, in its latest form, naming what it replaced. The hard rules of
[AGENTS.md](../../AGENTS.md) are not repeated here. This is not the `decision-log` skill (a run's
own `decisions.tsv`). Dates are the issue's (or the owner session's) date.

- **2026-10-13** (#368): a run or a roadmap stage can be paused after the current agent turn: an
  agent is never stopped in the middle of a turn (nor a running command), the run ends `paused`
  with everything kept, and Resume continues from that point without redoing a finished turn. A
  pause never answers a gate (a run at a gate pauses at once and asks it again on Resume), and only
  the owner resumes a paused run (never the Night watch, the Oracle or the supervisor). Why: Stop cut
  the turn in progress and Pause on the roadmap let the runs in progress go on, so updating the app,
  the CLIs or the issues meant waiting for the runs or losing work.

- **2026-10-13** (#356): a project's Architecture tab works for any language. The deterministic
  facts (lines, churn, hotspots, co-change, languages) are computed by the app from git, through a
  pure core in `src/shared/`; complexity comes only from a real tool, never a regex; the analysis is
  the Oracle's, on demand, in its daily budget. What the Oracle finds feeds the Refactor tab, where
  the Product Owner prioritizes. Why: a parser per language cannot be the base when a project can be
  in any language, or several.
- **2026-10-13** (#367): a machine profile sizes the concurrent runs and the test workers per run
  from the machine (threads, RAM), shown with its reasons in Setup and Settings › Execution and
  always overridable: a manual value wins and stays when the machine changes. It never lowers a
  value the owner set by hand on its own, never stops a run and never changes the memory guard's
  limits; the memory guard's history only suggests (Apply). Why: a new user could not tell how many
  runs at once were safe until the machine froze.
- **2026-10-11** (#313, #314, #315): the app is free, open-source software under the MIT licence,
  for Windows, macOS and Linux. The trial is removed; sign-in stays required in the packaged app
  only to count the people using it (the account gates nothing). The history is not rewritten.
  Why: without a licence the code is not open source, and the owner wants to know how many people
  use the app.
- **2026-10-04** (#247): Ask for changes at a validation gate goes to the test writer first. It
  only checks whether the request changes the acceptance criteria: if so, it updates the affected
  acceptance tests and scenarios (then the red check); otherwise the run goes straight to the
  developer. Why: the locked tests still described the old behaviour and cost extra rounds.
- **2026-10-04** (#245): no snake_case or file-name id is shown to people; agents and steps have a
  readable `display` name, and ids stay in tooltips and details for debugging. Why: screens showed
  internal ids such as "acceptance_tests" where people read them.
- **2026-10-04** (#241, #240, #105): each area has one owner. The Backlog (issues, roadmap, queue)
  belongs to the Product Owner; workflows, skills and runs belong to the Supervisor. The Oracle
  reads everything, diagnoses and proposes, but routes every change to the owning agent. Why: the
  Oracle's changes ended in its own history, made by an agent that does not hold that area's rules.
- **2026-10-03** (#332, from the owner's session; options of #203, scenarios of #223): in AI
  Development (local hero included), unit and E2E tests are `write_and_run` by default. Cost is cut
  in prompts, retries and context, never by lowering test inputs. Replaces #199's "E2E scenarios
  run only at release time". Why: the tests are why the app works (#222), so savings go where they
  do not lower what is tested.
- **2026-10-03** (#238): archiving an issue closes it on the git platform (GitHub: "not planned")
  with an `archived` label; restoring reopens it. It replaces the retired `deprioritized` label.
  Why: there was no way to put an issue aside, and the Product Owner kept proposing unwanted ideas.
- **2026-10-03** (#222): E2E tests stay and run on Playwright + BDD (`playwright-bdd`),
  deterministically by the machine; an LLM only writes and repairs them. Why: the old E2E tests
  asserted little, and the release run paid a model to run the suite.
- **2026-10-03** (#211): which test failures are the run's (and which were already on the base) is
  decided deterministically by the orchestrator (failing tests rerun on the base), never by an
  agent. Why: failures already on main made every round fail and the run looped.
- **2026-10-02** (#202): an ended run keeps its branch, not its worktree folder; Resume recreates
  the folder. Why: 13 worktrees of ended runs took about 8.3 GB, and their commits were already on
  their branches.
- **2026-10-02** (#168): the git platform (GitHub) is the only source of truth for issues. The
  local data is a read-only replica: the sync updates it, the app re-reads an issue right before a
  run starts, and issue changes are never made locally. Why: planned items kept stale copies, so an
  issue edited after planning ran with its old text.
- **2026-10-01** (#111): UI changes are specified, built with the shared components, captured in
  every state and reviewed for how they look and are used, not only for what they do. Why: a run
  passed every step and merged a screen the owner then found hard to use.
- **2026-09-30** (#98): a requirement of an issue is never dropped silently, and a review is not
  spent on work the developer already declared missing (it goes back to develop). Why: a declared
  gap still went to code review, which failed on exactly that gap.
- **2026-09-29** (#47): only the test writer writes, edits or deletes tests; the developer changes
  production code only. Why: overlapping test responsibilities made one run pay for the full suite
  up to four times.
