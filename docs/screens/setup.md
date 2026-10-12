---
menu: Setup
order: 115
---

The first-run Setup (#319), a large modal that opens once per workspace after the workspace folder and the sign-in (Settings › Agents & CLIs › **Run setup again** reopens it): a stepper **Agents · Try it safely · Workflows · First project** with Back / Next / Skip (Enter = Next, Esc = Skip after a confirm). **Agents**: one row per CLI with its status (Ready / Not signed in / Not installed / Checking…), version, account and what it is for, and one action (**▶ Install** or **▶ Sign in**, run in the terminal dock; the row checks again when that terminal ends, and **Check again** checks them all). **Try it safely**: **Show simulation mode** (Developer mode, on by default here). **Workflows**: the bundled workflows by category with their requirement badges ("Needs Codex") and Ready / Missing state; the ready ones are picked, the others are hidden from Start and Home (`hiddenWorkflows` in `settings.json`). **First project**: the New project dialog; **Finish** opens Start on the first picked workflow. Finish or Skip records `setupDone` in `settings.json`, so it never opens by itself again; workspaces created before Setup existed count as set up.
