---
order: 150
---

<!-- section:workflows -->
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
