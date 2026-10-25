# Factor 4: Tools are just structured outputs

## The factor

A "tool call" is nothing magical: it is the model emitting JSON in a shape you declared, and your
code deciding what to do with it. Treat the model's answer as structured output, validate it, and
keep the branching in deterministic code. ([factor 4](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-04-tools-are-structured-outputs.md))

## In this project

- **Every agent step declares its answer.** A step's `output_schema` (JSON Schema) says what the
  final `json` block must contain; the `develop` step of `workflows/software-development.yaml` asks
  for `branch`, `summary`, `files_changed`, `test_notes`, `committed`, `left_out`, the screenshot
  list and more. A fan-out agent can extend it with `agent_output_schema` (#387).
- **Validated, then retried once with the errors.** `extractJson` reads the block,
  `validateSchema` (`src/domains/workspace/json-schema.js`) checks it, and `retryPrompt` in
  `src/engine/run/outputs.js` sends the schema and the violations back, asking for the same content
  in a valid shape. A `persistent` agent gets just the fix; an `ephemeral` or `handoff` one gets its
  previous answer too, since its fresh session has not seen it.
- **The output drives the graph.** Transitions test output fields (`when: "output.verdict ==
  'changes_requested'"`, `when: "output.committed"`), never the prose. Enum, number and boolean
  fields form the `decisionKey` the stall check compares across visits (factor 9).
- **A few side effects are declared, not improvised.** `save_as` writes an output field to a file
  under the run folder, the worktree or the project (anything else is refused, #473); a
  `run-tests` block asks the engine to run tests the agent is not allowed to run itself
  (`parseTestRequest`); the `handoff` block is split off by `takeHandoff`.
- **The answer stays parseable whatever the project says.** The prompt of a step with a schema ends
  with `OUTPUT_LANGUAGE` (#94), so a project's `CLAUDE.md` asking for prose or another language
  cannot turn the final message into something the engine cannot read; keys and enum values stay
  English when the agents' language is not (#327).

## Gaps

None. One limit, same as factor 1: the tool calls an agent makes *inside* its CLI turn (read a
file, run a command) are the CLI's structured outputs, not the engine's. The engine constrains them
with the capability allowlist (`docs/agents/capabilities.md`) and counts the refusals, but does not
see each one as data.

## References

- [12-Factor Agents, factor 4](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-04-tools-are-structured-outputs.md)
- `docs/agents/engine/agents-and-steps.md`: `output_schema`, `agent_output_schema`, `save_as`
- `docs/agents/engine/field-reference.md` (generated): every field and its type
