# Files are the source of truth

What each run, queue, gate and notification file holds, and how old runs upgrade on read (#350).

## Files are the source of truth

- `runs/<id>/` (`events.jsonl`, `summary.json`, `meta.json`, `sessions/`, `handoffs/`, `decisions.tsv`,
  `evidence/<step>/round-<n>/` screenshots with `evidence/manifest.json`, see engine/evidence.md,
  `attachments/<input>/` and `attachments/<gate>-feedback/` images given to agents (#129),
  `supervisor/attachments/` the images of questions about the run, `tmp/` the temp folder of its
  agents' and suites' tests, #414, removed when the run ends),
  `backlog/<project>.json`, `projects/`, `agents/`, `skills/`, `workflows/`, `pipelines/` (#135), `settings.json`,
  `active-run.json`: plain files, readable by the owner, agents and the supervisor, and portable.
- `runs/po-<project>-<stamp>/`: a Product Owner issue thread (#117: `conversation.jsonl`,
  `analysis/`, `attachments/`, `filed/`), not a run; it has no `events.jsonl` or `summary.json`,
  so run listings skip it.
- `oracle/` (#122, `packages/engine/domains/oracle/oracle.js`): the Oracle's conversation `messages.jsonl` (kept across
  resets), `state.json` (provider session, context size, compaction due), `memory.md` (saved only
  by the owner), `session.md` (the current session's opening prompt), `handoffs/<stamp>-<reason>.md`,
  `usage.jsonl` (one line per real answer; added to Usage and the monthly budgets as one
  summary-like run per day, `usageRuns`) and `owner.json` (the one app process that answers, a
  run-owner heartbeat). Written by the service, never by the model.
- The three conversational agents' usage (#280, `packages/engine/domains/agents/agents-usage.js`): every real turn appends one line
  (a simulated turn records nothing; nothing is ever rewritten) to `oracle/usage.jsonl` (the Oracle),
  `backlog/product-owner.usage.jsonl` (the Product Owner, every project; Clear keeps it) or
  `supervisor/usage.jsonl` (the Supervisor chat; Clear keeps it). Fields: `ts`, `agent` (`oracle`,
  `product-owner`, `supervisor`), `projectId` (Product Owner), `provider`, `model`,
  `tokens { input, output, cache_read, cache_write }` (#308: every model call of the turn, sub-agents
  included), `costUsd` (the turn's own cost), `sessionId` (the
  CLI session), `session` (`fresh` or `resumed`), `startReason` on a fresh session (`first`, `compaction`,
  `model-change`, `idle`, `reset`, `cleared`, `one-shot`) and `contextTokens` (the context after the turn,
  when known); the Oracle's and the Supervisor chat's lines also hold `cumulativeUsd` (the CLI session's total,
  #244) and the Oracle's `wake` (a wake-up's turn). Lines from
  before #280 lack `agent`, `session` and `startReason` (the Product Owner's, `sessionId` too) and are
  read as they are; the Supervisor chat's turns from before its file are read from the answers' `costUsd`
  in `supervisor/chat.jsonl` (cost only, until Clear removes them). Readers: Analytics' Agents tab
  (`analytics:agents`), Usage and the monthly budgets (the Oracle's and the Supervisor chat's days as
  summary-like runs, the Product Owner's month through `usage.withPeerUsage`).
- `phone-gates/devices.json` (#226, `packages/engine/domains/workspace/mobile-gates.js`): the phones paired with the gates page
  (`id`, `name`, `tokenHash` (SHA-256; the token itself is only on the phone), `pairedAt`,
  `lastSeen`); Revoke removes the entry. `phone-gates/secret`: the key that signs the gate links,
  created once, so a link keeps working across restarts until it expires. Pairing codes live in
  memory only: a restart voids them.
- `discovery/<project id>/` (#256, `packages/engine/domains/discovery/discovery.js`): the discovery cards, private to the
  workspace (`discovery/.gitignore` ignores everything; never committed, never sent to the git
  platform). `board.json` (columns `{ id, title, wip }`, the card order per column),
  `cards/<card id>/` (`<yyyymmdd>-<4 hex>`) with `card.json` (id, title, type `idea | prd | rfc | bug |
  hotfix`, column, author, created, updated, tags, clarity, estimate, links, history `[{ ts, from,
  to, by }]`), `document.md`, `acceptance.md`, `versions/<iso ts>-<reason>.md` (a snapshot of the
  document on each column move and before a merge; `snapshotVersion` is there for agent outputs),
  the Discovery board's (#257) columns `inbox, triage, shape, define, ready` with `wip` 5 on Shape
  and Define (`setWip`; the store never refuses a move past a limit, the screen asks), a card's
  place in `order[column]` (`moveCard`'s `index`; a move within its column adds no history entry
  and no version), the versions `before-restore` / `before-result` (the document a restored version
  or a run's result replaced, unless the newest version already holds it) and `result-<source>`
  (`recordResult`, source `write-review` | `ai-arena`, with a thread entry `{ kind: 'result',
  source, runId, version }`), read with `listVersions` / `readVersion` (a name that is not a
  version file is refused),
  `attachments/` (any file up to 50 MB, original names, a taken name gets a `-2` suffix, the same
  content is stored once) and `conversation.jsonl` (the thread, appended). `archive/<card id>/`: a
  discarded or merged card, same layout, `card.archived = { ts, reason, by, mergedInto? }`.
  A committed card (#258, `packages/engine/domains/discovery/discovery-commit.js`): `card.column = 'committed'` (no board column,
  in no `order`; `moveCard` and `mergeCard` refuse it, `restoreCard` keeps it committed, and it is
  kept as it was committed: `updateCard` only takes `links.release`, a new document, attachment,
  restored version, run result or Grill me interview is refused; its thread still takes notes),
  `links.issues` the numbers of the issues filed from it (`markCommitted`; `issueCards` gives the
  Backlog each issue's card from the `card.json` files alone), `filed/<iso ts>-issue-<n>.md` the
  text of each issue, a thread entry `{ kind: 'commit', issues }`; `links.from` on a card created
  from another (`createCard`'s `from`). Its delivery is never stored: the `discovery:board`
  channel computes it on each read from the synced backlog and the release history. Every
  file is written whole (temp file + rename, `writeFileAtomic` in `packages/engine/domains/workspace/state-file.js`); project
  ids, card ids and attachment names are checked before a path is built, so nothing outside a
  card's folder is read or written. No index row: the folders are read directly. Screens, the
  Oracle and agents reach a card only through the `discovery:` channels
  (`fronts/plan/engine/channels/discovery.js`), never by reading the folder.
- **The gate answer record**: a gate's `approval.resolved` event in `events.jsonl` carries
  `approval_id`, `step_id`, `choice` (or `approved`), `by`, `wait_ms`, `feedback?`, `commit?`;
  answered from a paired phone it adds `answered_by: "owner"`, `via: "mobile"`, `device` (the
  device id of `phone-gates/devices.json`) next to the event's `ts`. Only the phone page writes
  them (`answerPhoneGate`, never a channel); the `gates` index row is closed by the same event.
- **Costs and memory events** (#277, #276): a Claude turn with several `result` events keeps them
  as `raw` items of `session.stream` and records its highest total once; `summary.json` carries
  `turn_cost: 'max_result'`. A per-turn run without it is read through its `usage` stream items
  (the run record's `#277 multi-result turn` upgrade, below); the files are never rewritten. The
  memory guard writes `process.killed` and `memory.hold` events (engine/agents-and-steps.md,
  "Memory guard").
- Never make the database the only copy of something a run produced.

### Old runs: the run record upgrades them on read (#350)

A run's files keep the shape they were recorded in, forever: no migration rewrites a run folder.
`readRunRecord(runDir)` (`packages/engine/domains/run/run-record.js`) reads `summary.json` and `events.jsonl` and returns
`{ summary, events }` in the **current shape** (summary null while the run has none);
`readRunSummary(runDir)` returns the summary alone and reads the events only when it needs them.
The upgrade itself, `upgradeRunRecord({ summary, events })` in `packages/shared/run-record.js`, is pure
(the record given is never changed), idempotent, and works on in-memory events too: the renderer
(`app.js`) upgrades a past run's live events with it. Its `UPGRADES` list has one entry per change
of a run's shape, in order: `single issue: issues`, `#233 stopped attempt`, `#233 per-turn cost`,
`#277 multi-result turn`, `sessions in the summary`. The readers (`runFigures`, `analyzeRun`,
`runs.readRun` and the run index, `usage.readRuns` and Analytics, the cost estimates through the
run list, the Oracle's focus) read the current shape only: they never test for an older one. The
run index stores the upgraded summary; bump `READ_VERSION` in `packages/engine/domains/run/runs.js` (and the figures' sig
in `packages/engine/service/areas/insights.js`) when an upgrade changes what was indexed.
Scripts over many runs read them the same way: `scripts/docs-usage.js` (#574) takes each run's
tool calls from the upgraded events (testing/affected-tests.md, "Reading a session stream").

When a change alters what a run records (a field renamed, a cost counted another way, a list moved):
1. Change the engine to write the new shape, with a marker an older record lacks when the shape
   cannot tell by itself (as `cost_accounting: 'per_turn'`, `turn_cost: 'max_result'`).
2. Add one entry to `UPGRADES`, after the ones it builds on, named after its issue
   (`#<n> <what changed>`): `applies(record)` says whether the record has the older shape,
   `upgrade(record)` returns a new record in the newer one (copy what it changes, never mutate) and
   sets the marker, so a second pass does not apply it again.
3. Add a fixture of the older shape to `test/run-record-fixtures-350.js`, its own test, and check
   that the readers give the same figures on it as before.
4. Don't add a branch for the older shape to any reader.
