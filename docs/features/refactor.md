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

<!-- section:engine order:151 -->
### From a finding to an issue (#730; the Refactor tab of #357 is gone)

A finding of the Oracle's report becomes an issue from where it is: **Projects › a project › Health**
(and the onboarding's review). There is no separate proposals list and no Product Owner ranking any
more: the finding is the diagnosis and the issue is what gets worked on.

- **Create issue** (`architecture:createIssue`, `fronts/analyser/engine/channels/architecture.js`):
  files the finding in the project's tracker with its text, files and evidence and the `refactor`
  label (created first when missing on GitHub; GitLab creates it on filing), naming the Refactor
  workflow (`runDraft` of `packages/engine/domains/refactor/refactor-issues.js`). The finding then shows
  the issue's link instead of the button; a finding already filed is not filed again. **Create issues**
  files the selected findings the same way.
- **Create issue and prioritize**: the same, then the issue is planned as a roadmap item in the waiting
  stage below; the finding shows its stage too.
- **Older proposals** (`<workspace>/refactor/<project>/proposals.json`, made before #730) stay
  readable, listed under the finding they came from, with their issue when they have one. The store,
  the cadence and the success-on-the-map records below keep working for them; nothing new is added to
  the proposals store from the page, and the onboarding sends nothing there on its own.

The rest of this section describes the #357/#435 rules the issue path reuses:

- **The waiting stage** (#435): Create issue and prioritize (the Health tab) files the issue and plans an item on the Refactor workflow in a disabled stage at the end of the
  roadmap, "Refactor (waiting for your OK)", created when there is none; the proposal records its
  `before` score. Nothing runs until the owner enables that stage: enabling it is the authorization.
  Later sends join it while it is disabled; once it is enabled, the next send opens a new waiting
  stage at the end. Stages the Product Owner or the cadence add go before it, so it stays last. A
  proposal on a file an item of the stage already changes joins that item (one run). Each row
  names its issue and stage ("#432 · stage 117, waiting for your OK"). Without a synced backlog the
  send only creates the proposal.
- **Add to roadmap now**: one item on the Refactor workflow in the waiting stage, as above. **Run
  now** plans it instead by the Product Owner's rules (the earliest stage that shares no file with
  it, never before an item it conflicts with), and never inside the stage in progress: at the
  earliest the stage after it, enabled.
- **Dismiss** asks a reason; dismissed proposals stay under the **Dismissed** filter.
- **The cadence** "Add a refactor to the roadmap every X runs" (off by default, X from 3 to 50):
  after every X finished real runs of the project, the top ranked proposal that has an issue and no
  unfinished roadmap item joins the roadmap by those rules (not in the waiting stage). With none ready, nothing is added and the
  tab says "Nothing ready to add: prioritize or file a proposal". The item counts in the budget cap
  like any other, and nothing answers a gate.
- **Success on the map**: when a refactor joins the roadmap its target's quadrant and Danger Zone
  score are kept with the proposal; after its run the row says whether it left the Danger Zone or how
  much its score dropped, and marks a target that did not improve. The header counts the files that
  left the Danger Zone through refactor runs in the last 30 and 90 days.
