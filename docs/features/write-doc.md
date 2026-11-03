---
order: 300
---

<!-- section:workflows -->
## Write doc (`workflows/write-doc.yaml`)

Plan & Design. One run per stage document of a work item (`docs/work/<item>/intent.md`, `spec.md`
or `plan.md`, with its pt-BR translation next to it), started from the **Documents** screen's
**New item** panel. The writer drafts the document, you edit it with the writer by selection, a
reviewer anchors notes to its sections and you sign it off.

| Stage | Who | What it does |
|---|---|---|
| scope | writer | Reads the item and lists the screens of the app worth showing |
| evidence | the screenshot command | Captures those screens (never blocks) |
| compete | up to 5 writers **in parallel** (`writers` 2-5 only) | **Arena mode** ("Several writers", #648): each writer drafts the document on its own; at least one must answer |
| draft | writer | Writes the first draft and its translation (`document.md` in the run folder); in Arena mode it merges the best of the drafts into one |
| edit | you + the writer | Each request of the Documents screen (a selection, its text, pasted images) is a writer turn; one commit per request. **Send to review** ends it |
| review | reviewer | Notes anchored to the sections, scored on the document skill's rubric |
| approval | you | Accept intent / Sign off spec / Accept plan, or send it back to the edit |

Outputs (pipelines, chains): `document` (the draft's text) and `issue` (the issue the run was
started from, when there is one). #648: the former Writer & Reviewer (`writer-reviewer.yaml`) and
AI Arena (`ai-arena.yaml`) workflows are aliases of this one: a saved pipeline, a repository
manifest or a roadmap stage that names them runs `write-doc.yaml`. Their screens left the menu;
past runs still open from Workflows › Runs › **Open run**.
