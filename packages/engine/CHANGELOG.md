# @craftorio/engine

## 1.0.0

The first engine release under the name Craftorio.

- The agents run on the current models: Fable 5.2, Sonnet 5.5 and Haiku 5.5; a run, a roadmap item or a project saved on an earlier model still runs on it.
- Rule checks tell an environment failure (dependencies not installed, a command not found) apart from a rule failure: the run stops once at check_environment.
- A project with no remote gets a local backlog (`backlog:create-issue`, `backlog:update-issue`, `backlog:close-issue`, `backlog:file-local`).
- A release run releases one product of a repository that declares several in `.craftorio/project.yaml` (`products`).
- A `check` step can name the folder its command runs in (`dir`).
- The guard for a server left in the foreground stops the right one on Windows and Linux, by its start time (#66).
- The Backlog Refresh finds the repository of a project created from a local folder, before any model call (#63, #65).
