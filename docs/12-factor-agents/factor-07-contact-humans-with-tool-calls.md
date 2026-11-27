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
- **The supervisor answers alone only with a safe answer (#124).** At an escalation gate its `route`
  is applied without the owner only when it is the gate's recommended answer or one that does not
  merge or push (retry, stop); "the failures are pre-existing" counts only when the engine confirmed
  them on the base (#211), never on an agent's report. Any other answer opens the gate for the owner
  with the supervisor's recommendation and reason on it.
- **Automation never crosses a human gate.** A hard rule in `AGENTS.md`, enforced in the engine:
  a pause never answers a gate, a resume never reuses a decision, the Night watch never resumes a
  paused run, and `save_to_issue` writes nothing before the owner confirms the preview.
- **Agents run unattended by design.** Skills record an assumption or a default instead of asking;
  only the Grill me interview and a step that opts in may ask (`AGENTS.md`, "Hard rules").
- **An agent can raise a gate on its own step (#567).** A step with `ask_human: true` (in the
  bundled workflows: `develop` of `software-development`) adds the shared `needs_human: { question,
  options: [{ id, label }], default }` fragment to its `output_schema` (`NEEDS_HUMAN_SCHEMA`,
  `packages/engine/engine/run/outputs.js`). An answer with a question ends the visit without a
  transition and opens a `kind: decision` gate of the step (`agentQuestion` in
  `packages/engine/engine/run/gates.js`, `approval.requested` with `by: 'agent'`); the answer comes
  back to the same agent's next turn as `human_answer`. Nothing blocks: the run waits at a gate like
  any other. A second question in a row is a stall the supervisor on call may settle with the
  agent's own default (`superviseQuestion`), recorded as its decision.

## Gaps

- **One channel for answers.** Gates reach the owner in the app, by notification and on a paired
  phone; there is no e-mail or chat channel. Enough for a single-owner desktop product today.

## References

- [12-Factor Agents, factor 7](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-07-contact-humans-with-tools.md)
- `docs/agents/engine/gates-and-run-end.md`: gates, summaries, the supervisor on call
- `docs/agents/decisions.md`: unattended agents, Grill me, #368
