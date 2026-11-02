## Ways of working: an interview that writes your workflows

On a project's page, **Ways of working** opens a drawer that proposes how to work on the
repository instead of drawing a workflow from scratch. It shows the price first (the
`ways-of-working` analysis seed, read-only, one or two turns); **Analyze** then reads the commit
history (authors, merges, squash vs merge), tags and releases, CI files, test and build scripts and
the Architecture facts, and shows the profile with its evidence ("one author, merges straight to
main, a tag every two weeks: Solo: local merge + Release: milestone"). The interview asks only what
the analysis could not settle (validation, budget per issue, screenshots, review rigour, and the
team, merge or release style when the history does not say); every answer has a default from the
profile, and **Edit profile** overrides any inferred field (team, merge, release, CI, test and
check commands, languages). The proposed set (intake, development in the chosen style, release in
the chosen style) is composed from the step fragments with the project's facts in the prompts.
**Open in Builder** opens the development workflow unsaved; **Write to the repository** puts the
files under `.multiagent/workflows/` and merges them into `.multiagent/project.yaml` (other
entries are kept), uncommitted: you commit them.

The way changes land is one of three modes:
- **Local**: the run merges into the local base and pushes main as its last step; no pull request.
- **Remote**: the run pushes its branch to `origin`, opens a pull request and waits for its CI; it
  is merged on the platform.
- **Fork + PR** (#738): for a repository you can't push to (the onboarding reads gh's push
  permission and offers **Create a fork** or **Work locally**). `origin` is your fork, `upstream`
  the original: before each run the fork's default branch is fast-forwarded to upstream's and
  pushed to the fork; the run's branch goes to the fork and its pull request to upstream's default
  branch (following the repository's CONTRIBUTING.md and PR template), and the run waits for that
  PR's CI. Nothing is ever pushed to `upstream`: the merge is the maintainer's. A roadmap item can
  depend on an earlier one (`dependsOn`): its run starts from that item's branch on the fork, and by
  default its pull request waits for the earlier one to merge and is rebased onto the synced default
  branch (or opens at once saying "Depends on #N", the project's `depends-on` setting).

Details:
[`docs/agents/seeds.md`](docs/agents/seeds.md) and [`docs/agents/engine.md`](docs/agents/engine.md).
