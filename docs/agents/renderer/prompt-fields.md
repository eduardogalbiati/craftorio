# Prompt fields: pasted images and the prompt cache

Images pasted into prompt fields (#130) and the prompt cache's Next turn and Continue line (#320).

## Pasted images in the prompt fields (#130)

`paste-image.js` (`window.PasteImage`, loaded after `voice.js`) shares voice.js's `VOICE_FIELDS`
and its scan/attach pattern (a MutationObserver), so a new AI prompt field gets the mic and image
paste from one selector. One document-level `paste` listener takes the clipboard's images (none
when it holds text) and saves each through `clipboard:saveImage` (a service channel, so the browser
UI works too; `packages/engine/domains/chat/pasted-images.js` writes `<workspace>/attachments/pending/`). Fields with their
own image paste (`#po-question`, `.oracle-input`) are skipped. A screen that submits a field calls
`await PasteImage.collect(field)` (`[{ path, name }]`, empty when nothing was pasted: send the
request unchanged) and `PasteImage.clear(field)` with the text. Chips are Arena's `.ar-chip` plus
`.paste-chip` (`paste-image.css`). Screenshots: `--paste <css>` / `--paste-big <css>`.

## The agents' prompt cache: Next turn and the Continue line (#320)

`packages/shared/session-cache.js` (`window.SessionCache`, the engine's `packages/engine/domains/session/session-cache.js` too) derives how a
session's next turn starts from its snapshot (`currentTurn`: snake_case snapshots or sessionView's
camelCase, recomputed against the clock). The run lists' session table has a **Next turn** column
(`nextTurnCell`, `td[data-testid="session-next-turn"][data-next-turn]`): "fresh from note", "warm ·
42 min left", "cold since 04:57 · ~337K tokens ≈ $X", "new session", "—" when closed; the Run
screen's session cards show the same as a `next turn` metric. The text leads, `.next-turn` colours
warm green and cold orange; the tooltip says what the state means and that the lifetime is an
estimate. `app.js` re-renders an expanded run list once a minute (`tickRunLists`). Every open gate
card (`gateCardHtml` → `gateNextTurnsHtml`, `p[data-testid="gate-next-turns"]`) lists, from
`state.runs.get(runId).sessions`, one entry per agent with an open session (a handoff agent whose
last session closed with its note counts as fresh): "Continue: developer fresh from note ~20K ·
reviewer resumes cold ~140K ≈ $0.70", or "every agent starts fresh or warm · …". It never answers
the gate. The phone page (`packages/engine/domains/workspace/mobile-gates.js`) prints the same line from `runs:active`'s
`nextTurns`.
