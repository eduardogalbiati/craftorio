## Providers, availability and budgets

Workflows use three CLIs: **Claude Code**, **Codex CLI** and **Grok Build**. Install and log in to
all three (free plans are enough to start). Before a real run, the app checks that every CLI the
workflow's agents use is installed; if one is missing, the run does not start and the error says
what to install. Simulation mode needs none of them.

**Budgets** (Usage screen, stored in `settings.json`): a monthly limit per provider in USD and/or
tokens. Usage comes from every non-mock run's `summary.json` plus the run in progress. The engine
checks the budget before each agent turn: it logs a warning at 80% and, when "block runs" is on,
stops the turn at 100% (a run that would start over budget is refused).

- Claude Code and Grok report the cost of each turn. On subscription plans that cost is the
  API-equivalent value: treat it as a usage indicator.
- Codex does not report cost: set a price per model (USD per 1M tokens) in Usage to estimate it,
  or use a token budget.
- Tokens = input + output + cache read + cache write (reasoning is already inside output).

**Scope toggle** (Usage screen and the topbar popover):
- **Orchestrator**: only this app's runs (their summary.json files).
- **This machine**: everything the CLIs recorded locally, including use outside the orchestrator
  (interactive Claude Code sessions, other tools running the CLIs). Read from
  `~/.claude/projects/**/*.jsonl` (Claude Code; chunks of the same message counted once),
  `~/.codex/sessions/**/rollout-*.jsonl` (Codex) and `~/.grok/sessions/**/usage.json` (Grok), by
  `src/local-usage.js`. The orchestrator's part is matched by provider session id.
- Codex is metered by the ChatGPT plan's rate-limit windows and credits: its logs carry the plan
  type, the % used of each window and the credit balance, shown on the Codex card.
- Claude Code's local logs have no cost, so outside usage is priced only if you set model prices.
- Account-wide usage (claude.ai web/mobile, other machines) is not available: subscription plans
  have no public usage API.
- A budget can **count usage outside the orchestrator** (per provider option): the pre-run check
  and the per-turn checks then use this machine's totals.
