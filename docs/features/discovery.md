---
order: 260
---

<!-- section:workspace-tree -->
  discovery/<project>/  private discovery cards (Inbox, Discovery board): board.json, cards/<id>/ (card.json, document.md, acceptance.md, versions/, attachments/, conversation.jsonl, filed/), archive/<id>/

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
  **Column automations**: a column of `board.json` may declare `on_enter`, a saved pipeline or a
  workflow run on a card when it enters the column, its inputs from the card (`{{ card.document }}`,
  `{{ card.acceptance }}`, `{{ card.attachments }}`, `{{ card.type }}`); Shape offers **AI Arena →
  Write & Review** on the card's document, Ready the clarity check (Grill me). Each one is **Ask me**
  (the move proposes it with its cost estimate from past runs; the default), **On** or **Off**, set
  from the column's header. The run counts in the project's slots and budgets like any run, the card
  shows **Running…** meanwhile, and its `document` output comes back as a new version with a thread
  entry naming the run and its cost (`card.json`'s `automation`). An automation never moves or
  commits a card and never answers a gate: the run's gates wait for you like any run's.
  `card.json` keeps the card's **clarity** (`clarity`: `score` 0 to 100, `gaps`, `ts`, `by`, and
  `override` with the score, the reason and who moved it to Ready below the bar); `board.json` keeps
  the project's bar (`clarity`: `bar`, 85 by default, `byKind`, and `night`, the hours the ready
  forecast counts in). The score never edits a card's text; only **Grill me**, with a person
  answering in the card's thread, writes the answers into it.
  **Commit to the backlog** is the one place where a card's content leaves the workspace, on the
  owner's click: a Ready card at 85% clarity or more becomes one or more issues on the project's
  repository, each starting with `From discovery card <id>` and holding the card's title, its tasks
  and the first 4000 characters of its document. The card keeps the issue numbers in
  `links.issues`, the text of each issue in `filed/`, and the column `committed`: it is in no board
  column any more and never moves again. A card started from it keeps the link in `links.from`
  (an `intent` filed from a run's finding keeps `{ workflow, runId, finding }` there instead, #633);
  `links.release` is the release that shipped its issues.
  Nothing else under `discovery/` goes to the git platform: the folder carries a `.gitignore` that ignores
  everything, and the screens, the Oracle and agents reach a card only through the card API (the
  `discovery:` channels). Through the browser UI (`npm run serve`) a pasted or dropped file is
  limited by the server's request size (15 MB); the desktop app takes the full 50 MB.
