---
item: write-doc
issue: "#636 (phases 0 and 1)"
stage: build
scope: phase 0 (spike) and phase 1 (MVP); phases 2–5 get their own plan.md
status: accepted          # accepted by the owner (engineer / tech lead) on 2026-10-31
spec: spec.md (signed off)
date: 2026-10-31
translation: plan.pt-BR.md
---

# Plan: write doc, phases 0 and 1

Scope: phase 0 (the editor on the reader prototype) and phase 1 (MVP, R1–R13 for intent and spec, with one writer). Left for the next phases, each with its own plan:
- Arena mode and the Planning reorganization (R14): phase 2;
- captures through a project's own command or Run App, "Write a document" on a Discovery card: phase 3;
- the living document in Build, Test and Deploy (R16): phase 4;
- Maintain from the Monitor, a front to browse intents: phase 5.

**Prerequisite:** the document reader's contract (R4): it renders a `.md` in an iframe and reports, through `postMessage`, the source lines of each block and the selection. It comes from the reader's own work, outside this item.

## Files that change

**New**
- `packages/shared/doc-model.js`: the selection payload (file, anchor, lines, passage, context), translation alignment by block, and the markdown lint (front matter, the playbook's sections, R1…, `**Recommended:**`, images). Pure, dual-load.
- `fronts/plan/views/docs/docs.js` and `docs.css`: the Documents screen (items and stages, New item).
- `fronts/plan/views/docs/doc-editor.js`: the editor (the reader's iframe, the stages, the contents, the chat, the selection chip, the change marks, the unreviewed queue).
- `fronts/plan/engine/channels/docs.js` and `fronts/plan/engine/domains/docs.js`: list `docs/work/`, read the runs in progress, swap a section's lines in the source and its translation, commit each request in the run's worktree.
- The engine's `human_edit` step: a gate that accepts requests while it waits; each request is a turn of the named agent; only the person ends it. It joins the protected gates.
- `workflows/write-doc.yaml`: evidence → draft → `human_edit` → review → `human_approval`, for `intent.md` or `spec.md`.
- `skills/intent-writing/SKILL.md` and `skills/spec-writing/SKILL.md`, with their rubrics.
- `scripts/screenshot/views/docs.js` and `features/docs.feature`.
- `poc/doc-editor.html` (phase 0).
- Tests in `fronts/plan/test/` and `packages/engine/test/`.

**Changed**
- `packages/ui-kit/agent-chat.js`: the selection chip and pasted images on a request.
- `apps/desktop/host/main.js` and `window-guards.js`: the `doc://` protocol, opaque origin, no network.
- `fronts/plan/views/duo` and `arena`: still in the menu until phase 2.
- `packages/shared/i18n/*`: the `docs.*` keys.
- Docs: `docs/agents/renderer/documents.md`, `docs/agents/engine/gates-and-run-end.md` (`human_edit`), and the signed-off decisions in `docs/agents/decisions.md`.

## Order of work

1. **Phase 0, the spike:** `poc/doc-editor.html` opens the onboarding example in the reader prototype, with a fake chat. A selection, in the source or in the translation, gives the right payload. No model.
2. **`doc-model.js` and its tests:** the payload, the alignment (with the whole-section fallback), the lint.
3. **`human_edit` in the engine:** the gate, the turns, the protected list, and the tests (no automation answers it; a resumed run comes back to the gate).
4. **`write-doc.yaml` and the two skills,** with mock-provider scenarios for the draft, the edits and the review.
5. **The service:** list, swap lines, commit per request (source + translation), the unreviewed queue, undo.
6. **The editor in the UI:** the reader's iframe, the selection chip, the chat with pasted images, changes by request, the reviewer's notes.
7. **The gates:** Accept intent / Sign off spec change the front matter and commit; "Create epic and phase issues" and "Start the Build" as proposals that wait for the owner's click.
8. **The Documents screen, the screenshot seed, the E2E feature, i18n and the docs.**

## Left after phase 1 (#647)

Phase 1 ships the flow from the intent to a signed-off spec; these parts of R8–R13 move to the next phase's plan:
- R8: the minimum reading width, the contents behind ☰ and the collapsible chat;
- R9: a selection made in the translation (only the source is rendered, no EN/PT switch);
- R10: the Queue to collect requests;
- R11: clicking a message to see that turn's diff inline;
- R12: Apply / Edit / Dismiss on the reviewer's notes and the Auto-apply notes option (the notes are listed only);
- R13: Create epic and phase issues and Start the Build open the Backlog and the Roadmap; the Product Owner's proposal from the spec and the feature workflow's `plan.md` come later.

## Phase 2 (#648): the old names

- `writer-reviewer` and `ai-arena` resolve to `write-doc`, `issue-tracker` to `issue`; `rfc-to-issues` and `enrich-save-develop` to `spec-to-issues` and `enrich-issue`.
- The old inputs are not migrated (accepted at the sign-off): a saved roadmap stage or a manifest that runs `writer-reviewer` or `ai-arena` with their old inputs (`prompt`, `goal`) resolves to `write-doc` and stops at its start with "Required input not provided: item". Its owner gives the stage an `item` (and a `document`) once.

## Risks

- **The reader's contract moves:** the editor talks to it only through `postMessage` messages, with a contract test on both sides.
- **A gate that never ends:** `human_edit` keeps its state in the run; closing the app returns to the same gate, with the chat history.
- **Translation drift:** each request updates the source and the translation in the same commit; the lint compares the headings and anchors of the pair.
- **Unexpected cost:** in simulation nothing calls a model (`MULTIAGENT_SIMULATION_ONLY=1`); for real, every action shows its estimate first.
- **Writes outside the run:** a machine step refuses changes outside `docs/work/<item>/`.

## Proof

- **Unit:**
  - `doc-model` (payload, alignment and its fallback, lint);
  - `human_edit` (requests become turns; only the person ends it; resume);
  - commit per request and undo.
- **E2E (`features/docs.feature`, simulated):** New item → intent draft → a selection and a request → the change shown by request → review → Accept intent; then the spec through Sign off.
- **Screenshots:** `npm run screenshot -- --view docs --mode <list|editor|changes|review|sign-off>`, with the axe checks.
- **No real run** in the checks; a short real session only with the owner's notice and consent.

## Progress

Filled in by the Code & Build workflows at each step: the run, the commit and the PR (in remote mode) or the local merge. Nobody edits this table by hand.

| Step | Status | Run | Commit / PR |
|---|---|---|---|
| 1. Phase 0 spike | pending | — | — |
| 2. `doc-model.js` and tests | pending | — | — |
| 3. `human_edit` in the engine | pending | — | — |
| 4. `write-doc.yaml` and skills | pending | — | — |
| 5. Service: lines, commits, queue | pending | — | — |
| 6. Editor in the UI | pending | — | — |
| 7. The SDLC gates | pending | — | — |
| 8. Screen, seed, E2E, i18n, docs | pending | — | — |
