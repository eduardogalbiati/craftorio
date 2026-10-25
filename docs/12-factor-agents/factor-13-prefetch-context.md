# Factor 13 (bonus): Pre-fetch all the context you might need

## The factor

If you already know the model will ask for something (the ticket, the diff, the test results), put
it in the context before the turn instead of making the model spend a round trip and tokens on a
tool call to get it. Deterministic code fetches; the model reads. ([factor 13](https://github.com/humanlayer/12-factor-agents#factor-13-pre-fetch-all-the-context-you-might-need))

## In this project

- **Template filters fetch before the prompt is rendered.** `git_commits`, `git_log_stat`,
  `git_tags`, `project_version`, `filed_issues`, `suite_failures`, `missing_test_ids`,
  `e2e_scenarios`, `issue_lines` (`src/engine/run/templates.js`): a gate message or a step prompt
  shows the branch's commits, the failing tests or the issue's lines without any agent running a
  command for them.
- **Probes replace agent polling.** The `wait:` block on a `/loop` step lets the engine check the
  PR and the CI with `gh` or `glab` between turns and call the agent only on news, with the probe's
  detail already in the prompt (`st.probeNews`). The old way, an agent polling CI every few minutes,
  is what this replaced.
- **The project is mapped once.** The `project-map` workflow and skill write a map of the
  repository that later runs read; `src/engine/deps-cache.js` keeps a project's dependency
  installation between runs so an agent never waits on it; the base-health store
  (`backlog/base-health/<project>.json`) tells the suite step which failures are pre-existing before
  it runs.
- **Issues are replicated locally.** The Backlog keeps a read-only replica of the platform's
  issues (#168), so a run's prompt gets the issue text from a file, not from an API call in the
  agent's turn.
- **Gate feedback and images travel with the run.** The owner's change request, pasted images
  and the resume instruction are copied into the run folder and given to the next agent step
  (`attachments/`, #129, #130).

## Gaps

None. The balance to keep: pre-fetching everything a step *might* need bloats the window (factor 3).
The filters that summarise (`one_line`, `issue_lines`, `suite_lines`) are how a workflow pre-fetches
without pasting.

## References

- [12-Factor Agents, factor 13](https://github.com/humanlayer/12-factor-agents#factor-13-pre-fetch-all-the-context-you-might-need)
- `docs/agents/engine/gates-and-run-end.md`: `wait:` probes
- `docs/agents/engine/evidence.md`, `docs/agents/storage.md`
