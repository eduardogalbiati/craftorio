# @craftorio/engine

## 1.1.0

### Minor Changes

- 0575394: Importing a project says what its analyses cost before they run: the Ways of working profile is free only when no
  model is called, its Oracle turn runs with Analyze (never after the clone, after a restart nor after Skip), and the
  review says what each analysis cost and the total.
- 330bddb: Creating a new project asks its kind (Frontend by default, Full-stack or Backend) and saves it on the project. An empty
  project (a README at most) stays undecided instead of backend, a UI file at the repository's root counts, and a run
  whose change has UI files takes the screenshots and the visual review, or says "Screen not reviewed: <reason>".
- 257f920: Runs scan their own commits for secrets with gitleaks before the review, and a release before Ship: a finding goes back
  to the developer, at most twice, then to you. Without gitleaks the run goes on and says that secrets were not scanned.
  Setup and Settings list gitleaks as an optional CLI.
- 0b7fc5f: A run's cost never counts an unknown model as zero: a turn with no price counts the CLI's own figure, every total that
  includes one is marked "≈", and the run list, the Run screen, the roadmap, the header and Usage give one total for the
  same run. Usage also counts the Product Owner's calls.

### Patch Changes

- 8384f4b: A suite step with `coverage: true` measures coverage only when it runs the whole suite: its rounds of selected files
  (affected, failed first, listed) run without it, and the coverage report is the last whole run's.
- 204d3fd: The suite step's affected tests reach the tests that read a file by a name the code cannot know: a template with an
  unknown part (`workflows/${name}.yaml`) names every file it may be, and an unknown last path part after a literal
  folder names that folder's files, so a changed workflow, fragment, i18n catalog or doc selects the tests that read it.
- Updated dependencies [0575394]
- Updated dependencies [330bddb]
- Updated dependencies [257f920]
- Updated dependencies [0b7fc5f]
  - @craftorio/shared@1.1.0

## 1.0.0

The first engine release under the name Craftorio.

- The agents run on the current models: Fable 5.2, Sonnet 5.5 and Haiku 5.5; a run, a roadmap item or a project saved on an earlier model still runs on it.
- Rule checks find the project's own linter and type checker when it has no `check` script, in `fix` and `refactor` too; only what the change added goes back to the developer.
- Rule checks tell an environment failure (dependencies not installed, a command not found) apart from a rule failure: the run stops once at check_environment.
- A project with no remote gets a local backlog (`backlog:create-issue`, `backlog:update-issue`, `backlog:close-issue`, `backlog:file-local`).
- A release run releases one product of a repository that declares several in `.craftorio/project.yaml` (`products`).
- A `check` step can name the folder its command runs in (`dir`).
- The guard for a server left in the foreground stops the right one on Windows and Linux, by its start time (#66).
- The Backlog Refresh finds the repository of a project created from a local folder, before any model call (#63, #65).
