# Factor 1: Natural language to tool calls

## The factor

The most useful thing a model does is turn a sentence into a structured object that ordinary code
can act on. "Create a $750 payment link for Terri" becomes a JSON object with an amount, a customer
and a description, and a deterministic function does the rest. The model decides *what*; the code
does it. ([factor 1](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-01-natural-language-to-tool-calls.md))

## In this project

- **The supervisor's decisions.** When a step fails, `superviseFailure` in
  `src/engine/run/supervision.js` asks the AI supervisor for one decision in a fixed schema: fix the
  output, retry the step with an instruction, go to an allowed step, or ask a human. `askSupervisor`
  validates the answer against that schema and the engine performs it; the supervisor never runs
  anything itself. The same holds for the supervisor on call (`retry` / `resume` / `route` /
  `user_action` / `escalate`, `onCallSchema`) and for a failed transition action (`recover:` lists
  the steps it may choose from; anything else is an escalation).
- **The Product Owner.** A conversation about an issue ends in a structured action on a service
  channel (`src/domains/po/`, `src/service/channels/`): file the issue, update a task list, add to
  an existing one. The git platform stays the source of truth (`docs/agents/storage/issues-and-backlog.md`);
  the model never writes to it directly.
- **Gate answers.** A human's free-text feedback at a gate is carried as data (`output.feedback`,
  the run-wide `feedback` list) into the next agent's prompt; the engine decides the route from the
  chosen `choice`, not from the text.

Read `docs/agents/engine/gates-and-run-end.md` for the supervisor's decision shapes.

## Gaps

None. The one place where natural language is *not* turned into a structured call is deliberate:
an agent's turn in a CLI (`claude -p`, `codex exec`) is the model's own tool loop, out of the
engine's hands. The engine only sees the final answer (factor 4) and the stream of refused tool
calls (factor 9).

## References

- [12-Factor Agents, factor 1](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-01-natural-language-to-tool-calls.md)
- `docs/agents/engine/gates-and-run-end.md`: the supervisor's schemas and what blocks it
- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): "Routing"
