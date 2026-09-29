# Testing

Read this before writing or changing tests, and before any check that could start a real CLI.

## Running and CI

- `npm test` = node:test unit tests (`test/*.test.js`) + a full mock run of software-development.
- Node 24's test reporter is "spec", not TAP: look for `ℹ pass N` / `✖`, not `# pass`.
- `npm test` must pass on Windows, Linux and macOS: `ci.yml` runs a matrix (checks `test (<os>)`)
  plus a combined `test` check that is green only when all three are. `preview.yml`/`deploy.yml`
  run on `windows-latest` and also run `npm test`. Tests that pass locally can still fail on
  another OS: CI is the judge.

## Machine-independent tests

Git tests run with an empty `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM`, passing identity,
`init.defaultBranch=main` and `core.autocrlf=false` with `-c`. So any production git command that
creates a commit needs its own `-c user.name/email`.

## The mock provider

- Picks the first enum value unless `MOCK_SEQUENCES` has a fitting sequence (or the run's
  `mockSequences` option overrides it). The default sequence fails the preview once with
  `failure_class: code` and recovers. Numbers and booleans take sequences too (`score`, `ready`).
- `mockSequences.invalid_answers: { step: n }` makes the first n answers of a step miss its schema
  (exercises the retries and the supervisor); `permission_denials: { step: n }` refuses every tool
  call; `no_handoff: { step: n }` leaves out the handoff note (exercises the follow-up request).
- Its context grows 30k per turn of the same conversation (start 20k, peak +20k): `max_context`
  rotations are deterministic (`test/fixtures/handoff.yaml`).
- `run:start` takes `mockSequences` (simulation only): the Write & Review scenario picker uses it.
  Settings `developerMode` (replaces `mockByDefault`) shows the `.dev-only` Simulation checkboxes,
  checked by default; off = real runs. Simulated `/loop` waits scale with `MULTIAGENT_MOCK_DELAY_SCALE`.
- To check the flags a real turn gets without a model, point a provider at `node` +
  `test/fixtures/fake-claude.js` (it answers with its own arguments; `test/capabilities.test.js`).

## Real CLIs and money

- Never open real CLI terminals or start real runs in automated checks (they cost money).
- Real-model calls cost the owner's money: say so and keep them minimal (one call to validate).
- In automated checks that go through `resolveCommand`, put a fake **`.exe`** first on PATH (it
  prefers any `.exe` over a `.cmd`) or a real CLI starts.
