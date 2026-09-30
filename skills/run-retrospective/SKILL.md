---
name: run-retrospective
description: Mines a finished workflow run's logs (events.jsonl, sessions, decisions.tsv, summary.json) for durable lessons - repeated failures, wasted turns, missing or no-op skill instructions - and turns each into a concrete, reviewable proposal for a skill or workflow edit. Use after a run to improve the skills and workflows.
summary: "Friction, waste, skill gaps and no-ops in a run's logs, turned into proposals with evidence"
used_by: "run retrospective"
---

# Run retrospective

Adapted from reflect (cursor/plugins pstack) and retro (mattpocock/skills), both MIT.
You only **propose** edits; a human decides. You never modify skills or workflows yourself.

## Inputs (in the run folder)

- `summary.json`: status, duration, tokens and cost per session, output of every step.
- `events.jsonl`: every event; the useful types are `step.*`, `session.message_sent`
  (prompts, including injected skills), `session.message_received` (answers), `log`
  (warnings, invalid outputs, retries), `approval.*`, `limit.exceeded`, `decision.logged`.
- `sessions/<id>.jsonl`: per-session stream (tool calls, errors).
- `decisions.tsv`: the agents' decision log, if present.

Files can be large: use search (`grep`/`Select-String`, `jq` if available) instead of reading whole files.

## What to look for

1. **Friction**: steps visited many times, schema validation retries, delegations that bounced
   back, loops that hit their limit, human gates reached because automation gave up.
2. **Waste**: turns spent rediscovering the same fact, long tool sequences that one command
   would do, the most expensive sessions and why.
3. **Skill gaps**: an agent needed knowledge no skill gave it (look at what it searched for or
   got wrong).
4. **No-ops**: skill instructions the agents never needed or always ignore — candidates to delete.
5. **Wrong instructions**: a skill told the agent to do something that failed (wrong command,
   outdated flag).
6. **Good decisions** worth encoding (from `decisions.tsv`).

## Filter lessons

Keep a lesson only if it is:
- **durable**: will matter in future runs, not a one-off accident of this task;
- **evidenced**: points to specific events (step id, event seq, quoted log line);
- **placed**: fits an existing skill or workflow step (prefer editing an existing skill over a
  new one; prefer a mechanical check or a workflow rule over more prose).

## Report (Markdown)

```
# Retrospective: <workflow> run <run_id>

Status: <status> · duration · cost · turns
Top friction: <one line>

## Proposals
### 1. <title>
- Target: skills/<name>/SKILL.md, section <x>   (or workflows/<file>.yaml, step <id>)
- Evidence: <event seq / step / quoted line>
- Change: <the exact text to add, replace or delete>
- Expected effect: <what gets better in the next run>
- Priority: high | medium | low

## Rejected lessons
- <lesson>: why it is not durable or not evidenced
```

## Done when

Every step that looped, failed or needed a human has been explained, and every proposal has
evidence and an exact change.
