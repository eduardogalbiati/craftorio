## Workspace

Everything the app produces lives in a local workspace folder:

<!-- generated:workspace-tree -->

<!-- /generated:workspace-tree -->

`AGENTS.md` gives a session opened in the workspace folder the Oracle's role (#43; how to open one:
[INSTALL.md](INSTALL.md), section 7). The app writes it when it opens the workspace and treats it as a
bundled default (below, recorded in the root's `.seeded.json`): yours to edit or delete, and a file you
already had stays yours. It writes no `CLAUDE.md`. A run's Claude and Codex agents do not load the file.

<!-- generated:workspace -->

<!-- /generated:workspace -->
