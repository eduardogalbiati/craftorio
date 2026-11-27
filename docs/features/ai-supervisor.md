---
order: 100
---

<!-- section:engine -->
### AI supervisor

The engine is deterministic (same graph, same gates, auditable); an AI **supervisor** (skill
`run-supervisor`, model from `orchestrator:` in the YAML) steps in only when something goes wrong:

```yaml
orchestrator:
  provider: claude
  model: claude-sonnet-5-5
  supervisor:
    enabled: true
    max_interventions: 2   # per step (max_total: 6 per run)
```

- **During a run**, when a step fails (agent error, output that never validates), the engine gives
  the supervisor the step, the error, the agent's last answer and the recent timeline. It answers
  with an explanation and one action, which the engine validates:
  - `fix_output`: rebuild the output from the agent's answer, accepted only if it matches the step's schema;
  - `retry`: run the step again with an instruction added to the agent's prompt;
  - `goto`: continue at one of the step's own targets (never a human gate);
  - `ask_human`: an approval with the explanation (retry with the suggestion / stop); when the
    supervisor says a retry would fail the same way (`retry_would_fail`), the gate offers
    "Resume from <step>" at the step it names instead of Retry, and still waits for the person;
  - `fail`: fall back to `on_error`, or end the run.
  It shows up as a `supervisor` session, and its decisions in the orchestrator log
  (`supervisor.decision` events). A gate the supervisor on call answered itself (#71) says so on the
  Run screen and in the run's chat, with the answer; it knows the gate's own recommendation and says
  why when it advises another answer. It takes an answer alone only when it is the gate's recommended
  one or merges and pushes nothing (retry, stop), or when the engine confirmed every failure on the
  base (#211); any other answer opens the gate for the owner with the supervisor's answer and reason
  on it (#124).
- **When a transition's action fails** (a merge, a deploy command, or the engine's check right
  before a merge), on a transition with `on_error` and `recover: [steps]`: the supervisor gets the
  error and the PR/MR state and either sends the run back to one of those steps with an instruction
  (a known case, e.g. a conflict), recorded with where, when and why, or escalates to the `on_error`
  gate with its diagnosis. An action failure never ends the run without one or the other.
- **On demand**, "Ask the supervisor" on any run (Run view, orchestrator; a run card's **◆ Send to
  supervisor** attaches the run to the Supervisor's chat instead, #409): it reads
  the run (timeline, every attempt of the failing step, artifacts), explains what happened and the
  root cause, and recommends actions: **resume** from a step (a new run that reuses the previous
  steps' outputs and the agents' conversations, with an instruction for that step), **rerun**, or
  something only a person can change. The analysis is saved as `supervisor/analysis-*.md` in the
  run folder (an artifact). **Chat in terminal** opens the supervisor's CLI in the run folder,
  read-only, to ask follow-up questions.
