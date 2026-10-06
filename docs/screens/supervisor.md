---
menu: Workflows › Supervisor
order: 64
---

The Supervisor's chat: the **Supervisor** button of the Workflows screen opens it as a drawer on the right (#254, #264: it has no menu entry and no top bar button any more) that knows the screen you are on (e.g. "Workflows, builder tab, editing workflow X"); **Expand** widens it to the whole conversation and the list of what it can read. Requests from the other agents (the Oracle, the Product Owner) arrive in the same conversation. It reads the app's data through read-only tools (workflows, projects, runs, skills, agents, usage, analytics) served by its own MCP server, never the repositories' code; it never answers a human gate and routes code problems to the workflow's agents. Each message is one model call (developer mode: the simulated supervisor, no cost). While it answers, the chat shows what it is doing (an activity line with a timer, its last steps), then the answer as it is written; **Stop** ends the turn and keeps what was written, marked Stopped (#180)
