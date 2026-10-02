---
order: 300
---

<!-- section:engine -->
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
