# Shell, PowerShell, Docker and CI pipelines

Apply together with the core checklist in SKILL.md.

## Bash / sh
- Missing `set -euo pipefail` (or explicit error handling) in a script that chains steps.
- Unquoted variable (`$VAR` → `"$VAR"`): breaks on spaces and allows globbing.
- `rm -rf "$DIR/"*` with a possibly empty `DIR`.
- `eval` or a command built from external input.
- Bashisms in a script with a `#!/bin/sh` shebang.
- `curl | sh` from an unpinned/unverified source.

## PowerShell
- `Invoke-Expression` with external input.
- Non-terminating errors ignored: missing `-ErrorAction Stop`/`$ErrorActionPreference = 'Stop'` in automation scripts.
- Unquoted paths with spaces; `Remove-Item -Recurse -Force` on an unvalidated variable.

## Dockerfile
- Base image without a pinned tag (`:latest`); runs as root for no reason.
- Secret in `ENV`/`ARG`/`COPY` (stays in the image) → build secrets.
- `apt-get update` and `install` in separate layers; package cache not cleaned.
- `COPY . .` without `.dockerignore` (leaks `.env`, `.git`).

## GitHub Actions / GitLab CI
- Third-party actions/includes without a pinned version (ideally by SHA).
- GitHub: `pull_request_target` or `workflow_run` checking out and running PR code (untrusted code with secrets). `blocker`.
- GitHub: `${{ github.event.* }}` (title, body, branch) interpolated directly into `run:` → injection. Pass it through `env:`.
- GitLab: protected variables exposed to jobs that run on unprotected branches or fork MRs.
- Missing or too broad `permissions:` (`write-all`) / job token scope; tokens with more scope than needed.
- Secrets printed in logs; `set -x` with secrets in the environment.
- Cache/artifacts shared between trusted and untrusted branches.
- Deploy step/job without a branch/protected-environment condition.
