---
name: churn-complexity
summary: Hotspots where files change often and are hard to read, as a churn against complexity chart
needs:
  - git history of the project
  - a complexity measure (the language's own tool when installed, else indentation depth)
produces:
  - html
  - json
cost: one Oracle turn (reads git history and the top files)
---

# Churn against complexity

Adapted from `turbulence` in Kent Beck's ToolSeeds (https://github.com/KentBeck/ToolSeeds, MIT).

Build a picture of where this project hurts: the files that change often (churn) and are hard to
read (complexity). A file that is complex but never changes is not urgent; a file that changes all
the time but is simple is fine. The files in the top-right corner are the hotspots.

## What it produces

- A self-contained HTML page: a scatter chart (x = churn, y = complexity, one dot per file, the dot's
  area = its lines), a table of the 15 worst files sorted by churn x complexity, and a one-paragraph
  reading of the picture.
- A JSON model: `{ window: { since, until, commits }, metric, files: [{ path, commits, lines,
  complexity, score }] }`, files sorted by score, worst first; keys sorted; dates are commit timestamps.

## Data

- Churn: the number of commits that changed the file in the last 12 months (`git log --since`
  `--name-only --no-merges`); follow renames when the history allows it.
- Complexity: the language's own measure when a tool for it is installed (cyclomatic complexity per
  function, summed or the worst function); otherwise the sum of the leading indentation levels of
  the file's non-blank lines (language-agnostic). Say which one you used.
- Leave out generated, vendored and lock files, binaries, and files deleted at HEAD.
- Ignore mass changes (one commit touching more than 100 files): they are reformatting, not churn.

## Layout and interaction

- The chart leads, then the table, then the reading. Hover on a dot shows its path and numbers (a
  `title` attribute is enough). No external script, font or image: inline CSS and SVG only.
- Axes are labelled with their unit; the quadrant lines are at the median of each axis.

## VERIFY

1. Pick the top file and count its commits by hand with `git log --oneline -- <path> | wc -l` over
   the same window: the number matches the model.
2. Open the top file and confirm its complexity reading is plausible (long functions, deep nesting).
3. Pick a file that never changed in the window: it has 0 commits and is not in the top 15.
4. Check that no generated or vendored file is in the table.

When you are done, tell me:
- the five worst files with their churn and complexity;
- which complexity measure you used and why;
- the window and the number of commits read;
- anything you left out and what you assumed.
