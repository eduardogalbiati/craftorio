---
name: self-review
description: The developer's check of its own diff before answering - correctness against the task, error paths, tests not weakened, no leftover debug code, the code-review rules for the diff's language - fixed with a new commit. A short checklist, not the reviewer's code-review skill (no axes, severity, verdict or findings format).
summary: "The developer's checklist for its own diff before answering, with the code-review rules for the diff's language; fixes go in a new commit"
used_by: "developer (ai-development-local-hero, the develop step)"
# rules/<language>.md of code-review: read access to its folder, its text is not injected (#300)
reads: [code-review]
---

# Self-review

The last thing before answering: read your branch's diff (`git diff <base>...HEAD`, the diff,
not the whole files again) as the reviewer will, and fix what you find. You run unattended:
record an assumption instead of asking.

## Checklist

- **The task**: every requirement and acceptance criterion of the task is in the diff; nothing
  was added that the task did not ask for (or it is said in the summary).
- **Correctness**: edges (empty, null, zero, a list's limits, unicode, paths with spaces on
  Windows), inverted conditions, off-by-one, early returns that skip cleanup, unawaited promises.
- **Error paths**: no error swallowed silently; messages say what failed, without secrets;
  resources (files, processes, servers) released on every path.
- **Security**: no external input raw into a shell, a SQL query, a file path, HTML or a regex;
  no secret in the code, a log or a fixture.
- **Contracts**: a changed function, file format, event or setting still works for every caller.
- **Tests**: no acceptance test edited, skipped or weakened; your own new behaviour has a test
  that would fail without it.
- **Leftovers**: no debug logs (`[DBG-`), commented-out code, temporary scripts or files.
- **Conventions**: the code reads like its neighbours (names, comments, error style).
- **The language's rules**: read `rules/<language>.md` for the diff's languages in the
  code-review folder listed below (e.g. `rules/javascript-typescript.md`, `rules/python.md`,
  `rules/shell-ci.md` for scripts and CI files), and check the diff against them.

On a large diff, one exploration sub-agent may check it against the rules and return only what
it finds. Fix what you find with a new commit (never in an acceptance test), and say in
`self_review`, in a few lines, what you checked and what you changed.
