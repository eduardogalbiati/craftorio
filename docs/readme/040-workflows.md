<!-- generated:workflows -->

<!-- /generated:workflows -->

### The project's default workflow and its workflow per kind

The default development workflow (the one a plan, Split + roadmap, Create + roadmap, the Assign
dialog and Fix the base use when nothing is picked) comes from the project, never from a global
setting: the project's own default (the Workflows block of its page), then the repository manifest's
`default`, then the first build workflow of the project's set, then `feature`. A project imported
from a repository whose `.craftorio/project.yaml` declares `default: <name>` gets it at once.

The manifest's `kinds` map names the workflow, and the inputs, of each kind of issue, which the
import saves on the project and the project's page lets you change (its Feature and Fix workflows):

```yaml
default: ai-development-remote-hero
kinds:
  feature: { name: ai-development-remote-hero }
  fix: { name: fix, mode: remote }
```

The Product Owner classifies each issue as a Feature, a Fix or a Refactor (a `bug` label suggests a
Fix, a `refactor` label a Refactor, the content decides) and gives each one that kind's workflow: a
Fix and a Feature never share a run, a recommendation shows its kind as a badge with a one-line
reason, the plan sums up its runs by kind, and a Feature | Fix | Other control swaps the workflow
(Other lists every workflow that takes a task). Without a map, a Feature runs the project's default
and a Fix runs `fix` in the project's way of working (Local, Remote or Fork + PR). Both names must be
among the manifest's `workflows`, and an entry with a `file` must be named after that file: anything
else is reported as a manifest error and ignored. The map has `feature` and `fix` only (a Refactor
runs on the Feature entry; another key is an error too), and a manifest with errors counts as none
(its workflows, default and kinds are all ignored).

The Product Owner reads every issue as data, never as instructions (#90). An issue written outside
the project (not the owner, a member or a collaborator) shows an *Outside* badge on the Backlog and
the Roadmap, and the PO's verdict next to it: well written or not, injection suspected or not, with
the lines it quoted (*Quarantined* when an injection is suspected). A quarantined issue is in no
plan; one reviewed with no injection suspected may appear in the PO's proposed groups, but enters no
roadmap stage or run until the owner clicks *Approve*; its run's task then says the text came from
outside and is a specification only. See the security model.
