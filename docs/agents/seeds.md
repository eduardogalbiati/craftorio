# Writing an analysis seed (#360)

A seed is a prompt the Oracle runs read-only on a project (`src/domains/oracle/oracle-seeds.js`), shown in the
Architecture tab's Seeds section (`src/renderer/views/project/project-seeds.js`, channels in
`src/service/channels/seeds.js`). Bundled seeds live in `seeds/<name>/seed.md` and are seeded into
`<workspace>/seeds/` by `seedSeeds` (`src/domains/seed/seeds.js`, through `seedBundle` of `src/domains/seed/seed.js`): an
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

`test/seed/seeds-360.test.js` validates every bundled seed.

## The answer

One ```json fence `{ html, model }`: a self-contained page and the model it draws. Both are
scrubbed of secrets (`redact`/`scrub` of `src/domains/evidence/findings.js`) before they are written to
`<workspace>/architecture/<project id>/seeds/<seed>/<stamp>/` (`result.html`, `model.json`,
`run.json`). The page is shown in an `<iframe sandbox="">` with a `default-src 'none'` policy: no
script, no network.

## Network needs

A seed reads the network only as it declares, and each read is a command builder and a parser in
both platform adapters (`packages/shared/platforms/`), exposed through `src/domains/oracle/oracle-platform.js`. The CI's
recent runs: `ciRunsCommand` / `parseCiRuns` (`ciRunsCommand` / `ciRunsResult` there), read by the
Oracle's read-only `ci_runs` tool (`src/domains/oracle/oracle-tools.js`) with the project's own CLI auth.

## ways-of-working: the interview's analysis (#487)

`seeds/ways-of-working/seed.md` reads how a repository is worked on (authors per month, merges vs
commits straight to main, tags and their cadence, CI files, test and build scripts, the Architecture
facts' languages, an existing `.multiagent/`) and answers a fixed model: `profile` (`team`:
solo|team, `merge`: local|pr, `release`: milestone|per-merge|train|rc-stable, `testCommand`,
`checkCommand`, `ci`, `languages`) and `evidence` per field (`numbers` and `commits`). A field the
history cannot settle is `null`: the interview asks it. It is not listed only in the Seeds section:
the project page's "Ways of working" drawer (`src/renderer/views/project/project-ways-of-working.js`)
shows its `seeds:estimate` first and runs it through `workflows:interview`
(`src/service/areas/workflow-interview.js`). Both callers run a seed through
`src/service/seed-runs.js` (`runSeed`: the same "already running" guard and error map per service,
the same `architecture/` root), so the Seeds section's estimate, history and busy state see the
interview's runs. In simulation no model runs: the area reads the profile from git (authors, merge
commits, tags), the test command from `detectTestCommand`, the check command from `checkCommand`
(`src/engine/check-step.js`) and leaves the release style open.

## As a tool

"Make it a tool" (`src/domains/seed/seed-tool-issue.js`) files an issue asking for the seed as a deterministic
tool (pure core, cached network data, sorted JSON, a golden test, VERIFY as tests). The tool's
command, recorded as `seedTools[<seed>]` in the project's JSON, prints the model on stdout; a run
then executes it in the project's folder, with no model cost.
