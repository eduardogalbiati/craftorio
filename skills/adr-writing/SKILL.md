---
name: adr-writing
description: Writes and scores ADRs (Architecture Decision Records) - one decision per record, context and decision drivers, at least two considered options with pros and cons, the chosen option with its reason, consequences and how compliance is confirmed, plus the rubric used to score proposals. Use to write, critique or merge an ADR.
---

# ADR (Architecture Decision Record)

Structure adapted from MADR 4.0 (Markdown Architectural Decision Records, adr.github.io/madr)
and Michael Nygard's original ADR format.

An ADR records **one** architecturally significant decision: why it was needed, what was
considered, what was chosen and what it costs. Someone joining the team a year from now must
understand the decision and its trade-offs without talking to the authors. It is short (one to
three pages): a long ADR usually hides several decisions, which should be separate records.

## Before writing

- Use only what you were given (the request plus project context, if any). If the working
  directory has code or docs, read enough to describe the current state accurately and not to
  contradict existing decisions (look for an existing `docs/adr` or `decisions` folder).
- **Never invent facts** (benchmarks, costs, team size, vendor terms). When you need data you
  do not have, state it as an assumption or an open question.
- **One decision.** If the request mixes several, pick the central one and list the others as
  follow-up decisions.
- Options must be **real alternatives** someone could reasonably pick, including "keep the status
  quo" when it is viable. A straw-man option is worse than none.
- You run unattended: nobody answers questions now. Every open question gets a **recommended
  default**.
- **Durability**: no file paths, line numbers or code snippets; name components, interfaces and
  contracts instead.

## Required structure

Use exactly these sections, in this order, in Markdown:

```
# ADR: <short title naming the problem and the chosen solution>

- Status: proposed
- Date: <YYYY-MM-DD, or "to be set">
- Deciders: <roles, not names>

## 1. Context and problem statement
The situation and the forces at play, in 2–5 short paragraphs; end with the question the
decision answers ("Which X should we use for Y?").

## 2. Decision drivers
Bulleted list of the criteria that decide it (quality attributes, constraints, deadlines,
team skills, cost). Each driver is concrete enough to compare options against.

## 3. Considered options
Numbered list: at least two real options, each with a one-line description.

## 4. Decision outcome
Chosen option: "<option>", because <justification tied to the decision drivers>.
State the scope: what this decision covers and what it does not.

## 5. Consequences
- Good: <what gets better>
- Bad: <what gets worse, the cost accepted>
- Neutral / follow-ups: <new work, follow-up decisions, things to revisit>
Say whether the decision is reversible and what reversing it would cost.

## 6. Confirmation
How compliance is verified: a review checklist, an architecture test, a fitness function, a
metric, a spike with a pass criterion. Include the signal that would make us revisit it.

## 7. Pros and cons of the options
One subsection per option:
### <Option>
- Good, because …
- Bad, because …
- Neutral, because …
Judge every option against the same decision drivers.

## 8. Assumptions and open questions
Assumptions made without confirmation. Then:
Q-1. <question> (owner: <role>). Recommended default: <answer and why>.

## 9. More information
Related ADRs (supersedes / superseded by), links to evidence, when to revisit.
```

## Scoring rubric (0–10 each)

| Criterion | 10 means |
|---|---|
| **Problem framing** | the context is factual and the question the decision answers is explicit |
| **Drivers** | concrete, comparable criteria that really decide between the options |
| **Real options** | at least two viable alternatives (status quo when viable), none a straw man |
| **Balanced analysis** | every option judged against the same drivers, with honest pros and cons |
| **Justified decision** | the outcome follows from the drivers; the reason is not "it is better" |
| **Consequences** | costs and negative consequences stated; reversibility and follow-ups named |
| **Verifiability** | a concrete way to confirm compliance and a signal to revisit the decision |
| **Focus** | one decision, short, no implementation manual |
| **Honesty** | nothing invented; assumptions and questions marked, each question with a default |

Final score = simple average of the criteria, one decimal place.

## Done when

All sections are present, the record holds one decision with at least two real options judged
against the same drivers, the bad consequences are stated, and there is a way to confirm it.
