---
menu: Agents
order: 70
---

Reusable agents in `<workspace>/agents/<id>.json`: a robot look (main color, shell, visor, glow, eyes, emblem; live preview of the animated states), a prompt with what the agent is for and the skills it always gets. The built-in **Supervisor** is always listed: its prompt and skills are fixed, only its look can be changed (it shows wherever the supervisor appears, e.g. Write & Review). The built-in **Product Owner** (the Backlog's planner, skill `backlog-product-owner`, a teal robot with a clipboard) is listed second: its prompt and skills are fixed; its look, its model (default `claude-opus-5-5`) and its effort (default high) can be changed. Neither can be removed. The visual builder imports them into desks, or picks one at random when a run starts
