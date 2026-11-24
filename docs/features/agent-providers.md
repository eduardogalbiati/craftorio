---
order: 152.5
---

<!-- section:engine -->
### Agent providers per run, fallbacks and limits per model

**Any agent's provider and model, for one run** (#262). The Start drawer (under Advanced
parameters), the Backlog's Assign dialog and a roadmap item's Edit list each agent of the workflow
under **Agents**: its provider, model and effort, with the workflow's values as defaults. A change
applies to that run only. It is recorded in the run (`workflow.started` `agents`), and a resume
applies it again. The workflow file and the next runs keep their own values. A workflow no longer
needs its own `*_model` inputs for this. AI Development's `developer_model` is one case of it.

**Fallbacks when a provider runs out of credits** (#262). There are two places to declare an
ordered list of entries:
- a workflow, per agent or in `defaults`: `fallbacks: [claude:claude-opus-5-5, codex:gpt-6-luna]`;
- Settings › Agents & CLIs › Fallbacks, one list per provider, for the agents whose workflow
  declares none.

A turn can fail with the provider's quota, credit or usage-limit message. Claude, Codex and Grok are
recognized, e.g. "You've hit your usage limit" or "Credit balance is too low". Then the engine reruns
that turn on the next entry, in a fresh session started from the agent's handoff note, and keeps that
choice for the rest of the run. It tells you three ways:
- a "fell back" line in the run chat, with the reason;
- a mark in the run's agents table;
- a notification, since the provider may be out of credits.

Each turn in the run chat shows the provider and model that answered it. Other errors keep the
normal retries. With no entry left, the run fails with the provider's message. A fallback never
skips a step or a gate.

**Limits that follow the model** (#262). Declare them once per model, in a workflow
(`models: { claude-fable-5-2: { timeout_factor: 3 } }`) or in Settings › Agents & CLIs › Limits per
model. An agent on that model gets its turn timeout multiplied by the factor. A run with an agent on
it may spend up to the model's `max_total_cost_usd` when that is above the workflow's cost limit.
