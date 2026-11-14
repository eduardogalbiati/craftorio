---
name: developer-self-review
description: The checklist the developer runs on its own diff before its last message (#756) - the shared reuse pass, then the issue's tasks one by one, each with the files of the diff that answer it. Use for the developer of any workflow with a code review.
summary: "Before handing over: the reuse pass on the diff, and each task of the issue mapped to the files of the diff (`left_out` otherwise)"
used_by: "developer"
# the one reuse pass text (shared with code-review), read from its folder: inline it would push the
# develop prompt over its 40K bound (#418)
reads: [reuse-pass]
---

# Developer self-review

Before your last message, the reviewer's two checks on your diff:
1. **Reuse pass** (read the `reuse-pass` skill below): for every new function, constant, mapping
   table or rule of your diff, search for an existing one and reuse it. Your summary carries the
   reviewer's "reuse pass" line: what you searched, what you reused (or nothing found).
2. **The issue's tasks, one by one**: list each task, Docs and Tests included, with the file(s) of
   your diff that answer it. A task with no file goes to `left_out` with its reason, never "done"
   (tasks of another step follow your prompt's `left_out` rule). Your summary never claims a task
   the diff does not touch.
