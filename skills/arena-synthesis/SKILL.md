---
name: arena-synthesis
description: Merges independent proposals from several models (AI Arena) into one final document better than any single proposal - scores them, picks a base, grafts the best ideas of the others into it, resolves conflicts with an opinionated decision, and records base, grafts, decisions, rejections and dropouts. Use when you receive several versions of the same document to unify.
summary: "Merge method and the arena appendix"
used_by: "arena synthesizer"
---

# Arena: proposal synthesis

You receive N proposals for the same document, written by different models that **did not see
each other's work**, optionally their cross-reviews, and possibly verifier findings on your
previous version. Proposals arrive **anonymized and shuffled** ("Proposal 2" is not the same
model in every run): judge the content, never try to guess or favour a model.

The final document is **not an average** nor a collage. It is one proposal made better: a base
with the best ideas of the others grafted in, coherent as if written by one author.
Base-and-graft ideas adapted from the arena skill in cursor/plugins pstack (MIT).

## Process

1. **Read every proposal in full** before deciding anything, including each author's
   rationale section (alternatives they considered and rejected, assumptions). Rationales are
   evidence, not content: they never go into the final document.
2. **Score each proposal criterion by criterion** with the document skill's rubric (if there
   is one; otherwise: clarity, completeness, accuracy, actionability, honesty). Not by overall feel.
3. **Weigh the cross-reviews** as evidence, checking each point against the text:
   - a point raised by 2+ reviewers is high signal;
   - a point from one reviewer only counts if you can confirm it in the text;
   - "I would have done it differently" without a concrete problem is dismissed;
   - nitpick gravity: reviewers inflate small issues to fill space; a review made only of nits
     means the proposal is fine.
4. **Check convergence before merging**:
   - **converged** (all proposals reach the same shape): say so, keep that shape, graft only
     what is clearly better; do not invent differences;
   - **diverged on fundamentals** (different problem framing, audience or scope): do not
     average. Pick the framing best supported by the request, and add a **Framing conflict**
     entry to "Open questions" with the competing framings and your recommended default.
5. **Pick the base**: the best-scoring proposal, with ties broken by which one is easiest to
   extend and least self-contradictory. Keep its skeleton and voice.
6. **Graft** from each other proposal, walking it once more:
   - **consensus** items the base lacks → graft;
   - **unique contributions** (a good idea only one proposal has) → graft if correct and relevant;
     this is where the arena creates value. Expect one or two per proposal, not everything;
   - **conflicts** with the base → make **one opinionated decision** with the argument (hybrids
     allowed). If it depends on information you do not have, do not guess: put it in "Open
     questions" with the options and your recommended default;
   - **hallucinations** (facts or numbers with no basis in the request or context) → drop, or
     turn into a marked assumption.
   Rewrite every graft in the base's terms and structure; never paste blocks.
7. **Fix verifier findings** if you received them: address each one or say in the appendix why
   it does not apply.
8. **Review**: no internal contradiction, no duplication, nothing that no proposal supports and
   that you cannot justify yourself, every appendix item reflected in the body.

## Rules

- Keep specificity: between "improve performance" and "p95 < 300 ms", keep the specific one if
  it is plausible and not invented.
- Do not smooth over important disagreements to look like consensus.
- Do not add scope that no proposal brought, except an evident gap (e.g. nobody covered privacy
  in a product handling personal data); mark it as added by the synthesis.
- Length: what is needed. Grafting makes the base more complete, not the sum of all proposals.

## Answer format

Answer **only with the Markdown document**, no preamble, following the document skill's
structure. At the end, add this appendix:

```
---

## Appendix: Arena

### Scoreboard
| Proposal | <criterion 1> | <criterion 2> | … | Score |
(one row per proposal; scores 0–10)

### Base
Proposal N, because … (convergence: converged | partial | diverged)

### Grafts
- <item> (from P3), into section <n>

### Conflicts resolved
- <topic>: P1 said X, P3 said Y → chose X because …

### Rejected
- <item> (P2): reason (no basis in the request / out of scope / incorrect)

### Dismissed critiques
- <critique> on P1: why it was dismissed

### Dropouts
- <label>: reason (or "none")
```

The Rejected list keeps the reason so the same idea is not proposed again in a later round.

## Done when

Every section of the document skill is present, the base is named with its reason, every
conflict is either decided with a reason or listed as an open question with a default, every
verifier finding is addressed, and the appendix is complete.
