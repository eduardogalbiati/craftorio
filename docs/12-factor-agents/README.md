# 12-Factor Agents, applied to this project

A guide to the engineering principles this orchestrator follows when it runs AI agents, written
against the [12-Factor Agents](https://github.com/humanlayer/12-factor-agents) methodology by Dex
Horthy (HumanLayer). Each factor gets one page: what the factor prescribes, where this project
applies it (with the files, workflows and decisions to read), and what is still missing.

The thesis of 12-Factor Agents matches the design of this app: a production agent is mostly
deterministic software with model calls only where judgment is needed. Here the deterministic
part is the engine (`src/engine/`), which walks a workflow graph defined in YAML; the model is called
for one step's turn at a time, and the AI supervisor only when a step fails or stalls.

Audience: whoever changes the engine, writes a workflow or a skill, or wants to know why the app is
built the way it is. It complements [`docs/agents/`](../agents/) (the implementer's topic docs) and
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md); it does not replace them.

## Scorecard (2026-10-25)

| # | Factor | Status | Where |
|---|--------|--------|-------|
| 1 | [Natural language to tool calls](factor-01-natural-language-to-tool-calls.md) | covered | the supervisor's decision schema; the Product Owner files through channels |
| 2 | [Own your prompts](factor-02-own-your-prompts.md) | covered, one known limit | workflow YAML, `skills/`, handoff instructions; the CLI's own system prompt is not ours |
| 3 | [Own your context window](factor-03-own-your-context-window.md) | covered | session modes, handoff notes, `max_total_context`, summarised test results |
| 4 | [Tools are structured outputs](factor-04-tools-are-structured-outputs.md) | covered | `output_schema`, schema retry, transitions on output fields |
| 5 | [Unify execution state and business state](factor-05-unify-execution-and-business-state.md) | partial | files are the source of truth; the live run state is in memory |
| 6 | [Launch, pause, resume with simple APIs](factor-06-launch-pause-resume.md) | covered, one gap | `runs:resume`, `run:pause`; a crash needs the owner to resume |
| 7 | [Contact humans with tool calls](factor-07-contact-humans-with-tool-calls.md) | partial, by decision | human gates are workflow steps; an agent cannot ask mid-turn |
| 8 | [Own your control flow](factor-08-own-your-control-flow.md) | covered | the engine, transitions, `max_visits`, `on_exhausted`, probes |
| 9 | [Compact errors into the context window](factor-09-compact-errors.md) | covered | previous-attempt summary, schema errors, `action_error`, stall detection |
| 10 | [Small, focused agents](factor-10-small-focused-agents.md) | covered | one role per agent, skills per step, read-only agents, child workflows |
| 11 | [Trigger from anywhere](factor-11-trigger-from-anywhere.md) | partial | app, CLI, browser, phone, roadmap, chaining; no inbound platform events |
| 12 | [Make your agent a stateless reducer](factor-12-stateless-reducer.md) | gap | the run advances inside a long-lived object; `events.jsonl` is a record, not the state |
| 13 | [Pre-fetch all the context you might need](factor-13-prefetch-context.md) (bonus) | covered | template filters, `wait:` probes, project map, dependency cache |

Status words: **covered** = the factor is a working rule of the code, with tests; **partial** = the
intent is there but a case is left open; **gap** = not done, with a proposal on the page.

## What to do with the gaps

The three gaps worth acting on, in order of value, each an issue under the epic on agentic
adherence, #565 (see the pages for the reasoning):

1. Factor 12, #566: rebuild a run's state from its event log, so a crash resumes the same run at
   the last finished turn without the owner.
2. Factor 7, #567: let an agent ask for a human as a structured output that the engine turns into
   a gate.
3. Factor 11, #568: start runs from platform events (an issue label, a pull request comment).

## How to read a factor page

Every page has the same four sections:

- **The factor**: what it prescribes, in one paragraph, with the link to the original text.
- **In this project**: the files, workflow fields and decisions that implement it. Paths are
  repository-relative; `#n` is a GitHub issue of this repository; `decisions.md` is
  [`docs/agents/decisions.md`](../agents/decisions.md).
- **Gaps**: what the factor asks that the app does not do, or does differently on purpose.
- **References**: the sources, with the factor's own page first.

## Beyond 12-Factor: the other pattern catalogues

12-Factor Agents is a set of engineering principles, not a catalogue of architectures. For the
patterns themselves, the bundled workflows map onto the established names:

| Pattern (source) | In this project |
|------------------|-----------------|
| Orchestrator-Workers (Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)) | the engine as orchestrator, one agent per step; fan-out steps (`agents: [...]`) |
| Evaluator-Optimizer (Anthropic) | `develop` → `code_review` → `develop` with `max_visits` in `workflows/software-development.yaml` |
| Routing (Anthropic) | `when:` transitions on output fields; `on_exhausted` targets |
| Human-in-the-loop (Data61 catalogue) | `type: human_approval` steps, `kind: decision` gates |
| Reflection (Andrew Ng's four patterns) | the handoff note each agent writes about its own turn |
| Multi-agent collaboration (Ng; Data61) | `ai-arena.yaml`, writer-reviewer rounds, the Supervisor and the Product Owner as separate agents |

- Liu, Y. et al., *Agent Design Pattern Catalogue: A Collection of Architectural Patterns for
  Foundation Model based Agents*, CSIRO Data61, [arXiv:2405.10467](https://arxiv.org/abs/2405.10467v4):
  18 patterns with forces and trade-offs, and a decision model for choosing them.
- *Architecting Agentic Communities using Design Patterns*, [arXiv:2601.03624](https://arxiv.org/pdf/2601.03624):
  the same approach extended to systems of several agents.
- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
  (December 2024): the five workflow patterns and when an agent is worth it over a workflow.
- Ng, A., *Agentic Design Patterns* (The Batch, 2024): Reflection, Tool Use, Planning, Multi-Agent
  Collaboration.
- Phoenix, J., [Agent-Native Architecture](https://understandingdata.com/posts/agent-native-architecture/):
  parity (whatever the UI does, a tool does), granularity, composability. The service channels in
  `src/service/channels/` are this app's version of parity: screens, the Oracle and agents all reach a
  run or a card through the same channel, never by reading the folder.
