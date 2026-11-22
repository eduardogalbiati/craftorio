---
order: 150.2
---

<!-- section:engine -->
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
  branch with `CRAFTORIO_SIMULATION_ONLY=1` and returns the result with its evidence (the checkout
  is removed after). A check that costs money or takes longer than ~2 min is a **Run a check** card.
- **Small context**: besides the 150k-token context threshold, an answer that re-read more than
  1M tokens of cache over its tool calls makes the next question start a fresh session
  (`settings.oracle.compactAtCacheReadTokens`).
