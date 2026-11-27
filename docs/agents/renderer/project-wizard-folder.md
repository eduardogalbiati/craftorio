# Project wizard: a folder on this computer

How the new-project wizard imports any local folder (#98): what step 2 says about it and what the engine does.

## A folder on this computer

- Step 2 (`fronts/build/views/projects/project-wizard-folder.js`) asks the engine what the picked folder is,
  through `onboarding:inspect-folder` (`packages/engine/domains/project/folder-import.js` `inspectFolder`):
  `repository` (git with a commit; a bare repository too; a `.git` git cannot read stays a repository so the clone's
  access check names the cause), `empty-repository`, `plain`, `missing`, `unreadable`. The line
  `wizard-folder-state` says it before Next; `missing` and `unreadable` keep Next disabled.
- A repository is cloned into `<workspace>/repos/<name>` as before (`file://` URL).
- A plain folder or a repository without a commit becomes a new repository in `repos/` from a copy of its files:
  one first commit, minus what its `.gitignore` ignores (the new project's `.gitignore` when it has none). The
  original folder is only read. Next reads "create and continue". A repository without a commit that had a
  platform origin keeps it as the copy's origin.
- `onboarding:start` refuses a copy before making anything (no project, no folder in `repos/`): `folder-too-large`
  (over 500 MB, `FOLDER_IMPORT_LIMIT_BYTES`, or a file list over git's output buffer), `nested-repository` (the
  folder holds other git repositories, whose files git would not copy), `no-git`.
