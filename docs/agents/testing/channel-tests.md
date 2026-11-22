# Channel tests

The channel sweep (#333), the channel contract (#338) and the contract tests over HTTP with the version handshake (#339).

## The channel sweep (#333)

`packages/engine/test/slow/service-channel-sweep-333.slow.test.js` enumerates the service's manifest (no
hand-written list: a new channel is swept by itself) and calls every channel in a scratch
workspace, under `MULTIAGENT_SIMULATION_ONLY`, with hostile values: the whole argument, then each
named param on its own, missing, `null`, a number, a list, an object, `''`, `../../outside`, an
absolute path outside the workspace, a 1 MB string and an object with a `__proto__` key. Each call
has 4 s. It passes when every call answers or rejects with an `Error` that names the problem
(never a raw "Cannot read properties of undefined"), nothing outside the workspace is created,
changed or trashed, and nothing is left unhandled. The calls run in a child process
(`packages/engine/test/service/channel-sweep-runner.js`): a call that blocks it is killed and named.

- **A failing channel is fixed at its entry**, with the guards of `packages/engine/service/common.js`:
  `requireId` (an id is a file name inside its folder), `requireText` (a string of at most N
  characters), `requireObject` (an options object). The service checks every channel with named
  params once (`requireArgs`): the argument is an object, and a `runId`, `projectId` or `cardId`
  in it is an id. A refusal carries status 400, so `npm run serve` answers it with a 4xx. A
  try/catch that hides the error is not a fix.
- **Gates**: `packages/engine/test/service/gates-hostile-333.test.js` checks that hostile input to
  `approval:resolve` and `runs:resume` never opens a human gate.
- **How to add a skip**: only a channel with effects outside the process (the desktop shell, the
  network, `gh`/`glab`, a push, the machine's shared caches or its own files, installing software as
  `cli-setup:start`, #740) is skipped. Add
  `{ channel, reason }` (or `<area>:*` for a whole area) to `apps/desktop/test/service/channel-sweep-skips.js`;
  the sweep checks that every skip names a channel of the manifest and says why.

## The channel contract (#338)

Every manifest entry carries `schema: { params, result }` (JSON Schema; shared definitions in
`packages/engine/service/schemas.js`, the validator in `packages/engine/domains/workspace/json-schema.js`). The service checks the arguments
against `params` before the channel runs, in the app too (a refusal is a 400 naming the parameter
and the rule). **The result is checked only under the test runner** (`packages/engine/service/contract.js`:
`node --test` sets `NODE_TEST_CONTEXT` in each test file's process): every channel call any test
makes through `service.api` also checks what the channel answers against `schema.result`, and a
mismatch rejects the call (`<channel> answered outside its schema.result: …`), so the test fails.
A test that fails that way found a schema that says less than the channel answers (or a channel
that broke its contract): fix the schema or the channel, never the check. In the app no result is
validated (no runtime cost).

- **The ratchet**: `packages/engine/test/service/channel-schema-ratchet-338.test.js` fails on a channel without a
  schema unless `packages/engine/test/service/channels-without-schema.js` lists it with its reason (arguments
  free-form by design). The list only shrinks: a listed channel that gains a schema leaves it.
- **The reference**: `npm run docs` writes `docs/agents/channels.md` (gitignored), every channel
  with its arguments and result.

## Contract tests over HTTP and the version handshake (#339)

The same contract, seen from outside as a client sees it: `packages/engine/test/contract/contract.test.js` calls
each channel of `packages/engine/test/contract/fixtures.js` with `POST /api/<channel>` and checks the status, the
result against the engine's own `schema.result` (from `GET /api/manifest`) and a 400 for one invalid
argument. The JS engine's answers are the reference a second engine (the Rust phases) must match.

- **Which engine**: `ENGINE_URL` (+ `ENGINE_TOKEN`, the server's token) names one, e.g.
  `npm run serve -- --port 7300` with `MULTIAGENT_SERVER_TOKEN` set, then
  `ENGINE_URL=http://127.0.0.1:7300 ENGINE_TOKEN=<token> node --test packages/engine/test/contract/`. Without it the
  suite starts `node packages/engine/bin/craftorio-engine.js` itself on a scratch workspace in simulation, with no account,
  and stops it after; that is how it runs in `npm test` (about 10 s). Never point it at a workspace
  you use: fixtures create projects, cards, agents, skills and simulated runs.
- **Fixtures**: `{ arg, status?, invalid?, setup?, teardown? }`; `setup` makes the state the call
  needs through the API itself (a project, a card, a simulated run), under unique names, so the
  suite runs in any order and twice in a row against the same engine. Desktop-only channels are
  skipped, as the browser skips them.
- **Coverage ratchet**: the suite prints `contract tests: N of M channels with a schema`;
  `packages/engine/test/contract-harness-339.test.js` fails on a channel with a schema and no fixture unless
  `packages/engine/test/contract/channels-without-fixture.js` lists it with its reason. The list only shrinks.
- **The handshake**: `GET /api/version` (and the `app:version` channel over IPC) answers
  `{ app, contract }`, `contract` being `contractHash` of the manifest (`packages/engine/service/contract.js`):
  any change to a channel, its params or its schemas changes it. `GET /api/manifest` carries the
  same `contract`; the browser UI (`apps/web/renderer/api-http.js`) compares them on every WebSocket
  connection and shows a Reload banner when the engine speaks another contract.
