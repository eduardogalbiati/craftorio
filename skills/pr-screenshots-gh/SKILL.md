---
name: pr-screenshots-gh
description: Publishes a run's UI screenshots on its GitHub pull request (a comment with before/after images stored on the pr-screenshots branch), with the gh CLI. Use when the test step captured screenshots and the PR exists.
uses: [pr-screenshots]
summary: "Screenshots comment on the PR/MR (GitHub `blob/...?raw=true`, GitLab `-/raw/` URLs)"
used_by: "CI pusher"
---

# PR screenshots: GitHub (gh CLI)

Follow the shared **pr-screenshots** skill with `--platform gh` and the PR URL
(`https://github.com/<owner>/<repo>/pull/<number>`):

```
node <pr-screenshots folder>/publish.js --platform gh --pr-url https://github.com/<owner>/<repo>/pull/<number> --dir <run_dir>/screenshots
```

- Images are referenced as `https://github.com/<owner>/<repo>/blob/pr-screenshots/<number>/<file>?raw=true`:
  GitHub renders them inline in the comment, private repositories included.
- The script lists open PRs with `gh pr list` (to prune closed ones) and posts with
  `gh pr comment --body-file -`: `gh` must be authenticated (`gh auth status`).
- To check the result: `gh pr view <number> --comments` (one command per call).
