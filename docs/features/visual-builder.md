---
order: 800
---

<!-- section:workflows -->
## Visual builder

Workflows › **Builder** draws a workflow as a vertical flow of **desks**, each with an agent seated at it
(the same isometric robots as the rest of the app), plus **approval gates**; **+ Desk** / **+ Approval gate** after each arrow insert one right there. Per desk you set:

- what the agent does in the step (its prompt for the step); by default the desk also gets the
  run's task, the previous desk's answer and the notes typed at the gates;
- the agent: **Custom** (a prompt saying who it is, and skills), **Import an agent** (a list of the Agents menu's cards, in a modal) from the
  Agents menu (its look, prompt and skills, still editable) or **Random agent** (one of your
  agents, picked when the run starts; the pick is logged and kept on resume);
- the skills, checked in a list;
- the CLI, model and effort (**default** = the CLI's own, no effort flag), and whether it may only
  read the project folder or also edit files and run commands.

A gate is approved by **a person** (amber arch, a person with a clipboard) or by **an AI agent**
(violet arch with a scanner beam and the agent's robot). A person's gate waits for them; if
rejected it stops the run (cancelled) or sends the work back to an earlier desk with the notes.
An AI check is an agent step (its own CLI, model, effort and prompt, or an imported agent) that
reads the previous desk's answer against your criteria and answers `approved` + `notes`; if
rejected it stops the run (failed) or sends the work back with its notes, up to a number of
rounds (then the run fails). **Save** writes a regular YAML to
`<workspace>/workflows/<name>.yaml` (the engine runs it unchanged; the builder's own data sits
in `x-builder`), **Run** saves and opens the start panel. The workflows it makes take a `task`
and an optional `project_path` (the folder the agents work in; empty = the run folder).
**Send to builder** (Definitions) shows any workflow in the builder:
- the workflows bundled with the app are **read-only**: **Clone** makes your own copy
  (`<name>-copy.yaml`, comments kept);
- your workflows that use what the builder doesn't draw (loops, parallel steps, output schemas,
  other inputs) show them as badges; their agents (CLI, model, effort, prompt, skills, look) and
  the step prompts can be changed, the steps themselves are edited as YAML, and everything else
  in the file is kept;
- workflows made with the builder are fully editable. Hand edits to `providers`, `defaults`,
  `orchestrator` and `observability` are kept when the builder saves again.
