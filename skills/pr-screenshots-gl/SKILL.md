---
name: pr-screenshots-gl
description: Publishes a run's UI screenshots on its GitLab merge request (a note with original/modified images stored on the pr-screenshots branch), with the glab CLI. Use when the test step captured screenshots and the MR exists.
uses: [pr-screenshots]
summary: "Screenshots comment on the PR/MR (GitHub `blob/...?raw=true`, GitLab `-/raw/` URLs)"
used_by: "CI pusher"
---

# MR screenshots: GitLab (glab CLI)

Follow the shared **pr-screenshots** skill with `--platform gl` and the MR URL
(`https://<host>/<group>/<project>/-/merge_requests/<iid>`):

```
node <pr-screenshots folder>/publish.js --platform gl --pr-url https://<host>/<group>/<project>/-/merge_requests/<iid> --dir <run_dir>/evidence
```

- Images are referenced as `https://<host>/<group>/<project>/-/raw/pr-screenshots/<iid>/<file>`: they
  render in the MR for anyone signed in with access to the project.
- The script lists open MRs with `glab mr list` (to prune closed ones) and posts with `glab mr note`:
  `glab` must be authenticated (`glab auth status`).
- A project that protects every branch (`*`) refuses the push: report it, don't work around it.
