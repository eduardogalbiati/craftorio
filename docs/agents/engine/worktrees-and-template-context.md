# Worktrees and template context

The run's worktree option, what templates can read, and transition actions.

- `orchestrator.worktree: { repo, base }` + `defaults.working_dir: "{{ worktree_dir }}"`: see [worktrees.md](../worktrees.md).
- Template context: `inputs`, `steps.<id>.output/visits`, `steps.<id>.outputs` (every visit's output,
  oldest first; a resumed run only has the last), `trail` (the run's step visits so far:
  `{ step, visit, type, status, cost, durationMs, ts }`, StepTrail, #290), `run_id`, `run_dir`, `runs_dir`,
  `workflows_dir`, `worktree_dir`, `agents.<name>.model`, `agent` (in fan-out), `delegate_result`,
  `skill_dir('<name>')` (a skill's folder, to run its script in an action), and in an agent step's
  prompt `evidence_dir` (`<run_dir>/evidence/<step>/round-<visit>`, where its screenshots go).
- Transition `action:` is a shell command run in the worktree (skipped in simulation); one that
  renders empty runs nothing. Agent output reaching it goes through a validating filter
  (`github_repo`, `pr_url`). The PR screenshots cleanup on merge/close uses this.
