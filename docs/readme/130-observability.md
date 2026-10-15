## Observability

Each run writes to `<workspace>/runs/<run_id>/`:

- `events.jsonl`: every event (step, transition, session, approval, saved file…)
- `sessions/<id>.jsonl`: each session's events (prompts, thinking, tools, output)
- `summary.json`: final metrics per session (duration, active, idle, tokens, cost) and, in `context`,
  per agent: the context at the start and peak of each turn, total tokens, fresh sessions, and the
  tokens spent on turns that could not progress (`waste`: every tool call refused, or a blocked `/loop`
  iteration). The run chat shows each turn's context (start → peak). In `timing`, per step: the
  agents' time split into active (the model working), waiting (a command running) and stalled
  (waiting with no output for longer than `idleWarningMinutes`, default 5, which also logs a
  warning in the run and its chat).
- `handoffs/`: the agents' handoff notes, one per turn
- files written by `save_as` (e.g. `arena/`, `review.md`)
- `decisions.tsv`: the agents' decision log (time, agent, step, phase, decision, why, evidence, result)

The **24/7 chip** in the top bar (#188) shows one number: the share of the last 24 h with at least
one real run active (**24/7 · 87%**; a run waiting at a human gate does not count, simulated runs
never do), green from 90%, amber from 60%, red below, with a dot that pulses while a run is active.
Its tooltip says the active hours and how long it has been idle; a click opens **Analytics › 24/7**
(see Screens). It is computed locally from the runs' `events.jsonl`, the Night watch's log and the
app's heartbeat log (`<workspace>/app-sessions.json`, written every minute by the app that holds the
workspace lock: its gaps are "app closed / machine asleep"), refreshed when a run starts or ends and
every minute; no model call. **Settings › Execution › 24/7 chip in the top bar** hides it.

Notes:
- Claude Code reports cost; Codex does not, so the cost of Codex sessions is empty.
- The Anthropic API counts thinking tokens inside `output`; `reasoning` is only separate for Codex.
