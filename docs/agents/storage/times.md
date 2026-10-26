# Times

Times are stored in UTC, cut and shown in the owner's zone (#273).

## Times: stored in UTC, cut and shown in the owner's zone (#273)

- **Stamps stay UTC ISO** (`…Z`) everywhere: events, summaries, usage lines, the night log, the
  index. Nothing is rewritten when the zone changes.
- **The zone** is `settings.timeZone` (Settings › General › Time zone, an IANA name). Unset, it is
  the computer's: `readSettings` fills it in, `writeSettings` does not save it until one is chosen.
- **One helper** cuts and formats: `packages/shared/time-zone.js` (`window.TimeZone`; `packages/engine/domains/analytics/time-zone.js`
  in the main process). Day keys, local midnights, weeks, months and visible times go through it.
- **What follows the zone**: Analytics and Usage days and months, the agents' usage days, the
  Oracle's daily budget and its reset, the day budget (#206), the Product Owner's month, GitHub
  Actions' month, the 24/7 meter's days and nights, Home's today, the issue update date, every
  screen's times. The Oracle, the Product Owner and the Supervisor chat get a `[Time]` line (zone and
  local time) in each turn, not in the skill, so the prompt cache stays.
- **What stays UTC**: the Self-healing report's days (`selfHealingDays`, `watchSince`'s loop cap) and
  ids or file names built from a stamp. A pure function given no zone cuts in UTC (the service always
  passes one), so its tests do not depend on the machine's zone.
