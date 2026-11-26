## Code signing policy

Free code signing provided by SignPath.io, certificate by SignPath Foundation. **Status:** applied for
([#96](https://github.com/eduardogalbiati/craftorio/issues/96)); until it is approved the Windows and macOS packages
are not signed, and each system warns once at the first start (see Install).

Every signed package is built by the Deploy workflow (`.github/workflows/deploy.yml`) from a release tag of this
repository, and each signing request is approved by hand.

**Team roles**

- **Committers**: [the repository's collaborators](https://github.com/eduardogalbiati/craftorio/graphs/contributors)
  push to their own branches; `main` changes only through a pull request.
- **Reviewers**: every pull request to `main` is reviewed by a code owner ([CODEOWNERS](.github/CODEOWNERS)):
  Eduardo Galbiati.
- **Approvers**: only the repository owner, Eduardo Galbiati, creates release tags (a tag ruleset enforces it) and
  approves each signing request.

**Privacy**: This program will not transfer any information to other networked systems unless specifically requested
by the user or the person installing or operating it. The app's sign-in is off (see "Account and privacy"); the
agent CLIs it opens (Claude Code, Codex, Grok Build) talk to their providers under the terms you accepted when you
signed in to them.
