# The codebase's structure for agents: rules files, topic docs, skills

## The question

A repository worked on by coding agents carries rules for them: a root rules file, topic docs read
on demand, skills given to a step. The "codified context" case study (Vasilopoulos,
[arXiv:2602.20478](https://arxiv.org/html/2602.20478)) logged every agent invocation and retrieval
and found from the data which specs were used and which were stale. Böckeler ("Context Engineering
for Coding Agents") adds: build the rules gradually and expect some to become unnecessary.

## In this project

- `AGENTS.md` (loaded by Claude Code through `CLAUDE.md`): the working rules and one topic line per
  doc ("Read before changing ...").
- `docs/agents/*.md`: the topic docs; `skills/*/SKILL.md`: the skills a workflow step names.
- Every run records each turn's tool calls in `events.jsonl` (`session.stream` events of kind
  `tool_call`); `docs/agents/testing.md` ("Reading a session stream") says how a script reads them.

## Gaps

1. Nested per-folder rules files (#572): path-scoped rules next to the code they govern.
2. Split topic docs: smaller docs, so a session reads only what its change needs.
3. **Measurement** (#574, closed): which docs the sessions read and which rules they break, so the
   two items above can show a gain. `scripts/docs-usage.js`, no model call:

   ```
   npm run docs:usage -- --project multiagent-orchestrator --since 2026-09-26 [--json]
   ```

   It counts, per run and session, the docs read through the Read tool, the files edited, the topic
   docs of edited folders not read in the same session (the folder table `TOPICS` in the script),
   a shared list file edited, a `git push` to `main` and a real run started (no `--mock`); the rules
   the data cannot show are listed as not measured.

### Baseline (2026-09-26 to 2026-10-26)

356 runs of this repository, 3263 sessions.

| Rule broken | Times | Runs |
|---|---|---|
| `real_run_in_check` (`npm run run` / `scripts/run.js` without `--mock`) | 17 | 17 |
| `shared_list_edit` (`AGENTS.md`, `CLAUDE.md` edited) | 17 | 15 |
| `push_to_main` | 0 | 0 |

| Topic doc | Sessions that read it | Sessions that edited its folder without reading it |
|---|---|---|
| `docs/agents/testing.md` (`test/`, `*/*/test/`) | 101 | 402 |
| `docs/agents/engine.md` (`workflows/`) | 62 | 47 |
| `docs/agents/renderer.md` (`packages/ui-kit/`, `fronts/`, `apps/*/renderer/`) | 76 | 6 |

- Other topic docs read: `decisions.md` 35, `storage.md` 30, `capabilities.md` 29, `code-map.md`
  21, `worktrees.md` 17, `environment.md` 11, `backlog.md` 6, `seeds.md` 3, `channels.md`,
  `test-map.md` and `windows-gotchas.md` 2 each. `AGENTS.md` itself: 12 (it is in every Claude
  session's context without a read).
- Never read: no topic doc; 21 skills, mostly other languages' variants (`build-audit-*`,
  `e2e-test-writer-*`, `unit-test-writer-rust`) and writing skills (`adr-writing`, `test-plan-writing`).
- How to read it: a skill a step names is given in its prompt, not read, so "never read" for a
  skill means "never opened by hand", not "unused". The testing.md count is high because test
  writers get the testing skills in their prompt; it is the first candidate for a path-scoped rule.

## References

- Vasilopoulos, A., *Codified Context*, [arXiv:2602.20478](https://arxiv.org/html/2602.20478).
- Böckeler, B., [Context Engineering for Coding Agents](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html).
- [sources.md](sources.md) for both.
