---
order: 600
---

<!-- section:workflows -->
## Issue tracker (`workflows/issue-tracker.yaml`)

Plan & Design. Turns a request in a few words (any language) into a triaged GitHub/GitLab issue.
Start it from the Backlog's **New issue…** button (the selected project and platform are filled in)
or from the Start panel. Inputs: `request`, `project_path`, `mode` (**Validated**, the default, or
**Automatic**, shown next to the request), `git_platform` (`gh`/`gl`), and the optional `related`
("#41, #79"), `attachments` (screenshots, logs), `max_revisions` and `assign_workflow`.

| Step | Agent | What it does |
|---|---|---|
| `analyze` | `code_analyzer` (Sonnet, read-only: git and gh/glab to read) | Finds the code involved and today's behaviour (file:line), estimates the files to change, rates **impact** and **complexity** 1–5 (`issue-triage` rubric), searches issues and open PRs/MRs for duplicates and work in flight, advises running it alone or grouped with #n, lists the labels the repository lacks. |
| `write` | `issue_writer` (Opus, read-only) | Drafts the issue(s) in English with `issue-writing`: evidence, "Decision (owner): …", tasks as acceptance criteria, a Triage section, labels. Independent parts become cross-linked issues. |
| `review` | you (Validated; Automatic skips it) | The scores, the grouping advice and the draft(s), in the run chat. **Create**, **Create and queue** (a chain to the queue, see *Chaining workflows*: once the run succeeds, the new issues go to the Backlog queue for `assign_workflow`, as one run when grouping was advised), **Revise** (your note goes back to the writer, `max_revisions` rounds), **Add to #n instead** (comment on the existing issue), **Discard**. |
| `file` | `issue_filer` (Sonnet, gh/glab only) | Creates the issue(s) or comments on the existing one, with the labels, and reports the URLs. |

**Automatic mode** (`mode: auto`): `write` goes straight to `file`, which creates the drafts as
they are: no review, no revise rounds, nothing queued for `assign_workflow` (the issues show on the
Backlog after its next sync). You chose it at start, so no gate is skipped on your behalf. Two
cases still need you: a draft that found an existing issue (a possible duplicate) stops at the
review, with a line saying why; and missing labels are not created (the filer uses the existing
ones and lists the skipped ones in its summary), since only a person confirms new labels.

**Labels**: `impact:1`…`impact:5`, `complexity:1`…`complexity:5`, the kind (`bug`, `enhancement`,
`documentation`) and optional `area:engine`, `area:renderer`, `area:workflows`, `area:docs`. The ones
the repository does not have are listed at the review and created once, by the filer, only after
your choice there; the generic `issue-creator-*` skills keep using existing labels only. On the
Backlog, the triage labels show as `I3`/`C2` badges on each issue, the **Sort** menu orders by impact
or complexity, and the Labels filter narrows by them (e.g. `complexity:1 OR complexity:2`).
