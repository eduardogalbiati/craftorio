# Writing an analysis seed (#360)

A seed is a prompt the Oracle runs read-only on a project (`src/oracle-seeds.js`), shown in the
Architecture tab's Seeds section (`src/renderer/views/project/project-seeds.js`, channels in
`src/service/channels/seeds.js`). Bundled seeds live in `seeds/<name>/seed.md` and are seeded into
`<workspace>/seeds/` by `seedSeeds` (`src/seeds.js`, through `seedBundle` of `src/seed.js`): an
edited copy freezes like a skill.

## The file

- **Front matter** (read with `parseSkill`, checked against `SEED_SCHEMA` by `validateSeed`):
  `name` (the folder name), `summary` (one line), `needs` (list: git history, CI access through
  the project's CLI, language tools with their fallback), `produces` (list: `html`, `json`),
  `cost` (a hint: one Oracle turn, what it reads).
- **Body**, written for any language: what the analysis produces, its data rules, its layout and
  interaction rules. Name a fallback for every language tool (never "install X").
- **A `## VERIFY` section**: checks the Oracle runs on its own result (totals add up, every file
  listed exists at the commit, no unmeasured value shown as 0).
- **A report-back list** after VERIFY: a line with "tell me" followed by `- ` bullets.
- Credit the source when the text is adapted, and add it to `THIRD_PARTY_NOTICES.md`.

`test/seeds-360.test.js` validates every bundled seed.

## The answer

One ```json fence `{ html, model }`: a self-contained page and the model it draws. Both are
scrubbed of secrets (`redact`/`scrub` of `src/findings.js`) before they are written to
`<workspace>/architecture/<project id>/seeds/<seed>/<stamp>/` (`result.html`, `model.json`,
`run.json`). The page is shown in an `<iframe sandbox="">` with a `default-src 'none'` policy: no
script, no network.

## Network needs

A seed reads the network only as it declares, and each read is a command builder and a parser in
both platform adapters (`src/shared/platforms/`), exposed through `src/oracle-platform.js`. The CI's
recent runs: `ciRunsCommand` / `parseCiRuns` (`ciRunsCommand` / `ciRunsResult` there). They are not
an Oracle MCP tool yet: the Oracle reads CI timings from the repository's workflow files and says
the run timings are missing unless the project's tool provides them.

## As a tool

"Make it a tool" (`src/seed-tool-issue.js`) files an issue asking for the seed as a deterministic
tool (pure core, cached network data, sorted JSON, a golden test, VERIFY as tests). The tool's
command, recorded as `seedTools[<seed>]` in the project's JSON, prints the model on stdout; a run
then executes it in the project's folder, with no model cost.
