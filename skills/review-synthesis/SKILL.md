---
name: review-synthesis
description: Lead judgment over several independent code reviews of the same diff (from different models) plus an optional blast-radius report - merges duplicate findings, weighs agreement, filters nitpicks and taste, verifies each finding against the code, and sorts them into act on / consider / noted / dismissed with a final verdict. Use when you receive multiple reviews to consolidate.
summary: "Lead judgment: merge, verify, weigh agreement and nitpicks, act on / consider / noted / dismissed"
used_by: "multi-model review judge"
---

# Review synthesis (lead judgment)

Adapted from the interrogate skill's lead judgment in cursor/plugins pstack (MIT).
Reviews arrive anonymized ("Reviewer A, B, C"). Judge findings, not reviewers.

## Process

1. **Read the diff yourself** (`git diff <base>...<branch>`) before reading any review.
   You are a judge who knows the code, not a vote counter.
2. **Merge duplicates**: the same problem reported by several reviewers (even with different
   wording or lines) becomes one finding that lists its reporters.
3. **Verify each finding against the code**: open the file, check the scenario. A finding you
   cannot confirm goes to `dismissed` with "could not reproduce the reasoning" unless it is a
   security or data-loss claim, which goes to `consider` with what would confirm it.
4. **Weigh**:
   - reported by 2+ reviewers and confirmed → strong signal;
   - reported by one reviewer and confirmed → counts fully; a lone finding is not wrong, it just
     needs your confirmation;
   - **nitpick gravity**: reviewers inflate small issues to fill space. A review made only of
     nits means the code is fine on that reviewer's axis;
   - "I would have done it differently" with no concrete failure → dismissed;
   - findings about code the diff did not touch → dismissed unless the diff breaks it
     (the blast-radius report is the evidence for that).
5. **Classify** each merged finding:

| Bucket | Meaning | Severity mapping |
|---|---|---|
| **act on** | confirmed bug, security issue, contract break, missing required behaviour or test | blocker / major |
| **consider** | real but debatable, or plausible and unconfirmed high-impact risk | minor, or major with a doubt |
| **noted** | true but small: naming, small duplication, style the linter misses | nit / minor |
| **dismissed** | wrong, taste, out of scope, or already handled | not reported to the author |

6. **Verdict**: `changes_requested` if anything is in `act on`; otherwise `approved`.

## Report format (Markdown)

```
# Review: <branch> → <base>

Verdict: approved | changes_requested
Agreement: <n> findings reported by 2+ reviewers, <m> by one, <k> dismissed

## Act on
1. <file:line> — <problem, failing scenario> — <fix>. (reviewers: A, C)

## Consider
## Noted
## Blast radius
<the safety fact and its evidence level, from the blast-radius report, if any>

## Dismissed
- <finding> (B): why
```

Replace any secret quoted from code or logs with `<REDACTED>`.

## Done when

Every finding from every review is either merged into a bucket or dismissed with a reason,
and the verdict follows the rule above.
