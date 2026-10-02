---
order: 150
---

<!-- section:engine -->
### The Oracle

The Oracle is a built-in agent (Agents lists it; model and effort editable, default
`claude-opus-5-5`, high) with **one persistent conversation for the whole app**: it plays Product
Owner, supervisor, reliability engineer and operator's assistant in the same context. Its panel is
docked on the **Dashboard**; on every other screen the **Oracle** button at the bottom left of the
sidebar opens the same conversation as a drawer that knows the screen you are on (Esc closes it).
The button's badge counts the answers that arrived while the conversation was out of view.

- **What it reads**, read-only: the runs (events, summaries, sessions, decisions, handoff notes,
  costs), the roadmaps, the Backlog caches and queues, local merges not pushed, the workflows and
  skills (and whether a newer default exists), your projects' repositories (git log/diff/show,
  files) and the app's own code when its repository is a project. Run ids, `#<number>` issues and
  run files in an answer open in the app; other paths copy on click. Paste a screenshot into the
  input (PNG, JPEG, GIF or WebP, up to 5 MB each and 4 per message): it is saved in
  `<workspace>/oracle/attachments/` and the Oracle looks at it.
- **Memory**: your standing decisions ("reply in Portuguese", "validated mode for UI changes"),
  edited only by you from the drawer's **Memory** button and read at every session start.
  **New session** starts over from a handoff note; the conversation and the memory are kept. Past
  the context threshold it compacts on its own the same way.
- **Cost**: each answer shows its time, model, cost and tokens; the footer shows today's spend
  against the **daily budget** (Settings › Execution, default 20 USD, 0 = no cap). Once reached,
  the Oracle is paused until the next day (UTC). Its spend counts in the monthly budgets like the
  runs. Developer mode and automated checks answer from the simulated Oracle: no model call, no cost.
- **It changes nothing yet**: it proposes (issues, workflow edits, repairs) and you act. Waking up
  on events, asking other agents for work and writing with your confirmation come with #123.
- One app process answers: in a second window the drawer shows the conversation and names the
  process that owns it.
