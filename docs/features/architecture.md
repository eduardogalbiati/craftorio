---
order: 150.8
---

<!-- section:engine -->
### The Architecture tab

How healthy a project's code is, in any language, and how it changes as runs pile up (#356). The
project's page (**Projects › a project › Architecture**) shows facts the app reads from git, with
no model: per file its lines, its commits (churn), its hotspot rank (lines × commits) and the file
it changes with most (pairs together in at least 60% of the commits of either file), and the
languages by line count. Churn is read on the default branch's current commit (not the checked-out
branch), merges skipped, the creating commit not counted, renames followed,
`.git-blame-ignore-revs` honoured; commits that touched more than 25% of the files are listed as
mass changes (counted by default, with a toggle). Lock files, build output, tests, vendored code and
`.gitattributes`' `linguist-generated` / `linguist-vendored` files are excluded, with a count per
group, plus an editable list per project. The commit, the window (From / To) and a shallow clone are
shown. Complexity per function comes only from a real parser or tool, never a guess (#385):
JavaScript and TypeScript are measured inside the app, with no tool to install and no Python, read
at the facts' commit with the same parser and rules as `scripts/code-health.js` (acorn; one core,
`packages/shared/code-complexity.js`, so both give the same numbers; TypeScript's types are stripped
first, so `enum`, `namespace` and JSX files are not measured). The other languages (Python, Go,
Rust, Java, C#, C/C++, Kotlin, PHP, Ruby, Swift) come from lizard when the machine has it and the
checkout is at that commit, its output checked before use. Without it, the tab names the languages
not measured and how to measure them (`pip install lizard`, which needs Python); their files show no
complexity ("—"), never 0, and churn and size only. Each measured file has its total complexity and its worst function, sits in a quadrant (Danger Zone, Cowboy Code,
Fertile Ground, Healthy Closure, split at the medians on `log1p` axes), the Danger Zone ranks by
`sqrt(u² + v²)` with each axis normalized by its maximum, and monthly frames list the files that
entered or left it. The numbers come from a pure core (`packages/shared/architecture-model.js`, shared
with `scripts/code-health.js --hotspots`), cached per commit. The project's own quality gate
(complexity, coverage, duplication in its CI) is listed as measured, pending or missing: missing
evidence is never shown as clean.

**Analyze this project** (#381: the tab's one action, its combined estimate on the button, ≈ US$
from the project map's past real runs and the last analyses, "no estimate yet" before the first)
starts one run: the project map (the city plan, no gate) and then the Oracle's analysis, one
Oracle turn in its daily budget: it reads the top hotspots and the co-change pairs with its
read-only repository tools and writes a report in English: a summary, a verdict per area, and
findings (kind, files with lines, evidence, severity, one refactor sized as one issue). It never
edits code and never prescribes a fix to a run. An invalid answer is an error, never half a report.
Reports are saved as `architecture/<project id>/<date>.json` in the workspace with their real cost
and tokens; the tab shows the latest (or one you pick), its findings marked **new** or **gone**
since the previous one, and how many real runs finished since. **Send to Refactor** makes a finding
a proposal of the Refactor tab, files its issue and plans it in the roadmap's disabled stage
"Refactor (waiting for your OK)" at the end (#435; see the Refactor tab). The button then stays in
place, disabled, reading "Sent to Refactor", with a link to its issue and stage next to it ("#432 ·
stage 117, waiting for your OK", #447). The same finding from a later analysis adds its evidence to
the existing proposal instead of a second one.

**The project city** (#371) adds structure to the same facts: which area of the product each file
belongs to, and how areas depend on each other, as one deterministic model for the 3D view (#373).
A **city plan** (`architecture/<project id>/city-plan.json` in the workspace, written by the plan
workflow (#372) and checked against its JSON Schema; the plan it replaces is kept in
`city-plan-history/`) names the zones (each one of nine kinds: civic, commercial, industrial,
infrastructure, logistics, power, workshop, library, campus), the districts with `include` /
`exclude` path globs, the landmarks, the ports and the files not drawn (`ignore`). Each drawn file
is a building in the first district whose rules match it (a pattern without a slash matches at any
depth, a leading `/` anchors to the root); the unmatched ones go to the **Outskirts** district. A
building carries its lines, churn, last change and, only when a real parser or tool measured them, its
complexity, worst function and function count ("not measured" otherwise). Without a plan the
districts come from folders: top-level folders are zones, their subfolders districts, a subfolder
under 3 files folds into its parent. Dependency edges are read at the facts' commit: between files
from relative `require`/`import` (JavaScript, TypeScript), between districts from each `Cargo.toml`
dependency on a sibling crate (Rust); for any other language the model says they are not read,
never an empty graph. The validation comes with the model: the share of drawn files matched and the
first 30 unmatched, districts with no files or under 3, unknown zones, duplicate ids, landmark and
port paths missing at the commit, and the plan's schema errors. Same commit, plan and exclusions,
same model (no clock, keys sorted); no model call.

What the numbers can't tell, shown on the tab: churn from a planned migration looks like
instability; complexity tools disagree with each other; code moved between files resets both
metrics; churn says nothing about bugs unless it is joined with fix commits.
