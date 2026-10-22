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
  renders empty runs nothing. The PR screenshots cleanup on merge/close uses this.
- `action:` and `ship.build` run through a shell (`exec`), so `loadWorkflow` refuses agent output
  interpolated there unsafely (#469): a `{{ }}` (or a `{% set %}` / `{% for %}`) reading
  `steps.<id>.output` passes only when it is one field through a filter that validates or quotes it
  (`github_repo`, `pr_url`, `shell_quote`; `SHELL_SAFE_FILTERS` in src/engine/run/templates.js) or a
  field the step's `output_schema` types `integer`, `number` or `boolean` (the schema is enforced
  before the output is stored). A `{% if %}` condition may read any output. Other values that come
  from the user (`inputs.project_path`) go through `shell_quote` (POSIX single quotes; on Windows
  double quotes, and a value with `"`, `%`, `!`, `^` or a line break throws).
- Templates are code (#474): nunjucks has no sandbox, so `loadWorkflow` refuses any `{{ }}` / `{% %}`
  block, and the whole text of `when`, `until` and `agent_when`, naming `constructor`, `__proto__`,
  `require` or `process` (`UNSAFE_TEMPLATE_NAMES`). Prose outside the blocks may use the words.
  `npm run check` loads every `workflows/*.yaml`, so these refusals are findings there too.
