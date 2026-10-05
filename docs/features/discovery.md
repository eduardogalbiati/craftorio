---
order: 260
---

<!-- section:workspace-tree -->
  discovery/<project>/  private discovery cards (Inbox, Discovery board): board.json, cards/<id>/ (card.json, document.md, acceptance.md, versions/, attachments/, conversation.jsonl), archive/<id>/

<!-- section:workspace -->
- **Discovery cards stay private.** Ideas captured in **Plan & Design › Inbox** are cards in
  `<workspace>/discovery/<project id>/cards/<card id>/` (`<yyyymmdd>-<4 hex>`): `card.json`, the
  working document `document.md`, `acceptance.md`, a snapshot of the document in `versions/` on
  each column move, the files in `attachments/` (any type, up to 50 MB each, original names) and the
  thread in `conversation.jsonl`. A card whose thread ends with a question (an entry of kind
  `question`) waits for the owner: Home lists it under **What needs you** until a note answers it.
  `board.json` keeps the columns and the card order; a discarded or
  merged card moves to `archive/<card id>/` with its reason (and the card it was merged into).
  An accepted card lands in Triage on the **Plan & Design › Discovery** board (Triage → Shape →
  Define → Ready): `board.json` also keeps the WIP limits of Shape and Define (5 by default) and
  each card's place in its column, and `versions/` also gets the document a restored version or a
  Write & Review / AI Arena result replaced, and the result itself (also noted in the thread).
  `card.json` keeps the card's **clarity** (`clarity`: `score` 0 to 100, `gaps`, `ts`, `by`, and
  `override` with the score, the reason and who moved it to Ready below the bar); `board.json` keeps
  the project's bar (`clarity`: `bar`, 85 by default, `byKind`, and `night`, the hours the ready
  forecast counts in). The score never edits a card's text; only **Grill me**, with a person
  answering in the card's thread, writes the answers into it.
  Nothing under `discovery/` goes to the git platform: the folder carries a `.gitignore` that ignores
  everything, and the screens, the Oracle and agents reach a card only through the card API (the
  `discovery:` channels). Through the browser UI (`npm run serve`) a pasted or dropped file is
  limited by the server's request size (15 MB); the desktop app takes the full 50 MB.
