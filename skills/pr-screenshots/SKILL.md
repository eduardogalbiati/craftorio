---
name: pr-screenshots
description: Shared part of pr-screenshots-gh and pr-screenshots-gl. Publishes the UI screenshots a run captured on its PR/MR as one comment (original/modified side by side), stored on a dedicated pr-screenshots branch, with publish.js from this skill's folder.
summary: "`publish.js`: commits the PNGs to the `pr-screenshots` branch (one folder per PR/MR, closed ones pruned) without touching the checkout, then posts one original/modified comment"
used_by: "via `uses`"
---

# PR/MR screenshots

The steps of a run capture screenshots of the screens a change touches into round folders of the
run (`<run_dir>/evidence/<step>/round-<n>/`, `<issue>-<screen>-<state>.original.png` / `.modified.png`),
indexed in `<run_dir>/evidence/manifest.json`. Only its **final set** is published (the images
marked `final`: the last round that captured), each `modified` image next to its `original` pair:

```json
{ "final": { "step": "evidence", "round": 2 }, "images": [{ "path": "evidence/evidence/round-2/12-settings-general.modified.png",
  "side": "modified", "pair": "evidence/evidence/round-2/12-settings-general.original.png", "caption": "Settings > General", "final": true }] }
```

A run recorded before the evidence folders: `--dir <run_dir>/screenshots` (its `screenshots.json`).

PR/MR comments can't take attachments from the command line, so the images go to a branch of their
own, **`pr-screenshots`**, one folder per PR/MR (`<number>/<name>-<hash>.png`), and the comment points
to them. They render inline for anyone who can see the repository, private ones included.

## Publish

Run the script in this skill's folder, from the repository (one command, no pipes):

```
node <this skill's folder>/publish.js --platform <gh|gl> --pr-url <PR/MR URL> --dir <run_dir>/evidence
```

It:
- commits the images to `pr-screenshots` with git plumbing and pushes that branch only: your checkout,
  index and branch stay as they are, and no force push is ever used;
- replaces this PR/MR's folder (a new capture replaces the old one) and removes the folders of PRs/MRs
  that are no longer open (merged or closed) in the same commit;
- posts **one** comment with the images and prints its body, then `comment: posted`.

## Cleanup

When the PR/MR merges or closes, the workflow itself (not an agent) runs
`node publish.js --cleanup --platform <gh|gl> --pr-url <PR/MR URL>` as a transition action: it removes
that PR/MR's folder, and those of other PRs/MRs no longer open, in one commit. It is best effort and
always exits 0, so it never blocks the merge. You don't run it.

## Rules

- Publish at most once per set of screenshots: if this PR/MR already got the comment for them in this
  run, don't post it again.
- No `manifest.json` or no final screenshots: nothing to publish, say so and move on. Never capture
  screenshots yourself; that is the test step's job.
- Publishing is best effort: if the script fails (no push permission, protected branch pattern,
  network), report the error line in your answer and carry on with your main task. A missing comment
  never blocks CI or the merge.
