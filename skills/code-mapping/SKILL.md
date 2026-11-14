---
name: code-mapping
description: Maps the code a task touches before anyone edits it - per issue, the production files and functions to change or reuse with their line numbers, the existing helpers, rules and tables the change must reuse instead of rewriting, how they connect, the tests that cover each file (direct first, then transitive) as a run-tests block, and the conventions to follow - in a capped map the developer starts from. Use for a read-only mapping step before the developer (e.g. the Warm Up step).
summary: "Maps the files, functions, line numbers, connections, helpers to reuse, tests and conventions of a task before the first edit, in a map of at most 300 lines"
used_by: "mapper"
---

# Code mapping

You run before the developer, read-only, and nobody can answer questions: record an assumption
instead of asking. Your map is the first thing the developer reads; it then reads only the files
the map names, at the lines it points to, and starts its own exploration only for what the map
lacks. Anything you leave out, it must re-discover at full price; anything wrong sends it down the
wrong path. Never edit, create or delete a file, never commit, never run the tests or a build.

## 1. Start from the task and its tests

- Read the task, each issue and its criteria, and the acceptance tests the test writer wrote (they
  name the modules the change must reach: follow their `require`/`import` lines first).
- Fan out: when the task touches more than a few files, start exploration sub-agents in parallel,
  one per question or area, and merge their answers. Read excerpts, not whole files.

## 2. What the map contains, per issue

One section per issue (`## #<number> <title>`); a single task without an issue gets one section.
In each section:

- **Files to change**: each production file, with the functions (or the blocks: a YAML step, a
  CSS rule, a template) and their **line numbers**, and one line on what changes there.
- **Files to reuse**: helpers, components and shared lists the change should call or copy, with
  line numbers; the ones the change would otherwise rewrite also go into the reuse list (section 3).
- **How they connect**: who calls what, where the data comes from (the request, the event, the
  store, the file), and where the result goes (the screen, the event, the output).
- **Tests to run**: for each production file the section names, the test files that reach it,
  from the code → tests map of the checkout (given in your prompt): the **direct** tests first
  (they import the file), then the **transitive** ones (they reach it through other files). A file
  no test reaches is marked `no test reaches it`: a hint for the test writer, not an error.
  Add the acceptance tests of the run.
- **Conventions to follow**: naming, the idiom of the neighbouring code, the comment density,
  merge-friendly rules (a shared list one item per line, sorted), the test ids and roles a screen
  uses: the ones a reviewer would check.

Short excerpts only where a signature or a shape matters (a function's parameters, an output
schema); never paste whole functions.

## 3. The reuse list, per issue

Rewriting what the repository already has is the most frequent reason a review sends the
developer back (#758). For each issue, list the existing functions, constants, rules and mapping
tables the change will need, so the developer calls them instead of writing its own copy:

- Look for them in three places: the names and concepts of the issue's text and of its
  Expected files (search by name, by synonym and by the literal values a new helper would map); the helpers
  of the files the map already names; the shared modules, `packages/shared/` and `packages/ui-kit/`.
- One entry each: `name`, `path`, `line` (where it is defined) and `what` (one line on what it
  does). Only what the change needs, not every helper of a mapped file.
- At most ~30 lines per issue. Nothing found: an empty list (develop and the reviewer then show
  nothing).

The developer's prompt shows the list as "reuse these, do not rewrite them", and the reviewer
starts its reuse pass from it.

## 4. The tests to run, as a block

End each section with the tests to run before committing, as a block the developer and the test
writer can run as it is (focused files only, never the whole suite: the orchestrator runs it):

```run-tests
node --test test/acceptance.test.js test/direct.test.js test/transitive.test.js
```

Use the project's own focused form when it is not a Node project (e.g. `pytest <files>`,
`go test ./pkg/...`).

## 5. Size

The whole map stays under **300 lines**. Cut the explanation, not the line numbers or the tests:
a list of `path:line function - what` beats a paragraph. When a run has many issues, shorten each
section rather than dropping one.

## 6. Answer

- `map`: the map above, in Markdown.
- `files`: every production and test file the map names, repository-relative, sorted.
- `reuse`: the reuse list of section 3, one object per entry (`issue`, `name`, `path`, `line`,
  `what`); an empty list when there is none.

## Done when

Each issue has its section with files, line numbers, connections, tests to run (direct, then
transitive, or `no test reaches it`) and conventions, its reuse list is in `reuse` (or empty), the
map is under 300 lines, and no file was changed.
