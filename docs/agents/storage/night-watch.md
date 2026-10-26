# The Night watch log

The Oracle's Night watch log (#172).

## The Night watch: the Oracle's log (#172)

Files only, in `<workspace>/oracle/` (no index.db table): `night-watch.json` (the switch: `on`,
`until`, `startedAt`, `by`), `night-permissions.json` (the owner's checklist; missing = the
defaults) and `night-log.jsonl`, appended by the service, never by the model: `oracle.watch`
(on, end time moved, off), `oracle.detected` (`packages/engine/service/channels/nightwatch.js`, from run events
and a one-minute roadmap check), `oracle.action` / `oracle.blocked` / `oracle.escalated` /
`oracle.undone` (`packages/engine/domains/oracle/oracle.js`). The nights are the `oracle.watch` windows; every metric
(`packages/engine/domains/night/night-watch.js` `nightMetrics`) is recomputed on read from that log, the runs'
`events.jsonl` (start, end, status, cost, progress events, gates) and the Oracle's `usage.jsonl`.
Lines unblocked come from `git diff --shortstat` of a run's local merge commit.
Self-healing (#278): the switch is `settings.oracle.selfHealing` (settings.json);
`self-healing.json` (`since`) records when the standing watch was turned on and is removed when it
is turned off. Each change writes an `oracle.watch` entry with `selfHealing: true` and `until:
null`; those are not nights but days of the report (`selfHealingDays`: one window per UTC day).
A detector's `oracle.detected` carries its `evidence` and is written once per run and kind (the
log is read at the first finding after a start, so a restart does not log it again).
An app update (#279, `packages/engine/domains/workspace/app-update.js`) writes `oracle/app-update.json` `{ from, to, subjects,
roadmaps, appDir, at }` right before its restart, and an `oracle.action` entry of kind `app.update`
(`from`, `to`, `subjects`). The next start reads it before the roadmap dispatch: within 2 minutes of
`at` it resumes the listed roadmaps and deletes it; later it is kept for the failed-update banner
until the owner dismisses it (`app-update:dismiss`). Setting: `oracle.appUpdate` (a stored
`oracle.appUpdateWhen` is ignored and an item's `updateAfter` is dropped at the roadmap's next save:
both removed by #285).
