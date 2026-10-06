---
order: 510
---

<!-- section:workflows -->
**Enrich a Backlog issue**: **Enrich in Write & Review** in an open issue's **⋯** menu (list row, kanban
card) opens this screen prefilled: an enriched issue by default, a prompt with the
issue's title, number, URL, labels and full body, a default goal for the document type (it follows
the type until you edit it), and the Backlog's project (read-only). Nothing starts by itself. The run
records its issue (`issues` in `workflow.started`): the chat shows it, and the Backlog card shows
"being enriched" / "enriched" with a link to the run (it never moves the card's column). Once you
accept the document, **Save to issue #n…** (in the chat and in Run Details, so you can save later or
again) shows a preview of the text and the command, and saves only when you click it:
- **Replace the description** (default for an enriched issue): the document becomes the body and the
  original description is kept at the end in a collapsed `<details><summary>Original description</summary>`
  block (saving again keeps the first original, never nested);
- **Add as a comment** (default for an RFC, PRD or design doc): the description stays as it is.

It uses the Backlog's CLI: `gh issue edit <n> --body-file` / `gh issue comment <n> --body-file`, or
`glab issue update <iid> --description` / `glab issue note <iid> --message`. Then the Backlog reads the
issue again (new body, task progress, labels), and the run records the save (`issue-saves.json`, the
text sent in `issue-save.md`), shown in Details and Artifacts. A failure (no auth, issue closed or
deleted, network) shows the CLI's message; the document stays in `document.md`. Agents and the
supervisor never save to an issue. A simulated run only shows the preview, and
`MULTIAGENT_SIMULATION_ONLY=1` refuses every real save, so automated checks never call `gh`/`glab`.
