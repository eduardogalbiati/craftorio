# Factor 10: Small, focused agents

## The factor

One agent that does everything loses its way after a few dozen steps. Build small agents that do
one thing in 3 to 20 steps, with a clear input and output, and compose them with deterministic
code. Small agents are testable, their context stays small, and you can give each the model and
tools it needs. ([factor 10](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-10-small-focused-agents.md))

## In this project

- **One role per agent.** `workflows/software-development.yaml` declares a developer, a code
  reviewer, a test writer, a builder, a verifier, an evidence writer, a CI pusher and a deployer,
  each with its own provider, model, session mode, capabilities and skills. The CI pusher and the
  deployer run on a cheaper model because pushing and reading logs need no frontier model.
- **Skills scope the role further.** A step lists the skills its agent gets; `code-review` is one
  skill with per-language rules, `e2e-test-writer-<lang>` and `build-audit-<lang>` are one per
  language, chosen at run time from the inputs. The naming rule (one skill per suffix in every
  family, a suffix-less shared skill with `uses:`) is a test.
- **Capabilities are per agent, not per app.** `capabilities: { tools, web, subagents }` becomes
  each CLI's flags; a reviewer or a verifier is read-only (`docs/agents/capabilities.md`); the
  developer has `edits_tests: false`, so a turn that changes a test file is refused. Child processes
  get an allowlisted environment (#470).
- **Separation of concerns across the app's own agents.** The Product Owner works on the backlog;
  the Supervisor on workflows, skills and runs; the Oracle on the whole app. The supervisor never
  prescribes code fixes: it routes them to the workflow's agents with evidence and hypotheses
  (`AGENTS.md`, "Hard rules").
- **Composition is deterministic.** Fan-out steps run several agents on the same prompt and merge
  their outputs; `type: workflow` starts a child run; `then:` chains runs; fragments
  (`fragments/*.yaml`) compose workflows from the pieces a repository's way of working needs (#487).

## Gaps

None. The thing to watch is prompt growth: a `system_prompt` that keeps absorbing special cases
is a sign the role should split, or a rule should move to a skill.

## References

- [12-Factor Agents, factor 10](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-10-small-focused-agents.md)
- `docs/agents/capabilities.md`: tools, isolation per CLI, read-only agents
- `docs/agents/engine/agents-and-steps.md`: fan-out, step types, agent options
