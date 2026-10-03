---
menu: Supervisor
order: 110
---

The Supervisor as a companion on every screen: the top bar's **Supervisor** button opens a chat drawer that knows the screen you are on (e.g. "Workflows, builder tab, editing workflow X", "Analytics, range 2026-09-01 to 2026-09-30"), and the Supervisor menu item shows the whole conversation full page. It reads the app's data through read-only tools (workflows, projects, runs, skills, agents, usage, analytics) served by its own MCP server, never the repositories' code; it never answers a human gate and routes code problems to the workflow's agents. Each message is one model call (developer mode: the simulated supervisor, no cost). While it answers, the chat shows what it is doing (an activity line with a timer, its last steps), then the answer as it is written; **Stop** ends the turn and keeps what was written, marked Stopped (#180)
