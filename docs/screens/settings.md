---
menu: Settings
order: 100
---

Workspace, voice input (**General › Voice input**: OS dictation, the whisper.cpp CLI, model download and language, see Voice input below), CLI status (Claude Code, Codex, Grok Build, GitHub CLI, GitLab CLI, Git) and run preferences (`<workspace>/settings.json`). **Execution › Keep awake**: the switch of the Workflows screen (see Workflows), off by default: no sleep while runs, a roadmap or a queue have work to do. **Execution › Concurrent runs**: off by default (one run at a time); on, several workflows run at the same time up to a **maximum** (default 2), with an optional **maximum per project**; simulations count toward the limits only if you say so. Each run has its own git worktree, and the monthly budgets count every run in progress. The **Run** menu item then lists the runs in progress (status, workflow, project/issue): click one to show it on the Run screen and in the top bar (whose **All runs** counter adds them up); a badge counts the human gates waiting across runs, and a gate never pops up over another screen: a toast names its run
