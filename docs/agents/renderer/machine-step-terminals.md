# Terminal buttons on machine steps

Live terminals for suite, e2e, check and screenshots steps (#465) and the base check's line.

- **Terminal buttons on machine steps** (#465): a `suite`, `e2e`, `check` or `screenshots` step's
  card shows "Live terminal" and "↗" like an agent session (`termButtons` with `kind: 'log'`), while
  it runs and after it ended. `run.js` keeps each step's latest log from its `step.log` events (else
  the log its output names) and the base check's of that round (`step.log` with `base`); a new round
  switches the tab to the new file. `term:open` with `kind: 'log'` follows `runs/<id>/logs/…` only
  (the service refuses any other path) through `followFile` (`packages/engine/domains/session/session-tail.js`) embedded, or
  `multiagent-tail <runDir> --file <path>` in the external window (same ↗ rules as #318). The
  terminal is read-only (no keys, no paste). The base check (#405) pushes `baseCheck:changed` when it
  starts and ends (`baseCheck:state` answers a screen opened meanwhile); the Roadmap draws it as a
  line of its header's activity band (#750: "Base check since HH:MM · <commit>", then green or red
  with the count; a green one leaves the band a minute after it ended) with one "View terminal"
  button, `term:open` `kind: 'base-check'` through `termAction` (`views/backlog/backlog-live.js`).
