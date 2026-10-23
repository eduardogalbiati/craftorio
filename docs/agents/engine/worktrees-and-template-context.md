# Worktrees and template context

The run's worktree option, what templates can read, and transition actions.

- `orchestrator.worktree: { repo, base }` + `defaults.working_dir: "{{ worktree_dir }}"`: see [worktrees.md](../worktrees.md).
- Starting a run executes the repository's own scripts (#472, SEC-7): `prepareDeps` installs through
  the deps cache (`npm ci` runs `postinstall`), then the check step (`npm run check`) and the suite
  (the detected test command) run through a shell. `logRepoCommands` (src/engine/run/checkout.js),
  called by `setupWorktree` before the install, emits one `log` event naming them. The project's
  `ignoreInstallScripts` (Projects › Edit, on by default for a repository `createProject` clones)
  reaches `WorkflowRun({ ignoreInstallScripts })` and `ensureDeps({ ignoreScripts })`: the install
  gets `--ignore-scripts` and a cache hit skips the lifecycle scripts.
- Template context: `inputs`, `steps.<id>.output/visits`, `steps.<id>.outputs` (every visit's output,
  oldest first; a resumed run only has the last), `trail` (the run's step visits so far:
  `{ step, visit, type, status, cost, durationMs, ts }`, StepTrail, #290), `run_id`, `run_dir`, `runs_dir`,
  `workflows_dir`, `worktree_dir`, `agents.<name>.model`, `agent` (in fan-out), `delegate_result`,
  `skill_dir('<name>')` (a skill's folder, to run its script in an action), and in an agent step's
  prompt `evidence_dir` (`<run_dir>/evidence/<step>/round-<visit>`, where its screenshots go).
- Transition `action:` is a shell command run in the worktree (skipped in simulation); one that
  renders empty runs nothing. The PR screenshots cleanup on merge/close uses this.
- `action:` and `ship.build` run through a shell (`exec`), so `loadWorkflow` allows there only what
  is safe for a shell (#469): a `{{ }}` (or a `{% set %}` / `{% for %}`) passes when it is one value
  through a filter that validates or quotes it (`github_repo`, `pr_url`, `shell_quote`;
  `SHELL_SAFE_FILTERS` in src/engine/run/templates.js), or when every name it reads is one the
  workflow or the user controls (`SHELL_SAFE_NAMES` in src/engine/run/load.js: `inputs`, `run_id`,
  the run's folders, `skill_dir()`, `release`, `iteration`, a gate's `choice`, names a `{% set %}` /
  `{% for %}` binds) or an output field (`steps.<id>.output.<f>`, the step's own `output.<f>`) its
  `output_schema` types `integer`, `number` or `boolean` (enforced before the output is stored).
  Anything else (agent text, `vars.*`, `action_error`, a probe's detail) is refused. A `{% if %}`
  condition may read any value. A path from the user (`inputs.project_path`) goes through
  `shell_quote` (POSIX single quotes; on Windows double quotes with trailing backslashes doubled, and
  a value with `"`, `%`, `!`, `^` or a line break throws).
- Templates are code (#474): nunjucks has no sandbox, so `loadWorkflow` refuses any `{{ }}` / `{% %}`
  block, and the whole text of `when`, `until` and `agent_when`, naming `constructor`, `__proto__`,
  `require` or `process` (`UNSAFE_TEMPLATE_NAMES`; a step or input with one of those names must be
  renamed), or with a subscript whose key is an expression (`x['const' ~ 'ructor']`; a literal or
  a name is fine). Prose outside the blocks may use the words. These checks stop the tricks they
  know; the trust warning stays the main control.
  `npm run check` loads every `workflows/*.yaml`, so these refusals are findings there too.
