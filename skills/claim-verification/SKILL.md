---
name: claim-verification
description: Proves or disproves a concrete claim about a change ("the endpoint now returns 404 for unknown ids", "the build is 30% faster") by running the same command before and after and comparing raw evidence, ending in exactly one verdict - verified, not_verified or inconclusive. Use after a change is built to confirm it does what the task asked.
---

# Claim verification

Adapted from verify-this (cursor-team-kit) and the prove-it-works principle (pstack), both MIT.
You run unattended: you derive the claim yourself and never ask for one.

## 1. State the claim

Derive it from the task and the change summary, and write it so it can be false:
- **subject**: what is observed (a function's result, an HTTP response, a CLI's output, a metric);
- **expected**: the exact observable outcome (value, status code, text, threshold);
- **baseline**: what happens without the change.

"The feature works" is not a claim. "`GET /users/999` returns 404 with `{error: 'not_found'}`
instead of 500" is. If the task has several behaviours, pick the one or two most important
and say so.

If no observable claim can be derived (pure refactor, docs), the verdict is `inconclusive`
with that reason; that is an honest answer, not a failure.

## 2. Pick the evidence command

The cheapest command that observes the claim directly, run by you, deterministic:
a focused test, a script calling the public function, `curl` against the app started locally,
the CLI with a fixture input, a benchmark with a fixed seed and several repetitions.
Existing tests passing is supporting evidence, not proof of the claim.

## 3. Baseline vs treatment

1. **Baseline**: run the command on the base branch (`git stash`/`git worktree add` or check out
   the base commit in a temporary worktree), capture the raw output.
2. **Treatment**: run the same command on the change's branch, capture the raw output.
3. Keep the command and inputs identical. Save both outputs under the run's working area
   (e.g. `.verify/` in a temporary worktree, deleted afterwards), never in the repository's tracked files.
4. For numbers (performance), run each side at least 3 times and report the median and the spread.

## 4. Verdict

| Verdict | When |
|---|---|
| `verified` | treatment shows the expected outcome and the baseline does not (or the claim is a new capability that did not exist) |
| `not_verified` | treatment does not show the expected outcome, or the baseline already did (the change did nothing) |
| `inconclusive` | no observable claim, the command cannot run here (missing service, credentials), or results are noisy beyond the claimed effect |

Report: the claim, the command, the decisive lines of baseline and treatment output (secrets
replaced by `<REDACTED>`), and the verdict with one sentence of reasoning. For `not_verified`,
say what was observed instead, so the developer can act on it.

## Done when

Both sides were run with the identical command (or the reason they could not be is stated),
and exactly one verdict is given.
