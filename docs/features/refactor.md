---
order: 256
---

<!-- section:workflows -->
## Refactor (`workflows/refactor.yaml`)

Code & Build (#355). One refactor, done safely, in any language the workflows support (`language`
picks `unit-test-writer-<language>` and `build-audit-<language>`). The target is an issue of the
project's refactor list (the usual issue inputs) or a free `target` (files or functions) with the
expected improvement in the task. Behaviour is pinned before the structure changes (Kent Beck: never
mix structural and behavioural changes in one commit):

1. **Pin the behaviour** (`pin_behaviour`, the test writer): characterization tests of the target's
   current behaviour, committed first, in their own commit; it also records the target's figures
   before the change (lines, files, complexity where a parser exists for the language).
2. **Green check** (`green_check`, no agent): the orchestrator runs exactly those files on the
   unchanged code (`expect: green`). A pinned test that fails, or a listed file that is not in the
   worktree, goes back to the test writer, never on; after two rounds the `pin_failed` gate asks
   you (one more round, or stop).
3. **Refactor** (`refactor`, the developer): structure only. It may not edit any test
   (`edits_tests: false`) and the pinned tests are locked (`protect_files`): a turn that changes one
   is refused. No behaviour change, no dependency upgrade, no rename of a public interface the issue
   does not name.
4. **Gates**: the project's full suite (`suite`, no agent; in this repository it includes the
   code-health ratchets) and the build audit (`build`).
5. **Review** (`review`): one question, "same behaviour, simpler structure?", answered from the
   before/after figures of the target (lines, files touched by the change, complexity, or the
   reviewer's reading). A behaviour change goes back to the refactor.

Green: the branch merges into the local base (`merge: local`, never pushed). The run's
`summary.json` records the target's `before` and `after` figures with its cost, so a month of refactor
runs can be compared with `run_analysis` (#184).
