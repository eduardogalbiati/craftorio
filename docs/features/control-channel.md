---
order: 116
---

<!-- section:workflows -->
**Control channel for outside sessions** (#336, Settings › Execution › *Allow outside sessions to
control this app*, off by default). A terminal or another agent on this computer (a Claude Code
session working as Oracle or Product Owner on the workspace) drives the running app through the
same channels its screens use, instead of editing workspace files: an action takes effect at once
(a `roadmap:start` dispatches like the Roadmap screen's button) and an edit merges with an open
form on the screen (#287). When the switch is on, the app listens on `127.0.0.1` only, on a free
port, and writes `<workspace>/control/endpoint.json` (`{ "url", "token" }`, a new token on every
start); off, or the app quitting, closes the port and deletes the file. The setting shows the port
and the file's path.

- Only an allowlist of channels answers (`src/control/allowlist.js`): reading runs, events,
  roadmaps, the backlog and settings (`runs:list`, `runs:active`, `runs:events`, `roadmap:get`,
  `roadmap:versions`, `backlog:get`, `settings:get`, `projects:list`, `workflows:list`) and the
  roadmap actions (`roadmap:save`, `roadmap:pause`, `roadmap:start`, `roadmap:item`,
  `roadmap:undo`). Anything else gets `403` naming the channel; a missing or wrong token gets
  `401`; a request from a web page (another origin) gets `403`.
- **Human gates stay closed**: no gate channel is reachable (`approval:resolve`, `phonegates:*`),
  any argument `confirmGate` is refused, and settings are read-only from outside.
- Every call is appended to `<workspace>/control/calls.jsonl` (time, channel, a short summary of
  the arguments, the status, the result's summary or the error).
- The endpoint is part of the running app: nothing here opens a second engine on the workspace (#112).

Calling a channel (`POST /api/<channel>`, body `{ "arg": ... }`, answer `{ "result": ... }` or
`{ "error": "..." }`). With the small client (plain Node, it reads `endpoint.json` from
`MULTIAGENT_WORKSPACE` or `--workspace <dir>`; a refused call exits with 1):

```
node scripts/ctl.js roadmap:get "{\"projectId\":\"my-app\"}" --workspace C:/Users/me/multiagent-workspace
```

With `curl` (the URL and the token from `control/endpoint.json`):

```
curl -s -X POST http://127.0.0.1:<port>/api/roadmap:pause -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"arg\":{\"projectId\":\"my-app\"}}"
```

With PowerShell, which works with the packaged app too:

```
$ep = Get-Content "$env:USERPROFILE\multiagent-workspace\control\endpoint.json" | ConvertFrom-Json
Invoke-RestMethod -Method Post -Uri "$($ep.url)/api/roadmap:start" -Headers @{ Authorization = "Bearer $($ep.token)" } -ContentType 'application/json' -Body (@{ arg = @{ projectId = 'my-app' } } | ConvertTo-Json -Depth 10)
```

The `tools/roadmap` scripts, as channel calls. An edit is `roadmap:get`, then `roadmap:save` with
the changed `stages` (`[{ id?, name, note, items: [{ id?, workflow, issues: [{ number }], mock }] }]`,
keep the ids of what stays), a `label` saying what it did, and `base` (the `updatedAt` read): no
backup to write first, every edit is kept as a version (`roadmap:versions`) and the last one can be
taken back with `roadmap:undo` (`{ projectId, editId }` from the save's answer).

| `tools/roadmap` | Channel calls |
|---|---|
| `pause` | `roadmap:pause` `{ projectId }` (`stop: true`: back to a plan) |
| `resume` | `roadmap:start` `{ projectId }`: dispatches at once |
| `new-stage` | `roadmap:get`, then `roadmap:save` with a new stage `{ name, items: [] }` appended to `stages` |
| `new-stage-at` | `roadmap:get`, then `roadmap:save` with the new stage inserted at its index |
| `add-to-stage` | `roadmap:get`, then `roadmap:save` with the issue added to an item's `issues` or as a new item of that stage |
| `append-issue` | `roadmap:get`, then `roadmap:save` with a new item `{ workflow, issues: [{ number }] }` in the last stage |
| `swap` | `roadmap:get`, then `roadmap:save` with the two stages (or items) exchanged in `stages` |
| `add-task` | `roadmap:get`, then `roadmap:save` with a new item for the task's issue (a local task is created in the Backlog first: `backlog:get` lists it) |
| `restore-stage` | `roadmap:undo` for the last edit; an older stage: `roadmap:versions`, then `roadmap:save` with that stage put back |
| `move-stage-after` | `roadmap:get`, then `roadmap:save` with the stage moved after the other one |

A retry or a skip of the item that paused a roadmap: `roadmap:item` `{ projectId, itemId, action: "retry" | "skip" }`.
