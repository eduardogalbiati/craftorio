---
order: 260
---

<!-- section:workspace-tree -->
  discovery/<project>/  private discovery cards (Inbox): board.json, cards/<id>/ (card.json, document.md, acceptance.md, versions/, attachments/, conversation.jsonl), archive/<id>/

<!-- section:workspace -->
- **Discovery cards stay private.** Ideas captured in **Plan & Design › Inbox** are cards in
  `<workspace>/discovery/<project id>/cards/<card id>/` (`<yyyymmdd>-<4 hex>`): `card.json`, the
  working document `document.md`, `acceptance.md`, a snapshot of the document in `versions/` on
  each column move, the files in `attachments/` (any type, up to 50 MB each, original names) and the
  thread in `conversation.jsonl`. A card whose thread ends with a question (an entry of kind
  `question`) waits for the owner: Home lists it under **What needs you** until a note answers it.
  `board.json` keeps the columns and the card order; a discarded or
  merged card moves to `archive/<card id>/` with its reason (and the card it was merged into).
  Nothing under `discovery/` goes to the git platform: the folder carries a `.gitignore` that ignores
  everything, and the screens, the Oracle and agents reach a card only through the card API (the
  `discovery:` channels). Through the browser UI (`npm run serve`) a pasted or dropped file is
  limited by the server's request size (15 MB); the desktop app takes the full 50 MB.
