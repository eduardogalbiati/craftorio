# Factor 8: Own your control flow

## The factor

Do not hand the loop to the model. Write the loop yourself: which step runs next, when to call the
model, when to run a tool directly, when to wait, when to stop. A model inside a loop you own can be
interrupted, resumed, budgeted and tested; a model that *is* the loop cannot. ([factor 8](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-08-own-your-control-flow.md))

## In this project

This is the founding design: "a deterministic engine walks the workflow graph; an AI supervisor is
called only when a step fails, or on demand" (`AGENTS.md`).

- **The graph is declared.** Steps, `when:` transitions on output fields, `goto`, `max_visits` and
  `on_exhausted`, `loop.max_iterations`, `set:` on `vars`, `on_error` targets: all in the YAML,
  evaluated by `finishStep` and `applyCounters` in `src/engine/run/transitions.js`. The code review
  loop (`develop` → `code_review` → `develop`) ends after three rounds with `on_exhausted: fail`,
  with no unchecked "one more fix" (an exhausted transition drops its `delegate`).
- **Machine steps need no model.** `type: suite`, `type: check`, `type: screenshots`, `type:
  workflow` and transition `action`s run commands and child runs directly
  (`src/engine/run/machine-steps.js`, `machine-actions.js`). Pushing and merging are `merge: local`
  and `ship:` on a transition, performed by the engine.
- **Waiting is the engine's job.** A `/loop` step with `wait:` polls the PR or the CI run with `gh`
  or `glab` between turns (`src/engine/probes.js`) and calls the agent only on news; CI all green
  finishes the step with no model call (`pollStep`).
- **The model gets a budget, not the wheel.** The supervisor is bounded: `max_interventions` 2
  per step, 6 per run, `max_cost_usd` 5 (`orchestrator.supervisor`); past them the gate opens with
  its last diagnosis. Runs have `max_total_duration`, `max_total_cost_usd` and
  `max_total_context`, checked by the engine before each turn, never cutting a turn in progress.
- **Recovery is validated.** A supervisor's `goto` must be one of the steps the transition
  declared in `recover:`; an invalid one is an escalation (`recoverFromActionError`).
- **It all runs without a model.** `CRAFTORIO_SIMULATION_ONLY=1` and the mock provider walk the
  whole graph in `npm test`, with `mockSequences` to force failures, refused calls, probe states and
  action errors (`docs/agents/testing.md`).

## Gaps

None. The engine's control flow is the product. The one piece of control flow that is the model's
is inside a turn (the CLI's own tool loop), bounded by `timeout`, `max_requests`, the memory guard
and the idle watch (`src/engine/run/turns.js`).

## References

- [12-Factor Agents, factor 8](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-08-own-your-control-flow.md)
- `docs/agents/engine/agents-and-steps.md`, `docs/agents/engine/gates-and-run-end.md`
- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): "workflows vs agents"
