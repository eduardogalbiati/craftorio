# Factor 7: Contact humans with tool calls

## The factor

Asking a person is a tool call like any other: the model emits a structured "I need a human"
output (a question, options, who to ask), the loop pauses, and the answer comes back as an event.
This keeps one output format for every decision the model makes, and lets the agent reach people
over whatever channel they use. ([factor 7](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-07-contact-humans-with-tools.md))

## In this project

- **Human gates are steps of the workflow.** `type: human_approval` opens a gate with a message
  rendered from the run's outputs, free-text `feedback`, `choices` with labels and help, a `summary`
  and a `recommend` line, Run locally and Show the diff (`developer_check` in
  `workflows/software-development.yaml`). The answer is an event (factor 5) and a transition routes on
  it. Gates are answered inline in the run chat, on the Run screen, or from a paired phone
  (`src/domains/workspace/mobile-gates.js`, #226).
- **The supervisor asks instead of guessing.** When the on-call supervisor gives up, its decision is
  `user_action` or `escalate`: the gate opens with its diagnosis and up to three options under the
  message (`supervisorAsksHuman`, `onCallPrompt` in `src/engine/run/supervision.js`). A `kind:
  decision` gate is never answered by the supervisor; only `kind: escalation` gates may be routed
  by it.
- **Automation never crosses a human gate.** A hard rule in `AGENTS.md`, enforced in the engine:
  a pause never answers a gate, a resume never reuses a decision, the Night watch never resumes a
  paused run, and `save_to_issue` writes nothing before the owner confirms the preview.
- **Agents run unattended by design.** Skills record an assumption or a default instead of asking;
  only the Grill me interview may ask (`AGENTS.md`, "Hard rules"). The place to ask is a gate the
  workflow author put there, not the middle of a turn.

## Gaps

- **An agent cannot raise a gate itself.** The factor's shape is an agent output such as
  `needs_human: { question, options }` that the engine turns into a gate and pauses on. Here, an
  agent that hits a real ambiguity mid-turn either picks a default (as the skills tell it to) or
  repeats itself until the stall check wakes the supervisor. Adding the output field would keep the
  unattended rule intact (the run pauses at a gate; nothing blocks waiting for a reply) and give the
  supervisor and the owner the agent's own question instead of a diagnosis after the fact. It
  changes a recorded decision (only Grill me asks), so it needs an entry in `decisions.md` whichever
  way the owner decides. Tracked as #567 under the epic #565.
- **One channel for answers.** Gates reach the owner in the app, by notification and on a paired
  phone; there is no e-mail or chat channel. Enough for a single-owner desktop product today.

## References

- [12-Factor Agents, factor 7](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-07-contact-humans-with-tools.md)
- `docs/agents/engine/gates-and-run-end.md`: gates, summaries, the supervisor on call
- `docs/agents/decisions.md`: unattended agents, Grill me, #368
