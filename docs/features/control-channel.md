---
order: 116
---

<!-- section:workflows -->
**Control channel for outside sessions** (#336, Settings › Execution › *Allow outside sessions to
control this app*, off by default). A terminal or another agent on this computer (a Claude Code
session working as Oracle or Product Owner on the workspace) drives the running app through the
same channels its screens use, instead of editing workspace files: an action takes effect at once
(a `roadmap:start` dispatches like the Roadmap screen's button; with a local base behind origin it
answers `{ confirm, baseCheck }` until `baseChoice` says `update` or `continue`, #805) and an edit
merges with an open form on the screen (#287). When the switch is on, the app listens on `127.0.0.1` only, on a free
port, and writes `<workspace>/control/endpoint.json` (`{ "url", "token" }`, a new token on every
start); off, or the app quitting, closes the port and deletes the file. The setting shows the port
and the file's path.

- Only an allowlist of channels answers (`packages/engine/control/allowlist.js`): reading runs, events,
  roadmaps, the backlog and settings (`runs:list`, `runs:active`, `runs:events`, `roadmap:get`,
  `roadmap:versions`, `backlog:get`, `settings:get`, `projects:list`, `workflows:list`) and the
  roadmap actions (`roadmap:save`, `roadmap:pause`, `roadmap:cancel-pause`, `roadmap:start`,
  `roadmap:item`, `roadmap:undo`). Anything else gets `403` naming the channel; a missing or wrong token gets
  `401`; a request from a web page (another origin) gets `403`.
- What the operation sessions need (#399):
  - `roadmap:pause-stage` (#368, *Pause after current step*) and `roadmap:park-stage` (#395, *Move on
    from this stage*) act as on the screen: the same refusals (nothing of the stage running; Move on
    while an item runs an agent turn), a line in the roadmap history and an `edit` in the answer for
    `roadmap:undo`. A stage pause is resumed with `roadmap:start`.
  - `runs:resume` `{ runId, step }` resumes a run as the Resume dialog does; `runs:resumeOptions`
    `{ runId }` lists the steps it offers. A resume that would go past a gate the previous run decided
    gets the dialog's refusal. A real (non-mock) `runs:resume` costs the owner's money, like
    `roadmap:start`; it is refused under `CRAFTORIO_SIMULATION_ONLY`. `inputs` is refused (#799): only
    the owner changes a run's inputs, in the dialog.
  - `workflows:restore` puts a workspace copy back to its bundled default, the old copy to the trash.
    Through this channel it is refused, naming the steps, when the copy has a `human_approval` step its
    default lacks (the app's Restore button still restores it).
  - Reads for watching: `notifications:list`, `gates:interrupted`, `nightwatch:state`,
    `nightwatch:report`, `usage:get` (any scope, `machine` included: computed off the main process, #389).
- **Human gates stay closed**: no gate channel is reachable (`approval:resolve`, `gate:*`,
  `phonegates:*`), any argument `confirmGate` is refused, and settings are read-only from outside.
- Left out on purpose: `run:stop` (at a gate, stopping the run is one of the gate's answers);
  `nightwatch:permissions`, `nightwatch:limits`, `oracle:act` and `oracle:nightWatch` (they change what
  automation may do on its own); `settings:set` (it could turn gates or this channel off).
- Every call is appended to `<workspace>/control/calls.jsonl` (time, channel, a short summary of
  the arguments, the status, the result's summary or the error).
- The endpoint is part of the running app: nothing here opens a second engine on the workspace (#112).

Calling a channel (`POST /api/<channel>`, body `{ "arg": ... }`, answer `{ "result": ... }` or
`{ "error": "..." }`). With the client shipped next to the app, `craftorio-ctl` (#342, no Node
needed; Settings › Execution shows its path to copy while the switch is on: `resources/bin/` in
the installed app). It reads `endpoint.json` from `CRAFTORIO_WORKSPACE` or `--workspace <dir>`,
checks the app's contract version (`GET /api/version`) and prints the result as JSON:

```
craftorio-ctl roadmap:get "{\"projectId\":\"my-app\"}" --workspace C:/Users/me/craftorio-workspace
craftorio-ctl --list
```

`craftorio-ctl --list` prints the allowed channels with their argument schemas (`GET /api/channels`).
Exit codes: `0` the result printed, `1` a refused or failed call (the reason on stderr), `2` no
endpoint (the switch is off), `3` the app speaks another contract version (use the client shipped
with that app). In a development checkout, `scripts/ctl.js` does the same under Node.

With `curl` (the URL and the token from `control/endpoint.json`):

```
curl -s -X POST http://127.0.0.1:<port>/api/roadmap:pause -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"arg\":{\"projectId\":\"my-app\"}}"
```

With PowerShell, which works with the packaged app too:

```
$ep = Get-Content "$env:USERPROFILE\craftorio-workspace\control\endpoint.json" | ConvertFrom-Json
Invoke-RestMethod -Method Post -Uri "$($ep.url)/api/roadmap:start" -Headers @{ Authorization = "Bearer $($ep.token)" } -ContentType 'application/json' -Body (@{ arg = @{ projectId = 'my-app' } } | ConvertTo-Json -Depth 10)
```

The `tools/roadmap` scripts, as channel calls. An edit is `roadmap:get`, then `roadmap:save` with
the changed `stages` (`[{ id?, name, note, items: [{ id?, workflow, issues: [{ number }], mock }] }]`,
keep the ids of what stays), a `label` saying what it did, and `base` (the `updatedAt` read): no
backup to write first, every edit is kept as a version (`roadmap:versions`) and the last one can be
taken back with `roadmap:undo` (`{ projectId, editId }` from the save's answer).

| `tools/roadmap` | Channel calls |
|---|---|
| `pause` | `roadmap:pause` `{ projectId }` (`stop: true`: back to a plan; #391 `after: 'stage'`: the current stage finishes first, `roadmap:cancel-pause` takes it back; nothing passed or `'now'`: at once) |
| `resume` | `roadmap:start` `{ projectId }`: dispatches at once |
| `new-stage` | `roadmap:get`, then `roadmap:save` with a new stage `{ name, items: [] }` appended to `stages` |
| `new-stage-at` | `roadmap:get`, then `roadmap:save` with the new stage inserted at its index |
| `add-to-stage` | `roadmap:get`, then `roadmap:save` with the issue added to an item's `issues` or as a new item of that stage |
| `append-issue` | `roadmap:get`, then `roadmap:save` with a new item `{ workflow, issues: [{ number }] }` in the last stage |
| `swap` | `roadmap:get`, then `roadmap:save` with the two stages (or items) exchanged in `stages` |
| `add-task` | `roadmap:get`, then `roadmap:save` with a new item for the task's issue (a local task is created in the Backlog first: `backlog:get` lists it) |
| `restore-stage` | `roadmap:undo` for the last edit; an older stage: `roadmap:versions`, then `roadmap:save` with that stage put back |
| `move-stage-after` | `roadmap:get`, then `roadmap:save` with the stage moved after the other one |

A retry or a skip of the item that paused a roadmap: `roadmap:item` `{ projectId, itemId, action: "retry" | "skip", keepPaused }`; `keepPaused: true` on a skip leaves the roadmap paused until it is resumed (#804).
